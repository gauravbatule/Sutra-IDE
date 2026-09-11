import { modelRouter } from '../server/modelRouter.js';

async function testStreamChat() {
  console.log('Testing modelRouter.streamChat with auto...');
  try {
    const gen = modelRouter.streamChat({
      modelId: 'auto',
      messages: [{ role: 'user', content: 'list all files' }],
      systemPrompt: 'You are Astra.',
    });
    for await (const chunk of gen) {
      console.log('STREAM CHUNK:', JSON.stringify(chunk));
    }
  } catch (err: any) {
    console.error('streamChat top-level error:', err.message, err.stack);
  }
}

testStreamChat().catch(console.error);
