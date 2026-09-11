import { describe, it, expect } from 'vitest';
import { processManager } from '../../server/processManager.js';
import { classifyCommand, agentSwarm } from '../../server/agentSwarm.js';

describe('Server Execution & Port Detection Invariants', () => {
  it('accurately detects ports across Python, Node, Vite, and custom server flags', () => {
    expect(processManager.detectPort('python -m http.server 8000')).toBe(8000);
    expect(processManager.detectPort('python3 -m http.server 8080')).toBe(8080);
    expect(processManager.detectPort('python -m http.server')).toBe(8000);
    expect(processManager.detectPort('npx serve -p 4000')).toBe(4000);
    expect(processManager.detectPort('uvicorn main:app --port 8000')).toBe(8000);
    expect(processManager.detectPort('npm run dev')).toBe(5173);
    expect(processManager.detectPort('node server.js')).toBe(3000);
    expect(processManager.detectPort('node app.js :9000')).toBe(9000);
  });

  it('classifies server commands as waitClass server so they are auto-backgrounded', () => {
    expect(classifyCommand('python -m http.server 8000').waitClass).toBe('server');
    expect(classifyCommand('npm run dev').waitClass).toBe('server');
    expect(classifyCommand('uvicorn main:app').waitClass).toBe('server');
    expect(classifyCommand('npx serve dist').waitClass).toBe('server');
  });

  it('registers background server processes and returns port URL and metadata', async () => {
    const res = await agentSwarm.executeTool({
      id: 'tc-test-server-1',
      tool: 'run_command',
      params: {
        command: 'python -m http.server 8000',
        background: true,
      },
      status: 'pending',
      requiresApproval: false,
      timestamp: Date.now(),
    });

    expect(res).toBeDefined();
    expect(res.started).toBe(true);
    expect(res.taskId).toMatch(/^bg-\d+/);
    expect(res.port).toBe(8000);
    expect(res.url).toBe('http://localhost:8000');

    if (res.taskId) {
      agentSwarm.killBackgroundTask(res.taskId);
    }
  });

  it('executes foreground chained commands with && successfully on all platforms', async () => {
    const res = await agentSwarm.executeTool({
      id: 'tc-test-chain-1',
      tool: 'run_command',
      params: {
        command: 'echo first_part && echo second_part',
      },
      status: 'pending',
      requiresApproval: false,
      timestamp: Date.now(),
    });

    expect(res).toBeDefined();
    expect(res.exitCode).toBe(0);
    expect(res.outputTail).toContain('first_part');
    expect(res.outputTail).toContain('second_part');
  });
});
