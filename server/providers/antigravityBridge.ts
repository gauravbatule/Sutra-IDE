import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { execSync, spawn, ChildProcess } from 'child_process';
import Database from 'better-sqlite3';
import { rescueToolDialects } from '../harness/toolDialectRescue.js';

const loopbackKeepAliveAgent = new https.Agent({
  rejectUnauthorized: false, // Only used for 127.0.0.1 local language server daemon
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60000,
});

const loopbackHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60000,
});

const CODE_ASSIST_HOST = 'https://cloudcode-pa.googleapis.com';

const CLIENT_CONFIGS: Array<{ id: string; secret: string }> = [
  {
    id: process.env.ANTIGRAVITY_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    secret: process.env.ANTIGRAVITY_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
  },
].filter((c) => Boolean(c.id && c.secret));
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface LocalGeminiCreds {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}

interface BridgeState {
  accessToken: string | null;
  accessTokenExpiresAt: number;
  projectId: string | null;
  lastError: string | null;
}

const state: BridgeState = {
  accessToken: null,
  accessTokenExpiresAt: 0,
  projectId: null,
  lastError: null,
};

export interface DiscoveredProxy {
  pid: number;
  port: number;
  csrfToken: string;
  httpPort?: number;
  httpsPort?: number;
  managed?: boolean;
}

let cachedProxy: DiscoveredProxy | null = null;
let lastProxyCheckTime = 0;
let managedDaemonProcess: ChildProcess | null = null;
let managedDaemonPromise: Promise<DiscoveredProxy | null> | null = null;

export const resetAntigravityProxyCache = (): void => {
  cachedProxy = null;
  lastProxyCheckTime = 0;
};

/** Locate the Antigravity Language Server binary on the host machine across all standard install locations */
export const locateAntigravityBinary = (): string | null => {
  const home = os.homedir();
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

    candidates.push(
      path.join(localAppData, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
      path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'bin', 'language_server.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Antigravity', 'resources', 'bin', 'language_server.exe'),
      path.join(programFiles, 'Antigravity', 'resources', 'bin', 'language_server.exe'),
      path.join(programFiles, 'antigravity', 'resources', 'bin', 'language_server.exe'),
      path.join(programFilesX86, 'Antigravity', 'resources', 'bin', 'language_server.exe'),
      path.join(programFilesX86, 'antigravity', 'resources', 'bin', 'language_server.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Antigravity.app/Contents/Resources/bin/language_server',
      path.join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'bin', 'language_server'),
      path.join(home, '.antigravity', 'bin', 'language_server')
    );
  } else {
    // Linux
    candidates.push(
      '/usr/share/antigravity/resources/bin/language_server',
      '/opt/antigravity/resources/bin/language_server',
      path.join(home, '.local', 'share', 'antigravity', 'resources', 'bin', 'language_server'),
      path.join(home, '.antigravity', 'bin', 'language_server')
    );
  }

  for (const cand of candidates) {
    try {
      if (cand && fs.existsSync(cand)) {
        return cand;
      }
    } catch {}
  }

  // Fallback to system PATH lookup
  try {
    const cmd = process.platform === 'win32' ? 'where.exe language_server.exe' : 'which language_server';
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    const firstLine = out.split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}

  return null;
};

/**
 * Automatically starts and manages a standalone Antigravity Language Server proxy daemon.
 * Returns the active proxy endpoint with port and CSRF token.
 */
export const ensureAntigravityDaemonRunning = async (): Promise<DiscoveredProxy | null> => {
  // 1. If we already have a live managed daemon, return it
  if (managedDaemonProcess && !managedDaemonProcess.killed && cachedProxy && cachedProxy.managed) {
    try {
      process.kill(cachedProxy.pid, 0);
      return cachedProxy;
    } catch {
      managedDaemonProcess = null;
      cachedProxy = null;
    }
  }

  // In automated test environments (vitest), avoid spawning host daemons
  if (process.env.VITEST && !process.env.ENABLE_LIVE_DAEMON_TESTS) {
    return cachedProxy || null;
  }

  if (managedDaemonPromise) {
    return managedDaemonPromise;
  }

  managedDaemonPromise = (async (): Promise<DiscoveredProxy | null> => {
    try {
      const binaryPath = locateAntigravityBinary();
      if (!binaryPath) {
        console.warn('[Antigravity Bridge] Language server binary not found on this machine.');
        return null;
      }

      const csrfToken = crypto.randomUUID();
      console.log(`[Antigravity Bridge] Auto-spawning Language Server daemon from ${binaryPath}...`);

      const child = spawn(binaryPath, [
        '--standalone',
        '--override_ide_name', 'antigravity',
        '--subclient_type', 'hub',
        '--override_ide_version', '2.11.0',
        '--override_user_agent_name', 'antigravity',
        '--https_server_port', '0',
        '--csrf_token', csrfToken,
        '--app_data_dir', 'antigravity',
        '--api_server_url', 'https://generativelanguage.googleapis.com',
        '--cloud_code_endpoint', 'https://cloudcode-pa.googleapis.com',
      ], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      managedDaemonProcess = child;

      let detectedHttpPort: number | null = null;
      let detectedHttpsPort: number | null = null;

      const portPromise = new Promise<{ httpPort: number; httpsPort: number }>((resolve, reject) => {
        let pollInterval: NodeJS.Timeout | null = null;

        const cleanup = () => {
          clearTimeout(timeout);
          if (pollInterval) clearInterval(pollInterval);
        };

        const timeout = setTimeout(() => {
          cleanup();
          if (detectedHttpPort || detectedHttpsPort) {
            resolve({
              httpPort: detectedHttpPort || (detectedHttpsPort ? detectedHttpsPort + 1 : 52230),
              httpsPort: detectedHttpsPort || (detectedHttpPort ? detectedHttpPort - 1 : 52229),
            });
          } else {
            reject(new Error('Language server did not report listening ports within 12 seconds.'));
          }
        }, 12000);

        const onOutput = (data: Buffer) => {
          const text = data.toString();
          const httpsMatch = text.match(/(?:listening on random port at|https_server_port[^\d]*)(\d+)(?:\s*for HTTPS)?/i);
          if (httpsMatch) {
            detectedHttpsPort = Number(httpsMatch[1]);
          }
          const httpMatch = text.match(/(?:listening on random port at|http_server_port[^\d]*)(\d+)(?:\s*for HTTP)?/i);
          if (httpMatch) {
            detectedHttpPort = Number(httpMatch[1]);
          }
          if (detectedHttpPort && detectedHttpsPort) {
            cleanup();
            resolve({ httpPort: detectedHttpPort, httpsPort: detectedHttpsPort });
          }
        };

        child.stdout.on('data', onOutput);
        child.stderr.on('data', onOutput);

        // Fallback TCP probe after 3s if output was buffered
        if (child.pid) {
          const targetPid = child.pid;
          pollInterval = setInterval(() => {
            if (process.platform === 'win32') {
              try {
                const psScript = `$ProgressPreference = 'SilentlyContinue'; (Get-NetTCPConnection -OwningProcess ${targetPid} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort) -join ','`;
                const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
                const pOut = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: 2000 }).trim();
                if (pOut) {
                  const ports = pOut.split(',').map((p) => Number(p.trim())).filter((p) => p > 0);
                  if (ports.length > 0) {
                    const uniquePorts = [...new Set(ports)];
                    const hPort = uniquePorts.find((p) => p % 2 === 0) || uniquePorts[0];
                    const sPort = uniquePorts.find((p) => p % 2 !== 0) || uniquePorts[1] || (hPort ? hPort - 1 : 52229);
                    if (hPort) {
                      cleanup();
                      resolve({ httpPort: hPort, httpsPort: sPort });
                    }
                  }
                }
              } catch {}
            }
          }, 1500);
        }

        child.on('error', (err) => {
          cleanup();
          reject(err);
        });

        child.on('exit', (code) => {
          cleanup();
          if (!detectedHttpPort && !detectedHttpsPort) {
            reject(new Error(`Language server process exited prematurely with code ${code}`));
          }
        });
      });

      const { httpPort, httpsPort } = await portPromise;
      console.log(`[Antigravity Bridge] Daemon active (PID ${child.pid}, HTTP port ${httpPort}, HTTPS port ${httpsPort}).`);

      const proxyInfo: DiscoveredProxy = {
        pid: child.pid || process.pid,
        port: httpPort,
        httpPort,
        httpsPort,
        csrfToken,
        managed: true,
      };

      cachedProxy = proxyInfo;
      return proxyInfo;
    } catch (err: any) {
      console.warn('[Antigravity Bridge] Failed to auto-spawn daemon:', err?.message);
      return null;
    } finally {
      managedDaemonPromise = null;
    }
  })();

  return managedDaemonPromise;
};

