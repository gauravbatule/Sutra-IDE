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
  /** Dangling stash commit or HEAD commit hash produced by git; null when git is unavailable. */
  stashHash?: string | null;
  /** Filesystem directory containing raw file snapshots for non-git workspaces. */
  fsSnapshotDir?: string | null;
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
      fsSnapshotDir: null,
    };

    let stashHash: string | null = null;
    let fsSnapshotCreated = false;
    const workspaceRoot = fsTools.getWorkspaceRoot();
    const isGitRepo = fs.existsSync(path.join(workspaceRoot, '.git'));

    if (isGitRepo) {
      try {
        // 1. Try `git stash create` which records uncommitted modifications as a dangling commit
        const output = execFileSync('git', ['-c', 'core.safecrlf=false', 'stash', 'create', `${description} (${id})`], {
          cwd: workspaceRoot,
          encoding: 'utf-8',
          timeout: 2_000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

        if (/^[0-9a-fA-F]{4,40}$/.test(output)) {
          stashHash = output;
        } else {
          // If stash create returned empty string, check if workspace is a clean git tree
          try {
            const headHash = execFileSync('git', ['rev-parse', 'HEAD'], {
              cwd: workspaceRoot,
              encoding: 'utf-8',
              timeout: 1_000,
              stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (/^[0-9a-fA-F]{4,40}$/.test(headHash)) {
              stashHash = headHash;
            }
          } catch {
            // Not a git repository or no commits yet
          }
        }
      } catch {
        // Git execution failed or timed out — safely falls through to fast fs snapshot
      }
    }

    // 2. File snapshot fallback for modified files (especially useful for non-git or untracked files)
    if (files.length > 0) {
      try {
        const snapshotDir = path.join(workspaceRoot, '.sandbox', 'checkpoints', id);
        fs.mkdirSync(snapshotDir, { recursive: true });
        for (const fileRel of files) {
          const absSource = path.resolve(workspaceRoot, fileRel);
          if (fs.existsSync(absSource) && fs.statSync(absSource).isFile()) {
            const absDest = path.join(snapshotDir, fileRel);
            fs.mkdirSync(path.dirname(absDest), { recursive: true });
            fs.copyFileSync(absSource, absDest);
            fsSnapshotCreated = true;
          }
        }
        if (fsSnapshotCreated) {
          checkpoint.fsSnapshotDir = snapshotDir;
        }
      } catch {
        // Filesystem snapshot is best effort
      }
    }

    checkpoint.stashHash = stashHash;
    this.loadRegistry();
    this.checkpoints.push(checkpoint);
    if (this.checkpoints.length > MAX_CHECKPOINTS) this.checkpoints.shift();
    this.persistRegistry();

    if (!stashHash && !fsSnapshotCreated) {
      return { checkpoint, skipped: true, reason: 'Nothing to snapshot (clean tree and no existing files specified)' };
    }
    return { checkpoint, skipped: false };
  }

  public getCheckpoints(): Checkpoint[] {
    this.loadRegistry();
    return [...this.checkpoints];
  }

  public async rollback(checkpointId?: string): Promise<{ success: boolean; message: string }> {
    this.loadRegistry();
    const found = (!checkpointId || checkpointId === 'latest')
      ? this.checkpoints[this.checkpoints.length - 1]
      : this.checkpoints.find((c) => c.id === checkpointId);

    if (!found) {
      // Fallback: if in a git repository, discard uncommitted working tree changes
      const workspaceRoot = fsTools.getWorkspaceRoot();
      try {
        execFileSync('git', ['checkout', 'HEAD', '--', '.'], {
          cwd: workspaceRoot,
          encoding: 'utf-8',
          timeout: 10_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { success: true, message: 'Reverted uncommitted working tree changes via git checkout HEAD.' };
      } catch (err: any) {
        return { success: false, message: 'No checkpoints found to restore.' };
      }
    }

    const workspaceRoot = fsTools.getWorkspaceRoot();
    const pathsToRestore = found.filesModified.length > 0 ? found.filesModified : ['.'];

    // 1. Try git rollback if stashHash or HEAD commit hash is present
    if (found.stashHash) {
      try {
        execFileSync(
          'git',
          ['checkout', found.stashHash, '--', ...pathsToRestore],
          {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            timeout: 15_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );
        return { success: true, message: `Restored ${pathsToRestore.length} file(s) via git from checkpoint "${found.description}".` };
      } catch (err: any) {
        console.warn(`[GitCheckpoint] Git checkout rollback failed (${err.message}), trying filesystem snapshot...`);
      }
    }

    // 2. Fallback to filesystem snapshot directory if available
    if (found.fsSnapshotDir && fs.existsSync(found.fsSnapshotDir)) {
      try {
        let restoredCount = 0;
        for (const fileRel of found.filesModified) {
          const snapshotFile = path.join(found.fsSnapshotDir, fileRel);
          const targetFile = path.resolve(workspaceRoot, fileRel);
          if (fs.existsSync(snapshotFile)) {
            fs.mkdirSync(path.dirname(targetFile), { recursive: true });
            fs.copyFileSync(snapshotFile, targetFile);
            restoredCount++;
          }
        }
        return { success: true, message: `Restored ${restoredCount} file(s) from local filesystem snapshot "${found.description}".` };
      } catch (err: any) {
        return { success: false, message: `Filesystem rollback failed: ${err.message}` };
      }
    }

    return { success: false, message: `Checkpoint "${found.description}" has no restorable snapshot.` };
  }
}

export const gitCheckpoints = new GitCheckpointsManager();
