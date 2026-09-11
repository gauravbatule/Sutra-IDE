import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { execSync, execFileSync, spawn } from 'child_process';
import fs from 'fs';

import { modelRouter, learnedModelLimits } from './modelRouter.js';
import { agentSwarm } from './agentSwarm.js';
import { mediaEngine } from './mediaEngine.js';
import { fsTools } from './tools/fsTools.js';
import { ptyManager } from './ptyManager.js';
import { mobileBridge } from './mobileBridge.js';
import { GODLY_VAULT_PATTERNS } from './godlyVaultData.js';
import { CompletionEngine } from './completionEngine.js';
import { mcpClient } from './mcp/mcpClient.js';
import { customModelsManager } from './customModels.js';
import { gitCheckpoints } from './harness/gitCheckpoints.js';
import { selfHealingEngine } from './harness/selfHealing.js';
import { sutraHarness } from './harness/sutraHarness.js';
import { runWorkspaceVerification } from './harness/verification.js';
import { initRunLog, startRun, recordEvent, finishRun, listRuns, getRunDetail } from './harness/runLog.js';
import {
  initMemory,
  rememberMemory,
  forgetMemory,
  listMemories,
  touchMemories,
  pruneMemories,
  buildMemorySection,
} from './harness/memory.js';
import { initToolStats, recordToolOutcome, buildToolStatsSection } from './harness/toolStats.js';
import { StagnationDetector, shouldExtendRun } from './harness/stagnation.js';
import { WSChannel, createPacket, parsePacket } from './wsProtocol.js';
import { SecurityGuardrails } from './security/guardrails.js';
import { SUTRA_ALL_PROVIDERS } from './providers/catalog.js';
import { providerAuthHandler } from './providers/authHandler.js';
import { CodebaseIndexer } from './tools/codebaseIndexer.js';
import { gzipSync } from 'zlib';
import dotenv from 'dotenv';
import db from './db.js';
import { initScheduler, startScheduler, listTasks, getTask, createTask, updateTask, deleteTask, runTaskViaLoopbackForTask } from './scheduler.js';
import { initArtifacts, listArtifacts, getArtifact } from './artifacts.js';
import { processManager } from './processManager.js';
import { LSPManager } from './lsp/lspManager.js';
import { lspTools } from './tools/lspTools.js';

const completionEngine = new CompletionEngine(modelRouter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Initialize AST Codebase Indexer for Cursor-grade semantic symbol retrieval
const codebaseIndexer = new CodebaseIndexer(rootDir);
codebaseIndexer.buildIndex().then((res) => {
  console.log(`[Codebase Indexer] Indexed ${res.symbolCount} AST symbols across ${res.fileCount} files.`);
}).catch(() => undefined);

// Initialize LSP Manager for real-time language server diagnostics
const lspManager = new LSPManager(rootDir);
lspTools.setLSPManager(lspManager);
lspManager.initialize().then(() => {
  console.log('[LSP Manager] TypeScript language server initialized');
}).catch((err) => {
  console.warn('[LSP Manager] Failed to initialize:', err.message);
});

// Load environment variables
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config();

// Load stored API keys from SQLite into modelRouter
try {
  const storedProviders = db.prepare('SELECT id, api_key, base_url FROM providers').all() as any[];
  for (const prov of storedProviders) {
    if (prov.api_key) {
      modelRouter.setApiKey(prov.id, prov.api_key);
    }
  }
} catch {
  // DB might not be initialized yet
}

// One-time migration: a ChatGPT cookie jar pasted into the OpenAI slot (with no
// API key) belongs to the ChatGPT Web session provider — move the richer jar
// there so Luna routes instead of failing against api.openai.com.
try {
  const openaiRow = db.prepare("SELECT api_key, cookie_data FROM providers WHERE id = 'openai'").get() as any;
  const cwRow = db.prepare("SELECT cookie_data FROM providers WHERE id = 'chatgpt-web'").get() as any;
  const openaiCookie = (openaiRow?.cookie_data || '').trim();
  const cwCookie = (cwRow?.cookie_data || '').trim();
  if (openaiCookie && !openaiRow?.api_key && openaiCookie.length > cwCookie.length) {
    db.prepare("UPDATE providers SET cookie_data = ? WHERE id = 'chatgpt-web'").run(openaiCookie);
    db.prepare("UPDATE providers SET cookie_data = NULL WHERE id = 'openai'").run();
    console.log('[SUTRA] Moved the ChatGPT cookie jar from the OpenAI slot to the ChatGPT Web session provider.');
  }
} catch {
  // Migration is best-effort — providers keep working as saved
}

const app = express();
const server = http.createServer(app);
// The WebSocket gateway drives the PTY and the agent tool loop, so an unvalidated
// upgrade is the same as an unauthenticated shell. Reject cross-origin upgrades using
// the same allowlist as CORS (isAllowedOrigin is hoisted; it runs per-connection).
const wss = new WebSocketServer({
  server,
  verifyClient: ({ origin }, done) => {
    if (isAllowedOrigin(origin)) {
      done(true);
    } else {
      console.warn(`[WS] Rejected upgrade from disallowed origin: ${origin}`);
      done(false, 403, 'Forbidden origin');
    }
  },
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
mobileBridge.setPort(PORT);
const SERVER_STARTED_AT = Date.now();
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8').toString() || '{"version":"0.0.0"}');

const SESSION_COOKIE = 'sutra_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PUBLIC_API_PATHS = new Set([
  '/health',
  '/api/version',
  '/api/auth/signup',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/setup/status',
  '/api/setup/providers',
  '/api/providers/catalog',
  '/api/mobile/pairing-qr',
]);

function parseBearerToken(req: express.Request): string | null {
  const authorization = req.headers.authorization;
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] || null;
}

function parseCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE && value.length > 0) return decodeURIComponent(value.join('='));
  }
  return null;
}

function getSessionToken(req: express.Request): string | null {
  return parseBearerToken(req) || parseCookieHeader(req.headers.cookie);
}

function findValidSession(token: string | null): { userId: string } | null {
  if (!token) return null;
  const session = db
    .prepare('SELECT user_id as userId FROM sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP')
    .get(token) as { userId: string } | undefined;
  return session || null;
}

function setSessionCookie(res: express.Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

// [Improvement A3] Security headers — inline Helmet-style baseline
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  next();
});

// [Improvement A2] Response compression (inline gzip for text/* responses)
app.use((req, res, next) => {
  const oldSend = res.send.bind(res);
  res.send = (body) => {
    const acceptEnc = req.headers['accept-encoding'] || '';
    if (typeof body === 'string' && acceptEnc.includes('gzip')) {
      res.setHeader('Content-Encoding', 'gzip');
      return oldSend(gzipSync(Buffer.from(body, 'utf-8')));
    }
    return oldSend(body);
  };
  next();
});

// [Improvement A9] CORS origin whitelist (env-var configurable).
// The server exposes filesystem + shell tools, so a permissive policy would let any
// visited web page drive the IDE. Unknown origins are rejected, not waved through.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3001')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export function isAllowedOrigin(origin: string | undefined): boolean {
  // No Origin header: same-origin navigation, curl, or a native client — allowed.
  if (!origin) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  // Loopback and RFC1918 LAN hosts are trusted so the mobile bridge keeps working.
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: origin "${origin}" is not allowed. Add it to CORS_ORIGINS to permit it.`));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));

// [Improvement A1] Request ID + timing logger middleware
app.use((req, res, next) => {
  const reqId = crypto.randomUUID().slice(0, 10);
  const startedAt = Date.now();
  (req as any).reqId = reqId;
  res.setHeader('X-Request-ID', reqId);
  res.once('finish', () => {
    const ms = Date.now() - startedAt;
    const size = res.getHeader('content-length') || 0;
    if (!req.path.startsWith('/assets') && !req.path.startsWith('/ws')) {
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method} ${req.path} → ${res.statusCode} ${ms}ms ${size}B (${reqId})`);
    }
  });
  next();
});

// [Improvement A10] In-memory per-IP rate limiter (token bucket, generous 180/min default for REST)
const rateBuckets: Map<string, { tokens: number; last: number }> = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of Array.from(rateBuckets.entries())) {
    if (now - b.last > 120_000) rateBuckets.delete(ip);
  }
}, 60_000).unref();
app.use((req, res, next) => {
  // Key on the actual socket address — x-forwarded-for is client-spoofable.
  const ip = (req.socket.remoteAddress || 'local').toString().split(',')[0].trim();
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b) b = { tokens: 180, last: now };
  const refill = Math.floor((now - b.last) / 1000) * 3; // 3 tokens/sec
  if (refill > 0) {
    b.tokens = Math.min(180, b.tokens + refill);
    b.last = now;
  }
  if (b.tokens <= 0) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too Many Requests — slow down' });
  }
  b.tokens -= 1;
  rateBuckets.set(ip, b);
  next();
});

// [Improvement A7] Unified async error wrapper middleware
const safeHandler = (fn: (req: express.Request, res: express.Response) => any) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[API Error]', req.method, req.path, err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
    next(err);
  });
};

// [Auth] API authentication gate. The desktop app always connects from loopback,
// so local usage stays frictionless; remote clients (LAN/mobile browsers hitting
// REST directly) must present a valid session token (cookie or Bearer).
function isLocalRequest(req: express.Request): boolean {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr === 'localhost';
}

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  if (isLocalRequest(req)) return next();
  const session = findValidSession(getSessionToken(req));
  if (!session) {
    return res.status(401).json({ error: 'Authentication required — sign in or connect from this machine.' });
  }
  (req as any).userId = session.userId;
  next();
});

// Hourly purge of expired session rows so the table does not grow unbounded.
setInterval(() => {
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP').run();
  } catch {
    // Purge is best-effort housekeeping — expired rows are simply skipped this cycle
  }
}, 60 * 60 * 1000).unref();

// [Improvement A4] Healthcheck endpoint
app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  let gitBranch = 'unknown';
  let dbTables: any[] = [];
  try { gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf-8', timeout: 1000 }).trim(); } catch { /* not a git repo — keep 'unknown' */ }
  try { dbTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]; } catch { /* DB unreadable — report an empty table list */ }
  res.json({
    status: 'ok',
    uptimeS: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
    memoryMB: {
      rss: Math.floor(mem.rss / 1048576),
      heapUsed: Math.floor(mem.heapUsed / 1048576),
      heapTotal: Math.floor(mem.heapTotal / 1048576),
    },
    pid: process.pid,
    nodeVersion: process.version,
    gitBranch,
    providerCount: dbTables.length,
    workspace: fsTools.getWorkspaceRoot(),
  });
});

// [Improvement A5] Version endpoint (package.json info)
app.get('/api/version', (_req, res) => {
  res.json({
    name: pkg.name || 'sutra-studio',
    version: pkg.version || '0.0.0',
    description: pkg.description || '',
    buildTime: new Date().toISOString(),
    supportedModels: modelRouter.getActiveModel(),
  });
});

// Set workspace root for all tools
fsTools.setWorkspaceRoot(rootDir);
ptyManager.setWorkspaceRoot(rootDir);
mediaEngine.setProjectRoot(rootDir);

// Scheduled tasks + trackable work artifacts + run/event audit log (persist across restarts)
initScheduler(db);
initArtifacts(rootDir);
initRunLog(db);
initMemory(db);
initToolStats(db);

// Session hygiene: drop stale empty sessions (created but never messaged)
try {
  db.prepare(`DELETE FROM chat_sessions WHERE updated_at < datetime('now', '-1 hour') AND id NOT IN (SELECT DISTINCT session_id FROM chat_messages)`).run();
} catch {
  // Fresh database — nothing to purge yet
}

// Serve static assets and media files with proper MIME and partial content support
app.use('/assets', express.static(path.join(rootDir, 'public', 'assets'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
    } else if (filePath.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
      res.setHeader('Accept-Ranges', 'bytes');
    } else if (filePath.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
    }
  },
}));
app.use('/assets', express.static(path.join(rootDir, 'dist', 'assets')));
app.use('/public', express.static(path.join(rootDir, 'public')));
// Generated sites reference /css and /js absolutely — serve them from the
// workspace public dir alongside /assets so /workspace/<site> renders fully.
app.use('/css', express.static(path.join(rootDir, 'public', 'css')));
app.use('/js', express.static(path.join(rootDir, 'public', 'js')));
app.use(express.static(path.join(rootDir, 'dist')));

