import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { agentSwarm } from '../../server/agentSwarm.js';

function makeToolCall(tool: string, params: Record<string, any>) {
  return {
    id: `call-${Date.now()}-${Math.random()}`,
    tool,
    params,
    requiresApproval: false,
    status: 'executing' as const,
    timestamp: Date.now(),
  };
}

describe('verify_http_server tool', () => {
  let server: http.Server;
  let testPort: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body><h1>Mini Minecraft Test Server</h1></body></html>');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        testPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('validates port range bounds', async () => {
    const result = await agentSwarm.executeTool(makeToolCall('verify_http_server', { port: 999999 }));
    expect(result).toHaveProperty('error');
    expect((result as any).error).toMatch(/Invalid port/i);
  });

  it('successfully reaches and validates an active HTTP server', async () => {
    const result = await agentSwarm.executeTool(makeToolCall('verify_http_server', { port: testPort }));
    expect(result).toMatchObject({
      live: true,
      httpStatus: 200,
      ok: true,
    });
    expect((result as any).contentPreview).toContain('Mini Minecraft');
    expect((result as any).message).toMatch(/Server is LIVE and returning HTTP 200 OK/i);
  });

  it('reports connection refused honestly when port is not listening', async () => {
    const unusedPort = 59123;
    const result = await agentSwarm.executeTool(makeToolCall('verify_http_server', { port: unusedPort, timeoutMs: 800 }));
    expect(result).toMatchObject({
      live: false,
      port: unusedPort,
    });
    expect((result as any).error).toMatch(/Could not connect to port 59123/i);
  });
});
