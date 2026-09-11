import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SpecManager } from '../../server/harness/specManager.js';

describe('specManager', () => {
  let tempDir: string;
  let manager: SpecManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-spec-test-'));
    manager = new SpecManager(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort test directory cleanup
    }
  });

  it('creates and persists a new spec', () => {
    const spec = manager.createSpec('Build Dashboard', {
      milestones: [
        { id: '1', title: 'Scaffold', completed: false },
        { id: '2', title: 'Tests', completed: false },
      ],
    });

    expect(spec.goalTitle).toBe('Build Dashboard');
    expect(spec.milestones).toHaveLength(2);

    const loaded = manager.getActiveSpec();
    expect(loaded).not.toBeNull();
    expect(loaded?.goalTitle).toBe('Build Dashboard');
  });

  it('tracks milestone completion and compliance score', () => {
    manager.createSpec('Refactor API', {
      milestones: [
        { id: '1', title: 'Unit Tests', completed: false },
        { id: '2', title: 'Endpoints', completed: false },
      ],
    });

    let score = manager.getComplianceScore();
    expect(score.completionRatio).toBe(0);
    expect(score.missingMilestones).toHaveLength(2);

    manager.updateMilestone('1', true);
    score = manager.getComplianceScore();
    expect(score.completionRatio).toBe(0.5);
    expect(score.missingMilestones).toEqual(['Endpoints']);

    manager.updateMilestone('2', true);
    score = manager.getComplianceScore();
    expect(score.completionRatio).toBe(1.0);
    expect(score.missingMilestones).toHaveLength(0);
  });
});
