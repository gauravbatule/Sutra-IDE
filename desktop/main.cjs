const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

let serverProcess = null;
let mainWindow = null;
let serverLogTail = '';

const SERVER_PORT = 3001;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// app root: project root in dev, resources/app when installed (asar disabled)
const BASE_DIR = app.getAppPath();

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

function startServer() {
  // The server runs on the system Node.js runtime (a documented requirement) so
  // native modules (better-sqlite3, node-pty) keep their prebuilt binaries — no
  // Electron ABI rebuild needed. The Electron shell is the native window.
  const tsxCli = path.join(BASE_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntry = path.join(BASE_DIR, 'server', 'index.ts');

  if (!fs.existsSync(tsxCli) || !fs.existsSync(serverEntry)) {
    appendServerLog(`[launcher] Missing files:\n  tsx: ${tsxCli} (${fs.existsSync(tsxCli)})\n  server: ${serverEntry} (${fs.existsSync(serverEntry)})\n`);
  }

  try {
    serverProcess = spawn('node', [tsxCli, serverEntry], {
      cwd: BASE_DIR,
      env: { ...process.env, NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    appendServerLog(`[launcher] Failed to spawn node: ${err.message}\n`);
    serverProcess = null;
    return;
  }

  serverProcess.stdout?.on('data', appendServerLog);
  serverProcess.stderr?.on('data', appendServerLog);
  serverProcess.on('error', (err) => {
    appendServerLog(`[launcher] node process error: ${err.message}\n`);
    serverProcess = null;
  });
  serverProcess.on('exit', (code) => {
    if (code) appendServerLog(`[launcher] server exited with code ${code}\n`);
    serverProcess = null;
  });
}

function probeServer(callback) {
  const req = http.get(`${SERVER_URL}/api/version`, (res) => {
    res.resume();
    callback(true);
  });
  req.on('error', () => callback(false));
  req.setTimeout(2000, () => req.destroy(new Error('timeout')));
}

function waitForServer(onReady, onFail, attempts = 120) {
  const tick = (remaining) => {
    probeServer((ok) => {
      if (ok) return onReady();
      if (remaining <= 0) return onFail();
      setTimeout(() => tick(remaining - 1), 1000);
    });
  };
  tick(attempts);
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
<style>
  body { margin: 0; background: #0b0c10; color: #e4e4e7; font-family: 'Segoe UI', sans-serif;
         display: flex; flex-direction: column; align-items: center; justify-content: center;
         height: 100vh; user-select: none; }
  .word { letter-spacing: 0.35em; font-size: 16px; color: #e4e4e7; text-transform: uppercase; animation: breathe 2s ease-in-out infinite; }
  .status { margin-top: 26px; font-size: 12px; color: #52525b; font-family: Consolas, monospace; }
  @keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
</style>
</head>
<body>
  <div class="word">SUTRA</div>
  <div class="status" id="status">Starting local engine…</div>
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
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0c10',
    icon: path.join(__dirname, 'sutra.ico'),
    autoHideMenuBar: true,
    title: 'SUTRA IDE',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show the branded loading screen instantly — never a black frame.
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPageHtml())}`);

  // Open external links in the default browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SERVER_URL)) {
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
  if (!mainWindow) return;
  mainWindow.loadURL(SERVER_URL).catch(() => {
    // Rare transient failure right after readiness — one retry.
    setTimeout(() => mainWindow?.loadURL(SERVER_URL).catch(() => {}), 1500);
  });
}

app.whenReady().then(() => {
  try { fs.rmSync(serverLogPath(), { force: true }); } catch { /* fresh log per run */ }
  createWindow();
  startServer();
  waitForServer(
    () => navigateToApp(),
    () => mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(failurePageHtml())}`)
  );
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(serverProcess.pid), '/T', '/F'], { windowsHide: true });
      } else {
        serverProcess.kill();
      }
    } catch { /* already gone */ }
  }
  app.quit();
});
