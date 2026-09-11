import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const SCREENSHOTS_DIR = path.join(projectRoot, 'scratch', 'browser-test', 'screenshots');
const ARTIFACTS_DIR = 'C:\\Users\\Gaurav Batule\\.gemini\\antigravity\\brain\\1485bbe4-ff79-4b94-9dc3-cc846ca75447';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = path.join(projectRoot, 'scratch', 'browser-test', 'profile');
const CDP_PORT = 9222;
const APP_URL = 'http://localhost:5173';

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(PROFILE_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetchJson(url);
      return true;
    } catch {
      await sleep(400);
    }
  }
  throw new Error(`Timeout waiting for ${url}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.callbacks = new Map();
    this.events = [];
    this.cursorX = 100;
    this.cursorY = 100;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          const { res, rej } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
          else res(msg.result);
        } else if (msg.method) {
          this.events.push(msg);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.nextId++;
      this.callbacks.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value;
  }

  async injectVisualCursor() {
    await this.eval(`
      (() => {
        if (document.getElementById('human-cursor-overlay')) return;
        const cursor = document.createElement('div');
        cursor.id = 'human-cursor-overlay';
        cursor.style.position = 'fixed';
        cursor.style.top = '0px';
        cursor.style.left = '0px';
        cursor.style.width = '24px';
        cursor.style.height = '24px';
        cursor.style.zIndex = '2147483647';
        cursor.style.pointerEvents = 'none';
        cursor.style.transform = 'translate(100px, 100px)';
        cursor.style.filter = 'drop-shadow(0 2px 8px rgba(0,0,0,0.8))';
        cursor.innerHTML = \`
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 2L19 12L11.5 13.5L8 20.5L4 2Z" fill="#3b82f6" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
            <circle cx="4" cy="2" r="3" fill="#60a5fa" />
          </svg>
          <div id="cursor-click-ripple" style="position: absolute; top: -8px; left: -8px; width: 36px; height: 36px; border: 2.5px solid #38bdf8; border-radius: 50%; opacity: 0; transform: scale(0.4); transition: all 0.26s cubic-bezier(0.16, 1, 0.3, 1);"></div>
        \`;
        document.body.appendChild(cursor);

        window.__moveHumanCursor = (x, y) => {
          cursor.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
        };

        window.__clickHumanCursor = () => {
          const r = document.getElementById('cursor-click-ripple');
          if (r) {
            r.style.opacity = '1';
            r.style.transform = 'scale(1.35)';
            setTimeout(() => {
              r.style.opacity = '0';
              r.style.transform = 'scale(0.4)';
            }, 240);
          }
        };
      })();
    `);
  }

  async smoothMouseMove(targetX, targetY, durationMs = 280) {
    const startX = this.cursorX;
    const startY = this.cursorY;
    const steps = Math.max(12, Math.floor(durationMs / 16));
    const stepTime = durationMs / steps;

    // Control point for a natural human curve
    const ctrlX = (startX + targetX) / 2 + (Math.random() - 0.5) * 60;
    const ctrlY = (startY + targetY) / 2 + (Math.random() - 0.5) * 40;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const curX = Math.round((1 - t) * (1 - t) * startX + 2 * (1 - t) * t * ctrlX + t * t * targetX);
      const curY = Math.round((1 - t) * (1 - t) * startY + 2 * (1 - t) * t * ctrlY + t * t * targetY);

      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: curX,
        y: curY,
      });

      await this.eval(`window.__moveHumanCursor && window.__moveHumanCursor(${curX}, ${curY})`);
      this.cursorX = curX;
      this.cursorY = curY;
      await sleep(stepTime);
    }
  }

  async humanClick(x, y) {
    await this.smoothMouseMove(x, y, 220);
    await sleep(60);

    await this.eval(`window.__clickHumanCursor && window.__clickHumanCursor()`);

    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await sleep(85);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await sleep(120);
  }

  async humanType(text, charDelayMs = 35) {
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: ch,
        unmodifiedText: ch,
        key: ch,
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: ch,
      });
      await sleep(charDelayMs + Math.random() * 20);
    }
  }

  async captureStepScreenshot(name, caption) {
    console.log(`[Screenshot] Capturing ${name}: ${caption}`);
    const res = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });

    const buf = Buffer.from(res.data, 'base64');
    const localPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(localPath, buf);

    if (fs.existsSync(ARTIFACTS_DIR)) {
      const artifactPath = path.join(ARTIFACTS_DIR, `${name}.png`);
      fs.writeFileSync(artifactPath, buf);
    }
    return localPath;
  }
}

