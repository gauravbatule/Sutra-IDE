import { describe, it, expect } from 'vitest';
import { createPacket, parsePacket, WSChannel } from '../../server/wsProtocol.js';
import { InlineDiffEngine } from '../../server/tools/inlineDiffEngine.js';
import { ptyManager } from '../../server/ptyManager.js';
import { mobileBridge } from '../../server/mobileBridge.js';
import { inspectWebPage } from '../../server/tools/webPageInspector.js';
import http from 'http';

describe('System Hardening & Quality Verification Suite', () => {
  describe('wsProtocol Safe Serialization', () => {
    it('serializes standard payloads correctly', () => {
      const packetStr = createPacket(WSChannel.AGENT_STREAM, 'chunk', { delta: 'hello world' });
      const parsed = parsePacket(packetStr);
      expect(parsed).not.toBeNull();
      expect(parsed?.channel).toBe(WSChannel.AGENT_STREAM);
      expect(parsed?.type).toBe('chunk');
      expect(parsed?.payload.delta).toBe('hello world');
    });

    it('safely handles circular references without throwing', () => {
      const circularObj: any = { message: 'test loop' };
      circularObj.self = circularObj;

      expect(() => {
        const packetStr = createPacket(WSChannel.AGENT_TOOL_CALL, 'result', circularObj);
        const parsed = parsePacket(packetStr);
        expect(parsed).not.toBeNull();
        expect(parsed?.payload.message).toBe('test loop');
        expect(parsed?.payload.self).toBe('[Circular]');
      }).not.toThrow();
    });

    it('safely serializes BigInt values', () => {
      const bigIntPayload = { id: 1234567890123456789n, name: 'bigint-test' };
      expect(() => {
        const packetStr = createPacket(WSChannel.AGENT_STREAM, 'stat', bigIntPayload);
        const parsed = parsePacket(packetStr);
        expect(parsed).not.toBeNull();
        expect(parsed?.payload.name).toBe('bigint-test');
      }).not.toThrow();
    });
  });

  describe('InlineDiffEngine Cross-Platform CRLF Normalization', () => {
    const engine = new InlineDiffEngine();

    it('generates accurate diffs regardless of CRLF vs LF differences', () => {
      const crlfOld = 'function hello() {\r\n  console.log("old");\r\n}\r\n';
      const lfNew = 'function hello() {\n  console.log("new");\n}\n';

      const diffResult = engine.generateDiff('test.ts', crlfOld, lfNew);
      expect(diffResult.filePath).toBe('test.ts');
      expect(diffResult.additions).toBeGreaterThan(0);
      expect(diffResult.deletions).toBeGreaterThan(0);
      expect(diffResult.hunks.length).toBeGreaterThan(0);
    });

    it('preserves line ending style when applying patches', () => {
      const original = 'const x = 1;\r\nconst y = 2;\r\n';
      const modified = 'const x = 1;\nconst y = 3;\n';
      const patch = engine.generateUnifiedDiff('math.ts', original, modified);
      const applied = engine.applyDiff(original, patch);

      expect(applied).toContain('\r\n');
      expect(applied).toContain('const y = 3;');
    });
  });

  describe('PTYManager Background Task Log Retention', () => {
    it('retains process output logs even after a short-lived process terminates', async () => {
      // Execute a fast echo command that exits immediately
      const result = await ptyManager.runBackgroundProcess('echo TEST_LOG_RETENTION_VERIFIED', 'echo-test', undefined, 800);
      expect(result.taskId).toBeDefined();

      // Wait a moment for process exit event to trigger
      await new Promise((r) => setTimeout(r, 1000));

      const logInfo = ptyManager.getProcessLogs(result.taskId);
      expect(logInfo.id).toBe(result.taskId);
      expect(logInfo.logs).toContain('TEST_LOG_RETENTION_VERIFIED');
      expect(logInfo.isRunning).toBe(false);
    });
  });

  describe('MobileBridge LAN IP Filtering', () => {
    it('returns a valid IPv4 LAN address or localhost', () => {
      const lanIp = mobileBridge.getLanIp();
      expect(lanIp).toBeDefined();
      expect(typeof lanIp).toBe('string');
      // Should match standard IPv4 format
      expect(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lanIp)).toBe(true);
      // Should never be empty or undefined
      expect(lanIp.length).toBeGreaterThan(0);
    });
  });

  describe('inspectWebPage Robust Network & Protocol Handling', () => {
    it('handles unreachable host gracefully without uncaught errors', async () => {
      const result = await inspectWebPage('http://127.0.0.1:59999', { timeoutMs: 1500 });
      expect(result.live).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('inspects a local test server cleanly', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><head><title>Test Page</title></head><body><h1>Hello</h1></body></html>');
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as any;
      const port = address.port;

      try {
        const result = await inspectWebPage(`http://127.0.0.1:${port}`);
        expect(result.live).toBe(true);
        expect(result.title).toBe('Test Page');
        expect(result.doctypeValid).toBe(true);
      } finally {
        server.close();
      }
    });
  });
});
