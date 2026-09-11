import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initMemory,
  rememberMemory,
  listMemories,
  buildMemorySection,
  normalizeMemoryText,
  areMemoriesSimilar,
  shouldAutoRecordLesson,
} from '../../server/harness/memory.js';

let db: Database.Database;

// Fresh in-memory table per test so dedupe state never leaks across cases.
beforeEach(() => {
  db = new Database(':memory:');
  initMemory(db);
});

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('normalizeMemoryText', () => {
  it('trims, lowercases, collapses whitespace, and strips trailing punctuation', () => {
    expect(normalizeMemoryText('  Always   Use PNPM!!!  ')).toBe('always use pnpm');
  });

  it('strips combined trailing quotes and punctuation', () => {
    expect(normalizeMemoryText('Fix the port conflict."')).toBe('fix the port conflict');
    expect(normalizeMemoryText('Cache misses cost minutes —')).toBe('cache misses cost minutes');
  });

  it('keeps punctuation that is not trailing', () => {
    expect(normalizeMemoryText('Must run CI=1.')).toBe('must run ci=1');
  });

  it('collapses internal runs of whitespace to single spaces', () => {
    expect(normalizeMemoryText('one\ttwo\n\nthree')).toBe('one two three');
  });

  it('reduces blank input to an empty string instead of throwing', () => {
    expect(normalizeMemoryText('   ')).toBe('');
  });
});

describe('areMemoriesSimilar', () => {
  it('treats normalization-equal texts as the same memory', () => {
    expect(areMemoriesSimilar('Vitest must run with CI=1.', 'vitest must run with CI=1')).toBe(true);
  });

  it('matches when one memory contains the other', () => {
    expect(areMemoriesSimilar('Always use pnpm', 'In this repo always use pnpm for installs')).toBe(true);
  });

  it('matches heavy word overlap (Jaccard >= 0.75)', () => {
    // 8 shared tokens out of a 10-token union -> 0.8
    expect(areMemoriesSimilar('vitest must run with CI=1 in this repo', 'vitest must run with CI=1 inside this repo')).toBe(true);
  });

  it('rejects disjoint word sets outright', () => {
    expect(areMemoriesSimilar('Always use pnpm for installs here', 'Deploy the docker image nightly')).toBe(false);
  });

  it('rejects partial overlap below the 0.75 threshold', () => {
    // 4 shared tokens out of an 8-token union -> 0.5
    expect(areMemoriesSimilar('Clean dist before typecheck runs', 'Clean dist before the build runs too')).toBe(false);
  });

  it('does not let a token bleed into a longer sibling via substring matching', () => {
    // "fact number 1" must not swallow "fact number 10" — containment counts
    // whole words, not raw substrings.
    expect(areMemoriesSimilar('Fact number 1', 'Fact number 10')).toBe(false);
  });

  it('never matches empty input against anything', () => {
    expect(areMemoriesSimilar('', 'anything at all')).toBe(false);
    expect(areMemoriesSimilar('   ', '')).toBe(false);
  });
});

describe('shouldAutoRecordLesson', () => {
  it('accepts lessons with a clear failure signal', () => {
    expect(shouldAutoRecordLesson('Verification "build" failed in this workspace: missing tsconfig')).toEqual({
      ok: true,
      reason: 'actionable',
    });
  });

  it('accepts lessons phrased as a rule', () => {
    expect(shouldAutoRecordLesson('The dev server must be restarted after changing env files').ok).toBe(true);
  });

  it('rejects trivially short events', () => {
    expect(shouldAutoRecordLesson('Run lint')).toEqual({ ok: false, reason: 'too_short' });
  });

  it('rejects content with no letters at all', () => {
    expect(shouldAutoRecordLesson('1234567890 !!! ### $$$ %%% ^^^ &&&')).toEqual({ ok: false, reason: 'no_letters' });
  });

  it('rejects generic praise openers that teach nothing', () => {
    expect(shouldAutoRecordLesson('Great work! Everything passed nicely today')).toEqual({
      ok: false,
      reason: 'generic_filler',
    });
  });

  it('rejects bare thanks with no actionable signal', () => {
    expect(shouldAutoRecordLesson('Thank you so much everyone for all of the help today')).toEqual({
      ok: false,
      reason: 'generic_filler',
    });
  });

  it('rejects substantive-length prose lacking any actionable signal', () => {
    expect(shouldAutoRecordLesson('The repo contains several folders with source files inside')).toEqual({
      ok: false,
      reason: 'not_actionable',
    });
  });

  it('lets actionable signal outrank a praise opener', () => {
    expect(shouldAutoRecordLesson('Thanks — always rerun migrations after major upgrades').ok).toBe(true);
  });
});

