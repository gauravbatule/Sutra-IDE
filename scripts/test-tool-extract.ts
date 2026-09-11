/**
 * Smoke test for extractAndStripTextToolCalls (Pattern 6 — Python-style calls).
 *
 * Run with: npx tsx scripts/test-tool-extract.ts
 *
 * This is a temporary harness to prove the dialect used by
 * antigravityBridge.ts (```python fenced, Python kwargs) is now parsed.
 */
import { extractAndStripTextToolCalls } from '../server/modelRouter.js';

const cases: Array<{ name: string; input: string; expectTool?: string; expectParam?: [string, string] }> = [
  {
    name: 'Antigravity dialect: python fence, write_file',
    input: [
      'I will create the file now.',
      '',
      '```python',
      'write_file(path="src/hello.ts", content="export const hi = 1;\\n")',
      '```',
      '',
      'That creates the module.',
    ].join('\n'),
    expectTool: 'write_file',
    expectParam: ['path', 'src/hello.ts'],
  },
  {
    name: 'Antigravity dialect: create_artifact with name + content',
    input: [
      'Let me save a plan.',
      '',
      '```python',
      'create_artifact(name="Implementation Plan", type="plan", content="# Plan\\n\\nStep 1")',
      '```',
    ].join('\n'),
    expectTool: 'create_artifact',
    expectParam: ['name', 'Implementation Plan'],
  },
  {
    name: 'run_command with single quotes',
    input: "```python\nrun_command(command='npm run build')\n```",
    expectTool: 'run_command',
    expectParam: ['command', 'npm run build'],
  },
  {
    name: 'JSON fence (Pattern 5) still works',
    input: '```json\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n```',
    expectTool: 'read_file',
    expectParam: ['path', 'a.ts'],
  },
  {
    name: 'XML tool_call (Pattern 1) still works',
    input: '<tool_call><function=read_file><parameter=path>a.ts</parameter></function></tool_call>',
    expectTool: 'read_file',
    expectParam: ['path', 'a.ts'],
  },
  {
    name: 'Prose mentioning a tool is NOT executable',
    input: 'You should read_file README.md to inspect it.',
    expectTool: undefined,
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const { cleanText, extractedTools } = extractAndStripTextToolCalls(c.input);
  const found = extractedTools[0];
  let ok = true;
  let detail = '';

  if (!c.expectTool) {
    ok = extractedTools.length === 0;
    detail = ok ? 'no tools (correct)' : `unexpected tool: ${JSON.stringify(extractedTools)}`;
  } else {
    ok = Boolean(found && found.tool === c.expectTool);
    if (ok && c.expectParam) {
      const [k, v] = c.expectParam;
      const actual = found.params?.[k];
      ok = String(actual) === v;
      detail = ok
        ? `tool=${found.tool} ${k}=${JSON.stringify(actual)}`
        : `param mismatch: ${k}=${JSON.stringify(actual)} (want ${JSON.stringify(v)})`;
    } else if (ok) {
      detail = `tool=${found.tool}`;
    } else {
      detail = `got ${found ? found.tool : 'nothing'}, want ${c.expectTool}`;
    }
  }

  // The extracted call syntax must never leak into the visible chat.
  if (ok && c.expectTool && /```(python|json)/.test(cleanText)) {
    ok = false;
    detail += ' — code fence leaked into cleanText';
  }

  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`      ${detail}`);
  if (ok) pass++;
  else fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
