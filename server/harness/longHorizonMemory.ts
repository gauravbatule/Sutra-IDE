import fs from 'fs';
import path from 'path';

export interface ExplorationNode {
  branchId: string;
  parentId: string | null;
  depth: number;
  strategy: string;
  fitnessScore: number;
  durationMs: number;
  heapDeltaMb: number;
  status: 'active' | 'pruned' | 'optimal' | 'reverted';
  postMortem?: string;
  timestamp: number;
}

export class LongHorizonMemoryTree {
  private workspaceRoot: string;
  private storagePath: string;
  private nodes: Map<string, ExplorationNode> = new Map();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    const evoDir = path.join(workspaceRoot, '.sutra', 'evolution');
    if (!fs.existsSync(evoDir)) {
      fs.mkdirSync(evoDir, { recursive: true });
    }
    this.storagePath = path.join(evoDir, 'branch_tree.json');
    this.loadFromDisk();
  }

  public addNode(params: {
    parentId?: string | null;
    strategy: string;
    fitnessScore: number;
    durationMs?: number;
    heapDeltaMb?: number;
  }): ExplorationNode {
    const parent = params.parentId ? this.nodes.get(params.parentId) : null;
    const depth = parent ? parent.depth + 1 : 0;
    const branchId = `branch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const node: ExplorationNode = {
      branchId,
      parentId: params.parentId || null,
      depth,
      strategy: params.strategy,
      fitnessScore: params.fitnessScore,
      durationMs: params.durationMs || 0,
      heapDeltaMb: params.heapDeltaMb || 0,
      status: 'active',
      timestamp: Date.now(),
    };

    this.nodes.set(branchId, node);
    this.saveToDisk();
    return node;
  }


  public getNode(branchId: string): ExplorationNode | undefined {
    return this.nodes.get(branchId);
  }


  public findOptimalNode(): ExplorationNode | null {
    let best: ExplorationNode | null = null;
    for (const node of this.nodes.values()) {
      if (node.status === 'pruned' || node.status === 'reverted') continue;
      if (!best || node.fitnessScore > best.fitnessScore) {
        best = node;
      }
    }
    return best;
  }


  public pruneNode(branchId: string, reason: string): void {
    const node = this.nodes.get(branchId);
    if (node) {
      node.status = 'pruned';
      node.postMortem = reason;
      this.saveToDisk();
    }
  }


  public getTotalNodesCount(): number {
    return this.nodes.size;
  }


  private saveToDisk(): void {
    try {
      const array = Array.from(this.nodes.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(array, null, 2), 'utf8');
    } catch {
      // Best-effort storage persistence
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.storagePath)) return;
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.branchId) {
            this.nodes.set(item.branchId, item);
          }
        }
      }
    } catch {
      // Fallback on clean in-memory state on parse error
    }
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    const evoDir = path.join(root, '.sutra', 'evolution');
    if (!fs.existsSync(evoDir)) {
      try { fs.mkdirSync(evoDir, { recursive: true }); } catch {}
    }
    this.storagePath = path.join(evoDir, 'branch_tree.json');
    this.loadFromDisk();
  }
}

export const longHorizonMemory = new LongHorizonMemoryTree(process.cwd());
