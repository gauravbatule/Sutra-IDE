import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initMemory,
  rememberMemory,
  forgetMemory,
  listMemories,
  touchMemories,
  pruneMemories,
  buildMemorySection,
} from '../../server/harness/memory.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initMemory(db);
});

describe('agent memory', () => {
  it('stores and lists memories newest-used first', () => {
    rememberMemory({ kind: 'preference', content: 'Always use pnpm in this repo' });
    rememberMemory({ kind: 'lesson', content: 'vitest must run with CI=1', workspaceRoot: '/w' });
    const all = listMemories();
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.kind)).toEqual(['lesson', 'preference']);
  });

  it('deduplicates identical content by refreshing instead of duplicating', () => {
    rememberMemory({ kind: 'lesson', content: 'Same lesson', workspaceRoot: '/w' });
    const second = rememberMemory({ kind: 'lesson', content: 'Same lesson', workspaceRoot: '/w' });
    expect(listMemories()).toHaveLength(1);
    expect(second.useCount).toBe(2);
  });

  it('scopes listing to a workspace plus global memories', () => {
    rememberMemory({ kind: 'fact', content: 'Global fact' });
    rememberMemory({ kind: 'fact', content: 'Workspace fact', workspaceRoot: '/a' });
    rememberMemory({ kind: 'fact', content: 'Other workspace fact', workspaceRoot: '/b' });
    const forA = listMemories({ workspaceRoot: '/a' });
    expect(forA).toHaveLength(2);
    expect(forA.map((m) => m.content).sort()).toEqual(['Global fact', 'Workspace fact']);
  });

  it('builds a prompt section with labeled lines and reports used ids', () => {
    rememberMemory({ kind: 'lesson', content: 'Do not edit generated files' });
    rememberMemory({ kind: 'preference', content: 'User prefers TypeScript everywhere' });
    const { text, usedIds } = buildMemorySection(null);
    expect(text).toContain('[Lesson] Do not edit generated files');
    expect(text).toContain('[User preference] User prefers TypeScript everywhere');
    expect(usedIds).toHaveLength(2);
  });

  it('returns an empty section when nothing is remembered', () => {
    const { text, usedIds } = buildMemorySection('/empty');
    expect(text).toBe('');
    expect(usedIds).toEqual([]);
  });

  it('touching memories bumps their relevance counters', async () => {
    const first = rememberMemory({ kind: 'fact', content: 'Older fact' });
    const second = rememberMemory({ kind: 'fact', content: 'Newer fact' });
    // Real gap so the touched entry's last_used_at strictly exceeds the other's
    await new Promise((resolve) => setTimeout(resolve, 5));
    touchMemories([first.id]);
    const ranked = listMemories();
    // Touched memory now ranks above the never-touched newer one
    expect(ranked[0].id).toBe(first.id);
    expect(ranked[0].useCount).toBe(2);
    expect(ranked[1].id).toBe(second.id);
  });

  it('forgets memories and reports whether anything was removed', () => {
    const entry = rememberMemory({ kind: 'fact', content: 'To be forgotten' });
    expect(forgetMemory(entry.id)).toBe(true);
    expect(forgetMemory(entry.id)).toBe(false);
    expect(listMemories()).toHaveLength(0);
  });

  it('prunes stale memories down to the cap', () => {
    for (let i = 0; i < 15; i++) {
      rememberMemory({ kind: 'fact', content: `Fact number ${i}` });
    }
    const removed = pruneMemories(10);
    expect(removed).toBe(5);
    expect(listMemories({ limit: 100 })).toHaveLength(10);
  });
});