describe('rememberMemory curation', () => {
  it('merges reworded near-duplicate lessons into one row with a bumped counter', () => {
    const first =
      'Typecheck fails when build output is stale — clean dist before running';
    const second =
      'Remember that typecheck fails when build output is stale — clean dist before running the build';
    const one = rememberMemory({ kind: 'lesson', content: first });
    const two = rememberMemory({ kind: 'lesson', content: second });
    expect(two.id).toBe(one.id);
    expect(listMemories()).toHaveLength(1);
    expect(two.useCount).toBe(2);
    // The rewording was longer, so the original tighter wording stays.
    expect(two.content).toBe(first);
  });

  it('keeps meaningfully shorter wording for the same information', () => {
    const long =
      'In this workspace the build fails whenever you forget to clean the stale dist folder first';
    const short = 'Build fails whenever you forget to clean the stale dist folder first';
    rememberMemory({ kind: 'lesson', content: long });
    const tightened = rememberMemory({ kind: 'lesson', content: short });
    expect(listMemories()).toHaveLength(1);
    expect(tightened.content).toBe(short);
    expect(tightened.useCount).toBe(2);
  });

  it('still collapses exact repeats through the unique-index backstop', () => {
    rememberMemory({ kind: 'fact', content: 'Port 3001 hosts the dev server' });
    const again = rememberMemory({ kind: 'fact', content: 'Port 3001 hosts the dev server' });
    expect(listMemories()).toHaveLength(1);
    expect(again.useCount).toBe(2);
  });

  it('always records user preferences, even short or non-actionable ones', () => {
    rememberMemory({ kind: 'preference', content: 'My favorite editor theme is solar flare dark' });
    rememberMemory({ kind: 'preference', content: 'Prefer tabs over spaces' });
    expect(listMemories()).toHaveLength(2);
  });

  it('gates machine-recorded lessons through the quality check when asked', () => {
    expect(() =>
      rememberMemory({ kind: 'lesson', content: 'Sounds great', autoLesson: true })
    ).toThrow(/too_short/);
    // Without the flag (user-taught path) the same content records fine.
    expect(rememberMemory({ kind: 'lesson', content: 'Sounds great' }).id).toBeGreaterThan(0);
    // A real lesson passes the gate on the automatic path.
    const kept = rememberMemory({
      kind: 'lesson',
      content: 'Vitest must run with CI=1 in continuous integration environments',
      autoLesson: true,
    });
    expect(kept.id).toBeGreaterThan(0);
  });
});

describe('workspace-first ranking', () => {
  it('ranks workspace memories ahead of newer global ones', async () => {
    const g = rememberMemory({ kind: 'fact', content: 'Global deployment runs on Friday nights' });
    await tick(5); // global is strictly newer by last_used_at...
    const w = rememberMemory({
      kind: 'fact',
      content: 'Alpha workspace keeps secrets in vault config',
      workspaceRoot: '/w',
    });
    // ...yet the workspace memory ranks first for /w.
    const ranked = listMemories({ workspaceRoot: '/w', limit: 10 });
    expect(ranked.map((m) => m.id)).toEqual([w.id, g.id]);
    // limit applies after the workspace slice, never evicting it for globals.
    expect(listMemories({ workspaceRoot: '/w', limit: 1 }).map((m) => m.id)).toEqual([w.id]);
  });

  it('fills leftover slots with globals for unrelated workspaces', () => {
    rememberMemory({ kind: 'fact', content: 'Global deployment runs on Friday nights' });
    rememberMemory({
      kind: 'fact',
      content: 'Alpha workspace keeps secrets in vault config',
      workspaceRoot: '/w',
    });
    const elsewhere = listMemories({ workspaceRoot: '/elsewhere' });
    expect(elsewhere.map((m) => m.content)).toEqual(['Global deployment runs on Friday nights']);
  });

  it('leaves unscoped listing on pure recency order', async () => {
    const older = rememberMemory({ kind: 'fact', content: 'Global deployment runs on Friday nights' });
    await tick(5);
    const newer = rememberMemory({ kind: 'fact', content: 'Nightly jobs prune old artifacts automatically' });
    expect(listMemories().map((m) => m.id)).toEqual([newer.id, older.id]);
  });
});

describe('buildMemorySection curation', () => {
  it('orders user preferences ahead of newer machine lessons', async () => {
    rememberMemory({ kind: 'preference', content: 'Please keep answers concise during planning sessions' });
    await tick(5); // lesson is strictly newer, but intent still outranks it
    rememberMemory({
      kind: 'lesson',
      content: 'Typecheck fails when dist output is stale — clean it before verifying',
    });
    const { text, usedIds } = buildMemorySection(null);
    expect(text.indexOf('[User preference]')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('[Lesson]')).toBeGreaterThan(text.indexOf('[User preference]'));
    expect(usedIds).toHaveLength(2);
  });

  it('caps sections at 8 entries no matter the limit argument', () => {
    for (let i = 0; i < 12; i++) {
      rememberMemory({ kind: 'fact', content: `zebra${i} meets yaks${i} inside the layout grid` });
    }
    expect(listMemories({ limit: 100 })).toHaveLength(12); // nothing was deduped away
    const capped = buildMemorySection(null, 20);
    expect(capped.usedIds).toHaveLength(8);
    expect(capped.text.match(/^- \[/gm)).toHaveLength(8);
    expect(buildMemorySection(null, 3).usedIds).toHaveLength(3); // smaller limits still honored
  });

  it('returns an empty section when the store is empty', () => {
    const empty = buildMemorySection('/nothing-here');
    expect(empty.text).toBe('');
    expect(empty.usedIds).toEqual([]);
  });
});
