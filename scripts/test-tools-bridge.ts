import { streamAntigravityTurn } from '../server/providers/antigravityBridge.js';
import { SUTRA_TOOLS } from '../server/modelRouter.js';

async function testWithTools() {
  console.log('Testing streamAntigravityTurn with tools and prompt: "run the website"...');
  try {
    const generator = streamAntigravityTurn(
      {
        modelId: 'gemini-3.7-flash',
        messages: [{ role: 'user', content: 'run the website' }],
      },
      SUTRA_TOOLS
    );
    let count = 0;
    for await (const chunk of generator) {
      count++;
      console.log(`CHUNK ${count}:`, JSON.stringify(chunk));
    }
  } catch (err: any) {
    console.error('streamAntigravityTurn error with tools:', err.message, err.stack);
  }
}

testWithTools().catch(console.error);
