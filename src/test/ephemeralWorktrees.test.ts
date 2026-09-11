import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EphemeralWorktreeManager } from '../../server/harness/ephemeralWorktrees.js';

describe('ephemeralWorktrees', () => {
  let tempDir: string;
  let manager: EphemeralWorktreeManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-wt-test-'));
    manager = new EphemeralWorktreeManager(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort test directory cleanup
    }
  });

  it('creates and tracks an ephemeral worktree', () => {
    const wt = manager.createWorktree('agent-1', 'frontend');
    expect(wt.agentId).toBe('agent-1');
    expect(wt.role).toBe('frontend');
    expect(wt.isActive).toBe(true);
    expect(fs.existsSync(wt.worktreePath)).toBe(true);

    const found = manager.getWorktree('agent-1');
    expect(found).toBeDefined();
    expect(found?.worktreePath).toBe(wt.worktreePath);
  });

  it('lists and releases worktrees', () => {
    manager.createWorktree('agent-1', 'frontend');
    manager.createWorktree('agent-2', 'backend');
    expect(manager.listActiveWorktrees()).toHaveLength(2);

    manager.releaseWorktree('agent-1', true);
    expect(manager.listActiveWorktrees()).toHaveLength(1);
    expect(manager.getWorktree('agent-1')).toBeUndefined();
  });
});