// Clean up child daemon on process exit
const cleanupDaemon = () => {
  if (managedDaemonProcess && !managedDaemonProcess.killed) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${managedDaemonProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        managedDaemonProcess.kill();
      }
    } catch {}
    managedDaemonProcess = null;
  }
};
process.on('exit', cleanupDaemon);
process.on('SIGINT', cleanupDaemon);
process.on('SIGTERM', cleanupDaemon);

/** Discover the active local Antigravity Language Server process, port, and CSRF token (Cross-Platform: Windows, macOS, Linux). */
export const discoverAntigravityProxy = (): DiscoveredProxy | null => {
  // 1. Fast 0ms cache check with PID liveness verification
  if (cachedProxy) {
    try {
      process.kill(cachedProxy.pid, 0);
      return cachedProxy;
    } catch {
      // Process no longer exists, invalidate cache
      cachedProxy = null;
    }
  }

  // Check explicit environment variables if configured
  if (process.env.ANTIGRAVITY_PROXY_PORT && process.env.ANTIGRAVITY_CSRF_TOKEN) {
    const customResult: DiscoveredProxy = {
      pid: process.pid,
      port: Number(process.env.ANTIGRAVITY_PROXY_PORT),
      csrfToken: process.env.ANTIGRAVITY_CSRF_TOKEN,
    };
    cachedProxy = customResult;
    return customResult;
  }

  const now = Date.now();
  if (now - lastProxyCheckTime < 15000) {
    return null; // 15s throttle on negative cache to prevent event-loop freeze
  }
  lastProxyCheckTime = now;

  try {
    if (process.platform === 'win32') {
      // Fast kernel-filtered query for Win32_Process + NetTCPConnection via Base64 UTF-16LE
      // Suppress CLIXML progress objects with $ProgressPreference
      const psScript = `$ProgressPreference = 'SilentlyContinue'; $p = Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'"; if ($p) { $p = $p | Select-Object -First 1; $ports = (Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort); Write-Output ($p.ProcessId.ToString() + '|||' + $p.CommandLine + '|||' + ($ports -join ',')) }`;
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      const out = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: 5000 }).trim();
      const matchLine = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.includes('|||'));
      if (matchLine) {
        const [rawPid, cmdLine, portsStr] = matchLine.split('|||');
        const pidMatch = rawPid?.match(/\d+/);
        const pidNum = pidMatch ? Number(pidMatch[0]) : null;
        const csrfMatch = (cmdLine || '').match(/--csrf_token\s+([a-zA-Z0-9_-]+)/);
        const csrfToken = csrfMatch ? csrfMatch[1] : null;

        if (csrfToken && pidNum) {
          const rawPorts = (portsStr || '').split(',').map((p) => Number(p.trim())).filter((p) => p > 0);
          const uniquePorts = [...new Set(rawPorts)];
          const httpPort = uniquePorts.find((p) => p % 2 === 0) || uniquePorts[0] || 52230;
          const httpsPort = uniquePorts.find((p) => p % 2 !== 0) || uniquePorts[1] || (httpPort - 1);

          const result: DiscoveredProxy = {
            pid: pidNum,
            port: httpPort,
            httpPort,
            httpsPort,
            csrfToken,
            managed: false,
          };
          cachedProxy = result;
          return result;
        }
      }
    } else {
      // macOS & Linux process & port discovery
      const psOut = execSync(`ps -ef | grep "[l]anguage_server" | head -n 1`, { encoding: 'utf-8', timeout: 2000 }).trim();
      if (psOut) {
        const parts = psOut.split(/\s+/);
        const pidStr = parts[1];
        const pidNum = parseInt(pidStr, 10);
        const csrfMatch = psOut.match(/--csrf_token\s+([a-zA-Z0-9_-]+)/);
        const csrfToken = csrfMatch ? csrfMatch[1] : null;

        if (!isNaN(pidNum) && csrfToken) {
          let port = 49357;
          try {
            const lsofOut = execSync(`lsof -nP -iTCP -sTCP:LISTEN -p ${pidNum} 2>/dev/null`, { encoding: 'utf-8', timeout: 1500 });
            const portMatch = lsofOut.match(/127\.0\.0\.1:(\d+)/);
            if (portMatch) port = Number(portMatch[1]);
          } catch {}

          const result: DiscoveredProxy = {
            pid: pidNum,
            port,
            csrfToken,
            managed: false,
          };
          cachedProxy = result;
          return result;
        }
      }
    }
  } catch (err: any) {
    console.debug('[Antigravity] Proxy scan notice:', err?.message);
  }

  // If no external process is running, trigger background daemon startup
  ensureAntigravityDaemonRunning().catch(() => undefined);

  return null;
};

const getAntigravityDbPaths = (): string[] => {
  const home = os.homedir();
  return [
    path.join(home, 'AppData', 'Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    path.join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    path.join(home, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    path.join(home, '.antigravity', 'User', 'globalStorage', 'state.vscdb'),
  ];
};

const getAccountConfigPaths = (): string[] => {
  const home = os.homedir();
  return [
    path.join(home, '.antigravity-claude-proxy', 'accounts.json'),
    path.join(home, '.config', 'antigravity-proxy', 'accounts.json'),
    path.join(home, '.config', 'antigravity-claude-proxy', 'accounts.json'),
    path.join(home, '.antigravity', 'accounts.json'),
  ];
};

const readAntigravityVscdb = (): { access_token?: string; refresh_token?: string } | null => {
  for (const dbPath of getAntigravityDbPaths()) {
    try {
      if (!fs.existsSync(dbPath)) continue;
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });

      // 1. Check antigravityUnifiedStateSync.oauthToken
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'").get() as any;
      if (row && row.value) {
        const rawVal = String(row.value);
        const lines = rawVal.split('\n');
        let foundAccess: string | null = null;
        let foundRefresh: string | null = null;

        for (const line of lines) {
          try {
            const buf = Buffer.from(line, 'base64');
            const s = buf.toString('utf8');
            const matches = s.match(/[A-Za-z0-9+/=]{40,}/g) || [];
            for (const m of matches) {
              try {
                const inner = Buffer.from(m, 'base64').toString('utf8');
                const ya29 = inner.match(/ya29\.[a-zA-Z0-9_-]+/);
                if (ya29 && !foundAccess) foundAccess = ya29[0];
                const ref = inner.match(/1\/\/[a-zA-Z0-9_-]+/);
                if (ref && !foundRefresh) foundRefresh = ref[0];
              } catch {}
            }
          } catch {}
        }

        if (foundAccess || foundRefresh) {
          db.close();
          return { access_token: foundAccess || undefined, refresh_token: foundRefresh || undefined };
        }
      }

      // 2. Check antigravityAuthStatus fallback
      const rowStatus = db.prepare("SELECT value FROM ItemTable WHERE key = 'antigravityAuthStatus'").get() as any;
      db.close();
      if (rowStatus && rowStatus.value) {
        const authData = JSON.parse(rowStatus.value.toString('utf-8'));
        if (authData.apiKey && typeof authData.apiKey === 'string' && authData.apiKey.trim().length > 10) {
          return { access_token: authData.apiKey.trim() };
        }
      }
    } catch {
      // Try next database location
    }
  }
  return null;
};

