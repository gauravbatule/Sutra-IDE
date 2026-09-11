/**
 * SUTRA Studio — Persistent Agent Memory
 *
 * Durable facts, preferences, and lessons Astra accumulates across runs and
 * sessions. Lessons are typically recorded automatically when verification
 * exposes a real failure; preferences come from the user. Every prompt run
 * receives the most relevant memories so past mistakes are not repeated.
 */
import type Database from 'better-sqlite3';

export type MemoryKind = 'lesson' | 'preference' | 'fact';

export interface MemoryEntry {
  id: number;
  kind: MemoryKind;
  content: string;
  /** Workspace this memory belongs to, or null for globally applicable memories. */
  workspaceRoot: string | null;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

let db: Database.Database | null = null;

export function initMemory(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      workspace_root TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memories_used ON agent_memories(last_used_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memories_dedupe ON agent_memories(kind, content);
  `);
}

function requireDb(): Database.Database {
  if (!db) throw new Error('memory not initialized — call initMemory first');
  return db;
}

/**
 * Records a memory. Identical kind+content pairs are deduplicated — re-learning
 * a lesson refreshes it instead of growing the store.
 */
export function rememberMemory(input: {
  kind: MemoryKind;
  content: string;
  workspaceRoot?: string | null;
}): MemoryEntry {
  const database = requireDb();
  const content = input.content.trim().slice(0, 500);
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO agent_memories (kind, content, workspace_root, created_at, last_used_at, use_count)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(kind, content) DO UPDATE SET last_used_at = excluded.last_used_at, use_count = use_count + 1`
    )
    .run(input.kind, content, input.workspaceRoot ?? null, now, now);
  const row = database
    .prepare('SELECT * FROM agent_memories WHERE kind = ? AND content = ?')
    .get(input.kind, content) as any;
  return rowToEntry(row);
}

/** Global memories first-class alongside workspace ones; most recently used wins. */
export function listMemories(opts: { workspaceRoot?: string | null; limit?: number } = {}): MemoryEntry[] {
  const database = requireDb();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const rows = (
    opts.workspaceRoot
      ? database
          .prepare(
            'SELECT * FROM agent_memories WHERE workspace_root IS NULL OR workspace_root = ? ORDER BY last_used_at DESC, id DESC LIMIT ?'
          )
          .all(opts.workspaceRoot, limit)
      : database.prepare('SELECT * FROM agent_memories ORDER BY last_used_at DESC, id DESC LIMIT ?').all(limit)
  ) as any[];
  return rows.map(rowToEntry);
}

export function forgetMemory(id: number): boolean {
  const database = requireDb();
  const result = database.prepare('DELETE FROM agent_memories WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Bumped whenever injected into a prompt — drives relevance ranking over time. */
export function touchMemories(ids: number[]): void {
  if (ids.length === 0) return;
  const database = requireDb();
  const now = Date.now();
  const stmt = database.prepare('UPDATE agent_memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?');
  const tx = database.transaction((idsToUpdate: number[]) => {
    for (const id of idsToUpdate) stmt.run(now, id);
  });
  try {
    tx(ids);
  } catch {
    // Relevance tracking must never break a prompt build
  }
}

/**
 * Prompt-ready block: what Astra remembers that should shape this run.
 * Returns '' when there is nothing worth saying — never wastes context.
 */
export function buildMemorySection(workspaceRoot: string | null, limit = 12): { text: string; usedIds: number[] } {
  let memories: MemoryEntry[] = [];
  try {
    memories = listMemories({ workspaceRoot, limit });
  } catch {
    return { text: '', usedIds: [] };
  }
  if (memories.length === 0) return { text: '', usedIds: [] };

  const label: Record<MemoryKind, string> = { lesson: 'Lesson', preference: 'User preference', fact: 'Fact' };
  const lines = memories.map((m) => `- [${label[m.kind]}] ${m.content}`);
  const header =
    'MEMORY (from previous work — apply it, do not relearn it):\n' +
    'Lessons describe things that already failed once. Avoid repeating those failures.';
  return { text: `${header}\n${lines.join('\n')}`, usedIds: memories.map((m) => m.id) };
}

/** Bounds growth: keeps the newest `keep` memories, drops stale remainder. */
export function pruneMemories(keep = 200): number {
  const database = requireDb();
  const result = database
    .prepare(
      'DELETE FROM agent_memories WHERE id NOT IN (SELECT id FROM agent_memories ORDER BY last_used_at DESC, id DESC LIMIT ?)'
    )
    .run(Math.min(Math.max(keep, 10), 1000));
  return result.changes;
}

function rowToEntry(row: any): MemoryEntry {
  return {
    id: Number(row.id),
    kind: row.kind,
    content: row.content,
    workspaceRoot: row.workspace_root ?? null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  };
}
