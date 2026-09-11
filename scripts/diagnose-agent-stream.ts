import WebSocket from 'ws';

async function testWs() {
  console.log('Connecting to WebSocket on ws://127.0.0.1:3001/ws with Origin http://localhost:3001...');
  const ws = new WebSocket('ws://127.0.0.1:3001/ws', {
    headers: {
      Origin: 'http://localhost:3001',
      Host: 'localhost:3001'
    }
  });

  ws.on('open', () => {
    console.log('WebSocket connection OPEN');
    const packet = {
      channel: 0x05, // AGENT_STREAM
      type: 'prompt',
      payload: {
        model: 'auto',
        messages: [
          { role: 'user', content: 'list all files' }
        ],
        permissionLevel: 'full',
        harnessMode: 'standard',
        isGoalMode: false,
      }
    };
    console.log('Sending packet:', JSON.stringify(packet));
    ws.send(JSON.stringify(packet));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[WS RECV type=${msg.type}]`, JSON.stringify(msg.payload));
      if (msg.type === 'chunk' && msg.payload?.done) {
        console.log('=== TURN COMPLETE SUCCESS ===');
        setTimeout(() => process.exit(0), 500);
      }
    } catch {
      console.log('[WS RECV raw]', data.toString());
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', (code, reason) => {
    console.log(`WebSocket closed: code=${code}, reason=${reason}`);
  });
}

testWs().catch(console.error);
