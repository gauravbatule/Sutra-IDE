/**
 * SUTRA Studio — Run & Event Log
 *
 * Durable audit trail for agent runs: one row per run, structured lifecycle
 * events per run. This is the foundation the memory and failure-intelligence
 * layers read from — nothing here interprets, everything here persists.
 */
import type Database from 'better-sqlite3';

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunRecord {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  status: AgentRunStatus;
  workspaceRoot: string;
  modelId: string | null;
  permissionMode: string;
  promptPreview: string;
  filesMutated: number;
  /** null when no verification stage ran (no mutations, or aborted before it). */
  verificationPassed: boolean | null;
}

export interface RunEventRecord {
  id: number;
  runId: string;
  at: number;
  type: string;
  payload: unknown;
}

let db: Database.Database | null = null;

export function initRunLog(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      workspace_root TEXT NOT NULL,
      model_id TEXT,
      permission_mode TEXT NOT NULL,
      prompt_preview TEXT NOT NULL DEFAULT '',
      files_mutated INTEGER NOT NULL DEFAULT 0,
      verification_passed INTEGER
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      FOREIGN KEY(run_id) REFERENCES agent_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);
  `);
}

function requireDb(): Database.Database {
  if (!db) throw new Error('runLog not initialized — call initRunLog first');
  return db;
}

export function startRun(input: {
  workspaceRoot: string;
  modelId?: string | null;
  permissionMode: string;
  promptPreview: string;
}): string {
  const database = requireDb();
  const id = `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  database
    .prepare(
      `INSERT INTO agent_runs (id, started_at, status, workspace_root, model_id, permission_mode, prompt_preview)
       VALUES (?, ?, 'running', ?, ?, ?, ?)`
    )
    .run(id, Date.now(), input.workspaceRoot, input.modelId ?? null, input.permissionMode, input.promptPreview.slice(0, 200));
  recordEvent(id, 'RunStarted', { modelId: input.modelId ?? null, permissionMode: input.permissionMode });
  return id;
}

export function recordEvent(runId: string, type: string, payload?: unknown): void {
  const database = requireDb();
  let payloadJson: string | null = null;
  if (payload !== undefined) {
    try {
      payloadJson = JSON.stringify(payload).slice(0, 8000);
    } catch {
      payloadJson = null; // Unserializable payloads degrade to a typed marker event
    }
  }
  database.prepare('INSERT INTO run_events (run_id, at, type, payload) VALUES (?, ?, ?, ?)').run(runId, Date.now(), type, payloadJson);
}

export function finishRun(
  runId: string,
  status: Exclude<AgentRunStatus, 'running'>,
  data?: { filesMutated?: number; verificationPassed?: boolean | null }
): void {
  const database = requireDb();
  // Only a concrete boolean patches the column — undefined AND null both mean
  // "no verification stage ran" and must leave any existing value untouched.
  const verificationPatch =
    data?.verificationPassed === true || data?.verificationPassed === false
      ? Number(data.verificationPassed)
      : null;
  const result = database
    .prepare(
      `UPDATE agent_runs
       SET finished_at = ?, status = ?,
           files_mutated = COALESCE(?, files_mutated),
           verification_passed = COALESCE(?, verification_passed)
       WHERE id = ? AND status = 'running'`
    )
    .run(Date.now(), status, data?.filesMutated ?? null, verificationPatch, runId);
  // Only the first finish transitions the row — later calls must not emit events.
  if (result.changes > 0) {
    recordEvent(runId, 'RunEnded', { status });
  }
}

export function listRuns(limit = 50): AgentRunRecord[] {
  const database = requireDb();
  const rows = database
    // rowid breaks same-millisecond ties so ordering is deterministic.
    .prepare('SELECT * FROM agent_runs ORDER BY started_at DESC, rowid DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 200)) as any[];
  return rows.map(rowToRecord);
}

export function getRunDetail(runId: string): { run: AgentRunRecord; events: RunEventRecord[] } | null {
  const database = requireDb();
  const row = database.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as any;
  if (!row) return null;
  const events = (
    database.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC').all(runId) as any[]
  ).map((e) => ({
    id: e.id,
    runId: e.run_id,
    at: e.at,
    type: e.type,
    payload: e.payload ? safeParse(e.payload) : null,
  }));
  return { run: rowToRecord(row), events };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToRecord(row: any): AgentRunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    status: row.status,
    workspaceRoot: row.workspace_root,
    modelId: row.model_id ?? null,
    permissionMode: row.permission_mode,
    promptPreview: row.prompt_preview,
    filesMutated: row.files_mutated,
    verificationPassed: row.verification_passed === null || row.verification_passed === undefined ? null : Boolean(row.verification_passed),
  };
}
