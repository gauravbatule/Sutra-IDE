import fs from 'fs';
import path from 'path';

export interface WorktreeInfo {
  agentId: string;
  role: string;
  worktreePath: string;
  createdAt: number;
  isActive: boolean;
}

export class EphemeralWorktreeManager {
  private workspaceRoot: string;
  private worktreesBase: string;
  private activeWorktrees: Map<string, WorktreeInfo> = new Map();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.worktreesBase = path.join(workspaceRoot, '.sutra', 'worktrees');
    if (!fs.existsSync(this.worktreesBase)) {
      fs.mkdirSync(this.worktreesBase, { recursive: true });
    }
  }

  public createWorktree(agentId: string, role = 'worker'): WorktreeInfo {
    const worktreePath = path.join(this.worktreesBase, agentId);
    if (!fs.existsSync(worktreePath)) {
      fs.mkdirSync(worktreePath, { recursive: true });
    }

    const info: WorktreeInfo = {
      agentId,
      role,
      worktreePath,
      createdAt: Date.now(),
      isActive: true,
    };

    this.activeWorktrees.set(agentId, info);
    return info;
  }

  public getWorktree(agentId: string): WorktreeInfo | undefined {
    return this.activeWorktrees.get(agentId);
  }

  public releaseWorktree(agentId: string, deleteFiles = false): void {
    const info = this.activeWorktrees.get(agentId);
    if (info) {
      info.isActive = false;
      if (deleteFiles && fs.existsSync(info.worktreePath)) {
        try {
          fs.rmSync(info.worktreePath, { recursive: true, force: true });
        } catch {
          // Ignore filesystem cleanup errors during release
        }
      }
      this.activeWorktrees.delete(agentId);
    }
  }

  public listActiveWorktrees(): WorktreeInfo[] {
    return Array.from(this.activeWorktrees.values());
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    this.worktreesBase = path.join(root, '.sutra', 'worktrees');
  }
}

export const ephemeralWorktrees = new EphemeralWorktreeManager(process.cwd());