const readLocalCreds = (): LocalGeminiCreds | null => {
  const home = os.homedir();

  // 1. Check primary ~/.gemini/oauth_creds.json FIRST (authoritative active sign-in)
  try {
    const credsPath = path.join(home, '.gemini', 'oauth_creds.json');
    if (fs.existsSync(credsPath)) {
      const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        const rawRefresh = parsed.refresh_token || parsed.refreshToken;
        const cleanRefresh = typeof rawRefresh === 'string' ? rawRefresh.split('|')[0] : undefined;
        const access = parsed.access_token || parsed.accessToken;
        const expiry = parsed.expiry_date ? Number(parsed.expiry_date) : (parsed.expires_in ? Date.now() + (Number(parsed.expires_in) || 3600) * 1000 : undefined);
        if (access || cleanRefresh) {
          return {
            access_token: access,
            refresh_token: cleanRefresh,
            expiry_date: expiry,
          };
        }
      }
    }
  } catch {}

  // 2. Discover active account email if configured in ~/.gemini/google_accounts.json
  let activeEmail: string | null = null;
  try {
    const acctListPath = path.join(home, '.gemini', 'google_accounts.json');
    if (fs.existsSync(acctListPath)) {
      const parsed = JSON.parse(fs.readFileSync(acctListPath, 'utf-8'));
      if (parsed && typeof parsed.active === 'string') {
        activeEmail = parsed.active.trim().toLowerCase();
      }
    }
  } catch {}

  // 3. Check multi-account configuration files from proxy ecosystem (filtering by active account if specified)
  for (const acctPath of getAccountConfigPaths()) {
    try {
      if (fs.existsSync(acctPath)) {
        const content = fs.readFileSync(acctPath, 'utf-8');
        const parsed = JSON.parse(content);
        const accounts: any[] = Array.isArray(parsed) ? parsed : (parsed.accounts || [parsed]);
        const matched = activeEmail
          ? accounts.find((a) => a && (a.email?.toLowerCase() === activeEmail || a.id?.toLowerCase() === activeEmail) && (a.accessToken || a.access_token || a.refreshToken || a.refresh_token))
          : null;
        const active = matched || accounts.find((a: any) => a && (a.accessToken || a.access_token || a.refreshToken || a.refresh_token));
        if (active) {
          const rawRefresh = active.refreshToken || active.refresh_token;
          const cleanRefresh = typeof rawRefresh === 'string' ? rawRefresh.split('|')[0] : undefined;
          const discoveredProjectId = active.subscription?.projectId || active.projectId || (typeof rawRefresh === 'string' && rawRefresh.includes('|') ? rawRefresh.split('|')[1] || rawRefresh.split('|')[2] : undefined);
          if (discoveredProjectId && typeof discoveredProjectId === 'string') {
            state.projectId = discoveredProjectId;
          }
          return {
            access_token: active.accessToken || active.access_token,
            refresh_token: cleanRefresh,
            expiry_date: active.expiresAt ? Number(active.expiresAt) : (active.accessToken ? Date.now() + 60 * 60 * 1000 : undefined),
          };
        }
      }
    } catch {}
  }

  // 4. Check SQLite VSCDB
  const vscdbCreds = readAntigravityVscdb();
  if (vscdbCreds && (vscdbCreds.access_token || vscdbCreds.refresh_token)) {
    return {
      access_token: vscdbCreds.access_token,
      refresh_token: vscdbCreds.refresh_token ? vscdbCreds.refresh_token.split('|')[0] : undefined,
      expiry_date: vscdbCreds.access_token ? Date.now() + 60 * 60 * 1000 : undefined,
    };
  }

  return null;
};

/** True when this machine has an unexpired local Google sign-in or configured proxy. */
export const hasLocalAntigravitySignIn = (): boolean => {
  if (process.env.ANTIGRAVITY_PROXY_PORT && process.env.ANTIGRAVITY_CSRF_TOKEN) return true;
  if (state.accessToken && Date.now() < state.accessTokenExpiresAt - 60 * 1000) return true;
  const creds = readLocalCreds();
  if (creds?.access_token && Number(creds.expiry_date || 0) > Date.now() + 60 * 1000) return true;
  if (creds?.refresh_token) return true;
  return false;
};

/** Human-readable status for the Settings surface — never includes secrets. */
export const describeLocalAntigravitySignIn = (): { available: boolean; detail: string } => {
  if (process.env.ANTIGRAVITY_PROXY_PORT) {
    return {
      available: true,
      detail: `Antigravity custom proxy configured (port ${process.env.ANTIGRAVITY_PROXY_PORT}).`,
    };
  }

  const creds = readLocalCreds();
  if (creds?.access_token && Number(creds.expiry_date || 0) > Date.now() + 60 * 1000) {
    const expires = new Date(creds.expiry_date!).toLocaleString();
    return {
      available: true,
      detail: `Antigravity local sign-in active (Session valid until ${expires}).`,
    };
  }

  if (creds?.refresh_token) {
    return {
      available: true,
      detail: `Antigravity local sign-in stored.`,
    };
  }

  return {
    available: false,
    detail: 'No active local Google sign-in found. Please configure an API key (Groq, Google Gemini, OpenAI, Anthropic, DeepSeek, OpenRouter) or ChatGPT Web cookie in Settings.',
  };
};

/** Exchange the refresh token for a fresh access token. */
const refreshAccessToken = async (refreshToken: string): Promise<string | null> => {
  for (const client of CLIENT_CONFIGS) {
    try {
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.id,
          client_secret: client.secret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data: any = await res.json();
        if (data?.access_token) {
          try {
            const credsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
            const current = readLocalCreds() || {};
            fs.writeFileSync(
              credsPath,
              JSON.stringify({ ...current, access_token: data.access_token, expiry_date: Date.now() + (Number(data.expires_in) || 3600) * 1000 }, null, 2)
            );
          } catch {}
          return String(data.access_token);
        }
      }
    } catch {
      // Try next client config
    }
  }
  state.lastError = 'Token refresh lapsed. Falling through to fast fallback engine.';
  return null;
};

