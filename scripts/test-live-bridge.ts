import {
  ensureFreshAccessToken,
  discoverAntigravityProxy,
  hasLocalAntigravitySignIn,
  describeLocalAntigravitySignIn,
  streamAntigravityTurn
} from '../server/providers/antigravityBridge.js';

async function main() {
  console.log('--- 1. Checking discovery and sign in status ---');
  console.log('hasLocalAntigravitySignIn:', hasLocalAntigravitySignIn());
  console.log('describeLocalAntigravitySignIn:', describeLocalAntigravitySignIn());
  const proxy = discoverAntigravityProxy();
  console.log('discoverAntigravityProxy:', proxy);

  console.log('\n--- 2. Checking OAuth token and project ---');
  try {
    const token = await ensureFreshAccessToken();
    console.log('ensureFreshAccessToken result:', token ? `Token present (${token.slice(0, 15)}... len=${token.length})` : 'NULL');
  } catch (err: any) {
    console.error('ensureFreshAccessToken error:', err.message);
  }

  console.log('\n--- 3. Testing streamAntigravityTurn with "hello" ---');
  try {
    const generator = streamAntigravityTurn(
      {
        modelId: 'gemini-3.7-flash',
        messages: [{ role: 'user', content: 'Say "Antigravity Bridge is live!" and nothing else.' }],
      },
      []
    );
    for await (const chunk of generator) {
      console.log('CHUNK:', JSON.stringify(chunk));
    }
  } catch (err: any) {
    console.error('streamAntigravityTurn error:', err.message);
  }
}

main().catch(console.error);
