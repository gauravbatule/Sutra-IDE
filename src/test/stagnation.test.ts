import { describe, it, expect } from 'vitest';
import { StagnationDetector, shouldExtendRun, attemptTarget } from '../../server/harness/stagnation.js';

const attempt = (tool: string, params: Record<string, unknown> | undefined, ok = true) => ({ tool, params, ok });

describe('attemptTarget', () => {
  it('normalizes to the primary target across param shapes', () => {
    expect(attemptTarget({ path: 'src/a.ts' })).toBe('src/a.ts');
    expect(attemptTarget({ oldPath: 'a', newPath: 'b' })).toBe('a');
    expect(attemptTarget({ query: 'foo' })).toBe('foo');
    expect(attemptTarget(undefined)).toBe('');
  });
});

describe('StagnationDetector', () => {
  it('passes clean varied work through untouched', () => {
    const d = new StagnationDetector();
    expect(d.record(attempt('read_file', { path: 'a.ts' })).level).toBe('none');
    expect(d.record(attempt('edit_file', { path: 'a.ts' }, true)).level).toBe('none');
    expect(d.record(attempt('read_file', { path: 'b.ts' })).level).toBe('none');
  });

  it('blocks a third identical invocation', () => {
    const d = new StagnationDetector();
    d.record(attempt('edit_file', { path: 'a.ts', content: 'x' }));
    d.record(attempt('edit_file', { path: 'a.ts', content: 'x' }));
    const third = d.record(attempt('edit_file', { path: 'a.ts', content: 'x' }));
    expect(third.level).toBe('block');
    expect(third.reason).toMatch(/identical/i);
  });

  it('warns on the third same-target attempt even when params differ, blocks on the fourth', () => {
    const d = new StagnationDetector();
    d.record(attempt('edit_file', { path: 'big.ts', content: 'v1' }));
    d.record(attempt('edit_file', { path: 'big.ts', content: 'v2' }));
    const third = d.record(attempt('edit_file', { path: 'big.ts', content: 'v3' }));
    expect(third.level).toBe('warn');

    const fourth = d.record(attempt('edit_file', { path: 'big.ts', content: 'v4' }));
    expect(fourth.level).toBe('block');
    expect(fourth.reason).toMatch(/big\.ts/);
  });

  it('warns after three consecutive failures and recovers after success', () => {
    const d = new StagnationDetector();
    d.record(attempt('shell_exec', { command: 'npm test' }, false));
    d.record(attempt('edit_file', { path: 'a.ts' }, false));
    const thirdFail = d.record(attempt('edit_file', { path: 'b.ts' }, false));
    expect(thirdFail.level).toBe('warn');
    expect(thirdFail.reason).toMatch(/failed in a row/);

    // One success resets the failure streak despite more history
    const recovered = d.record(attempt('read_file', { path: 'c.ts' }));
    expect(recovered.level).toBe('none');
  });

  it('does not count different targets toward the same-work rule', () => {
    const d = new StagnationDetector();
    d.record(attempt('write_file', { path: 'one.ts', content: '1' }));
    d.record(attempt('write_file', { path: 'two.ts', content: '2' }));
    const result = d.record(attempt('write_file', { path: 'three.ts', content: '3' }));
    expect(result.level).toBe('none');
  });
});

describe('shouldExtendRun', () => {
  const base = {
    roundsUsed: 19,
    maxRounds: 20,
    planHasOpenItems: true,
    runShowsProgress: true,
    stagnationLevel: 'none' as const,
    extensionsUsed: 0,
  };

  it('grants exactly one extension for healthy unfinished work at the cap', () => {
    expect(shouldExtendRun(base)).toBe(true);
    expect(shouldExtendRun({ ...base, extensionsUsed: 1 })).toBe(false);
  });

  it('refuses extension without an open plan or real progress', () => {
    expect(shouldExtendRun({ ...base, planHasOpenItems: false })).toBe(false);
    expect(shouldExtendRun({ ...base, runShowsProgress: false })).toBe(false);
  });

  it('never extends a blocked run or a run below its cap', () => {
    expect(shouldExtendRun({ ...base, stagnationLevel: 'block' })).toBe(false);
    expect(shouldExtendRun({ ...base, roundsUsed: 5 })).toBe(false);
  });
});
