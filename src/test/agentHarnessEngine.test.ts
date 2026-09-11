import { describe, it, expect } from 'vitest';
import {
  estimateMessageTokens,
  compactConversationContext,
  redactAllSecrets,
  sutraHarness,
} from '../../server/harness/agentHarnessEngine.js';
import { astGatherer } from '../../server/harness/astGatherer.js';

describe('SUTRA Studio - Agent Harness Engine & Memory Compaction', () => {
  describe('1. Token Estimation & Secret Sanitization', () => {
    it('estimates token count accurately across strings, multimodal parts, and tool arguments', () => {
      const messages = [
        { role: 'system', content: 'You are Astra.' },
        { role: 'user', content: 'Fix the bug in router.ts' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/router.ts' }) },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: 'export class Router { route() {} }',
        },
      ];

      const tokens = estimateMessageTokens(messages, 'System prompt preamble');
      expect(tokens).toBeGreaterThan(20);
      expect(tokens).toBeLessThan(150);
    });

    it('redacts all high-entropy secrets and keys from strings and payloads', () => {
      const sensitiveText = [
        'OpenAI: sk-proj-123456789012345678901234567890',
        'Anthropic: sk-ant-api03-abcdef1234567890abcdef1234567890',
        'Google: AIzaSyD1234567890123456789012345678901',
        'GitHub: ghp_123456789012345678901234567890123456',
        'AWS: AKIAIOSFODNN7EXAMPLE',
        'Bearer: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitivePayload'
      ].join('\n');

      const cleaned = redactAllSecrets(sensitiveText);
      expect(cleaned).toContain('[REDACTED_OPENAI_PROJ_KEY]');
      expect(cleaned).toContain('[REDACTED_ANTHROPIC_KEY]');
      expect(cleaned).toContain('[REDACTED_GOOGLE_KEY]');
      expect(cleaned).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(cleaned).toContain('[REDACTED_AWS_KEY]');
      expect(cleaned).toContain('Bearer [REDACTED_TOKEN]');
      expect(cleaned).not.toContain('sk-proj-');
      expect(cleaned).not.toContain('AIzaSyD');
    });
  });

  describe('2. Context Compaction & Budget Enforcement', () => {
    it('compacts oversized tool outputs in older turns while preserving recent context', () => {
      const massiveOutput = 'A'.repeat(10000);
      const messages = [
        { role: 'user', content: 'Step 1' },
        {
          role: 'assistant',
          content: 'Reading big file',
          tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"big.ts"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: massiveOutput },
        { role: 'user', content: 'Step 2' },
        { role: 'assistant', content: 'Working on step 2' },
      ];

      const compacted = compactConversationContext(messages, 800);
      const toolMsg = compacted.find((m) => m.tool_call_id === 'call_1');
      expect(toolMsg).toBeDefined();
      expect(toolMsg.content).toContain('[Tool output compacted:');
      expect(toolMsg.content.length).toBeLessThan(500);
    });

    it('preserves turn atomicity without orphaning tool calls when compacting middle turns', () => {
      const messages = [
        { role: 'user', content: 'Build a full site' },
        {
          role: 'assistant',
          content: 'Creating index.html',
          tool_calls: [{ id: 'call_1', function: { name: 'write_file', arguments: '{"path":"index.html"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'File written successfully' },
        { role: 'user', content: 'Now create style.css' },
        {
          role: 'assistant',
          content: 'Creating style.css',
          tool_calls: [{ id: 'call_2', function: { name: 'write_file', arguments: '{"path":"style.css"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_2', content: 'File written successfully' },
        { role: 'user', content: 'Now create app.js' },
        {
          role: 'assistant',
          content: 'Creating app.js',
          tool_calls: [{ id: 'call_3', function: { name: 'write_file', arguments: '{"path":"app.js"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_3', content: 'File written successfully' },
        { role: 'user', content: 'Verify server' },
        {
          role: 'assistant',
          content: 'Checking server',
          tool_calls: [{ id: 'call_4', function: { name: 'verify_http_server', arguments: '{"port":3000}' } }],
        },
        { role: 'tool', tool_call_id: 'call_4', content: 'Server responding OK' },
      ];

      const compacted = compactConversationContext(messages, 100);
      // Verify initial prompt is kept
      expect(compacted[0].content).toBe('Build a full site');
      // Verify summary user message was injected
      const summary = compacted.find((m) => typeof m.content === 'string' && m.content.includes('[Context Compacted:'));
      expect(summary).toBeDefined();
      // Verify recent turn with call_4 is intact
      const lastTool = compacted.find((m) => m.tool_call_id === 'call_4');
      expect(lastTool).toBeDefined();
    });
  });

  describe('3. Semantic AST Compactor & AST Gatherer', () => {
    it('summarizes massive files during read_file without leaking raw AST dumps', async () => {
      const compactorPlugin = sutraHarness.getPlugins().find((p) => p.name === 'sutra-semantic-ast-compactor');
      expect(compactorPlugin).toBeDefined();

      const massiveCode = Array.from({ length: 1500 }, (_, i) => `export function helper_${i}() { return ${i}; }`).join('\n');
      expect(massiveCode.length).toBeGreaterThan(50000);

      const result = await compactorPlugin!.onAfterTool!(
        { id: '1', tool: 'read_file', params: { path: 'huge.ts' }, requiresApproval: false, status: 'completed', timestamp: Date.now() },
        { content: massiveCode },
        {} as any
      );

      expect(result.isSummarized).toBe(true);
      expect(result.content).toContain('[Large File:');
      expect(result.content.length).toBeLessThan(10000);
      // Raw 50k+ char file content should NOT remain intact in content field
      expect(result.content.length).toBeLessThan(massiveCode.length);
    });

    it('AST gatherer parses and compacts symbols cleanly', () => {
      const summary = astGatherer.formatCompactSummary({
        importedFiles: ['./auth.js', './db.js'],
        exportedSymbols: ['login', 'logout', 'UserSession'],
        typeSignatures: ['interface UserSession { id: string }'],
      });

      expect(summary).toContain('Imports: [./auth.js, ./db.js]');
      expect(summary).toContain('Exports: [login, logout, UserSession]');
    });
  });
});