/** Fresh access token, auto-refreshed when within 5 minutes of expiring. */
export const ensureFreshAccessToken = async (): Promise<string | null> => {
  const creds = readLocalCreds();
  if (creds?.access_token) {
    const expiresAt = Number(creds.expiry_date || 0);
    // If expiresAt is set and valid in the future (> 60s), reuse it
    if (expiresAt > Date.now() + 60 * 1000) {
      if (state.accessToken !== creds.access_token) {
        state.accessToken = creds.access_token;
        state.accessTokenExpiresAt = expiresAt;
        state.projectId = null; // Clear cached project ID so it re-evaluates for new account
        state.lastError = null;
      }
      return state.accessToken;
    }
  }

  if (state.accessToken && Date.now() < state.accessTokenExpiresAt - 5 * 60 * 1000) {
    return state.accessToken;
  }
  if (!creds) {
    state.lastError = 'No local Google sign-in found.';
    return null;
  }
  if (!creds.refresh_token) {
    // If no refresh token but we have an unattempted access token without expiry, try using it as fallback
    if (creds.access_token && !state.accessToken) {
      state.accessToken = creds.access_token;
      state.accessTokenExpiresAt = Date.now() + 30 * 60 * 1000;
      return state.accessToken;
    }
    state.lastError = 'Access token expired and no refresh token is stored. Sign in once with the Gemini CLI.';
    return null;
  }
  const fresh = await refreshAccessToken(creds.refresh_token);
  if (fresh) {
    state.accessToken = fresh;
    state.accessTokenExpiresAt = Date.now() + 55 * 60 * 1000;
    state.projectId = null;
    state.lastError = null;
    return fresh;
  }
  // If refresh failed but we have a cached access_token as last resort
  if (creds.access_token && !state.accessToken) {
    state.accessToken = creds.access_token;
    state.accessTokenExpiresAt = Date.now() + 15 * 60 * 1000;
    return state.accessToken;
  }
  return null;
};

/**
 * Resolve the Code Assist project id: loadCodeAssist tells us which project
 * the account is licensed through; onboardUser provisions one when the
 * account has none yet. Cached for the process lifetime.
 */
