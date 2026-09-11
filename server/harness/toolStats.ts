/**
 * SUTRA Studio — Tool Reliability Stats
 *
 * Durable per-tool success/failure counts accumulated across every run. The
 * prompt builder turns these into a short reliability briefing so Astra favors
 * tools that actually work in this environment and approaches historically
 * flaky ones with a fallback ready.
 */
import type Database from 'better-sqlite3';

export interface ToolStat {
  tool: string;
  ok: number;
  fail: number;
  lastUsedAt: number;
}

let db: Database.Database | null = null;

export function initToolStats(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_stats (
      tool TEXT PRIMARY KEY,
      ok INTEGER NOT NULL DEFAULT 0,
      fail INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER NOT NULL
    );
  `);
}

function requireDb(): Database.Database {
  if (!db) throw new Error('toolStats not initialized — call initToolStats first');
  return db;
}

export function recordToolOutcome(tool: string, ok: boolean): void {
  const database = requireDb();
  const name = String(tool || '').trim().slice(0, 80);
  if (!name) return;
  database
    .prepare(
      `INSERT INTO tool_stats (tool, ok, fail, last_used_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tool) DO UPDATE SET
         ok = ok + excluded.ok,
         fail = fail + excluded.fail,
         last_used_at = excluded.last_used_at`
    )
    .run(name, ok ? 1 : 0, ok ? 0 : 1, Date.now());
}

export function listToolStats(limit = 20): ToolStat[] {
  const database = requireDb();
  const rows = database
    .prepare('SELECT * FROM tool_stats ORDER BY (ok + fail) DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 100)) as any[];
  return rows.map((r) => ({
    tool: r.tool,
    ok: r.ok,
    fail: r.fail,
    lastUsedAt: r.last_used_at,
  }));
}

/** Minimum attempts before a tool's rate is worth telling the model about. */
const MIN_ATTEMPTS_FOR_RATE = 3;

/**
 * Compact prompt section summarizing observed tool reliability. Tools with too
 * few attempts are omitted; only the weakest tools get an explicit warning so
 * the section stays a few lines at most.
 */
export function buildToolStatsSection(): string {
  let stats: ToolStat[];
  try {
    stats = listToolStats();
  } catch {
    return '';
  }
  if (stats.length === 0) return '';

  const lines: string[] = [];
  for (const s of stats) {
    const total = s.ok + s.fail;
    if (total < MIN_ATTEMPTS_FOR_RATE) continue;
    const rate = Math.round((s.ok / total) * 100);
    if (rate < 70) {
      lines.push(`- ${s.tool}: ${rate}% success over ${total} uses — expect friction, have a fallback ready.`);
    }
  }
  if (lines.length === 0) return '';

  return [
    'TOOL RELIABILITY (observed across past runs in this environment):',
    ...lines,
    'Prefer reliable alternatives when practical; retry differently rather than identically.',
  ].join('\n');
}
