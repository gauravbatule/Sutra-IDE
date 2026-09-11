import { describe, it, expect } from 'vitest';
import {
  attemptTarget,
  StagnationDetector,
  shouldExtendRun,
  type StagnationAssessment,
} from '../../server/harness/stagnation.js';

describe('attemptTarget', () => {
  it('returns empty for missing or empty params', () => {
    expect(attemptTarget(undefined)).toBe('');
    expect(attemptTarget(undefined, 'read_file')).toBe('');
    expect(attemptTarget({}, 'edit_file')).toBe('');
    expect(attemptTarget({ path: '' }, 'read_file')).toBe('');
    expect(attemptTarget({ path: null }, 'read_file')).toBe('');
  });

  it('returns the bare path for mutating tools', () => {
    expect(attemptTarget({ path: 'src/app.ts' }, 'edit_file')).toBe('src/app.ts');
    expect(attemptTarget({ oldPath: 'a.ts', newPath: 'b.ts' }, 'move_file')).toBe('a.ts');
  });

  it('qualifies read-only targets with their range arguments', () => {
    expect(attemptTarget({ path: 'src/big.ts', lineRange: '1-10' }, 'read_file')).toBe(
      'src/big.ts?lineRange="1-10"'
    );
    // A read with no distinguishing args stays bare.
    expect(attemptTarget({ path: 'src/big.ts' }, 'read_file')).toBe('src/big.ts');
  });

  it('yields DIFFERENT targets for the same path with different windows', () => {
    const first = attemptTarget({ path: 'src/big.ts', startLine: 0, endLine: 50 }, 'read_file');
    const second = attemptTarget({ path: 'src/big.ts', startLine: 51, endLine: 100 }, 'read_file');
    expect(first).not.toBe(second);
    // Different range vocabulary also separates targets.
    expect(
      attemptTarget({ path: 'src/big.ts', lineRange: '1-50' }, 'read_file')
    ).not.toBe(attemptTarget({ path: 'src/big.ts', lineRange: '51-100' }, 'read_file'));
  });

  it('is stable: same path plus same range gives the same target', () => {
    const a = { path: 'src/big.ts', startLine: 0, endLine: 50 };
    expect(attemptTarget(a, 'read_file')).toBe(attemptTarget({ ...a }, 'read_file'));
  });

  it('lets qualifier flags like recursive, caseInsensitive and limit participate', () => {
    const bare = attemptTarget({ path: 'src' }, 'list_directory');
    expect(attemptTarget({ path: 'src', recursive: true }, 'list_directory')).not.toBe(bare);
    expect(attemptTarget({ path: 'src', caseInsensitive: true }, 'grep_search')).not.toBe(
      attemptTarget({ path: 'src' }, 'grep_search')
    );
    expect(attemptTarget({ pattern: 'todo', limit: 10 }, 'grep_search')).not.toBe(
      attemptTarget({ pattern: 'todo', limit: 20 }, 'grep_search')
    );
    expect(attemptTarget({ pattern: 'fn', language: 'ts' }, 'ast_grep')).toContain('language="ts"');
  });

  it('ignores qualifiers entirely for mutating tools', () => {
    expect(attemptTarget({ path: 'a.ts', startLine: 1 }, 'edit_file')).toBe('a.ts');
    expect(attemptTarget({ path: 'a.ts', startLine: 999, limit: 5 }, 'edit_file')).toBe('a.ts');
    expect(attemptTarget({ path: 'a.ts', startLine: 1 }, 'edit_file')).toBe(
      attemptTarget({ path: 'a.ts', startLine: 999 }, 'edit_file')
    );
  });

  it('falls back through the candidate key chain', () => {
    expect(attemptTarget({ filePath: 'lib/util.ts' }, 'read_file')).toContain('lib/util.ts');
    expect(attemptTarget({ url: 'https://example.com' }, 'scrape_url')).toContain(
      'https://example.com'
    );
    expect(attemptTarget({ sql: 'SELECT 1' }, 'run_sql')).toBe('SELECT 1');
    // path wins when several candidates are present.
    expect(attemptTarget({ path: 'first.ts', filePath: 'second.ts' }, 'read_file')).toMatch(
      /^first\.ts/
    );
  });
});

describe('StagnationDetector — progressive reads are never punished', () => {
  it('never blocks six reads of one file across six distinct windows', () => {
    const detector = new StagnationDetector();
    for (let window = 0; window < 6; window += 1) {
      const result = detector.record({
        tool: 'read_file',
        params: { path: 'src/large.ts', startLine: window * 100, endLine: window * 100 + 99 },
        ok: true,
      });
      expect(result.level).toBe('none');
    }
  });
});

