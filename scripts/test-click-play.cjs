const { spawn } = require('child_process');
const WebSocket = require('ws');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function testClickToPlay() {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu-sandbox',
    '--window-size=1280,720',
    'http://localhost:4310/',
  ]);

  let targets = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch('http://127.0.0.1:9222/json');
      if (res.ok) {
        targets = await res.json();
        break;
      }
    } catch (e) {}
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const cbs = new Map();
  function send(m, p = {}) {
    return new Promise((res, rej) => {
      const mid = id++;
      cbs.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method: m, params: p }));
    });
  }
  ws.on('message', (d) => {
    const msg = JSON.parse(d);
    if (msg.id && cbs.has(msg.id)) {
      cbs.get(msg.id).res(msg.result);
      cbs.delete(msg.id);
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 2000));

  // Check initial blocker visibility
  const before = (
    await send('Runtime.evaluate', {
      expression: `({ blockerDisplay: getComputedStyle(document.getElementById('blocker')).display, hasStarted: !!window.game.hasStarted })`,
      returnByValue: true,
    })
  ).result.value;
  console.log('Before click:', before);

  // Click .click-prompt
  console.log('Dispatching click event on .click-prompt...');
  await send('Runtime.evaluate', {
    expression: `document.querySelector('.click-prompt').click()`,
  });
  await new Promise((r) => setTimeout(r, 500));

  // Check after click
  const after = (
    await send('Runtime.evaluate', {
      expression: `({ blockerDisplay: document.getElementById('blocker').style.display, hasStarted: !!window.game.hasStarted })`,
      returnByValue: true,
    })
  ).result.value;
  console.log('After click:', after);

  ws.close();
  chrome.kill();

  if (after.blockerDisplay === 'none' && after.hasStarted === true) {
    console.log('SUCCESS: Click to play works cleanly and dismisses the overlay!');
    process.exit(0);
  } else {
    console.error('FAILURE: Blocker did not dismiss.');
    process.exit(1);
  }
}

testClickToPlay().catch((e) => {
  console.error(e);
  process.exit(1);
});
