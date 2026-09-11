const { app, BrowserWindow, shell, Menu } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Disable disk GPU shader cache locks on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Enforce single-instance application behavior on Windows
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Windows App User Model ID for proper taskbar grouping & icon
if (process.platform === 'win32') {
  app.setAppUserModelId('com.sutra.ide');
}

let serverProcess = null;
let mainWindow = null;
let serverLogTail = '';

const SERVER_PORT = 3001;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// app root: project root in dev, resources/app when installed (asar disabled)
const BASE_DIR = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');

function serverLogPath() {
  try {
    return path.join(app.getPath('userData'), 'server.log');
  } catch {
    return path.join(BASE_DIR, 'server.log');
  }
}

function appendServerLog(chunk) {
  const text = chunk.toString();
  serverLogTail = (serverLogTail + text).slice(-4000);
  try {
    fs.appendFileSync(serverLogPath(), text);
  } catch { /* logging is best-effort */ }
}

function findNodeBinary() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node.exe'),
      path.join(process.env.APPDATA || '', 'nvm', 'current', 'node.exe'),
    ].filter(p => p && fs.existsSync(p));
    if (candidates.length > 0) return candidates[0];
  }
  try {
    const whichCmd = process.platform === 'win32' ? 'where.exe node' : 'which node';
    const out = require('child_process').execSync(whichCmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const firstLine = out.trim().split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}
  return 'node';
}