describe('StagnationDetector — read repetition thresholds', () => {
  it('warns on the 5th read of an identical window but not before', () => {
    const detector = new StagnationDetector();
    const params = { path: 'src/large.ts', startLine: 200, endLine: 299 };
    for (let i = 1; i <= 4; i += 1) {
      expect(detector.record({ tool: 'read_file', params: { ...params }, ok: true }).level).toBe(
        'none'
      );
    }
    const fifth = detector.record({ tool: 'read_file', params: { ...params }, ok: true });
    expect(fifth.level).toBe('warn');
    expect(fifth.reason).toContain('targeted');
  });

  it('blocks at the 8th hit on one qualified target even when calls are not byte-identical', () => {
    const detector = new StagnationDetector();
    let last: StagnationAssessment = { level: 'none', reason: '' };
    // A cosmetic param varies each call so the exact-duplicate rule stays out
    // of the way and only the shared qualified target accumulates.
    for (let i = 1; i <= 7; i += 1) {
      last = detector.record({
        tool: 'read_file',
        params: { path: 'src/large.ts', encoding: `v${i}`, startLine: 0, endLine: 49 },
        ok: true,
      });
      expect(last.level).toBe(i >= 5 ? 'warn' : 'none');
    }
    const eighth = detector.record({
      tool: 'read_file',
      params: { path: 'src/large.ts', encoding: 'v8', startLine: 0, endLine: 49 },
      ok: true,
    });
    expect(eighth.level).toBe('block');
    expect(eighth.reason).toContain('targeted');
  });

  it('blocks identical read calls at the 6th repetition via the exact-duplicate rule', () => {
    const detector = new StagnationDetector();
    const params = { path: 'src/large.ts', startLine: 300, endLine: 349 };
    for (let i = 1; i <= 4; i += 1) {
      expect(detector.record({ tool: 'read_file', params: { ...params }, ok: true }).level).toBe(
        'none'
      );
    }
    expect(detector.record({ tool: 'read_file', params: { ...params }, ok: true }).level).toBe(
      'warn'
    );
    const sixth = detector.record({ tool: 'read_file', params: { ...params }, ok: true });
    expect(sixth.level).toBe('block');
    expect(sixth.reason).toContain('identical');
  });
});

describe('StagnationDetector — mutating tool thresholds', () => {
  it('warns on the 3rd and blocks on the 4th edit of the same target', () => {
    const detector = new StagnationDetector();
    const first = detector.record({
      tool: 'edit_file',
      params: { path: 'src/config.json', note: 'v1' },
      ok: true,
    });
    const second = detector.record({
      tool: 'edit_file',
      params: { path: 'src/config.json', note: 'v2' },
      ok: true,
    });
    expect(first.level).toBe('none');
    expect(second.level).toBe('none');

    const third = detector.record({
      tool: 'edit_file',
      params: { path: 'src/config.json', note: 'v3' },
      ok: true,
    });
    expect(third.level).toBe('warn');
    expect(third.reason).toContain('targeted');

    const fourth = detector.record({
      tool: 'edit_file',
      params: { path: 'src/config.json', note: 'v4' },
      ok: true,
    });
    expect(fourth.level).toBe('block');
    expect(fourth.reason).toContain('targeted');
  });

  it('blocks a byte-identical mutating call on its 3rd occurrence', () => {
    const detector = new StagnationDetector();
    const params = { path: 'src/index.ts', content: 'export {};' };
    expect(detector.record({ tool: 'edit_file', params: { ...params }, ok: true }).level).toBe(
      'none'
    );
    expect(detector.record({ tool: 'edit_file', params: { ...params }, ok: true }).level).toBe(
      'none'
    );
    const third = detector.record({ tool: 'edit_file', params: { ...params }, ok: true });
    expect(third.level).toBe('block');
    expect(third.reason).toContain('identical');
  });

  it('does not cross-contaminate counts between different tools', () => {
    const detector = new StagnationDetector();
    for (let i = 1; i <= 3; i += 1) {
      detector.record({ tool: 'edit_file', params: { path: 'src/a.ts', note: `v${i}` }, ok: true });
    }
    // Same path but a different tool: fresh ledger.
    const otherTool = detector.record({
      tool: 'write_file',
      params: { path: 'src/a.ts', note: 'v1' },
      ok: true,
    });
    expect(otherTool.level).toBe('none');
  });
});

