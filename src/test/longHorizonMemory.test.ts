import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LongHorizonMemoryTree } from '../../server/harness/longHorizonMemory.js';

describe('longHorizonMemory', () => {
  let tempDir: string;
  let tree: LongHorizonMemoryTree;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-lhm-test-'));
    tree = new LongHorizonMemoryTree(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort directory cleanup
    }
  });

  it('creates and tracks branches across exploration', () => {
    const root = tree.addNode({
      strategy: 'Baseline implementation',
      fitnessScore: 0.5,
    });

    expect(root.depth).toBe(0);
    expect(tree.getTotalNodesCount()).toBe(1);

    const child = tree.addNode({
      parentId: root.branchId,
      strategy: 'Variation A: Caching',
      fitnessScore: 0.85,
    });

    expect(child.depth).toBe(1);
    expect(child.parentId).toBe(root.branchId);
    expect(tree.getTotalNodesCount()).toBe(2);
  });

  it('finds optimal node and prunes regressed branches', () => {
    tree.addNode({ strategy: 'A', fitnessScore: 0.6 });
    const n2 = tree.addNode({ strategy: 'B', fitnessScore: 0.9 });
    const n3 = tree.addNode({ strategy: 'C', fitnessScore: 0.95, durationMs: 5000 });

    expect(tree.findOptimalNode()?.branchId).toBe(n3.branchId);

    tree.pruneNode(n3.branchId, 'Heap bloat');
    expect(tree.findOptimalNode()?.branchId).toBe(n2.branchId);
  });
});
