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
import os from 'os';

import { modelRouter, learnedModelLimits } from './modelRouter.js';
import { agentSwarm, classifyCommand } from './agentSwarm.js';
import { mediaEngine } from './mediaEngine.js';
import { fsTools } from './tools/fsTools.js';
import { ptyManager } from './ptyManager.js';
import { mobileBridge } from './mobileBridge.js';
import { CompletionEngine } from './completionEngine.js';
import { mcpClient } from './mcp/mcpClient.js';
import { customModelsManager } from './customModels.js';
import { authRoutes } from './routes/authRoutes.js';
import { gitCheckpoints } from './harness/gitCheckpoints.js';
import { selfHealingEngine } from './harness/selfHealing.js';
import { sutraHarness } from './harness/sutraHarness.js';
import { compactConversationContext } from './harness/agentHarnessEngine.js';
import { buildMasterSystemPrompt } from './harness/agentPromptArchitecture.js';
import { runWorkspaceVerification } from './harness/verification.js';
import { initRunLog, startRun, recordEvent, finishRun, listRuns, getRunDetail } from './harness/runLog.js';
import {
  initMemory,
  rememberMemory,
  forgetMemory,
  listMemories,
  touchMemories,
  pruneMemories,
  consolidateMemories,
  buildMemorySection,
  AgentMemoryEngine,
  updateWorkingMemory,
  storeSemanticFact,
  getSemanticFacts,
  tombstoneSemanticFact,
  recordEpisodicEpisode,
  searchEpisodicEpisodes,
  reflectOnEpisode,
  recordProceduralRecipe,
  findProceduralRecipes,
  getParametricMemoryProfile,
  scheduleProspectiveTask,
  listPendingProspectiveTasks,
  completeProspectiveTask,
  cancelProspectiveTask,
} from './harness/memory.js';
import { initToolStats, recordToolOutcome, buildToolStatsSection } from './harness/toolStats.js';
import { initCodeNotes, buildCodeNotesSection, touchCodeNotes } from './harness/codeNotes.js';
import { StagnationDetector, shouldExtendRun } from './harness/stagnation.js';
import { rescueToolDialects } from './harness/toolDialectRescue.js';
import { executeToolBatchWithScheduler } from './harness/toolExecutionScheduler.js';
import { WSChannel, createPacket, parsePacket } from './wsProtocol.js';
import { SecurityGuardrails } from './security/guardrails.js';
import { SUTRA_ALL_PROVIDERS } from './providers/catalog.js';
import { providerAuthHandler } from './providers/authHandler.js';
import { describeLocalAntigravitySignIn, hasLocalAntigravitySignIn, discoverAntigravityProxy, ensureAntigravityDaemonRunning } from './providers/antigravityBridge.js';
import { CodebaseIndexer } from './tools/codebaseIndexer.js';
import { gzip } from 'zlib';
import dotenv from 'dotenv';
import db from './db.js';
import { initScheduler, startScheduler, listTasks, getTask, createTask, updateTask, deleteTask, runTaskViaLoopbackForTask } from './scheduler.js';
import { initArtifacts, listArtifacts, getArtifact, upsertArtifact, deleteArtifact } from './artifacts.js';
import { processManager } from './processManager.js';
import { LSPManager } from './lsp/lspManager.js';
import { lspTools } from './tools/lspTools.js';
import { getWorkspaceSnapshot } from './workspaceContext.js';
import { chatProxy } from './proxy/chatProxy.js';
import { imageProxy } from './proxy/imageProxy.js';
import { browserBridge } from './proxy/browserBridge.js';
import { scratchManager } from './scratchManager.js';

const completionEngine = new CompletionEngine(modelRouter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Initialize AST Codebase Indexer & LSP asynchronously after server listen
const codebaseIndexer = new CodebaseIndexer(rootDir);
const lspManager = new LSPManager(rootDir);
lspTools.setLSPManager(lspManager);

setImmediate(() => {
  codebaseIndexer.buildIndex().then((res) => {
    console.log(`[Codebase Indexer] Indexed ${res.symbolCount} AST symbols across ${res.fileCount} files.`);
  }).catch(() => undefined);

  lspManager.initialize().then(() => {
    console.log('[LSP Manager] TypeScript language server initialized');
  }).catch((err) => {
    console.warn('[LSP Manager] Failed to initialize:', err.message);
  });
});

// Load environment variables
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config();

// Load stored API keys from SQLite into modelRouter
try {
  const storedProviders = db.prepare('SELECT id, api_key, base_url FROM providers').all() as any[];
  for (const prov of storedProviders) {
    if (prov.api_key) {
      const lowerId = prov.id.toLowerCase();
      modelRouter.setApiKey(lowerId, prov.api_key);
      if (lowerId === 'google') modelRouter.setApiKey('gemini', prov.api_key);
      if (lowerId === 'gemini') modelRouter.setApiKey('google', prov.api_key);
      if (prov.base_url) modelRouter.setBaseUrl(lowerId, prov.base_url);
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

// Restore the durably selected active model so the choice survives restarts
// instead of silently reverting to the default. Best-effort: a persisted id
// that no longer resolves (unregistered custom model) keeps the default.
try {
  const activeModelRow = db.prepare("SELECT value FROM system_config WHERE key = 'activeModel'").get() as any;
  if (activeModelRow?.value) {
    modelRouter.setActiveModel(String(activeModelRow.value));
  }
} catch {
  // Fresh database or unreadable table — the default selection stays active
}

// Eagerly connect to or auto-spawn local Antigravity Language Server daemon
try {
  const proxy = discoverAntigravityProxy();
  if (proxy) {
    console.log(`[SUTRA] Antigravity Language Server bridge connected (PID ${proxy.pid} on port ${proxy.port}).`);
  } else {
    ensureAntigravityDaemonRunning().then((spawned) => {
      if (spawned) {
        console.log(`[SUTRA] Antigravity Language Server auto-spawned (PID ${spawned.pid} on port ${spawned.port}).`);
      }
    }).catch(() => undefined);
  }
} catch {
  // Graceful fallback if proxy is not yet launched
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

let PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
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
  '/api/providers/catalog',
  '/api/mobile/pairing-qr',
  '/api/media/settings',
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
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  next();
});

// Response compression (asynchronous non-blocking gzip for responses > 1KB)
app.use((req, res, next) => {
  const oldSend = res.send.bind(res);
  res.send = (body) => {
    const acceptEnc = req.headers['accept-encoding'] || '';
    if (typeof body === 'string' && body.length > 1024 && acceptEnc.includes('gzip')) {
      gzip(Buffer.from(body, 'utf-8'), (err, compressed) => {
        if (!err && compressed) {
          res.setHeader('Content-Encoding', 'gzip');
          return oldSend(compressed);
        }
        return oldSend(body);
      });
      return res;
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
  // Read-only requests never burn budget: the Manager sidebar polls cheap
  // SQLite-backed GET lists (/api/chat/sessions among them) next to every other
  // UI request, and sharing one bucket made those lists fail with 429. A GET
  // list must never be throttled; mutating verbs keep the bucket exactly as before.
  if (req.method === 'GET') return next();

  // Key on the actual socket address — x-forwarded-for is client-spoofable.
  const ip = (req.socket.remoteAddress || 'local').toString().split(',')[0].trim();

  // Loopback / local desktop requests must never be throttled with 429.
  const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === 'local' || ip === 'localhost' || ip === '::ffff:127.0.0.1';
  if (isLoopback) return next();

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
export function isLoopbackAddress(addr: string): boolean {
  if (!addr) return false;
  const clean = addr.replace(/^\[|\]$/g, '');
  return (
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === '::ffff:127.0.0.1' ||
    clean.endsWith('127.0.0.1')
  );
}

export function isLoopbackOrigin(originStr: string | undefined): boolean {
  if (!originStr) return true;
  try {
    const parsed = new URL(originStr);
    return isLoopbackAddress(parsed.hostname) || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

function isLocalSafeRequest(req: express.Request): boolean {
  const addr = req.socket?.remoteAddress || req.ip || '';
  if (!isLoopbackAddress(addr)) return false;

  // Anti-CSRF: If Origin header is present, verify it is loopback/localhost
  const origin = req.headers.origin;
  if (origin && !isLoopbackOrigin(origin)) {
    return false;
  }

  // Anti-CSRF: If Referer header is present, verify its origin is loopback/localhost
  const referer = req.headers.referer;
  if (referer && !isLoopbackOrigin(referer)) {
    return false;
  }

  // If Sec-Fetch-Site is cross-site, reject mutating requests
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return false;
  }

  return true;
}

app.use((req, res, next) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/v1')) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();

  // Explicitly block untrusted cross-origin requests to API endpoints
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if ((origin && !isLoopbackOrigin(origin)) || (referer && !isLoopbackOrigin(referer))) {
    return res.status(403).json({ error: 'Cross-origin access from external origins is prohibited.' });
  }

  if (isLocalSafeRequest(req)) return next();
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

// Resolve isolated user workspace root so internal IDE engine code is NEVER exposed as default workspace
function resolveDefaultWorkspaceRoot(): string {
  try {
    const row = db.prepare(`SELECT value FROM system_config WHERE key = 'active_workspace'`).get() as any;
    if (row?.value && typeof row.value === 'string' && fs.existsSync(row.value) && path.resolve(row.value) !== path.resolve(rootDir)) {
      return row.value;
    }
  } catch {}
  
  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const defaultUserWorkspace = path.join(userHome, '.sutra', 'workspace');
  if (!fs.existsSync(defaultUserWorkspace)) {
    try {
      fs.mkdirSync(defaultUserWorkspace, { recursive: true });
      const readmePath = path.join(defaultUserWorkspace, 'README.md');
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(
          readmePath,
          '# SUTRA IDE Workspace\n\nWelcome to your autonomous AI development workspace.\n\n- Ask Astra to build applications, debug code, or run commands.\n- Use the Folder button in the titlebar to open any repository from your system.\n',
          'utf8'
        );
      }
    } catch {}
  }
  return defaultUserWorkspace;
}

const initialWorkspaceRoot = resolveDefaultWorkspaceRoot();

// Set workspace root for all tools
fsTools.setWorkspaceRoot(initialWorkspaceRoot);
ptyManager.setWorkspaceRoot(initialWorkspaceRoot);
mediaEngine.setProjectRoot(initialWorkspaceRoot);
codebaseIndexer.setWorkspaceRoot(initialWorkspaceRoot);

// Scheduled tasks + trackable work artifacts + run/event audit log (persist across restarts)
initScheduler(db);
initArtifacts(initialWorkspaceRoot);
initRunLog(db);
initMemory(db);
initToolStats(db);
initCodeNotes(db);

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
    } else if (filePath.endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
    } else if (filePath.endsWith('.wav')) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
    } else if (filePath.endsWith('.ogg')) {
      res.setHeader('Content-Type', 'audio/ogg');
      res.setHeader('Accept-Ranges', 'bytes');
    } else if (filePath.endsWith('.m4a')) {
      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
    } else if (filePath.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
    }
  },
}));
app.use('/assets', express.static(path.join(rootDir, 'dist', 'assets')));
app.use('/public', express.static(path.join(rootDir, 'public')));

export function getFallbackStylesheet(requestedFile = 'style.css'): string {
  return `/* Modern Responsive CSS Fallback generated by SUTRA/Omnicraft IDE for ${requestedFile} */
:root {
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  --bg-primary: #0f172a;
  --bg-surface: #1e293b;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --border: #334155;
  --radius: 0.75rem;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg-primary: #f8fafc;
    --bg-surface: #ffffff;
    --text-primary: #0f172a;
    --text-secondary: #64748b;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --border: #e2e8f0;
  }
}
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  font-family: var(--font-sans);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  padding: 2rem 1rem;
  max-width: 1200px;
  margin: 0 auto;
}
h1, h2, h3, h4, h5, h6 {
  color: var(--text-primary);
  line-height: 1.25;
  margin-bottom: 0.75rem;
}
p {
  color: var(--text-secondary);
  margin-bottom: 1rem;
}
a {
  color: var(--accent);
  text-decoration: none;
  transition: color 0.15s ease;
}
a:hover {
  text-decoration: underline;
  color: var(--accent-hover);
}
button, .btn, input[type="submit"], input[type="button"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.625rem 1.25rem;
  border-radius: var(--radius);
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  background-color: var(--accent);
  color: #ffffff;
  border: none;
  transition: background-color 0.15s ease, transform 0.1s ease;
}
button:hover, .btn:hover {
  background-color: var(--accent-hover);
}
input, textarea, select {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background-color: var(--bg-surface);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
input:focus, textarea:focus, select:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.card, article, section.box {
  background-color: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}
img {
  max-width: 100%;
  height: auto;
  border-radius: calc(var(--radius) - 2px);
}
`;
}

export function resolveWorkspaceCss(root: string, requestedPath: string): string | null {
  const clean = requestedPath.replace(/^[/\\]+/, '');
  const basename = path.basename(clean);
  const ext = path.extname(clean).toLowerCase();
  if (ext !== '.css') return null;

  // 1. Direct candidates relative to root
  const directCandidates = [
    path.join(root, clean),
    path.join(root, 'public', clean),
    path.join(root, 'dist', clean),
    path.join(root, 'assets', clean),
    path.join(root, 'src', clean),
    path.join(root, 'workspace', clean),
  ];
  for (const c of directCandidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }

  // 2. Singular/plural and common alias candidates
  const altNames: string[] = [];
  if (basename === 'styles.css') altNames.push('style.css', 'main.css', 'app.css', 'index.css');
  else if (basename === 'style.css') altNames.push('styles.css', 'main.css', 'app.css', 'index.css');
  else if (basename === 'main.css') altNames.push('style.css', 'styles.css', 'app.css');
  else if (basename === 'app.css') altNames.push('style.css', 'styles.css', 'main.css');
  else altNames.push('style.css', 'styles.css', 'main.css');

  const candidateDirs = ['', 'css', 'styles', 'public', 'public/css', 'public/styles', 'assets', 'assets/css', 'src', 'dist'];
  for (const alt of altNames) {
    for (const d of candidateDirs) {
      const candidate = path.join(root, d, alt);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  // 3. Scan root and 1-level subdirs for ANY valid .css file in the project
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith('.css')) {
        return path.join(root, ent.name);
      }
      if (ent.isDirectory() && ['css', 'styles', 'public', 'assets', 'src'].includes(ent.name)) {
        try {
          const subEntries = fs.readdirSync(path.join(root, ent.name), { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isFile() && sub.name.endsWith('.css')) {
              return path.join(root, ent.name, sub.name);
            }
          }
        } catch {}
      }
    }
  } catch {}

  return null;
}

export function resolveWorkspaceJs(root: string, requestedPath: string): string | null {
  const clean = requestedPath.replace(/^[/\\]+/, '');
  const basename = path.basename(clean);
  const ext = path.extname(clean).toLowerCase();
  if (ext !== '.js' && ext !== '.mjs') return null;

  const directCandidates = [
    path.join(root, clean),
    path.join(root, 'public', clean),
    path.join(root, 'dist', clean),
    path.join(root, 'assets', clean),
    path.join(root, 'src', clean),
    path.join(root, 'workspace', clean),
  ];
  for (const c of directCandidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }

  const altNames: string[] = [];
  if (basename === 'script.js') altNames.push('scripts.js', 'main.js', 'app.js', 'index.js');
  else if (basename === 'scripts.js') altNames.push('script.js', 'main.js', 'app.js');
  else if (basename === 'main.js') altNames.push('script.js', 'app.js', 'index.js');
  else if (basename === 'app.js') altNames.push('main.js', 'script.js', 'index.js');
  else altNames.push('main.js', 'script.js', 'app.js');

  const candidateDirs = ['', 'js', 'scripts', 'public', 'public/js', 'assets', 'assets/js', 'src', 'dist'];
  for (const alt of altNames) {
    for (const d of candidateDirs) {
      const candidate = path.join(root, d, alt);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }
  return null;
}

// Workspace Asset Fallback Middleware:
// Catches root-relative requests (/css/*, /js/*, /styles/*, /images/*, /img/*, /fonts/*, /styles.css, etc.)
// originating from workspace previews (via Referer or direct root asset fetches).
app.use((req, res, next) => {
  const urlPath = req.path;
  const referer = req.headers.referer || '';
  const isFromWorkspace = referer.includes('/workspace') || referer.includes('/preview');
  const dest = req.headers['sec-fetch-dest'];
  const isAssetDest = dest === 'style' || dest === 'script' || dest === 'image' || dest === 'font';

  // Check if this request is targeting a workspace static asset
  const isCss = urlPath.endsWith('.css');
  const isJs = urlPath.endsWith('.js') || urlPath.endsWith('.mjs');
  const isCommonAssetFolder = /^\/(css|js|styles|assets|images|img|fonts|media|static)\//i.test(urlPath);

  // If this is a host IDE request to its own bundle (e.g. /assets/index-xxx.js), let next() serve it
  if (urlPath.startsWith('/assets/') && !isFromWorkspace) {
    return next();
  }

  // If this is an API, preview proxy, or websocket route, let normal routing proceed
  if (urlPath.startsWith('/api') || urlPath.startsWith('/preview') || urlPath.startsWith('/workspace') || urlPath.startsWith('/ws')) {
    return next();
  }

  // If this is a static asset request from a workspace preview OR requesting a root CSS/asset:
  if (isCss || isCommonAssetFolder || isFromWorkspace || isAssetDest) {
    const wsRoot = fsTools.getWorkspaceRoot();
    const cleanRel = urlPath.replace(/^[/\\]+/, '');

    if (isCss) {
      const resolvedCss = resolveWorkspaceCss(wsRoot, cleanRel);
      if (resolvedCss) {
        return res.sendFile(resolvedCss, {
          headers: {
            'Content-Type': 'text/css; charset=utf-8',
            'Content-Disposition': 'inline',
            'Cache-Control': 'no-store',
          },
        });
      }
      if (isFromWorkspace || dest === 'style') {
        const fallback = getFallbackStylesheet(path.basename(cleanRel));
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline');
        return res.send(fallback);
      }
    }

    if (isJs) {
      const resolvedJs = resolveWorkspaceJs(wsRoot, cleanRel);
      if (resolvedJs) {
        return res.sendFile(resolvedJs, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Content-Disposition': 'inline',
            'Cache-Control': 'no-store',
          },
        });
      }
    }

    // Check direct file candidates in workspace
    const candidatePaths = [
      path.join(wsRoot, cleanRel),
      path.join(wsRoot, 'public', cleanRel),
      path.join(wsRoot, 'dist', cleanRel),
      path.join(wsRoot, 'src', cleanRel),
      path.join(wsRoot, 'assets', cleanRel),
    ];
    for (const c of candidatePaths) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return res.sendFile(c, { headers: { 'Content-Disposition': 'inline' } });
      }
    }
  }

  next();
});
app.use(express.static(path.join(rootDir, 'dist'), {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none';");
    }
  },
}));

// Route root entry directly through sendSpaIndex with frame-ancestors: none protection
app.get('/', (_req, res) => {
  sendSpaIndex(res);
});

/* ----------------------------------------------------
 * REST API ENDPOINTS
 * ---------------------------------------------------- */

// 0. Auth & Session Management (Modular Router)
app.use('/api/auth', authRoutes);

// 1. Setup & Onboarding
// Setup gate: the IDE is usable once at least one provider row carries a real
// credential (API key or session cookie) or the local Antigravity Google sign-in is present.
// Never throws on a fresh database — an unreadable table simply reports "no credential yet".
app.get('/api/setup/status', (_req, res) => {
  try {
    const rows = db.prepare('SELECT api_key, cookie_data FROM providers').all() as Array<{ api_key?: string | null; cookie_data?: string | null }>;
    const hasRowCredential = rows.some(
      (row) => Boolean((row.api_key && String(row.api_key).trim()) || (row.cookie_data && String(row.cookie_data).trim()))
    );
    const hasLocalGoogleSignIn = hasLocalAntigravitySignIn();
    const hasCredential = hasRowCredential || hasLocalGoogleSignIn;
    res.json({ hasCredential, providerCount: rows.length, isSetupComplete: hasCredential, hasLocalAntigravitySignIn: hasLocalGoogleSignIn });
  } catch {
    // Fresh or locked DB — fail safe with local sign-in check
    const hasLocalGoogleSignIn = hasLocalAntigravitySignIn();
    res.json({ hasCredential: hasLocalGoogleSignIn, providerCount: 0, isSetupComplete: hasLocalGoogleSignIn, hasLocalAntigravitySignIn: hasLocalGoogleSignIn });
  }
});

app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ status: 'healthy', ok: true, uptime: process.uptime(), timestamp: Date.now() });
});

// 1. modelRouter Models & Custom Provider Registration
app.get('/api/models', (_req, res) => {
  // Lazy re-discovery: newly released platform models appear without a restart.
  // refreshRemoteModels self-throttles (in-flight dedupe + min interval), so this
  // is at most one background sweep per interval no matter how often the UI polls.
  modelRouter.refreshRemoteModels().catch(() => undefined);
  // usableModels tells the UI exactly which models will actually route right now,
  // so the dropdown never advertises a model that fails the moment it is selected.
  const usable = modelRouter.getUsableModels();
  res.json({
    activeModel: modelRouter.getActiveModel(),
    models: modelRouter.getAllModels(),
    usableModels: usable.usable,
    providerStatus: usable.providers,
    customProviders: modelRouter.getCustomProviders(),
    configuredKeys: modelRouter.getAllApiKeys(),
  });
});

app.post('/api/models/refresh', safeHandler(async (_req, res) => {
  const result = await modelRouter.refreshRemoteModels(true);
  res.json({
    success: true,
    added: result.added,
    models: modelRouter.getAllModels(),
  });
}));

