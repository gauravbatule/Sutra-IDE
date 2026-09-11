import { sutraHarness } from '../server/harness/sutraHarness.js';
import { buildMasterSystemPrompt } from '../server/harness/agentPromptArchitecture.js';
import { fsTools } from '../server/tools/fsTools.js';

async function testWithSysPrompt() {
  const dynamicSystemPrompt = buildMasterSystemPrompt({
    modelId: 'auto',
    provider: 'antigravity',
    workspaceRoot: fsTools.getWorkspaceRoot(),
    activeEditorInfo: '',
    semanticContext: '',
    workspaceSnapshot: '',
    memorySection: '',
    codeNotesSection: '',
    toolStatsSection: '',
    harnessMode: 'standard',
  });

  console.log('Testing sutraHarness with master prompt...');
  try {
    const gen = sutraHarness.executeHarnessTurn({
      messages: [{ role: 'user', content: 'list all files' }],
      modelId: 'auto',
      systemPrompt: dynamicSystemPrompt,
    });
    let count = 0;
    for await (const chunk of gen) {
      count++;
      console.log(`[Chunk ${count}]`, JSON.stringify(chunk));
    }
  } catch (err: any) {
    console.error('Error:', err.message, err.stack);
  }
}

testWithSysPrompt().catch(console.error);
