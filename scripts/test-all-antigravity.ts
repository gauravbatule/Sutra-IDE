import { streamAntigravityTurn } from '../server/providers/antigravityBridge.js';

const modelsToTest = [
  'gemini-3.7-flash',
  'claude-3-7-sonnet',
  'gemini-3-pro',
  'claude-opus',
  'auto'
];

async function testAllModels() {
  for (const m of modelsToTest) {
    console.log(`\n================ Testing ${m} ================`);
    try {
      const gen = streamAntigravityTurn(
        {
          modelId: m,
          messages: [{ role: 'user', content: 'Say "OK" and your model name.' }],
        },
        []
      );
      let text = '';
      for await (const chunk of gen) {
        if (chunk.delta) text += chunk.delta;
        if (chunk.thinking) console.log('Thinking:', chunk.thinking.slice(0, 60));
      }
      console.log('Result:', text.trim());
    } catch (err: any) {
      console.error(`FAILED for ${m}:`, err.message);
    }
  }
}

testAllModels().catch(console.error);
