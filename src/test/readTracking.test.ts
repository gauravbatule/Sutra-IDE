import { describe, it, expect } from 'vitest';
import {
  createReadTracker,
  normalizePathForTracking,
} from '../../server/agentSwarm.js';

describe('normalizePathForTracking', () => {
  it('converts Windows backslashes to forward slashes', () => {
    expect(normalizePathForTracking('src\\components\\App.tsx')).toBe('src/components/app.tsx');
  });

  it('lowercases so Windows casing differences collapse to one key', () => {
    expect(normalizePathForTracking('SRC/App.TSX')).toBe('src/app.tsx');
  });

  it('passes already-normalized paths through unchanged', () => {
    expect(normalizePathForTracking('src/server/main.ts')).toBe('src/server/main.ts');
  });

  it('is safe on empty input instead of throwing', () => {
    expect(() => normalizePathForTracking('')).not.toThrow();
    expect(normalizePathForTracking('')).toBe('');
    expect(() => normalizePathForTracking('   ')).not.toThrow();
  });
});

describe('createReadTracker', () => {
  it('reports unknown paths as unread', () => {
    const tracker = createReadTracker();
    expect(tracker.wasRead('src/never-opened.ts')).toBe(false);
  });

  it('marks a path as read', () => {
    const tracker = createReadTracker();
    tracker.markRead('src/index.ts');
    expect(tracker.wasRead('src/index.ts')).toBe(true);
  });

  it('treats Windows-style mixed-case paths and POSIX lowercase paths as the same file', () => {
    const tracker = createReadTracker();
    tracker.markRead('src\\A\\B.ts');
    expect(tracker.wasRead('src/a/b.ts')).toBe(true);
    expect(tracker.wasRead('SRC\\A\\B.ts')).toBe(true);
  });

  it('lists every distinct marked path regardless of stored form', () => {
    const tracker = createReadTracker();
    tracker.markRead('src/a.ts');
    tracker.markRead('src\\lib\\b.ts');
    tracker.markRead('Docs/C.md');

    const paths = tracker.readPaths();
    expect(paths).toHaveLength(3);
    // Order and raw form are implementation details; identity after
    // normalization is the contract.
    const normalizedKeys = new Set(paths.map((p) => normalizePathForTracking(p)));
    expect(normalizedKeys.has('src/a.ts')).toBe(true);
    expect(normalizedKeys.has('src/lib/b.ts')).toBe(true);
    expect(normalizedKeys.has('docs/c.md')).toBe(true);
  });

  it('does not duplicate entries when the same path is marked twice', () => {
    const tracker = createReadTracker();
    tracker.markRead('src/index.ts');
    tracker.markRead('src\\INDEX.ts');
    expect(tracker.readPaths()).toHaveLength(1);
  });
});

describe('tracker isolation', () => {
  it('keeps two trackers independent so state never leaks across instances', () => {
    const first = createReadTracker();
    const second = createReadTracker();

    first.markRead('only-first.ts');
    second.markRead('only-second.ts');

    expect(second.wasRead('only-first.ts')).toBe(false);
    expect(first.wasRead('only-second.ts')).toBe(false);
    expect(first.readPaths()).toHaveLength(1);
    expect(second.readPaths()).toHaveLength(1);
  });
});