/* ----------------------------------------------------
 * REST API ENDPOINTS
 * ---------------------------------------------------- */

// 0. Auth & Session Management
// scrypt with a random salt; legacy sha-256 hashes are still verified transparently on login.
const SCRYPT_KEYLEN = 64;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string | undefined | null): boolean {
  if (!storedHash) return false;
  if (storedHash.startsWith('scrypt:')) {
    const [, salt, digest] = storedHash.split(':');
    if (!salt || !digest) return false;
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(digest, 'hex');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }
  // Legacy unsalted sha-256 (pre-upgrade accounts)
  return crypto.createHash('sha256').update(password).digest('hex') === storedHash;
}

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  
  try {
    const userId = uuidv4();
    const hash = hashPassword(password);
    
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(userId, name, email, hash);
    
    // Create default workspace
    const workspaceId = uuidv4();
    db.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?, ?, ?)').run(workspaceId, userId, 'Personal Workspace');
    
    // Create session
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7 days
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), userId, token, expiresAt);
    
    setSessionCookie(res, token);
    res.json({ success: true, user: { id: userId, name, email } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), user.id, token, expiresAt);
    
    setSessionCookie(res, token);
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  
  try {
    const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP').get(token) as any;
    if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
    
    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(session.user_id) as any;
    const workspaces = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').all(user.id);
    
    res.json({ user, workspaces });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.json({ success: true });
  const token = authHeader.split(' ')[1];
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ success: true });
});

// 1. Setup & Onboarding
// Setup gate: the IDE is usable once at least one provider row carries a real
// credential (API key or session cookie). Never throws on a fresh database —
// an unreadable table simply reports "no credential yet".
app.get('/api/setup/status', (_req, res) => {
  try {
    const rows = db.prepare('SELECT api_key, cookie_data FROM providers').all() as Array<{ api_key?: string | null; cookie_data?: string | null }>;
    const hasCredential = rows.some(
      (row) => Boolean((row.api_key && String(row.api_key).trim()) || (row.cookie_data && String(row.cookie_data).trim()))
    );
    res.json({ hasCredential, providerCount: rows.length, isSetupComplete: hasCredential });
  } catch {
    // Fresh or locked DB — fail safe with "not set up" rather than a 500.
    res.json({ hasCredential: false, providerCount: 0, isSetupComplete: false });
  }
});

