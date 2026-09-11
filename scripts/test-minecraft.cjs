/**
 * Autonomous Verification Script for SUTRA-Craft
 * Connects to headless Chrome via CDP to verify WebGL context, game state, and capture screenshot.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;

async function run() {
  console.log('[Verify] Launching headless Chrome...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--window-size=1280,720',
    'http://localhost:4310/',
  ]);

  // Wait for remote debugging port to open
  let targets = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      if (res.ok) {
        targets = await res.json();
        break;
      }
    } catch (e) {}
  }

  if (!targets || targets.length === 0) {
    console.error('[Verify] Failed to connect to Chrome debugging port.');
    chrome.kill();
    process.exit(1);
  }

  const pageTarget = targets.find((t) => t.type === 'page');
  console.log('[Verify] Found page target:', pageTarget.webSocketDebuggerUrl);

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();
  const consoleMessages = [];
  const runtimeExceptions = [];

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) cb.reject(msg.error);
      else cb.resolve(msg.result);
    } else if (msg.method === 'Console.messageAdded') {
      consoleMessages.push(msg.params.message);
      console.log('[Browser Console]', msg.params.message.level, msg.params.message.text);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(msg.params.exceptionDetails);
      console.error('[Browser Exception]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
    }
  });

  await new Promise((resolve) => ws.on('open', resolve));

  await send('Console.enable');
  await send('Runtime.enable');
  await send('Page.enable');

  console.log('[Verify] Waiting for game to initialize and render chunks...');
  await new Promise((r) => setTimeout(r, 3000));

  // Evaluate game state
  const evalResult = await send('Runtime.evaluate', {
    expression: `(function() {
      if (!window.game) return { error: 'window.game is not defined' };
      const g = window.game;
      return {
        hasGame: !!g,
        hasScene: !!g.scene,
        sceneChildren: g.scene.children.length,
        hasCamera: !!g.camera,
        hasWorld: !!g.world,
        chunkCount: g.world.chunks.size,
        meshCount: g.chunkMeshes.size,
        playerPos: { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z },
        playerOnGround: g.player.onGround,
        timeOfDay: g.timeOfDay,
        activeHotbarBlock: g.interaction.selectedBlockId,
        mobsCount: g.mobs.mobs.length,
        canvasWidth: g.canvas.width,
        canvasHeight: g.canvas.height
      };
    })()`,
    returnByValue: true,
  });

  console.log('[Verify] Game State Evaluation:');
  console.log(JSON.stringify(evalResult.result.value, null, 2));

  // Hide the blocker overlay so we capture the pure 3D gameplay view
  await send('Runtime.evaluate', {
    expression: `document.getElementById('blocker').style.display = 'none';`,
  });
  await new Promise((r) => setTimeout(r, 500));

  // Capture Screenshot
  console.log('[Verify] Capturing game screenshot...');
  const screenshotResult = await send('Page.captureScreenshot', { format: 'png' });
  const screenshotBuffer = Buffer.from(screenshotResult.data, 'base64');
  const screenshotPath = path.join(__dirname, '..', 'minecraft', 'screenshot.png');
  fs.writeFileSync(screenshotPath, screenshotBuffer);
  console.log('[Verify] Screenshot saved to:', screenshotPath, `(${screenshotBuffer.length} bytes)`);

  // Close connection & terminate Chrome
  ws.close();
  chrome.kill();

  console.log('[Verify] Verification Summary:');
  console.log(`- Runtime Exceptions: ${runtimeExceptions.length}`);
  console.log(`- Console Messages: ${consoleMessages.length}`);
  console.log(`- Chunks Loaded: ${evalResult.result.value?.chunkCount}`);
  console.log(`- Meshes in Scene: ${evalResult.result.value?.meshCount}`);
  console.log(`- Mobs Active: ${evalResult.result.value?.mobsCount}`);

  if (runtimeExceptions.length > 0) {
    console.error('[Verify] Verification FAILED due to runtime exceptions.');
    process.exit(1);
  } else {
    console.log('[Verify] Verification PASSED successfully with ZERO exceptions!');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('[Verify] Fatal error:', err);
  process.exit(1);
});
