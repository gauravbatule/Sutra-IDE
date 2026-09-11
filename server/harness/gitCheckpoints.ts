/**
 * SUTRA Studio — Git Micro-Checkpoints & Instant Rollback
 * Creates automated lightweight snapshots before multi-file modifications.
 *
 * Each checkpoint runs `git stash create <msg>` which produces a dangling stash
 * commit WITHOUT touching refs/stash or the working tree. The returned commit
 * hash is stored in a registry (in-memory + best-effort JSON under .sandbox/)
 * so rollback can restore exactly that snapshot via
 * `git checkout <stashHash> -- <files>` — never a bare `git checkout -- .`,
 * which would destroy every other uncommitted change.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fsTools } from '../tools/fsTools.js';

export interface Checkpoint {
  id: string;
  timestamp: number;
  description: string;
  filesModified: string[];
  /** Dangling stash commit produced by `git stash create`; null when the workspace had nothing to snapshot or git is unavailable. */
  stashHash?: string | null;
}

export interface CheckpointResult {
  checkpoint: Checkpoint;
  skipped: boolean;
  reason?: string;
}

const MAX_CHECKPOINTS = 50;

export class GitCheckpointsManager {
  private checkpoints: Checkpoint[] = [];
  private registryLoaded = false;

  private get registryPath(): string {
    return path.join(fsTools.getWorkspaceRoot(), '.sandbox', 'sutra-checkpoints.json');
  }

  private loadRegistry(): void {
    if (this.registryLoaded) return;
    this.registryLoaded = true;
    try {
      const raw = fs.readFileSync(this.registryPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.checkpoints)) {
        this.checkpoints = parsed.checkpoints.slice(-MAX_CHECKPOINTS);
      }
    } catch {
      // No persisted registry yet — start fresh.
    }
  }

  private persistRegistry(): void {
    try {
      const dir = path.dirname(this.registryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.registryPath, JSON.stringify({ checkpoints: this.checkpoints }, null, 2), 'utf-8');
    } catch {
      // Best-effort persistence; in-memory registry still works for this session.
    }
  }

  public async createCheckpoint(description: string, files: string[] = []): Promise<CheckpointResult> {
    const id = `chk-${Date.now()}`;
    const checkpoint: Checkpoint = {
      id,
      timestamp: Date.now(),
      description,
      filesModified: files,
      stashHash: null,
    };

    let stashHash: string | null = null;
    let skipReason: string | undefined;
    try {
      // `git stash create` records uncommitted work as a dangling commit without
      // modifying the working tree or refs/stash — perfect for micro-checkpoints.
      const output = execFileSync('git', ['stash', 'create', `${description} (${id})`], {
        cwd: fsTools.getWorkspaceRoot(),
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (/^[0-9a-fA-F]{4,40}$/.test(output)) {
        stashHash = output;
      } else {
        // Empty output means a clean tree (nothing to snapshot) or not a repo.
        skipReason = output ? 'Unexpected git output' : 'Nothing to snapshot (clean tree or not a git repository)';
      }
    } catch {
      skipReason = 'Not a git repository or git is unavailable';
    }

    checkpoint.stashHash = stashHash;
    this.loadRegistry();
    this.checkpoints.push(checkpoint);
    if (this.checkpoints.length > MAX_CHECKPOINTS) this.checkpoints.shift();
    this.persistRegistry();

    if (!stashHash) {
      console.warn(`[GitCheckpoint] Skipped restorable snapshot for "${id}": ${skipReason}`);
      return { checkpoint, skipped: true, reason: skipReason };
    }
    return { checkpoint, skipped: false };
  }

  public getCheckpoints(): Checkpoint[] {
    this.loadRegistry();
    return [...this.checkpoints];
  }

  public async rollback(checkpointId: string): Promise<{ success: boolean; message: string }> {
    this.loadRegistry();
    const found = this.checkpoints.find((c) => c.id === checkpointId);
    if (!found) {
      return { success: false, message: `Checkpoint ${checkpointId} not found.` };
    }
    if (!found.stashHash) {
      return { success: false, message: `Checkpoint "${found.description}" has no restorable snapshot.` };
    }

    try {
      // Restore ONLY the files captured by this checkpoint from its stored snapshot.
      const pathsToRestore = found.filesModified.length > 0 ? found.filesModified : ['.'];
      execFileSync(
        'git',
        ['checkout', found.stashHash, '--', ...pathsToRestore],
        {
          cwd: fsTools.getWorkspaceRoot(),
          encoding: 'utf-8',
          timeout: 15_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      return { success: true, message: `Restored ${pathsToRestore.length} file(s) from checkpoint "${found.description}".` };
    } catch (err: any) {
      return { success: false, message: `Rollback failed: ${err.message}` };
    }
  }
}

export const gitCheckpoints = new GitCheckpointsManager();