app.post('/api/setup/providers', (req, res) => {
  const { providers } = req.body;
  if (!providers || !Array.isArray(providers)) {
    return res.status(400).json({ error: 'Expected an array of providers' });
  }

  const insert = db.prepare(`
    INSERT INTO providers (id, name, api_key, base_url, status, updated_at) 
    VALUES (@id, @name, @api_key, @base_url, @status, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET 
      api_key=excluded.api_key,
      base_url=excluded.base_url,
      status=excluded.status,
      updated_at=CURRENT_TIMESTAMP
  `);

  const tx = db.transaction((provs) => {
    for (const p of provs) {
      insert.run(p);
      // Set to modelRouter memory for backward compatibility for now
      modelRouter.setApiKey(p.id, p.api_key);
    }
  });

  try {
    tx(providers);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/setup/test-provider', async (req, res) => {
  const { providerId, apiKey, baseUrl } = req.body;
  if (!providerId || typeof providerId !== 'string') {
    return res.status(400).json({ success: false, error: 'providerId is required' });
  }

  // Snapshot the previously saved credential so a failed test never wipes a working setup.
  const previousCredential = providerAuthHandler.getAllCredentials()[providerId];
  try {
    const previousAuthType = ['api-key', 'cookie', 'oauth', 'local'].includes(previousCredential?.auth_type)
      ? previousCredential.auth_type
      : 'api-key';
    providerAuthHandler.saveCredential({
      providerId,
      authType: (apiKey && String(apiKey).trim()) ? 'api-key' : (previousAuthType as any),
      apiKey,
      cookieData: previousCredential?.cookie_data,
      baseUrl: baseUrl || previousCredential?.base_url,
    });
    if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
      modelRouter.setApiKey(providerId, apiKey.trim());
    }

    // Route through the unified tester — it handles every provider auth type.
    const result = await providerAuthHandler.testProviderAuth(providerId);
    if (!result.ok) throw new Error(result.error || 'Connection failed');

    res.json({ success: true });
  } catch (err: any) {
    // Restore the prior credential (or remove the row entirely for first-time tests)
    try {
      if (previousCredential) {
        providerAuthHandler.saveCredential({
          providerId,
          authType: previousCredential.auth_type as any,
          apiKey: previousCredential.api_key,
          cookieData: previousCredential.cookie_data,
          baseUrl: previousCredential.base_url,
        });
        if (previousCredential.api_key) {
          modelRouter.setApiKey(providerId, previousCredential.api_key);
        }
      } else {
        db.prepare('DELETE FROM providers WHERE id = ?').run(providerId);
      }
    } catch {
      // Rollback of stale credentials failed — the error response below still reports the failure
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

// 1. modelRouter Models & Custom Provider Registration
app.get('/api/models', (_req, res) => {
  res.json({
    activeModel: modelRouter.getActiveModel(),
    models: modelRouter.getAllModels(),
    customProviders: modelRouter.getCustomProviders(),
    configuredKeys: modelRouter.getAllApiKeys(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    keys: modelRouter.getAllApiKeysRaw ? modelRouter.getAllApiKeysRaw() : {},
    configuredKeys: modelRouter.getAllApiKeys(),
    activeModel: modelRouter.getActiveModel(),
  });
});

app.post('/api/config', (req, res) => {
  const keys = req.body?.keys || {};
  for (const [provider, key] of Object.entries(keys)) {
    if (typeof key === 'string' && key.trim()) {
      modelRouter.setApiKey(provider, key.trim());
      if (provider === 'omniroute') {
        mediaEngine.setOmniRouteApiKey(key.trim());
      }
      try {
        db.prepare('INSERT OR REPLACE INTO providers (id, name, api_key, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(
          provider,
          provider.toUpperCase(),
          key.trim()
        );
      } catch {
        // Persistence failed — the in-memory key set above still takes effect
      }
    }
  }
  res.json({ success: true, configuredKeys: modelRouter.getAllApiKeys() });
});

app.post('/api/models/keys', (req, res) => {
  const keys = req.body?.keys;
  if (!keys || typeof keys !== 'object') {
    return res.status(400).json({ success: false, error: 'Expected a keys object' });
  }
  for (const [provider, key] of Object.entries(keys)) {
    if (typeof key === 'string' && key.trim()) {
      modelRouter.setApiKey(provider, key.trim());
      if (provider === 'omniroute') {
        mediaEngine.setOmniRouteApiKey(key.trim());
      }
      try {
        db.prepare('INSERT OR REPLACE INTO providers (id, name, api_key, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(
          provider,
          provider.toUpperCase(),
          key.trim()
        );
      } catch {
        // Persistence failed — the in-memory key set above still takes effect
      }
    }
  }
  res.json({ success: true, configuredKeys: modelRouter.getAllApiKeys() });
});

app.post('/api/models/select', (req, res) => {
  const { modelId } = req.body;
  const ok = modelRouter.setActiveModel(modelId);
  res.json({ success: ok, activeModel: modelRouter.getActiveModel() });
});

app.post('/api/models/custom', (req, res) => {
  const { id, name, provider, baseUrl, apiKey, supportsVision, supportsTools, contextWindow } = req.body;
  if (!id || !name) {
    return res.status(400).json({ success: false, error: 'id and name are required' });
  }

  const modelDef = {
    id,
    name,
    provider: (provider || 'custom') as any,
    contextWindow: contextWindow || 128000,
    supportsVision: Boolean(supportsVision),
    supportsTools: supportsTools !== false,
    costPer1kTokens: { input: 0, output: 0 },
    description: `Custom model via ${baseUrl || provider || 'direct endpoint'}`,
  };

  modelRouter.addCustomModel(modelDef);
  if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
    modelRouter.setApiKey(provider || id, apiKey.trim());
  }
  res.json({ success: true, model: modelDef });
});

app.post('/api/models/register-custom', (req, res) => {
  const result = modelRouter.registerCustomProvider(req.body);
  res.json(result);
});

app.post('/api/models/test-connection', safeHandler(async (req, res) => {
  const { providerId, modelId } = req.body;
  const result = await modelRouter.testProviderConnection(providerId, modelId);
  res.json(result);
}));

app.post('/api/models/scan-local', safeHandler(async (_req, res) => {
  const scanResults = await modelRouter.scanLocalProviders();
  res.json({ success: true, results: scanResults, allModels: modelRouter.getAllModels() });
}));

// Custom Models per Modality (Image, Video, Audio, LLM) with User Descriptions
app.get('/api/custom-models', (_req, res) => {
  res.json({ success: true, models: customModelsManager.getAllCustomModels() });
});

app.post('/api/custom-models', (req, res) => {
  const { id, category, name, providerId, modelId, description, config } = req.body;
  if (!name || !category || !modelId) {
    return res.status(400).json({ success: false, error: 'name, category, and modelId are required' });
  }
  const model = customModelsManager.registerCustomModel({
    id,
    category,
    name,
    providerId: providerId || 'custom',
    modelId,
    description: description || `Custom ${category} model`,
    config,
  });
  res.json({ success: true, model });
});

app.delete('/api/custom-models/:id', (req, res) => {
  const ok = customModelsManager.deleteCustomModel(req.params.id);
  res.json({ success: ok });
});

// Custom MCP Servers Management
app.get('/api/mcp/servers', (_req, res) => {
  res.json({
    success: true,
    servers: mcpClient.getServers(),
    tools: mcpClient.getRegisteredTools(),
  });
});

// MCP connection status for the composer pill: derived from the client's registered
// servers. Never throws — an uninitialized MCP client simply reports zero servers.
app.get('/api/mcp/status', (_req, res) => {
  try {
    const servers = mcpClient.getServers().map((s) => ({
      name: s.name,
      status: (s.enabled ? 'connected' : 'disabled') as 'connected' | 'disabled',
    }));
    res.json({ servers });
  } catch {
    res.json({ servers: [] });
  }
});

app.post('/api/mcp/servers', (req, res) => {
  const { id, name, transport, command, args, env, url, enabled } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  const serverId = id || `mcp-${Date.now()}`;
  mcpClient.registerCustomServer({
    id: serverId,
    name,
    transport: transport || 'stdio',
    command,
    args: Array.isArray(args) ? args : typeof args === 'string' ? args.split(' ').filter(Boolean) : [],
    env: typeof env === 'object' ? env : {},
    url,
    enabled: enabled !== false,
  });
  res.json({ success: true, server: { id: serverId, name, transport, command, url } });
});

app.delete('/api/mcp/servers/:id', (req, res) => {
  const ok = mcpClient.deleteCustomServer(req.params.id);
  res.json({ success: ok });
});

// Chat Sessions & History Persistence API
app.get('/api/chat/sessions', (_req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT s.*, COUNT(m.id) as message_count
      FROM chat_sessions s
      LEFT JOIN chat_messages m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).all();
    res.json({ success: true, sessions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/chat/sessions/:id', (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(req.params.id) as any;
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const rawMessages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(req.params.id) as any[];
    const messages = rawMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
      timestamp: m.timestamp,
    }));
    res.json({ success: true, session, messages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chat/sessions', (req, res) => {
  try {
    const { id, title } = req.body;
    const sessionId = id || `session-${Date.now()}`;
    const sessionTitle = title || 'New Autonomous Task';
    db.prepare('INSERT INTO chat_sessions (id, title, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP').run(sessionId, sessionTitle);
    res.json({ success: true, session: { id: sessionId, title: sessionTitle } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chat/sessions/:id/sync', (req, res) => {
  try {
    const sessionId = req.params.id;
    const { title, messages } = req.body;
    db.prepare('INSERT INTO chat_sessions (id, title, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET title = COALESCE(excluded.title, title), updated_at = CURRENT_TIMESTAMP').run(sessionId, title || 'Autonomous Mission');
    if (Array.isArray(messages)) {
      const insertMsg = db.prepare(`
        INSERT INTO chat_messages (id, session_id, role, content, tool_calls, timestamp)
        VALUES (@id, @session_id, @role, @content, @tool_calls, @timestamp)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          tool_calls = excluded.tool_calls
      `);
      const tx = db.transaction((msgs: any[]) => {
        for (const m of msgs) {
          insertMsg.run({
            id: m.id,
            session_id: sessionId,
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            tool_calls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
            timestamp: m.timestamp || Date.now(),
          });
        }
      });
      tx(messages);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/chat/sessions/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(req.params.id);
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Scheduled Task Manager (Astra runs prompts on a schedule) -------------
app.get('/api/scheduler/tasks', (_req, res) => {
  res.json({ tasks: listTasks() });
});

app.post('/api/scheduler/tasks', (req, res) => {
  const { title, prompt, schedule, runAt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ success: false, error: 'prompt is required' });
  }
  const task = createTask({
    title: typeof title === 'string' && title.trim() ? title.trim() : prompt.trim().slice(0, 60),
    prompt: prompt.trim(),
    schedule: typeof schedule === 'string' ? schedule : 'once',
    runAt: typeof runAt === 'string' ? runAt : null,
  });
  res.json({ success: true, task });
});

app.patch('/api/scheduler/tasks/:id', (req, res) => {
  const task = updateTask(req.params.id, req.body || {});
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true, task });
});

app.delete('/api/scheduler/tasks/:id', (req, res) => {
  const ok = deleteTask(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true });
});

app.post('/api/scheduler/tasks/:id/run', async (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  // Kick off asynchronously — the run streams through the normal agent pipeline
  res.json({ success: true, message: 'Run started — check the task status in a moment.' });
  setImmediate(async () => {
    try {
      await runTaskViaLoopbackForTask(task, PORT);
    } catch {
      // Result already persisted by the runner on failure paths
    }
  });
});

// ---- Work Artifacts (plans, implementations, verification, docs) -----------
app.get('/api/artifacts', (_req, res) => {
  res.json({ artifacts: listArtifacts() });
});

app.get('/api/artifacts/:id', (req, res) => {
  const artifact = getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ success: false, error: 'Artifact not found' });
  res.json({ artifact });
});

// ---- Managed processes (dev servers the agent starts) ----------------------
app.get('/api/processes', (_req, res) => {
  res.json({ processes: processManager.list() });
});

app.post('/api/processes/:id/stop', (req, res) => {
  const ok = processManager.stop(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Process not found' });
  res.json({ success: true });
});

// ---- Update channel (compares against <origin>/version.json) ---------------
app.get('/api/update/check', async (req, res) => {
  const current = pkg.version || '0.0.0';
  try {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `127.0.0.1:${PORT}`;
    const res2 = await fetch(`${proto}://${host}/version.json`, { signal: AbortSignal.timeout(3000) });
    const data = await res2.json().catch(() => null);
    const latest = typeof data?.version === 'string' ? data.version : null;
    const updateAvailable = Boolean(latest && latest !== current);
    res.json({ current, latest, updateAvailable });
  } catch {
    res.json({ current, latest: null, updateAvailable: false });
  }
});

// Comprehensive 159+ Provider Catalog & Multi-Auth API (API Key, Cookie Session, OAuth)
// Raw secrets never leave the server — clients get masked previews for display only.
function maskSecret(value: string | null | undefined): string | null {
  if (!value || String(value).trim() === '') return null;
  const v = String(value).trim();
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 3)}…${v.slice(-4)}`;
}

app.get('/api/providers/catalog', (_req, res) => {
  const credentials = providerAuthHandler.getAllCredentials();
  const catalogWithStatus = SUTRA_ALL_PROVIDERS.map((p) => {
    const cred = credentials[p.id];
    return {
      ...p,
      isConfigured: Boolean(cred?.api_key || cred?.cookie_data || p.authTypes.includes('local') || p.authTypes.includes('none')),
      savedAuthType: cred?.auth_type || 'api-key',
      hasApiKey: Boolean(cred?.api_key),
      hasCookie: Boolean(cred?.cookie_data),
      savedApiKeyPreview: maskSecret(cred?.api_key),
      savedCookiePreview: maskSecret(cred?.cookie_data),
      savedBaseUrl: cred?.base_url,
      status: cred?.status || 'Not connected',
      updatedAt: cred?.updated_at,
    };
  });
  res.json({ success: true, count: catalogWithStatus.length, providers: catalogWithStatus });
});

app.post('/api/providers/save-credential', (req, res) => {
  const { providerId, authType, apiKey, cookieData, baseUrl, headers } = req.body;
  if (!providerId) return res.status(400).json({ success: false, error: 'providerId is required' });

  const ok = providerAuthHandler.saveCredential({
    providerId,
    authType: authType || 'api-key',
    apiKey,
    cookieData,
    baseUrl,
    headers,
  });

  if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
    modelRouter.setApiKey(providerId, apiKey.trim());
  }

  res.json({ success: ok });
});

app.post('/api/providers/test', safeHandler(async (req, res) => {
  const { providerId } = req.body;
  if (!providerId) return res.status(400).json({ ok: false, error: 'providerId is required' });

  const result = await providerAuthHandler.testProviderAuth(providerId);
  res.json(result);
}));

// Ghost Text FIM Completion API (Alt+\ / Ctrl+Space)
app.post('/api/agent/complete', async (req, res) => {
  try {
    const { prefix, suffix, languageId, filePath } = req.body;
    const completion = await completionEngine.getCompletion({ prefix, suffix, languageId, filePath });
    res.json({ completion });
  } catch (err: any) {
    res.status(500).json({ error: err.message, completion: '' });
  }
});

// Native Model Context Protocol (MCP) API — registered earlier alongside chat APIs.

// Git Micro-Checkpoints API
app.get('/api/checkpoints', (_req, res) => {
  res.json({ checkpoints: gitCheckpoints.getCheckpoints() });
});

app.post('/api/checkpoints/rollback', safeHandler(async (req, res) => {
  const { id } = req.body;
  const result = await gitCheckpoints.rollback(id);
  res.json(result);
}));

// Agent Run History API — the durable record of what Astra did and how it was verified.
app.get('/api/runs', (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? ''), 10);
  res.json({ runs: listRuns(Number.isFinite(limit) ? limit : 50) });
});

app.get('/api/runs/:id', (req, res) => {
  const detail = getRunDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(detail);
});

// Agent Memory API — what Astra remembers across runs; users can teach or correct it.
app.get('/api/memory', (req, res) => {
  const workspace = typeof req.query.workspace === 'string' && req.query.workspace.trim() !== '' ? req.query.workspace.trim() : null;
  res.json({ memories: listMemories({ workspaceRoot: workspace, limit: 100 }) });
});

app.post('/api/memory', safeHandler(async (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  const kind = req.body?.kind === 'preference' || req.body?.kind === 'fact' || req.body?.kind === 'lesson' ? req.body.kind : 'preference';
  const memory = rememberMemory({
    kind,
    content,
    workspaceRoot: fsTools.getWorkspaceRoot(),
  });
  res.json({ memory });
}));

app.delete('/api/memory/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  res.json({ forgotten: forgetMemory(id) });
});

// 2. Subagent Swarm & Milestones
app.get('/api/swarm/status', (_req, res) => {
  res.json({
    subagents: agentSwarm.getSubagentStates(),
    permissionLevel: agentSwarm.getPermissionLevel(),
    pendingApprovals: agentSwarm.getPendingApprovals(),
  });
});

app.post('/api/swarm/permission', (req, res) => {
  const { level } = req.body;
  agentSwarm.setPermissionLevel(level);
  res.json({ success: true, permissionLevel: agentSwarm.getPermissionLevel() });
});



/* ----------------------------------------------------
 * STRICT-MODE APPROVAL DEFERRALS
 * The agent loop parks on these promises while the user decides.
 * ---------------------------------------------------- */
interface ApprovalDecision {
  approved: boolean;
  timedOut?: boolean;
  result?: any;
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const pendingApprovalDeferrals = new Map<string, {
  toolCall: any;
  ws: WebSocket;
  timer: ReturnType<typeof setTimeout>;
  resolve: (decision: ApprovalDecision) => void;
  reject: (reason?: any) => void;
}>();

function waitForApprovalDecision(toolCall: any, ws: WebSocket): Promise<ApprovalDecision> {
  return new Promise((resolve, reject) => {
    const entry = {
      toolCall,
      ws,
      timer: setTimeout(() => {
        pendingApprovalDeferrals.delete(toolCall.id);
        // Drop the queued call and auto-deny so the loop always resumes with a clear message.
        agentSwarm.rejectToolCall(toolCall.id);
        resolve({ approved: false, timedOut: true });
      }, APPROVAL_TIMEOUT_MS),
      resolve,
      reject,
    };
    pendingApprovalDeferrals.set(toolCall.id, entry);
  });
}

function resolveApprovalDeferral(toolCallId: string, decision: ApprovalDecision): boolean {
  const entry = pendingApprovalDeferrals.get(toolCallId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pendingApprovalDeferrals.delete(toolCallId);
  entry.resolve(decision);
  return true;
}

function rejectApprovalsForSocket(ws: WebSocket, reason: string): void {
  for (const [id, entry] of Array.from(pendingApprovalDeferrals.entries())) {
    if (entry.ws === ws) {
      clearTimeout(entry.timer);
      pendingApprovalDeferrals.delete(id);
      entry.reject(new Error(reason));
    }
  }
}

app.post('/api/swarm/approve-tool', async (req, res) => {
  const { toolCallId } = req.body;
  try {
    const result = await agentSwarm.approveToolCall(toolCallId);

    // Mirror the outcome to the agent's socket and wake the parked loop.
    const deferral = pendingApprovalDeferrals.get(toolCallId);
    if (deferral && deferral.ws.readyState === WebSocket.OPEN) {
      deferral.ws.send(
        createPacket(WSChannel.AGENT_TOOL_CALL, 'result', {
          id: toolCallId,
          tool: deferral.toolCall.tool,
          result,
        })
      );
    }
    resolveApprovalDeferral(toolCallId, { approved: true, result });

    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/swarm/reject-tool', (req, res) => {
  const { toolCallId } = req.body;
  agentSwarm.rejectToolCall(toolCallId);
  resolveApprovalDeferral(toolCallId, { approved: false });
  res.json({ success: true });
});

/* ----------------------------------------------------
 * ASK_USER QUESTION DEFERRALS
 * When the agent calls ask_user, the round parks on these promises while the
 * user answers over the same WebSocket (agent_question -> agent_answer).
 * ---------------------------------------------------- */
const ASK_USER_TIMEOUT_MS = 5 * 60 * 1000;
const ASK_USER_TIMEOUT_ANSWER = 'No response received — proceed with your best judgment and clearly note the assumption you made.';

const pendingQuestionDeferrals = new Map<string, {
  ws: WebSocket;
  timer: ReturnType<typeof setTimeout>;
  resolve: (answer: string) => void;
}>();

function waitForAgentAnswer(toolCallId: string, ws: WebSocket): Promise<string> {
  // One pending question per run: retire any earlier parked question on this socket.
  for (const [id, entry] of Array.from(pendingQuestionDeferrals.entries())) {
    if (entry.ws === ws && id !== toolCallId) {
      clearTimeout(entry.timer);
      pendingQuestionDeferrals.delete(id);
      entry.resolve(ASK_USER_TIMEOUT_ANSWER);
    }
  }
  return new Promise((resolve) => {
    const entry = {
      ws,
      timer: setTimeout(() => {
        pendingQuestionDeferrals.delete(toolCallId);
        resolve(ASK_USER_TIMEOUT_ANSWER);
      }, ASK_USER_TIMEOUT_MS),
      resolve,
    };
    pendingQuestionDeferrals.set(toolCallId, entry);
  });
}

function resolveAgentAnswer(toolCallId: string, answer: string): boolean {
  const entry = pendingQuestionDeferrals.get(toolCallId);
  if (!entry) return false; // Unknown or late id — ignored silently.
  clearTimeout(entry.timer);
  pendingQuestionDeferrals.delete(toolCallId);
  const cleanAnswer = typeof answer === 'string' ? answer.trim() : '';
  entry.resolve(cleanAnswer.length > 0 ? cleanAnswer : ASK_USER_TIMEOUT_ANSWER);
  return true;
}

function resolveQuestionsForSocket(ws: WebSocket): void {
  for (const [id, entry] of Array.from(pendingQuestionDeferrals.entries())) {
    if (entry.ws === ws) {
      clearTimeout(entry.timer);
      pendingQuestionDeferrals.delete(id);
      entry.resolve(ASK_USER_TIMEOUT_ANSWER);
    }
  }
}

// 3. File System Explorer & Editor CRUD
app.get('/api/fs/tree', (_req, res) => {
  const tree = fsTools.listDirectory('.', true);
  res.json(tree);
});

app.get('/api/fs/read', (req, res) => {
  const filePath = req.query.path as string;
  try {
    const result = fsTools.readFile(filePath);
    res.json(result);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/fs/write', (req, res) => {
  const { path: filePath, content } = req.body;
  try {
    const result = fsTools.writeFile(filePath, content);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fs/mkdir', (req, res) => {
  const { path: dirPath } = req.body;
  try {
    const result = fsTools.createDirectory(dirPath);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fs/delete', (req, res) => {
  const { path: targetPath } = req.body;
  try {
    const result = fsTools.deletePath(targetPath);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fs/rename', (req, res) => {
  const { oldPath, newPath } = req.body;
  try {
    const result = fsTools.renamePath(oldPath, newPath);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fs/grep', (req, res) => {
  const { query, path: searchPath, caseInsensitive } = req.body;
  const results = fsTools.grepSearch(query, searchPath, caseInsensitive);
  res.json(results);
});

app.post('/api/fs/set-workspace', (req, res) => {
  const { path: newPath } = req.body;
  try {
    fsTools.setWorkspaceRoot(newPath);
    ptyManager.setWorkspaceRoot(newPath);
    mediaEngine.setProjectRoot(newPath);
    res.json({ success: true, workspacePath: newPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Creates a folder (recursive) and switches the workspace to it
app.post('/api/fs/create-workspace', async (req, res) => {
  const { path: newPath } = req.body || {};
  if (!newPath || typeof newPath !== 'string' || newPath.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'A valid folder path is required' });
  }
  try {
    const target = path.resolve(newPath.trim());
    if (!Number.isFinite(target.length) || target.length < 2) {
      return res.status(400).json({ success: false, error: 'Invalid path' });
    }
    await fs.promises.mkdir(target, { recursive: true });
    fsTools.setWorkspaceRoot(target);
    ptyManager.setWorkspaceRoot(target);
    mediaEngine.setProjectRoot(target);
    res.json({ success: true, workspacePath: target });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/fs/workspace', (_req, res) => {
  res.json({ path: fsTools.getWorkspaceRoot() });
});

// Generated sites are RUNNABLE: the workspace is served read-only so any HTML
// Astra writes (index.html etc.) renders live at /workspace/<path>. The static
// handler is memoized per root so workspace switches take effect immediately.
const workspaceStaticCache = new Map<string, express.RequestHandler>();
app.use('/workspace', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const root = fsTools.getWorkspaceRoot();
  let handler = workspaceStaticCache.get(root);
  if (!handler) {
    handler = express.static(root, { index: 'index.html', fallthrough: true });
    workspaceStaticCache.set(root, handler);
  }
  handler(req, res, next);
});

app.post('/api/fs/browse-folder', async (req, res) => {
  const script = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select workspace folder'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }`;
  try {
    // Async + detached so a user leaving the dialog open never blocks the event loop.
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        cwd: rootDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      const killTimer = setTimeout(() => {
        try { child.kill(); } catch { /* already exited */ }
        reject(new Error('Folder selection timed out. Type the workspace path instead.'));
      }, 5 * 60 * 1000);
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
      child.on('close', () => {
        clearTimeout(killTimer);
        resolve(stdout.trim());
      });
    });

    if (result) {
      fsTools.setWorkspaceRoot(result);
      ptyManager.setWorkspaceRoot(result);
      mediaEngine.setProjectRoot(result);
      res.json({ path: result, success: true });
    } else {
      res.json({ path: '', success: false, message: 'No folder selected' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3.1 Real Git Integration Endpoints
app.get('/api/git/status', (_req, res) => {
  const status = fsTools.gitStatus();
  res.json(status);
});

app.post('/api/git/init', (_req, res) => {
  const result = fsTools.gitInit();
  if (!result.success) {
    return res.status(500).json({ success: false, error: result.output });
  }
  res.json({ success: true, output: result.output, status: fsTools.gitStatus() });
});

app.get('/api/git/diff', (req, res) => {
  const targetPath = req.query.path as string | undefined;
  const staged = req.query.staged === 'true';
  const diffResult = fsTools.getGitDiff(targetPath, staged);
  res.json(diffResult);
});

app.post('/api/git/commit', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ success: false, error: 'Commit message is required' });
  }
  // fsTools.gitCommit uses execFileSync with an args array — no shell interpolation.
  const result = fsTools.gitCommit(message);
  if (!result.success) {
    return res.status(500).json({ success: false, error: result.output });
  }
  res.json({ success: true, output: result.output });
});

// 4. Media & Asset Studio
app.get('/api/media/assets', (_req, res) => {
  res.json(mediaEngine.getAllAssets());
});

app.post('/api/media/generate-image', safeHandler(async (req, res) => {
  const asset = await mediaEngine.generateImageAsset(req.body);
  res.json(asset);
}));

app.post('/api/media/generate-video', safeHandler(async (req, res) => {
  const asset = await mediaEngine.generateVideoAsset(req.body);
  res.json(asset);
}));

app.post('/api/media/generate-audio', safeHandler(async (req, res) => {
  const asset = await mediaEngine.generateAudioAsset(req.body);
  res.json(asset);
}));

app.post('/api/media/generate-svg', safeHandler(async (req, res) => {
  const asset = await mediaEngine.generateSvgAsset(req.body);
  res.json(asset);
}));

// 5. Godly Design Vault & Archetypes
app.get('/api/vault/patterns', (_req, res) => {
  res.json(GODLY_VAULT_PATTERNS);
});

// 5.1 Dynamic Web Research & Context Compression
app.post('/api/research/search', safeHandler(async (req, res) => {
  const { query, limit } = req.body;
  const { webResearchEngine } = await import('./tools/webResearchTools.js');
  const results = await webResearchEngine.searchWeb(query, limit || 5);
  res.json(results);
}));

app.post('/api/research/scrape', safeHandler(async (req, res) => {
  const { url, maxContextLength } = req.body;
  const { webResearchEngine } = await import('./tools/webResearchTools.js');
  const result = await webResearchEngine.scrapeAndCompress(url, maxContextLength || 3000);
  res.json(result);
}));

// 6. Phone Companion QR & Status
app.get('/api/mobile/pairing-qr', safeHandler(async (req, res) => {
  const hostHeader = req.get('host');
  const origin = hostHeader ? `http://${hostHeader}` : undefined;
  const qrInfo = await mobileBridge.generatePairingQr(origin);
  res.json({
    ...qrInfo,
    connectedDevices: mobileBridge.getConnectedCount(),
  });
}));

// Mobile SPA route. The pairing page never forwards the QR token on its own, so
// stamp it into a short-lived cookie here: the phone's WebSocket upgrade then
// authenticates itself automatically (same-origin requests carry cookies).
// An invalid/expired token still loads the page — the app surfaces the failure.
app.get('/mobile', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (token) {
    if (mobileBridge.verifyPairingToken(token)) {
      res.setHeader('Set-Cookie', `sutra_mobile_pairing=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`);
      console.log(`[Mobile Bridge] Pairing cookie stamped for ${req.socket.remoteAddress || 'unknown'}`);
    } else {
      console.warn(`[Mobile Bridge] Rejected stale pairing token from ${req.socket.remoteAddress || 'unknown'}`);
    }
  }
  sendSpaIndex(res);
});

// 6.5 LSP Integration API (TypeScript diagnostics, go-to-definition, find references)
app.post('/api/lsp/diagnostics', safeHandler(async (req, res) => {
  const { filePath } = req.body;
  const result = await lspTools.getDiagnostics(filePath);
  res.json(result);
}));

app.post('/api/lsp/definition', safeHandler(async (req, res) => {
  const { filePath, line, character, languageId } = req.body;
  const result = await lspTools.goToDefinition(filePath, line, character, languageId || 'typescript');
  res.json(result);
}));

app.post('/api/lsp/references', safeHandler(async (req, res) => {
  const { filePath, line, character, languageId } = req.body;
  const result = await lspTools.findReferences(filePath, line, character, languageId || 'typescript');
  res.json(result);
}));

app.post('/api/lsp/symbols', safeHandler(async (req, res) => {
  const { filePath, languageId } = req.body;
  const result = await lspTools.getSymbols(filePath, languageId || 'typescript');
  res.json(result);
}));

app.get('/api/lsp/status', (_req, res) => {
  res.json({
    ready: lspManager.isReady(),
    initialized: lspManager.isReady(),
  });
});

// 7. Dedicated Live Preview Sandbox Route (Prevents Recursive Iframe Loop)
app.get('/preview', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SUTRA Live Preview Sandbox</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0c0d10; color: #f1f2f5; }
  </style>
</head>
<body class="min-h-screen flex flex-col items-center justify-center p-6 text-center select-none">
  <div class="max-w-lg p-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md shadow-2xl">
    <div class="w-12 h-12 mx-auto mb-4 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-200">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
    </div>
    <h1 class="text-xl font-bold tracking-tight text-white mb-2">SUTRA Live Viewport Sandbox</h1>
    <p class="text-xs text-zinc-400 leading-relaxed mb-6">
      Your active project components and live applications render seamlessly here across Desktop, Tablet, and Mobile viewports without recursive nesting.
    </p>
    <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-zinc-300 text-xs font-mono">
      <span class="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse"></span>
      Sandbox Ready
    </div>
  </div>
</body>
</html>`);
});

/* ----------------------------------------------------
 * PLAIN USER-FACING ERROR COPY
 * Provider errors can carry internal routing vocabulary ("execution
 * pipeline", "gateway", "harness"). Chat must never surface those, so
 * every error string shown to the user passes through this rewrite.
 * ---------------------------------------------------- */
const INTERNAL_ERROR_PHRASES: Array<[RegExp, string]> = [
  [/AI Execution Pipeline Busy:?/gi, 'The model endpoint did not respond'],
  [/AI Provider Execution Notice:?/gi, 'Model connection issue'],
  [/execution pipeline/gi, 'model connection'],
  [/\bgateway\b/gi, 'endpoint'],
  [/\bharness\b/gi, 'engine'],
  [/\bsentinel\b/gi, 'guard'],
];

function toPlainUserError(message: unknown): string {
  let text = String(message || 'Unknown error');
  for (const [pattern, replacement] of INTERNAL_ERROR_PHRASES) {
    text = text.replace(pattern, replacement);
  }
  return text.trim();
}

/* ----------------------------------------------------
 * WORKSPACE AWARENESS (system-prompt context injection)
 * Snapshot of the real project the agent is working on.
 * Every step is best-effort — never crash prompt build on fs errors.
 * ---------------------------------------------------- */
function detectWorkspaceProjectType(root: string): string {
  try {
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const scriptNames = pkgJson.scripts && typeof pkgJson.scripts === 'object' && !Array.isArray(pkgJson.scripts)
          ? Object.keys(pkgJson.scripts).slice(0, 8)
          : [];
        return `Node.js / JavaScript project${pkgJson.name ? ` ("${pkgJson.name}")` : ''}${scriptNames.length > 0 ? ` — npm scripts: ${scriptNames.join(', ')}` : ''}`;
      } catch {
        return 'Node.js / JavaScript project (package.json unreadable)';
      }
    }
  } catch {
    // Fall through to the other detectors
  }
  const markers: Array<[string, string]> = [
    ['requirements.txt', 'Python project (requirements.txt)'],
    ['pyproject.toml', 'Python project (pyproject.toml)'],
    ['Cargo.toml', 'Rust project (Cargo.toml)'],
    ['go.mod', 'Go project (go.mod)'],
    ['pom.xml', 'Java project (pom.xml)'],
    ['build.gradle', 'Java/Kotlin project (Gradle)'],
    ['Gemfile', 'Ruby project (Gemfile)'],
    ['composer.json', 'PHP project (composer.json)'],
    ['global.json', '.NET project'],
  ];
  for (const [marker, label] of markers) {
    try {
      if (fs.existsSync(path.join(root, marker))) return label;
    } catch {
      // Skip unreadable markers
    }
  }
  return 'Unknown / generic files';
}

function listWorkspaceTopLevelEntries(root: string): string[] {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const dirNames = entries
      .filter((e) => e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git')
      .map((e) => `${e.name}/`);
    const fileNames = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
    // Directories first, then files; names only; capped at 30 entries.
    return [...dirNames, ...fileNames].slice(0, 30);
  } catch {
    return [];
  }
}

function detectWorkspaceGitBranch(dir: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const branch = out.trim();
    return branch || null;
  } catch {
    return null; // Not a git repo or git unavailable
  }
}

function buildWorkspaceAwarenessSection(): string {
  try {
    const root = fsTools.getWorkspaceRoot();
    const lines: string[] = [];
    lines.push('WORKSPACE:');
    lines.push(`- Workspace root (absolute path): "${root}"`);
    lines.push(`- Detected project type: ${detectWorkspaceProjectType(root)}`);
    const topLevel = listWorkspaceTopLevelEntries(root);
    lines.push(`- Top-level entries (${topLevel.length} shown, directories first): ${topLevel.length > 0 ? topLevel.join(', ') : '(none readable)'}`);
    const branch = detectWorkspaceGitBranch(root);
    if (branch) {
      lines.push(`- Git repository: yes — current branch: "${branch}"`);
    } else {
      lines.push('- Git repository: no (or git is unavailable)');
    }
    lines.push('- You are running inside SUTRA IDE with direct access to this workspace; all file tools resolve paths relative to the workspace root.');
    return lines.join('\n');
  } catch {
    return ''; // Workspace snapshot must never crash prompt building
  }
}

/**
 * Self-awareness: what Astra can and cannot do RIGHT NOW — connected providers
 * and their abilities (chat / vision / tools / image / audio / video generation),
 * which have keys vs cookies, scheduled tasks, and honest gaps. Injected into
 * every system prompt so the agent never guesses its own capabilities.
 */
function buildAbilitiesSection(): string {
  try {
    const lines: string[] = [];
    lines.push('ABILITIES (your live capabilities in this session):');
    lines.push('- You are Astra, the agent inside SUTRA IDE.');

    // Chat providers: connected ones with per-provider abilities from the catalog
    const connected: string[] = [];
    const providers = db.prepare("SELECT id FROM providers WHERE (api_key IS NOT NULL AND api_key != '') OR (cookie_data IS NOT NULL AND cookie_data != '')").all() as any[];
    const ids = new Set(providers.map((p: any) => String(p.id)));
    ids.add('pollinations'); // free tier is always routable
    for (const id of ids) {
      const meta = SUTRA_ALL_PROVIDERS.find((p) => p.id === id);
      const abilities: string[] = ['chat'];
      if (meta?.supportsTools) abilities.push('tool-calling');
      if (meta?.supportsVision) abilities.push('vision');
      if (/image|midjourney|stability|leonardo|imagen/.test(id) || /image/.test(meta?.badge || '')) abilities.push('image-generation');
      if (/elevenlabs|tts|audio/i.test(id)) abilities.push('audio-generation');
      if (/video|runway|pika|minimax|kling/i.test(id)) abilities.push('video-generation');
      const auth = id === 'pollinations' ? 'free' : meta?.authTypes?.join('/');
      connected.push(`${id} (${abilities.join(', ')}; auth: ${auth})`);
    }
    lines.push(`- Connected model providers: ${connected.length > 0 ? connected.join('; ') : 'none — say so honestly'}`);

    // Media abilities: what the asset tools can actually do right now
    const mediaStatus = mediaEngine.getProviderStatus?.();
    if (mediaStatus) {
      const fmt = (list: string[] | undefined) => (list && list.length > 0 ? list.join(', ') : 'none');
      lines.push(`- Image generation providers ready: ${fmt((mediaStatus as any).image)}`);
      lines.push(`- Video generation providers ready: ${fmt((mediaStatus as any).video)}`);
      lines.push(`- Audio generation providers ready: ${fmt((mediaStatus as any).audio)}`);
      lines.push('- If a needed generation ability shows "none", do not fake it — ask the user to provide the asset or add the provider in Settings.');
    }

    // Scheduled tasks awareness
    try {
      const tasks = listTasks();
      const enabled = tasks.filter((t) => t.enabled);
      lines.push(`- Scheduled tasks: ${tasks.length} total, ${enabled.length} active${enabled.length > 0 ? ` (${enabled.map((t) => `"${t.title}" [${t.schedule}]`).slice(0, 5).join(', ')})` : ''}.`);
    } catch {
      // Scheduler table may not exist yet
    }

    lines.push('- When you need information or a choice from the user, ALWAYS use the ask_user tool so they get clickable options — never ask in plain text.');
    lines.push('- If a tool or provider fails, adapt: retry, switch to another connected provider, or continue the task another way. Never stop to report a failure you can work around.');
    return '\n' + lines.join('\n');
  } catch {
    return ''; // Abilities snapshot must never crash prompt building
  }
}

/* ----------------------------------------------------
 * WEBSOCKET GATEWAY & LIVE MULTIPLEXING
 * ---------------------------------------------------- */
wss.on('connection', (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
  const isMobile = urlParams.get('client') === 'mobile' || userAgent.includes('Mobile');

  let activeAgentAbortController: AbortController | null = null;
  // Serialize agent runs per socket: a second prompt while one is active is refused
  // (the async message handler must not interleave two tool loops on one conversation).
  let agentRunActive = false;

  // Normalize OpenAI-style multipart user content: text parts are concatenated into
  // the content string, data-image URLs are collected in parallel fields so the
  // vision handoff stays available downstream.
  const normalizeIncomingMessages = (messages: any[]): any[] =>
    messages.map((m) => {
      if (m.role !== 'user' || !Array.isArray(m.content)) return m;
      let text = '';
      const images: string[] = [];
      for (const part of m.content) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          text += (text ? '\n' : '') + part.text;
        } else if (part?.type === 'image_url') {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
          if (typeof url === 'string' && url.startsWith('data:image/')) images.push(url);
        }
      }
      return { ...m, _originalContent: m.content, _imageDataUrls: images.length > 0 ? images : undefined, content: text };
    });

  if (isMobile) {
    // Mobile clients must present a valid ephemeral pairing token from the QR flow.
    // Without this an unpaired phone on the LAN could drive the agent and PTY.
    // The token arrives either as a ?token= query param or as the short-lived
    // cookie stamped by GET /mobile when the phone opened the QR link.
    let pairingToken = urlParams.get('token') || undefined;
    if (!pairingToken) {
      const cookieMatch = (req.headers.cookie || '').match(/(?:^|;\s*)sutra_mobile_pairing=([^;]+)/);
      if (cookieMatch) {
        try {
          pairingToken = decodeURIComponent(cookieMatch[1]);
        } catch {
          // Malformed cookie value — treat as no token presented.
        }
      }
    }
    const registered = mobileBridge.registerMobileClient(ws, clientIp, userAgent, pairingToken);
    if (!registered) {
      console.warn(`[Mobile Bridge] Rejected mobile client ${clientIp}: invalid or expired pairing token`);
      try {
        ws.send(createPacket(WSChannel.MOBILE_SYNC, 'error', {
          message: 'Pairing token invalid or expired. Scan the QR code again to pair this device.',
        }));
      } catch {
        // Socket may already be closing; the close below is what matters.
      }
      ws.close(4403, 'Invalid pairing token');
      return;
    }
    console.log(`[Mobile Bridge] Paired mobile client ${clientIp} (${mobileBridge.getConnectedCount()} connected)`);
  }

  // Handle incoming packets
  ws.on('message', async (raw: string) => {
    const packet = parsePacket(raw);
    if (!packet) return;

    // ask_user answers may arrive wrapped in an AGENT_STREAM packet
    // ({ channel, type: 'agent_answer', payload: { id, answer } }) or as a bare JSON
    // frame ({ type: 'agent_answer', id, answer }). Both shapes are accepted;
    // unknown or late ids are ignored silently by resolveAgentAnswer.
    if (packet.type === 'agent_answer') {
      const payloadAny = (packet.payload || {}) as any;
      const answerId = String(payloadAny.id ?? (packet as any).id ?? '');
      const answerRaw = payloadAny.answer ?? (packet as any).answer;
      if (answerId) {
        resolveAgentAnswer(answerId, typeof answerRaw === 'string' ? answerRaw : '');
      }
      return;
    }

    switch (packet.channel) {
      case WSChannel.PTY_INPUT:
        if (packet.type === 'init') {
          const cols = packet.payload?.cols || 80;
          const rows = packet.payload?.rows || 24;
          ptyManager.createSession(packet.payload.sessionId || 'main', ws, cols, rows);
        } else if (packet.type === 'data') {
          ptyManager.writeData(packet.payload.sessionId || 'main', packet.payload.data);
        } else if (packet.type === 'resize') {
          ptyManager.resize(packet.payload.sessionId || 'main', packet.payload.cols, packet.payload.rows);
        }
        break;

      case WSChannel.PTY_RESIZE:
        ptyManager.resize(packet.payload.sessionId || 'main', packet.payload.cols, packet.payload.rows);
        break;

      case WSChannel.AGENT_STREAM:
        if (packet.type === 'cancel') {
          if (activeAgentAbortController) {
            activeAgentAbortController.abort();
            activeAgentAbortController = null;
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { done: true, delta: '\n\n*(Generation stopped by user)*' }));
          }
          return;
        }

        if (packet.type === 'prompt') {
          if (agentRunActive) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                done: true,
                delta: 'Already working — stop the current task first.',
              }));
            }
            return;
          }
          // Durable audit trail for this run — declared outside the run try-block so
          // both the completion path and the fatal-error catch can close it out.
          let runLogId: string | null = null;
          let runFinished = false;
          const endRun = (
            status: 'completed' | 'failed' | 'cancelled',
            data?: { filesMutated?: number; verificationPassed?: boolean | null }
          ) => {
            if (!runLogId || runFinished) return;
            runFinished = true;
            try {
              finishRun(runLogId, status, data);
            } catch (err: any) {
              console.warn('[SUTRA] Run log finish failed:', err?.message);
            }
          };
          try {
            if (activeAgentAbortController) {
              activeAgentAbortController.abort();
            }
            activeAgentAbortController = new AbortController();
            const signal = activeAgentAbortController.signal;

            // Fresh run: clear stale subagent specialists and tell connected clients
            agentSwarm.clearSubagents();
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(createPacket(WSChannel.SWARM_STATE, 'update', { subagents: [] }));
            }
            mobileBridge.broadcastToMobile(WSChannel.SWARM_STATE, 'update', { subagents: [] });

            // Set permission level from client ('strict' gates every action; 'full' runs autonomously).
            // Legacy client values are mapped: allow_all/auto -> full, safe -> strict.
            const rawPermission = packet.payload.permissionLevel;
            const permissionLevel: 'strict' | 'full' =
              rawPermission === 'strict' || rawPermission === 'safe'
                ? 'strict'
                : 'full';
            agentSwarm.setPermissionLevel(permissionLevel);
            console.log(
              `[SUTRA] Permission mode for this run: ${permissionLevel === 'strict' ? 'STRICT (Astra asks before every action)' : 'FULL ACCESS (Astra works autonomously)'}`
            );

            const isGoalModeActive = Boolean(packet.payload.isGoalMode);
            const messages: any[] = normalizeIncomingMessages([...(packet.payload.messages || [])]);

            // Per-chat working files: every conversation owns its own task plan,
            // so two chats in one workspace never read or overwrite each other's
            // plan. A new chat id (= new conversation) starts with a clean plan.
            const rawChatId = typeof packet.payload.chatId === 'string' ? packet.payload.chatId : '';
            const chatIdSafe = rawChatId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'default';
            const chatPlanPath = path.join(fsTools.getWorkspaceRoot(), '.sutra', 'chats', chatIdSafe, 'task_plan.md');

            // Hidden slash commands: expand shorthand intents into full instructions.
            // They never show a UI menu — typing them is the discovery.
            try {
              const lastUser = [...messages].reverse().find((m) => m.role === 'user');
              if (lastUser && typeof lastUser.content === 'string') {
                const trimmed = lastUser.content.trim();
                const expansions: Record<string, string> = {
                  '/plan': 'Plan this step by step before changing anything. Present the plan, then wait for my confirmation before implementing:',
                  '/fix': 'Find and fix every error in this project. After fixing, run the build or tests to verify, and keep going until everything passes.',
                  '/test': 'Write and run tests for',
                  '/explain': 'Explain this codebase: structure, entry points, and data flow.',
                };
                const matched = Object.keys(expansions).find((cmd) => trimmed.toLowerCase().startsWith(`${cmd} `) || trimmed.toLowerCase() === cmd);
                if (matched) {
                  const rest = trimmed.slice(matched.length).trim();
                  lastUser.content = rest ? `${expansions[matched]} ${rest}` : expansions[matched];
                }
              }
            } catch {
              // Expansion is best-effort — the raw message still routes
            }

            // Optional model override from the client — best effort, never fails the prompt.
            const requestedModelId = typeof packet.payload.model === 'string' ? packet.payload.model.trim() : '';
            if (requestedModelId) {
              try {
                const allModels = modelRouter.getAllModels();
                const matched =
                  allModels.find((m) => m.id === requestedModelId) ||
                  allModels.find((m) => m.id.split('/').pop() === requestedModelId || m.id.endsWith(`/${requestedModelId}`));
                if (matched) {
                  modelRouter.setActiveModel(matched.id);
                } else if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      thinking: `Model "${requestedModelId}" is not available — using the previous selection.`,
                    })
                  );
                }
              } catch {
                // Model resolution is advisory — the previous selection stays active
              }
            }

            agentRunActive = true;
            // Safe bounded execution: 30 rounds for goal missions, 20 for standard prompts.
            // Adaptive compute may grant one bounded extension mid-run (see below).
            let maxToolRounds = isGoalModeActive ? 30 : 20;
            let roundExtensionsUsed = 0;
            const failedCallTracker: Map<string, number> = new Map();
            const callRepetitionTracker: Map<string, number> = new Map();
            // Semantic stagnation detection across everything actually executed this run.
            const stagnationDetector = new StagnationDetector();
            let stagnationNudged = false;
            let worstStagnationLevel: 'none' | 'warn' | 'block' = 'none';
            const executedToolsSummary: string[] = [];
            // Workspace paths this run actually mutated — drives the end-of-run verification stage.
            const mutatedFiles: Set<string> = new Set();
            let totalStreamedText = '';
            let autoContinues = 0;

            // Workspace awareness snapshot — computed once per prompt run and reused by
            // every round's system prompt so the agent always knows its real project.
            const workspaceSection = buildWorkspaceAwarenessSection() + buildAbilitiesSection();

            // Persistent memory: lessons and user preferences from previous runs
            // are injected so past failures are not repeated.
            let memorySectionText = '';
            try {
              const memoryBlock = buildMemorySection(fsTools.getWorkspaceRoot());
              memorySectionText = memoryBlock.text;
              touchMemories(memoryBlock.usedIds);
            } catch {
              // Memory injection must never break prompt building
            }

            // Observed tool reliability from past runs steers tool choice.
            let toolStatsSection = '';
            try {
              toolStatsSection = buildToolStatsSection();
            } catch {
              // Stats injection must never break prompt building
            }

            // One harness context per run — metadata (visitedTools, milestones, telemetry)
            // accumulates across rounds instead of resetting every turn.
            const harnessContext = {
              sessionId: `sutra-${Date.now()}`,
              workspaceRoot: fsTools.getWorkspaceRoot(),
              model: modelRouter.getActiveModel(),
              round: 0,
              maxRounds: maxToolRounds,
              tokenBudget: 4800,
              chatId: chatIdSafe,
              metadata: { chatPlanPath } as Record<string, any>,
            };

            // Durable audit trail for this run — written through finishRun exactly once.
            const promptUserForLog = [...messages].reverse().find((m) => m.role === 'user');
            try {
              runLogId = startRun({
                workspaceRoot: fsTools.getWorkspaceRoot(),
                modelId: modelRouter.getActiveModel()?.id ?? null,
                permissionMode: permissionLevel,
                promptPreview: typeof promptUserForLog?.content === 'string' ? promptUserForLog.content : '',
              });
            } catch (err: any) {
              console.warn('[SUTRA] Run log start failed:', err?.message);
            }

            for (let round = 0; round < maxToolRounds; round += 1) {
              if (signal.aborted) break;

              // Adaptive compute: entering what would be the final round with an
              // open plan and real progress grants ONE bounded extension instead
              // of cutting verified work short. Stagnated runs get no extension.
              if (round === maxToolRounds - 1 && roundExtensionsUsed < 1 && !isGoalModeActive) {
                let planOpenNow = false;
                try {
                  if (fs.existsSync(chatPlanPath)) {
                    planOpenNow = /- \[ \]|\(pending\)|\(in_progress\)/.test(fs.readFileSync(chatPlanPath, 'utf-8'));
                  }
                } catch {
                  // No readable plan — no extension basis
                }
                const runShowsProgress = mutatedFiles.size > 0 || executedToolsSummary.length > 0;
                const canExtend = shouldExtendRun({
                  roundsUsed: round,
                  maxRounds: maxToolRounds,
                  planHasOpenItems: planOpenNow,
                  runShowsProgress,
                  stagnationLevel: worstStagnationLevel,
                  extensionsUsed: roundExtensionsUsed,
                });
                if (canExtend) {
                  roundExtensionsUsed += 1;
                  maxToolRounds += 8;
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      thinking: 'The task plan still has open items — granting this run additional working rounds to finish properly.',
                    }));
                  }
                }
              }

              let assistantText = '';
              let requestedTools: any[] = [];
              const activeTabPath = packet.payload.activeTabPath;
              const activeTabContent = packet.payload.activeTabContent;
              const openTabPaths: string[] = packet.payload.openTabPaths || [];
              const cursorPosition = packet.payload.cursorPosition;
              const selectedText = packet.payload.selectedText;
              const visibleRange = packet.payload.visibleRange;
              const activeFileDiagnostics = packet.payload.activeFileDiagnostics || [];

              // Extract last user query to search semantic AST codebase index
              const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
              const lastUserQuery = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
              const semanticContext = codebaseIndexer.formatSemanticContextForPrompt(lastUserQuery);

              let activeEditorInfo = '\nACTIVE EDITOR & CURSOR TELEMETRY:\n- No file currently active in Monaco Editor.';
              if (activeTabPath) {
                activeEditorInfo = `\nACTIVE EDITOR & CURSOR TELEMETRY (Cursor-Grade Parity):
- Currently Opened File: "${activeTabPath}"
- Open Tabs in Workspace: [${openTabPaths.map((p: string) => `"${p}"`).join(', ')}]
${cursorPosition ? `- Cursor Position: Line ${cursorPosition.line}, Column ${cursorPosition.column}` : ''}
${visibleRange ? `- Visible Viewport in Editor: Lines ${visibleRange.startLine} to ${visibleRange.endLine}` : ''}
${selectedText ? `- CURRENTLY HIGHLIGHTED/SELECTED CODE BY USER (Focus directly on this!):\n\`\`\`\n${selectedText}\n\`\`\`` : ''}
${activeFileDiagnostics && activeFileDiagnostics.length > 0 ? `- ACTIVE LINTER / TYPESCRIPT DIAGNOSTICS IN FILE:\n${activeFileDiagnostics.map((d: any) => `  * Line ${d.startLineNumber}: [Severity ${d.severity}] ${d.message}`).join('\n')}` : '- Linter State: 0 syntax/linter errors in active file.'}
${activeTabContent ? `- Live Content Excerpt of "${activeTabPath}":\n\`\`\`\n${activeTabContent.slice(0, 3500)}\n\`\`\`` : ''}`;
              }

              const activeModel = modelRouter.getActiveModel();
              const profile = activeModel?.id
                ? learnedModelLimits.getModelProfile(activeModel.id, (activeModel as any).provider || '')
                : { safeTpmTokens: 6000, maxToolOutputChars: 3000 };
              harnessContext.round = round + 1;
              harnessContext.tokenBudget = profile.safeTpmTokens;
              const customModelsDoc = customModelsManager.generateSystemPromptDocumentation();

              const defaultSystemPrompt = `You are Astra — an elite autonomous AI principal software engineer and pair programmer embedded directly in the user's IDE.
You operate with complete authority and deep competence across the entire codebase using your extensive suite of 45+ specialized IDE tools.

${activeEditorInfo}

${semanticContext}

${workspaceSection}
${memorySectionText}
${toolStatsSection}

WORKSPACE & ARCHITECTURAL CONTEXT:
- Working Directory: "${fsTools.getWorkspaceRoot()}"
- Visual Assets & Logos: Located in \`public/assets/\`, \`src/components/Splash/\`, and \`src/components/Layout/\`.
- Proactively use \`read_file\`, \`grep_search\`, or \`ast_grep\` to inspect codebase structure before mutating code.

OPERATING RULES:
a. Before any task with 2+ steps, call \`write_todos\` first with a short plan.
b. Inspect before you act: use \`list_directory\` / \`read_file\` to understand the project before editing or running anything. NEVER run speculative or exploratory shell commands just to "see what happens".
c. Prefer dedicated file tools (\`read_file\`, \`write_file\`, \`edit_file\`, \`grep_search\`) over shell commands.
d. If the request is ambiguous (missing paths, unclear scope, unclear design or asset requirements), call \`ask_user\` FIRST with focused questions and 2-4 answer options; do not guess.
e. Never fabricate results; report every tool outcome truthfully.
f. You are working inside the user's IDE workspace — every change writes real files on disk.

CORE ENGINEERING & EXECUTION DIRECTIVES:
1. PRINCIPAL SOFTWARE ENGINEERING STANDARDS:
   - Read before edit: Always inspect existing file contents and context before making edits.
   - Scoped diffs: Make precise surgical edits with \`edit_file\` or full rewrites with \`write_file\`. Never leave placeholder comments like "// rest of code here".
   - Search before rename: Ensure all call sites and imports are updated when moving or refactoring symbols.
   - Verify before done: Run \`typecheck_project\`, \`run_unit_tests\`, or shell commands with \`run_command\` to verify that modifications compile and pass tests.

2. STRICT SEPARATION OF CHAT VS CODE/FILES:
   - CHAT STREAM: Reserve the chat stream for high-level architectural explanations, concise step-by-step progress reports, and verification outcomes.
   - CODE MUST BE WRITTEN DIRECTLY TO DISK: NEVER output massive full-file code dumps into chat. ALWAYS use \`write_file\` to create files or \`edit_file\` to modify files directly in the workspace.

3. ANTI-SLOP HIGH-CRAFT DESIGN INTELLIGENCE:
   - Follow the Paper + Ink + Accent visual model (80-90% neutral canvas, deep ink typography, scarce accent colors).
   - Use 1px architectural hairline rules (\`border-white/10\`, \`border-obsidian-hairline\`) and subtle elevated surfaces.
   - Avoid generic AI SaaS card grids (2x2/3x3 cards), electric neon glows, or low-effort bloated templates.

4. MULTIMODAL & ASSET CREATION:
   - NEVER write raw binary media (.mp4, .png, .mp3) using \`write_file\`.
   - ALWAYS use \`generate_video_asset\` for videos, \`generate_image_asset\` for images, \`generate_svg_asset\` for SVG icons, and \`generate_audio_asset\` for sound.
   - If video generation reports it is unavailable, do NOT insert a placeholder clip — ask the user via \`ask_user\` to provide a real video file.

5. AUTONOMOUS MULTI-ROUND CHAINING:
   - For multi-step or complex tasks, chain tools consecutively across turns without asking unnecessary permission for basic steps.
   - If an error occurs (e.g. build failure, test failure, linter warning), inspect the diagnostic error, formulate a fix hypothesis, and self-heal automatically.

6. PROGRESS PLANNING:
   - At the start of any task with 3+ steps, call \`write_todos\` with the full plan (items with content + status: "pending" | "in_progress" | "completed").
   - Keep it current: re-send the complete list whenever you start or finish an item, so progress stays visible and you never lose track mid-task.
7. VERIFY BEFORE YOU FINISH:
   - After building or changing anything, RUN it: execute the code, start the server, open the file, run the tests — whatever proves the work is done.
   - Check the result against what was asked. If it is not working, fix it and verify again. Repeat until the goal is genuinely achieved or you hit a blocker only the user can resolve (then use ask_user).
   - Never claim success without having executed or verified the result yourself.
${customModelsDoc}`;

              const effectiveSystemPrompt = packet.payload.systemPrompt || defaultSystemPrompt;


              for await (const chunk of sutraHarness.executeHarnessTurn({
                messages,
                signal,
                systemPrompt: effectiveSystemPrompt,
                tokenBudget: profile.safeTpmTokens,
                context: harnessContext as any,
                priorityIds: Array.isArray(packet.payload?.priorityIds) ? packet.payload.priorityIds : undefined,
                autoCompact: typeof packet.payload?.autoCompact === 'boolean' ? packet.payload.autoCompact : undefined,
                autoCompactThreshold: typeof packet.payload?.autoCompactThreshold === 'number' ? packet.payload.autoCompactThreshold : undefined,
              })) {
                if (signal.aborted) break;
                if (chunk.delta) {
                  assistantText += chunk.delta;
                  totalStreamedText += chunk.delta;
                }
                if (chunk.error) {
                  const errorNotice = `\n\n**Astra could not reach the model**: ${toPlainUserError(chunk.error)}\n\n*Check your API key, rate limits, or connection in Settings.*`;
                  assistantText += errorNotice;
                  totalStreamedText += errorNotice;
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { delta: errorNotice }));
                  }
                }
                if (chunk.toolCalls) requestedTools = chunk.toolCalls;
                // Provider retry/failover telemetry for the Activity network log
                if ((chunk as any).retryEvent && ws.readyState === WebSocket.OPEN) {
                  ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { retryEvent: (chunk as any).retryEvent }));
                  mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'chunk', { retryEvent: (chunk as any).retryEvent });
                }
                // Failed attempt left partial text — clear the assistant bubble so the
                // retried answer reads in sequence
                if ((chunk as any).resetContent) {
                  totalStreamedText = totalStreamedText.slice(0, Math.max(0, totalStreamedText.length - assistantText.length));
                  assistantText = '';
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { resetContent: true }));
                  }
                  mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'chunk', { resetContent: true });
                }
                // Only send live deltas, thinking, and toolCalls during intermediate rounds.
                if (!chunk.done && ws.readyState === WebSocket.OPEN) {
                  ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', chunk));
                }
                if (!chunk.done) {
                  mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'chunk', chunk);
                }
              }

              if (signal.aborted) break;

              // Handle turn with no tool calls
              if (requestedTools.length === 0) {
                const isGoalComplete = assistantText.includes('<!-- GOAL_COMPLETE -->') || assistantText.includes('[GOAL_COMPLETE]');

                // Plan-driven continuation: when the model stops calling tools but its
                // own task plan still has unfinished items — or the reply plainly ends
                // mid-thought — nudge it to continue instead of letting the run die.
                let planHasOpenItems = false;
                try {
                  if (fs.existsSync(chatPlanPath)) {
                    const plan = fs.readFileSync(chatPlanPath, 'utf-8');
                    planHasOpenItems = /- \[ \]|\(pending\)|\(in_progress\)/.test(plan);
                  }
                } catch {
                  // No readable plan — nothing to continue from
                }
                const trimmedText = assistantText.trim();
                const looksUnfinished =
                  /[:;]\s*$/.test(trimmedText) ||
                  /\b(let me|next,?|then,?|now i|now let|i will|i'll|verify|checking)\b[^.!?]*$/i.test(trimmedText.slice(-220)) ||
                  trimmedText.length < 120;
                if (!isGoalModeActive && round < maxToolRounds - 1 && (planHasOpenItems || (looksUnfinished && autoContinues < 2))) {
                  if (!planHasOpenItems) autoContinues += 1;
                  messages.push({ role: 'assistant', content: assistantText });
                  messages.push({
                    role: 'user',
                    content: planHasOpenItems
                      ? '[CONTINUE]: Your task plan still has unfinished items (see task_plan.md). Continue working on the next item now — use your tools. When EVERY item is done and you have verified the result, summarize the completed work.'
                      : '[CONTINUE]: You stopped mid-task. Continue with your tools until the full request is done and verified, then summarize.',
                  });
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      thinking: planHasOpenItems
                        ? 'Task plan has unfinished items — continuing automatically.'
                        : 'Response ended mid-task — continuing automatically.',
                    }));
                  }
                  continue;
                }

                if (isGoalModeActive && !isGoalComplete) {
                  if (round < maxToolRounds - 1) {
                    // Goal is still active: prompt next autonomous step
                    messages.push({
                      role: 'assistant',
                      content: assistantText,
                    });
                    messages.push({
                      role: 'user',
                      content: '[AUTONOMOUS /GOAL CONTINUATION]: Keep executing the goal. Proactively use tools to inspect files, implement code, run tests, and verify results. When finished, conclude with <!-- GOAL_COMPLETE -->.',
                    });
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                          thinking: `Autonomous Goal Loop [Step ${round + 1} / ${maxToolRounds}]: Formulating next phase of execution...`,
                        })
                      );
                    }
                    continue; // Continue to next round in the autonomous mission
                  } else {
                    // Goal turn limit reached safely
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                          delta: '\n\n**Autonomous Goal Execution Concluded**: All allocated execution steps completed.\n<!-- GOAL_COMPLETE -->',
                        })
                      );
                    }
                  }
                }
                break;
              }

              // Loop Sentinel: Redundant tool repetition detection (Hard cap: 3 identical invocations)
              const deduplicatedTools = requestedTools.filter((toolCall) => {
                const callSig = `${toolCall.tool}:${JSON.stringify(toolCall.params || {})}`;
                const repCount = (callRepetitionTracker.get(callSig) || 0) + 1;
                callRepetitionTracker.set(callSig, repCount);
                if (repCount >= 3) {
                  console.warn(`[SUTRA Harness Sentinel] Blocked repetitive tool "${toolCall.tool}" after ${repCount} duplicate invocations.`);
                  return false;
                }
                return true;
              });

              if (deduplicatedTools.length === 0) {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      delta: '\n\n*(Stopped a repeating action loop to save your budget — give me a nudge if I went the wrong way.)*',
                    })
                  );
                }
                break;
              }

              // Fix A7: Pre-Flight Sequential Git Micro-Checkpoint before mutating any files
              const destructiveTools = deduplicatedTools.filter((t) =>
                ['write_file', 'edit_file', 'delete_file'].includes(t.tool)
              );
              if (destructiveTools.length > 0) {
                const targetFiles = Array.from(
                  new Set(destructiveTools.map((t) => t.params?.path).filter(Boolean))
                );
                if (targetFiles.length > 0) {
                  try {
                    await gitCheckpoints.createCheckpoint(
                      `Pre-mutation checkpoint before ${targetFiles.join(', ')}`,
                      targetFiles
                    );
                  } catch (err: any) {
                    console.warn('[GitCheckpoint] Pre-flight checkpoint error:', err.message);
                  }
                }
              }

              let hasWaitingApproval = false;

              // Strict mode: every tool call needs user approval except ask_user / write_todos
              const alwaysAllowedTools = ['ask_user', 'write_todos'];
              const toolsToExecute = deduplicatedTools.map((toolCall) => {
                const requiresGate = !alwaysAllowedTools.includes(toolCall.tool);
                if (permissionLevel === 'strict' && requiresGate && toolCall.status !== 'approved') {
                  // Queue with the swarm so /api/swarm/approve-tool can execute it on decision.
                  agentSwarm.queuePendingApproval(toolCall);
                  hasWaitingApproval = true;
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_APPROVAL, 'request', { toolCall }));
                  }
                  return { toolCall, isPending: true };
                }
                return { toolCall, isPending: false };
              });

              // Strict mode: park THIS round on deferred promises until every pending
              // action is approved (executed by /api/swarm/approve-tool), denied, or timed
              // out. The loop then resumes with all results injected into the conversation.
              const approvalDecisions = new Map<string, ApprovalDecision>();
              if (hasWaitingApproval) {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      thinking: 'Waiting for your approval to run this action…',
                    })
                  );
                }
                await Promise.all(
                  toolsToExecute
                    .filter(({ isPending }) => isPending)
                    .map(async ({ toolCall }) => {
                      try {
                        const decision = await waitForApprovalDecision(toolCall, ws);
                        approvalDecisions.set(toolCall.id, decision);
                      } catch {
                        // Socket closed while waiting — treat as denial; abort will end the loop.
                        approvalDecisions.set(toolCall.id, { approved: false });
                      }
                    })
                );
              }

              const executions = await Promise.all(
                toolsToExecute.map(async ({ toolCall }) => {
                  if (signal.aborted) return { toolCall, result: { error: 'Aborted' } };

                  // ask_user is never executed as a normal tool: park this round on a
                  // deferred promise until the user answers agent_question over this socket.
                  if (toolCall.tool === 'ask_user') {
                    const question = typeof toolCall.params?.question === 'string' ? toolCall.params.question.trim() : '';
                    if (!question) {
                      const invalidResult = { error: 'ask_user requires a non-empty "question" string. Re-ask with a clear question.' };
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(createPacket(WSChannel.AGENT_TOOL_CALL, 'error', {
                          id: toolCall.id,
                          tool: 'ask_user',
                          error: invalidResult.error,
                        }));
                      }
                      return { toolCall, result: invalidResult };
                    }
                    const rawOptions = Array.isArray(toolCall.params?.options)
                      ? toolCall.params.options.filter((o: unknown) => typeof o === 'string' && o.trim().length > 0).slice(0, 4)
                      : [];
                    const allowFreeText = toolCall.params?.allow_free_text !== false;
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(createPacket(WSChannel.AGENT_STREAM, 'agent_question', {
                        id: toolCall.id,
                        question,
                        options: rawOptions,
                        allowFreeText,
                      }));
                    }
                    const answer = await waitForAgentAnswer(toolCall.id, ws);
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(createPacket(WSChannel.AGENT_TOOL_CALL, 'result', {
                        id: toolCall.id,
                        tool: 'ask_user',
                        result: { status: 'answered', answer },
                      }));
                    }
                    executedToolsSummary.push('`ask_user`');
                    // Plain string result -> the role:'tool' message becomes exactly:
                    // User answered: "<answer>"
                    return { toolCall, result: `User answered: "${answer}"` };
                  }

                  const callSignature = `${toolCall.tool}:${JSON.stringify(toolCall.params)}`;
                  const toolParamSummary = toolCall.params?.path || toolCall.params?.command || toolCall.params?.query || toolCall.params?.url || '';

                  const execDescription = `\`${toolCall.tool}\`${toolParamSummary ? ` (\`${JSON.stringify(toolParamSummary).slice(0, 45)}\`)` : ''}`;

                  // Approved/denied decisions from the strict-mode pause above
                  const decision = approvalDecisions.get(toolCall.id);
                  if (decision && !decision.approved) {
                    const denialMessage = decision.timedOut
                      ? 'Timed out waiting for your approval — skipping this action.'
                      : 'Denied — skipping this action.';
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        createPacket(WSChannel.AGENT_TOOL_CALL, 'result', {
                          id: toolCall.id,
                          tool: toolCall.tool,
                          result: { status: 'skipped', message: denialMessage },
                        })
                      );
                    }
                    return { toolCall, result: { status: 'skipped', message: denialMessage } };
                  }
                  if (decision && decision.approved) {
                    // Already executed by /api/swarm/approve-tool — reuse its result.
                    executedToolsSummary.push(execDescription);
                    return { toolCall, result: decision.result };
                  }

                  try {
                    // Harness gate: loop sentinel, pre-mutation checkpoints, CRLF normalization
                    const allowed = await sutraHarness.runToolExecutionHooks(toolCall, harnessContext as any);
                    if (!allowed) {
                      const blockedResult = { error: 'Blocked: this exact action was already attempted too many times.' };
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                          createPacket(WSChannel.AGENT_TOOL_CALL, 'error', {
                            id: toolCall.id,
                            tool: toolCall.tool,
                            error: blockedResult.error,
                          })
                        );
                      }
                      return { toolCall, result: blockedResult };
                    }

                    executedToolsSummary.push(execDescription);

                    // Broadcast inline diff for editor visualization
                    if (ws.readyState === WebSocket.OPEN && (toolCall.tool === 'write_file' || toolCall.tool === 'edit_file')) {
                      ws.send(createPacket(WSChannel.AGENT_STREAM, 'inline_diff', {
                        path: toolCall.params?.path || 'workspace',
                        proposedContent: toolCall.params?.content || toolCall.params?.replacement || '',
                      }));
                    }

                    let result = await agentSwarm.executeTool(toolCall, { planFilePath: chatPlanPath });

                    // Post-tool plugins: secret redaction, AST compaction, recovery advice
                    result = await sutraHarness.runAfterToolHooks(toolCall, result, harnessContext as any);

                    // Durable reliability stat — parked approvals are not outcomes.
                    try {
                      const parked = result && typeof result === 'object' && result.status === 'waiting_for_user_approval';
                      if (!parked) {
                        recordToolOutcome(toolCall.tool, !(result && typeof result === 'object' && result.error));
                      }
                    } catch {
                      // Stats must never break execution
                    }

                    // Broadcast updated swarm state to UI
                    if (toolCall.tool === 'spawn_subagent') {
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(createPacket(WSChannel.SWARM_STATE, 'update', { subagents: agentSwarm.getSubagentStates() }));
                      }
                    }

                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        createPacket(WSChannel.AGENT_TOOL_CALL, 'result', {
                          id: toolCall.id,
                          tool: toolCall.tool,
                          result,
                        })
                      );
                    }
                    return { toolCall, result };
                  } catch (err: any) {
                    // Fix A5: Execution-Feedback Self-Healing with Hard Block on 3rd failure
                    const failCount = (failedCallTracker.get(callSignature) || 0) + 1;
                    failedCallTracker.set(callSignature, failCount);

                    let failureAdvice = selfHealingEngine.formatSelfHealingPrompt(toolCall.tool, err.message, callSignature);
                    if (failCount >= 3) {
                      failureAdvice = 'This exact action failed 3 times and was stopped to protect your workflow. Inspect the file with a fresh read, then adjust the approach.';
                    } else if (failCount >= 2) {
                      failureAdvice += `\nHeads up: this same action failed ${failCount} times with identical arguments — re-read the file or try a different approach.`;
                    }

                    const result = { error: failureAdvice };
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        createPacket(WSChannel.AGENT_TOOL_CALL, 'error', {
                          id: toolCall.id,
                          tool: toolCall.tool,
                          error: failureAdvice,
                        })
                      );
                    }
                    return { toolCall, result };
                  }
                })
              );

              if (signal.aborted) break;

              // Record which files this round actually mutated (failed/skipped calls excluded)
              for (const execution of executions) {
                if (!['write_file', 'edit_file', 'delete_file', 'rename_path'].includes(execution.toolCall.tool)) continue;
                const resultAny = execution.result as any;
                if (resultAny && (resultAny.error || resultAny.status === 'skipped')) continue;
                const target = execution.toolCall.params?.path || execution.toolCall.params?.oldPath || '';
                if (target) mutatedFiles.add(String(target));
              }

              // Semantic stagnation check over what actually executed this round.
              // A warning injects one strategic nudge; a block ends the loop below
              // via worstStagnationLevel before more budget is burned.
              for (const execution of executions) {
                const resultAny = execution.result as any;
                const ok = !(resultAny?.error || resultAny?.status === 'skipped');
                try {
                  const assessment = stagnationDetector.record({
                    tool: execution.toolCall.tool,
                    params: execution.toolCall.params,
                    ok,
                  });
                  if (assessment.level !== 'none' && assessment.level !== 'block') {
                    worstStagnationLevel = worstStagnationLevel === 'block' ? 'block' : 'warn';
                  }
                  if (assessment.level === 'block') {
                    worstStagnationLevel = 'block';
                  }
                  if (assessment.level === 'warn' && !stagnationNudged && !signal.aborted) {
                    stagnationNudged = true;
                    messages.push({
                      role: 'user',
                      content: `[FOCUS]: ${assessment.reason}. Stop repeating this approach — re-read the current state, change strategy, or ask the user with ask_user if you are stuck.`,
                    });
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                        thinking: `Repeating pattern detected (${assessment.reason}) — nudging toward a different approach.`,
                      }));
                    }
                  }
                } catch {
                  // Stagnation tracking must never break tool flow
                }
              }

              // Hard semantic stop: the run keeps redoing converged-on work.
              if (worstStagnationLevel === 'block') {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                    delta: '\n\n*(Stopped a repeating action loop to save your budget — give me a nudge if I went the wrong way.)*',
                  }));
                }
                break;
              }

              // One compact audit event per round — per-tool outcome flags, no payloads.
              if (runLogId && executions.length > 0) {
                try {
                  recordEvent(runLogId, 'ToolsExecuted', {
                    round: round + 1,
                    tools: executions.map((e) => ({
                      tool: e.toolCall.tool,
                      ok: !((e.result as any)?.error || (e.result as any)?.status === 'skipped'),
                    })),
                  });
                } catch {
                  // Audit logging must never break the run itself
                }
              }

              messages.push({
                role: 'assistant',
                content: assistantText || null,
                tool_calls: deduplicatedTools.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.tool, arguments: JSON.stringify(call.params) },
                })),
              });

              // Fix A2: Truncate tool results strictly before injecting into messages array
              for (const execution of executions) {
                const rawResult = typeof execution.result === 'string' ? execution.result : JSON.stringify(execution.result);
                const maxOutputChars = Math.min(profile.maxToolOutputChars || 3000, 3500);
                const cleanContent = SecurityGuardrails.truncateToolOutput(
                  SecurityGuardrails.redactSecrets(rawResult),
                  maxOutputChars
                );

                messages.push({
                  role: 'tool',
                  tool_call_id: execution.toolCall.id,
                  content: cleanContent,
                });
              }
            }

            // Anti-Empty Reply Sentinel: Guarantee an informative response is always streamed
            if (!totalStreamedText.trim() && !signal.aborted) {
              if (executedToolsSummary.length > 0) {
                const summaryNotice = `\n\n**Completed ${executedToolsSummary.length} operation${executedToolsSummary.length > 1 ? 's' : ''} across the workspace:**\n` +
                  executedToolsSummary.slice(-8).map((s) => `• ${s}`).join('\n') +
                  `\n\n*(Round completed — tool results are summarized above.)*`;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { delta: summaryNotice }));
                }
              } else {
                const fallbackNotice = '\n\n**Ready.** Please specify what you would like to build, debug, or refactor in this workspace.';
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { delta: fallbackNotice }));
                }
              }
            }

            // Verification stage: mutated work is proven with real project checks,
            // never accepted from the agent's own claim of success. Runs even when
            // the client has disconnected — every send below guards its own socket,
            // and the durable outcome must not depend on who is listening.
            let verificationPassed: boolean | null = null;
            if (!signal.aborted && mutatedFiles.size > 0) {
              try {
                const report = await runWorkspaceVerification({
                  workspaceRoot: fsTools.getWorkspaceRoot(),
                  filesChanged: mutatedFiles.size,
                  permissionMode: permissionLevel,
                  onProgress: (message) => {
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { thinking: message }));
                      mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'chunk', { thinking: message });
                    }
                  },
                });
                verificationPassed = report.allPassed;
                // Failure intelligence: real verification failures become durable
                // lessons so the next run starts already knowing this pitfall.
                const failedChecks = report.checks.filter((c) => c.status === 'failed' || c.status === 'timeout');
                if (failedChecks.length > 0) {
                  try {
                    for (const check of failedChecks) {
                      rememberMemory({
                        kind: 'lesson',
                        content: `Verification "${check.name}" failed in this workspace: ${check.summary}`,
                        workspaceRoot: fsTools.getWorkspaceRoot(),
                      });
                    }
                    pruneMemories();
                  } catch {
                    // Memory recording must never break a run
                  }
                }
                if (report.checks.length > 0 && ws.readyState === WebSocket.OPEN) {
                  ws.send(createPacket(WSChannel.AGENT_STREAM, 'verification', { report }));
                }
                if (report.checks.length > 0) {
                  mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'verification', { report });
                }
                if (runLogId) {
                  try {
                    recordEvent(runLogId, 'VerificationCompleted', {
                      allPassed: report.allPassed,
                      checks: report.checks.map((c) => ({ name: c.name, status: c.status })),
                    });
                  } catch {
                    // Audit logging must never break the run itself
                  }
                }
              } catch (err: any) {
                // Verification must never fail the run it is verifying.
                console.warn('[SUTRA] Verification stage skipped:', err?.message);
              }
            }

            endRun(signal.aborted ? 'cancelled' : 'completed', {
              filesMutated: mutatedFiles.size,
              verificationPassed,
            });

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { done: true, usage: modelRouter.lastRunUsage || undefined }));
            }
          } catch (err: any) {
            console.error('[WS Agent] Fatal stream error:', err);
            endRun('failed');
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                done: true,
                delta: `\n\n*(Something went wrong while Astra was working: ${toPlainUserError(err.message)})*`,
              }));
            }
          } finally {
            agentRunActive = false;
            // Sweep any approval deferrals and ask_user parks left behind by an
            // aborted/errored run so nothing hangs on a dead round.
            rejectApprovalsForSocket(ws, 'RUN_ENDED');
            resolveQuestionsForSocket(ws);
          }
        }
        break;

      case WSChannel.AGENT_TOOL_CALL:
        if (packet.type === 'execute') {
          try {
            const result = await agentSwarm.executeTool(packet.payload);
            ws.send(createPacket(WSChannel.AGENT_TOOL_CALL, 'result', { id: packet.payload.id, result }));
          } catch (err: any) {
            ws.send(createPacket(WSChannel.AGENT_TOOL_CALL, 'error', { id: packet.payload.id, error: err.message }));
          }
        }
        break;

      case WSChannel.PING_PONG:
        ws.send(createPacket(WSChannel.PING_PONG, 'pong', { time: Date.now() }));
        break;
    }
  });

  ws.on('close', () => {
    if (activeAgentAbortController) {
      activeAgentAbortController.abort();
      activeAgentAbortController = null;
    }
    // Reject any pending strict-mode approval deferrals parked on this socket.
    rejectApprovalsForSocket(ws, 'CONNECTION_CLOSED');
    // Resolve any parked ask_user questions with the fallback answer.
    resolveQuestionsForSocket(ws);
  });
});

// Serves the SPA entry: the built production bundle when present, otherwise the
// dev index.html (only useful while Vite is transforming modules).
function sendSpaIndex(res: express.Response): void {
  const distIndex = path.join(rootDir, 'dist', 'index.html');
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.sendFile(path.join(rootDir, 'index.html'));
  }
}

// Fallback route for SPA - send built production index.html so mobile devices load cleanly
app.get('*', (_req, res) => {
  sendSpaIndex(res);
});

server.listen(PORT, '0.0.0.0', () => {
  startScheduler(PORT);
  console.log(`\n======================================================`);
  console.log(`SUTRA IDE server is active`);
  console.log(`Workspace: http://localhost:${PORT}`);
  console.log(`Live Preview: http://localhost:${PORT}/preview`);
  console.log(`Mobile Companion: http://${mobileBridge.getLanIp()}:${PORT}/mobile`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API version:  http://localhost:${PORT}/api/version`);
  console.log(`======================================================\n`);
});

// [Improvement A6] Graceful shutdown — close WSS, HTTP server, DB, flush checkpoint stash, shutdown LSP
let shuttingDown = false;
const gracefulShutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[SUTRA] Received ${signal}. Initiating graceful shutdown...`);
  try {
    wss.clients.forEach((ws) => { try { ws.close(1012, 'Server shutting down'); } catch { /* socket already torn down */ } });
    wss.close();
  } catch {
    // WebSocket server already closed — nothing left to release
  }
  try {
    await lspManager.shutdown();
    console.log('[SUTRA] LSP servers shut down cleanly');
  } catch {
    // LSP shutdown must never block process exit
  }
  try {
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
    db.close();
  } catch {
    // Best-effort flush — the OS closes the file descriptor on exit regardless
  }
  const shutdownTimer = setTimeout(() => {
    console.warn('[SUTRA] Shutdown timeout — force exit.');
    process.exit(1);
  }, 8000);
  server.close(() => {
    clearTimeout(shutdownTimer);
    console.log('[SUTRA] Goodbye. Server exited cleanly.');
    process.exit(0);
  });
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[SUTRA] uncaughtException:', err);
  gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});