function startServer(onExitCallback) {
  // Prefer the pre-bundled dist-server/index.js for near-instant (< 200ms) boot.
  // Falls back to tsx in development environments when dist-server is not built yet.
  const distServer = path.join(BASE_DIR, 'dist-server', 'index.js');
  const tsxCli = path.join(BASE_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntry = path.join(BASE_DIR, 'server', 'index.ts');

  let nodeArgs;
  if (fs.existsSync(distServer)) {
    nodeArgs = [distServer];
  } else if (fs.existsSync(tsxCli) && fs.existsSync(serverEntry)) {
    nodeArgs = [tsxCli, serverEntry];
  } else {
    appendServerLog(`[launcher] Missing server entry point. dist-server: ${distServer}, server: ${serverEntry}\n`);
    nodeArgs = [serverEntry];
  }

  const nodeBin = findNodeBinary();
  appendServerLog(`[launcher] Launching server via ${nodeBin} with args: ${nodeArgs.join(' ')}\n`);

  try {
    serverProcess = spawn(nodeBin, nodeArgs, {
      cwd: BASE_DIR,
      env: { ...process.env, NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false, // Critical: shell:false prevents cmd.exe from splitting on paths with spaces (e.g. C:\Users\Gaurav Batule)
      windowsHide: true,
    });
  } catch (err) {
    appendServerLog(`[launcher] Failed to spawn node: ${err.message}\n`);
    serverProcess = null;
    if (onExitCallback) onExitCallback(1, err.message);
    return;
  }

  serverProcess.stdout?.on('data', appendServerLog);
  serverProcess.stderr?.on('data', appendServerLog);
  serverProcess.on('error', (err) => {
    appendServerLog(`[launcher] node process error: ${err.message}\n`);
    serverProcess = null;
    if (onExitCallback) onExitCallback(1, err.message);
  });
  serverProcess.on('exit', (code) => {
    if (code) appendServerLog(`[launcher] server exited with code ${code}\n`);
    const exitedEarly = serverProcess !== null;
    serverProcess = null;
    if (exitedEarly && code && code !== 0 && onExitCallback) {
      onExitCallback(code);
    }
  });
}

let activeServerUrl = `http://localhost:${SERVER_PORT}`;

function probeServer(callback) {
  const ports = [3001, 3002, 3003, 3004, 3005];
  let found = false;
  let remaining = ports.length;

  ports.forEach((p) => {
    const req = http.get(`http://localhost:${p}/api/version`, (res) => {
      res.resume();
      if (!found && res.statusCode === 200) {
        found = true;
        activeServerUrl = `http://localhost:${p}`;
        callback(true, activeServerUrl);
      } else {
        remaining--;
        if (remaining === 0 && !found) callback(false);
      }
    });
    req.on('error', () => {
      remaining--;
      if (remaining === 0 && !found) callback(false);
    });
    req.setTimeout(800, () => {
      req.destroy();
      remaining--;
      if (remaining === 0 && !found) callback(false);
    });
  });
}

function waitForServer(onReady, onFail, attempts = 150) {
  let attempt = 0;
  let done = false;
  const tick = () => {
    if (done) return;
    attempt++;
    probeServer((ok) => {
      if (done) return;
      if (ok) {
        done = true;
        return onReady();
      }
      if (attempt >= attempts) {
        done = true;
        return onFail();
      }
      // Ultra-fast initial polling: 80ms for first 40 checks (3.2 seconds), then 200ms
      const delay = attempt < 40 ? 80 : 200;
      setTimeout(tick, delay);
    });
  };
  tick();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadingPageHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>SUTRA IDE</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    margin: 0;
    background: #090a0d;
    color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    overflow: hidden;
    user-select: none;
  }
  .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .logo-box {
    width: 88px;
    height: 88px;
    margin-bottom: 24px;
    animation: breatheGlow 2.8s ease-in-out infinite;
    filter: drop-shadow(0 0 24px rgba(255, 255, 255, 0.09));
  }
  .brand-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 20px;
  }
  .word {
    letter-spacing: 0.38em;
    font-size: 17px;
    font-weight: 700;
    color: #ffffff;
    text-transform: uppercase;
    padding-left: 0.38em;
  }
  .badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #a1a1aa;
  }
  .track-bar {
    width: 140px;
    height: 2px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    overflow: hidden;
    position: relative;
    margin-bottom: 14px;
  }
  .track-fill {
    width: 50%;
    height: 100%;
    background: linear-gradient(90deg, transparent, #ffffff, transparent);
    position: absolute;
    top: 0;
    left: 0;
    animation: trackScan 1.6s ease-in-out infinite;
  }
  .status {
    font-size: 11px;
    color: #71717a;
    font-family: 'Consolas', 'Cascadia Code', monospace;
    letter-spacing: 0.02em;
  }
  @keyframes breatheGlow {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
      filter: drop-shadow(0 0 16px rgba(255, 255, 255, 0.08));
    }
    50% {
      opacity: 0.85;
      transform: scale(0.97);
      filter: drop-shadow(0 0 32px rgba(255, 255, 255, 0.22));
    }
  }
  @keyframes trackScan {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo-box">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" style="width:100%;height:100%;">
        <defs>
          <linearGradient id="bwShine" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FFFFFF" />
            <stop offset="50%" stop-color="#E4E4E7" />
            <stop offset="100%" stop-color="#A1A1AA" />
          </linearGradient>
          <linearGradient id="bwDarkBase" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#16171B" />
            <stop offset="100%" stop-color="#0B0C0E" />
          </linearGradient>
        </defs>
        <rect x="20" y="20" width="472" height="472" rx="116" fill="url(#bwDarkBase)" stroke="#27272A" stroke-width="2.5" />
        <rect x="30" y="30" width="452" height="452" rx="106" fill="none" stroke="rgba(255, 255, 255, 0.1)" stroke-width="1" />
        <g>
          <path d="M256 80 L392 166 L392 346 L256 432 L120 346 L120 166 Z" stroke="#3F3F46" stroke-width="3" stroke-dasharray="6 6" fill="none" />
          <path d="M256 104 L372 178 L372 334 L256 408 L140 334 L140 178 Z" stroke="#52525B" stroke-width="6" stroke-linejoin="round" fill="none" />
          <path d="M184 196 C184 140 328 140 328 224 C328 308 184 288 184 352 C184 408 328 408 328 352" stroke="url(#bwShine)" stroke-width="20" stroke-linecap="round" fill="none" />
          <circle cx="256" cy="256" r="38" stroke="#FFFFFF" stroke-width="5" fill="#0B0C0E" />
          <circle cx="256" cy="256" r="16" fill="#FFFFFF" />
          <line x1="256" y1="52" x2="256" y2="76" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" />
          <line x1="256" y1="436" x2="256" y2="460" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" />
          <line x1="92" y1="256" x2="116" y2="256" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" />
          <line x1="396" y1="256" x2="420" y2="256" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" />
        </g>
      </svg>
    </div>
    <div class="brand-row">
      <span class="word">SUTRA</span>
      <span class="badge">Studio</span>
    </div>
    <div class="track-bar">
      <div class="track-fill"></div>
    </div>
    <div class="status" id="status">Starting local engine…</div>
  </div>
  <script>
    const stages = [
      { t: 0, text: "Starting local engine…" },
      { t: 1200, text: "Mounting SQLite database & cache…" },
      { t: 2500, text: "Starting HTTP & WebSocket bridges…" },
      { t: 4000, text: "Initializing Astra agent tools…" },
      { t: 6000, text: "Connecting to workspace port 3001…" },
      { t: 8000, text: "Almost ready, launching Studio UI…" }
    ];
    const el = document.getElementById('status');
    stages.forEach(function(s) {
      setTimeout(function() {
        if (el) el.textContent = s.text;
      }, s.t);
    });
  </script>
</body>
</html>`;
}

function failurePageHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #0b0c10; color: #e4e4e7; font-family: 'Segoe UI', sans-serif; padding: 48px; }
  h2 { font-weight: 600; margin: 0 0 8px; }
  p { color: #a1a1aa; font-size: 13px; line-height: 1.6; }
  pre { background: #131418; border: 1px solid #27272a; border-radius: 8px; padding: 16px;
        font-size: 11px; color: #d4d4d8; overflow: auto; max-height: 45vh; white-space: pre-wrap; }
  .hint { color: #71717a; }
  button { margin-top: 18px; background: #e4e4e7; color: #09090b; border: 0; border-radius: 6px;
           padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
  <h2>SUTRA IDE server did not start</h2>
  <p>Make sure Node.js 20+ is installed and no other app is using port 3001, then restart the app.</p>
  <p class="hint">Full log: ${escapeHtml(serverLogPath())}</p>
  <pre id="log">${escapeHtml(serverLogTail) || 'No output captured from the server process.'}</pre>
  <button onclick="location.reload()">Retry</button>
</body>
</html>`;
}

