/**
 * SUTRA Studio — Durable Code Notes
 *
 * Compact per-file facts Astra learns while reading code. Notes live in SQLite
 * (not in the conversation) so a file read ONCE never needs a full re-read in
 * later runs: relevant notes are injected into the system prompt as a short
 * recall section, keeping context small while preserving knowledge.
 */
import type Database from 'better-sqlite3';

export interface CodeNote {
  filePath: string;
  note: string;
  updatedAt: number;
  useCount: number;
}

let db: Database.Database | null = null;

export function initCodeNotes(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_notes (
      file_path TEXT PRIMARY KEY,
      note TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function requireDb(): Database.Database {
  if (!db) throw new Error('codeNotes not initialized — call initCodeNotes first');
  return db;
}

const MAX_NOTE_CHARS = 400;

export function saveCodeNote(filePath: string, note: string): boolean {
  const database = requireDb();
  const p = String(filePath || '').trim().replace(/\\/g, '/').slice(0, 300);
  const n = String(note || '').trim().slice(0, MAX_NOTE_CHARS);
  if (!p || !n) return false;
  const now = Date.now();
  try {
    database
      .prepare(
        `INSERT INTO code_notes (file_path, note, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           note = excluded.note,
           updated_at = excluded.updated_at`
      )
      .run(p, n, now, now);
    return true;
  } catch {
    return false;
  }
}

export function deleteCodeNote(filePath: string): boolean {
  const database = requireDb();
  try {
    const info = database.prepare('DELETE FROM code_notes WHERE file_path = ?').run(String(filePath || '').trim());
    return info.changes > 0;
  } catch {
    return false;
  }
}

export function listCodeNotes(limit = 200): CodeNote[] {
  const database = requireDb();
  const rows = database
    .prepare('SELECT file_path, note, updated_at, use_count FROM code_notes ORDER BY updated_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as any[];
  return rows.map((r) => ({
    filePath: r.file_path,
    note: r.note,
    updatedAt: r.updated_at,
    useCount: r.use_count,
  }));
}

/** Mark notes for files touched this run so useful ones rank higher over time. */
export function touchCodeNotes(paths: string[]): void {
  const database = requireDb();
  const clean = (paths || [])
    .map((p) => String(p || '').trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .slice(0, 100);
  if (clean.length === 0) return;
  try {
    const stmt = database.prepare('UPDATE code_notes SET use_count = use_count + 1 WHERE file_path = ?');
    for (const p of new Set(clean)) stmt.run(p);
  } catch {
    // Recall ranking is best-effort
  }
}

const MAX_SECTION_NOTES = 30;

/**
 * Recall section for the system prompt: notes for explicitly hinted files first
 * (active tab / user-mentioned paths), then most recent. Hard caps keep the
 * prompt contribution small no matter how large the note store grows.
 */
export function buildCodeNotesSection(hints?: { priorityPaths?: string[] }): string {
  let notes: CodeNote[];
  try {
    notes = listCodeNotes(200);
  } catch {
    return '';
  }
  if (notes.length === 0) return '';

  const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const priority = new Set((hints?.priorityPaths || []).map(normalize).filter(Boolean));
  const byPath = new Map(notes.map((n) => [normalize(n.filePath), n]));

  const ordered: CodeNote[] = [];
  for (const p of priority) {
    const hit = byPath.get(p);
    if (hit && !ordered.includes(hit)) ordered.push(hit);
  }
  for (const n of notes) {
    if (ordered.length >= MAX_SECTION_NOTES) break;
    if (!ordered.includes(n)) ordered.push(n);
  }

  const lines = ordered.slice(0, MAX_SECTION_NOTES).map((n) => `- ${n.filePath}: ${n.note}`);
  if (lines.length === 0) return '';

  return [
    'CODE NOTES (facts you recorded about these files in earlier sessions — trust them instead of re-reading whole files):',
    ...lines,
  ].join('\n');
}
