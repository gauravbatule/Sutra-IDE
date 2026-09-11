import WebSocket from 'ws';

async function run() {
  const ws = new WebSocket('ws://localhost:3001/ws/agent');
  ws.on('open', () => {
    ws.send(JSON.stringify({
      channel: 0x05,
      type: 'prompt',
      payload: {
        model: 'auto',
        messages: [{ role: 'user', content: 'list all files' }]
      }
    }));
  });
  ws.on('message', (d) => {
    console.log('RECV:', d.toString());
  });
  ws.on('close', () => process.exit(0));
}
run();
