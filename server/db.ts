import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveDatabasePath(): string {
  if (process.env.SUTRA_DB_PATH) {
    return path.resolve(process.env.SUTRA_DB_PATH);
  }
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    const testDbDir = path.join(os.tmpdir(), 'sutra-test');
    if (!fs.existsSync(testDbDir)) {
      try { fs.mkdirSync(testDbDir, { recursive: true }); } catch {}
    }
    return path.join(testDbDir, `sutra-test-${process.pid}.db`);
  }
  const localDb = path.join(__dirname, '..', 'sutra.db');
  if (fs.existsSync(localDb) || process.env.NODE_ENV !== 'production') {
    return localDb;
  }
  const appData = process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.local', 'share'));
  const targetDir = path.join(appData, 'sutra-ide');
  if (!fs.existsSync(targetDir)) {
    try { fs.mkdirSync(targetDir, { recursive: true }); } catch {}
  }
  return path.join(targetDir, 'sutra.db');
}

const dbPath = resolveDatabasePath();
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  try { fs.mkdirSync(dbDir, { recursive: true }); } catch {}
}
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');

const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT,
      oauth_provider TEXT,
      oauth_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT,
      cookie_data TEXT,
      auth_type TEXT DEFAULT 'api-key',
      base_url TEXT,
      headers TEXT,
      status TEXT DEFAULT 'Not connected',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      capabilities TEXT, -- JSON array
      context_length INTEGER,
      pricing TEXT, -- JSON
      status TEXT DEFAULT 'Available',
      FOREIGN KEY(provider_id) REFERENCES providers(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      active_project_id TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(active_project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      type TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      prompt TEXT,
      source TEXT,
      parent_asset_id TEXT,
      version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS custom_models (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL, -- 'image' | 'video' | 'audio' | 'llm'
      name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      description TEXT NOT NULL,
      config TEXT, -- JSON
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'stdio', -- 'stdio' | 'sse' | 'http'
      command TEXT,
      args TEXT, -- JSON array
      env TEXT, -- JSON object
      url TEXT,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
  `);

  // Safe migration for existing SQLite database files — each column may already
  // exist in an older database, in which case the ALTER fails and is safely ignored.
  try {
    db.exec(`
      ALTER TABLE providers ADD COLUMN cookie_data TEXT;
    `);
  } catch {
    // Column already exists — nothing to migrate.
  }
  try {
    db.exec(`
      ALTER TABLE providers ADD COLUMN auth_type TEXT DEFAULT 'api-key';
    `);
  } catch {
    // Column already exists — nothing to migrate.
  }
  try {
    db.exec(`
      ALTER TABLE providers ADD COLUMN headers TEXT;
    `);
  } catch {
    // Column already exists — nothing to migrate.
  }
  try {
    db.exec(`
      ALTER TABLE chat_sessions ADD COLUMN workspace TEXT;
    `);
  } catch {
    // Column already exists — nothing to migrate.
  }
  try {
    db.exec(`
      ALTER TABLE chat_sessions ADD COLUMN workspace_name TEXT;
    `);
  } catch {
    // Column already exists — nothing to migrate.
  }
};

// Initialize DB schema
initDb();

export default db;
