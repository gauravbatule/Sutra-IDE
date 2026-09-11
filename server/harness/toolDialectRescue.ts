/**
 * SUTRA IDE - Universal Tool Dialect Rescue & JSON Healing Engine
 * 
 * Automatically detects, rescues, repairs, and translates tool calls emitted
 * in any provider dialect (Qwen/Hermes XML, DeepSeek/Kimi tokens, Llama/Groq functions,
 * raw JSON blocks) into native structured SUTRA IDE ToolCallPayload objects.
 */

import { ToolCallPayload } from '../types.js';

export interface RescuedToolCall {
  id: string;
  tool: string;
  params: Record<string, any>;
}

export interface DialectRescueResult {
  hasRescuedTools: boolean;
  rescuedTools: ToolCallPayload[];
  cleanText: string;
  reasoningText?: string;
}

// Map common alternative naming conventions to canonical SUTRA IDE tool names
const TOOL_NAME_ALIASES: Record<string, string> = {
  // File operations
  readFile: 'read_file',
  read_file: 'read_file',
  writeFile: 'write_file',
  write_file: 'write_file',
  createFile: 'write_file',
  create_file: 'write_file',
  editFile: 'edit_file',
  edit_file: 'edit_file',
  replaceInFile: 'edit_file',
  replace_in_file: 'edit_file',
  modifyFile: 'edit_file',
  modify_file: 'edit_file',
  deleteFile: 'delete_file',
  delete_file: 'delete_file',
  listDirectory: 'list_directory',
  list_directory: 'list_directory',
  listFiles: 'list_directory',
  list_files: 'list_directory',
  createDirectory: 'create_directory',
  create_directory: 'create_directory',
  makeDirectory: 'create_directory',
  make_directory: 'create_directory',
  renamePath: 'rename_path',
  rename_path: 'rename_path',

  // Search & Navigation
  grepSearch: 'grep_search',
  grep_search: 'grep_search',
  grep: 'grep_search',
  searchFiles: 'grep_search',
  search_files: 'grep_search',
  codebaseSearch: 'codebase_search',
  codebase_search: 'codebase_search',
  semanticSearch: 'codebase_search',
  semantic_search: 'codebase_search',
  searchCodebase: 'codebase_search',
  search_codebase: 'codebase_search',

  // Terminal & Process
  runCommand: 'run_command',
  run_command: 'run_command',
  executeCommand: 'run_command',
  execute_command: 'run_command',
  exec: 'run_command',
  bash: 'run_command',
  terminal: 'run_command',
  shell: 'run_command',
  checkTaskOutput: 'check_task_output',
  check_task_output: 'check_task_output',
  killTask: 'kill_task',
  kill_task: 'kill_task',
  inspectPort: 'inspect_port',
  inspect_port: 'inspect_port',
  verifyHttpServer: 'verify_http_server',
  verify_http_server: 'verify_http_server',
  checkPort: 'verify_http_server',
  check_port: 'verify_http_server',

  // Quality & Diagnostics
  typecheckProject: 'typecheck_project',
  typecheck_project: 'typecheck_project',
  typecheck: 'typecheck_project',
  lintCode: 'lint_code',
  lint_code: 'lint_code',
  formatCode: 'format_code',
  format_code: 'format_code',
  runUnitTests: 'run_unit_tests',
  run_unit_tests: 'run_unit_tests',
  testProject: 'run_unit_tests',
  test_project: 'run_unit_tests',

  // Multimodal & Assets
  generateImageAsset: 'generate_image_asset',
  generate_image_asset: 'generate_image_asset',
  generateImage: 'generate_image_asset',
  generate_image: 'generate_image_asset',
  generateVideoAsset: 'generate_video_asset',
  generate_video_asset: 'generate_video_asset',
  generateAudioAsset: 'generate_audio_asset',
  generate_audio_asset: 'generate_audio_asset',
  generateSvgAsset: 'generate_svg_asset',
  generate_svg_asset: 'generate_svg_asset',

  // Planning, Orchestration & Interactive
  writeTodos: 'write_todos',
  write_todos: 'write_todos',
  updateTodos: 'write_todos',
  update_todos: 'write_todos',
  todos: 'write_todos',
  task_plan: 'write_todos',
  taskPlan: 'write_todos',
  patchFile: 'patch_file',
  patch_file: 'patch_file',
  askUser: 'ask_user',
  ask_user: 'ask_user',
  spawnSubagent: 'spawn_subagent',
  spawn_subagent: 'spawn_subagent',
};

/**
 * Attempts to repair malformed or semi-escaped JSON strings commonly produced by open-weights LLMs.
 */
