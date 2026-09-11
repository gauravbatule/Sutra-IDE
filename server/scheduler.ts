import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { createPacket, parsePacket, WSChannel } from './wsProtocol.js';

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  schedule: 'once' | 'hourly' | 'daily' | 'weekly';
  runAt: string | null;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  lastResult: string | null;
}

let db: Database.Database;
let timer: ReturnType<typeof setInterval> | null = null;
let executing = false;

export function initScheduler(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduler_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT 'once',
      run_at TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER,
      last_run_at INTEGER,
      last_result TEXT
    )
  `);
}

export function listTasks(): ScheduledTask[] {
  const rows = db.prepare('SELECT * FROM scheduler_tasks ORDER BY created_at DESC').all() as any[];
  return rows.map(rowToTask);
}

export function getTask(id: string): ScheduledTask | null {
  const row = db.prepare('SELECT * FROM scheduler_tasks WHERE id = ?').get(id) as any;
  return row ? rowToTask(row) : null;
}

export function createTask(input: { title: string; prompt: string; schedule: string; runAt?: string | null }): ScheduledTask {
  const id = `task-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const schedule = ['once', 'hourly', 'daily', 'weekly'].includes(input.schedule) ? input.schedule : 'once';
  db.prepare(
    'INSERT INTO scheduler_tasks (id, title, prompt, schedule, run_at, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  ).run(id, input.title.slice(0, 200), input.prompt, schedule, input.runAt || null, Date.now());
  return getTask(id)!;
}

export function updateTask(id: string, patch: { enabled?: boolean; prompt?: string; schedule?: string; runAt?: string | null; title?: string }): ScheduledTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  db.prepare(
    'UPDATE scheduler_tasks SET title = ?, prompt = ?, schedule = ?, run_at = ?, enabled = ? WHERE id = ?'
  ).run(
    patch.title !== undefined ? patch.title.slice(0, 200) : existing.title,
    patch.prompt !== undefined ? patch.prompt : existing.prompt,
    patch.schedule !== undefined && ['once', 'hourly', 'daily', 'weekly'].includes(patch.schedule) ? patch.schedule : existing.schedule,
    patch.runAt !== undefined ? patch.runAt : existing.runAt,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
    id
  );
  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const info = db.prepare('DELETE FROM scheduler_tasks WHERE id = ?').run(id);
  return info.changes > 0;
}

function rowToTask(row: any): ScheduledTask {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    schedule: row.schedule,
    runAt: row.run_at,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
  };
}

/** Next due timestamp (ms) for a task relative to its last run. */
function nextDueMs(task: ScheduledTask): number | null {
  const base = task.lastRunAt ?? task.createdAt;
  switch (task.schedule) {
    case 'hourly':
      return base + 60 * 60 * 1000;
    case 'daily':
      return base + 24 * 60 * 60 * 1000;
    case 'weekly':
      return base + 7 * 24 * 60 * 60 * 1000;
    case 'once': {
      if (!task.runAt) return task.lastRunAt ? null : base; // No time given -> due immediately, once
      const at = new Date(task.runAt).getTime();
      return Number.isFinite(at) ? at : null;
    }
    default:
      return null;
  }
}

/**
 * Runs one task by opening a loopback WebSocket to this server's /ws endpoint
 * and sending a normal prompt packet — the full agent pipeline (harness, tools,
 * approvals-free autonomous mode) executes exactly as an interactive run.
 * Resolves with the accumulated assistant text (truncated).
 */
function runTaskViaLoopback(prompt: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    let settled = false;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closed */ }
      resolve(result);
    };
    const guard = setTimeout(() => finish(text.slice(0, 2000) || '(no output — run timed out)'), 10 * 60 * 1000);
    ws.on('open', () => {
      ws.send(createPacket(WSChannel.AGENT_STREAM, 'prompt', {
        message: prompt,
        model: 'auto',
        isScheduledRun: true,
      }));
    });
    ws.on('message', (raw) => {
      const packet = parsePacket(String(raw));
      if (!packet || packet.channel !== WSChannel.AGENT_STREAM) return;
      const payload: any = packet.payload;
      if (packet.type === 'chunk') {
        if (typeof payload?.delta === 'string') text += payload.delta;
        if (payload?.done) {
          clearTimeout(guard);
          finish(text.slice(0, 2000) || '(run completed with no text output)');
        }
      }
      if (packet.type === 'approval_request') {
        // Scheduled runs execute autonomously — auto-approve tool work.
        ws.send(createPacket(WSChannel.AGENT_STREAM, 'approval', { id: payload?.id, approved: true }));
      }
    });
    ws.on('error', () => {
      clearTimeout(guard);
      finish(text.slice(0, 2000) || '(scheduler run failed — server socket error)');
    });
    ws.on('close', () => {
      clearTimeout(guard);
      finish(text.slice(0, 2000) || '(run ended)');
    });
  });
}

/** Runs a task immediately (Run-now button) and persists the result. */
export async function runTaskViaLoopbackForTask(task: ScheduledTask, port: number = 3001): Promise<string> {
  db.prepare('UPDATE scheduler_tasks SET last_run_at = ?, last_result = ? WHERE id = ?').run(Date.now(), 'Running…', task.id);
  const result = await runTaskViaLoopback(task.prompt, port);
  db.prepare('UPDATE scheduler_tasks SET last_run_at = ?, last_result = ? WHERE id = ?').run(Date.now(), result, task.id);
  return result;
}

/** Starts the 30s due-check loop. `port` is the HTTP port for loopback runs. */
export function startScheduler(port: number): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (executing) return;
    const now = Date.now();
    const due = listTasks().find((t) => {
      if (!t.enabled) return false;
      const dueMs = nextDueMs(t);
      return dueMs !== null && dueMs <= now;
    });
    if (!due) return;
    executing = true;
    try {
      db.prepare('UPDATE scheduler_tasks SET last_run_at = ?, last_result = ? WHERE id = ?')
        .run(Date.now(), 'Running…', due.id);
      const result = await runTaskViaLoopback(due.prompt, port);
      db.prepare('UPDATE scheduler_tasks SET last_run_at = ?, last_result = ? WHERE id = ?')
        .run(Date.now(), result, due.id);
    } catch (err: any) {
      db.prepare('UPDATE scheduler_tasks SET last_run_at = ?, last_result = ? WHERE id = ?')
        .run(Date.now(), `Run failed: ${err?.message || 'unknown error'}`, due.id);
    } finally {
      executing = false;
    }
  }, 30 * 1000);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
