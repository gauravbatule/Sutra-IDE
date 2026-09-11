import { describe, it, expect } from 'vitest';
import {
  isPotentialToolCallSyntax,
  rescueToolDialects,
  stripAllToolDialects,
} from '../../server/harness/toolDialectRescue.js';

describe('Tool Dialect Rescue & Streaming Guard', () => {
  describe('isPotentialToolCallSyntax', () => {
    it('detects XML tool_call tag start', () => {
      expect(isPotentialToolCallSyntax('Some text <tool_call>')).toBe(true);
      expect(isPotentialToolCallSyntax('Leading text <tool_call><function=write_file>')).toBe(true);
      expect(isPotentialToolCallSyntax('Partial tail: <tool_')).toBe(true);
    });

    it('detects function tag start', () => {
      expect(isPotentialToolCallSyntax('<function=edit_file>')).toBe(true);
      expect(isPotentialToolCallSyntax('Thinking... <function=')).toBe(true);
    });

    it('detects DeepSeek / Kimi token sequence tag', () => {
      expect(isPotentialToolCallSyntax('<|tool_call_begin|>write_file')).toBe(true);
      expect(isPotentialToolCallSyntax('Ending with <|tool_call')).toBe(true);
    });

    it('detects markdown JSON tool call block', () => {
      expect(isPotentialToolCallSyntax('```json\n{"name": "write_file", "parameters": {}}')).toBe(true);
      expect(isPotentialToolCallSyntax('```json\n{"tool": "run_command"')).toBe(true);
    });

    it('detects pythonic tool call', () => {
      expect(isPotentialToolCallSyntax('write_file(path="index.html", content="hello")')).toBe(true);
      expect(isPotentialToolCallSyntax('run_command(command="npm run dev")')).toBe(true);
    });

    it('detects Sarvam / Hermes arg_key tag', () => {
      expect(isPotentialToolCallSyntax('write_todos\n<arg_key>todos</arg_key>')).toBe(true);
      expect(isPotentialToolCallSyntax('Leading text <arg_key>path</arg_key>')).toBe(true);
      expect(isPotentialToolCallSyntax('Thinking... <arg_')).toBe(true);
    });

    it('returns false for ordinary conversational text', () => {
      expect(isPotentialToolCallSyntax('Here is the explanation of how React components work.')).toBe(false);
      expect(isPotentialToolCallSyntax('Let me show you a function in JavaScript: const add = (a, b) => a + b;')).toBe(false);
      expect(isPotentialToolCallSyntax('The total number is < 50 and > 10.')).toBe(false);
    });
  });

  describe('rescueToolDialects', () => {
    it('rescues nested XML function and parameter tags', () => {
      const input = `I will write the landing page now.
<tool_call>
<function=write_file>
<parameter=path>index.html</parameter>
<parameter=content><!DOCTYPE html><html><body><h1>Hello</h1></body></html></parameter>
</function>
</tool_call>`;

      const result = rescueToolDialects(input, 1);
      expect(result.hasRescuedTools).toBe(true);
      expect(result.rescuedTools.length).toBe(1);
      expect(result.rescuedTools[0].tool).toBe('write_file');
      expect(result.rescuedTools[0].params.path).toBe('index.html');
      expect(result.rescuedTools[0].params.content).toContain('<h1>Hello</h1>');
      expect(result.cleanText).not.toContain('<tool_call>');
      expect(result.cleanText).not.toContain('</tool_call>');
    });

    it('rescues JSON-based tool calls inside tool_call tag', () => {
      const input = `Creating the style sheet.
<tool_call>
{
  "name": "write_file",
  "parameters": {
    "path": "styles.css",
    "content": "body { background: #000; }"
  }
}
</tool_call>`;

      const result = rescueToolDialects(input, 1);
      expect(result.hasRescuedTools).toBe(true);
      expect(result.rescuedTools.length).toBe(1);
      expect(result.rescuedTools[0].tool).toBe('write_file');
      expect(result.rescuedTools[0].params.path).toBe('styles.css');
      expect(result.cleanText).toBe('Creating the style sheet.');
    });

    it('rescues non-XML markdown JSON tool call', () => {
      const input = `Running tests now.
\`\`\`json
{
  "name": "run_unit_tests",
  "arguments": {}
}
\`\`\``;

      const result = rescueToolDialects(input, 1);
      expect(result.hasRescuedTools).toBe(true);
      expect(result.rescuedTools.length).toBe(1);
      expect(result.rescuedTools[0].tool).toBe('run_unit_tests');
    });

    it('rescues non-XML DeepSeek token sequence tool call', () => {
      const input = `Inspecting directory.
<|tool_call_begin|>list_directory:0<|tool_call_argument_begin|>{"path": "src"}<|tool_call_end|>`;

      const result = rescueToolDialects(input, 1);
      expect(result.hasRescuedTools).toBe(true);
      expect(result.rescuedTools.length).toBe(1);
      expect(result.rescuedTools[0].tool).toBe('list_directory');
      expect(result.rescuedTools[0].params.path).toBe('src');
    });
    it('rescues Sarvam / Hermes <arg_key> and <arg_value> tool call (e.g. write_todos)', () => {
      const input = `write_todos
<arg_key>todos</arg_key>
<arg_value>[{"id": "1", "title": "Inspect workspace", "status": "in_progress"}, {"id": "2", "title": "Build site", "status": "pending"}]</arg_value>`;

      const result = rescueToolDialects(input, 1);
      expect(result.hasRescuedTools).toBe(true);
      expect(result.rescuedTools.length).toBe(1);
      expect(result.rescuedTools[0].tool).toBe('write_todos');
      expect(Array.isArray(result.rescuedTools[0].params.todos)).toBe(true);
      expect(result.rescuedTools[0].params.todos[0].title).toBe('Inspect workspace');
    });
  });

  describe('stripAllToolDialects', () => {
    it('strips all residual tool markers cleanly from prose', () => {
      const input = `Here is your website.
<tool_call><function=write_file><parameter=path>test.txt</parameter></function></tool_call>
Hope you like it!`;

      const stripped = stripAllToolDialects(input);
      expect(stripped).toContain('Here is your website.');
      expect(stripped).toContain('Hope you like it!');
      expect(stripped).not.toContain('<tool_call>');
      expect(stripped).not.toContain('write_file');
    });

    it('strips Sarvam / Hermes arg_key and arg_value tags cleanly from prose', () => {
      const input = `I am organizing the tasks.
write_todos
<arg_key>todos</arg_key>
<arg_value>[{"id": "1"}]</arg_value>
All done!`;

      const stripped = stripAllToolDialects(input);
      expect(stripped).toContain('I am organizing the tasks.');
      expect(stripped).toContain('All done!');
      expect(stripped).not.toContain('<arg_key>');
      expect(stripped).not.toContain('<arg_value>');
      expect(stripped).not.toContain('write_todos');
    });
  });
});