export function healMalformedJson(rawJson: string): Record<string, any> {
  const trimmed = rawJson.trim();
  if (!trimmed) return {};

  // 1. Direct parse attempt
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to healing heuristics
  }

  // 2. Strip surrounding markdown code fences if present
  let cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue
  }

  // 3. Normalize single quotes to double quotes for keys and string values
  try {
    const fixedQuotes = cleaned
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
      .replace(/,\s*([}\]])/g, '$1'); // Remove trailing commas
    return JSON.parse(fixedQuotes);
  } catch {
    // Continue
  }

  // 4. Extract first balanced { ... } block
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const bracketSlice = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(bracketSlice);
    } catch {
      // Continue
    }
  }

  return {};
}

/**
 * Normalizes tool parameter key names across various dialect conventions.
 */
function normalizeToolParams(toolName: string, params: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = { ...params };

  // Common file path variations
  if (params.file_path && !normalized.path) normalized.path = params.file_path;
  if (params.filePath && !normalized.path) normalized.path = params.filePath;
  if (params.filename && !normalized.path) normalized.path = params.filename;
  if (params.file && !normalized.path) normalized.path = params.file;

  // Common command variations
  if (params.cmd && !normalized.command) normalized.command = params.cmd;
  if (params.script && !normalized.command) normalized.command = params.script;

  // Common edit / replacement variations
  if (params.old_str && !normalized.target) normalized.target = params.old_str;
  if (params.oldStr && !normalized.target) normalized.target = params.oldStr;
  if (params.old_text && !normalized.target) normalized.target = params.old_text;
  if (params.search && !normalized.target) normalized.target = params.search;

  if (params.new_str && !normalized.replacement) normalized.replacement = params.new_str;
  if (params.newStr && !normalized.replacement) normalized.replacement = params.newStr;
  if (params.new_text && !normalized.replacement) normalized.replacement = params.new_text;
  if (params.replace && !normalized.replacement) normalized.replacement = params.replace;

  return normalized;
}

/**
 * Universal rescue and sanitization pipeline.
 */
