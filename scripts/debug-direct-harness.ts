import { sutraHarness } from '../server/harness/sutraHarness.js';
import { modelRouter } from '../server/modelRouter.js';

async function testHarness() {
  console.log('=== 1. Active Model in Router ===');
  console.log('getActiveModel():', modelRouter.getActiveModel());
  console.log('resolveModelDefinition("auto"):', modelRouter.resolveModelDefinition('auto'));

  console.log('\n=== 2. Available Providers ===');
  console.log('listAvailableProviders():', modelRouter.listAvailableProviders());

  console.log('\n=== 3. Calling sutraHarness.executeHarnessTurn ===');
  try {
    const gen = sutraHarness.executeHarnessTurn({
      messages: [{ role: 'user', content: 'list all files' }],
      modelId: 'auto',
      systemPrompt: 'You are Astra, an AI assistant.',
    });
    let count = 0;
    for await (const chunk of gen) {
      count++;
      console.log(`[Harness Chunk ${count}]`, JSON.stringify(chunk));
    }
  } catch (err: any) {
    console.error('Harness error:', err.message, err.stack);
  }
}

testHarness().catch(console.error);
