import { describe, it, expect } from 'vitest';
import { rescueToolDialects, healMalformedJson } from '../../server/harness/toolDialectRescue.js';

describe('Universal Tool Dialect Rescue & JSON Healing Engine', () => {
  it('rescues Qwen/Hermes <tool_call> XML blocks and cleans output text', () => {
    const rawText = `I will read the configuration file now.
<tool_call>
{"name": "read_file", "arguments": {"path": "package.json"}}
</tool_call>
Let me know if you need anything else.`;

    const result = rescueToolDialects(rawText, 1);
    expect(result.hasRescuedTools).toBe(true);
    expect(result.rescuedTools).toHaveLength(1);
    expect(result.rescuedTools[0].tool).toBe('read_file');
    expect(result.rescuedTools[0].params).toEqual({ path: 'package.json' });
    expect(result.cleanText).not.toContain('<tool_call>');
  });

  it('rescues Llama/Groq <function=name>{...}</function> blocks', () => {
    const rawText = `<function=grep_search>{"query": "export function", "path": "src"}</function>`;
    const result = rescueToolDialects(rawText, 2);
    expect(result.hasRescuedTools).toBe(true);
    expect(result.rescuedTools[0].tool).toBe('grep_search');
    expect(result.rescuedTools[0].params.query).toBe('export function');
    expect(result.cleanText).toBe('');
  });

  it('rescues DeepSeek/Kimi token sequence dialects', () => {
    const rawText = `<|tool_calls_section_begin|><|tool_call_begin|>functions.write_file:0
<|tool_call_argument_begin|>{"path": "index.html", "content": "<h1>Hello</h1>"}<|tool_call_end|><|tool_calls_section_end|>`;

    const result = rescueToolDialects(rawText, 1);
    expect(result.hasRescuedTools).toBe(true);
    expect(result.rescuedTools[0].tool).toBe('write_file');
    expect(result.rescuedTools[0].params.path).toBe('index.html');
    expect(result.cleanText).not.toContain('<|tool_call_begin|>');
  });

  it('extracts DeepSeek/Qwen <think>...</think> tags and preserves reasoning', () => {
    const rawText = `<think>
The user wants to find all TypeScript files. I should run grep_search or codebase_search.
</think>
<tool_call>
{"name": "codebase_search", "arguments": {"query": "TypeScript files"}}
</tool_call>`;

    const result = rescueToolDialects(rawText, 1);
    expect(result.hasRescuedTools).toBe(true);
    expect(result.reasoningText).toContain('The user wants to find all TypeScript files');
    expect(result.cleanText).not.toContain('<think>');
    expect(result.cleanText).not.toContain('</think>');
  });

  it('heals single quotes and trailing commas in malformed JSON', () => {
    const malformed = "{'file_path': 'src/app.ts', 'cmd': 'npm test',}";
    const healed = healMalformedJson(malformed);
    expect(healed.file_path).toBe('src/app.ts');
    expect(healed.cmd).toBe('npm test');
  });
});