export function rescueToolDialects(text: string, round = 1): DialectRescueResult {
  let workingText = text;
  let reasoningText: string | undefined;
  const rescuedTools: ToolCallPayload[] = [];

  // 1. Extract DeepSeek / Qwen <think>...</think> reasoning blocks
  const thinkMatch = workingText.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    reasoningText = thinkMatch[1].trim();
    workingText = workingText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  // 2. Dialect A: Qwen / Hermes XML tags <tool_call> ... </tool_call>
  // Supports both JSON bodies AND nested XML tags (<function=name><parameter=k>v</parameter></function>)
  const xmlToolRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let xmlMatch;
  while ((xmlMatch = xmlToolRegex.exec(workingText)) !== null) {
    const rawPayload = xmlMatch[1];

    // Check for nested XML format: <function=name><parameter=key>value</parameter></function>
    const nestedFuncMatch = rawPayload.match(/<function=([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/function>/i);
    if (nestedFuncMatch) {
      const rawName = nestedFuncMatch[1];
      const canonicalName = TOOL_NAME_ALIASES[rawName] || rawName;
      const paramBlock = nestedFuncMatch[2];
      const params: Record<string, any> = {};
      const paramPattern = /<parameter=([a-zA-Z0-9_]+)>([\s\S]*?)<\/parameter>/gi;
      let pMatch;
      while ((pMatch = paramPattern.exec(paramBlock)) !== null) {
        const pKey = pMatch[1];
        let pVal: any = pMatch[2].trim();
        try { pVal = JSON.parse(pVal); } catch { /* raw string */ }
        params[pKey] = pVal;
      }
      rescuedTools.push({
        id: `rescued-xml-${round}-${rescuedTools.length + 1}-${canonicalName}`,
        tool: canonicalName,
        params: normalizeToolParams(canonicalName, params),
        requiresApproval: false,
        status: 'pending',
        timestamp: Date.now(),
      });
    } else {
      const parsed = healMalformedJson(rawPayload);
      const rawName = parsed.name || parsed.tool || parsed.function?.name;
      if (rawName && typeof rawName === 'string') {
        const canonicalName = TOOL_NAME_ALIASES[rawName] || rawName;
        const rawParams = parsed.arguments || parsed.params || parsed.function?.arguments || parsed.parameters || parsed;
        const healedParams = typeof rawParams === 'string' ? healMalformedJson(rawParams) : rawParams;
        rescuedTools.push({
          id: `rescued-xml-${round}-${rescuedTools.length + 1}-${canonicalName}`,
          tool: canonicalName,
          params: normalizeToolParams(canonicalName, healedParams),
          requiresApproval: false,
          status: 'pending',
          timestamp: Date.now(),
        });
      }
    }
  }
  if (rescuedTools.length > 0) {
    workingText = workingText.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
  }

  // 3. Dialect B: Llama / Groq function tags <function=NAME>{...}</function> or <function=NAME><parameter=...>
  const funcTagRegex = /<function=([a-zA-Z0-9_.-]+)>?([\s\S]*?)<\/function>/gi;
  let funcMatch;
  let foundFunc = false;
  while ((funcMatch = funcTagRegex.exec(workingText)) !== null) {
    foundFunc = true;
    const rawName = funcMatch[1];
    const rawBody = funcMatch[2];
    const canonicalName = TOOL_NAME_ALIASES[rawName] || rawName;

    // Check if rawBody contains XML parameter tags
    if (rawBody.includes('<parameter=')) {
      const params: Record<string, any> = {};
      const paramPattern = /<parameter=([a-zA-Z0-9_]+)>([\s\S]*?)<\/parameter>/gi;
      let pMatch;
      while ((pMatch = paramPattern.exec(rawBody)) !== null) {
        const pKey = pMatch[1];
        let pVal: any = pMatch[2].trim();
        try { pVal = JSON.parse(pVal); } catch {}
        params[pKey] = pVal;
      }
      rescuedTools.push({
        id: `rescued-fn-${round}-${rescuedTools.length + 1}-${canonicalName}`,
        tool: canonicalName,
        params: normalizeToolParams(canonicalName, params),
        requiresApproval: false,
        status: 'pending',
        timestamp: Date.now(),
      });
    } else {
      const healedParams = healMalformedJson(rawBody);
      rescuedTools.push({
        id: `rescued-fn-${round}-${rescuedTools.length + 1}-${canonicalName}`,
        tool: canonicalName,
        params: normalizeToolParams(canonicalName, healedParams),
        requiresApproval: false,
        status: 'pending',
        timestamp: Date.now(),
      });
    }
  }
  if (foundFunc) {
    workingText = workingText.replace(/<function=[a-zA-Z0-9_.-]+>?[\s\S]*?<\/function>/gi, '').trim();
  }

  // 4. Dialect C: DeepSeek / Kimi token sequence style
  if (workingText.includes('<|tool_call_begin|>') || workingText.includes('<|tool_calls_section_begin|>')) {
    const tokenCallRegex = /<\|tool_call_begin\|>(?:functions\.)?([a-zA-Z0-9_.-]+)(?::0)?[\s\S]*?<\|tool_call_argument_begin\|>([\s\S]*?)(?:<\|tool_call_end\|>|$)/gi;
    let tokMatch;
    while ((tokMatch = tokenCallRegex.exec(workingText)) !== null) {
      const rawName = tokMatch[1];
      const rawArgs = tokMatch[2];
      const canonicalName = TOOL_NAME_ALIASES[rawName] || rawName;
      const healedParams = healMalformedJson(rawArgs);
      rescuedTools.push({
        id: `rescued-tok-${round}-${rescuedTools.length + 1}-${canonicalName}`,
        tool: canonicalName,
        params: normalizeToolParams(canonicalName, healedParams),
        requiresApproval: false,
        status: 'pending',
        timestamp: Date.now(),
      });
    }
    workingText = workingText
      .replace(/<\|tool_calls_section_begin\|>[\s\S]*?(?:<\|tool_calls_section_end\|>|$)/gi, '')
      .replace(/<\|tool_call_begin\|>[\s\S]*?(?:<\|tool_call_end\|>|$)/gi, '')
      .trim();
  }

  // 5. Dialect D: Bare JSON tool call objects embedded in markdown ```json blocks
  if (rescuedTools.length === 0 && workingText.includes('```json')) {
    const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/gi;
    let jBlockMatch;
    while ((jBlockMatch = jsonBlockRegex.exec(workingText)) !== null) {
      const parsed = healMalformedJson(jBlockMatch[1]);
      const rawName = parsed.name || parsed.tool || parsed.function_name;
      if (rawName && typeof rawName === 'string' && TOOL_NAME_ALIASES[rawName]) {
        const canonicalName = TOOL_NAME_ALIASES[rawName];
        const rawParams = parsed.arguments || parsed.params || parsed.parameters || parsed;
        const healedParams = typeof rawParams === 'string' ? healMalformedJson(rawParams) : rawParams;
        rescuedTools.push({
          id: `rescued-jsonblock-${round}-${rescuedTools.length + 1}-${canonicalName}`,
          tool: canonicalName,
          params: normalizeToolParams(canonicalName, healedParams),
          requiresApproval: false,
          status: 'pending',
          timestamp: Date.now(),
        });
      }
    }
    if (rescuedTools.length > 0) {
      workingText = workingText.replace(/```json\s*\{[\s\S]*?\}\s*```/gi, '').trim();
    }
  }

  // 6. Dialect E: Pythonic function call invocations (e.g. write_file(path="...", content="..."))
  if (rescuedTools.length === 0) {
    const pythonicRegex = /(?:<!--\s*TOOL_CODE_START\s*-->|```(?:python|tool_code|tools)?\s*)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)(?:\s*<!--\s*TOOL_CODE_END\s*-->|\s*```)?/g;
    let pyMatch;
    while ((pyMatch = pythonicRegex.exec(workingText)) !== null) {
      const fnName = pyMatch[1];
      if (TOOL_NAME_ALIASES[fnName] && !['if', 'for', 'while', 'print', 'await', 'function', 'class', 'const', 'let', 'var'].includes(fnName)) {
        const canonicalName = TOOL_NAME_ALIASES[fnName];
        const rawArgs = pyMatch[2];
        const healedParams = healMalformedJson(rawArgs);
        rescuedTools.push({
          id: `rescued-py-${round}-${rescuedTools.length + 1}-${canonicalName}`,
          tool: canonicalName,
          params: normalizeToolParams(canonicalName, healedParams),
          requiresApproval: false,
          status: 'pending',
          timestamp: Date.now(),
        });
      }
    }
    if (rescuedTools.length > 0) {
      workingText = workingText
        .replace(/<!--\s*TOOL_CODE_START\s*-->[\s\S]*?<!--\s*TOOL_CODE_END\s*-->/gi, '')
        .replace(/```(?:python|tool_code|tools)?\s*[a-zA-Z0-9_]+\s*\([\s\S]*?\)\s*```/gi, '')
        .trim();
    }
  }

  // 7. Dialect F: XML <invoke name="..."> <parameter name="..."> ... </invoke>
  if (rescuedTools.length === 0 && (workingText.includes('<invoke') || workingText.includes('<tool>'))) {
    const invokeRegex = /<invoke\s+name=["']([a-zA-Z0-9_.-]+)["']>([\s\S]*?)<\/invoke>/gi;
    let invMatch;
    while ((invMatch = invokeRegex.exec(workingText)) !== null) {
      const rawName = invMatch[1];
      const canonicalName = TOOL_NAME_ALIASES[rawName] || rawName;
      const paramBody = invMatch[2];
      const params: Record<string, any> = {};
      const paramRegex = /<parameter\s+name=["']([a-zA-Z0-9_.-]+)["']>([\s\S]*?)<\/parameter>/gi;
      let pMatch;
      while ((pMatch = paramRegex.exec(paramBody)) !== null) {
        params[pMatch[1]] = pMatch[2].trim();
      }
      rescuedTools.push({
        id: `rescued-inv-${round}-${rescuedTools.length + 1}-${canonicalName}`,
        tool: canonicalName,
        params: normalizeToolParams(canonicalName, params),
        requiresApproval: false,
        status: 'pending',
        timestamp: Date.now(),
      });
    }
    if (rescuedTools.length > 0) {
      workingText = workingText.replace(/<invoke\s+name=["'][^"']+["']>[\s\S]*?<\/invoke>/gi, '').trim();
    }
  }

  // 8. Dialect G: Sarvam / Hermes <arg_key>...</arg_key><arg_value>...</arg_value>
  if (workingText.includes('<arg_key>') || workingText.includes('<arg_key')) {
    const argBlockRegex = /(?:<tool_call>)?\s*([a-zA-Z0-9_.-]+)\s*\n?\s*(<arg_key[\s\S]*?)(?:<\/tool_call>|(?=\n[a-zA-Z0-9_.-]+\s*\n?<arg_key)|$)/gi;
    let argMatch;
    while ((argMatch = argBlockRegex.exec(workingText)) !== null) {
      const rawName = argMatch[1].trim();
      const canonicalName = TOOL_NAME_ALIASES[rawName] || rawName;
      if (TOOL_NAME_ALIASES[rawName] || ['write_file', 'edit_file', 'read_file', 'write_todos', 'run_command', 'grep_search', 'list_directory', 'typecheck_project'].includes(rawName)) {
        const body = argMatch[2];
        const params: Record<string, any> = {};
        const pairRegex = /<arg_key>([a-zA-Z0-9_.-]+)<\/arg_key>\s*<arg_value>([\s\S]*?)(?:<\/arg_value>|(?=<arg_key>)|$)/gi;
        let pMatch;
        while ((pMatch = pairRegex.exec(body)) !== null) {
          const key = pMatch[1].trim();
          let valStr = pMatch[2].trim();
          let val: any = valStr;
          try {
            val = JSON.parse(valStr);
          } catch {
            if (valStr.startsWith('[') || valStr.startsWith('{')) {
              val = healMalformedJson(valStr);
              if (Object.keys(val).length === 0 && valStr.startsWith('[')) {
                try { val = JSON.parse(valStr + ']'); } catch {}
                try { val = JSON.parse(valStr + '"}]'); } catch {}
              }
            }
          }
          params[key] = val;
        }
        rescuedTools.push({
          id: `rescued-arg-${round}-${rescuedTools.length + 1}-${canonicalName}`,
          tool: canonicalName,
          params: normalizeToolParams(canonicalName, params),
          requiresApproval: false,
          status: 'pending',
          timestamp: Date.now(),
        });
      }
    }
    if (rescuedTools.length > 0) {
      workingText = workingText
        .replace(/(?:<tool_call>)?\s*[a-zA-Z0-9_.-]+\s*\n?\s*<arg_key[\s\S]*?(?:<\/tool_call>|$)/gi, '')
        .trim();
    }
  }

  return {
    hasRescuedTools: rescuedTools.length > 0,
    rescuedTools,
    cleanText: workingText,
    reasoningText,
  };
}

/**
 * Detects whether an in-flight text stream contains or ends with the start of a tool call dialect.
 * Used by the streaming tool guard to buffer tokens and prevent raw XML/JSON from bleeding to chat.
 */
export function isPotentialToolCallSyntax(text: string): boolean {
  if (!text) return false;

  // Explicit tool call tags
  if (/<tool_call/i.test(text)) return true;
  if (/<function=/i.test(text)) return true;
  if (/<invoke\s+name=/i.test(text)) return true;
  if (/<\|tool_call/i.test(text)) return true;
  if (/<!--\s*TOOL_CODE_START/i.test(text)) return true;

  // Sarvam / Hermes <arg_key> and <arg_value> tags
  if (/<arg_key/i.test(text)) return true;
  if (/<arg_value/i.test(text)) return true;
  if (/(?:write_todos|write_file|edit_file|read_file|list_directory|run_command|grep_search)\s*\n?\s*<arg_/i.test(text)) return true;

  // Partial tag beginnings near the tail of the buffer (e.g. "<tool_", "<func", "<|tool", "<arg_")
  const tail = text.slice(-40);
  if (/<(?:tool_call|tool_|function|invoke|arg_key|arg_value|arg_|!--\s*TOOL_CODE)/i.test(tail)) return true;
  if (/<\|(?:tool_call|tool_calls)/i.test(tail)) return true;

  // Markdown code block with JSON tool definition
  if (/```json\s*\{[\s\S]*?"(?:name|tool|function|action)"/i.test(text)) return true;
  if (/```(?:json)?\s*\{?\s*$/i.test(tail)) return true;

  // Pythonic / pseudo-code tool calls (e.g. write_file(...))
  if (/(?:write_file|edit_file|read_file|list_directory|run_command|create_directory|write_todos)\s*\(/i.test(text)) return true;

  return false;
}

/**
 * Strips all residual tool call markers and syntax from conversational text.
 */
export function stripAllToolDialects(text: string): string {
  if (!text) return '';
  return text
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '')
    .replace(/<function=[a-zA-Z0-9_.-]+>?[\s\S]*?(?:<\/function>|$)/gi, '')
    .replace(/<invoke\s+name=["'][^"']+["']>[\s\S]*?(?:<\/invoke>|$)/gi, '')
    .replace(/(?:^|\n)\s*[a-zA-Z0-9_.-]+\s*\n?\s*<arg_key[\s\S]*?(?:<\/arg_value>|<\/tool_call>|$)/gi, '')
    .replace(/<arg_key>[\s\S]*?(?:<\/arg_key>|$)/gi, '')
    .replace(/<arg_value>[\s\S]*?(?:<\/arg_value>|$)/gi, '')
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?(?:<\|tool_calls_section_end\|>|$)/gi, '')
    .replace(/<\|tool_call_begin\|>[\s\S]*?(?:<\|tool_call_end\|>|$)/gi, '')
    .replace(/<!--\s*TOOL_CODE_START\s*-->[\s\S]*?(?:<!--\s*TOOL_CODE_END\s*-->|$)/gi, '')
    .trim();
}
