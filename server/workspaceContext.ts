import path from 'path';
import type { Dirent } from 'fs';
import fsp from 'fs/promises';

/**
 * WORKSPACE SNAPSHOT (system-prompt grounding)
 * A compact plain-text map of what actually exists on disk, injected into every
 * agent system prompt so Astra plans against real paths instead of guesses.
 * Dependency-free: node:fs promises only. Every path is best-effort — the
 * snapshot must never throw or crash prompt building.
 */

export interface WorkspaceSnapshot {
  /** Flat newline-separated path list ("src/components/Agent/AgentChat.tsx", "server/providers/"). */
  tree: string;
  /** Number of FILE entries listed in the tree. */
  fileCount: number;
  /** Epoch ms when this snapshot was generated (also drives the TTL cache). */
  generatedAt: number;
}

// Maximum directory depth reflected in the tree (root's children are depth 1).
const MAX_DEPTH = 3;
// Hard cap on emitted lines so the prompt injection stays cheap even in huge workspaces.
const MAX_ENTRIES = 200;
// Recompute at most once per minute unless the workspace root itself changed.
const CACHE_TTL_MS = 60_000;

// Build/dependency/binary directories never belong in a structural map.
const SKIPPED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-exe',
  'build',
  'out',
  'coverage',
  '__pycache__',
  'vendor',
  'target',
  '.next',
  '.nuxt',
  '.vite',
  '.cache',
  '.gradle',
  '.idea',
  '.vscode',
]);

// Binary and database files carry no useful structure for the prompt.
const BINARY_FILE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'tif', 'tiff',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac',
  'zip', 'gz', 'tar', 'rar', '7z', 'bz2', 'xz',
  'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'node', 'obj', 'lib', 'pdb', 'pyc', 'class', 'jar',
  'pdf', 'psd', 'ai', 'sketch', 'blend',
]);

function isSkippableFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (
    lower.endsWith('.sqlite') ||
    lower.endsWith('.sqlite3') ||
    lower.endsWith('.db') ||
    lower.endsWith('.db-shm') ||
    lower.endsWith('.db-wal')
  ) {
    return true;
  }
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex === -1) return false; // Extensionless files stay visible
  return BINARY_FILE_EXTENSIONS.has(lower.slice(dotIndex + 1));
}

/**
 * Depth-first walk producing a flat, alphabetically sorted path list.
 * Directories appear as "dir/" lines so truncation still shows where
 * deeper content lives; files appear as full workspace-relative paths.
 */
async function collectSnapshotLines(root: string): Promise<{ lines: string[]; fileCount: number }> {
  const lines: string[] = [];
  let fileCount = 0;
  let remaining = MAX_ENTRIES;

  const byName = (a: Dirent, b: Dirent) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  const walk = async (absDir: string, relDir: string, depth: number): Promise<void> => {
    if (remaining <= 0 || depth > MAX_DEPTH) return;
    let dirents: Dirent[];
    try {
      dirents = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return; // Unreadable directory — silently omit it from the map
    }

    const dirs = dirents.filter((d) => d.isDirectory() && !SKIPPED_DIRECTORY_NAMES.has(d.name)).sort(byName);
    const files = dirents.filter((d) => d.isFile() && !isSkippableFileName(d.name)).sort(byName);

    // Emit the directory line first so its children stay attributable even if
    // the entry budget runs out mid-subtree.
    if (relDir) {
      lines.push(`${relDir}/`);
      remaining -= 1;
    }
    for (const file of files) {
      if (remaining <= 0) break;
      lines.push(relDir ? `${relDir}/${file.name}` : file.name);
      fileCount += 1;
      remaining -= 1;
    }
    for (const dir of dirs) {
      if (remaining <= 0) break;
      await walk(path.join(absDir, dir.name), relDir ? `${relDir}/${dir.name}` : dir.name, depth + 1);
    }
  };

  await walk(root, '', 1);
  return { lines, fileCount };
}

/**
 * Build a fresh workspace snapshot. Never throws — on fs errors an empty tree
 * is returned so prompt building always succeeds.
 */
export async function buildWorkspaceSnapshot(workspaceRoot: string): Promise<WorkspaceSnapshot> {
  try {
    const { lines, fileCount } = await collectSnapshotLines(workspaceRoot);
    return { tree: lines.join('\n'), fileCount, generatedAt: Date.now() };
  } catch {
    // The snapshot must never crash prompt building — an empty map beats none.
    return { tree: '', fileCount: 0, generatedAt: Date.now() };
  }
}

interface SnapshotCacheEntry {
  root: string;
  rootMtimeMs: number;
  snapshot: WorkspaceSnapshot;
}

let snapshotCache: SnapshotCacheEntry | null = null;

/**
 * Cached wrapper around buildWorkspaceSnapshot: recomputes only when the cached
 * copy is older than CACHE_TTL_MS or the workspace root directory's mtime
 * changed. Keeps per-run prompt injection cheap on large workspaces.
 */
export async function getWorkspaceSnapshot(workspaceRoot: string): Promise<WorkspaceSnapshot> {
  try {
    const rootStat = await fsp.stat(workspaceRoot);
    const isFresh =
      snapshotCache &&
      snapshotCache.root === workspaceRoot &&
      snapshotCache.rootMtimeMs === rootStat.mtimeMs &&
      Date.now() - snapshotCache.snapshot.generatedAt < CACHE_TTL_MS;
    if (snapshotCache && isFresh) return snapshotCache.snapshot;
    const snapshot = await buildWorkspaceSnapshot(workspaceRoot);
    snapshotCache = { root: workspaceRoot, rootMtimeMs: rootStat.mtimeMs, snapshot };
    return snapshot;
  } catch {
    // Root unreadable — serve the last known snapshot while it is still fresh,
    // otherwise fall back to an empty one.
    if (snapshotCache && snapshotCache.root === workspaceRoot && Date.now() - snapshotCache.snapshot.generatedAt < CACHE_TTL_MS) {
      return snapshotCache.snapshot;
    }
    return { tree: '', fileCount: 0, generatedAt: Date.now() };
  }
}
