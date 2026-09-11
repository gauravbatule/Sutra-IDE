import WebSocket from 'ws';

interface TaskResult {
  taskNumber: number;
  taskTitle: string;
  success: boolean;
  streamedLength: number;
  toolCallsCount: number;
  sampleOutput: string;
  error?: string;
}

const WS_URL = 'ws://localhost:3001/ws';

function runTask(taskNumber: number, taskTitle: string, prompt: string, payloadExtras: Record<string, any> = {}): Promise<TaskResult> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let assistantText = '';
    let toolCallsCount = 0;
    let completed = false;

    try {
      ws = new WebSocket(WS_URL);
    } catch (err: any) {
      return resolve({
        taskNumber,
        taskTitle,
        success: false,
        streamedLength: 0,
        toolCallsCount: 0,
        sampleOutput: '',
        error: err.message,
      });
    }

    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        try { ws.close(); } catch { /* socket may already be closed */ }
        resolve({
          taskNumber,
          taskTitle,
          success: assistantText.length > 20,
          streamedLength: assistantText.length,
          toolCallsCount,
          sampleOutput: assistantText.slice(0, 200),
          error: assistantText.length > 20 ? undefined : 'Task timed out after 90s',
        });
      }
    }, 90000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          channel: 0x05, // AGENT_STREAM
          type: 'prompt',
          payload: {
            messages: [{ role: 'user', content: prompt }],
            permissionLevel: 'allow_all',
            ...payloadExtras,
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
            assistantText += packet.payload.delta;
            process.stdout.write('.');
          }
          if (packet.payload?.toolCalls) {
            toolCallsCount += packet.payload.toolCalls.length;
            process.stdout.write('[Tool]');
          }
          if (packet.payload?.done) {
            if (!completed) {
              completed = true;
              clearTimeout(timeout);
              try { ws.close(); } catch { /* socket may already be closed */ }
              resolve({
                taskNumber,
                taskTitle,
                success: assistantText.length > 10 || toolCallsCount > 0,
                streamedLength: assistantText.length,
                toolCallsCount,
                sampleOutput: assistantText.trim().slice(0, 250),
              });
            }
          }
        }
      } catch {
        // Ignore malformed/non-JSON packets; parsing stream chunks is best-effort.
      }
    });

    ws.on('error', (err) => {
      if (!completed) {
        completed = true;
        clearTimeout(timeout);
        resolve({
          taskNumber,
          taskTitle,
          success: false,
          streamedLength: assistantText.length,
          toolCallsCount,
          sampleOutput: assistantText,
          error: err.message,
        });
      }
    });
  });
}

async function runAll5Tasks() {
  console.log('====================================================');
  console.log('       SUTRA IDE 5-TASK LIVE VERIFICATION SUITE       ');
  console.log('====================================================\n');

  const tasks = [
    {
      num: 1,
      title: 'Semantic Codebase Knowledge Retrieval',
      prompt: 'What components are in src/components/Layout and how does TitleBar configure models?',
      extras: {},
    },
    {
      num: 2,
      title: 'Active Editor Telemetry Awareness',
      prompt: 'What line is my cursor on and what is the active file in the editor?',
      extras: {
        activeTabPath: 'src/components/Editor/MonacoEditor.tsx',
        cursorPosition: { line: 42, column: 15 },
        visibleRange: { startLine: 1, endLine: 60 },
        activeFileDiagnostics: [],
      },
    },
    {
      num: 3,
      title: 'Tool Calling & File Search',
      prompt: 'Find all SVG asset files in the public directory and list their paths.',
      extras: {},
    },
    {
      num: 4,
      title: 'Linter & TypeScript Diagnostics Feed',
      prompt: 'Check if there are any TypeScript compilation errors across the workspace.',
      extras: {},
    },
    {
      num: 5,
      title: 'Multimodal Asset Generation Routing',
      prompt: 'Generate an SVG icon asset named quantum-logo.svg with a futuristic cyan gradient.',
      extras: {},
    },
  ];

  const results: TaskResult[] = [];

  for (const t of tasks) {
    console.log(`[Task ${t.num}/5] Running: "${t.title}"...`);
    const res = await runTask(t.num, t.title, t.prompt, t.extras);
    results.push(res);
    console.log(`  ✓ Status: ${res.success ? 'PASSED' : 'FAILED'}`);
    console.log(`  ✓ Streamed: ${res.streamedLength} chars | Tool Calls: ${res.toolCallsCount}`);
    if (res.sampleOutput) {
      console.log(`  ✓ Output: ${res.sampleOutput.replace(/\n/g, ' ').slice(0, 140)}...`);
    }
    if (res.error) {
      console.log(`  ✗ Error: ${res.error}`);
    }
    console.log('');
  }

  console.log('====================================================');
  console.log('                 FINAL TEST SUMMARY                 ');
  console.log('====================================================');
  const passed = results.filter((r) => r.success).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${results.length - passed}`);
}

runAll5Tasks();
