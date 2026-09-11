import { WebSocket } from 'ws';

const PROMPT = process.argv[2] || `Create a complete premium website in this workspace for a fictional specialty coffee brand called "Brew Haven". Build index.html with exactly 6 sections: hero (with a generated coffee image), about, menu (4 items with prices), gallery (3 generated images), testimonials (2 quotes), and contact with a working (client-side) contact form. Add a sticky top navigation with smooth-scroll links to each section and a mobile hamburger menu that opens/closes. Generate all images with the generate_image_asset tool (hero banner, 3 gallery photos). Modern dark premium design, smooth animations, all buttons and links must work.`;

const ws = new WebSocket('ws://127.0.0.1:3001/ws');
let text = '';
let toolCalls = 0;
let questions: string[] = [];
let done = false;

const timeout = setTimeout(() => {
  console.log('\n[TIMEOUT after 8 minutes]');
  finish();
}, 8 * 60 * 1000);

function finish() {
  if (done) return;
  done = true;
  clearTimeout(timeout);
  console.log('\n===== RUN SUMMARY =====');
  console.log('tool calls observed:', toolCalls);
  if (questions.length) console.log('questions asked:', questions.length, '→', questions[0].slice(0, 120));
  console.log('final text length:', text.length);
  console.log('final text tail:', text.slice(-400).replace(/\n+/g, ' '));
  process.exit(0);
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    channel: 0x05,
    type: 'prompt',
    payload: { messages: [{ role: 'user', content: PROMPT }], model: 'auto', permissionLevel: 'full' },
    timestamp: Date.now(),
  }));
  console.log('[E2E] prompt sent');
});

ws.on('message', (raw) => {
  let packet: any;
  try { packet = JSON.parse(String(raw)); } catch { return; }
  if (packet.channel === 0x06 && packet.type === 'request') {
    // Auto-approve any tool approval (FULL ACCESS run)
    ws.send(JSON.stringify({ channel: 0x07, type: 'decision', payload: { id: packet.payload?.id, approved: true } }));
    return;
  }
  if (packet.channel === 0x06 && packet.type === 'result') {
    const r = packet.payload?.result ?? packet.payload;
    console.log('\n[RESULT]', JSON.stringify(r).slice(0, 220));
    return;
  }
  if (packet.channel === 0x06 && packet.type === 'error') {
    console.log('\n[TOOL ERROR]', JSON.stringify(packet.payload).slice(0, 220));
    return;
  }
  if (packet.channel === 0x0a) return; // swarm state noise
  if (packet.channel !== 0x05) return;
  const p = packet.payload || {};
  if (packet.type === 'chunk') {
    if (p.retryEvent) console.log('[RETRY]', p.retryEvent.provider, p.retryEvent.reason?.slice(0, 80));
    if (p.thinking) process.stdout.write('');
    if (p.delta) { text += p.delta; process.stdout.write('.'); }
    if (p.toolCalls) {
      toolCalls += p.toolCalls.length;
      for (const tc of p.toolCalls) console.log('\n[TOOL]', tc.tool, JSON.stringify(tc.params).slice(0, 100));
    }
    if (p.done) { console.log('\n[DONE]'); finish(); }
  }
});

ws.on('error', (e) => { console.log('[WS ERROR]', e.message); finish(); });
ws.on('close', () => finish());