describe('StagnationDetector — consecutive failures', () => {
  it('warns at 3 mixed-tool failures and blocks at 6', () => {
    const detector = new StagnationDetector();
    const failing = [
      { tool: 'edit_file', params: { path: 'a.ts' } },
      { tool: 'grep_search', params: { pattern: 'needle' } },
      { tool: 'run_command', params: { command: 'npm test' } },
      { tool: 'run_command', params: { command: 'npm run build' } },
      { tool: 'run_command', params: { command: 'node script.js' } },
    ];
    for (let i = 0; i < failing.length; i += 1) {
      const result = detector.record({ ...failing[i], ok: false });
      if (i >= 2) {
        expect(result.level).toBe('warn');
        expect(result.reason).toContain('failed in a row');
      } else {
        expect(result.level).toBe('none');
      }
    }
    const sixth = detector.record({
      tool: 'run_command',
      params: { command: 'node retry.js' },
      ok: false,
    });
    expect(sixth.level).toBe('block');
    expect(sixth.reason).toContain('failed in a row');
  });

  it('resets the failure streak after any success', () => {
    const detector = new StagnationDetector();
    expect(detector.record({ tool: 'edit_file', params: { path: 'a.ts' }, ok: false }).level).toBe(
      'none'
    );
    expect(detector.record({ tool: 'edit_file', params: { path: 'b.ts' }, ok: false }).level).toBe(
      'none'
    );
    expect(detector.record({ tool: 'edit_file', params: { path: 'c.ts' }, ok: true }).level).toBe(
      'none'
    );
    // Only two consecutive failures since the success — no warn yet.
    expect(detector.record({ tool: 'edit_file', params: { path: 'd.ts' }, ok: false }).level).toBe(
      'none'
    );
    expect(detector.record({ tool: 'edit_file', params: { path: 'e.ts' }, ok: false }).level).toBe(
      'none'
    );
    const thirdSinceSuccess = detector.record({
      tool: 'edit_file',
      params: { path: 'f.ts' },
      ok: false,
    });
    expect(thirdSinceSuccess.level).toBe('warn');
  });
});

describe('StagnationDetector isolation', () => {
  it('keeps two detectors independent so history never leaks across runs', () => {
    const first = new StagnationDetector();
    const second = new StagnationDetector();
    for (let i = 1; i <= 4; i += 1) {
      first.record({ tool: 'read_file', params: { path: 'x.ts', startLine: 0, endLine: 9 }, ok: true });
    }
    // The second detector has seen nothing; the same call is brand new there.
    expect(
      second.record({ tool: 'read_file', params: { path: 'x.ts', startLine: 0, endLine: 9 }, ok: true })
        .level
    ).toBe('none');
    // And the first detector still warns on its own next repetition.
    expect(
      first.record({ tool: 'read_file', params: { path: 'x.ts', startLine: 0, endLine: 9 }, ok: true })
        .level
    ).toBe('warn');
  });
});

describe('shouldExtendRun', () => {
  const baseInput = {
    roundsUsed: 9,
    maxRounds: 10,
    planHasOpenItems: true,
    runShowsProgress: true,
    stagnationLevel: 'none' as const,
    extensionsUsed: 0,
  };

  it('extends exactly at the round boundary when everything else looks healthy', () => {
    expect(shouldExtendRun(baseInput)).toBe(true);
    expect(shouldExtendRun({ ...baseInput, roundsUsed: 12, maxRounds: 13 })).toBe(true);
  });

  it('does not extend before the round threshold', () => {
    expect(shouldExtendRun({ ...baseInput, roundsUsed: 8 })).toBe(false);
  });

  it('never extends while stagnation says block, but tolerates warn', () => {
    expect(shouldExtendRun({ ...baseInput, stagnationLevel: 'block' })).toBe(false);
    expect(shouldExtendRun({ ...baseInput, stagnationLevel: 'warn' })).toBe(true);
  });

  it('respects the extension budget, defaulting to one', () => {
    expect(shouldExtendRun({ ...baseInput, extensionsUsed: 1 })).toBe(false);
    expect(shouldExtendRun({ ...baseInput, maxExtensions: 2, extensionsUsed: 1 })).toBe(true);
    expect(shouldExtendRun({ ...baseInput, maxExtensions: 2, extensionsUsed: 2 })).toBe(false);
    expect(shouldExtendRun({ ...baseInput, maxExtensions: 0 })).toBe(false);
  });

  it('requires both an open plan and demonstrated progress', () => {
    expect(shouldExtendRun({ ...baseInput, planHasOpenItems: false })).toBe(false);
    expect(shouldExtendRun({ ...baseInput, runShowsProgress: false })).toBe(false);
  });
});