async function main() {
  console.log('=== SUTRA IDE: Human-Like Browser Automation Verification ===');

  // 1. Launch Chrome
  console.log(`[Chrome] Launching Chrome headed with debugging on port ${CDP_PORT}...`);
  const chromeProc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
      '--window-position=50,50',
      APP_URL,
    ],
    { detached: true, stdio: 'ignore' }
  );

  chromeProc.unref();

  // 2. Wait for CDP endpoint
  console.log('[CDP] Waiting for Chrome DevTools Protocol endpoint...');
  await waitForHttp(`http://localhost:${CDP_PORT}/json/version`, 15000);
  console.log('[CDP] Chrome endpoint is ready!');

  // 3. Find Page Target
  const targets = await fetchJson(`http://localhost:${CDP_PORT}/json/list`);
  const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173')) || targets[0];
  if (!pageTarget) {
    throw new Error('No valid Chrome page target found');
  }

  console.log(`[CDP] Connecting to page: ${pageTarget.title} (${pageTarget.webSocketDebuggerUrl})`);
  const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();

  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('DOM.enable');

  // Ensure viewport size
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await sleep(1500);
  await client.injectVisualCursor();

  // -------------------------------------------------------------
  // Step 1: Handle Splash & Setup Gate
  // -------------------------------------------------------------
  console.log('\n--- Step 1: Handling Splash & Setup Gate ---');
  await sleep(1500);
  await client.injectVisualCursor();

  const isSetupNeeded = await client.eval(`
    Boolean(document.querySelector('button') && Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Skip for now')))
  `);

  if (isSetupNeeded) {
    console.log('[Setup Gate] Detected onboarding setup gate. Finding "Skip for now"...');
    const skipBtnRect = await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Skip for now'));
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);

    if (skipBtnRect) {
      console.log(`[Cursor] Moving smoothly to "Skip for now" at (${skipBtnRect.x}, ${skipBtnRect.y})...`);
      await client.humanClick(skipBtnRect.x, skipBtnRect.y);
      await sleep(1000);
    }
  }

  await client.injectVisualCursor();
  await client.captureStepScreenshot('01_manager_home', 'Manager Mode Homepage & Hero');

  // -------------------------------------------------------------
  // Step 2: Test Manager Shell & Model Dropdown
  // -------------------------------------------------------------
  console.log('\n--- Step 2: Interacting with Manager Shell & Composer ---');

  // Find the model dropdown button
  const modelBtnRect = await client.eval(`
    (() => {
      const btn = document.querySelector('[data-testid="model-selector-btn"]') ||
                  document.querySelector('button[aria-haspopup="listbox"]') ||
                  Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Claude') || b.textContent.includes('Gemini') || b.textContent.includes('GPT'));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (modelBtnRect) {
    console.log(`[Cursor] Moving to model dropdown at (${modelBtnRect.x}, ${modelBtnRect.y})...`);
    await client.humanClick(modelBtnRect.x, modelBtnRect.y);
    await sleep(600);
    await client.smoothMouseMove(modelBtnRect.x + 30, modelBtnRect.y + 70, 200);
    await sleep(300);
    await client.humanClick(modelBtnRect.x, modelBtnRect.y); // toggle close
    await sleep(400);
  }

  // Find Composer Textarea
  const composerRect = await client.eval(`
    (() => {
      const ta = document.querySelector('textarea');
      if (!ta) return null;
      const r = ta.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (composerRect) {
    console.log(`[Cursor] Moving to composer textarea at (${composerRect.x}, ${composerRect.y})...`);
    await client.humanClick(composerRect.x, composerRect.y);
    await sleep(200);
    console.log('[Typing] Typing prompt into composer...');
    await client.humanType('Build an autonomous full-stack dashboard with dark obsidian theme.');
    await sleep(500);
  }

  await client.captureStepScreenshot('02_manager_composer', 'Manager Composer with typed prompt');

  // -------------------------------------------------------------
  // Step 3: Switch to IDE Mode
  // -------------------------------------------------------------
  console.log('\n--- Step 3: Switching to Full IDE Mode ---');
  const openIdeBtnRect = await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.includes('Open IDE') || b.getAttribute('title')?.includes('Open IDE')
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (openIdeBtnRect) {
    console.log(`[Cursor] Gliding up to "Open IDE" at (${openIdeBtnRect.x}, ${openIdeBtnRect.y})...`);
    await client.humanClick(openIdeBtnRect.x, openIdeBtnRect.y);
    await sleep(1500);
  } else {
    console.log('[IDE] Fallback switching UI mode to ide via store...');
    await client.eval(`window.useIDEStore ? window.useIDEStore.getState().setUiMode('ide') : null`);
    await sleep(1500);
  }

  await client.injectVisualCursor();
  await client.captureStepScreenshot('03_ide_full_workspace', 'Full IDE Mode Opened');

  // -------------------------------------------------------------
  // Step 4: File Explorer & Monaco Editor
  // -------------------------------------------------------------
  console.log('\n--- Step 4: Interacting with File Explorer & Monaco Editor ---');

  const fileRect = await client.eval(`
    (() => {
      const items = Array.from(document.querySelectorAll('div, button, span')).filter(el =>
        el.textContent.trim() === 'package.json' || el.textContent.trim() === 'README.md'
      );
      const target = items[0];
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: target.textContent.trim() };
    })()
  `);

  if (fileRect) {
    console.log(`[Cursor] Moving over file "${fileRect.text}" in FileTree at (${fileRect.x}, ${fileRect.y})...`);
    await client.humanClick(fileRect.x, fileRect.y);
    await sleep(1200);
  }

  // Click inside Monaco editor to verify editor focus
  const editorRect = await client.eval(`
    (() => {
      const ed = document.querySelector('.monaco-editor') || document.querySelector('.monaco-mouse-cursor-text');
      if (!ed) return null;
      const r = ed.getBoundingClientRect();
      return { x: r.left + Math.min(250, r.width / 3), y: r.top + Math.min(150, r.height / 3) };
    })()
  `);

  if (editorRect) {
    console.log(`[Cursor] Clicking inside Monaco Editor at (${editorRect.x}, ${editorRect.y})...`);
    await client.humanClick(editorRect.x, editorRect.y);
    await sleep(400);
  }

  await client.captureStepScreenshot('04_monaco_editor_opened', 'Monaco Editor with File Loaded');

  // -------------------------------------------------------------
  // Step 5: MultiViewport Responsive Sandbox
  // -------------------------------------------------------------
  console.log('\n--- Step 5: Testing Responsive MultiViewport Sandbox ---');

  const previewBtnRect = await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.getAttribute('title')?.toLowerCase().includes('preview') ||
        b.textContent.toLowerCase().includes('preview')
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (previewBtnRect) {
    console.log(`[Cursor] Moving to Preview toggle button at (${previewBtnRect.x}, ${previewBtnRect.y})...`);
    await client.humanClick(previewBtnRect.x, previewBtnRect.y);
    await sleep(1200);
  }

  // Click Tablet viewport button
  const tabletBtnRect = await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.getAttribute('title')?.includes('Tablet') || b.textContent.includes('Tablet')
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (tabletBtnRect) {
    console.log(`[Cursor] Switching to Tablet Viewport at (${tabletBtnRect.x}, ${tabletBtnRect.y})...`);
    await client.humanClick(tabletBtnRect.x, tabletBtnRect.y);
    await sleep(600);
  }

  // Click Mobile viewport button
  const mobileBtnRect = await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.getAttribute('title')?.includes('Mobile') || b.textContent.includes('Mobile')
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (mobileBtnRect) {
    console.log(`[Cursor] Switching to Mobile Viewport at (${mobileBtnRect.x}, ${mobileBtnRect.y})...`);
    await client.humanClick(mobileBtnRect.x, mobileBtnRect.y);
    await sleep(600);
  }

  await client.captureStepScreenshot('05_multiviewport_mobile', 'Responsive Preview Mobile Viewport');

  // Click Desktop viewport button back
  const desktopBtnRect = await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.getAttribute('title')?.includes('Desktop') || b.textContent.includes('Desktop')
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (desktopBtnRect) {
    await client.humanClick(desktopBtnRect.x, desktopBtnRect.y);
    await sleep(600);
  }

  // -------------------------------------------------------------
  // Step 6: Settings Modal
  // -------------------------------------------------------------
  console.log('\n--- Step 6: Testing Settings Modal ---');
  const settingsBtnRect = await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.getAttribute('title')?.toLowerCase().includes('settings') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('settings')
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (settingsBtnRect) {
    console.log(`[Cursor] Moving down to Settings button at (${settingsBtnRect.x}, ${settingsBtnRect.y})...`);
    await client.humanClick(settingsBtnRect.x, settingsBtnRect.y);
    await sleep(1000);
    await client.injectVisualCursor();
    await client.captureStepScreenshot('06_settings_modal', 'Settings Modal Opened');

    // Close Settings Modal
    const closeBtnRect = await client.eval(`
      (() => {
        const btn = document.querySelector('button[title*="Close"]') ||
                    Array.from(document.querySelectorAll('button')).find(b => b.textContent === '✕' || b.getAttribute('aria-label')?.includes('Close'));
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);

    if (closeBtnRect) {
      console.log(`[Cursor] Closing Settings Modal at (${closeBtnRect.x}, ${closeBtnRect.y})...`);
      await client.humanClick(closeBtnRect.x, closeBtnRect.y);
      await sleep(600);
    } else {
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
      await sleep(400);
    }
  }

  // -------------------------------------------------------------
  // Step 7: Terminal Panel Inspection
  // -------------------------------------------------------------
  console.log('\n--- Step 7: Terminal & Bottom Dock ---');
  const terminalTabRect = await client.eval(`
    (() => {
      const tab = Array.from(document.querySelectorAll('button, div')).find(el =>
        el.textContent.trim() === 'Terminal'
      );
      if (!tab) return null;
      const r = tab.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `);

  if (terminalTabRect) {
    console.log(`[Cursor] Clicking Terminal Tab at (${terminalTabRect.x}, ${terminalTabRect.y})...`);
    await client.humanClick(terminalTabRect.x, terminalTabRect.y);
    await sleep(600);
  }

  await client.captureStepScreenshot('07_terminal_dock', 'Terminal Dock Open');

  // -------------------------------------------------------------
  // Step 8: Health Check & Console Errors
  // -------------------------------------------------------------
  console.log('\n--- Step 8: System Health & Error Audit ---');
  const domHealth = await client.eval(`
    ({
      title: document.title,
      rootChildCount: document.getElementById('root')?.childElementCount || 0,
      hasErrorOverlay: Boolean(document.querySelector('vite-error-overlay')),
      activeMode: window.useIDEStore ? window.useIDEStore.getState().uiMode : 'unknown',
      openFilesCount: window.useIDEStore ? window.useIDEStore.getState().openFiles?.length : 0,
      theme: window.useIDEStore ? window.useIDEStore.getState().theme : 'unknown',
    })
  `);

  console.log('DOM & Store Health Report:', JSON.stringify(domHealth, null, 2));

  console.log('\n=== All Human Browser Tests Completed Successfully! ===');
}

main().catch((err) => {
  console.error('Test Execution Error:', err);
  process.exit(1);
});