app.post('/api/models/keys', (req, res) => {
  const keys = req.body?.keys;
  if (!keys || typeof keys !== 'object') {
    return res.status(400).json({ success: false, error: 'Expected a keys object' });
  }
  for (const [provider, key] of Object.entries(keys)) {
    if (typeof key === 'string' && key.trim()) {
      modelRouter.setApiKey(provider, key.trim());
      if (provider === 'gateway') {
        mediaEngine.setGatewayApiKey(key.trim());
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
  const { modelId, provider, fullId } = req.body;
  const targetId = fullId || (provider && modelId ? `${provider}:${modelId}` : modelId);
  const ok = modelRouter.setActiveModel(targetId, provider);
  if (ok && targetId) {
    try {
      db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('activeModel', ?)").run(targetId);
    } catch {
      // Best-effort SQLite persistence
    }
  }
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
    const providerId = String(provider || id);
    modelRouter.setApiKey(providerId, apiKey.trim());
    // Persist through the credential store too, so the Providers tab and the
    // request-signing bridge see the SAME saved key instead of asking again.
    providerAuthHandler.saveCredential({
      providerId,
      authType: 'api-key',
      apiKey: apiKey.trim(),
      baseUrl: typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : undefined,
    });
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

// --- Ollama model manager: installed list with usability info, downloads with
// live progress, and removal. All calls proxy the local Ollama daemon on :11434
// and degrade gracefully when it is not running.

const OLLAMA_HOST = 'http://localhost:11434';

const formatOllamaSize = (bytes: unknown): string | null => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
};

app.get('/api/ollama/models', safeHandler(async (_req, res) => {
  try {
    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!ollamaRes.ok) throw new Error(`Ollama responded ${ollamaRes.status}`);
    const data: any = await ollamaRes.json();
    const installed = (Array.isArray(data?.models) ? data.models : []).map((m: any) => {
      const caps: string[] = Array.isArray(m.capabilities) ? m.capabilities : [];
      const contextLength = m.model_info?.['general.context_length'] ?? null;
      return {
        name: String(m.name || m.model || ''),
        family: m.details?.family ?? null,
        parameterSize: m.details?.parameter_size ?? null,
        quantization: m.details?.quantization_level ?? null,
        size: formatOllamaSize(m.size),
        modifiedAt: m.modified_at ?? null,
        contextWindow: typeof contextLength === 'number' ? contextLength : null,
        // SUTRA's agent loop needs function calling — chat-only models are
        // flagged so the user knows what each model can and cannot do here.
        supportsTools: caps.includes('tools'),
        supportsVision: caps.includes('vision'),
        agentReady: caps.includes('tools'),
      };
    });
    res.json({ success: true, installed });
  } catch (err: any) {
    res.json({ success: false, installed: [], error: err?.message || 'Ollama is not reachable on localhost:11434' });
  }
}));

// Pull (download) a model. Progress is forwarded as NDJSON lines exactly as
// Ollama emits them: {status, digest?, total?, completed?} — the client turns
// that into a live progress bar. Large downloads are expected; no short timeout.
app.post('/api/ollama/pull', async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ success: false, error: 'A model name is required (e.g. qwen2.5-coder:7b).' });
  }
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  try {
    const upstream = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name.trim(), stream: true }),
    });
    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '');
      res.write(JSON.stringify({ error: errText?.slice(0, 300) || `Ollama responded ${upstream.status}` }) + '\n');
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
      // Flush each chunk immediately so the progress bar moves in real time
      if (typeof (res as any).flush === 'function') (res as any).flush();
    }
    res.end();
  } catch (err: any) {
    if (!res.writableEnded) {
      res.write(JSON.stringify({ error: err?.message || 'Download failed — is Ollama running?' }) + '\n');
      res.end();
    }
  }
});

