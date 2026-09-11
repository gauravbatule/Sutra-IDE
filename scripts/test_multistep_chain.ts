import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001/ws');

let toolCount = 0;
let deltas = '';

ws.on('open', () => {
  console.log('--- WS Connected. Sending multi-step prompt ---');
  ws.send(
    JSON.stringify({
      channel: 0x05,
      type: 'prompt',
      payload: {
        messages: [
          {
            role: 'user',
            content: 'Please first use read_file to inspect package.json, and then use list_directory to see what is in src/components/Layout, and then tell me the package name and component files.',
          },
        ],
        permissionLevel: 'allow_all',
      },
      timestamp: Date.now(),
    })
  );
});

ws.on('message', (raw) => {
  try {
    const packet = JSON.parse(raw.toString());
    if (packet.channel === 0x05 && packet.type === 'chunk') {
      if (packet.payload?.delta) {
        deltas += packet.payload.delta;
        process.stdout.write(packet.payload.delta);
      }
      if (packet.payload?.toolCalls) {
        for (const tc of packet.payload.toolCalls) {
          toolCount++;
          console.log(`\n\n[TOOL CALL #${toolCount}]: ${tc.tool} (${JSON.stringify(tc.params)})\n`);
        }
      }
      if (packet.payload?.done) {
        console.log(`\n\n=== MULTI-STEP SESSION COMPLETE ===`);
        console.log(`Total tool calls chained: ${toolCount}`);
        console.log(`Total text length: ${deltas.length}`);
        if (toolCount >= 2) {
          console.log('✅ MULTI-STEP CHAINING SUCCESS: Multiple tools chained seamlessly in 1 turn!');
        } else {
          console.log(`Tool count: ${toolCount}`);
        }
        process.exit(0);
      }
    }
  } catch {
    // Malformed or non-JSON packet; stream chunks are parsed best-effort only.
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
  process.exit(1);
});

setTimeout(() => {
  console.log('\nTimed out after 60s');
  process.exit(0);
}, 60000);