function createWindow() {
  const isWindows = process.platform === 'win32';

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#090a0d',
    icon: path.join(__dirname, 'sutra.ico'),
    autoHideMenuBar: true,
    title: 'SUTRA IDE',
    show: true,
    titleBarStyle: isWindows ? 'hidden' : 'default',
    titleBarOverlay: isWindows
      ? {
          color: '#090a0d',
          symbolColor: '#a1a1aa',
          height: 38,
        }
      : false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Desktop keyboard shortcuts (F11 fullscreen, Ctrl+Shift+I devtools, Ctrl+R reload)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
    if (input.control && input.shift && (input.key === 'I' || input.key === 'i') && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (((input.control && (input.key === 'r' || input.key === 'R')) || input.key === 'F5') && input.type === 'keyDown') {
      mainWindow.webContents.reload();
      event.preventDefault();
    }
  });

  // Show the branded loading screen instantly — never a black frame.
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPageHtml())}`);
  mainWindow.focus();

  // Capture renderer console and failure messages for server.log
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    appendServerLog(`[renderer] [lvl ${level}] ${message} (${sourceId}:${line})\n`);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    appendServerLog(`[renderer error] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})\n`);
  });

  // Open external links in the default browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(activeServerUrl) && !url.startsWith(SERVER_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function navigateToApp() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  appendServerLog(`[launcher] Navigating window to: ${activeServerUrl}\n`);
  mainWindow.loadURL(activeServerUrl).then(() => {
    appendServerLog(`[launcher] Window successfully loaded: ${activeServerUrl}\n`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }).catch((err) => {
    appendServerLog(`[launcher] Window loadURL failed: ${err.message} — scheduling retry in 1s\n`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(activeServerUrl).then(() => {
          appendServerLog(`[launcher] Window retry succeeded on: ${activeServerUrl}\n`);
          mainWindow.show();
          mainWindow.focus();
        }).catch((retryErr) => {
          appendServerLog(`[launcher] Window retry failed: ${retryErr.message}\n`);
        });
      }
    }, 1000);
  });
}

function killServerProcess() {
  if (serverProcess && serverProcess.pid) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(serverProcess.pid), '/T', '/F'], { windowsHide: true });
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch { /* already gone */ }
    serverProcess = null;
  }
}

app.whenReady().then(() => {
  try { fs.rmSync(serverLogPath(), { force: true }); } catch { /* fresh log per run */ }
  createWindow();
  probeServer((alreadyUp) => {
    if (!alreadyUp) {
      startServer((code) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(failurePageHtml())}`);
        }
      });
    }
    waitForServer(
      () => navigateToApp(),
      () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(failurePageHtml())}`);
        }
      }
    );
  });
});

app.on('window-all-closed', () => {
  killServerProcess();
  app.quit();
});

app.on('before-quit', () => {
  killServerProcess();
});