app.post('/api/ollama/delete', safeHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ success: false, error: 'A model name is required.' });
  }
  const ollamaRes = await fetch(`${OLLAMA_HOST}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name.trim() }),
    signal: AbortSignal.timeout(15000),
  });
  if (!ollamaRes.ok) {
    const errText = await ollamaRes.text().catch(() => '');
    return res.json({ success: false, error: errText?.slice(0, 300) || `Ollama responded ${ollamaRes.status}` });
  }
  res.json({ success: true });
}));

// Custom Models per Modality (Image, Video, Audio, LLM) with User Descriptions
app.get('/api/custom-models', (_req, res) => {
  res.json({ success: true, models: customModelsManager.getAllCustomModels() });
});

app.post('/api/custom-models', (req, res) => {
  const { id, category, name, providerId, modelId, description, config } = req.body;
  const actualModelId = String(modelId || id || '').trim();
  const actualCategory = (category || 'llm') as 'image' | 'video' | 'audio' | 'llm';
  const actualName = String(name || actualModelId || '').trim();
  if (!actualName || !actualModelId) {
    return res.status(400).json({ success: false, error: 'name and modelId (or id) are required' });
  }
  const mergedConfig = config || {
    baseUrl: req.body.baseUrl,
    apiKey: req.body.apiKey,
    contextWindow: req.body.contextWindow,
    supportsTools: req.body.supportsTools,
    supportsVision: req.body.supportsVision,
  };
  const model = customModelsManager.registerCustomModel({
    id: id || `custom-${actualCategory}-${Date.now()}`,
    category: actualCategory,
    name: actualName,
    providerId: providerId || 'custom',
    modelId: actualModelId,
    description: description || `Custom ${actualCategory} model '${actualModelId}'`,
    config: mergedConfig,
  });
  try {
    modelRouter.refreshRemoteModels(true).catch(() => undefined);
  } catch {}
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

function sanitizeToolCallsForStorage(toolCalls: any): string | null {
  if (!toolCalls) return null;
  try {
    const raw = typeof toolCalls === 'string' ? JSON.parse(toolCalls) : toolCalls;
    if (!Array.isArray(raw)) {
      const str = JSON.stringify(raw);
      return str.length > 32768 ? str.slice(0, 32768) + '... [truncated]' : str;
    }
    const sanitized = raw.map((tc: any) => {
      if (!tc || typeof tc !== 'object') return tc;
      const copy = { ...tc };
      if (typeof copy.arguments === 'string' && copy.arguments.length > 16384) {
        copy.arguments = copy.arguments.slice(0, 16384) + '\n... [truncated]';
      } else if (copy.arguments && typeof copy.arguments === 'object') {
        const argStr = JSON.stringify(copy.arguments);
        if (argStr.length > 16384) {
          copy.arguments = { _note: 'Arguments truncated', preview: argStr.slice(0, 4096) };
        }
      }
      if (typeof copy.result === 'string' && copy.result.length > 32768) {
        copy.result = copy.result.slice(0, 32768) + '\n... [output truncated for storage]';
      } else if (copy.result && typeof copy.result === 'object') {
        const resStr = JSON.stringify(copy.result);
        if (resStr.length > 32768) {
          copy.result = { _note: 'Result truncated', preview: resStr.slice(0, 8192) };
        }
      }
      return copy;
    });
    return JSON.stringify(sanitized);
  } catch {
    const str = String(toolCalls);
    return str.length > 32768 ? str.slice(0, 32768) + '... [truncated]' : str;
  }
}

app.get('/api/chat/sessions/:id', (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(req.params.id) as any;
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const rawMessages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(req.params.id) as any[];
    const messages = rawMessages.map((m) => {
      let toolCalls: any = undefined;
      if (m.tool_calls) {
        try {
          toolCalls = JSON.parse(m.tool_calls);
        } catch {
          toolCalls = [{ tool: 'unknown', result: m.tool_calls }];
        }
      }
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls,
        timestamp: m.timestamp,
      };
    });
    res.json({ success: true, session, messages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chat/sessions', (req, res) => {
  try {
    const { id, title, workspace, workspaceName } = req.body;
    const wsRoot = workspace || fsTools.getWorkspaceRoot();
    const wsName = workspaceName || (wsRoot ? path.basename(wsRoot) : '');
    const sessionId = id || `session-${Date.now()}`;
    const sessionTitle = title || (wsName ? `${wsName} — Chat` : 'New Autonomous Task');
    db.prepare(`
      INSERT INTO chat_sessions (id, title, workspace, workspace_name, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        workspace = COALESCE(excluded.workspace, chat_sessions.workspace),
        workspace_name = COALESCE(excluded.workspace_name, chat_sessions.workspace_name),
        updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, sessionTitle, wsRoot, wsName);
    res.json({ success: true, session: { id: sessionId, title: sessionTitle, workspace: wsRoot, workspace_name: wsName } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chat/sessions/:id/sync', (req, res) => {
  try {
    const sessionId = req.params.id;
    const { title, messages, workspace, workspaceName } = req.body;
    const wsRoot = workspace || fsTools.getWorkspaceRoot();
    const wsName = workspaceName || (wsRoot ? path.basename(wsRoot) : '');
    db.prepare(`
      INSERT INTO chat_sessions (id, title, workspace, workspace_name, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = COALESCE(excluded.title, title),
        workspace = COALESCE(excluded.workspace, chat_sessions.workspace),
        workspace_name = COALESCE(excluded.workspace_name, chat_sessions.workspace_name),
        updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, title || (wsName ? `${wsName} — Chat` : 'Autonomous Mission'), wsRoot, wsName);
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
            tool_calls: sanitizeToolCallsForStorage(m.toolCalls),
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
app.get('/api/artifacts', (req, res) => {
  const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : undefined;
  res.json({ artifacts: listArtifacts(chatId) });
});

app.get('/api/artifacts/:id', (req, res) => {
  const artifact = getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ success: false, error: 'Artifact not found' });
  res.json({ artifact });
});

app.post('/api/artifacts', (req, res) => {
  try {
    const artifact = upsertArtifact(req.body);
    res.json({ success: true, artifact });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to save artifact' });
  }
});

app.put('/api/artifacts/:id', (req, res) => {
  try {
    const artifact = upsertArtifact({ id: req.params.id, ...req.body });
    res.json({ success: true, artifact });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to update artifact' });
  }
});

app.delete('/api/artifacts/:id', (req, res) => {
  const ok = deleteArtifact(req.params.id);
  res.json({ success: ok });
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

/**
 * Bulk stop. Stops every active background process in a single call. Mirrors
 * the per-row endpoint the Manager "Stop all tasks" button fell back to, but
 * as one round trip — Doherty-friendly for long task lists and the only way
 * the client-side optimistic UI can confirm "everything really stopped"
 * before it re-polls.
 */
app.post('/api/tasks/kill-all', (_req, res) => {
  const processes = processManager.list();
  const active = processes.filter((p) => {
    const status = (p && (p as { status?: string }).status) || '';
    return status === 'running' || status === 'starting' || status === 'pending';
  });
  let stopped = 0;
  for (const p of active) {
    const id = (p as { id?: string }).id;
    if (!id) continue;
    if (processManager.stop(id)) stopped += 1;
  }
  res.json({ success: true, stopped, requested: active.length });
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
      isConfigured: Boolean(
        cred?.api_key
          || cred?.cookie_data
          || p.authTypes.includes('local')
          || p.authTypes.includes('none')
          // Antigravity rides the machine's existing Google sign-in — no paste needed.
          || ((p.id === 'antigravity' || p.id === 'antigravity-web') && hasLocalAntigravitySignIn())
      ),
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

// Local Google sign-in detection for the Antigravity bridge (never returns secrets).
app.get('/api/providers/antigravity-status', (_req, res) => {
  res.json(describeLocalAntigravitySignIn());
});

// Manually start / restart the local Antigravity Language Server proxy daemon
app.post('/api/providers/antigravity-start', safeHandler(async (_req, res) => {
  const proxy = await ensureAntigravityDaemonRunning();
  res.json({
    success: Boolean(proxy),
    proxy: proxy ? { pid: proxy.pid, port: proxy.port, managed: proxy.managed } : null,
    status: describeLocalAntigravitySignIn(),
  });
}));

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

  // A freshly saved ChatGPT web cookie or provider credential changes which models exist — re-run
  // discovery immediately with force=true instead of waiting for the next server restart.
  if (ok && (providerId === 'chatgpt-web' || providerId === 'openrouter' || providerId === 'google' || providerId === 'groq' || providerId === 'zhipu')) {
    modelRouter.refreshRemoteModels(true).catch(() => undefined);
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

// Cursor-Grade Precision Fast-Edit API (Ctrl+K / Cmd+K)
app.post('/api/agent/fast-edit', async (req, res) => {
  try {
    const { filePath, instruction, selectedCode, fullContent, languageId } = req.body;
    if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
      return res.status(400).json({ success: false, error: 'Instruction is required' });
    }

    const systemPrompt = `You are SUTRA Precision Fast-Edit AI inside the code editor.
You are rewriting a snippet of code in "${filePath || 'file'}" based strictly on the user's instructions.
Rules:
1. Return ONLY the replacement code for the selected region.
2. Do not wrap in markdown code fences unless the entire snippet is markdown.
3. Preserve indentation and match surrounding style.
4. Do not output explanatory preamble or comments like "Here is the code".`;

    const userPrompt = `FILE CONTEXT:\n${fullContent ? String(fullContent).slice(0, 5000) : ''}\n\nSELECTED CODE TO REWRITE:\n${selectedCode || fullContent || ''}\n\nUSER INSTRUCTION:\n${instruction.trim()}`;

    let replacement = '';
    for await (const chunk of modelRouter.streamChat({
      messages: [{ role: 'user', content: userPrompt }],
      systemPrompt,
      temperature: 0.2,
    })) {
      if (chunk.delta) {
        replacement += chunk.delta;
      }
    }
    let cleaned = replacement.trim();
    if (cleaned.startsWith('```')) {
      const firstNewline = cleaned.indexOf('\n');
      if (firstNewline !== -1) {
        cleaned = cleaned.slice(firstNewline + 1);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      replacement = cleaned;
    }

    res.json({ success: true, replacement: replacement.trimEnd() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Fast-edit failed' });
  }
});

// AST & Code Map Symbol Extraction API
app.post('/api/agent/extract-symbols', async (req, res) => {
  try {
    const { content, filePath } = req.body;
    if (!content || typeof content !== 'string') return res.json({ symbols: [] });

    const symbols: Array<{ name: string; kind: string; line: number; detail?: string }> = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Classes
      const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], kind: 'class', line: lineNum, detail: 'Class' });
        continue;
      }

      // Interfaces
      const interfaceMatch = line.match(/(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/);
      if (interfaceMatch) {
        symbols.push({ name: interfaceMatch[1], kind: 'interface', line: lineNum, detail: 'Interface' });
        continue;
      }

      // Types
      const typeMatch = line.match(/(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/);
      if (typeMatch) {
        symbols.push({ name: typeMatch[1], kind: 'type', line: lineNum, detail: 'Type' });
        continue;
      }

      // Functions / Async functions
      const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/);
      if (fnMatch) {
        symbols.push({ name: fnMatch[1], kind: 'function', line: lineNum, detail: 'Function' });
        continue;
      }

      // React Components / Arrow Functions / Hooks
      const arrowMatch = line.match(/(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*[:=]\s*(?:React\.FC|async|\()/);
      if (arrowMatch) {
        const name = arrowMatch[1];
        const kind = name.startsWith('use') ? 'hook' : /^[A-Z]/.test(name) ? 'component' : 'function';
        symbols.push({ name, kind, line: lineNum, detail: kind.toUpperCase() });
        continue;
      }

      // Enums
      const enumMatch = line.match(/(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/);
      if (enumMatch) {
        symbols.push({ name: enumMatch[1], kind: 'enum', line: lineNum, detail: 'Enum' });
        continue;
      }
    }

    res.json({ success: true, symbols });
  } catch (err: any) {
    res.status(500).json({ symbols: [], error: err.message });
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
// 7-Type Cognitive Agent Memory API
app.get('/api/memory', (req, res) => {
  const workspace = typeof req.query.workspace === 'string' && req.query.workspace.trim() !== '' ? req.query.workspace.trim() : null;
  res.json({ memories: listMemories({ workspaceRoot: workspace, limit: 100 }) });
});

// Full 7-Type Cognitive Memory Inspection
app.get('/api/memory/7-types', safeHandler(async (req, res) => {
  const workspace = typeof req.query.workspace === 'string' && req.query.workspace.trim() !== '' ? req.query.workspace.trim() : fsTools.getWorkspaceRoot();
  const activeModel = modelRouter.getActiveModel();
  
  res.json({
    types: {
      type1_working: AgentMemoryEngine.working.get('default', workspace),
      type2_semantic: AgentMemoryEngine.semantic.list({ workspaceRoot: workspace, limit: 20 }),
      type3_episodic: searchEpisodicEpisodes('', workspace, 10),
      type4_procedural: findProceduralRecipes('', workspace, 10),
      type5_retrieval: {
        activeIndices: ['ast_symbol', 'workspace_files', 'sqlite', 'memories'],
        status: 'ready',
      },
      type6_parametric: AgentMemoryEngine.parametric.getProfile(activeModel?.id, (activeModel as any)?.provider),
      type7_prospective: AgentMemoryEngine.prospective.list({ workspaceRoot: workspace, limit: 20 }),
    },
    counts: {
      memories: listMemories({ workspaceRoot: workspace, limit: 100 }).length,
      semanticFacts: getSemanticFacts({ workspaceRoot: workspace, limit: 100 }).length,
      prospectiveTasks: listPendingProspectiveTasks({ workspaceRoot: workspace, limit: 100 }).length,
    }
  });
}));

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

// Semantic Fact Store / Update
app.post('/api/memory/semantic', safeHandler(async (req, res) => {
  const { entity, attribute, value, confidence, scope, expiresInSeconds } = req.body || {};
  if (!entity || !attribute || !value) {
    res.status(400).json({ error: 'entity, attribute, and value are required' });
    return;
  }
  const fact = storeSemanticFact({
    entity: String(entity),
    attribute: String(attribute),
    value: String(value),
    confidence: typeof confidence === 'number' ? confidence : 1.0,
    scope: scope === 'user' || scope === 'global' ? scope : 'workspace',
    workspaceRoot: fsTools.getWorkspaceRoot(),
    expiresInSeconds,
  });
  res.json({ success: true, fact });
}));

app.post('/api/memory/semantic/:id/tombstone', safeHandler(async (req, res) => {
  const success = tombstoneSemanticFact(String(req.params.id));
  res.json({ success });
}));

// Prospective Task Scheduling ("Remembering the Future")
app.post('/api/memory/prospective', safeHandler(async (req, res) => {
  const { taskDescription, triggerType, triggerCondition, payload, dueInSeconds } = req.body || {};
  if (!taskDescription || !triggerType || !triggerCondition) {
    res.status(400).json({ error: 'taskDescription, triggerType, and triggerCondition are required' });
    return;
  }
  const dueAt = Date.now() + (typeof dueInSeconds === 'number' ? dueInSeconds * 1000 : 60000);
  const task = scheduleProspectiveTask({
    taskDescription: String(taskDescription),
    triggerType: triggerType === 'time' || triggerType === 'event' || triggerType === 'interval' ? triggerType : 'condition',
    triggerCondition: String(triggerCondition),
    payload,
    workspaceRoot: fsTools.getWorkspaceRoot(),
    dueAt,
  });
  res.json({ success: true, task });
}));

app.post('/api/memory/prospective/:id/complete', safeHandler(async (req, res) => {
  const success = completeProspectiveTask(String(req.params.id));
  res.json({ success });
}));

app.delete('/api/memory/prospective/:id', safeHandler(async (req, res) => {
  const success = cancelProspectiveTask(String(req.params.id));
  res.json({ success });
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

app.get('/api/fs/workspace', safeHandler(async (_req, res) => {
  const root = fsTools.getWorkspaceRoot();
  res.json({ success: true, workspaceRoot: root, path: root, name: path.basename(root) || 'omnicraft-ide' });
}));

app.post('/api/fs/set-workspace', (req, res) => {
  const { path: newPath } = req.body;
  try {
    if (!newPath || typeof newPath !== 'string' || newPath.trim().length === 0) {
      return res.status(400).json({ error: 'Valid workspace path is required.' });
    }
    const target = path.resolve(newPath.trim());
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: `Directory does not exist: ${target}` });
    }
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${target}` });
    }
    const parsed = path.parse(target);
    if (parsed.root.toLowerCase() === target.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot set workspace directly to filesystem root.' });
    }

    fsTools.setWorkspaceRoot(target);
    ptyManager.setWorkspaceRoot(target);
    mediaEngine.setProjectRoot(target);
    codebaseIndexer.setWorkspaceRoot(target);
    codebaseIndexer.buildIndex().catch(() => {});
    initArtifacts(target);
    try {
      db.prepare(`INSERT INTO system_config (key, value) VALUES ('active_workspace', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(target);
    } catch {}
    res.json({ success: true, workspacePath: target, name: path.basename(target) || 'omnicraft-ide' });
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
    codebaseIndexer.setWorkspaceRoot(target);
    codebaseIndexer.buildIndex().catch(() => {});
    initArtifacts(target);
    try {
      db.prepare(`INSERT INTO system_config (key, value) VALUES ('active_workspace', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(target);
    } catch {}
    res.json({ success: true, workspacePath: target, name: path.basename(target) || 'omnicraft-ide' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Quick-start templates for the "Create new project" flow. Each template is
// a small set of seed files the agent can build on; the goal is to skip the
// "what kind of project is this?" conversation by landing on a sensible
// starting point instantly.
interface QuickStartFile { path: string; content: string }
interface QuickStartTemplate {
  id: string;
  label: string;
  hint: string;
  files: QuickStartFile[];
}

const QUICK_START_TEMPLATES: Record<string, QuickStartTemplate> = {
  empty: {
    id: 'empty',
    label: 'Empty',
    hint: 'A bare folder. Tell the agent what to build.',
    files: [
      { path: 'README.md', content: '# New project\n\nDescribe the goal in the agent chat and the workspace fills itself in.\n' },
    ],
  },
  react: {
    id: 'react',
    label: 'React (Vite + TS)',
    hint: 'Vite + React + TypeScript with a single starter component.',
    files: [
      { path: 'package.json', content: '{\n  "name": "react-app",\n  "private": true,\n  "version": "0.0.1",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc -b && vite build",\n    "preview": "vite preview"\n  },\n  "dependencies": { "react": "^18.3.0", "react-dom": "^18.3.0" },\n  "devDependencies": { "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0", "@vitejs/plugin-react": "^4.3.0", "typescript": "^5.5.0", "vite": "^5.4.0" }\n}\n' },
      { path: 'index.html', content: '<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>React app</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n' },
      { path: 'src/main.tsx', content: "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n" },
      { path: 'src/App.tsx', content: "export const App: React.FC = () => (\n  <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>\n    <h1>React app</h1>\n    <p>Describe the next change in the agent chat.</p>\n  </main>\n);\n" },
      { path: 'README.md', content: '# React app\n\nVite + React + TypeScript starter. Run `npm install` then `npm run dev`.\n' },
    ],
  },
  node: {
    id: 'node',
    label: 'Node (Express + TS)',
    hint: 'A minimal Express server in TypeScript.',
    files: [
      { path: 'package.json', content: '{\n  "name": "node-server",\n  "version": "0.0.1",\n  "type": "module",\n  "scripts": { "dev": "tsx watch src/index.ts", "build": "tsc -b", "start": "node dist/index.js" },\n  "dependencies": { "express": "^4.19.0" },\n  "devDependencies": { "@types/express": "^4.17.0", "@types/node": "^20.0.0", "tsx": "^4.16.0", "typescript": "^5.5.0" }\n}\n' },
      { path: 'src/index.ts', content: "import express from 'express';\n\nconst app = express();\napp.get('/', (_req, res) => res.send('OK'));\n\nconst port = Number(process.env.PORT ?? 3000);\napp.listen(port, () => console.log(`Listening on ${port}`));\n" },
      { path: 'README.md', content: '# Node server\n\nExpress + TypeScript starter. Run `npm install` then `npm run dev`.\n' },
    ],
  },
  python: {
    id: 'python',
    label: 'Python (FastAPI)',
    hint: 'A minimal FastAPI service.',
    files: [
      { path: 'requirements.txt', content: 'fastapi==0.111.0\nuvicorn[standard]==0.30.0\n' },
      { path: 'main.py', content: "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get('/')\nasync def root():\n    return {'status': 'ok'}\n" },
      { path: 'README.md', content: '# Python API\n\nFastAPI starter. Run `pip install -r requirements.txt` then `uvicorn main:app --reload`.\n' },
    ],
  },
  web: {
    id: 'web',
    label: 'Static site',
    hint: 'Plain HTML + CSS + JS — no build step.',
    files: [
      { path: 'index.html', content: '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Static site</title>\n    <link rel="stylesheet" href="style.css" />\n  </head>\n  <body>\n    <main>\n      <h1>Hello</h1>\n      <p>Describe the next change in the agent chat.</p>\n    </main>\n    <script src="app.js"></script>\n  </body>\n</html>\n' },
      { path: 'style.css', content: ':root { color-scheme: light dark; }\nbody { font: 16px/1.5 system-ui, sans-serif; max-width: 60ch; margin: 4rem auto; padding: 0 1rem; }\nh1 { letter-spacing: -0.02em; }\n' },
      { path: 'app.js', content: "// Add interactivity here.\nconsole.log('ready');\n" },
      { path: 'README.md', content: '# Static site\n\nPlain HTML / CSS / JS. Open `index.html` or serve the folder with any static server.\n' },
    ],
  },
};

app.get('/api/fs/quick-starts', (_req, res) => {
  res.json({
    templates: Object.values(QUICK_START_TEMPLATES).map(({ id, label, hint }) => ({ id, label, hint })),
  });
});

app.post('/api/fs/create-from-template', async (req, res) => {
  const { path: targetPath, templateId } = req.body || {};
  if (!targetPath || typeof targetPath !== 'string' || targetPath.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'A valid folder path is required' });
  }
  const template = QUICK_START_TEMPLATES[String(templateId || '').toLowerCase()];
  if (!template) {
    return res.status(400).json({ success: false, error: `Unknown template: ${templateId}` });
  }
  try {
    const root = path.resolve(targetPath.trim());
    await fs.promises.mkdir(root, { recursive: true });
    for (const file of template.files) {
      const full = path.join(root, file.path);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, file.content, 'utf8');
    }
    fsTools.setWorkspaceRoot(root);
    ptyManager.setWorkspaceRoot(root);
    mediaEngine.setProjectRoot(root);
    try {
      db.prepare(`INSERT INTO system_config (key, value) VALUES ('active_workspace', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(root);
    } catch {}
    res.json({ success: true, workspacePath: root, template: template.id, files: template.files.map((f) => f.path) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function serveWorkspaceHtml(filePath: string, reqPath: string, res: express.Response, root: string): void {
  try {
    let html = fs.readFileSync(filePath, 'utf8');
    const cleanReq = reqPath.replace(/^[/\\]+/, '');
    const relDir = path.dirname(cleanReq).replace(/\\/g, '/');
    const baseDir = relDir === '.' || !relDir ? '/workspace' : `/workspace/${relDir}`;

    // 1. Detect referenced stylesheets in HTML. If missing on disk, resolve alias or auto-synthesize
    const linkMatches = Array.from(html.matchAll(/<link\s+[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi));
    for (const match of linkMatches) {
      const originalHref = match[1];
      const cleanHref = originalHref.split('?')[0].replace(/^\.?\/+/, '');
      if (!cleanHref.startsWith('http://') && !cleanHref.startsWith('https://') && !cleanHref.startsWith('//')) {
        const directFile = path.resolve(path.dirname(filePath), cleanHref);
        if (!fs.existsSync(directFile)) {
          // Check if an alias exists in the workspace (e.g. style.css <-> styles.css)
          const resolved = resolveWorkspaceCss(root, cleanHref);
          if (resolved) {
            const relFromRoot = path.relative(root, resolved).replace(/\\/g, '/');
            html = html.replaceAll(originalHref, `/workspace/${relFromRoot}`);
          } else {
            // Neither exists: synthesize the stylesheet on disk so it physically exists
            const targetFile = path.join(root, cleanHref);
            try {
              fs.mkdirSync(path.dirname(targetFile), { recursive: true });
              const fallback = getFallbackStylesheet(path.basename(cleanHref));
              fs.writeFileSync(targetFile, fallback, 'utf8');
              html = html.replaceAll(originalHref, `/workspace/${cleanHref}`);
            } catch {}
          }
        }
      }
    }

    // 2. Detect referenced scripts in HTML. If missing on disk, resolve alias
    const scriptMatches = Array.from(html.matchAll(/<script\s+[^>]*src=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi));
    for (const match of scriptMatches) {
      const originalSrc = match[1];
      const cleanSrc = originalSrc.split('?')[0].replace(/^\.?\/+/, '');
      if (!cleanSrc.startsWith('http://') && !cleanSrc.startsWith('https://') && !cleanSrc.startsWith('//')) {
        const directFile = path.resolve(path.dirname(filePath), cleanSrc);
        if (!fs.existsSync(directFile)) {
          const resolved = resolveWorkspaceJs(root, cleanSrc);
          if (resolved) {
            const relFromRoot = path.relative(root, resolved).replace(/\\/g, '/');
            html = html.replaceAll(originalSrc, `/workspace/${relFromRoot}`);
          }
        }
      }
    }

    // 3. Rewrite root-relative links e.g. href="/css/style.css" -> href="/workspace/public/css/style.css" or href="/workspace/css/style.css"
    html = html.replace(/(href|src)=["']\/(?!(?:api|preview|workspace|ws|#|mailto:|tel:)\b)([^"']+)["']/gi, (_match, attr, target) => {
      const inDir = path.join(root, relDir === '.' ? '' : relDir, target);
      if (fs.existsSync(inDir)) {
        return `${attr}="${baseDir}/${target}"`;
      }
      return `${attr}="/workspace/${target}"`;
    });

    // 4. Inject base tag if not present
    const baseTag = `<base href="${baseDir}/" />`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n  ${baseTag}`);
    } else if (html.includes('<html')) {
      html = html.replace(/(<html[^>]*>)/i, `$1\n<head>\n  ${baseTag}\n</head>`);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err: any) {
    res.status(500).send(`Failed to read HTML: ${err?.message}`);
  }
}

// Generated sites are RUNNABLE: the workspace is served read-only so any HTML
// Astra writes (index.html etc.) renders live at /workspace/<path>. The static
// handler is memoized per root so workspace switches take effect immediately.
const workspaceStaticCache = new Map<string, express.RequestHandler>();
app.use('/workspace', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', 'inline');
  const root = fsTools.getWorkspaceRoot();
  const isHost = isHostIdeRoot(root);

  // If this workspace is the host IDE itself, block serving host source/build bundles directly
  const cleanPath = req.path.replace(/^[/\\]+/, '');
  if (isHost && (cleanPath === 'index.html' || cleanPath === '' || cleanPath.startsWith('dist/') || cleanPath.startsWith('src/') || cleanPath.startsWith('server/') || cleanPath.startsWith('desktop/'))) {
    return res.redirect('/preview');
  }

  // Intercept HTML files so relative assets and root-relative links resolve perfectly
  const candidateFile = cleanPath === '' || cleanPath === '/' ? path.join(root, 'index.html') : path.join(root, cleanPath);
  if (fs.existsSync(candidateFile) && fs.statSync(candidateFile).isFile() && (candidateFile.endsWith('.html') || candidateFile.endsWith('.htm'))) {
    return serveWorkspaceHtml(candidateFile, req.path === '/' || req.path === '' ? '/index.html' : req.path, res, root);
  }

  // Intelligent fallback: if root index.html is requested and missing or a tiny stub (< 120 bytes),
  // but a nested workspace/index.html exists with complete content, serve that directly
  if (!isHost && (req.path === '/' || req.path === '/index.html')) {
    const rootIndex = path.join(root, 'index.html');
    const nestedIndex = path.join(root, 'workspace', 'index.html');
    const rootIndexStat = fs.existsSync(rootIndex) ? fs.statSync(rootIndex) : null;
    if ((!rootIndexStat || rootIndexStat.size < 120) && fs.existsSync(nestedIndex)) {
      return serveWorkspaceHtml(nestedIndex, '/workspace/index.html', res, root);
    }
  }

  let handler = workspaceStaticCache.get(root);
  if (!handler) {
    handler = express.static(root, {
      index: 'index.html',
      fallthrough: true,
      extensions: ['html', 'htm'],
      setHeaders: (res, filePath) => {
        res.setHeader('Content-Disposition', 'inline');
        if (/\.(ts|tsx|jsx|py|rs|go|sh|bash|zsh|json|md|env|yml|yaml|toml|sql|c|cpp|h|hpp|log|txt)$/i.test(filePath)) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        } else if (/\.(js|mjs)$/i.test(filePath)) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (/\.css$/i.test(filePath)) {
          res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (filePath.endsWith('.mp4')) {
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Accept-Ranges', 'bytes');
        } else if (filePath.endsWith('.webm')) {
          res.setHeader('Content-Type', 'video/webm');
          res.setHeader('Accept-Ranges', 'bytes');
        } else if (filePath.endsWith('.mp3')) {
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Accept-Ranges', 'bytes');
        } else if (filePath.endsWith('.wav')) {
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('Accept-Ranges', 'bytes');
        } else if (filePath.endsWith('.ogg')) {
          res.setHeader('Content-Type', 'audio/ogg');
          res.setHeader('Accept-Ranges', 'bytes');
        } else if (filePath.endsWith('.m4a')) {
          res.setHeader('Content-Type', 'audio/mp4');
          res.setHeader('Accept-Ranges', 'bytes');
        } else if (filePath.endsWith('.svg')) {
          res.setHeader('Content-Type', 'image/svg+xml');
        }
      },
    });
    workspaceStaticCache.set(root, handler);
  }
  handler(req, res, (err) => {
    if (err) return next(err);
    const cleanRel = req.path.replace(/^[/\\]+/, '');

    // 1. If static file not found in root, check if it was created inside an accidental nested workspace/ folder
    if (cleanRel) {
      const nestedFile = path.join(root, 'workspace', cleanRel);
      if (fs.existsSync(nestedFile) && fs.statSync(nestedFile).isFile()) {
        return res.sendFile(nestedFile, { headers: { 'Content-Disposition': 'inline' } });
      }
    }

    // 2. Intelligent CSS resolver & synthesis: NEVER 404 or send HTML for a stylesheet!
    if (req.path.endsWith('.css') || req.path.includes('.css?')) {
      const resolvedCss = resolveWorkspaceCss(root, req.path);
      if (resolvedCss) {
        return res.sendFile(resolvedCss, {
          headers: {
            'Content-Type': 'text/css; charset=utf-8',
            'Content-Disposition': 'inline',
            'Cache-Control': 'no-store',
          },
        });
      }
      // If no CSS file exists at all in workspace, generate and return clean modern stylesheet
      const fallbackContent = getFallbackStylesheet(path.basename(req.path));
      try {
        const targetCss = path.join(root, cleanRel || 'styles.css');
        if (!fs.existsSync(targetCss)) {
          fs.writeFileSync(targetCss, fallbackContent, 'utf8');
        }
      } catch {}
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(fallbackContent);
    }

    // 3. Intelligent JS resolver
    if (req.path.endsWith('.js') || req.path.endsWith('.mjs')) {
      const resolvedJs = resolveWorkspaceJs(root, req.path);
      if (resolvedJs) {
        return res.sendFile(resolvedJs, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Content-Disposition': 'inline',
            'Cache-Control': 'no-store',
          },
        });
      }
    }

    // 4. If static file not found and path doesn't contain a file extension, attempt index.html fallback for SPAs
    const indexPath = path.join(root, 'index.html');
    if (!req.path.includes('.') && !isHost && fs.existsSync(indexPath)) {
      return res.sendFile(indexPath, { headers: { 'Content-Disposition': 'inline' } });
    }

    // NEVER fall through to next() (which serves the host IDE SPA bundle)!
    // Missing files under /workspace must 404 gracefully so iframes never render recursive IDE shells.
    res.status(404).send(`<!DOCTYPE html>
<html>
<head><title>404 Not Found</title><style>body{background:#0c0d10;color:#94a3b8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column}h2{color:#f1f2f5;margin-bottom:8px}code{color:#a78bfa;background:#1e1f29;padding:2px 6px;border-radius:4px}</style></head>
<body>
  <h2>404 — Page Not Found</h2>
  <p>The requested preview file <code>${req.path}</code> was not found in your workspace.</p>
</body>
</html>`);
  });
});

app.get('/api/fs/list-subdirectories', (req, res) => {
  try {
    const targetPath = (req.query.path as string || '').trim();
    if (!targetPath) {
      // Return root drives and system roots
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      const availableDrives = ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\']
        .filter((d) => {
          try { return fs.existsSync(d); } catch { return false; }
        })
        .map((d) => ({ name: `Local Disk (${d.replace('\\', '')})`, path: d, isDrive: true }));

      const systemRoots = [
        { name: 'Desktop', path: path.join(home, 'Desktop'), isDrive: false },
        { name: 'Documents', path: path.join(home, 'Documents'), isDrive: false },
        { name: 'Downloads', path: path.join(home, 'Downloads'), isDrive: false },
        { name: 'Projects / Scratch', path: path.join(home, '.gemini', 'antigravity', 'scratch'), isDrive: false },
      ].filter((r) => fs.existsSync(r.path));

      return res.json({ success: true, roots: [...systemRoots, ...availableDrives], entries: [] });
    }

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, error: 'Path does not exist', entries: [] });
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ success: false, error: 'Path is not a directory', entries: [] });
    }

    const items = fs.readdirSync(targetPath, { withFileTypes: true });
    const subdirs = items
      .filter((it) => {
        if (!it.isDirectory()) return false;
        const name = it.name;
        if (name.startsWith('$') || name.startsWith('.')) return false;
        if (name === 'System Volume Information' || name === 'node_modules' || name === 'AppData') return false;
        return true;
      })
      .map((it) => ({
        name: it.name,
        path: path.join(targetPath, it.name),
        isDrive: false,
      }))
      .slice(0, 150);

    res.json({
      success: true,
      currentPath: targetPath,
      parentPath: path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null,
      entries: subdirs,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, entries: [] });
  }
});

app.post('/api/fs/browse-folder', async (req, res) => {
  const script = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project Folder'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath } else { '' }`;
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        cwd: rootDir,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      const killTimer = setTimeout(() => {
        try { child.kill(); } catch { /* already exited */ }
        resolve('');
      }, 3 * 60 * 1000);
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

    if (result && fs.existsSync(result)) {
      fsTools.setWorkspaceRoot(result);
      ptyManager.setWorkspaceRoot(result);
      mediaEngine.setProjectRoot(result);
      initArtifacts(result);
      res.json({ path: result, success: true });
    } else {
      res.json({ path: '', success: false, message: 'No folder selected' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Instant workspace / scratchpad creation endpoint (powered by ScratchWorkspaceManager)
app.post('/api/workspace/create', async (req, res) => {
  try {
    const meta = scratchManager.createScratchWorkspace({
      name: req.body?.name,
      template: req.body?.template,
      prompt: req.body?.prompt,
      description: req.body?.description,
      activate: true,
      codebaseIndexer,
      db,
    });
    res.json({ success: true, path: meta.path, name: meta.name, workspace: meta });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to create workspace' });
  }
});

// Antigravity-inspired Scratchpad Workspace Management APIs
app.get('/api/scratch', safeHandler(async (_req, res) => {
  const workspaces = scratchManager.listScratchWorkspaces();
  res.json({ success: true, baseDir: scratchManager.getBaseDir(), workspaces });
}));

app.post('/api/scratch', safeHandler(async (req, res) => {
  const meta = scratchManager.createScratchWorkspace({
    name: req.body?.name,
    template: req.body?.template,
    prompt: req.body?.prompt,
    description: req.body?.description,
    activate: req.body?.activate !== false,
    codebaseIndexer,
    db,
  });
  res.json({ success: true, workspace: meta });
}));

app.post('/api/scratch/promote', safeHandler(async (req, res) => {
  const { scratchPath, destinationDir } = req.body || {};
  if (!scratchPath || !destinationDir) {
    return res.status(400).json({ success: false, error: 'scratchPath and destinationDir are required' });
  }
  const result = scratchManager.promoteScratchWorkspace(scratchPath, destinationDir);
  scratchManager.activateWorkspace(result.newPath, codebaseIndexer, db);
  res.json({ success: true, newPath: result.newPath });
}));

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

// AI Conventional Commit Message Generator (Cursor / Copilot Parity)
app.post('/api/git/generate-commit-message', async (_req, res) => {
  try {
    const status = fsTools.gitStatus();
    let diff = '';
    try {
      const stagedDiff = fsTools.getGitDiff(undefined, true);
      diff = (typeof stagedDiff === 'string' ? stagedDiff : (stagedDiff as any)?.diff || '').trim();
      if (!diff) {
        const workingDiff = fsTools.getGitDiff(undefined, false);
        diff = (typeof workingDiff === 'string' ? workingDiff : (workingDiff as any)?.diff || '').trim();
      }
    } catch {
      diff = '';
    }

    if (!diff) {
      return res.json({ success: true, message: 'chore: update workspace files' });
    }

    const systemPrompt = `You are an expert Git commit message generator adhering strictly to Conventional Commits 1.0.0.
Output ONLY the raw commit message text (e.g. feat(editor): ..., fix(terminal): ..., refactor(auth): ...).
Rules:
1. Max 72 chars for the title line.
2. Imperative mood: "add", "fix", "change", not "added" or "fixing".
3. No markdown quotes, no triple backticks, no explanatory preamble.`;

    const userPrompt = `GIT STATUS:\n${JSON.stringify(status, null, 2)}\n\nGIT DIFF:\n${diff.slice(0, 10000)}`;

    let commitMsg = '';
    try {
      for await (const chunk of modelRouter.streamChat({
        messages: [{ role: 'user', content: userPrompt }],
        systemPrompt,
        temperature: 0.1,
      })) {
        if (chunk.delta) commitMsg += chunk.delta;
      }
    } catch {
      // Fallback heuristic
      const changed = (status as any)?.files || [];
      const firstFile = changed[0]?.path || 'project';
      commitMsg = `chore: update ${firstFile}`;
    }

    let cleaned = commitMsg.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1);
    if (!cleaned) cleaned = 'chore: update workspace files';

    res.json({ success: true, message: cleaned, commitMessage: cleaned });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to generate commit message' });
  }
});

// Revert Single File Modification
app.post('/api/git/revert-file', async (req, res) => {
  try {
    const filePath = (req.body?.filePath || req.body?.path) as string | undefined;
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ success: false, error: 'filePath or path is required' });
    }
    const wsRoot = fsTools.getWorkspaceRoot();
    const fullPath = path.resolve(wsRoot, filePath);
    if (!fullPath.startsWith(wsRoot)) {
      return res.status(403).json({ success: false, error: 'Path traversal forbidden' });
    }

    try {
      execFileSync('git', ['checkout', 'HEAD', '--', filePath], { cwd: wsRoot, stdio: 'pipe' });
      return res.json({ success: true, method: 'git' });
    } catch {
      // If git checkout fails, check if gitCheckpoints has it
      try {
        const cps = gitCheckpoints.getCheckpoints();
        if (cps.length > 0) {
          await gitCheckpoints.rollback(cps[cps.length - 1].id);
          return res.json({ success: true, method: 'checkpoint' });
        }
      } catch {
        // Fall through
      }
    }
    res.status(400).json({ success: false, error: 'Could not revert file' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Revert failed' });
  }
});

// AST Codebase Symbols Endpoint
app.get('/api/codebase/symbols', (req, res) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    if (query) {
      const results = codebaseIndexer.search(query, limit);
      res.json({ success: true, symbols: results.map((r) => r.symbol) });
    } else {
      const all = codebaseIndexer.getSymbols();
      res.json({ success: true, symbols: all.slice(0, limit) });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to query symbols' });
  }
});

// ============================================================================
// OpenAI-Compatible Universal Cookie-to-API Bridge & Proxy Suite
// ============================================================================

// 1. Chat Completions Proxy: POST /v1/chat/completions
app.post('/v1/chat/completions', (req, res) => {
  chatProxy.handleChatCompletion(req, res);
});

// 2. Image Generation Proxy: POST /v1/images/generations
app.post('/v1/images/generations', safeHandler(async (req, res) => {
  const geminiRow = db.prepare("SELECT api_key FROM providers WHERE id = 'google'").get() as any;
  const cwRow = db.prepare("SELECT cookie_data FROM providers WHERE id = 'chatgpt-web'").get() as any;
  const result = await imageProxy.generateImage(req.body, cwRow?.cookie_data, geminiRow?.api_key);
  res.json(result);
}));

// 3. Image Edit Proxy: POST /v1/images/edits
app.post('/v1/images/edits', safeHandler(async (req, res) => {
  const geminiRow = db.prepare("SELECT api_key FROM providers WHERE id = 'google'").get() as any;
  const cwRow = db.prepare("SELECT cookie_data FROM providers WHERE id = 'chatgpt-web'").get() as any;
  const result = await imageProxy.editImage(req.body, cwRow?.cookie_data, geminiRow?.api_key);
  res.json(result);
}));

// 3. Models List Proxy: GET /v1/models
app.get('/v1/models', (_req, res) => {
  const allModels = modelRouter.getAllModels();
  res.json({
    object: 'list',
    data: allModels.map((m) => ({
      id: m.id,
      object: 'model',
      created: 1788000000,
      owned_by: m.provider,
      display_name: m.name,
      capabilities: m.capabilities,
    })),
  });
});

// 4. Browser CDP Status & Connection: GET /v1/browser/status
app.get('/v1/browser/status', safeHandler(async (_req, res) => {
  const available = await browserBridge.isBrowserAvailable();
  const tabs = available ? await browserBridge.listTabs() : [];
  res.json({
    available,
    port: 9222,
    tabCount: tabs.length,
    tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
    hint: available
      ? 'Chrome DevTools Protocol connected. Requests can route directly through browser tab.'
      : 'Start Chrome with --remote-debugging-port=9222 to connect live browser tabs.',
  });
}));

// 4. Media & Asset Studio
app.get('/api/media/assets', (_req, res) => {
  res.json(mediaEngine.getAllAssets());
});

app.get('/api/media/settings', (_req, res) => {
  res.json(mediaEngine.getMediaSettings());
});

app.post('/api/media/settings', safeHandler(async (req, res) => {
  const updated = mediaEngine.updateMediaSettings(req.body || {});
  res.json({ success: true, settings: updated });
}));

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

app.post('/api/media/transcribe', safeHandler(async (req, res) => {
  const { audioData, mimeType } = req.body || {};
  if (!audioData) {
    return res.status(400).json({ success: false, error: 'audioData base64 string is required' });
  }

  // 1. Groq / OpenAI Whisper Transcription
  try {
    const groqKey = db.prepare("SELECT api_key FROM providers WHERE id = 'groq'").get() as any;
    const openaiKey = db.prepare("SELECT api_key FROM providers WHERE id = 'openai'").get() as any;
    const activeKey = (groqKey?.api_key || '').trim() || (openaiKey?.api_key || '').trim();
    const isGroq = Boolean((groqKey?.api_key || '').trim());

    if (activeKey) {
      const buffer = Buffer.from(audioData.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
      const blob = new Blob([buffer], { type: mimeType || 'audio/webm' });
      const formData = new FormData();
      formData.append('file', blob, 'audio.webm');
      formData.append('model', isGroq ? 'whisper-large-v3-turbo' : 'whisper-1');
      formData.append('response_format', 'json');

      const endpoint = isGroq
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeKey}`,
        },
        body: formData,
      });

      if (response.ok) {
        const data: any = await response.json();
        const text = String(data.text || '').trim();
        if (text) {
          return res.json({ success: true, text });
        }
      }
    }
  } catch (err: any) {
    console.warn('[Audio Transcribe] Whisper fallback error:', err.message);
  }

  res.json({ success: true, text: '' });
}));

// 5. Godly Design Vault & Archetypes
app.get('/api/vault/patterns', (_req, res) => {
  res.json({ patterns: [] });
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

// 6.6 Skills Management API (List auto-activated & workspace custom skills, register custom skills)
app.get('/api/skills', safeHandler(async (_req, res) => {
  const workspaceSkillsDir = path.join(fsTools.getWorkspaceRoot(), '.agentskills');
  const customSkills: Array<{ name: string; description: string; category?: string; triggers: string[]; isCustom: boolean }> = [];
  
  if (fs.existsSync(workspaceSkillsDir)) {
    try {
      const files = fs.readdirSync(workspaceSkillsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const fullPath = path.join(workspaceSkillsDir, file);
          const content = fs.readFileSync(fullPath, 'utf8');
          const name = file.replace(/\.md$/i, '');
          const lines = content.split('\n');
          const desc = (lines[0] || '').replace(/^[#\s]+/, '').trim() || name;
          customSkills.push({
            name,
            description: desc,
            category: 'Custom',
            triggers: [name, ...desc.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)],
            isCustom: true,
          });
        }
      }
    } catch {}
  }
  
  res.json({
    success: true,
    skills: customSkills,
  });
}));

app.post('/api/skills', safeHandler(async (req, res) => {
  const { name, description, category, triggers, content } = req.body;
  if (!name || !content) {
    res.status(400).json({ success: false, error: 'Skill name and content are required' });
    return;
  }
  
  const cleanName = String(name).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const workspaceSkillsDir = path.join(fsTools.getWorkspaceRoot(), '.agentskills');
  if (!fs.existsSync(workspaceSkillsDir)) {
    fs.mkdirSync(workspaceSkillsDir, { recursive: true });
  }
  
  const filePath = path.join(workspaceSkillsDir, `${cleanName}.md`);
  const fileContent = `# ${description || cleanName}\n\n<!-- triggers: ${Array.isArray(triggers) ? triggers.join(', ') : cleanName} -->\n<!-- category: ${category || 'Engineering'} -->\n\n${content}`;
  fs.writeFileSync(filePath, fileContent, 'utf8');
  
  res.json({
    success: true,
    skill: {
      name: cleanName,
      description: description || cleanName,
      category: category || 'Engineering',
      triggers: Array.isArray(triggers) ? triggers : [cleanName],
      isCustom: true,
    },
  });
}));

app.get('/api/skills/:name', safeHandler(async (req, res) => {
  const { name } = req.params;
  const cleanName = String(name).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const workspaceSkillsDir = path.join(fsTools.getWorkspaceRoot(), '.agentskills');
  const filePath = path.join(workspaceSkillsDir, `${cleanName}.md`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ success: false, error: 'Skill not found' });
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  res.json({ success: true, name: cleanName, content });
}));

app.delete('/api/skills/:name', safeHandler(async (req, res) => {
  const { name } = req.params;
  const cleanName = String(name).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const workspaceSkillsDir = path.join(fsTools.getWorkspaceRoot(), '.agentskills');
  const filePath = path.join(workspaceSkillsDir, `${cleanName}.md`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  res.json({ success: true, deleted: cleanName });
}));

/**
 * Automatically ensures a background dev server is running for the workspace if a framework project exists.
 */
async function ensureDevServerRunning(wsRoot: string): Promise<{ port: number; url: string } | null> {
  // 1. Check if an active server is already listening
  const normWs = path.resolve(wsRoot).toLowerCase().replace(/\\/g, '/');
  const activeProcesses = processManager.list();
  const listening = activeProcesses.find((p: any) => {
    if ((p.status !== 'running' && p.status !== 'starting') || !p.port) return false;
    const normProcCwd = path.resolve(p.cwd || '').toLowerCase().replace(/\\/g, '/');
    return normProcCwd === normWs || normProcCwd.startsWith(normWs + '/');
  });
  if (listening && listening.port && (await processManager.isPortOwnedByWorkspace(listening.port, wsRoot))) {
    return { port: listening.port, url: `http://localhost:${listening.port}` };
  }

  // 2. Check if workspace has a package.json with dev or start scripts
  const pkgPath = path.join(wsRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts?.dev || pkg.scripts?.start) {
        const cmd = pkg.scripts.dev ? 'npm run dev' : 'npm start';
        const parts = cmd.split(/\s+/);
        const detectedPort = processManager.detectPort(parts[0], parts.slice(1)) || 5173;
        const result = await processManager.launch(parts[0], parts.slice(1), wsRoot, detectedPort);
        const resolvedPort = result.port || detectedPort;
        return { port: resolvedPort, url: `http://localhost:${resolvedPort}` };
      }
    } catch {
      // Best effort
    }
  }
  return null;
}

// Helper to determine if a directory is the host SUTRA IDE root rather than a user workspace project
function isHostIdeRoot(dir: string): boolean {
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name === 'omnicraft-ide' || pkg.name === 'sutra-ide') return true;
    }
    if (fs.existsSync(path.join(dir, 'server', 'index.ts')) && fs.existsSync(path.join(dir, 'src', 'main.tsx'))) {
      return true;
    }
  } catch {}
  return false;
}

// 7. Dedicated Live Preview Sandbox Route (Prevents Recursive Iframe Loop & Isolates Host IDE)
app.get('/preview', safeHandler(async (_req, res) => {
  res.setHeader('Content-Disposition', 'inline');
  const wsRoot = fsTools.getWorkspaceRoot();
  const isHost = isHostIdeRoot(wsRoot);

  // If a dev server process is already running in THIS workspace, redirect through frame-safe proxy
  const normWs = path.resolve(wsRoot).toLowerCase().replace(/\\/g, '/');
  const activeProcesses = processManager.list();
  const runningWithPort = activeProcesses.find((p: any) => {
    if ((p.status !== 'running' && p.status !== 'starting') || !p.port || p.port === 5173 || p.port === 3001) return false;
    const normProcCwd = path.resolve(p.cwd || '').toLowerCase().replace(/\\/g, '/');
    return normProcCwd === normWs || normProcCwd.startsWith(normWs + '/');
  });
  if (runningWithPort && runningWithPort.port) {
    const isOwned = await processManager.isPortOwnedByWorkspace(runningWithPort.port, wsRoot);
    if (isOwned) {
      return res.redirect(`/api/preview/proxy?url=${encodeURIComponent(`http://localhost:${runningWithPort.port}`)}`);
    } else {
      processManager.stop(runningWithPort.id);
    }
  }

  // Find user HTML files:
  // If wsRoot is host IDE, skip all root IDE bundle files (index.html, dist, build, public)
  const candidateHtmls: Array<{ file: string; path: string }> = [];
  if (!isHost) {
    candidateHtmls.push(
      { file: path.join(wsRoot, 'index.html'), path: '/workspace/index.html' },
      { file: path.join(wsRoot, 'public', 'index.html'), path: '/workspace/public/index.html' },
      { file: path.join(wsRoot, 'dist', 'index.html'), path: '/workspace/dist/index.html' },
      { file: path.join(wsRoot, 'build', 'index.html'), path: '/workspace/build/index.html' }
    );
  }

  for (const c of candidateHtmls) {
    if (fs.existsSync(c.file)) {
      return res.redirect(c.path);
    }
  }

  // Scan subdirectories for user-created HTML files (e.g. landing/index.html, site/index.html, etc.)
  try {
    const entries = fs.readdirSync(wsRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (
        ent.isDirectory() &&
        !ent.name.startsWith('.') &&
        ent.name !== 'node_modules' &&
        ent.name !== 'dist' &&
        ent.name !== 'dist-server' &&
        ent.name !== 'dist-exe' &&
        ent.name !== 'src' &&
        ent.name !== 'server' &&
        ent.name !== 'desktop'
      ) {
        const subIndex = path.join(wsRoot, ent.name, 'index.html');
        if (fs.existsSync(subIndex)) {
          return res.redirect(`/workspace/${ent.name}/index.html`);
        }
      }
    }
  } catch {}

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SUTRA Live Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0c0d10;
      color: #94a3b8;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      user-select: none;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 11px;
      font-family: monospace;
      color: #94a3b8;
      margin-bottom: 12px;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #64748b;
    }
    h1 {
      font-size: 15px;
      font-weight: 600;
      color: #f1f2f5;
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }
    p {
      font-size: 12px;
      max-width: 320px;
      line-height: 1.5;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="badge"><span class="dot"></span>Live Preview Sandbox</div>
  <h1>Workspace is not ready</h1>
  <p>Start a dev server or create HTML files in your workspace to preview them here.</p>
</body>
</html>`);
}));

interface DetectedProject {
  id: string;
  name: string;
  framework: string;
  type: 'nextjs' | 'vite' | 'astro' | 'nuxt' | 'remix' | 'svelte' | 'cra' | 'python' | 'static' | 'custom';
  cwd: string;
  relCwd: string;
  command: string;
  port: number | null;
  isRunning: boolean;
  portConflict?: boolean;
  previewUrl: string;
  badge: string;
}

async function detectWorkspaceProjects(wsRoot: string): Promise<DetectedProject[]> {
  const projects: DetectedProject[] = [];
  const scannedDirs = new Set<string>();
  const isHost = isHostIdeRoot(wsRoot);

  const checkDir = async (dir: string, relCwd = '') => {
    if (scannedDirs.has(dir) || !fs.existsSync(dir)) return;
    scannedDirs.add(dir);

    // If this is the host IDE root itself, do NOT detect it as a user previewable project
    if (dir === wsRoot && isHost) {
      return;
    }

    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const scripts = (pkg.scripts || {}) as Record<string, string>;
        const scriptCmd = scripts.dev || scripts.start || '';
        const parsedPort = processManager.detectPort(scriptCmd);

        let framework = 'Node App';
        let type: DetectedProject['type'] = 'custom';
        let port: number | null = parsedPort || 3000;
        let command = scripts.dev ? 'npm run dev' : (scripts.start ? 'npm start' : 'npm run dev');
        let badge = 'NODE';

        if (deps['next']) {
          framework = 'Next.js';
          type = 'nextjs';
          port = parsedPort || 3000;
          command = 'npm run dev';
          badge = 'NEXT';
        } else if (deps['vite']) {
          framework = 'Vite';
          type = 'vite';
          port = parsedPort || 5173;
          command = 'npm run dev';
          badge = 'VITE';
        } else if (deps['astro']) {
          framework = 'Astro';
          type = 'astro';
          port = parsedPort || 4321;
          command = 'npm run dev';
          badge = 'ASTRO';
        } else if (deps['nuxt']) {
          framework = 'Nuxt';
          type = 'nuxt';
          port = parsedPort || 3000;
          command = 'npm run dev';
          badge = 'NUXT';
        } else if (deps['@remix-run/react']) {
          framework = 'Remix';
          type = 'remix';
          port = parsedPort || 3000;
          command = 'npm run dev';
          badge = 'REMIX';
        } else if (deps['@sveltejs/kit']) {
          framework = 'SvelteKit';
          type = 'svelte';
          port = parsedPort || 5173;
          command = 'npm run dev';
          badge = 'SVELTE';
        } else if (deps['react-scripts']) {
          framework = 'Create React App';
          type = 'cra';
          port = parsedPort || 3000;
          command = 'npm start';
          badge = 'REACT';
        }

        const isRunning = port ? await processManager.isPortOwnedByWorkspace(port, dir) : false;
        const portListening = isRunning ? true : (port ? await processManager.isPortListening(port) : false);
        const portConflict = portListening && !isRunning;

        projects.push({
          id: `proj-${relCwd || 'root'}-${type}`,
          name: pkg.name || (relCwd ? path.basename(relCwd) : 'Workspace Project'),
          framework,
          type,
          cwd: dir,
          relCwd: relCwd || '.',
          command,
          port,
          isRunning,
          portConflict,
          previewUrl: port ? `http://localhost:${port}` : '/preview',
          badge,
        });
      } catch {}
    }

    // Check static index.html
    const indexHtml = path.join(dir, 'index.html');
    const publicIndexHtml = path.join(dir, 'public', 'index.html');
    if (fs.existsSync(indexHtml) || fs.existsSync(publicIndexHtml)) {
      const relPath = fs.existsSync(indexHtml)
        ? (relCwd ? `${relCwd}/index.html` : 'index.html')
        : (relCwd ? `${relCwd}/public/index.html` : 'public/index.html');
      const existing = projects.find((p) => p.cwd === dir && p.type !== 'custom');
      if (!existing) {
        projects.push({
          id: `proj-${relCwd || 'root'}-static`,
          name: relCwd ? path.basename(relCwd) : 'Static Site',
          framework: 'Static HTML',
          type: 'static',
          cwd: dir,
          relCwd: relCwd || '.',
          command: '',
          port: null,
          isRunning: true,
          previewUrl: `/workspace/${relPath}`,
          badge: 'HTML',
        });
      }
    }
  };

  // 1. Check workspace root
  await checkDir(wsRoot, '');

  // 2. Scan immediate subfolders (depth 1)
  try {
    const entries = fs.readdirSync(wsRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'dist-server' || ent.name === 'vendor' || ent.name === 'workspace') continue;
        const subDir = path.join(wsRoot, ent.name);
        await checkDir(subDir, ent.name);
      }
    }
  } catch {}

  return projects;
}

// 8. Discover all pages & HTML files across the workspace for multi-page preview
app.get('/api/preview/pages', safeHandler(async (_req, res) => {
  const wsRoot = fsTools.getWorkspaceRoot();
  const isHost = isHostIdeRoot(wsRoot);
  const pages: Array<{ title: string; path: string; type: 'html' | 'nextjs' | 'route' }> = [];

  const scanDir = (dir: string, baseRel = '', depth = 0) => {
    if (depth > 4 || !fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'dist-server') continue;
        const full = path.join(dir, ent.name);
        const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          scanDir(full, rel, depth + 1);
        } else if (ent.isFile()) {
          if (ent.name.endsWith('.html') || ent.name.endsWith('.htm')) {
            // If host IDE root, ignore the root index.html to avoid recursive IDE loading
            if (isHost && rel === 'index.html') continue;
            const cleanRel = rel.replace(/^workspace\//, '');
            const normalizedPath = `/workspace/${cleanRel}`;
            if (!pages.some((p) => p.path === normalizedPath)) {
              const cleanTitle = ent.name.replace(/\.html?$/i, '');
              const formattedTitle = cleanTitle === 'index' ? (cleanRel.includes('/') ? `${path.dirname(cleanRel)} (index)` : 'Home') : cleanTitle;
              pages.push({
                title: formattedTitle.charAt(0).toUpperCase() + formattedTitle.slice(1),
                path: normalizedPath,
                type: 'html',
              });
            }
          } else if ((rel.startsWith('app/') || rel.startsWith('pages/')) && (ent.name === 'page.tsx' || ent.name === 'page.jsx' || ent.name === 'page.js' || ent.name.endsWith('.tsx') || ent.name.endsWith('.jsx'))) {
            const route = rel.replace(/^app\//, '/').replace(/^pages\//, '/').replace(/\/page\.[tj]sx?$/, '').replace(/\.[tj]sx?$/, '');
            const cleanRoute = route === '/index' || route === '' ? '/' : route;
            pages.push({
              title: cleanRoute === '/' ? 'Home (Next.js)' : `${cleanRoute} (Next.js)`,
              path: cleanRoute,
              type: 'nextjs',
            });
          }
        }
      }
    } catch {}
  };

  scanDir(wsRoot);

  const projects = await detectWorkspaceProjects(wsRoot);
  const listening = processManager.list().find((p: any) => p.status === 'running' && p.port);

  res.json({
    success: true,
    pages,
    projects,
    activePort: listening?.port || null,
  });
}));

// Intelligent Source File & CSS Locator for Targeted Visual Element Inspector
app.post('/api/preview/locate-element', safeHandler(async (req, res) => {
  const {
    tagName = '',
    selector = '',
    textContent = '',
    classList = [],
    attributes = {},
    pageUrl = '',
    outerHTML = '',
  } = req.body || {};

  const wsRoot = fsTools.getWorkspaceRoot();
  const sourceMatches: Array<{ file: string; line: number; snippet: string; confidence: number; reason: string }> = [];
  const cssMatches: Array<{ file: string; line: number; selector: string; rule: string }> = [];

  const textToFind = String(textContent || '').trim();
  const cleanClasses: string[] = Array.isArray(classList) ? classList.filter(Boolean) : [];
  const attrEntries = Object.entries(attributes || {}).filter(([k, v]) => k !== 'class' && k !== 'style' && Boolean(v));

  // Determine the primary page file if pageUrl points to workspace
  let primaryPageFile = '';
  if (pageUrl && pageUrl.includes('/workspace/')) {
    const rel = pageUrl.split('/workspace/')[1]?.split('?')[0]?.replace(/^\/+/, '');
    if (rel && fs.existsSync(path.join(wsRoot, rel))) {
      primaryPageFile = rel;
    }
  }

  // Scan workspace files
  const maxScanFiles = 250;
  let scannedCount = 0;

  function scanWorkspace(dir: string, baseRel = '') {
    if (scannedCount >= maxScanFiles) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (scannedCount >= maxScanFiles) break;
        if (
          ent.name.startsWith('.') ||
          ent.name === 'node_modules' ||
          ent.name === 'dist' ||
          ent.name === 'dist-server' ||
          ent.name === 'dist-exe' ||
          ent.name === '.sutra' ||
          ent.name === '.sandbox' ||
          ent.name === 'coverage'
        ) {
          continue;
        }

        const fullPath = path.join(dir, ent.name);
        const relPath = baseRel ? `${baseRel}/${ent.name}` : ent.name;

        if (ent.isDirectory()) {
          scanWorkspace(fullPath, relPath);
        } else if (ent.isFile()) {
          scannedCount++;
          const ext = path.extname(ent.name).toLowerCase();

          // 1. Check CSS files for styling rules
          if (ext === '.css' || ext === '.scss') {
            try {
              const cssText = fs.readFileSync(fullPath, 'utf8');
              const lines = cssText.split('\n');
              for (const cls of cleanClasses) {
                const regex = new RegExp(`(^|[\\s,{>+~])\\.${cls}([\\s,{:>+~]|$)`, 'i');
                for (let i = 0; i < lines.length; i++) {
                  if (regex.test(lines[i])) {
                    const snippet = lines.slice(i, Math.min(lines.length, i + 6)).join('\n').trim();
                    if (!cssMatches.some(m => m.file === relPath && m.line === i + 1)) {
                      cssMatches.push({
                        file: relPath,
                        line: i + 1,
                        selector: `.${cls}`,
                        rule: snippet,
                      });
                    }
                    break;
                  }
                }
              }
            } catch {}
            continue;
          }

          // 2. Check HTML / JSX / TSX / Vue / Svelte / JS files
          if (['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte', '.js', '.mjs', '.ts'].includes(ext)) {
            try {
              const fileContent = fs.readFileSync(fullPath, 'utf8');
              const lines = fileContent.split('\n');

              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                let confidence = 0;
                let reason = '';

                // A. Check exact unique attribute match (e.g. data-name="Cleo", id="...", data-id="...")
                for (const [attrName, attrVal] of attrEntries) {
                  if (typeof attrVal === 'string' && attrVal.length > 1) {
                    if (line.includes(`${attrName}="${attrVal}"`) || line.includes(`${attrName}='${attrVal}'`) || line.includes(`${attrName}={`) || line.includes(attrVal)) {
                      confidence += 40;
                      reason = `Matches attribute ${attrName}="${attrVal}"`;
                    }
                  }
                }

                // B. Check text content match (e.g. "Adopt Cleo" or "Cleo")
                if (textToFind && textToFind.length > 2) {
                  if (line.includes(textToFind)) {
                    confidence += 35;
                    reason = reason || `Matches element text "${textToFind}"`;
                  } else {
                    const firstWord = textToFind.split(/\s+/)[0];
                    if (firstWord && firstWord.length > 2 && line.includes(firstWord) && (line.includes('${') || line.includes('{'))) {
                      confidence += 25;
                      reason = reason || `Matches template string containing "${firstWord}"`;
                    }
                  }
                }

                // C. Check class matches
                for (const cls of cleanClasses) {
                  if (cls.length > 3 && line.includes(cls)) {
                    confidence += 15;
                    reason = reason || `Contains CSS class "${cls}"`;
                  }
                }

                // D. Bonus for primary page file
                if (relPath === primaryPageFile) {
                  confidence += 10;
                }

                // Tag bonus
                if (tagName && (line.includes(`<${tagName}`) || line.includes(`'${tagName}'`) || line.includes(`"${tagName}"`))) {
                  confidence += 5;
                }

                if (confidence >= 30) {
                  const snippet = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join('\n').trim();
                  sourceMatches.push({
                    file: relPath,
                    line: i + 1,
                    snippet,
                    confidence,
                    reason,
                  });
                  i += 2;
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  scanWorkspace(wsRoot);

  sourceMatches.sort((a, b) => b.confidence - a.confidence);
  const topSourceMatches = sourceMatches.slice(0, 4);
  const topCssMatches = cssMatches.slice(0, 3);

  const summaryParts: string[] = [];
  summaryParts.push(`Target Element: <${tagName}${cleanClasses.length ? '.' + cleanClasses.join('.') : ''}>${textToFind ? ` "${textToFind}"` : ''}`);
  if (pageUrl) summaryParts.push(`Page: ${pageUrl}`);
  if (selector) summaryParts.push(`DOM Selector: ${selector}`);

  if (topSourceMatches.length > 0) {
    summaryParts.push(`\nMatched Source Code in Workspace:`);
    for (const sm of topSourceMatches) {
      summaryParts.push(`• ${sm.file}:${sm.line} (${sm.reason}):\n  \`\`\`\n  ${sm.snippet}\n  \`\`\``);
    }
  }

  if (topCssMatches.length > 0) {
    summaryParts.push(`\nMatched Stylesheet Rules:`);
    for (const cm of topCssMatches) {
      summaryParts.push(`• ${cm.file}:${cm.line} (${cm.selector}):\n  \`\`\`css\n  ${cm.rule}\n  \`\`\``);
    }
  }

  res.json({
    success: true,
    tagName,
    selector,
    textContent: textToFind,
    classList: cleanClasses,
    pageUrl,
    sourceMatches: topSourceMatches,
    cssMatches: topCssMatches,
    briefing: summaryParts.join('\n'),
  });
}));

// Vercel-grade framework & project detection endpoint
app.get('/api/preview/detect', safeHandler(async (_req, res) => {
  const wsRoot = fsTools.getWorkspaceRoot();
  const projects = await detectWorkspaceProjects(wsRoot);
  const running = projects.find((p) => p.isRunning && p.port);
  const activeProject = running || projects.find((p) => p.type !== 'static') || projects[0] || null;

  res.json({
    success: true,
    projects,
    activeProject,
  });
}));

// 1-Click / Auto Launch for any detected project or dev server
app.post('/api/preview/launch', safeHandler(async (req, res) => {
  const { cwd, command, port, path: requestedPath, chatId } = req.body || {};
  const wsRoot = fsTools.getWorkspaceRoot();
  const isHost = isHostIdeRoot(wsRoot);
  const resolvedCwd = cwd ? (path.isAbsolute(cwd) ? cwd : path.resolve(wsRoot, cwd)) : wsRoot;

  // Handle static HTML direct preview launch (no dev server needed for plain HTML)
  if (requestedPath && typeof requestedPath === 'string') {
    const cleanPath = requestedPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const fullRequestedPath = path.isAbsolute(requestedPath) ? requestedPath : path.join(wsRoot, cleanPath);
    const requestedDir = path.dirname(fullRequestedPath);
    const isHtml = /\.html?$/i.test(cleanPath);
    const childPkg = path.join(requestedDir, 'package.json');
    const hasChildDevScript = fs.existsSync(childPkg) && (requestedDir !== wsRoot || !isHost);

    // If it's a static HTML file and has no separate dev server package.json, serve directly as static preview!
    if (isHtml && !hasChildDevScript) {
      const siteUrl = `/workspace/${cleanPath}`;
      return res.json({
        success: true,
        url: siteUrl,
        previewUrl: siteUrl,
        port: null,
      });
    }
  }

  // If port is provided and already listening AND owned by this workspace, return preview URL immediately
  if (port && (await processManager.isPortOwnedByWorkspace(Number(port), resolvedCwd))) {
    const liveUrl = `http://localhost:${port}`;
    return res.json({
      success: true,
      port: Number(port),
      url: liveUrl,
      previewUrl: liveUrl,
    });
  }

  // If active process in this workspace is already listening, return it
  const activeProcesses = processManager.list();
  const normCwd = path.resolve(resolvedCwd).toLowerCase().replace(/\\/g, '/');
  const listening = activeProcesses.find((p: any) => {
    if (p.status !== 'running' && p.status !== 'starting') return false;
    if (!p.port) return false;
    const normProcCwd = path.resolve(p.cwd).toLowerCase().replace(/\\/g, '/');
    return normProcCwd === normCwd || normProcCwd.startsWith(normCwd + '/');
  });
  if (listening && listening.port) {
    const isOwned = await processManager.isPortOwnedByWorkspace(listening.port, resolvedCwd);
    if (isOwned) {
      const liveUrl = `http://localhost:${listening.port}`;
      return res.json({
        success: true,
        port: listening.port,
        url: liveUrl,
        previewUrl: liveUrl,
      });
    } else {
      processManager.stop(listening.id);
    }
  }

  let cmdStr = (command || '').trim();
  // Do NOT auto-pick host IDE's dev server if resolvedCwd is the host IDE root
  if (!cmdStr && (!isHost || resolvedCwd !== wsRoot)) {
    const pkgPath = path.join(resolvedCwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts?.dev) cmdStr = 'npm run dev';
        else if (pkg.scripts?.start) cmdStr = 'npm start';
      } catch {}
    }
  }

  if (cmdStr) {
    let parts = cmdStr.split(/\s+/);
    let targetPort = port ? Number(port) : (processManager.detectPort(parts[0], parts.slice(1)) || 5174);

    // If target port is occupied or collides with IDE (5173/3001), pick an alternative free port
    const isConflict = targetPort === 5173 || targetPort === 3001 || ((await processManager.isPortListening(targetPort)) && !(await processManager.isPortOwnedByWorkspace(targetPort, resolvedCwd)));
    if (isConflict) {
      const freePort = await processManager.findAvailablePort(5000);
      targetPort = freePort;
      if (cmdStr.includes('next dev')) {
        parts = ['npx', 'next', 'dev', '-p', String(targetPort)];
      } else if (cmdStr.includes('vite')) {
        parts = ['npx', 'vite', '--port', String(targetPort)];
      }
    }

    const result = await processManager.launch(parts[0], parts.slice(1), resolvedCwd, targetPort, chatId);
    const resolvedPort = result.port || targetPort;
    const finalUrl = `http://localhost:${resolvedPort}`;
    return res.json({
      success: result.success,
      port: resolvedPort,
      url: finalUrl,
      previewUrl: finalUrl,
      error: result.error,
    });
  }

  // Static site fallback
  const cleanPath = (requestedPath || '').replace(/^[/\\]+/, '');
  const siteUrl = `/workspace/${cleanPath || 'index.html'}`;
  res.json({
    success: true,
    url: siteUrl,
    previewUrl: siteUrl,
    port: null,
  });
}));

// 9. Frame-Safe Proxy for Next.js, Vite, or external sites (Strips X-Frame-Options & CSP)
app.get('/api/preview/proxy', async (req, res) => {
  try {
    const rawUrl = (req.query.url as string || '').trim();
    if (!rawUrl) {
      return res.status(400).send('Missing url query parameter');
    }

    const targetUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
      ? rawUrl
      : `http://${rawUrl}`;

    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).send('Invalid URL protocol. Only http and https are permitted.');
    }
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (
      hostname === '169.254.169.254' ||
      hostname.startsWith('169.254.') ||
      hostname === 'metadata.google.internal' ||
      hostname === 'instance-data' ||
      hostname === '0.0.0.0'
    ) {
      return res.status(403).send('Target address is blocked by security guardrails.');
    }

    if ((hostname === 'localhost' || hostname === '127.0.0.1') && (port === '3001' || port === '5173')) {
      return res.status(400).send(`<!DOCTYPE html><html><body style="background:#0c0d10;color:#fff;font-family:sans-serif;padding:30px;text-align:center;"><h3>Preview Notice</h3><p style="color:#94a3b8;font-size:13px;">Cannot preview the SUTRA IDE host application itself on port ${port}. Please select a workspace project or enter an external URL.</p></body></html>`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': (req.headers.accept as string) || '*/*',
      },
    });
    clearTimeout(timeout);

    res.status(response.status);

    // Strip frame busters and download-triggering headers
    for (const [key, value] of response.headers.entries()) {
      const lower = key.toLowerCase();
      if (
        lower === 'x-frame-options' ||
        lower === 'content-security-policy' ||
        lower === 'content-security-policy-report-only' ||
        lower === 'content-encoding' ||
        lower === 'content-disposition'
      ) {
        continue;
      }
      res.setHeader(key, value);
    }

    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-forms allow-same-origin allow-modals; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      let html = await response.text();
      // Inject <base> tag so relative paths in Next.js (/ _next/...) resolve to the target origin
      const effectiveOrigin = new URL(response.url || targetUrl).origin;
      const baseTag = `<base href="${effectiveOrigin}/" />`;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n  ${baseTag}`);
      } else {
        html = `${baseTag}\n${html}`;
      }
      return res.send(html);
    }

    const isRenderable = !contentType ||
      contentType.startsWith('text/') ||
      contentType.startsWith('image/') ||
      contentType.startsWith('audio/') ||
      contentType.startsWith('video/') ||
      contentType.startsWith('font/') ||
      contentType.includes('javascript') ||
      contentType.includes('json') ||
      contentType.includes('xml') ||
      contentType.includes('pdf') ||
      contentType.includes('svg');

    if (!isRenderable && contentType.includes('octet-stream')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!DOCTYPE html>
<html>
<head><title>Preview Notice</title><style>body{background:#0c0d10;color:#94a3b8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;text-align:center;padding:20px}h3{color:#f1f2f5;margin-bottom:8px}code{color:#a78bfa;background:#1e1f29;padding:2px 6px;border-radius:4px}</style></head>
<body>
  <h3>Binary File Preview</h3>
  <p>This endpoint returns binary data (<code>${contentType || 'application/octet-stream'}</code>) which cannot be rendered directly in live HTML preview.</p>
</body>
</html>`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    res.status(502).send(`<!DOCTYPE html><html><body style="background:#0c0d10;color:#fff;font-family:sans-serif;padding:30px;text-align:center;"><h3>Dev Server Connection Notice</h3><p style="color:#94a3b8;font-size:13px;">Could not connect to target URL: ${err.message}. Make sure your local server is running.</p></body></html>`);
  }
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

export interface ReplayPacket {
  seq: number;
  timestamp: number;
  channel: string;
  type: string;
  payload: any;
}

/**
 * Circular Ring Buffer for $O(1)$ zero-copy packet ingestion.
 */
class CircularPacketBuffer {
  private buffer: Array<ReplayPacket | null>;
  private head = 0; // oldest element index
  private tail = 0; // next write index
  private count = 0;
  public readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
  }

  public push(packet: ReplayPacket): void {
    this.buffer[this.tail] = packet;
    this.tail = (this.tail + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity; // Evict oldest
    }
  }

  public toArray(): ReplayPacket[] {
    const result: ReplayPacket[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const item = this.buffer[idx];
      if (item) result.push(item);
    }
    return result;
  }

  public getSince(lastSeq: number): ReplayPacket[] {
    const all = this.toArray();
    if (all.length === 0) return [];
    if (lastSeq <= 0) return all;

    // Binary search for first packet with seq > lastSeq
    let low = 0;
    let high = all.length - 1;
    let cutoff = all.length;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (all[mid].seq > lastSeq) {
        cutoff = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return all.slice(cutoff);
  }

  public get size(): number {
    return this.count;
  }

  public clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}

/**
 * StreamReplayBuffer — Lossless WebSocket Event Sourcing & Reconnection Buffer
 * Retains rolling sequence-tagged packets per chat session with zero memory leaks (LRU eviction).
 */
export class StreamReplayBuffer {
  private static buffers: Map<string, CircularPacketBuffer> = new Map();
  private static sequenceCounters: Map<string, number> = new Map();
  private static lastAccessed: Map<string, number> = new Map();
  private static MAX_BUFFER_SIZE = 500;
  private static MAX_ACTIVE_SESSIONS = 100;

  public static append(chatId: string, channel: string | WSChannel, type: string, payload: any): ReplayPacket {
    const nextSeq = (this.sequenceCounters.get(chatId) || 0) + 1;
    this.sequenceCounters.set(chatId, nextSeq);
    this.lastAccessed.set(chatId, Date.now());

    const packet: ReplayPacket = {
      seq: nextSeq,
      timestamp: Date.now(),
      channel: String(channel),
      type,
      payload,
    };

    let buf = this.buffers.get(chatId);
    if (!buf) {
      this.evictStaleSessionsIfNeeded();
      buf = new CircularPacketBuffer(this.MAX_BUFFER_SIZE);
      this.buffers.set(chatId, buf);
    }
    buf.push(packet);

    return packet;
  }

  public static getPacketsSince(chatId: string, lastSeq: number): ReplayPacket[] {
    this.lastAccessed.set(chatId, Date.now());
    const buf = this.buffers.get(chatId);
    if (!buf) return [];
    return buf.getSince(lastSeq);
  }

  public static getLastSequence(chatId: string): number {
    return this.sequenceCounters.get(chatId) || 0;
  }

  public static clear(chatId: string): void {
    const buf = this.buffers.get(chatId);
    if (buf) buf.clear();
    this.buffers.delete(chatId);
    this.sequenceCounters.delete(chatId);
    this.lastAccessed.delete(chatId);
  }

  /**
   * LRU eviction when active chat session count exceeds threshold.
   */
  private static evictStaleSessionsIfNeeded(): void {
    if (this.buffers.size < this.MAX_ACTIVE_SESSIONS) return;

    let oldestChatId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, time] of this.lastAccessed.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestChatId = id;
      }
    }

    if (oldestChatId) {
      this.clear(oldestChatId);
    }
  }
}

/* ----------------------------------------------------
 * WEBSOCKET GATEWAY & LIVE MULTIPLEXING
 * ---------------------------------------------------- */
let globalActiveAgentSocket: WebSocket | null = null;
let globalActiveAgentAbortController: AbortController | null = null;

wss.on('connection', (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
  const isMobile = urlParams.get('client') === 'mobile' || userAgent.includes('Mobile');

  const ownedPtySessions = new Set<string>();
  let currentPromptChatId = 'default';

  // Automatically buffer all outgoing AGENT_STREAM packets in StreamReplayBuffer for lossless reconnection
  const rawWsSend = ws.send.bind(ws);
  (ws as any).send = function (data: any, ...args: any[]) {
    try {
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        if (parsed?.channel === WSChannel.AGENT_STREAM && currentPromptChatId) {
          StreamReplayBuffer.append(currentPromptChatId, WSChannel.AGENT_STREAM, parsed.type, parsed.payload);
        }
      }
    } catch {
      // Replay buffering is best-effort
    }
    return (rawWsSend as any)(data, ...args);
  };

  let activeAgentAbortController: AbortController | null = null;
  // Serialize agent runs per socket: a second prompt while one is active is refused
  // (the async message handler must not interleave two tool loops on one conversation).
  let agentRunActive = false;
  // Mid-flight steering: prompts injected into the ACTIVE run without killing it.
  // Drained at every round boundary; a steer arriving during the final round
  // grants a small bounded continuation instead of being dropped.
  interface PendingSteerItem {
    text: string;
    model?: string;
    provider?: string;
  }
  const pendingSteers: PendingSteerItem[] = [];

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
  } else if (!isLoopbackAddress(clientIp) || (req.headers.origin && !isLoopbackOrigin(req.headers.origin as string))) {
    // Remote desktop/browser connection or non-loopback origin: require a valid user session token
    const token = urlParams.get('token') || parseCookieHeader(req.headers.cookie);
    const session = findValidSession(token);
    if (!session) {
      console.warn(`[WS] Rejected unauthenticated remote client ${clientIp} (origin: ${req.headers.origin || 'none'})`);
      try {
        ws.send(createPacket(WSChannel.AGENT_STREAM, 'error', {
          message: 'Authentication required — connect from this machine or provide a valid session token.',
        }));
      } catch {
        // Socket may already be closing
      }
      ws.close(4401, 'Authentication required');
      return;
    }
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
          const sid = packet.payload?.sessionId || 'main';
          ownedPtySessions.add(sid);
          const cols = packet.payload?.cols || 80;
          const rows = packet.payload?.rows || 24;
          ptyManager.createSession(sid, ws, cols, rows);
        } else if (packet.type === 'data') {
          ptyManager.writeData(packet.payload.sessionId || 'main', packet.payload.data);
        } else if (packet.type === 'resize') {
          ptyManager.resize(packet.payload.sessionId || 'main', packet.payload.cols, packet.payload.rows);
        }
        break;

      case WSChannel.PTY_RESIZE:
        ptyManager.resize(packet.payload.sessionId || 'main', packet.payload.cols, packet.payload.rows);
        break;

      case WSChannel.AGENT_APPROVAL:
        if (packet.type === 'decision' || packet.type === 'approve' || packet.type === 'reject') {
          const toolCallId = String(packet.payload?.toolCallId || packet.payload?.id || (packet as any).toolCallId || '');
          const approved = packet.type === 'approve' ? true : packet.type === 'reject' ? false : Boolean(packet.payload?.approved);
          if (toolCallId) {
            if (approved) {
              agentSwarm.approveToolCall(toolCallId)
                .then((result) => {
                  resolveApprovalDeferral(toolCallId, { approved: true, result });
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_TOOL_CALL, 'result', { id: toolCallId, tool: 'tool', result }));
                  }
                })
                .catch(() => {
                  resolveApprovalDeferral(toolCallId, { approved: false });
                });
            } else {
              agentSwarm.rejectToolCall(toolCallId);
              resolveApprovalDeferral(toolCallId, { approved: false });
            }
          }
        }
        break;

      case WSChannel.AGENT_STREAM:
        if (packet.type === 'sync_session') {
          const syncChatId = String(packet.payload?.chatId || 'default');
          const lastSeq = Number(packet.payload?.lastSequence || 0);
          const replayPackets = StreamReplayBuffer.getPacketsSince(syncChatId, lastSeq);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(createPacket(WSChannel.AGENT_STREAM, 'sync_ack', {
              chatId: syncChatId,
              replayedCount: replayPackets.length,
              currentSequence: StreamReplayBuffer.getLastSequence(syncChatId),
              packets: replayPackets,
            }));
          }
          return;
        }

        if (packet.type === 'cancel') {
          agentRunActive = false;
          resolveQuestionsForSocket(ws);
          rejectApprovalsForSocket(ws, 'CANCELLED');
          if (globalActiveAgentAbortController) {
            try {
              globalActiveAgentAbortController.abort();
            } catch {}
            globalActiveAgentAbortController = null;
          }
          if (globalActiveAgentSocket === ws) {
            globalActiveAgentSocket = null;
          }
          if (activeAgentAbortController) {
            try {
              activeAgentAbortController.abort();
            } catch {}
            activeAgentAbortController = null;
          }
          pendingSteers.length = 0;
          // Cancel must not leak processes: background tasks spawned by this run
          // (dev servers, watchers, builds) are killed immediately.
          try {
            const killed = agentSwarm.killAllBackgroundTasks();
            if (killed > 0) console.log(`[SUTRA] Cancel: terminated ${killed} background task${killed > 1 ? 's' : ''}`);
          } catch {
            // Registry unavailable — nothing to clean
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { done: true, delta: '\n\n*(Generation stopped by user)*' }));
          }
          return;
        }

        // True mid-flight steering: the message joins the live conversation at the
        // next round boundary. The current run is NOT interrupted — Astra finishes
        // the in-flight step with full context of the new instruction and model.
        if (packet.type === 'steer') {
          const steerText = typeof packet.payload?.text === 'string' ? packet.payload.text.trim() : '';
          const steerModel = typeof packet.payload?.model === 'string' ? packet.payload.model.trim() : undefined;
          const steerProvider = typeof packet.payload?.provider === 'string' ? packet.payload.provider.trim() : undefined;
          if (!steerText) return;
          if (!agentRunActive) {
            // Nothing running — a steer is just a normal prompt.
            ws.send(createPacket(WSChannel.AGENT_STREAM, 'steer_reject', { reason: 'idle' }));
            return;
          }
          pendingSteers.push({ text: steerText, model: steerModel, provider: steerProvider });
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(createPacket(WSChannel.AGENT_STREAM, 'steer_ack', { text: steerText, model: steerModel }));
          }
          mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'steer_ack', { text: steerText, model: steerModel });
          return;
        }

        if (packet.type === 'prompt') {
          // If this client has an active ask_user question waiting for an answer,
          // treat this incoming prompt as the user's answer/guidance to that question!
          const parkedQuestion = Array.from(pendingQuestionDeferrals.entries()).find(
            ([_, entry]) => entry.ws === ws
          );
          if (parkedQuestion) {
            const [qId, qEntry] = parkedQuestion;
            const promptText = typeof packet.payload?.text === 'string' ? packet.payload.text.trim() : '';
            clearTimeout(qEntry.timer);
            pendingQuestionDeferrals.delete(qId);
            qEntry.resolve(promptText || ASK_USER_TIMEOUT_ANSWER);
            return;
          }

          if (agentRunActive || (globalActiveAgentSocket && globalActiveAgentSocket !== ws && globalActiveAgentSocket.readyState === WebSocket.OPEN)) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                done: true,
                delta: 'Another mission is currently in progress — please wait for it to finish or stop it first.',
              }));
            }
            return;
          }
          currentPromptChatId = String(packet.payload?.chatId || packet.payload?.sessionId || 'default');
          agentRunActive = true;
          globalActiveAgentSocket = ws;

          // Durable audit trail for this run — declared outside the run try-block so
          // both the completion path and the fatal-error catch can close it out.
          let runLogId: string | null = null;
          let runFinished = false;
          const endRun = (
            status: 'completed' | 'failed' | 'cancelled',
            data?: { filesMutated?: number; verificationPassed?: boolean | null }
          ) => {
            agentRunActive = false;
            if (globalActiveAgentSocket === ws) {
              globalActiveAgentSocket = null;
              globalActiveAgentAbortController = null;
            }
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
            globalActiveAgentAbortController = activeAgentAbortController;
            const signal = activeAgentAbortController.signal;

            // Fresh run: clear stale subagent specialists and tell connected clients
            agentSwarm.clearSubagents();
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(createPacket(WSChannel.SWARM_STATE, 'update', { subagents: [] }));
            }
            mobileBridge.broadcastToMobile(WSChannel.SWARM_STATE, 'update', { subagents: [] });

            // Set permission level from client ('strict' gates every action; 'full' runs autonomously).
            // Legacy client values are mapped: allow_all/auto -> full, safe -> strict.
            const rawPermission =
              packet.payload?.permissionLevel ??
              packet.payload?.permissionMode ??
              packet.payload?.mode ??
              (packet as any).permissionLevel;
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

            // Interrupted-run repair: an aborted run can leave assistant messages
            // whose tool_calls never received results. Providers reject or derail
            // on that dangling state (post-interrupt answers drifting off-topic).
            // Backfill a synthetic result for every unmatched tool_call id.
            {
              const answered = new Set<string>();
              for (const m of messages) {
                if (m.role === 'tool' && m.tool_call_id) answered.add(String(m.tool_call_id));
              }
              const repaired: any[] = [];
              for (const m of messages) {
                repaired.push(m);
                if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                  for (const tc of m.tool_calls) {
                    if (tc?.id && !answered.has(String(tc.id))) {
                      const toolName = tc.function?.name || tc.tool || tc.name || 'tool';
                      repaired.push({
                        role: 'tool',
                        name: toolName,
                        tool_call_id: String(tc.id),
                        content: JSON.stringify({ status: 'interrupted', output: 'Previous action was paused by user. Proceeding with current user prompt.' }),
                      });
                    }
                  }
                }
              }
              messages.length = 0;
              messages.push(...repaired);
            }

            // Per-chat working files: every conversation owns its own task plan,
            // so two chats in one workspace never read or overwrite each other's
            // plan. A new chat id (= new conversation) starts with a clean plan.
            const rawChatId = typeof packet.payload.chatId === 'string' ? packet.payload.chatId : '';
            const chatIdSafe = rawChatId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'default';
            const chatPlanPath = path.join(fsTools.getWorkspaceRoot(), '.sutra', 'chats', chatIdSafe, 'task_plan.md');

            // 1. Resolve and expand @ Context Mentions (@git:diff, @git:status, @problems, @terminal, @file:path, @folder:dir, @web:query)
            try {
              const lastUser = [...messages].reverse().find((m) => m.role === 'user');
              if (lastUser && typeof lastUser.content === 'string') {
                let text = lastUser.content;
                const wsRoot = fsTools.getWorkspaceRoot();

                // @git:diff
                if (text.includes('@git:diff')) {
                  try {
                    const diffRes = fsTools.gitDiff();
                    const diff = typeof diffRes === 'string' ? diffRes : (diffRes as any)?.diff || '';
                    text = text.replace(/@git:diff/g, `[Attached @git:diff]:\n\`\`\`diff\n${(diff || 'No uncommitted git changes.').slice(0, 32000)}\n\`\`\``);
                  } catch {
                    text = text.replace(/@git:diff/g, '[Attached @git:diff: (Unable to read git diff)]');
                  }
                }

                // @git:status
                if (text.includes('@git:status')) {
                  try {
                    const status = fsTools.gitStatus();
                    text = text.replace(/@git:status/g, `[Attached @git:status]:\n\`\`\`\n${JSON.stringify(status, null, 2).slice(0, 16000)}\n\`\`\``);
                  } catch {
                    text = text.replace(/@git:status/g, '[Attached @git:status: (Unable to read git status)]');
                  }
                }

                // @problems
                if (text.includes('@problems')) {
                  const rawDiags = (packet.payload?.diagnostics || packet.payload?.activeFileDiagnostics || []) as any[];
                  const diags = Array.isArray(rawDiags) && rawDiags.length > 0
                    ? rawDiags.map((d: any) => `Line ${d.startLineNumber || d.line || '?'}: [Severity ${d.severity || 'warning'}] ${d.message || d}`).join('\n')
                    : '0 compiler/linter diagnostics reported.';
                  text = text.replace(/@problems/g, `[Attached @problems (Active Diagnostics)]:\n\`\`\`\n${diags.slice(0, 16000)}\n\`\`\``);
                }

                // @terminal
                if (text.includes('@terminal')) {
                  try {
                    text = text.replace(/@terminal/g, `[Attached @terminal]:\n\`\`\`\nWorkspace active at: ${wsRoot}\n\`\`\``);
                  } catch {
                    text = text.replace(/@terminal/g, '[Attached @terminal]');
                  }
                }

                // @file:<path>
                const fileMatches = text.match(/@file:([^\s,]+)/g);
                if (fileMatches) {
                  for (const match of fileMatches) {
                    const relPath = match.replace('@file:', '').trim();
                    try {
                      const fileContent = fsTools.readFile(relPath);
                      text = text.replace(match, `[Attached @file:${relPath}]:\n\`\`\`\n${String(fileContent.content || '').slice(0, 32000)}\n\`\`\``);
                    } catch {
                      // Keep match if file cannot be read
                    }
                  }
                }

                // @folder:<path>
                const folderMatches = text.match(/@folder:([^\s,]+)/g);
                if (folderMatches) {
                  for (const match of folderMatches) {
                    const relDir = match.replace('@folder:', '').trim();
                    try {
                      const dirList = fsTools.listDirectory(relDir, false);
                      text = text.replace(match, `[Attached @folder:${relDir}]:\n\`\`\`json\n${JSON.stringify(dirList, null, 2).slice(0, 16000)}\n\`\`\``);
                    } catch {
                      // Keep match
                    }
                  }
                }

                // @web:<query>
                const webMatches = text.match(/@web:([^\n]+)/g);
                if (webMatches) {
                  for (const match of webMatches) {
                    const query = match.replace('@web:', '').trim();
                    try {
                      const { webResearchEngine } = await import('./tools/webResearchTools.js');
                      const results = await webResearchEngine.searchWeb(query, 3);
                      text = text.replace(match, `[Attached @web:${query}]:\n${(results || []).map((r: any) => `- **[${r.title || r.url}](${r.url})**: ${r.snippet || ''}`).join('\n')}`);
                    } catch {
                      // Keep match
                    }
                  }
                }

                // @codebase:<query> or @codebase:symbols
                const codebaseMatches = text.match(/@codebase:?([^\s,]*)/g);
                if (codebaseMatches) {
                  for (const match of codebaseMatches) {
                    const query = match.replace(/^@codebase:?/, '').trim() || 'core';
                    try {
                      const formatted = codebaseIndexer.formatSemanticContextForPrompt(query);
                      if (formatted && formatted.trim().length > 0) {
                        text = text.replace(match, `\n${formatted}\n`);
                      } else {
                        const symbols = codebaseIndexer.getSymbols().slice(0, 25);
                        const list = symbols.map((s) => `- \`${s.name}\` (${s.kind}) in \`${s.filePath}:${s.line}\``).join('\n');
                        text = text.replace(match, `[Attached @codebase:symbols]:\n${list}`);
                      }
                    } catch {
                      // Keep match
                    }
                  }
                }

                // @symbol:<name>
                const symbolMatches = text.match(/@symbol:([^\s,]+)/g);
                if (symbolMatches) {
                  for (const match of symbolMatches) {
                    const symName = match.replace('@symbol:', '').trim();
                    try {
                      const allSyms = codebaseIndexer.getSymbols();
                      const found = allSyms.find((s) => s.name.toLowerCase() === symName.toLowerCase()) || allSyms.find((s) => s.name.toLowerCase().includes(symName.toLowerCase()));
                      if (found) {
                        text = text.replace(match, `[Attached @symbol:${found.name} (${found.kind}) in ${found.filePath}:${found.line}]:\n\`\`\`typescript\n${(found.snippet || found.signature || found.name).slice(0, 8000)}\n\`\`\``);
                      }
                    } catch {
                      // Keep match
                    }
                  }
                }

                // 2. Expand shorthand slash commands
                const trimmed = text.trim();
                const expansions: Record<string, string> = {
                  '/plan': 'Plan this step by step before changing anything. [MANDATORY PLANNING INSTRUCTION]: Call `create_implementation_plan` or `create_artifact(type: "plan")` to produce an interactive plan artifact card. If requirements are ambiguous, call `ask_user` with multiple-choice options. Present a concise executive overview in chat, and DO NOT start modifying source code files yet. Wait for my approval:',
                  '/fix': 'Find and fix every error in this project. After fixing, run the build or tests to verify, and keep going until everything passes.',
                  '/test': 'Write and run comprehensive test suites for:',
                  '/explain': 'Explain this codebase: structure, entry points, and data flow.',
                  '/godmode': 'Autonomous mission mode: work rigorously, create task plans, implement fully, verify against tests, and ensure zero regressions.',
                  '/browser': 'Search the web and extract documentation for:',
                };
                const matched = Object.keys(expansions).find((cmd) => trimmed.toLowerCase().startsWith(`${cmd} `) || trimmed.toLowerCase() === cmd);
                if (matched) {
                  const rest = trimmed.slice(matched.length).trim();
                  text = rest ? `${expansions[matched]} ${rest}` : expansions[matched];
                }

                lastUser.content = text;
              }
            } catch {
              // Expansion is best-effort — the raw message still routes
            }

            // Stop/redirect intent: a fresh instruction supersedes any stale task plan.
            // Without this, plan-driven auto-continue resurrects work the user abandoned.
            const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
            const lastUserText = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';
            const stopIntent =
              /\b(stop|halt|cancel|abort|never ?mind|scrap (that|this|it)|forget (the|that|it)|delete (the|that) plan|change of plans?|don'?t (do|continue|bother|touch|edit)|leave it|that'?s enough|new (task|plan|instruction))\b/i
                .test(lastUserText) ||
              /\bstop\b[^.?!]{0,24}\b(working|plan|task|generat|edit|chang)/i.test(lastUserText);

            // Plan reconciliation or immediate stop acknowledgement
            if (stopIntent) {
              try {
                if (fs.existsSync(chatPlanPath)) {
                  fs.unlinkSync(chatPlanPath);
                }
              } catch {
                // Ignore plan cleanup
              }
              if (lastUserMessage) {
                lastUserMessage.content = `${lastUserText}\n\n[INSTRUCTION: STOP & CEASE ACTION]: The user explicitly instructed you to STOP or change direction. Do NOT call any tools. Do NOT write or edit any files. Do NOT update task plans. Acknowledge in 1-2 brief sentences that you have stopped and await their instruction.`;
              }
            } else {
              // If the previous plan on disk was already 100% completed, clear it
              // so the new user task starts with a fresh plan file.
              if (fs.existsSync(chatPlanPath)) {
                try {
                  const existingPlan = fs.readFileSync(chatPlanPath, 'utf-8');
                  const hasPending = /- \[ \]|\(pending\)|\(in_progress\)/.test(existingPlan);
                  if (!hasPending && existingPlan.trim().length > 0) {
                    fs.unlinkSync(chatPlanPath);
                  }
                } catch {
                  // Best-effort
                }
              }
            }
            if (!stopIntent && lastUserMessage && typeof lastUserMessage.content === 'string') {
              const isArtifactRequest = /\b(artifact|artefact)\b/i.test(lastUserText);
              const isProgressQuestion = /\b(progress|status|current process|what (?:is|have you|was) done|how much is done|what's done|what have you done)\b/i.test(lastUserText);

              // Investigation & Audit Intent Detection: strictly enforce read-only reporting and artifact creation
              const isInvestigationIntent =
                /\b(find|search|audit|check|inspect|list|show|explore|where|why|diagnose|review|scan|tell me|explain)\b/i.test(lastUserText) &&
                !/\b(fix|create|build|implement|edit|refactor|change|update|write|delete|remove|patch|repair|scaffold)\b/i.test(lastUserText);

              if (isArtifactRequest || isProgressQuestion) {
                lastUserMessage.content = `${lastUserText}\n\n[USER REQUEST - PROGRESS / ARTIFACT MANDATE]:
- The user is asking for the current progress, status, or an artifact documenting work completed.
- You MUST answer their question directly and clearly in your chat response FIRST.
${isArtifactRequest ? '- Call `create_artifact({ name: "Current Progress & Implementation Status", type: "doc", content: ... })` or `create_markdown_doc` with a comprehensive summary of completed files, architecture, and current state.\n- Summarize the artifact in your chat response.' : ''}
- Do NOT ignore this question/request to blindly resume background coding before delivering the requested answer/artifact.`;
              } else if (isInvestigationIntent) {
                lastUserMessage.content = `${lastUserText}\n\n[INVESTIGATION & AUDIT MODE ACTIVE]:
- The user asked to FIND, AUDIT, INSPECT, or DIAGNOSE issues.
- You must operate strictly in READ-ONLY mode (DO NOT call write_file, edit_file, or delete_file on source files).
- DO NOT dump long code blocks, multi-file code dumps, or massive text into chat!
- GATHER facts systematically using typecheck_project, run_unit_tests, grep_search, and read_file.
- MANDATORY: Call \`create_artifact({ name: "Codebase Bug & Audit Report", type: "findings", content: ... })\` or \`create_markdown_doc\` with the full detailed audit report (including executive summary table, root cause breakdown, file references, and proposed remediation).
- In your chat message, provide ONLY a crisp 3-5 bullet executive overview with severity levels, and inform the user that the full detailed report is available in their Artifacts tab.`;
              } else {
                // Fast-Path File Mention Grounding: extract explicitly mentioned workspace files
                try {
                  const fileMentions = Array.from(lastUserText.matchAll(/@?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]{1,8})/g))
                    .map((m: any) => String(m[1] || '').replace(/\\/g, '/'))
                    .filter((p: string) => !p.startsWith('http') && !p.includes('node_modules') && !p.includes('.git'));
                  const uniqueMentions = Array.from(new Set(fileMentions)).slice(0, 3);
                  const loadedExcerpts: string[] = [];
                  for (const relPath of uniqueMentions) {
                    try {
                      const safe = SecurityGuardrails.validateSafePath(relPath, fsTools.getWorkspaceRoot());
                      if (fs.existsSync(safe) && fs.statSync(safe).isFile()) {
                        const fileData = fsTools.readFile(relPath, undefined, { maxChars: 15000 });
                        if (fileData.content && !fileData.truncated) {
                          loadedExcerpts.push(`File \`${relPath}\`:\n\`\`\`\n${fileData.content}\n\`\`\``);
                        }
                      }
                    } catch {
                      // Best-effort pre-grounding
                    }
                  }
                  if (loadedExcerpts.length > 0) {
                    lastUserMessage.content = `${lastUserText}\n\n### PROACTIVELY PRE-LOADED FILE CONTEXT (Instant Zero-Latency Access):\n${loadedExcerpts.join('\n\n')}`;
                  }
                } catch {
                  // Pre-grounding is purely additive
                }
              }
            }

            // The composer mode is an execution contract, not merely a visual
            // preference.  It used to reach this endpoint as `agentMode` and
            // then be discarded, making Plan/Edit/Chat indistinguishable from
            // Build. Keep the contract next to the user request so it survives
            // model/provider changes during a tool loop.
            const requestedAgentMode = ['build', 'plan', 'edit', 'chat'].includes(packet.payload?.agentMode)
              ? packet.payload.agentMode
              : 'build';
            if (!stopIntent && lastUserMessage && typeof lastUserMessage.content === 'string') {
              const modeInstruction: Record<string, string> = {
                build: '[EXECUTION MODE: BUILD] You may inspect, modify, and verify the workspace when that advances the request.',
                plan: '[EXECUTION MODE: PLAN] Produce a concrete implementation plan and ask for approval before any workspace mutation. You may inspect files and diagnostics, but do not write, edit, delete, or run destructive commands.',
                edit: '[EXECUTION MODE: EDIT] Make the smallest targeted change required by the request. Inspect the relevant files, avoid broad refactors, and verify the affected behavior.',
                chat: '[EXECUTION MODE: CHAT] Answer conversationally and read-only. Do not call tools that mutate the workspace and do not create or edit files.',
              };
              lastUserMessage.content = `${lastUserMessage.content}\n\n${modeInstruction[requestedAgentMode]}`;
            }

            // Optional model override from the client — best effort, never fails the prompt.
            const requestedModelId = typeof packet.payload.model === 'string' ? packet.payload.model.trim() : '';
            const requestedProvider = typeof packet.payload.provider === 'string' ? packet.payload.provider.trim() : undefined;
            const requestedFullModelId = typeof packet.payload.fullModelId === 'string' ? packet.payload.fullModelId.trim() : undefined;
            const lookupTarget = requestedFullModelId || (requestedProvider && requestedModelId && !requestedModelId.startsWith(`${requestedProvider}:`) ? `${requestedProvider}:${requestedModelId}` : requestedModelId);

            if (lookupTarget && lookupTarget !== 'auto') {
              try {
                const resolved = modelRouter.resolveModelDefinition(lookupTarget, requestedProvider);
                if (resolved) {
                  modelRouter.setActiveModel(resolved.id, resolved.provider as string);
                }
              } catch {
                // Keep the active model
              }
            }

            agentRunActive = true;
            const harnessMode = packet.payload?.harnessMode === 'avo' ? 'avo' : 'standard';
            // Generous bounded execution: 65-80 rounds for goal missions, 45-60 for standard prompts.
            // When user says stop, allocate exactly 1 turn to acknowledge cleanly.
            let maxToolRounds = stopIntent ? 1 : isGoalModeActive ? (harnessMode === 'avo' ? 80 : 65) : (harnessMode === 'avo' ? 60 : 45);
            let roundExtensionsUsed = 0;
            const failedCallTracker: Map<string, number> = new Map();
            const callRepetitionTracker: Map<string, number> = new Map();
            // Caps how many failed-approach lessons this run writes to durable memory.
            let runFailedApproachLessons = 0;
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

            // Grounding map: a compact listing of what actually exists on disk right now
            // (server-cached, so repeated runs stay cheap). Injected under the GROUNDING
            // CONTRACT in the system prompt so Astra plans against real paths.
            let workspaceSnapshotSection = '';
            try {
              const snapshot = await getWorkspaceSnapshot(fsTools.getWorkspaceRoot());
              if (snapshot.tree) {
                workspaceSnapshotSection = `WORKSPACE SNAPSHOT (${snapshot.fileCount} entries — verify contents with read_file):\n${snapshot.tree}`;
              }
            } catch {
              // Snapshot injection must never break prompt building
            }

            // The client sends activeTabContent truncated (4000 chars), which is too thin
            // to ground editor context. When the tab has a workspace-relative path, read
            // up to 24000 chars straight from disk and use that fuller version instead —
            // falling back to the client slice if the read fails (missing file, binary,
            // or path outside the workspace).
            let activeTabContext = typeof packet.payload.activeTabContent === 'string' ? packet.payload.activeTabContent : '';
            const activeTabContextPath = typeof packet.payload.activeTabPath === 'string' ? packet.payload.activeTabPath.trim() : '';
            if (activeTabContextPath) {
              try {
                const absTabPath = SecurityGuardrails.validateSafePath(activeTabContextPath, fsTools.getWorkspaceRoot());
                activeTabContext = (await fs.promises.readFile(absTabPath, 'utf-8')).slice(0, 24000);
              } catch {
                // Keep the client-provided excerpt — grounding must never break the run.
              }
            }

            // Persistent memory: lessons, architectural notes, working memory scratchpad,
            // and procedural recipes are retrieved on-demand and ranked for relevance.
            let memorySectionText = '';
            try {
              if (lastUserText) {
                updateWorkingMemory(chatIdSafe, {
                  activeGoal: lastUserText,
                  workspaceRoot: fsTools.getWorkspaceRoot(),
                });
              }
              const memoryBlock = buildMemorySection(fsTools.getWorkspaceRoot(), 6, lastUserText, chatIdSafe);
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

            // Recall of compact facts recorded about workspace files in earlier
            // sessions — files read once never need a full re-read.
            let codeNotesSection = '';
            try {
              const latestUserContent = [...messages].reverse().find((m) => m.role === 'user')?.content;
              const mentionedPaths =
                typeof latestUserContent === 'string'
                  ? (latestUserContent.match(/[\w.@-]+(?:\/[\w.@-]+)+\.[a-zA-Z0-9]{1,8}/g) || []).slice(0, 10)
                  : [];
              codeNotesSection = buildCodeNotesSection({ priorityPaths: mentionedPaths });
            } catch {
              // Notes injection must never break prompt building
            }

            // One harness context per run — metadata (visitedTools, milestones, telemetry)
            // accumulates across rounds instead of resetting every turn.
            const harnessContext = {
              sessionId: `sutra-${Date.now()}`,
              workspaceRoot: fsTools.getWorkspaceRoot(),
              model: modelRouter.getActiveModel(),
              round: 0,
              maxRounds: maxToolRounds,
              tokenBudget: Math.floor((modelRouter.getActiveModel()?.contextWindow || 128000) * 0.85),
              chatId: chatIdSafe,
              metadata: { chatPlanPath, harnessMode } as Record<string, any>,
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

            // Steer-aware loop wrapper: the inner for-loop runs the rounds; when it
            // exits, any steering that landed during the final round is picked up
            // here and the loop re-enters with a small bounded extension instead of
            // dropping the user's mid-flight instruction on the floor.
            let steerContinuations = 0;
            let remediationAttempts = 0;
            let totalRoundsExecuted = 0;
            steerLoop: while (!signal.aborted) {
            for (let round = 0; round < maxToolRounds; round += 1) {
              totalRoundsExecuted = round + 1;
              if (signal.aborted) break;

              // Mid-flight steering drain — injected user messages join the
              // conversation at this round boundary; the run never restarts.
              if (pendingSteers.length > 0) {
                const drainedSteers = pendingSteers.splice(0, pendingSteers.length);
                for (const steerItem of drainedSteers) {
                  if (steerItem.model) {
                    modelRouter.setActiveModel(steerItem.model);
                    if (packet.payload) packet.payload.model = steerItem.model;
                  }
                  const steerText = steerItem.text;
                  const isSteerArtifactOrQuestion = /\b(artifact|artefact|progress|status|tell me|explain|what is|show|why|how)\b/i.test(steerText);
                  const steerPrompt = isSteerArtifactOrQuestion
                    ? `[STEERING - HIGH PRIORITY]: "${steerText}"\nIMPORTANT: The user is asking a direct question or requesting an artifact/status. You MUST address their question or call \`create_artifact\` / \`create_markdown_doc\` and explain it in chat in this turn FIRST before continuing with any other tasks.`
                    : `[STEERING]: ${steerText}\nAdjust your current course immediately to follow this instruction.`;
                  messages.push({ role: 'user', content: steerPrompt });
                }
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                    thinking: `Incorporating your mid-flight instruction${drainedSteers.length > 1 ? 's' : ''} — prioritizing your request now.`,
                  }));
                }
              }

              // Adaptive compute: entering what would be the final round with an
              // open plan and real progress grants bounded extensions instead of
              // cutting verified work short. Goal missions may extend repeatedly —
              // hours-long builds must not die on a fixed round budget.
              // Stagnated runs get no extension.
              const maxRoundExtensions = isGoalModeActive ? 8 : 2;
              if (round === maxToolRounds - 1 && roundExtensionsUsed < maxRoundExtensions) {
                let planOpenNow = false;
                try {
                  if (!stopIntent && fs.existsSync(chatPlanPath)) {
                    planOpenNow = /- \[ \]|\(pending\)|\(in_progress\)/.test(fs.readFileSync(chatPlanPath, 'utf-8'));
                  }
                } catch {
                  // No readable plan — no extension basis
                }
                const runShowsProgress = mutatedFiles.size > 0 || executedToolsSummary.length > 0;
                const canExtend = shouldExtendRun({
                  roundsUsed: round,
                  maxRounds: maxToolRounds,
                  planHasOpenItems: planOpenNow || isGoalModeActive,
                  runShowsProgress,
                  stagnationLevel: worstStagnationLevel,
                  extensionsUsed: roundExtensionsUsed,
                  maxExtensions: maxRoundExtensions,
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
              const openTabPaths: string[] = packet.payload.openTabPaths || [];
              const cursorPosition = packet.payload.cursorPosition;
              const selectedText = packet.payload.selectedText;
              const visibleRange = packet.payload.visibleRange;
              const activeFileDiagnostics = packet.payload.activeFileDiagnostics || [];

              // User Intent Classifier: Accurately discern user goals (build vs edit vs inquiry vs run)
              type UserIntent = 'BUILD' | 'EDIT' | 'RUN' | 'INQUIRY' | 'GENERAL';
              const classifyUserIntent = (query: string): UserIntent => {
                const q = (query || '').toLowerCase().trim();
                if (!q) return 'GENERAL';
                if (/^(?:what|why|how|explain|tell me|who|where|when|can you explain|describe)\b/i.test(q) && !/\b(?:build|create|write|implement|fix|make|scaffold)\b/i.test(q)) {
                  return 'INQUIRY';
                }
                if (/\b(?:run|start|launch|preview|serve|test|npm run|npm test|npm start)\b/i.test(q) && !/\b(?:create|build|write|implement)\b/i.test(q)) {
                  return 'RUN';
                }
                if (/\b(?:create|build|make|scaffold|generate|write|develop|setup|landing page|website|app|component|game)\b/i.test(q)) {
                  return 'BUILD';
                }
                if (/\b(?:fix|edit|modify|update|refactor|change|repair|replace|debug|patch)\b/i.test(q)) {
                  return 'EDIT';
                }
                return 'GENERAL';
              };

              // Extract last user query to search semantic AST codebase index
              const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
              const lastUserQuery = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
              const userIntent = classifyUserIntent(lastUserQuery);
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
${activeTabContext ? `- Live Content Excerpt of "${activeTabPath}":\n\`\`\`\n${activeTabContext}\n\`\`\`` : ''}`;
              }

              const activeModel = modelRouter.getActiveModel();
              const profile = activeModel?.id
                ? learnedModelLimits.getModelProfile(activeModel.id, (activeModel as any).provider || '')
                : { safeTpmTokens: 6000, maxToolOutputChars: 3000 };
              harnessContext.round = round + 1;
              harnessContext.tokenBudget = profile.safeTpmTokens;
              const customModelsDoc = customModelsManager.generateSystemPromptDocumentation();

              const dynamicSystemPrompt = buildMasterSystemPrompt({
                modelId: packet.payload?.model || activeModel?.id,
                provider: (activeModel as any)?.provider,
                workspaceRoot: fsTools.getWorkspaceRoot(),
                activeEditorInfo,
                semanticContext,
                workspaceSnapshot: workspaceSnapshotSection,
                memorySection: memorySectionText,
                codeNotesSection,
                toolStatsSection,
                harnessMode,
                includeCustomModels: true,
              });

              const effectiveSystemPrompt = packet.payload.systemPrompt || dynamicSystemPrompt;


              const executionModelId = lookupTarget || packet.payload?.fullModelId || (typeof packet.payload?.model === 'string' ? packet.payload.model.trim() : undefined);
              for await (const chunk of sutraHarness.executeHarnessTurn({
                messages,
                modelId: executionModelId,
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
                  const rawErr = String(chunk.error).toLowerCase();
                  const isContextErr = rawErr.includes('context') || rawErr.includes('token limit') || rawErr.includes('maximum context') || rawErr.includes('too many tokens') || rawErr.includes('prompt too long') || rawErr.includes('413');
                  if (isContextErr) {
                    // Auto-compact conversation context to recover smoothly without repeating the error
                    const compacted = compactConversationContext(messages, Math.floor(profile.safeTpmTokens * 0.6));
                    messages.splice(0, messages.length, ...compacted);
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                        thinking: 'Context limit encountered — auto-compacted conversation history to recover smoothly.',
                      }));
                    }
                    break;
                  }
                  const errorNotice = `\n\n**Astra could not reach the model**: ${toPlainUserError(chunk.error)}\n\n*Check your API key, rate limits, or connection in Settings.*`;
                  assistantText += errorNotice;
                  totalStreamedText += errorNotice;
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { delta: errorNotice }));
                  }
                }
                if (chunk.toolCalls) requestedTools.push(...chunk.toolCalls);
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

              // Autonomous Tool Dialect Rescue: Parse XML/token/function tool dialects from open-weights/free models
              if (requestedTools.length === 0) {
                const dialectResult = rescueToolDialects(assistantText, round);
                if (dialectResult.hasRescuedTools) {
                  requestedTools = dialectResult.rescuedTools;
                  assistantText = dialectResult.cleanText;
                  totalStreamedText = dialectResult.cleanText;
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      resetContent: true,
                      delta: assistantText,
                      toolCalls: requestedTools,
                      thinking: dialectResult.reasoningText,
                    }));
                  }
                  mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'chunk', {
                    resetContent: true,
                    delta: assistantText,
                    toolCalls: requestedTools,
                    thinking: dialectResult.reasoningText,
                  });
                }
              }

              // Fallback text tool-call interceptor: if a model outputted pseudo-code blocks like
              // <!-- TOOL_CODE_START --> print(await lint_code()) <!-- TOOL_CODE_END -->
              if (requestedTools.length === 0 && assistantText.includes('<!-- TOOL_CODE_START -->')) {
                const toolCodeRegex = /<!-- TOOL_CODE_START -->([\s\S]*?)<!-- TOOL_CODE_END -->/g;
                let match;
                while ((match = toolCodeRegex.exec(assistantText)) !== null) {
                  const rawCode = match[1].trim();
                  const callMatch = rawCode.match(/(?:print\s*\(\s*)?(?:await\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]*)\)\s*\)?$/);
                  if (callMatch) {
                    const tool = callMatch[1];
                    let params = {};
                    try {
                      params = JSON.parse(callMatch[2] || '{}');
                    } catch {
                      // Non-JSON pseudo-code arguments fall back to empty parameter dictionary
                      params = {};
                    }
                    requestedTools.push({
                      id: `fallback-call-${round}-${requestedTools.length + 1}-${tool}`,
                      tool,
                      params,
                    });
                  }
                }
              }

              // Fallback text tool-call interceptor 2: if model outputted markdown file code blocks
              // (e.g. ```html <!DOCTYPE html>...``` or ```javascript // main.js ...``` or preceded by `**main.js**`)
              // in chat prose instead of invoking write_file, auto-materialize write_file calls so code is written to disk!
              const hasWriteTools = requestedTools.some((t: any) => t.tool === 'write_file' || t.tool === 'edit_file');
              if (!hasWriteTools && assistantText.includes('```')) {
                const codeBlockRegex = /```([a-zA-Z0-9_-]*)(?::([^\n]+))?\n([\s\S]*?)```/g;
                let blockMatch;
                const candidates: Array<{ path: string; content: string; fullMatch: string; callId: string }> = [];

                // Check if user explicitly requested a specific subfolder (e.g., "in folder landing" or "inside directory my-app")
                const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                const lastUserContent = typeof lastUser?.content === 'string' ? lastUser.content : '';
                const dirIntentMatch = lastUserContent.match(/\b(?:in|inside|into)\s+(?:the\s+)?(?:folder|directory|dir)\s+["']?([a-zA-Z0-9_.-]+)["']?/i);
                const targetSubdir = dirIntentMatch ? dirIntentMatch[1].trim() : '';

                while ((blockMatch = codeBlockRegex.exec(assistantText)) !== null) {
                  const lang = (blockMatch[1] || '').trim().toLowerCase();
                  const explicitPath = (blockMatch[2] || '').trim();
                  const codeContent = blockMatch[3].trim();

                  // Ignore short snippets or shell/terminal commands
                  if (codeContent.length < 25) continue;
                  if (['bash', 'sh', 'shell', 'powershell', 'cmd', 'terminal', 'output', 'log'].includes(lang)) continue;

                  let targetPath = explicitPath;

                  // 1. Check preceding text before the code block
                  if (!targetPath) {
                    const textBefore = assistantText.slice(0, blockMatch.index);
                    const recentPrecedingLines = textBefore.trim().split('\n').slice(-4).join('\n');
                    const preHeaderMatch = recentPrecedingLines.match(/(?:^|\n)[#*`\s]*(?:file:\s*|create\s+)?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]{1,8})[:`*#\s]*(?:\n|$)/i);
                    if (preHeaderMatch) {
                      targetPath = preHeaderMatch[1].trim();
                    }
                  }

                  // 2. Check first 2 lines inside the code content
                  if (!targetPath) {
                    const firstLines = codeContent.split('\n').slice(0, 2).join('\n');
                    const commentNameMatch = firstLines.match(/(?:\/\/|<!--|#|\/\*)\s*([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]{1,8})\s*(?:-->|\*\/)?/);
                    if (commentNameMatch) {
                      targetPath = commentNameMatch[1].trim();
                    }
                  }

                  // 3. Fallback inference based on content/language
                  if (!targetPath) {
                    if (lang === 'html' || /<!DOCTYPE html|<html/i.test(codeContent)) {
                      targetPath = 'index.html';
                    } else if (lang === 'css' || codeContent.includes('body {') || codeContent.includes(':root {')) {
                      const cssHrefMatch = assistantText.match(/<link\s+[^>]*href=["']([^"']+\.css)["']/i);
                      if (cssHrefMatch) {
                        targetPath = cssHrefMatch[1].replace(/^\.?\/+/, '');
                      } else {
                        const ws = fsTools.getWorkspaceRoot();
                        targetPath = fs.existsSync(path.join(ws, 'styles.css')) ? 'styles.css' : 'style.css';
                      }
                    } else if (['js', 'javascript', 'ts', 'typescript'].includes(lang) || codeContent.includes('THREE') || codeContent.includes('canvas') || codeContent.includes('document.')) {
                      const scriptSrcMatch = assistantText.match(/<script\s+[^>]*src=["']([^"']+\.js)["']/i);
                      targetPath = scriptSrcMatch ? scriptSrcMatch[1].replace(/^\.?\/+/, '') : (candidates.some(c => c.path.endsWith('index.html')) ? 'main.js' : 'script.js');
                    } else if (lang === 'python' || lang === 'py' || codeContent.includes('def ') || codeContent.includes('import ')) {
                      targetPath = 'main.py';
                    } else if (lang === 'json' && codeContent.includes('"name"')) {
                      targetPath = 'package.json';
                    }
                  }

                  if (targetPath && !targetPath.includes('..')) {
                    // Prepend targetSubdir if explicitly requested and not already present
                    if (targetSubdir && !targetPath.startsWith(targetSubdir + '/') && !targetPath.startsWith(targetSubdir + '\\')) {
                      targetPath = `${targetSubdir}/${targetPath}`;
                    }
                    const callId = `auto-write-${round}-${candidates.length + 1}-${path.basename(targetPath)}`;
                    candidates.push({ path: targetPath, content: codeContent, fullMatch: blockMatch[0], callId });
                  }
                }

                if (candidates.length > 0) {
                  for (let i = 0; i < candidates.length; i++) {
                    const c = candidates[i];
                    requestedTools.push({
                      id: c.callId,
                      tool: 'write_file',
                      params: { path: c.path, content: c.content },
                    });
                    // Replace the raw code block in assistant text with the tool marker so the raw code is not echoed in chat prose
                    assistantText = assistantText.replace(c.fullMatch, `\n<!-- TOOL_CALL:${c.callId} -->\n`);
                    totalStreamedText = totalStreamedText.replace(c.fullMatch, `\n<!-- TOOL_CALL:${c.callId} -->\n`);
                  }
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      resetContent: true,
                      delta: assistantText,
                      toolCalls: requestedTools,
                      thinking: `Writing ${candidates.length} generated code file(s) directly to disk (${candidates.map((c) => c.path).join(', ')})...`,
                    }));
                  }
                  mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'chunk', {
                    resetContent: true,
                    delta: assistantText,
                    toolCalls: requestedTools,
                  });
                }
              }

              // Handle turn with no tool calls
              if (requestedTools.length === 0) {
                const trimmedText = assistantText.trim();
                const isGoalComplete = assistantText.includes('<!-- GOAL_COMPLETE -->') || assistantText.includes('[GOAL_COMPLETE]');

                // Plan-driven continuation: when the model stops calling tools but its
                // own task plan still has unfinished items — or the reply plainly ends
                // mid-thought — nudge it to continue instead of letting the run die.
                let planHasOpenItems = false;
                try {
                  if (!stopIntent && fs.existsSync(chatPlanPath)) {
                    const plan = fs.readFileSync(chatPlanPath, 'utf-8');
                    planHasOpenItems = /- \[ \]|\(pending\)|\(in_progress\)/.test(plan);
                  }
                } catch {
                  // No readable plan — nothing to continue from
                }
                const promisesActionWithoutTools =
                  /\b(?:i will now|i will|i'll|i am going to|i'm going to|going to perform|will perform|will restart|let me perform|let me start|starting the|running the following|following actions|following checks|following steps|proceeding to|now proceeding|now reading|now writing|now inspecting|now scaffolding|now building|now checking)\b/i.test(trimmedText) &&
                  /\b(?:typecheck|unit tests?|tests?|linter|lint|search|read|inspect|check|diagnos|investigat|fix|implement|scan|scaffold|scaffolding|write|edit|create|build|todos?|files?|config|readme)\b/i.test(trimmedText);

                const looksUnfinished =
                  /[:;]\s*$/.test(trimmedText) ||
                  /\b(let me|next,?|then,?|now i|now let|i will|i'll|searching|inspecting|checking|scaffolding|reading|writing|creating)\b[^.!?]{0,120}$/i.test(trimmedText) ||
                  promisesActionWithoutTools;

                // Check if any mutating tools already completed the objective
                const hasModifiedFiles = executedToolsSummary.some((t) => ['write_file', 'edit_file', 'patch_file'].includes(t));

                const shouldContinuePlan = planHasOpenItems && autoContinues < 4;
                const shouldContinuePromise = promisesActionWithoutTools && autoContinues < 3;
                const shouldContinueUnfinished = looksUnfinished && autoContinues < 2;
                const needsGoalContinuation = (isGoalModeActive || userIntent === 'BUILD' || userIntent === 'EDIT') && !isGoalComplete && !hasModifiedFiles && round < 3;

                if (!stopIntent && round < maxToolRounds - 1 && userIntent !== 'INQUIRY' && (shouldContinuePlan || shouldContinuePromise || shouldContinueUnfinished || needsGoalContinuation)) {
                  autoContinues += 1;
                  messages.push({ role: 'assistant', content: assistantText });
                  let continuePrompt = '[CONTINUE]: Perform the necessary tool actions now, then summarize.';
                  if (promisesActionWithoutTools) {
                    continuePrompt = '[IMMEDIATE ACTION]: You described actions in prose. Invoke your tools now to perform the work.';
                  } else if (planHasOpenItems) {
                    continuePrompt = '[PLAN CONTINUATION]: Continue executing the remaining open items in your task plan.';
                  } else if (needsGoalContinuation) {
                    continuePrompt = '[EXECUTION CONTINUATION]: Implement the requested solution using your tools now.';
                  }

                  messages.push({
                    role: 'user',
                    content: continuePrompt,
                  });
                  continue;
                }

                if (isGoalModeActive && !isGoalComplete && !hasModifiedFiles && round < 3) {
                  // Goal mode: only nudge if no files were produced yet and early in the run
                  messages.push({
                    role: 'assistant',
                    content: assistantText,
                  });
                  messages.push({
                    role: 'user',
                    content: '[GOAL CONTINUATION]: Implement the requested solution using your tools now.',
                  });
                  continue;
                }

                // If goal mode or files were modified, append completion marker quietly
                if ((isGoalModeActive || hasModifiedFiles) && !isGoalComplete && ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      delta: '\n\n<!-- GOAL_COMPLETE -->',
                    })
                  );
                }
                break;
              }

              // Sentinel: Redundant tool repetition detection (Mutating cap: 3, Read/Inspect cap: 2 without mutations)
              const mutatingTools = new Set(['write_file', 'edit_file', 'delete_file', 'patch_file']);
              const inspectionTools = new Set(['read_file', 'grep_search', 'list_directory', 'codebase_search', 'typecheck_project']);
              const hasRecentMutations = mutatedFiles.size > 0;
              let anyInspectionBlocked = false;

              const deduplicatedTools = requestedTools.filter((toolCall) => {
                const isMutating = mutatingTools.has(toolCall.tool);
                const isInspection = inspectionTools.has(toolCall.tool);
                const callSig = `${toolCall.tool}:${JSON.stringify(toolCall.params || {})}`;
                const repCount = (callRepetitionTracker.get(callSig) || 0) + 1;
                callRepetitionTracker.set(callSig, repCount);

                if (isMutating && repCount >= 3) {
                  console.warn(`[SUTRA Harness Sentinel] Blocked repetitive mutating tool "${toolCall.tool}" after ${repCount} duplicate invocations.`);
                  return false;
                }
                if (isInspection && repCount >= 2 && !hasRecentMutations) {
                  console.warn(`[SUTRA Harness Sentinel] Blocked repetitive inspection tool "${toolCall.tool}" after ${repCount} duplicate invocations.`);
                  anyInspectionBlocked = true;
                  return false;
                }
                return true;
              });

              if (deduplicatedTools.length === 0) {
                if (anyInspectionBlocked) {
                  messages.push({
                    role: 'user',
                    content: '[SYNTHESIS & ACTION REQUIRED]: You have already inspected the necessary workspace files. Directly answer the user, explain your diagnosis, and write the required code to make the site fully working now.',
                  });
                  continue;
                }
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      delta: '\n\n*(Stopped a repeating tool loop — let me know how you would like me to adjust the approach.)*',
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

              // Strict mode: mutating and state-changing tools require explicit user approval
              const MUTATING_TOOL_SET = new Set([
                'write_file',
                'edit_file',
                'delete_file',
                'rename_path',
                'run_command',
                'run_managed_process',
                'stop_managed_process',
                'restart_managed_process',
                'generate_image_asset',
                'generate_svg_asset',
                'generate_video_asset',
                'generate_audio_asset',
                'git_commit',
                'git_branch',
                'git_checkout',
                'git_cherry_pick',
                'git_reset',
                'git_merge',
                'install_dependencies',
                'execute_code',
                'delete_artifact',
              ]);
              const toolsToExecute = deduplicatedTools.map((toolCall) => {
                const requiresGate = MUTATING_TOOL_SET.has(toolCall.tool);
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

              const executions = await executeToolBatchWithScheduler(
                toolsToExecute.map(({ toolCall }) => toolCall),
                async (toolCall) => {
                  if (signal.aborted) return { error: 'Aborted' };

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
                      return invalidResult;
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
                    return `User answered: "${answer}"`;
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
                    return { status: 'skipped', message: denialMessage };
                  }
                  if (decision && decision.approved) {
                    // Already executed by /api/swarm/approve-tool — reuse its result.
                    executedToolsSummary.push(execDescription);
                    return decision.result;
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
                      return blockedResult;
                    }

                    executedToolsSummary.push(execDescription);

                    // Broadcast inline diff for editor visualization
                    if (ws.readyState === WebSocket.OPEN && (toolCall.tool === 'write_file' || toolCall.tool === 'edit_file')) {
                      ws.send(createPacket(WSChannel.AGENT_STREAM, 'inline_diff', {
                        path: toolCall.params?.path || 'workspace',
                        proposedContent: toolCall.params?.content || toolCall.params?.replacement || '',
                      }));
                    }

                    let toolTimeoutMs = 30000;
                    if (toolCall.tool === 'run_command') {
                      const classification = classifyCommand(toolCall.params?.command);
                      if (toolCall.params?.background === true || classification.waitClass === 'server') {
                        toolTimeoutMs = 15000; // Immediate spawn & background task detachment
                      } else if (classification.waitClass === 'long') {
                        toolTimeoutMs = Math.max(600000, Number(toolCall.params?.timeoutMs) || 600000); // 10 mins for builds/installs
                      } else {
                        toolTimeoutMs = Math.max(120000, Number(toolCall.params?.timeoutMs) || 120000); // 2 mins for normal commands
                      }
                    } else if (['typecheck_project', 'run_unit_tests', 'codebase_search', 'search_web', 'scrape_url'].includes(toolCall.tool)) {
                      toolTimeoutMs = 60000;
                    } else if (['generate_image_asset', 'generate_video_asset', 'generate_music'].includes(toolCall.tool)) {
                      toolTimeoutMs = 120000;
                    }

                    // Race the tool against a safety timeout, and ALWAYS clear the timer.
                    // The old code left it pending — up to 600s for builds/installs —
                    // leaking one handle per tool call and keeping the event loop alive
                    // long after the run finished. The run's abort signal is threaded
                    // through too, so pressing Stop actually cancels the tool instead of
                    // leaving `run_command` / installs running to their own timeout.
                    const runToolWithTimeout = async (): Promise<any> => {
                      let safetyTimer: ReturnType<typeof setTimeout> | undefined;
                      const timeoutGuard = new Promise<any>((resolve) => {
                        safetyTimer = setTimeout(
                          () =>
                            resolve({
                              error: `Tool "${toolCall.tool}" reached safety timeout (${toolTimeoutMs / 1000}s) and was safely resolved.`,
                              code: 'timeout',
                              retryable: true,
                            }),
                          toolTimeoutMs
                        );
                      });
                      try {
                        return await Promise.race([
                          agentSwarm.executeTool(toolCall, { planFilePath: chatPlanPath, signal }),
                          timeoutGuard,
                        ]);
                      } finally {
                        if (safetyTimer) clearTimeout(safetyTimer);
                      }
                    };

                    let result: any = await runToolWithTimeout();

                    // Tool failures are returned as envelopes, not thrown. Treat them
                    // as control flow: back off on rate limits, compact after context
                    // overflows, and restore Auto routing after pinned auth failures.
                    const isToolFailure = (value: any) => Boolean(value && typeof value === 'object' && value.error);
                    if (isToolFailure(result) && !signal.aborted) {
                      const errorCode = String(result.code || 'unknown');
                      if (errorCode === 'context_overflow') {
                        const compactedMessages = compactConversationContext(messages, profile.safeTpmTokens);
                        messages.splice(0, messages.length, ...compactedMessages);
                        messages.push({ role: 'user', content: '[RECOVERY]: Context was compacted after a tool overflow. Continue from the compacted evidence; do not repeat large reads.' });
                      }
                      if (errorCode === 'auth') {
                        if (ws.readyState === WebSocket.OPEN) {
                          ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                            thinking: 'Authentication error encountered during tool execution. Please verify provider credentials in Settings.',
                          }));
                        }
                      }
                      const retryLimit = errorCode === 'rate_limit'
                        ? 3
                        : (errorCode === 'context_overflow' || errorCode === 'auth' || result.retryable === true ? 1 : 0);
                      for (let retry = 0; retry < retryLimit && isToolFailure(result) && !signal.aborted; retry += 1) {
                        const delayMs = errorCode === 'rate_limit' ? Math.min(8000, 1000 * 2 ** retry) : 500;
                        await new Promise((resolve) => setTimeout(resolve, delayMs));
                        try {
                          result = await runToolWithTimeout();
                        } catch {
                          // Preserve the last structured failure for model recovery.
                        }
                      }
                    }

                    // Reading a file boosts the recall rank of any note recorded for it
                    if (toolCall.tool === 'read_file' && typeof toolCall.params?.path === 'string') {
                      try {
                        touchCodeNotes([toolCall.params.path]);
                      } catch {
                        // Ranking is best-effort
                      }
                    }

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

                    // Broadcast real-time artifact updates to the IDE Artifacts panel
                    if (['create_artifact', 'update_artifact', 'create_markdown_doc', 'create_findings_report', 'create_implementation_plan', 'write_todos'].includes(toolCall.tool)) {
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(createPacket(WSChannel.AGENT_STREAM, 'artifact_update', {
                          tool: toolCall.tool,
                          result,
                        }));
                      }
                      mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'artifact_update', {
                        tool: toolCall.tool,
                        result,
                      });
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
                    return result;
                  } catch (err: any) {
                    // Fix A5: Execution-Feedback Self-Healing with Hard Block on 3rd failure
                    const failCount = (failedCallTracker.get(callSignature) || 0) + 1;
                    failedCallTracker.set(callSignature, failCount);

                    let failureAdvice = selfHealingEngine.formatSelfHealingPrompt(toolCall.tool, err.message, callSignature);
                    if (failCount >= 3) {
                      failureAdvice = 'This exact action failed 3 times and was stopped to protect your workflow. Inspect the file with a fresh read, then adjust the approach.';
                    } else if (failCount >= 2) {
                      failureAdvice += `\nHeads up: this same action failed ${failCount} times with identical arguments — re-read the file or try a different approach.`;
                      // Durable lesson: the NEXT run must not open with the same
                      // broken methodology. Recorded once per signature (not on
                      // every retry) and capped per run so memory stays signal.
                      if (runFailedApproachLessons < 3) {
                        runFailedApproachLessons += 1;
                        try {
                          rememberMemory({
                            kind: 'lesson',
                            content: `Failed approach in this workspace: ${toolCall.tool} ${String(JSON.stringify(callSignature)).slice(0, 160)} — kept failing (${String(err.message).slice(0, 120)}). Start with a different method; do not repeat this exact call.`,
                            workspaceRoot: fsTools.getWorkspaceRoot(),
                          });
                          pruneMemories();
                        } catch {
                          // Memory recording must never break the run
                        }
                      }
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
                    return result;
                  }
                },
                (stage) => {
                  // Stage execution status is internal operational telemetry — do not inject into model thinking
                  void stage;
                }
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
                    // Provide calm system guidance without provoking overthinking
                    messages.push({
                      role: 'system',
                      content: `[System Notice]: ${assessment.reason}. Please inspect file state and adjust the approach rather than repeating identical calls.`,
                    });
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
                try {
                  if (!execution || !execution.toolCall) continue;
                  const rawResult = typeof execution.result === 'string' ? execution.result : JSON.stringify(execution.result ?? { error: 'Tool execution was interrupted' });
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
                } catch (resultErr: any) {
                  // Partial result from aborted/crashed tool — inject a safe fallback
                  console.warn('[WS Agent] Skipping corrupted tool result:', resultErr?.message);
                  if (execution?.toolCall?.id) {
                    messages.push({
                      role: 'tool',
                      tool_call_id: execution.toolCall.id,
                      content: '{"error": "Tool execution was interrupted or returned an invalid result."}',
                    });
                  }
                }
              }
            }

            // The for-loop exited. A steer that landed during the final round is
            // stranded — honor it with a bounded continuation rather than dropping it.
            const strandedSteers = pendingSteers.splice(0, pendingSteers.length);
            if (strandedSteers.length > 0 && steerContinuations < 3 && !signal.aborted) {
              steerContinuations += 1;
              maxToolRounds += 4;
              for (const steer of strandedSteers) {
                if (steer.model) {
                  modelRouter.setActiveModel(steer.model);
                  if (packet.payload) packet.payload.model = steer.model;
                }
                messages.push({ role: 'user', content: `[STEERING]: ${steer.text}` });
              }
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                  thinking: 'Your instruction arrived just as the run was wrapping up — continuing with it now.',
                }));
              }
              continue steerLoop;
            }

            // Autonomous Verification & Self-Healing:
            // If files were mutated and verification finds failures, do NOT just dump a warning and stop.
            // Feed the failure back to the model and auto-repair until the first version is ready to use!
            if (!signal.aborted && mutatedFiles.size > 0 && remediationAttempts < 2) {
              try {
                const report = await runWorkspaceVerification({
                  workspaceRoot: fsTools.getWorkspaceRoot(),
                  filesChanged: mutatedFiles.size,
                  mutatedFiles: Array.from(mutatedFiles),
                  permissionMode: permissionLevel,
                  onProgress: (message) => {
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { thinking: message }));
                      mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'chunk', { thinking: message });
                    }
                  },
                });
                const failedChecks = report.checks.filter((c) => c.status === 'failed' || c.status === 'timeout');
                if (failedChecks.length > 0) {
                  remediationAttempts += 1;
                  maxToolRounds += 4;
                  const remediationPrompt = `[AUTONOMOUS REPAIR REQUIRED - ATTEMPT ${remediationAttempts}]: Workspace verification failed with ${failedChecks.length} issue(s):\n` +
                    failedChecks.map((c) => `• ${c.name}: ${c.summary}`).join('\n') +
                    `\n\nPlease fix these issues directly in the affected files now so that the site/app runs cleanly and is completely ready to use.`;
                  messages.push({ role: 'user', content: remediationPrompt });
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', {
                      thinking: `Verification detected ${failedChecks.length} issue(s). Autonomously fixing errors now until the site is ready to use...`,
                    }));
                  }
                  continue steerLoop;
                }
              } catch (err: any) {
                console.warn('[SUTRA] In-flight verification self-heal probe skipped:', err?.message);
              }
            }

            // Hand back any unprocessed stranded steers if terminating
            if (strandedSteers.length > 0 && ws.readyState === WebSocket.OPEN) {
              for (const steer of strandedSteers) {
                ws.send(createPacket(WSChannel.AGENT_STREAM, 'steer_reject', { reason: 'run_ended', text: steer.text }));
              }
            }
            break steerLoop;
            }

            // Anti-Empty Reply Sentinel: Guarantee an informative response is always streamed
            if (!totalStreamedText.trim() && !signal.aborted) {
              if (mutatedFiles.size > 0) {
                const summaryNotice = `\n\nI have updated ${Array.from(mutatedFiles).map((f) => `\`${f}\``).join(', ')} to fulfill your request. The changes are live and ready to preview.`;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { delta: summaryNotice }));
                }
              } else if (executedToolsSummary.length > 0) {
                const toolsUsed = Array.from(new Set(executedToolsSummary.map((s) => s.split(':')[0]))).join(', ');
                const summaryNotice = `\n\nI inspected the workspace files (${toolsUsed}). I am ready to apply any fixes or modifications to your code — let me know what changes you would like!`;
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
                  mutatedFiles: Array.from(mutatedFiles),
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
                  if (failedChecks.length > 0) {
                    const warningText = `\n\n⚠️ **Verification Warning**: ${failedChecks.length} check(s) failed after repair attempts:\n` +
                      failedChecks.map((c) => `• **${c.name}**: ${c.summary}`).join('\n');
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { delta: warningText }));
                  } else {
                    const successText = `\n\n✅ **Verification Passed**: All checks passed! The first version of the site is verified, running, and ready to use.`;
                    ws.send(createPacket(WSChannel.AGENT_STREAM, 'chunk', { delta: successText }));
                  }
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

            // Stretch #21: LLM-as-Judge Evaluation
            try {
              const { TaskJudge } = await import('./harness/judge.js');
              const judgement = TaskJudge.evaluateRun({
                userGoal: typeof packet.payload?.prompt === 'string' ? packet.payload.prompt : '',
                executedTools: (executedToolsSummary as any) || [],
                mutatedFiles: Array.from(mutatedFiles),
                verificationPassed: verificationPassed === true,
                verificationSummary: verificationPassed === false ? 'Checks failed' : 'All passed',
              });
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(createPacket(WSChannel.AGENT_STREAM, 'judgement', { judgement }));
              }
              mobileBridge.broadcastToMobile(WSChannel.AGENT_STREAM, 'judgement', { judgement });
            } catch (judgeErr: any) {
              console.warn('[TaskJudge] Evaluation skipped:', judgeErr?.message);
            }

            // Consolidation was implemented but never connected to the run
            // lifecycle. Keep durable memory compact after each completed run.
            try {
              const consolidation = consolidateMemories();
              if (runLogId && consolidation.mergedCount > 0) {
                recordEvent(runLogId, 'MemoriesConsolidated', consolidation);
              }
            } catch (memoryErr: any) {
              console.warn('[SUTRA] Memory consolidation skipped:', memoryErr?.message);
            }

            // Record episode into Episodic Memory & update Working Memory
            try {
              if (lastUserText && (totalStreamedText || executedToolsSummary.length > 0)) {
                recordEpisodicEpisode({
                  taskQuery: lastUserText,
                  actionSummary: `Mutated ${mutatedFiles.size} file(s) across ${totalRoundsExecuted} round(s). Verification: ${verificationPassed ? 'Passed' : 'Not verified'}.`,
                  trajectory: executedToolsSummary.slice(-10),
                  toolsUsed: Array.from(new Set(executedToolsSummary.map((t) => t.split(':')[0]))),
                  outcome: signal.aborted ? 'partial' : verificationPassed ? 'success' : 'partial',
                  fitnessScore: verificationPassed ? 1.0 : signal.aborted ? 0.3 : 0.7,
                  lessonsLearned: [],
                  workspaceRoot: fsTools.getWorkspaceRoot(),
                });
                updateWorkingMemory(chatIdSafe, {
                  activeGoal: '',
                  scratchpad: `Last task completed with ${mutatedFiles.size} file(s) modified. Verification: ${verificationPassed ? 'Passed' : 'Pending'}.`,
                });
              }
            } catch (epErr: any) {
              console.warn('[EpisodicMemory] Recording skipped:', epErr?.message);
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
            pendingSteers.length = 0;
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
    if (globalActiveAgentSocket === ws) {
      globalActiveAgentSocket = null;
      globalActiveAgentAbortController = null;
    }
    for (const sid of ownedPtySessions) {
      try {
        ptyManager.killSession(sid);
      } catch {
        // Best effort
      }
    }
    ownedPtySessions.clear();

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
  res.type('html');
  // Prohibit framing the host IDE itself under all circumstances (prevents recursive iframe fork bombs)
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none';");
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.sendFile(path.join(rootDir, 'index.html'));
  }
}

// Global Express error handler — catches synchronous & asynchronous route throws
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err?.status === 'number' ? err.status : (typeof err?.statusCode === 'number' ? err.statusCode : 500);
  const message = err?.message || 'Internal Server Error';
  console.error(`[SUTRA Error] ${status} - ${message}`, err);
  if (!res.headersSent) {
    res.status(status).json({ success: false, ok: false, error: message });
  }
});

// Unknown API routes must 404 as JSON — never fall through to the SPA shell
// (a typo'd endpoint silently returning index.html masks real failures).
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Unknown API route' });
});

// Fallback route for SPA - send built production index.html so mobile devices load cleanly
app.get('*', (req, res) => {
  // Guard: NEVER send host SPA HTML for stylesheets, scripts, or binary assets!
  // Doing so causes Chrome to reject stylesheets with MIME mismatch errors.
  if (req.path.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline');
    return res.status(200).send(getFallbackStylesheet(path.basename(req.path)));
  }
  if (req.path.endsWith('.js') || req.path.endsWith('.mjs')) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline');
    return res.status(404).send('/* 404: Script not found */');
  }
  if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp3|wav|mp4)$/i.test(req.path)) {
    return res.status(404).end();
  }
  sendSpaIndex(res);
});

const startListening = (portToTry: number) => {
  server.removeAllListeners('error');
  server.once('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      // A second server silently walking to 3002 makes the desktop bridge run
      // two independent tool loops. The desktop launcher probes 3001 before it
      // spawns; if another process wins that race, stop instead of splitting.
      console.warn(`[SUTRA] Port ${portToTry} is already in use; refusing to start a duplicate server.`);
      process.exitCode = 0;
      server.close(() => process.exit(0));
    } else {
      console.error(`[SUTRA] Server listen error:`, err);
    }
  });

  server.listen(portToTry, '0.0.0.0', () => {
    startScheduler(portToTry);
    // Auto-probe and warm up Antigravity language server proxy and local sign-in
    try {
      const proxy = discoverAntigravityProxy();
      if (proxy) {
        console.log(`[Antigravity] Language server proxy auto-connected (PID ${proxy.pid} on port ${proxy.port})`);
      } else {
        const signIn = describeLocalAntigravitySignIn();
        if (signIn.available) {
          console.log(`[Antigravity] ${signIn.detail}`);
        }
      }
    } catch (err: any) {
      console.warn(`[Antigravity] Startup probe notice: ${err?.message}`);
    }

    console.log(`\n======================================================`);
    console.log(`SUTRA IDE server is active`);
    console.log(`Workspace: http://localhost:${portToTry}`);
    console.log(`Live Preview: http://localhost:${portToTry}/preview`);
    console.log(`Mobile Companion: http://${mobileBridge.getLanIp()}:${portToTry}/mobile`);
    console.log(`Health check: http://localhost:${portToTry}/health`);
    console.log(`API version:  http://localhost:${portToTry}/api/version`);
    console.log(`======================================================\n`);
  });
};

// Only bind the HTTP/WS server when run as a standalone process (not when imported by test suites)
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startListening(PORT);
}

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
    const killedTasks = agentSwarm.killAllBackgroundTasks();
    if (killedTasks > 0) console.log(`[SUTRA] Cleaned up ${killedTasks} background tasks on shutdown.`);
  } catch {
    // Ignore task cleanup error
  }
  try {
    processManager.stopAll();
  } catch {
    // Process manager cleanup best effort
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
process.on('unhandledRejection', (reason) => {
  console.warn('[SUTRA] unhandledRejection caught (non-fatal):', reason);
});
process.on('uncaughtException', (err: any) => {
  console.error('[SUTRA] uncaughtException caught (preventing crash):', err?.message || err);
});

// Persistent event loop anchor to guarantee process never exits when idle
setInterval(() => {}, 1000 * 60 * 60).unref();
setInterval(() => {}, 1000 * 60).unref();
