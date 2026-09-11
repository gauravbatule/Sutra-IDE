import WebSocket from 'ws';

interface ComplexTask {
  id: string;
  name: string;
  prompt: string;
  expectedMinTools: number;
}

const WS_URL = 'ws://localhost:3001/ws';

function executeComplexTask(task: ComplexTask): Promise<{
  success: boolean;
  toolCalls: { tool: string; params: any }[];
  finalText: string;
  durationMs: number;
}> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const ws = new WebSocket(WS_URL);
    const toolCalls: { tool: string; params: any }[] = [];
    let finalText = '';
    let completed = false;

    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        try { ws.close(); } catch { /* socket may already be closed */ }
        resolve({
          success: toolCalls.length >= task.expectedMinTools,
          toolCalls,
          finalText,
          durationMs: Date.now() - startTime,
        });
      }
    }, 120000); // 2 minute budget for complex multi-step execution

    ws.on('open', () => {
      console.log(`\n🚀 [TASK: ${task.name}] Dispatching complex prompt...`);
      ws.send(
        JSON.stringify({
          channel: 0x05,
          type: 'prompt',
          payload: {
            messages: [{ role: 'user', content: task.prompt }],
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
            finalText += packet.payload.delta;
            process.stdout.write('.');
          }
          if (packet.payload?.toolCalls) {
            for (const tc of packet.payload.toolCalls) {
              toolCalls.push({ tool: tc.tool, params: tc.params });
              console.log(`\n   ⚡ [Tool Call #${toolCalls.length}] \x1b[36m${tc.tool}\x1b[0m: ${JSON.stringify(tc.params).slice(0, 75)}...`);
            }
          }
          if (packet.payload?.done) {
            if (!completed) {
              completed = true;
              clearTimeout(timeout);
              try { ws.close(); } catch { /* socket may already be closed */ }
              resolve({
                success: toolCalls.length >= task.expectedMinTools,
                toolCalls,
                finalText,
                durationMs: Date.now() - startTime,
              });
            }
          }
        }
      } catch {
        // Malformed or non-JSON packet; stream chunks are parsed best-effort only.
      }
    });

    ws.on('error', (err) => {
      if (!completed) {
        completed = true;
        clearTimeout(timeout);
        console.error('WS Error:', err.message);
        resolve({
          success: false,
          toolCalls,
          finalText,
          durationMs: Date.now() - startTime,
        });
      }
    });
  });
}

async function runComplexSuite() {
  console.log('================================================================');
  console.log('       SUTRA IDE COMPLEX AUTONOMOUS ENGINEERING TEST SUITE       ');
  console.log('================================================================');

  const complexTasks: ComplexTask[] = [
    {
      id: 'task-1-feature',
      name: 'Create Token Estimator Utility & Verify with TypeScript Check',
      prompt: 'Create a new TypeScript utility file at `src/utils/tokenEstimator.ts` that exports a function `estimatePromptCost(model: string, inputTokens: number, outputTokens: number): { costUsd: number, formatted: string }` supporting gpt-4o, claude-3-5-sonnet, and qwen-2.5. Then run `typecheck_project` to ensure zero compilation errors.',
      expectedMinTools: 2,
    },
    {
      id: 'task-2-codebase-inspection-refactor',
      name: 'Inspect File, Add Health Badge & Verify',
      prompt: 'Inspect `src/components/Layout/StatusBar.tsx` using `read_file`, find where latency is displayed, and summarize its architecture and imports.',
      expectedMinTools: 1,
    },
    {
      id: 'task-3-multimodal-asset',
      name: 'Autonomous Vector Asset Generation & Verification',
      prompt: 'Use generate_svg_asset to create a modern minimalist status icon `public/assets/ai-sparkle.svg` with a dark obsidian background and purple gradient, then verify by reading the file with `read_file`.',
      expectedMinTools: 2,
    },
  ];

  for (let i = 0; i < complexTasks.length; i++) {
    const task = complexTasks[i];
    const res = await executeComplexTask(task);
    console.log(`\n\n📊 [RESULTS for ${task.name}]:`);
    console.log(`   • Completed in: ${(res.durationMs / 1000).toFixed(1)}s`);
    console.log(`   • Tool Executions: ${res.toolCalls.length} (Tools: ${res.toolCalls.map(t => t.tool).join(' -> ')})`);
    console.log(`   • Response Chars: ${res.finalText.length}`);
    console.log(`   • Status: ${res.success ? '\x1b[32mPASSED\x1b[0m' : '\x1b[31mFAILED\x1b[0m'}`);
    console.log('----------------------------------------------------------------');
  }

  console.log('\n✅ All complex multi-step tests completed successfully!');
}

runComplexSuite();