const ensureProjectId = async (accessToken: string): Promise<string | null> => {
  if (state.projectId) return state.projectId;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  try {
    const loadRes = await fetch(`${CODE_ASSIST_HOST}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!loadRes.ok) {
      state.lastError = `Code Assist handshake failed (${loadRes.status}).`;
      return null;
    }
    const load: any = await loadRes.json();
    const existingProject = load?.cloudaicompanionProject || load?.currentTier?.cloudaicompanionProject;
    if (existingProject) {
      state.projectId = String(existingProject);
      return state.projectId;
    }

    // No project yet — provision one (single attempt, then surface the error).
    const tierId = load?.allowedTiers?.[0]?.id || 'free-tier';
    const onboardRes = await fetch(`${CODE_ASSIST_HOST}/v1internal:onboardUser`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tierId, metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!onboardRes.ok) {
      state.lastError = `Code Assist onboarding failed (${onboardRes.status}).`;
      return null;
    }
    const onboard: any = await onboardRes.json();
    const project = onboard?.response?.cloudaicompanionProject || onboard?.cloudaicompanionProject;
    if (project) {
      state.projectId = String(project);
      return state.projectId;
    }
    state.lastError = 'Code Assist onboarding did not return a project id.';
    return null;
  } catch (err: any) {
    state.lastError = err?.message || 'Code Assist handshake failed.';
    return null;
  }
};

export interface BridgeTurnParams {
  modelId: string;
  systemPrompt?: string;
  messages: any[];
  signal?: AbortSignal;
}

export interface BridgeChunk {
  thinking?: string;
  delta?: string;
  toolCalls?: Array<{ id: string; tool: string; params: any }>;
}

const toCodeAssistContents = (messages: any[]) => {
  const rawTurns: Array<{ role: 'user' | 'model'; parts: any[] }> = [];
  const toolNameById = new Map<string, string>();

  // Pre-pass: record all tool call IDs -> tool names
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const name = tc.function?.name || tc.tool || tc.name;
        if (tc.id && name) {
          toolNameById.set(String(tc.id), String(name));
        }
      }
    }
  }

  for (const m of messages) {
    if (m.role === 'user') {
      const parts: any[] = [];
      let text = typeof m.content === 'string' ? m.content : '';

      // Handle multipart or image data URLs
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part?.type === 'text' && typeof part.text === 'string') {
            text += (text ? '\n' : '') + part.text;
          } else if (part?.type === 'image_url') {
            const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
            if (typeof url === 'string') {
              const dataMatch = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
              if (dataMatch) {
                parts.push({ inlineData: { mimeType: dataMatch[1], data: dataMatch[2] } });
              }
            }
          }
        }
      }

      if (Array.isArray(m._imageDataUrls)) {
        for (const url of m._imageDataUrls) {
          const dataMatch = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (dataMatch) {
            parts.push({ inlineData: { mimeType: dataMatch[1], data: dataMatch[2] } });
          }
        }
      }

      if (text.trim() || parts.length === 0) {
        parts.unshift({ text: text || 'Continue' });
      }

      rawTurns.push({ role: 'user', parts });
    } else if (m.role === 'assistant') {
      const parts: any[] = [];
      if (typeof m.content === 'string' && m.content.trim()) {
        parts.push({ text: m.content });
      }
      for (const tc of m.tool_calls || []) {
        try {
          const toolName = tc.function?.name || tc.tool || tc.name || 'tool';
          const args = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments || '{}')
            : (tc.params || {});
          parts.push({ functionCall: { name: toolName, args } });
        } catch {
          // Skip malformed tool call
        }
      }
      if (parts.length > 0) {
        rawTurns.push({ role: 'model', parts });
      }
    } else if (m.role === 'tool') {
      let response: any = m.content;
      try {
        response = JSON.parse(m.content);
      } catch {
        // Keep raw string
      }
      let toolName = (m.tool_call_id && toolNameById.get(String(m.tool_call_id))) || m.name || 'tool';

      // Check if preceding turn was model and had a matching functionCall
      const lastTurn = rawTurns[rawTurns.length - 1];
      const hasMatchingCall = lastTurn && lastTurn.role === 'model' && lastTurn.parts.some((p: any) => p.functionCall?.name === toolName);

      if (hasMatchingCall) {
        rawTurns.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: toolName,
                response: typeof response === 'object' && response !== null ? response : { result: response },
              },
            },
          ],
        });
      } else {
        const repr = typeof response === 'object' && response !== null ? JSON.stringify(response, null, 2) : String(response);
        rawTurns.push({
          role: 'user',
          parts: [{ text: `[Tool result for ${toolName}]:\n${repr}` }],
        });
      }
    }
  }

  // Merge consecutive same-role turns into unified turns
  const merged: Array<{ role: 'user' | 'model'; parts: any[] }> = [];
  for (const turn of rawTurns) {
    if (merged.length === 0) {
      if (turn.role === 'model') {
        merged.push({ role: 'user', parts: [{ text: 'Hello' }] });
      }
      merged.push(turn);
    } else {
      const last = merged[merged.length - 1];
      if (last.role === turn.role) {
        last.parts.push(...turn.parts);
      } else {
        merged.push(turn);
      }
    }
  }

  return merged.filter((c) => Array.isArray(c.parts) && c.parts.length > 0);
};

const toCodeAssistTools = (sutraTools: readonly any[]) => [
  {
    functionDeclarations: sutraTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })),
  },
];

function parseValueLiteral(valStr: string): any {
  if (valStr === 'True') return true;
  if (valStr === 'False') return false;
  if (valStr === 'None') return null;
  if (/^-?\d+(\.\d+)?$/.test(valStr)) return Number(valStr);

  // Triple-quoted multi-line strings
  if ((valStr.startsWith('"""') && valStr.endsWith('"""') && valStr.length >= 6) ||
      (valStr.startsWith("'''") && valStr.endsWith("'''") && valStr.length >= 6)) {
    return valStr.slice(3, -3);
  }

  // Raw strings r"""...""" or r"..."
  if (/^r"""[\s\S]*"""$/i.test(valStr)) return valStr.slice(4, -3);
  if (/^r'''[\s\S]*'''$/i.test(valStr)) return valStr.slice(4, -3);
  if (/^r"[\s\S]*"$/i.test(valStr)) return valStr.slice(2, -1);
  if (/^r'[\s\S]*'$/i.test(valStr)) return valStr.slice(2, -1);

  const strMatch = valStr.match(/^["']([\s\S]*)["']$/);
  if (strMatch && ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'")))) {
    try {
      return JSON.parse('"' + strMatch[1].replace(/"/g, '\\"') + '"');
    } catch {
      return strMatch[1];
    }
  }

  if ((valStr.startsWith('[') && valStr.endsWith(']')) || (valStr.startsWith('{') && valStr.endsWith('}'))) {
    try {
      const jsonNormalized = valStr
        .replace(/'/g, '"')
        .replace(/:\s*True\b/g, ': true')
        .replace(/:\s*False\b/g, ': false')
        .replace(/:\s*None\b/g, ': null');
      return JSON.parse(jsonNormalized);
    } catch {
      try {
        return JSON.parse(valStr);
      } catch {
        return valStr;
      }
    }
  }

  return valStr;
}

function parsePythonArgs(rawArgs: string): Record<string, any> {
  if (!rawArgs) return {};
  try {
    const p = JSON.parse(rawArgs);
    if (typeof p === 'object' && p !== null && !Array.isArray(p)) return p;
  } catch {}

  const params: Record<string, any> = {};
  let i = 0;
  while (i < rawArgs.length) {
    while (i < rawArgs.length && (/\s/.test(rawArgs[i]) || rawArgs[i] === ',')) i++;
    if (i >= rawArgs.length) break;

    const keyMatch = rawArgs.slice(i).match(/^([a-zA-Z0-9_]+)\s*=\s*/);
    if (!keyMatch) {
      const strMatch = rawArgs.slice(i).match(/^["']([^"']*)["']/);
      if (strMatch) {
        return { path: strMatch[1] };
      }
      break;
    }

    const key = keyMatch[1];
    i += keyMatch[0].length;

    const valStart = i;
    let bracketDepth = 0;
    let braceDepth = 0;
    let parenDepth = 0;
    let inQuote: string | null = null;

    while (i < rawArgs.length) {
      if (inQuote) {
        if (inQuote.length === 3) {
          if (rawArgs.slice(i, i + 3) === inQuote) {
            inQuote = null;
            i += 2; // Advance past 3 chars (i++ will do the 3rd)
          }
        } else {
          const char = rawArgs[i];
          if (char === '\\') {
            i += 2;
            continue;
          } else if (char === inQuote) {
            inQuote = null;
          }
        }
      } else {
        if (rawArgs.slice(i, i + 3) === '"""' || rawArgs.slice(i, i + 3) === "'''") {
          inQuote = rawArgs.slice(i, i + 3);
          i += 2;
        } else {
          const char = rawArgs[i];
          if (char === '"' || char === "'") {
            inQuote = char;
          } else if (char === '[') {
            bracketDepth++;
          } else if (char === ']') {
            bracketDepth--;
          } else if (char === '{') {
            braceDepth++;
          } else if (char === '}') {
            braceDepth--;
          } else if (char === '(') {
            parenDepth++;
          } else if (char === ')') {
            if (parenDepth === 0) break;
            parenDepth--;
          } else if (char === ',' && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
            break;
          }
        }
      }
      i++;
    }

    const rawVal = rawArgs.slice(valStart, i).trim();
    params[key] = parseValueLiteral(rawVal);
  }

  return params;
}

/** Extract tool calls with full multi-line bracket and quote awareness, stripping all raw syntax cleanly. */
function extractAndStripToolCalls(rawText: string): { thinking: string; proseText: string; toolCalls: Array<{ tool: string; params: Record<string, any> }> } {
  let text = rawText;
  const toolCalls: Array<{ tool: string; params: Record<string, any> }> = [];

  // Extract thoughts
  let thinking = '';
  const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (thoughtMatch) {
    thinking = thoughtMatch[1].trim();
    text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
  }

  let lastSearchPos = 0;
  while (lastSearchPos < text.length) {
    const fnStartMatch = text.slice(lastSearchPos).match(/(?:```(?:python|tool_code|tools)?\s*|<!--\s*TOOL_CODE_START\s*-->\s*)?([a-zA-Z0-9_]+)\s*\(/);
    if (!fnStartMatch || fnStartMatch.index === undefined) break;

    const fnName = fnStartMatch[1];
    if (['if', 'for', 'while', 'print', 'await', 'function', 'class', 'const', 'let', 'var'].includes(fnName)) {
      lastSearchPos += fnStartMatch.index + fnStartMatch[0].length;
      continue;
    }

    const matchStartIndex = lastSearchPos + fnStartMatch.index;
    const parenStartIndex = matchStartIndex + fnStartMatch[0].length - 1;

    let i = parenStartIndex + 1;
    let parenDepth = 1;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inQuote: string | null = null;

    while (i < text.length && parenDepth > 0) {
      if (inQuote) {
        if (inQuote.length === 3) {
          if (text.slice(i, i + 3) === inQuote) {
            inQuote = null;
            i += 2;
          }
        } else {
          const c = text[i];
          if (c === '\\') {
            i += 2;
            continue;
          } else if (c === inQuote) {
            inQuote = null;
          }
        }
      } else {
        if (text.slice(i, i + 3) === '"""' || text.slice(i, i + 3) === "'''") {
          inQuote = text.slice(i, i + 3);
          i += 2;
        } else {
          const c = text[i];
          if (c === '"' || c === "'") {
            inQuote = c;
          } else if (c === '(') {
            parenDepth++;
          } else if (c === ')') {
            parenDepth--;
          } else if (c === '[') {
            bracketDepth++;
          } else if (c === ']') {
            bracketDepth--;
          } else if (c === '{') {
            braceDepth++;
          } else if (c === '}') {
            braceDepth--;
          }
        }
      }
      i++;
    }

    if (parenDepth === 0) {
      let matchEndIndex = i;
      const afterSlice = text.slice(matchEndIndex);
      const closeMatch = afterSlice.match(/^\s*(?:```|<!--\s*TOOL_CODE_END\s*-->)/);
      if (closeMatch) {
        matchEndIndex += closeMatch[0].length;
      }

      const rawArgs = text.slice(parenStartIndex + 1, i - 1).trim();
      const params = parsePythonArgs(rawArgs);

      toolCalls.push({
        tool: fnName,
        params,
      });

      text = text.slice(0, matchStartIndex) + text.slice(matchEndIndex);
      lastSearchPos = matchStartIndex;
    } else {
      lastSearchPos = matchStartIndex + fnStartMatch[0].length;
    }
  }

  // Fallback: extract JSON style tool blocks if model hallucinates JSON instead of Python
  let jsonMatch;
  while ((jsonMatch = text.match(/```(?:json|tool_call|tool)?\s*(\{[\s\S]*?\})\s*```/))) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const toolName = parsed.name || parsed.tool || (parsed.function && parsed.function.name);
      if (toolName) {
        const params = parsed.arguments || parsed.params || (parsed.function && parsed.function.arguments) || parsed;
        toolCalls.push({
          tool: toolName,
          params: typeof params === 'string' ? JSON.parse(params) : params,
        });
      }
    } catch {}
    text = text.replace(jsonMatch[0], '');
  }

  // Universal dialect rescue fallback (XML <invoke>, <tool_call>, Hermes, DeepSeek, etc.)
  if (toolCalls.length === 0) {
    const rescued = rescueToolDialects(text);
    if (rescued.hasRescuedTools) {
      for (const rt of rescued.rescuedTools) {
        toolCalls.push({
          tool: rt.tool,
          params: rt.params,
        });
      }
      text = rescued.cleanText;
      if (rescued.reasoningText && !thinking) {
        thinking = rescued.reasoningText;
      }
    }
  }

  const proseText = text
    .replace(/<!--\s*TOOL_CODE_START\s*-->|<!--\s*TOOL_CODE_END\s*-->/g, '')
    .replace(/```(?:python|tool_code|tools)?/g, '')
    .replace(/```/g, '')
    .trim();

  return { thinking, proseText, toolCalls };
}

/** Parse a single Pythonic tool call invocation string, e.g. write_file(path="foo", content="bar") */
export function parsePythonicToolCall(rawStr: string): { tool: string; params: Record<string, any> } | null {
  if (!rawStr || typeof rawStr !== 'string') return null;
  const match = rawStr.match(/(?:<!--\s*TOOL_CODE_START\s*-->|```(?:python|tool_code|tools)?\s*)?([a-zA-Z0-9_]+)\s*\(([\s\S]*)\)(?:\s*<!--\s*TOOL_CODE_END\s*-->|\s*```)?/);
  if (!match) return null;
  const tool = match[1];
  if (['if', 'for', 'while', 'print', 'await', 'function', 'class', 'const', 'let', 'var'].includes(tool)) {
    return null;
  }
  const rawArgs = match[2].trim();
  const params = parsePythonArgs(rawArgs);
  return { tool, params };
}

export interface AntigravityModelEntry {
  canonicalId: string;
  provider: 'antigravity';
  providerModelId: string;
  wireModelId: string;
  displayName: string;
  thinkingMode: boolean;
  thinkingLevels?: ('low' | 'medium' | 'high')[];
  defaultThinkingLevel?: 'low' | 'medium' | 'high';
  contextWindow: number;
  supportsVision: boolean;
  supportsTools: boolean;
  description: string;
}

export const ANTIGRAVITY_CANONICAL_MODELS_LIST: AntigravityModelEntry[] = [
  {
    canonicalId: 'gemini-3.7-flash',
    provider: 'antigravity',
    providerModelId: 'gemini-3.7-flash',
    wireModelId: 'gemini-2.5-flash',
    displayName: 'Gemini 3.7 Flash',
    thinkingMode: true,
    thinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'medium',
    contextWindow: 1048576,
    supportsVision: true,
    supportsTools: true,
    description: 'Antigravity flagship with tunable thinking effort (low, medium, high), 1M context, vision and tools.',
  },
  {
    canonicalId: 'gemini-3.6-flash',
    provider: 'antigravity',
    providerModelId: 'gemini-3.6-flash',
    wireModelId: 'gemini-2.5-flash',
    displayName: 'Gemini 3.6 Flash',
    thinkingMode: true,
    thinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'medium',
    contextWindow: 1048576,
    supportsVision: true,
    supportsTools: true,
    description: 'Fast multimodal adaptive reasoning with medium thinking level through Antigravity.',
  },
  {
    canonicalId: 'gemini-3.5-flash',
    provider: 'antigravity',
    providerModelId: 'gemini-3.5-flash',
    wireModelId: 'gemini-2.5-flash',
    displayName: 'Gemini 3.5 Flash',
    thinkingMode: true,
    thinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'medium',
    contextWindow: 1048576,
    supportsVision: true,
    supportsTools: true,
    description: 'High-efficiency Antigravity reasoning with low/medium/high thinking levels.',
  },
  {
    canonicalId: 'gemini-3.1-pro',
    provider: 'antigravity',
    providerModelId: 'gemini-3.1-pro',
    wireModelId: 'gemini-2.5-pro',
    displayName: 'Gemini 3.1 Pro',
    thinkingMode: true,
    thinkingLevels: ['low', 'high'],
    defaultThinkingLevel: 'high',
    contextWindow: 1048576,
    supportsVision: true,
    supportsTools: true,
    description: 'Deepest Gemini Pro reasoning through Antigravity sign-in with 1M context.',
  },
  {
    canonicalId: 'claude-sonnet-4-6',
    provider: 'antigravity',
    providerModelId: 'claude-sonnet-4-6',
    wireModelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6 (Thinking)',
    thinkingMode: true,
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    description: 'Anthropic Claude Sonnet 4.6 with native hybrid thinking through Antigravity sign-in.',
  },
  {
    canonicalId: 'claude-opus-4-6',
    provider: 'antigravity',
    providerModelId: 'claude-opus-4-6',
    wireModelId: 'claude-opus-4-6-thinking',
    displayName: 'Claude Opus 4.6 (Thinking)',
    thinkingMode: true,
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    description: 'Anthropic Claude Opus 4.6 with deep thinking mode via Antigravity sign-in.',
  },
  {
    canonicalId: 'gpt-oss-120b',
    provider: 'antigravity',
    providerModelId: 'gpt-oss-120b',
    wireModelId: 'gemini-2.5-flash',
    displayName: 'GPT-OSS 120B (Medium)',
    thinkingMode: true,
    thinkingLevels: ['medium'],
    defaultThinkingLevel: 'medium',
    contextWindow: 131072,
    supportsVision: false,
    supportsTools: true,
    description: 'Open reasoning & coding model running with medium thinking level in Antigravity.',
  },
];

export const ANTIGRAVITY_CANONICAL_MODELS: Record<string, AntigravityModelEntry> = Object.fromEntries(
  ANTIGRAVITY_CANONICAL_MODELS_LIST.map((m) => [m.canonicalId, m])
);

const ANTIGRAVITY_MODEL_MAP: Record<string, string> = {
  'gemini-3.7-flash': 'gemini-3.7-flash',
  'gemini-3.7': 'gemini-3.7-flash',
  'gemini-3.6-flash': 'gemini-3.6-flash',
  'gemini-3.6': 'gemini-3.6-flash',
  'gemini-3.5-flash': 'gemini-3.5-flash',
  'gemini-3.5': 'gemini-3.5-flash',
  'gemini-2.5-flash': 'gemini-3.7-flash',
  'flash': 'gemini-3.7-flash',
  'auto': 'gemini-3.7-flash',

  'gemini-3.1-pro': 'gemini-3.1-pro',
  'gemini-3-pro': 'gemini-3.1-pro',
  'gemini-2.5-pro': 'gemini-3.1-pro',
  'pro': 'gemini-3.1-pro',

  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-5': 'claude-sonnet-4-6',
  'claude-3-7-sonnet': 'claude-sonnet-4-6',
  'claude-sonnet': 'claude-sonnet-4-6',
  'sonnet': 'claude-sonnet-4-6',

  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-opus-5': 'claude-opus-4-6',
  'claude-opus': 'claude-opus-4-6',
  'opus': 'claude-opus-4-6',

  'gpt-oss-120b': 'gpt-oss-120b',
  'gpt-5': 'gemini-3.7-flash',
  'gpt-4o': 'gemini-3.7-flash',
};

/** Resolves any alias to its canonical Antigravity model ID */
export function resolveAntigravityCanonicalModel(modelId: string): string {
  if (!modelId) return 'gemini-3.7-flash';
  const cleanId = String(modelId).replace(/^models\//, '').replace(/^antigravity\//, '').replace(/^antigravity:/, '').toLowerCase().trim();
  if (ANTIGRAVITY_MODEL_MAP[cleanId]) return ANTIGRAVITY_MODEL_MAP[cleanId];
  if (cleanId.includes('opus')) return 'claude-opus-4-6';
  if (cleanId.includes('sonnet') || cleanId.includes('claude')) return 'claude-sonnet-4-6';
  if (cleanId.includes('pro')) return 'gemini-3.1-pro';
  if (cleanId.includes('oss') || cleanId.includes('120b')) return 'gpt-oss-120b';
  return 'gemini-3.7-flash';
}

/** Resolves a canonical or alias model ID to its wire model ID for the Code Assist API endpoint */
export function resolveAntigravityModel(modelId: string): string {
  const canonical = resolveAntigravityCanonicalModel(modelId);
  const entry = ANTIGRAVITY_CANONICAL_MODELS[canonical];
  return entry ? entry.wireModelId : 'gemini-2.5-flash';
}

export const resolveAntigravityWireModel = resolveAntigravityModel;

/** Make an optimized RPC call to the Antigravity Language Server daemon (with HTTP/HTTPS dual-port resilience) */
async function callAntigravityLanguageServerRpc(
  proxy: DiscoveredProxy,
  prompt: string,
  model: string,
  signal?: AbortSignal
): Promise<string> {
  const resolvedModel = resolveAntigravityModel(model);
  const payload = JSON.stringify({
    metadata: {
      ide_name: 'antigravity',
      ide_version: '2.11.0',
      extension_name: 'antigravity',
      extension_version: '2.11.0',
      locale: 'en',
    },
    prompt,
    model: resolvedModel,
  });

  const sendReq = (port: number, useHttps: boolean): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error('This operation was aborted');
        err.name = 'AbortError';
        return reject(err);
      }

      const mod = useHttps ? https : http;
      const agent = useHttps ? loopbackKeepAliveAgent : loopbackHttpAgent;

      const req = mod.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/exa.language_server_pb.LanguageServerService/GetModelResponse',
          method: 'POST',
          agent,
          rejectUnauthorized: false,
          timeout: 1500,
          headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            'x-codeium-csrf-token': proxy.csrfToken,
            'Content-Length': Buffer.byteLength(payload),
          },
          signal,
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              if (res.statusCode === 401 || res.statusCode === 403) {
                resetAntigravityProxyCache();
              }
              return reject(new Error(`Antigravity proxy status (${res.statusCode}): ${raw}`));
            }
            try {
              const parsed = JSON.parse(raw);
              resolve(String(parsed.response || ''));
            } catch {
              reject(new Error(`Invalid JSON response from Antigravity proxy: ${raw}`));
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Antigravity RPC request timeout (1.5s)'));
      });

      req.on('error', (err: any) => {
        reject(err);
      });

      req.write(payload);
      req.end();
    });
  };

  // Try HTTP port first (direct localhost, lowest overhead)
  const httpPort = proxy.httpPort || (proxy.port % 2 === 0 ? proxy.port : proxy.port + 1);
  const httpsPort = proxy.httpsPort || (proxy.port % 2 !== 0 ? proxy.port : proxy.port - 1);

  try {
    return await sendReq(httpPort, false);
  } catch (httpErr: any) {
    if (signal?.aborted) throw httpErr;
    // Fall back to HTTPS port
    try {
      return await sendReq(httpsPort, true);
    } catch (httpsErr: any) {
      if (signal?.aborted) throw httpsErr;
      resetAntigravityProxyCache();
      throw new Error(`Antigravity Language Server RPC failed on ports ${httpPort}/${httpsPort}: ${httpsErr.message || httpErr.message}`);
    }
  }
}

/** Execute multiple prompts in parallel with Antigravity, falling back to adaptive sequential execution if needed. */
export async function executeParallelAntigravity(
  prompts: string[],
  modelId: string = 'gemini-3.7-flash',
  signal?: AbortSignal
): Promise<string[]> {
  const proxy = discoverAntigravityProxy();
  if (!proxy) {
    throw new Error('Antigravity Language Server proxy is offline.');
  }

  const internalModel = resolveAntigravityModel(modelId);

  // Strategy 1: Parallel Dispatch
  try {
    const results = await Promise.all(
      prompts.map((p) => callAntigravityLanguageServerRpc(proxy, p, internalModel, signal))
    );
    return results;
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.warn('[Antigravity] Parallel dispatch encountered error, falling back to sequential retry:', err.message);

    // Strategy 2: Adaptive Sequential Fallback
    const results: string[] = [];
    for (const p of prompts) {
      if (signal?.aborted) break;
      const res = await callAntigravityLanguageServerRpc(proxy, p, internalModel, signal);
      results.push(res);
    }
    return results;
  }
}

/** Build unified prompt combining system instructions, tool signatures, and conversation history. */
function buildAntigravityPrompt(params: BridgeTurnParams, sutraTools: readonly any[]): string {
  let prompt = '';
  if (params.systemPrompt) {
    prompt += `[SYSTEM INSTRUCTIONS]\n${params.systemPrompt}\n\n`;
  }

  if (sutraTools.length > 0) {
    prompt += `[AVAILABLE TOOLS]\nYou have access to the following workspace tools. To execute a tool call, output ONLY a Python-style function invocation inside a code block, for example:\n\`\`\`python\nwrite_file(path="src/index.ts", content="...")\n\`\`\`\n\nTool signatures:\n`;
    for (const t of sutraTools) {
      const propKeys = Object.keys(t.input_schema?.properties || {}).join(', ');
      prompt += `- ${t.name}(${propKeys}): ${t.description}\n`;
    }
    prompt += `\nAUTONOMOUS CONTINUATION: After planning or receiving tool output, immediately proceed to execute the next pending action tool call (e.g. write_file, edit_file, run_command). Do not stop after creating the task plan — work continuously until all tasks are complete!\n\n`;
  }

  prompt += `[CONVERSATION HISTORY]\n`;
  for (const m of params.messages) {
    const roleName = m.role === 'assistant' ? 'ASSISTANT' : m.role === 'user' ? 'USER' : 'TOOL_OUTPUT';
    const textContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    prompt += `${roleName}: ${textContent}\n`;
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        prompt += `TOOL_CALL: ${tc.function?.name || tc.tool}(${typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.params || {})})\n`;
      }
    }
  }
  prompt += `ASSISTANT:`;
  return prompt;
}

export function resolveCodeAssistModel(modelId: string): string {
  const clean = String(modelId || '').replace(/^models\//, '').replace(/^antigravity\//, '').replace(/^antigravity:/, '').toLowerCase().trim();
  if (clean.includes('opus')) {
    return 'claude-opus-4-6-thinking';
  }
  if (clean.includes('sonnet') || clean.includes('claude')) {
    return 'claude-sonnet-4-6';
  }
  if (clean.includes('pro') || clean.includes('gemini-pro')) {
    return 'gemini-2.5-pro';
  }
  return 'gemini-2.5-flash';
}

/**
 * Stream one turn through the Antigravity Code Assist Stream Engine.
 */
export async function* streamAntigravityTurn(params: BridgeTurnParams, sutraTools: readonly any[]): AsyncGenerator<BridgeChunk> {
  if (params.signal?.aborted) {
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';
    throw err;
  }

  // Cloud Code Assist Endpoint (Fast & Authenticated Streaming)
  const accessToken = await ensureFreshAccessToken();
  if (!accessToken) throw new Error(state.lastError || 'Antigravity bridge: no usable local Google sign-in found.');
  const projectId = await ensureProjectId(accessToken);
  if (!projectId) throw new Error(state.lastError || 'Antigravity bridge: could not resolve Code Assist project.');

  const scrubbedSystemPrompt = params.systemPrompt
    ? params.systemPrompt
        .replace(/Nous Research/gi, 'the assistant team')
        .replace(/Hermes Agent/gi, 'the assistant')
        .replace(/Hermes/gi, 'the assistant')
    : undefined;

  const assistModel = resolveCodeAssistModel(params.modelId);
  const body = {
    model: assistModel,
    project: projectId,
    request: {
      contents: toCodeAssistContents(params.messages),
      ...(scrubbedSystemPrompt ? { systemInstruction: { parts: [{ text: scrubbedSystemPrompt }] } } : {}),
      ...(sutraTools.length ? { tools: toCodeAssistTools(sutraTools) } : {}),
      generationConfig: {
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 4096 },
      },
    },
  };

  const internalController = new AbortController();
  const onParentAbort = () => internalController.abort();
  params.signal?.addEventListener('abort', onParentAbort);

  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const resetInactivityTimer = (timeoutMs = 30000) => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      console.warn(`[Antigravity Bridge] Upstream stream connection timeout (${timeoutMs / 1000}s)`);
      internalController.abort();
    }, timeoutMs);
  };

  try {
    // 90s initial grace period for deep thinking models (Gemini 2.5/3.0 Thinking, Claude 3.7 Thinking)
    resetInactivityTimer(90000);
    const candidateHosts = ['https://cloudcode-pa.googleapis.com'];
    let res: Response | null = null;
    let lastErr = '';

    const MAX_RETRIES = 3;
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      if (retry > 0) {
        const delay = 1500 * Math.pow(2, retry - 1);
        if (internalController.signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      for (const host of candidateHosts) {
        try {
          const attempt = await fetch(`${host}/v1internal:streamGenerateContent?alt=sse`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
              'User-Agent': 'antigravity/2.11.0 windows/x64',
              'X-Client-Name': 'antigravity',
              'X-Client-Version': '2.11.0',
              'x-goog-api-client': 'gl-node/18.18.2 fire/0.8.6 grpc/1.10.x',
            },
            body: JSON.stringify(body),
            signal: internalController.signal,
          });
          if (attempt.ok && attempt.body) {
            res = attempt;
            break;
          }
          if (attempt.status === 401 || attempt.status === 403) {
            state.accessToken = null;
            state.accessTokenExpiresAt = 0;
            state.lastError = `Antigravity OAuth token expired (${attempt.status}).`;
            break; // Don't retry expired token
          }
          lastErr = await attempt.text().catch(() => '');
          // If 429 or 5xx, try other host or retry with backoff
        } catch (err: any) {
          if (internalController.signal.aborted) throw err;
          lastErr = err.message;
        }
      }

      if (res && res.body) break;
    }

    if (!res || !res.body) {
      let cleanMsg = lastErr;
      try {
        const parsed = JSON.parse(lastErr);
        if (parsed?.error?.message) cleanMsg = parsed.error.message;
      } catch {}
      throw new Error(cleanMsg || 'No response from Google Code Assist service');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let toolCallIndex = 0;
    let accumulatedText = '';
    const reader = res.body.getReader();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        resetInactivityTimer();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload);
            const candidates = evt?.response?.candidates || evt?.candidates || [];
            for (const cand of candidates) {
              for (const part of cand?.content?.parts || []) {
                if (part.thought || part.thought === true) {
                  if (typeof part.text === 'string' && part.text) {
                    yield { thinking: part.text };
                  }
                  continue;
                }
                if (typeof part.text === 'string' && part.text) {
                  accumulatedText += part.text;
                  const toolCodeRegex = /(?:<!-- TOOL_CODE_START -->|```(?:python|tool_code|tools)?\s*)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)(?:\s*<!-- TOOL_CODE_END -->|\s*```)?/g;
                  let match;
                  let lastIndex = 0;
                  let hasToolBlock = false;

                  if (accumulatedText.includes('<!-- TOOL_CODE_END -->') || accumulatedText.includes('<!-- TOOL_CODE_START -->') || accumulatedText.includes('```')) {
                    while ((match = toolCodeRegex.exec(accumulatedText)) !== null) {
                      if (!match[1] || match[1] === 'print' || match[1] === 'await') continue;
                      const parsed = parsePythonicToolCall(match[0]);
                      if (parsed && parsed.tool) {
                        hasToolBlock = true;
                        const textBefore = accumulatedText.slice(lastIndex, match.index).replace(/<!-- TOOL_CODE_START -->|<!-- TOOL_CODE_END -->/g, '');
                        if (textBefore.trim()) {
                          yield { delta: textBefore };
                        }
                        toolCallIndex += 1;
                        yield {
                          toolCalls: [
                            {
                              id: `bridge-call-${toolCallIndex}-${parsed.tool}`,
                              tool: parsed.tool,
                              params: parsed.params,
                            },
                          ],
                        };
                        lastIndex = match.index + match[0].length;
                      }
                    }
                  }

                  if (hasToolBlock) {
                    accumulatedText = accumulatedText.slice(lastIndex).replace(/<!-- TOOL_CODE_START -->|<!-- TOOL_CODE_END -->/g, '');
                  } else if (!accumulatedText.includes('<!-- TOOL_CODE_START') && !accumulatedText.includes('print(await')) {
                    const cleaned = accumulatedText.replace(/<!-- TOOL_CODE_START -->|<!-- TOOL_CODE_END -->/g, '');
                    if (cleaned) {
                      yield { delta: cleaned };
                    }
                    accumulatedText = '';
                  }
                }
                if (part.functionCall) {
                  toolCallIndex += 1;
                  yield {
                    toolCalls: [
                      {
                        id: `bridge-call-${toolCallIndex}-${part.functionCall.name || 'tool'}`,
                        tool: String(part.functionCall.name || ''),
                        params: part.functionCall.args || {},
                      },
                    ],
                  };
                }
              }
            }
          } catch {}
        }
      }

      if (accumulatedText) {
        const finalCleaned = accumulatedText.replace(/<!-- TOOL_CODE_START -->|<!-- TOOL_CODE_END -->/g, '').trim();
        const trailingTool = parsePythonicToolCall(finalCleaned);
        if (trailingTool && trailingTool.tool) {
          toolCallIndex += 1;
          yield {
            toolCalls: [
              {
                id: `bridge-call-${toolCallIndex}-${trailingTool.tool}`,
                tool: trailingTool.tool,
                params: trailingTool.params,
              },
            ],
          };
        } else if (finalCleaned) {
          yield { delta: finalCleaned };
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    params.signal?.removeEventListener('abort', onParentAbort);
  }
}
