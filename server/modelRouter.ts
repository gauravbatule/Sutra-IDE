import db from './db.js';
import { ModelDefinition, CustomProviderConfig, AIProviderId, SutraModel } from './types.js';
import { providerAuthHandler } from './providers/authHandler.js';
import { chatgptWebProvider, CHATGPT_WEB_FALLBACK_MODEL_IDS } from './providers/chatgptWebProvider.js';
import {
  hasLocalAntigravitySignIn,
  streamAntigravityTurn,
  ANTIGRAVITY_CANONICAL_MODELS_LIST,
} from './providers/antigravityBridge.js';
import { customModelsManager } from './customModels.js';
import { detectModelTier, ModelCapabilityTier } from './harness/agentPromptArchitecture.js';
import { resilientFetch } from './tlsFetch.js';

/** Antigravity family — rides the local Google sign-in instead of pasted keys. */
const isAntigravityProvider = (provider: string): boolean =>
  provider === 'antigravity' || provider === 'antigravity-ide';

/**
 * Providers that can serve a request with NO API key.
 *
 * These are the only providers surfaced by default. Everything else needs a
 * credential, and a credential-less provider used to still advertise its
 * hand-written model list — that is how the picker filled up with "ghost
 * models" that errored the instant they were selected.
 *
 *  - antigravity / antigravity-ide : local Google sign-in (OAuth token on disk)
 *  - ollama / lmstudio / localai / jan-ai : local runtimes on localhost
 *  - pollinations : public free tier, no credential of any kind
 *
 * A key-requiring provider is still fully supported — it simply only appears
 * once the user has actually configured a key for it in Settings.
 */
export const KEYLESS_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'antigravity',
  'antigravity-ide',
  'antigravity-web',
  'ollama',
  'lmstudio',
  'localai',
  'jan-ai',
  'pollinations',
  'custom',
]);

/** True when `provider` can serve a request without the user pasting an API key. */
export const isKeylessProvider = (provider: unknown): boolean =>
  KEYLESS_PROVIDER_IDS.has(String(provider ?? '').trim());

/**
 * Family-aware context-window estimates for models discovered at runtime
 * (local runtimes, per-key catalogs) where the source does not report a real
 * window. Ordered most-specific-first; first match wins. Values are INPUT-side
 * capacities — understating is safe (compaction fires early), overstating
 * overflows the model and kills runs.
 * NOTE: never default to a tiny window (e.g. 8k) — that prematurely truncates
 * agent history and stalls long tasks.
 */
const CONTEXT_FAMILY_RULES: Array<{ test: RegExp; window: number }> = [
  // Google Gemini
  { test: /gemini-(1\.5-pro|2\.\d-pro|2\.5-pro)/, window: 2097152 },
  { test: /gemini-(1\.5|2\.\d|3(\.\d+)?)|(pro|flash|lite)/, window: 1048576 },
  // OpenAI
  { test: /gpt-5/, window: 272000 },
  { test: /gpt-4\.1/, window: 1048576 },
  { test: /^o[134](-|$)|o[134]-mini/, window: 200000 },
  { test: /gpt-4o/, window: 128000 },
  { test: /gpt-4(-|$|\.)?turbo/, window: 128000 },
  { test: /gpt-3\.5/, window: 16385 },
  // Anthropic
  { test: /claude/, window: 200000 },
  // Meta Llama (native, pre-YaRN)
  { test: /llama-?4/, window: 1048576 },
  { test: /llama-?3\.[123]|llama3\.[123]/, window: 131072 },
  { test: /(llama-?3|llama3)/, window: 131072 },
  { test: /codellama/, window: 16384 },
  // Qwen (native 128k context)
  { test: /qwen[23]?\.?5?-?(coder)?-?(next)?/i, window: 131072 },
  // DeepSeek
  { test: /deepseek/, window: 131072 },
  // Mistral
  { test: /mixtral-?8x22b/, window: 65536 },
  { test: /mixtral/, window: 32768 },
  { test: /mistral-(small|large|medium|nemo)/, window: 131072 },
  { test: /^(mistral|ministral|magistral)/, window: 32768 },
  // Others
  { test: /grok-[34]/, window: 256000 },
  { test: /grok/, window: 131072 },
  { test: /glm-?4\.?6/, window: 204800 },
  { test: /glm/, window: 131072 },
  { test: /command-r/, window: 131072 },
  { test: /gemma-?[23]|^gemma[23]/, window: 131072 },
  { test: /gemma/, window: 8192 },
  { test: /phi-4/, window: 16384 },
  { test: /phi-3/, window: 131072 },
];

/**
 * Best-known input-side context window for a discovered model id. Falls back
 * to a generous 131072 for unknown families rather than a small value —
 * an underestimated window degrades long agent runs gracefully via compaction,
 * while an overestimated one hard-fails at the provider.
 */
export const estimateContextWindow = (modelId: string, fallback: number = 131072): number => {
  const id = String(modelId).toLowerCase();
  for (const rule of CONTEXT_FAMILY_RULES) {
    if (rule.test.test(id)) return rule.window;
  }
  return fallback;
};

/**
 * Widens dynamic provider ids (e.g. 'zhipu', 'xai', 'qwen', 'chatgpt-web', 'antigravity',
 * 'cerebras', 'moonshot') beyond the static AIProviderId union so catalogs and credentials
 * saved under new provider rows route correctly without a types.ts change.
 */
const toProviderId = (provider: string): AIProviderId => provider as AIProviderId;

/**
 * Default base URL for every OpenAI-compatible provider known to the router.
 * Resolution order in streamChat: cred.baseUrl || PROVIDER_BASE_URLS[provider] || graceful skip.
 * NEVER falls back to api.openai.com for non-OpenAI providers (prevents cross-provider key leakage).
 */
export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  github: 'https://models.inference.ai.azure.com',
  ollama: 'http://localhost:11434/v1',
  pollinations: 'https://text.pollinations.ai',
  zhipu: 'https://api.z.ai/api/paas/v4',
  glm: 'https://api.z.ai/api/paas/v4',
  xai: 'https://api.x.ai/v1',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  hyperbolic: 'https://api.hyperbolic.xyz/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  novita: 'https://api.novita.ai/v3/openai',
  lepton: 'https://api.lepton.run/api/v1',
  nebius: 'https://api.studio.nebius.ai/v1',
  scaleway: 'https://api.scaleway.ai/v1',
  ovhcloud: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
  baseten: 'https://inference.baseten.co/v1',
  featherless: 'https://api.featherless.ai/v1',
  siliconflow: 'https://api.siliconflow.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  minimax: 'https://api.minimax.chat/v1',
  baichuan: 'https://api.baichuan-ai.com/v1',
  'yi-01ai': 'https://api.lingyiwanwu.com/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  sarvam: 'https://api.sarvam.ai/v1',
  upstage: 'https://api.upstage.ai/v1/solar',
  mistral: 'https://api.mistral.ai/v1',
  cohere: 'https://api.cohere.ai/compatibility/v1',
  ai21: 'https://api.ai21.com/studio/v1',
  perplexity: 'https://api.perplexity.ai',
  litellm: 'http://localhost:4000/v1',
  vllm: 'http://localhost:8000/v1',
  localai: 'http://localhost:8080/v1',
  'jan-ai': 'http://localhost:1337/v1',
  lmstudio: 'http://localhost:1234/v1',
  'nvidia-nim': 'https://integrate.api.nvidia.com/v1',
  bai: 'https://api.b.ai/v1',
  anyapi: 'https://api.anyapi.io/v1',
  kilo: 'https://api.kilo.ai/v1',
  llm7: 'https://api.llm7.io/v1',
  huggingface: 'https://router.huggingface.co/v1',
  opencode: 'https://api.opencode.ai/v1',
  agnes: 'https://api.agnes-ai.com/v1',
  reka: 'https://api.reka.ai/v1',
  routeway: 'https://api.routeway.ai/v1',
  custom: 'http://localhost:11434/v1',
  gateway: 'http://localhost:8080/v1',
  bazaarlink: 'https://api.bazaarlink.ai/v1',
  ainative: 'https://api.ainative.studio/v1',
  aion: 'https://api.aionlabs.ai/v1',
  requesty: 'https://router.requesty.ai/v1',
  navy: 'https://api.navy.ai/v1',
  nara: 'https://router.bynara.id/v1',
  sealion: 'https://api.sea-lion.ai/v1',
  orcarouter: 'https://api.orcarouter.ai/v1',
  unorouter: 'https://api.unorouter.com/v1',
  xkiro: 'https://api.xkiro.com/v1',
  modelscope: 'https://api-inference.modelscope.cn/v1',
};

/**
 * Flagship default chat model per dynamic provider (used when no catalog entry exists yet).
 * Kept current for August 2026; users can always pin an explicit model id.
 */
const PROVIDER_DEFAULT_MODEL_IDS: Record<string, string> = {
  groq: 'openai/gpt-oss-120b',
  google: 'gemini-3.7-flash',
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-sol',
  deepseek: 'deepseek-v4-pro',
  openrouter: 'anthropic/claude-sonnet-5',
  github: 'gpt-4.1',
  ollama: 'qwen2.5-coder',
  pollinations: 'openai',
  zhipu: 'glm-4.6',
  glm: 'glm-4.6',
  'glm-web': 'glm-4.6',
  xai: 'grok-4.6',
  qwen: 'qwen3-coder-plus',
  'chatgpt-web': 'luna',
  antigravity: 'gemini-3.7-flash',
  'antigravity-ide': 'gemini-3.7-flash',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  fireworks: 'accounts/fireworks/models/deepseek-v3',
  cerebras: 'llama-3.3-70b',
  sambanova: 'Meta-Llama-3.3-70B-Instruct',
  hyperbolic: 'meta-llama/Llama-3.3-70B-Instruct',
  deepinfra: 'meta-llama/Llama-3.3-70B-Instruct',
  novita: 'meta-llama/llama-3.3-70b-instruct',
  lepton: 'llama-3.3-70b',
  nebius: 'meta-llama/Llama-3.3-70B-Instruct',
  scaleway: 'llama-3.3-70b-instruct',
  ovhcloud: 'llama-3.3-70b-instruct',
  baseten: 'meta-llama/Llama-3.3-70B',
  featherless: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
  siliconflow: 'deepseek-ai/DeepSeek-V3',
  moonshot: 'kimi-k2',
  minimax: 'MiniMax-Text-01',
  baichuan: 'baichuan4',
  'yi-01ai': 'yi-lightning',
  doubao: 'doubao-1.5-pro-32k',
  hunyuan: 'hunyuan-turbos-latest',
  sarvam: 'sarvam-105b',
  upstage: 'solar-pro',
  mistral: 'mistral-large-latest',
  cohere: 'command-a-03-2025',
  ai21: 'jamba-large-1.6',
  perplexity: 'sonar-pro',
  litellm: 'gpt-4o-mini',
  vllm: 'meta-llama/Llama-3.3-70B-Instruct',
  localai: 'gpt-4',
  'jan-ai': 'llama3.2-3b-instruct',
  lmstudio: 'qwen2.5-coder',
  'nvidia-nim': 'meta/llama-3.3-70b-instruct',
  bai: 'b-ai-general',
  anyapi: 'gpt-4o-mini',
  kilo: 'kilo-default',
  llm7: 'llm7-free',
  huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
  opencode: 'opencode-zen',
  ovh: 'meta-llama/Meta-Llama-3-8B-Instruct',
  agnes: 'agnes-general',
  reka: 'reka-flash',
  routeway: 'meta-llama/llama-3.3-70b-instruct:free',
  bazaarlink: 'auto:free',
  ainative: 'ainative-general',
  aion: 'aion-free',
  requesty: 'meta-llama/llama-3.3-70b-instruct',
  navy: 'navy-general',
  nara: 'nara-free',
  sealion: 'sea-lion-7b-instruct',
  orcarouter: 'auto:free',
  unorouter: 'meta-llama/llama-3.3-70b-instruct:free',
  xkiro: 'xkiro-free',
  modelscope: 'qwen/Qwen2.5-Coder-32B-Instruct',
};

/** Provider-neutral tools exposed to every tool-capable model (45+ Comprehensive Capabilities) */
export const SUTRA_TOOLS = [
  // 1. Filesystem & Code Surgery (14 Tools)
  { name: 'read_file', description: 'Read a UTF-8 file from the workspace.', input_schema: { type: 'object', properties: { path: { type: 'string' }, lineRange: { type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' } } } }, required: ['path'] } },
  { name: 'write_file', description: 'Create or overwrite a workspace file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Replace a precise string in a workspace file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, target: { type: 'string' }, replacement: { type: 'string' } }, required: ['path', 'target', 'replacement'] } },
  { name: 'delete_file', description: 'Delete a file or directory in the workspace.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'create_directory', description: 'Create a directory in the workspace.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'rename_path', description: 'Rename or move a file/directory.', input_schema: { type: 'object', properties: { oldPath: { type: 'string' }, newPath: { type: 'string' } }, required: ['oldPath', 'newPath'] } },
  { name: 'list_directory', description: 'List workspace files and directories.', input_schema: { type: 'object', properties: { path: { type: 'string' }, recursive: { type: 'boolean' } }, required: ['path'] } },
  { name: 'grep_search', description: 'Search workspace file contents for regex or text.', input_schema: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'] } },
  { name: 'codebase_search', description: 'Semantic code search that finds code by meaning, natural language intent, and concept questions across the workspace (Cursor-Grade Parity).', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Natural language search query, e.g. "Where is authentication handled?" or "Where are routes defined?"' }, limit: { type: 'number', description: 'Maximum number of results to return (default 10)' } }, required: ['query'] } },
  { name: 'ast_grep', description: 'Search code files by AST structure or pattern.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, language: { type: 'string' } }, required: ['pattern'] } },
  { name: 'format_code', description: 'Auto-format source code file with Prettier/linter.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'lint_code', description: 'Run linter on a file or entire project.', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'typecheck_project', description: 'Run TypeScript compiler typecheck across the project.', input_schema: { type: 'object', properties: {} } },
  { name: 'find_dead_code', description: 'Analyze project to find unused files and exported symbols.', input_schema: { type: 'object', properties: {} } },
  { name: 'count_loc', description: 'Count total lines of code grouped by language and file extension.', input_schema: { type: 'object', properties: {} } },
  { name: 'create_scratch_workspace', description: 'Create an isolated scratchpad project workspace inspired by Antigravity .scratch architecture. Auto-generates a clean workspace folder, initializes starter files, and sets the active workspace context so new applications can be created safely without polluting other projects.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Optional project name or slug (e.g. "weather-dashboard", "chess-engine")' }, template: { type: 'string', enum: ['web', 'react', 'node', 'python', 'empty'], description: 'Starter template' }, description: { type: 'string', description: 'Brief description of what is being built' } } } },
  { name: 'list_scratch_workspaces', description: 'List all existing scratchpad workspaces created with the .scratch system, including path, metadata, and timestamps.', input_schema: { type: 'object', properties: {} } },
  { name: 'promote_scratch_workspace', description: 'Promote/export an active or saved scratch workspace into a permanent user folder on disk.', input_schema: { type: 'object', properties: { scratchPath: { type: 'string', description: 'Path to the scratchpad workspace to promote' }, destinationDir: { type: 'string', description: 'Target destination path on disk' } }, required: ['scratchPath', 'destinationDir'] } },

  // 2. Terminal & Shell Execution (6 Tools)
  { name: 'run_command', description: 'Run a shell command within the workspace. Long installs/builds/tests get extended wait budgets; dev servers and watchers are auto-promoted to the background registry. Pass background:true to spawn without blocking.', input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, background: { type: 'boolean', description: 'Spawn without blocking; returns { taskId, started, cmd }. Poll with check_task_output.' } }, required: ['command'] } },
  { name: 'check_task_output', description: 'Poll a background task started via run_command background:true (or auto-promoted server/watcher). Returns running, exitCode when done, last ~4KB of output, durationMs; wait_ms waits up to 30s for completion first.', input_schema: { type: 'object', properties: { taskId: { type: 'string' }, wait_ms: { type: 'number' } }, required: ['taskId'] } },
  { name: 'kill_task', description: 'Terminate a background task by its taskId (registry ids only — can never reach unrelated OS processes).', input_schema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] } },
  { name: 'read_tool_output', description: 'Read a stored large tool output in pages. Use this when an earlier tool result came back truncated with an outputRef instead of full text.', input_schema: { type: 'object', properties: { outputRef: { type: 'string', description: 'The outputRef returned by the truncated tool result.' }, offset: { type: 'number', description: 'Character offset to resume from; omit for the first page.' } }, required: ['outputRef'] } },
  { name: 'kill_all_tasks', description: 'Stop every background task started this session (dev servers, watchers, long installs). Use when the user asks to stop running tasks, or before ending a run that started servers it should not leave behind.', input_schema: { type: 'object', properties: {} } },
  { name: 'run_background_process', description: 'Spawn a long-running background dev server or worker.', input_schema: { type: 'object', properties: { command: { type: 'string' }, name: { type: 'string' } }, required: ['command'] } },
  { name: 'kill_process', description: 'Terminate a running background process by name or PID.', input_schema: { type: 'object', properties: { processId: { type: 'string' } }, required: ['processId'] } },
  { name: 'list_running_processes', description: 'List all active background processes managed by the IDE.', input_schema: { type: 'object', properties: {} } },
  { name: 'inspect_port', description: 'Check if a network port is open or in use by another process, and identify the owning PID & process name.', input_schema: { type: 'object', properties: { port: { type: 'number' } }, required: ['port'] } },
  { name: 'free_port', description: 'Terminate the process occupying a specific TCP port so a dev server can bind to it without EADDRINUSE conflict.', input_schema: { type: 'object', properties: { port: { type: 'number', description: 'Port number to free (e.g. 3000, 5173, 8000)' } }, required: ['port'] } },
  { name: 'verify_http_server', description: 'Probe a local or remote HTTP server port to verify that the server is alive and returning HTTP 200 OK before telling the user it is running.', input_schema: { type: 'object', properties: { port: { type: 'number', description: 'Port number to probe (e.g. 3000, 4000, 5173, 8080)' }, path: { type: 'string', description: 'Optional request path, defaults to "/"' }, timeoutMs: { type: 'number', description: 'Timeout in milliseconds, defaults to 4000' } }, required: ['port'] } },
  { name: 'inspect_web_page', description: 'Built-in headless DOM & browser inspector to analyze local or remote web pages, verify HTML structure, canvas elements, scripts, buttons, forms, and catch client-side errors before concluding.', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'URL to inspect (e.g. http://localhost:5173, http://127.0.0.1:8080)' }, timeoutMs: { type: 'number', description: 'Timeout in ms, defaults to 5000' } }, required: ['url'] } },
  { name: 'formulate_hypothesis', description: 'Formulate an explicit hypothesis before making code variations (NVIDIA AVO hypothesis-driven development).', input_schema: { type: 'object', properties: { strategy: { type: 'string', description: 'Proposed strategy or architectural variation' }, expectedOutcome: { type: 'string', description: 'Measurable improvement or verification signal' }, falsificationCondition: { type: 'string', description: 'Concrete failure criteria that proves this hypothesis wrong' }, hardwareTarget: { type: 'string', description: 'Optional hardware target (e.g. cpu-latency, memory-alloc, dom-render)' } }, required: ['strategy', 'expectedOutcome', 'falsificationCondition'] } },
  { name: 'evaluate_hardware_loop', description: 'Sample and evaluate physical hardware telemetry (CPU time, RSS, heap allocation delta) to ground code changes in real compute targets.', input_schema: { type: 'object', properties: {} } },
  { name: 'discover_environment_rules', description: 'Analyze runtime errors or terminal failures to deduce unstated environment rules and invariants.', input_schema: { type: 'object', properties: { errorText: { type: 'string', description: 'Raw error output, stack trace, or compiler diagnostic' } }, required: ['errorText'] } },
  { name: 'commit_best_variation', description: 'Select and commit the Pareto-optimal candidate version to a Git checkpoint.', input_schema: { type: 'object', properties: {} } },
  { name: 'bench_http_endpoint', description: 'Benchmark HTTP API latency and throughput.', input_schema: { type: 'object', properties: { url: { type: 'string' }, requests: { type: 'number' } }, required: ['url'] } },

  // 3. Pro Mode & Long-Horizon Loop State APIs (9 Tools)
  { name: 'get_file_tree', description: 'Read structured workspace file tree with typed file counts and snapshot ID (Phase 1 INSPECT).', input_schema: { type: 'object', properties: { subDir: { type: 'string', description: 'Optional subdirectory path to inspect' }, maxDepth: { type: 'number', description: 'Max directory traversal depth (default 3)' } } } },
  { name: 'get_diff', description: 'Inspect exact line-by-line diff of pending workspace changes with insertion/deletion counts (Phase 1 INSPECT).', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Optional specific file path filter' }, staged: { type: 'boolean', description: 'Inspect staged changes only (default false)' } } } },
  { name: 'get_test_status', description: 'Inspect recent test execution results and failure records with status ID (Phase 1 INSPECT).', input_schema: { type: 'object', properties: {} } },
  { name: 'get_build_status', description: 'Inspect typecheck and build status with error breakdowns and status ID (Phase 1 INSPECT).', input_schema: { type: 'object', properties: {} } },
  { name: 'run_tests', description: 'Run workspace unit tests and return structured typed results with pass/fail counts and failures array (Phase 5 EXECUTE).', input_schema: { type: 'object', properties: { testPath: { type: 'string', description: 'Optional specific test file path to run' } } } },
  { name: 'check_types', description: 'Run TypeScript compiler typecheck and return structured errors array and count (Phase 5 EXECUTE).', input_schema: { type: 'object', properties: {} } },
  { name: 'run_build', description: 'Run workspace build command and return structured typed build results (Phase 5 EXECUTE).', input_schema: { type: 'object', properties: {} } },
  { name: 'checkpoint_loop_iteration', description: 'Record a 7-phase loop iteration outcome to persistent memory ({ taskId, iteration, phase, hypothesis, action, result, status, tags }) (Phase 7 CHECKPOINT).', input_schema: { type: 'object', properties: { taskId: { type: 'string', description: 'Unique task or session identifier' }, iteration: { type: 'number', description: 'Iteration sequence number (1-indexed)' }, phase: { type: 'string', enum: ['INSPECT', 'HYPOTHESIZE', 'PLAN', 'ACT', 'EXECUTE', 'INTERPRET', 'CHECKPOINT', 'ESCALATE'], description: 'Current loop phase' }, hypothesis: { type: 'string', description: 'Falsifiable hypothesis stated for this iteration' }, action: { type: 'string', description: 'Action executed during this iteration' }, result: { type: 'object', properties: { passed: { type: 'boolean' }, summary: { type: 'string' } }, required: ['passed', 'summary'], description: 'Structured execution outcome' }, status: { type: 'string', enum: ['confirmed', 'refuted', 'inconclusive', 'escalated', 'completed'], description: 'Verification interpretation status' }, tags: { type: 'array', items: { type: 'string' }, description: 'Optional categorization tags' } }, required: ['taskId', 'iteration', 'hypothesis', 'action', 'result', 'status'] } },
  { name: 'get_loop_checkpoints', description: 'Retrieve historical iteration records and supervisor escalation assessments for a task.', input_schema: { type: 'object', properties: { taskId: { type: 'string', description: 'Task ID to query checkpoints for' } }, required: ['taskId'] } },

  // 3. Git & Version Control (8 Tools)
  { name: 'git_status', description: 'Check current git branch, untracked files, and modified files.', input_schema: { type: 'object', properties: {} } },
  { name: 'git_diff', description: 'Inspect exact line-by-line diff of pending workspace changes.', input_schema: { type: 'object', properties: { path: { type: 'string' }, staged: { type: 'boolean' } } } },
  { name: 'git_commit', description: 'Commit staged or specific workspace files with a clear message.', input_schema: { type: 'object', properties: { message: { type: 'string', description: 'Commit message.' }, files: { type: 'array', items: { type: 'string' }, description: 'Optional list of specific file paths to stage and commit.' } }, required: ['message'] } },
  { name: 'git_branch', description: 'List, create, or delete git branches.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'create', 'delete'] }, branchName: { type: 'string' } }, required: ['action'] } },
  { name: 'git_checkout', description: 'Switch branch or restore a file.', input_schema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] } },
  { name: 'git_stash', description: 'Stash or pop uncommitted changes.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['push', 'pop', 'list'] } }, required: ['action'] } },
  { name: 'git_log', description: 'View recent commit history.', input_schema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'git_cherry_pick', description: 'Apply a specific commit hash to the current branch.', input_schema: { type: 'object', properties: { commitHash: { type: 'string' } }, required: ['commitHash'] } },

  // 4. Web & Network Intelligence (6 Tools)
  { name: 'search_web', description: 'Search the web for up-to-date documentation, solutions, or packages.', input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'scrape_url', description: 'Scrape and extract clean text from a web URL.', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'fetch_json_api', description: 'Send an HTTP request to any REST or GraphQL endpoint.', input_schema: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, headers: { type: 'object' }, body: { type: 'object' } }, required: ['url'] } },
  { name: 'ping_host', description: 'Check latency and connectivity to a remote host.', input_schema: { type: 'object', properties: { host: { type: 'string' } }, required: ['host'] } },
  { name: 'dns_lookup', description: 'Resolve DNS A, AAAA, and CNAME records for a domain.', input_schema: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'] } },
  { name: 'download_file', description: 'Download a remote file into the workspace.', input_schema: { type: 'object', properties: { url: { type: 'string' }, destinationPath: { type: 'string' } }, required: ['url', 'destinationPath'] } },

  // 5. Database & Storage (4 Tools)
  { name: 'inspect_sqlite_schema', description: 'Inspect tables, columns, and foreign keys in SQLite database.', input_schema: { type: 'object', properties: { dbPath: { type: 'string' } } } },
  { name: 'query_sqlite', description: 'Execute a SQL query against local SQLite database.', input_schema: { type: 'object', properties: { sql: { type: 'string' }, dbPath: { type: 'string' } }, required: ['sql'] } },
  { name: 'export_sqlite_data', description: 'Export SQLite table data to JSON or CSV format.', input_schema: { type: 'object', properties: { table: { type: 'string' }, format: { type: 'string' } }, required: ['table'] } },
  { name: 'run_db_migration', description: 'Apply a SQL migration script to the database.', input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } },

  { name: 'generate_image_asset', description: 'Create a high-quality visual image asset in the project (supports ChatGPT Web Account via active session cookie, OpenAI DALL-E 3, Google Imagen 3, FLUX.1 Schnell, and Pollinations Multi-Engine). Auto-routes to active provider or explicit provider.', input_schema: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed visual prompt describing the subject, lighting, framing, style, and composition.' }, filename: { type: 'string', description: 'Output filename, e.g. "hero-banner.png" or "avatar.png".' }, dimensions: { type: 'string', description: 'Aspect ratio / resolution, e.g. "1024x1024" or "1792x1024".' }, provider: { type: 'string', enum: ['auto', 'chatgpt', 'dalle3', 'imagen3', 'flux', 'pollinations', 'replicate'], description: 'Image generation engine to use (default: auto, which leverages active session).' }, model: { type: 'string', description: 'Optional specific model name (e.g. "dall-e-3", "imagen-3.0-generate-002", "flux-schnell").' } }, required: ['prompt', 'filename'] } },
  { name: 'generate_video_asset', description: 'Generate and save a real video (Replicate Minimax / Pollinations). If unavailable, ask the user for a real video file instead of using any placeholder.', input_schema: { type: 'object', properties: { prompt: { type: 'string' }, filename: { type: 'string' }, model: { type: 'string' } }, required: ['prompt', 'filename'] } },
  { name: 'generate_audio_asset', description: 'Generate speech or tactile UI sound effects (Google TTS / 44.1kHz PCM Synthesizer fallback).', input_schema: { type: 'object', properties: { type: { type: 'string' }, filename: { type: 'string' }, prompt: { type: 'string' }, model: { type: 'string' }, voice: { type: 'string' } }, required: ['type', 'filename'] } },
  { name: 'generate_sound_effect', description: 'Generate a short NON-MUSICAL sound effect (UI clicks, alarms, impacts, ambience beds like rain/wind, foley). Auto-modality routing: choose this for ambience, interface sounds, and one-shot effects; choose generate_music for instrumental scores or loops; choose generate_song only when the user wants vocals and lyrics sung over music.', input_schema: { type: 'object', properties: { prompt: { type: 'string', description: "Description of the sound, e.g. 'explosion in a canyon', 'soft UI click'" }, filename: { type: 'string' }, category: { type: 'string', enum: ['explosion', 'laser', 'whoosh', 'rain', 'thunder', 'footsteps', 'heartbeat', 'alarm', 'coin', 'shatter', 'water', 'wind', 'glitch', 'bird', 'engine', 'pop'] }, durationSec: { type: 'number' } }, required: ['prompt'] } },
  { name: 'generate_music', description: 'Generate an INSTRUMENTAL music track (background score, theme, loop — no vocals). Auto-modality routing: choose this for musical mood-setting without lyrics; choose generate_sound_effect for short non-musical sounds; choose generate_song only when the user wants vocals and lyrics.', input_schema: { type: 'object', properties: { prompt: { type: 'string', description: "Style description, e.g. 'epic cinematic trailer score'" }, filename: { type: 'string' }, durationSec: { type: 'number' }, bpm: { type: 'number' }, mood: { type: 'string', enum: ['calm', 'upbeat', 'epic', 'tense', 'lofi'] }, loop: { type: 'boolean' } } } },
  { name: 'generate_song', description: 'Generate a SONG: vocals carrying the given lyrics over a generated instrumental bed. ONLY use when the user explicitly wants a sung piece with vocals/lyrics — otherwise prefer generate_music (instrumental) or generate_sound_effect (ambience/UI sounds). Note: vocals are text-to-speech narration of the lyrics, not a trained singing voice.', input_schema: { type: 'object', properties: { lyrics: { type: 'string' }, stylePrompt: { type: 'string' }, filename: { type: 'string' }, mood: { type: 'string', enum: ['calm', 'upbeat', 'epic', 'tense', 'lofi'] }, bpm: { type: 'number' } }, required: ['lyrics'] } },
  { name: 'generate_svg_asset', description: 'Generate clean scalable SVG vector code.', input_schema: { type: 'object', properties: { prompt: { type: 'string' }, filename: { type: 'string' } }, required: ['prompt', 'filename'] } },
  { name: 'extract_color_palette', description: 'Extract aesthetic color palette tokens from an image.', input_schema: { type: 'object', properties: { imagePath: { type: 'string' } }, required: ['imagePath'] } },

  // 7. Testing, Security & Quality Assurance (5 Tools)
  { name: 'run_unit_tests', description: 'Execute Vitest, Jest, or Pytest unit test suites.', input_schema: { type: 'object', properties: { testPath: { type: 'string' } } } },
  { name: 'audit_accessibility_wcag', description: 'Audit HTML or component markup for WCAG 2.2 AA accessibility.', input_schema: { type: 'object', properties: { componentPath: { type: 'string' } } } },
  { name: 'audit_performance_vitals', description: 'Audit bundle size and simulated Core Web Vitals.', input_schema: { type: 'object', properties: {} } },
  { name: 'audit_security_dependencies', description: 'Scan npm/pip packages for security vulnerabilities.', input_schema: { type: 'object', properties: {} } },
  { name: 'validate_env_variables', description: 'Validate `.env` against `.env.example` to ensure no missing configuration.', input_schema: { type: 'object', properties: {} } },

  // 8. Architecture, Scaffolding & Task Planning (7 Tools)
  { name: 'write_todos', description: 'Create or update your structured task plan for complex multi-step work. Provide the full list every time: items with { content: string, status: "pending" | "in_progress" | "completed" }. Use at the start of complex tasks and whenever the plan changes.', input_schema: { type: 'object', properties: { todos: { type: 'array', description: 'The complete task list — resend every item with its current status on every call.', items: { type: 'object', properties: { content: { type: 'string', description: 'Imperative description of the task.' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Current state of this task.' } }, required: ['content', 'status'] } } }, required: ['todos'] } },
  { name: 'scaffold_component', description: 'Scaffold component with boilerplate, types, and styles.', input_schema: { type: 'object', properties: { name: { type: 'string' }, framework: { type: 'string' } }, required: ['name'] } },
  { name: 'generate_dockerfile', description: 'Generate production Dockerfile and docker-compose configuration.', input_schema: { type: 'object', properties: { stack: { type: 'string' } } } },
  { name: 'spawn_subagent', description: 'Spawn a specialist subagent that works in parallel on an independent piece of the task (e.g. UI, tests, backend, research). You can assign any model to any subagent (e.g. "gemini-2.5-flash", "gemini-3-pro", "claude-3-7-sonnet", "deepseek-r1"). Announce the spawn to the user. Results return to you to integrate.', input_schema: { type: 'object', properties: { role: { type: 'string', description: 'Specialist role, e.g. "UI-designer", "test-writer", "researcher", "debugger".' }, task: { type: 'string', description: 'Complete, self-contained task description for this specialist.' }, model: { type: 'string', description: 'Optional specific model ID to use for this subagent (e.g. "gemini-2.5-flash", "gemini-3-pro", "claude-3-7-sonnet", "deepseek-r1", or "auto").' } }, required: ['role', 'task'] } },
  { name: 'create_artifact', description: 'Create a named, trackable artifact visible in the Artifacts panel: implementation plans, design docs, task breakdowns, verification reports, or work summaries. Prefer this over plain files when the user should see structured progress.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Short artifact name, e.g. "Auth implementation plan".' }, type: { type: 'string', enum: ['plan', 'implementation', 'design', 'asset', 'verification', 'doc'], description: 'Artifact kind.' }, content: { type: 'string', description: 'Markdown content of the artifact.' }, status: { type: 'string', enum: ['draft', 'in_progress', 'done'], description: 'Current status (default draft).' } }, required: ['name', 'content'] } },
  { name: 'update_artifact', description: 'Update an existing artifact by name: replace content and/or move its status forward (draft -> in_progress -> done). Keep artifacts current as work completes.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Artifact name (or id).' }, content: { type: 'string', description: 'New markdown content (omit to keep current).' }, status: { type: 'string', enum: ['draft', 'in_progress', 'done'], description: 'New status (omit to keep current).' } }, required: ['name'] } },
  { name: 'create_implementation_plan', description: 'Create or update implementation_plan.md in workspace to structure architectural decisions and milestones.', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
  { name: 'update_task_progress', description: 'Update task_progress.md in workspace to track completed steps, ongoing work, and remaining roadmap.', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
  { name: 'create_walkthrough', description: 'Create walkthrough.md in workspace summarizing all accomplishments, verification results, and usage.', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
  { name: 'save_note', description: 'Record a compact fact about a file you just read or changed (architecture, key exports, gotchas, TODOs). Notes persist across sessions and are recalled automatically, so you never need to re-read the whole file later. Keep each note under ~50 words.', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative file path the note is about.' }, note: { type: 'string', description: 'One dense sentence or bullet list of the essential facts.' } }, required: ['path', 'note'] } },

  // 9. Memory & Cognitive Recall (4 Tools)
  { name: 'recall_memories', description: 'Search and recall past lessons, user preferences, facts, or architecture patterns from persistent memory on demand.', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search keywords or topic to recall.' }, kind: { type: 'string', enum: ['lesson', 'preference', 'fact', 'architecture', 'episodic'], description: 'Filter by memory kind.' }, limit: { type: 'number', description: 'Max number of memories to return.' } } } },
  { name: 'store_memory', description: 'Persist a new lesson learned, user preference, architectural insight, or fact into durable agent memory.', input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['lesson', 'preference', 'fact', 'architecture', 'episodic'], description: 'Memory kind.' }, content: { type: 'string', description: 'Actionable, dense takeaway.' } }, required: ['content'] } },
  { name: 'forget_memory', description: 'Remove an outdated or incorrect memory by numeric ID.', input_schema: { type: 'object', properties: { id: { type: 'number', description: 'Memory entry ID to delete.' } }, required: ['id'] } },
  { name: 'list_memories', description: 'List stored agent memories grouped by kind.', input_schema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'create_markdown_doc', description: 'Create a beautifully formatted markdown document in the workspace (guides, specifications, audit reports, architecture overviews) with automatic artifact registration.', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Workspace relative path (e.g. "docs/architecture.md").' }, title: { type: 'string', description: 'Human-readable title.' }, content: { type: 'string', description: 'Markdown content formatted with clear headers, tables, or code fences.' }, category: { type: 'string', enum: ['doc', 'plan', 'design', 'verification', 'findings'], description: 'Artifact classification.' } }, required: ['path', 'content'] } },

  // 10. Human Interaction & Clarification (1 Tool)
  { name: 'ask_user', description: 'Ask the user a clarifying question mid-task and wait for their answer. Use when the request is ambiguous or required inputs are missing (paths, scope, design or asset requirements, credentials). Provide 2-4 short answer options when possible.', input_schema: { type: 'object', properties: { question: { type: 'string', description: 'The focused question to ask the user.' }, options: { type: 'array', description: 'Optional short answer choices (2 to 4 items).', items: { type: 'string' }, minItems: 2, maxItems: 4 }, allow_free_text: { type: 'boolean', description: 'Whether the user may also type a free-form answer (default true).' } }, required: ['question'] } },
] as const;

const openAITools = SUTRA_TOOLS.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));

/**
 * Dynamic Tool Search & Pruning
 * Prunes the 45+ tool schemas down to only relevant tools based on query intent & model constraints.
 */
export function getPrunedToolsForModel(modelId: string, messages: any[], systemPrompt?: string): any[] {
  const safeModelId = typeof modelId === 'string' ? modelId : '';
  const tier: ModelCapabilityTier = detectModelTier(safeModelId);

  // Frontier tier receives full tool definitions for maximum parallel agency
  if (tier === 'FRONTIER' && messages.length < 10) {
    return openAITools;
  }

  const queryContext = (messages.map((m: any) => (typeof m.content === 'string' ? m.content : '')).join(' ') + ' ' + (systemPrompt || '')).toLowerCase();

  // Compact / Weak tier: Minimal foolproof core (8-10 tools max to minimize cognitive token overhead)
  if (tier === 'COMPACT_WEAK') {
    const compactCore = new Set([
      'read_file',
      'write_file',
      'edit_file',
      'run_command',
      'grep_search',
      'list_directory',
      'typecheck_project',
      'ask_user',
      'create_artifact',
      'write_todos',
    ]);
    if (queryContext.includes('test') || queryContext.includes('vitest') || queryContext.includes('jest')) {
      compactCore.add('run_unit_tests');
    }
    if (queryContext.includes('git') || queryContext.includes('commit') || queryContext.includes('diff')) {
      compactCore.add('git_diff');
      compactCore.add('git_status');
    }
    return openAITools.filter((t) => compactCore.has(t.function.name));
  }

  // Balanced tier: Standard developer suite
  const selectedToolNames = new Set([
    'read_file',
    'write_file',
    'edit_file',
    'run_command',
    'grep_search',
    'list_directory',
    'typecheck_project',
    'ask_user',
    'create_artifact',
    'update_artifact',
    'write_todos',
    'codebase_search',
    'ast_grep',
    'save_note',
    'create_markdown_doc',
  ]);

  if (queryContext.includes('git') || queryContext.includes('commit') || queryContext.includes('branch') || queryContext.includes('diff') || queryContext.includes('stash')) {
    selectedToolNames.add('git_status');
    selectedToolNames.add('git_diff');
    selectedToolNames.add('git_commit');
    selectedToolNames.add('git_branch');
    selectedToolNames.add('git_log');
  }
  if (
    queryContext.includes('image') ||
    queryContext.includes('video') ||
    queryContext.includes('audio') ||
    queryContext.includes('media') ||
    queryContext.includes('svg') ||
    queryContext.includes('logo') ||
    queryContext.includes('photo') ||
    queryContext.includes('picture') ||
    queryContext.includes('draw') ||
    queryContext.includes('avatar') ||
    queryContext.includes('banner') ||
    queryContext.includes('icon') ||
    queryContext.includes('sound') ||
    queryContext.includes('sfx') ||
    queryContext.includes('music') ||
    queryContext.includes('song') ||
    queryContext.includes('voice') ||
    queryContext.includes('tts') ||
    queryContext.includes('speech') ||
    queryContext.includes('landing') ||
    queryContext.includes('website') ||
    queryContext.includes('ui') ||
    queryContext.includes('design')
  ) {
    selectedToolNames.add('generate_image_asset');
    selectedToolNames.add('generate_video_asset');
    selectedToolNames.add('generate_audio_asset');
    selectedToolNames.add('generate_sound_effect');
    selectedToolNames.add('generate_music');
    selectedToolNames.add('generate_song');
    selectedToolNames.add('generate_svg_asset');
    selectedToolNames.add('extract_color_palette');
  }
  if (queryContext.includes('subagent') || queryContext.includes('parallel') || queryContext.includes('swarm') || queryContext.includes('team')) {
    selectedToolNames.add('spawn_subagent');
  }
  if (queryContext.includes('web') || queryContext.includes('search') || queryContext.includes('scrape') || queryContext.includes('url') || queryContext.includes('http')) {
    selectedToolNames.add('search_web');
    selectedToolNames.add('scrape_url');
    selectedToolNames.add('fetch_json_api');
  }
  if (queryContext.includes('test') || queryContext.includes('vitest') || queryContext.includes('jest') || queryContext.includes('spec')) {
    selectedToolNames.add('run_unit_tests');
  }
  if (queryContext.includes('db') || queryContext.includes('sql') || queryContext.includes('database') || queryContext.includes('table')) {
    selectedToolNames.add('inspect_sqlite_schema');
    selectedToolNames.add('query_sqlite');
  }

  return openAITools.filter((t) => selectedToolNames.has(t.function.name));
}

export interface ModelLimitProfile {
  maxContextTokens: number;
  safeTpmTokens: number;
  maxToolSchemaTokens: number;
  maxSingleTurnTokens: number;
  maxToolOutputChars: number;
}

export const PROVIDER_MODEL_LIMITS: Record<string, ModelLimitProfile> = {
  // Groq LPU Models (Strict TPM Limits on Free/On-Demand Tier)
  'openai/gpt-oss-20b': {
    maxContextTokens: 131072,
    safeTpmTokens: 16000,
    maxToolSchemaTokens: 2000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'openai/gpt-oss-120b': {
    maxContextTokens: 131072,
    safeTpmTokens: 30000,
    maxToolSchemaTokens: 3000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 8000,
  },
  'llama-3.3-70b-versatile': {
    maxContextTokens: 128000,
    safeTpmTokens: 5500,
    maxToolSchemaTokens: 450,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 8000,
  },
  'llama-3.1-8b-instant': {
    maxContextTokens: 128000,
    safeTpmTokens: 24000,
    maxToolSchemaTokens: 1500,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'qwen/qwen3.6-27b': {
    maxContextTokens: 131072,
    safeTpmTokens: 20000,
    maxToolSchemaTokens: 2000,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 8000,
  },
  'mistral-saba-24b': {
    maxContextTokens: 32768,
    safeTpmTokens: 5500,
    maxToolSchemaTokens: 450,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 8000,
  },
  'deepseek-r1-distill-llama-70b': {
    maxContextTokens: 128000,
    safeTpmTokens: 5500,
    maxToolSchemaTokens: 450,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 8000,
  },

  // Google Gemini (Massive Context)
  'gemini-3-pro': {
    maxContextTokens: 1048576,
    safeTpmTokens: 800000,
    maxToolSchemaTokens: 8000,
    maxSingleTurnTokens: 16384,
    maxToolOutputChars: 64000,
  },
  'gemini-3.7-flash': {
    maxContextTokens: 1048576,
    safeTpmTokens: 800000,
    maxToolSchemaTokens: 8000,
    maxSingleTurnTokens: 16384,
    maxToolOutputChars: 48000,
  },
  'gemini-2.5-pro': {
    maxContextTokens: 1048576,
    safeTpmTokens: 800000,
    maxToolSchemaTokens: 8000,
    maxSingleTurnTokens: 16384,
    maxToolOutputChars: 64000,
  },
  'gemini-2.5-flash': {
    maxContextTokens: 1048576,
    safeTpmTokens: 800000,
    maxToolSchemaTokens: 6000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 32000,
  },
  'gemini-2.0-flash': {
    maxContextTokens: 1048576,
    safeTpmTokens: 800000,
    maxToolSchemaTokens: 6000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 32000,
  },
  'gemini-1.5-pro': {
    maxContextTokens: 2097152,
    safeTpmTokens: 1800000,
    maxToolSchemaTokens: 10000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 64000,
  },
  'gemini-1.5-flash': {
    maxContextTokens: 1048576,
    safeTpmTokens: 800000,
    maxToolSchemaTokens: 6000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 32000,
  },

  // OpenAI GPT-5 Family (400K input context)
  'gpt-5.1': {
    maxContextTokens: 400000,
    safeTpmTokens: 200000,
    maxToolSchemaTokens: 6000,
    maxSingleTurnTokens: 16384,
    maxToolOutputChars: 32000,
  },
  'gpt-5': {
    maxContextTokens: 400000,
    safeTpmTokens: 180000,
    maxToolSchemaTokens: 6000,
    maxSingleTurnTokens: 16384,
    maxToolOutputChars: 32000,
  },
  'gpt-5-mini': {
    maxContextTokens: 400000,
    safeTpmTokens: 120000,
    maxToolSchemaTokens: 5000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 16000,
  },
  'gpt-5-nano': {
    maxContextTokens: 400000,
    safeTpmTokens: 150000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 12000,
  },
  'o4-mini': {
    maxContextTokens: 200000,
    safeTpmTokens: 90000,
    maxToolSchemaTokens: 3500,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'gpt-4.1': {
    maxContextTokens: 1000000,
    safeTpmTokens: 250000,
    maxToolSchemaTokens: 6000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 32000,
  },

  // Legacy OpenAI (kept as fuzzy-match safety for stale configs)
  'gpt-4o': {
    maxContextTokens: 128000,
    safeTpmTokens: 28000,
    maxToolSchemaTokens: 2500,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'gpt-4o-mini': {
    maxContextTokens: 128000,
    safeTpmTokens: 180000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'o1-preview': {
    maxContextTokens: 128000,
    safeTpmTokens: 60000,
    maxToolSchemaTokens: 3000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'o3-mini': {
    maxContextTokens: 128000,
    safeTpmTokens: 90000,
    maxToolSchemaTokens: 3500,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },

  // DeepSeek (V3.x / R-series aliases, 128K context)
  'deepseek-chat': {
    maxContextTokens: 128000,
    safeTpmTokens: 120000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 12000,
  },
  'deepseek-reasoner': {
    maxContextTokens: 128000,
    safeTpmTokens: 90000,
    maxToolSchemaTokens: 3500,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 8000,
  },

   // Anthropic Claude 4 Family (200K context, vision + tools)
  'claude-sonnet-4-6': {
    maxContextTokens: 200000,
    safeTpmTokens: 35000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'claude-opus-4-6-thinking': {
    maxContextTokens: 200000,
    safeTpmTokens: 80000,
    maxToolSchemaTokens: 5000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 16000,
  },
  'claude-3-7-sonnet': {
    maxContextTokens: 200000,
    safeTpmTokens: 35000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'claude-3-5-sonnet': {
    maxContextTokens: 200000,
    safeTpmTokens: 35000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },
  'claude-3-5-haiku': {
    maxContextTokens: 200000,
    safeTpmTokens: 45000,
    maxToolSchemaTokens: 3000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },

  // Anthropic Claude 5 Family (200K context, vision + tools)
  'claude-opus-5': {
    maxContextTokens: 200000,
    safeTpmTokens: 80000,
    maxToolSchemaTokens: 5000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 16000,
  },
  'claude-sonnet-5': {
    maxContextTokens: 200000,
    safeTpmTokens: 80000,
    maxToolSchemaTokens: 5000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 16000,
  },
  'claude-fable-5': {
    maxContextTokens: 200000,
    safeTpmTokens: 70000,
    maxToolSchemaTokens: 5000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 12000,
  },
  'claude-haiku-4-5-20251001': {
    maxContextTokens: 200000,
    safeTpmTokens: 100000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 8000,
  },

  // Zhipu GLM (OpenAI-compatible z.ai endpoint)
  'glm-4.6': {
    maxContextTokens: 200000,
    safeTpmTokens: 60000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 12000,
  },
  'glm-4.5-air': {
    maxContextTokens: 128000,
    safeTpmTokens: 40000,
    maxToolSchemaTokens: 3000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },

  // xAI Grok
  'grok-4': {
    maxContextTokens: 256000,
    safeTpmTokens: 60000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 12000,
  },
  'grok-code-fast-1': {
    maxContextTokens: 256000,
    safeTpmTokens: 60000,
    maxToolSchemaTokens: 3500,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 12000,
  },
  'grok-3': {
    maxContextTokens: 131072,
    safeTpmTokens: 40000,
    maxToolSchemaTokens: 3000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 8000,
  },

  // Alibaba Qwen (DashScope compatible mode)
  'qwen3-coder-plus': {
    maxContextTokens: 1000000,
    safeTpmTokens: 100000,
    maxToolSchemaTokens: 5000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 16000,
  },
  'qwen3-max': {
    maxContextTokens: 262144,
    safeTpmTokens: 100000,
    maxToolSchemaTokens: 5000,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 16000,
  },

  // ChatGPT Web (free browser-session models)
  'luna': {
    maxContextTokens: 128000,
    safeTpmTokens: 30000,
    maxToolSchemaTokens: 2500,
    maxSingleTurnTokens: 8192,
    maxToolOutputChars: 8000,
  },

  // Ollama Local Defaults
  'qwen2.5-coder': {
    maxContextTokens: 32768,
    safeTpmTokens: 32000,
    maxToolSchemaTokens: 2000,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 8000,
  },
  'deepseek-coder': {
    maxContextTokens: 32768,
    safeTpmTokens: 32000,
    maxToolSchemaTokens: 2000,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 8000,
  },
  'llama3.2': {
    maxContextTokens: 16384,
    safeTpmTokens: 16000,
    maxToolSchemaTokens: 1500,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 8000,
  },
  // Sarvam AI Regional Foundation Models
  'sarvam-105b': {
    maxContextTokens: 32768,
    safeTpmTokens: 24000,
    maxToolSchemaTokens: 2500,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 12000,
  },
  'sarvam-m': {
    maxContextTokens: 32768,
    safeTpmTokens: 24000,
    maxToolSchemaTokens: 2500,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 12000,
  },
  'sarvam-2b': {
    maxContextTokens: 8192,
    safeTpmTokens: 6000,
    maxToolSchemaTokens: 1500,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 6000,
  },
};

/**
 * Dynamic 413 & Rate Limit Learning Engine
 */
class LearnedModelLimitsManager {
  private learnedLimits: Map<string, { limitTokens: number; learnedAt: number }> = new Map();

  public getModelProfile(modelId: string, provider: string): ModelLimitProfile {
    // Unknown ids (custom models, fresh provider slugs) resolve through the
    // provider-level fallback below — never crash on an unrecognized id.
    const safeModelId = typeof modelId === 'string' ? modelId : '';
    const learned = safeModelId ? this.learnedLimits.get(safeModelId) : undefined;
    let baseProfile = PROVIDER_MODEL_LIMITS[safeModelId];

    if (!baseProfile && safeModelId) {
      const key = Object.keys(PROVIDER_MODEL_LIMITS).find((k) => safeModelId.includes(k) || k.includes(safeModelId));
      if (key) {
        baseProfile = PROVIDER_MODEL_LIMITS[key];
      } else if (provider === 'groq') {
        baseProfile = { maxContextTokens: 131072, safeTpmTokens: 24000, maxToolSchemaTokens: 2000, maxSingleTurnTokens: 8192, maxToolOutputChars: 8000 };
      } else if (provider === 'google') {
        baseProfile = { maxContextTokens: 1048576, safeTpmTokens: 800000, maxToolSchemaTokens: 6000, maxSingleTurnTokens: 8192, maxToolOutputChars: 32000 };
      } else if (provider === 'openai') {
        baseProfile = { maxContextTokens: 128000, safeTpmTokens: 30000, maxToolSchemaTokens: 3000, maxSingleTurnTokens: 4096, maxToolOutputChars: 8000 };
      } else if (provider === 'anthropic') {
        baseProfile = { maxContextTokens: 200000, safeTpmTokens: 35000, maxToolSchemaTokens: 3500, maxSingleTurnTokens: 4096, maxToolOutputChars: 8000 };
      } else if (provider === 'deepseek') {
        baseProfile = { maxContextTokens: 64000, safeTpmTokens: 50000, maxToolSchemaTokens: 3000, maxSingleTurnTokens: 4096, maxToolOutputChars: 8000 };
      } else {
        // Unknown ids (openrouter/custom models) keep generous per-result windows —
        // a tiny default forced sliding line-window reads over big files.
        baseProfile = { maxContextTokens: 32768, safeTpmTokens: 20000, maxToolSchemaTokens: 2000, maxSingleTurnTokens: 2048, maxToolOutputChars: 16000 };
      }
    }

    if (learned && learned.limitTokens > 0) {
      return {
        ...baseProfile,
        safeTpmTokens: Math.min(baseProfile.safeTpmTokens, Math.floor(learned.limitTokens * 0.82)),
        maxContextTokens: Math.min(baseProfile.maxContextTokens, learned.limitTokens),
      };
    }

    return baseProfile;
  }

  public record413Error(modelId: string, errorMessage: string): number {
    const safeModelId = typeof modelId === 'string' ? modelId : 'unknown-model';
    const limitMatch =
      errorMessage.match(/limit\s*(\d+)/i) ||
      errorMessage.match(/(\d+)\s*tokens\s*per\s*minute/i) ||
      errorMessage.match(/maximum\s*context\s*length\s*is\s*(\d+)/i) ||
      errorMessage.match(/max_tokens\s*is\s*(\d+)/i);

    if (limitMatch && limitMatch[1]) {
      const parsedLimit = parseInt(limitMatch[1], 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        this.learnedLimits.set(safeModelId, { limitTokens: parsedLimit, learnedAt: Date.now() });
        console.log(`[SUTRA 413 Calibrator] Learned limit for ${safeModelId}: ${parsedLimit} TPM. Clamping to ${Math.floor(parsedLimit * 0.82)} tokens.`);
        return parsedLimit;
      }
    }

    const current = this.getModelProfile(safeModelId, '').safeTpmTokens;
    const reduced = Math.max(1200, Math.floor(current * 0.65));
    this.learnedLimits.set(safeModelId, { limitTokens: reduced, learnedAt: Date.now() });
    return reduced;
  }

  /**
   * Dynamic recovery: after 15+ minutes of clean successes, a learned (downgraded)
   * limit decays back toward the base profile — rate-limit events are transient,
   * so the budget must heal instead of ratcheting to a tiny floor forever.
   */
  public recordSuccess(modelId: string): void {
    const safeModelId = typeof modelId === 'string' ? modelId : '';
    const learned = safeModelId ? this.learnedLimits.get(safeModelId) : undefined;
    if (!learned) return;
    const minutesSinceDowngrade = (Date.now() - learned.learnedAt) / 60000;
    if (minutesSinceDowngrade < 15) return;

    const base = PROVIDER_MODEL_LIMITS[safeModelId]?.safeTpmTokens || 30000;
    const relaxed = Math.min(base, Math.floor(learned.limitTokens * 1.5) + 1000);
    if (relaxed >= base) {
      this.learnedLimits.delete(safeModelId);
      console.log(`[SUTRA 413 Calibrator] ${safeModelId} sustained success — learned limit cleared back to base (${base}).`);
    } else {
      this.learnedLimits.set(safeModelId, { limitTokens: relaxed, learnedAt: Date.now() });
      console.log(`[SUTRA 413 Calibrator] ${safeModelId} sustained success — TPM budget relaxed to ${relaxed}.`);
    }
  }
}

export const learnedModelLimits = new LearnedModelLimitsManager();

/* ------------------------------------------------------------------ *
 * Tool-call atomicity
 *
 * OpenAI-compatible providers (OpenRouter, Groq, Ollama, vLLM, LM Studio)
 * and Antigravity all enforce the same invariant: an assistant message
 * carrying `tool_calls` MUST be immediately followed by a `role: "tool"`
 * message for every one of its call ids, and a `role: "tool"` message MUST
 * have its originating assistant message present. Violating either returns
 * HTTP 400 and the run dies.
 *
 * Any positional slicing of history — compaction, context windowing, the
 * auto-compact splice — can cut between an assistant message and its tool
 * results. That was the single largest source of mid-run failures: the agent
 * worked fine until the history grew past the compaction threshold, then
 * every subsequent round failed.
 *
 * The helpers below make history manipulation atomicity-aware.
 * ------------------------------------------------------------------ */

/**
 * Collects every tool_call id declared by an assistant message.
 * Tolerates both the OpenAI shape (`tool_calls[].id`) and the flattened
 * shape some local runtimes emit (`tool_calls[].tool_call_id`).
 */
function collectToolCallIds(message: any): string[] {
  const calls = message?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return [];
  const ids: string[] = [];
  for (const call of calls) {
    const id = call?.id || call?.tool_call_id;
    if (id) ids.push(String(id));
  }
  return ids;
}

/**
 * Splits a flat message list into indivisible groups.
 *
 * A group is either:
 *   - an assistant message with `tool_calls`, bundled with every `role:"tool"`
 *     message that answers one of its call ids (they travel together), or
 *   - a single standalone message.
 *
 * Compaction must drop whole groups, never part of one.
 */
export function groupIntoAtomicTurns(messages: any[]): any[][] {
  const groups: any[][] = [];
  let pending: any[] | null = null;
  let pendingIds: string[] = [];

  const closePending = (): void => {
    if (pending) {
      groups.push(pending);
      pending = null;
      pendingIds = [];
    }
  };

  for (const message of messages) {
    if (!message) continue;

    if (pending) {
      // A tool message that answers an id we are still collecting belongs to
      // the open group. Anything else closes it.
      const answeringId = message.role === 'tool' ? String(message.tool_call_id ?? '') : '';
      if (answeringId && pendingIds.includes(answeringId)) {
        pending.push(message);
        pendingIds = pendingIds.filter((id) => id !== answeringId);
        if (pendingIds.length === 0) closePending();
        continue;
      }
      closePending();
    }

    if (message.role === 'assistant') {
      const ids = collectToolCallIds(message);
      if (ids.length > 0) {
        pending = [message];
        pendingIds = ids;
        continue;
      }
    }

    groups.push([message]);
  }

  closePending();
  return groups;
}

/**
 * Enforces the tool-call pairing invariant on a flat message list.
 *
 *  - Drops `role:"tool"` messages that have no surviving parent assistant
 *    message (orphans cause a 400).
 *  - Drops the `tool_calls` array from an assistant message that lost any of
 *    its results, keeping the message as plain text so the narrative survives.
 *
 * Cheap and idempotent — safe to call on every request.
 */
export function repairToolCallPairing(messages: any[]): any[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const declaredIds = new Set<string>();
  for (const message of messages) {
    if (message?.role === 'assistant') {
      for (const id of collectToolCallIds(message)) declaredIds.add(id);
    }
  }

  const answeredIds = new Set<string>();
  for (const message of messages) {
    if (message?.role === 'tool') {
      const id = String(message.tool_call_id ?? '');
      if (id) answeredIds.add(id);
    }
  }

  const repaired: any[] = [];
  for (const message of messages) {
    if (message?.role === 'tool') {
      const id = String(message.tool_call_id ?? '');
      // Keep only tool results whose parent call is still in history.
      if (!id || !declaredIds.has(id)) continue;
      repaired.push(message);
      continue;
    }

    if (message?.role === 'assistant') {
      const ids = collectToolCallIds(message);
      if (ids.length > 0) {
        const complete = ids.every((id) => answeredIds.has(id));
        if (complete) {
          repaired.push(message);
        } else {
          // Results were dropped by compaction — demote to a plain assistant
          // message so the provider no longer demands tool responses.
          const { tool_calls: _dropped, ...rest } = message;
          repaired.push(rest);
        }
        continue;
      }
    }

    repaired.push(message);
  }

  return repaired;
}

/**
 * Universal Payload Calibrator for Any Model & Provider Tier
 */
export function calibratePayloadForModel(
  modelId: string,
  provider: string,
  messages: any[],
  systemPrompt?: string
): {
  compactedMessages: any[];
  compactedSystemPrompt: string;
  prunedTools: any[];
  profile: ModelLimitProfile;
} {
  const profile = learnedModelLimits.getModelProfile(modelId, provider);
  const targetBudget = profile.safeTpmTokens;

  // 1. Dynamic Tool Pruning based on profile tool budget
  const prunedTools = getPrunedToolsForModel(modelId, messages, systemPrompt);

  // 2. Calibrate System Prompt length
  let compactedSystemPrompt = systemPrompt || '';
  if (profile.safeTpmTokens < 8000 && compactedSystemPrompt.length > 1200) {
    compactedSystemPrompt = compactedSystemPrompt.slice(0, 1200) + '\n[System prompt compacted for model token budget]';
  }

  // 3. Multi-Tier Message Compaction
  const estTokensPerChar = 0.25;
  const sysTokens = compactedSystemPrompt.length * estTokensPerChar;
  const toolTokens = prunedTools.length * 35;
  const messageTokenBudget = Math.max(800, targetBudget - sysTokens - toolTokens);

  let currentTokens = messages.reduce(
    (acc: number, m: any) => acc + (typeof m.content === 'string' ? m.content.length * estTokensPerChar : 0),
    0
  );

  if (currentTokens <= messageTokenBudget) {
    return { compactedMessages: messages, compactedSystemPrompt, prunedTools, profile };
  }

  // Level 1: Shrink tool outputs to maxToolOutputChars
  let compactedMessages = messages.map((m: any) => {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > profile.maxToolOutputChars) {
      return {
        ...m,
        content: `${m.content.slice(0, profile.maxToolOutputChars)}...\n[Truncated to fit ${profile.safeTpmTokens} TPM budget]`,
      };
    }
    return m;
  });

  currentTokens = compactedMessages.reduce(
    (acc: number, m: any) => acc + (typeof m.content === 'string' ? m.content.length * estTokensPerChar : 0),
    0
  );

  if (currentTokens <= messageTokenBudget || compactedMessages.length <= 4) {
    return { compactedMessages, compactedSystemPrompt, prunedTools, profile };
  }

  // Level 2: keep the opening + most recent ATOMIC TURNS, shrink the middle.
  //
  // This used to slice by raw message index, which cut between an assistant
  // `tool_calls` message and its `role:"tool"` results. Every OpenAI-compatible
  // provider rejects that with a 400, so the agent ran fine until history grew
  // past this threshold and then failed on every subsequent round. Slicing by
  // atomic turn group means a turn is dropped whole or not at all.
  const turnGroups = groupIntoAtomicTurns(compactedMessages);
  const HEAD_TURNS = 1;
  const TAIL_TURNS = 3;

  if (turnGroups.length > HEAD_TURNS + TAIL_TURNS) {
    const head = turnGroups.slice(0, HEAD_TURNS);
    const tail = turnGroups.slice(-TAIL_TURNS);
    const middle = turnGroups.slice(HEAD_TURNS, -TAIL_TURNS).map((group) =>
      group.map((m: any) => {
        if (m.role === 'tool' && typeof m.content === 'string') {
          return { ...m, content: `${m.content.slice(0, 120)}...\n[Compacted tool output]` };
        }
        if (m.role === 'assistant' && typeof m.content === 'string') {
          return { ...m, content: `${m.content.slice(0, 150)}...\n[Compacted assistant step]` };
        }
        return m;
      })
    );

    compactedMessages = [...head.flat(), ...middle.flat(), ...tail.flat()];
  }

  // Level 3: Semantic Turn Collapse for long-running missions.
  //
  // Gated on the token budget now. It previously ran whenever history exceeded
  // 8 messages — with no budget re-check — so it fired on every round of the
  // generic OpenAI/OpenRouter/Groq/Ollama path (the most-used path) even when
  // the payload already fit, discarding most of the conversation each time.
  currentTokens = compactedMessages.reduce(
    (acc: number, m: any) => acc + (typeof m.content === 'string' ? m.content.length * estTokensPerChar : 0),
    0
  );

  if (currentTokens > messageTokenBudget && turnGroups.length > HEAD_TURNS + TAIL_TURNS) {
    const head = turnGroups.slice(0, HEAD_TURNS);
    const tail = turnGroups.slice(-TAIL_TURNS);
    const middleSpan = turnGroups.slice(HEAD_TURNS, -TAIL_TURNS);

    const executedToolNames: string[] = [];
    for (const group of middleSpan) {
      for (const m of group) {
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            const fn = tc.function?.name || tc.tool;
            if (fn) executedToolNames.push(fn);
          }
        }
      }
    }

    const collapsedSummary = {
      role: 'user',
      content: `[Astra Executive History Summary: ${middleSpan.length} intermediate execution turns completed successfully (${executedToolNames.slice(-12).join(', ')}). All created/modified files are active in workspace. Continue with next phase.]`,
    };

    compactedMessages = [...head.flat(), collapsedSummary, ...tail.flat()];
  }

  // Final invariant pass — never hand a provider a history with dangling tool
  // calls, whatever the levels above decided to drop. Cheap and idempotent.
  compactedMessages = repairToolCallPairing(compactedMessages);

  return { compactedMessages, compactedSystemPrompt, prunedTools, profile };
}

/**
 * Legacy compatibility alias for compactMessagesForTpm
 */
export function compactMessagesForTpm(messages: any[], maxEstimatedTokens = 4000): any[] {
  const estTokensPerChar = 0.25;
  const totalChars = messages.reduce((acc: number, m: any) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0);
  if (totalChars * estTokensPerChar <= maxEstimatedTokens || messages.length <= 2) {
    return messages;
  }

  const initial = messages.slice(0, 2);
  const recent = messages.slice(-4);
  const middle = messages.slice(2, -4).map((m: any) => {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 250) {
      return {
        ...m,
        content: `${m.content.slice(0, 180)}...\n[TPM Guard: output compacted]`,
      };
    }
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 350) {
      return {
        ...m,
        content: `${m.content.slice(0, 250)}...\n[assistant turn compacted]`,
      };
    }
    return m;
  });

  return [...initial, ...middle, ...recent];
}

/**
 * Universal Text-Based Tool Call Extractor and XML Sanitizer
 * Extracts pseudo-XML tool calls generated by models (e.g. <tool_call><function=...><parameter=...>...</parameter></function></tool_call>)
 * and strips raw syntax delimiters so they never bleed into conversational chat output.
 */
export function extractAndStripTextToolCalls(rawText: string): { cleanText: string; extractedTools: any[] } {
  if (!rawText || typeof rawText !== 'string') return { cleanText: '', extractedTools: [] };

  const extractedTools: any[] = [];

  const normalizeToolName = (name: string): string => {
    if (!name) return '';
    return name.replace(/^(?:repo_browser|workspace|fs|tools|functions|file_system)\./i, '').trim();
  };

  // Pattern 1: <tool_call><function=name><parameter=key>value</parameter></function></tool_call>
  const xmlPattern = /<tool_call>[\s\S]*?<function=([a-zA-Z0-9_.]+)>([\s\S]*?)<\/function>[\s\S]*?<\/tool_call>/gi;
  let match;
  while ((match = xmlPattern.exec(rawText)) !== null) {
    const toolName = normalizeToolName(match[1]);
    const paramBlock = match[2];
    const params: Record<string, any> = {};

    const paramPattern = /<parameter=([a-zA-Z0-9_]+)>([\s\S]*?)<\/parameter>/gi;
    let pMatch;
    while ((pMatch = paramPattern.exec(paramBlock)) !== null) {
      const pKey = pMatch[1];
      let pVal: any = pMatch[2].trim();
      try { pVal = JSON.parse(pVal); } catch { /* not JSON — keep the raw string value */ }
      params[pKey] = pVal;
    }

    extractedTools.push({
      id: `tool-${Date.now()}-${extractedTools.length}`,
      tool: toolName,
      params,
      requiresApproval: false,
      status: 'approved',
      timestamp: Date.now(),
    });
  }

  // Pattern 2: Isolated <function=name><parameter=key>val</parameter></function>
  const remainingWithoutToolCalls = rawText.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  const looseFunctionPattern = /<function=([a-zA-Z0-9_.]+)>([\s\S]*?)<\/function>/gi;
  while ((match = looseFunctionPattern.exec(remainingWithoutToolCalls)) !== null) {
    const toolName = normalizeToolName(match[1]);
    const paramBlock = match[2];
    const params: Record<string, any> = {};
    const paramPattern = /<parameter=([a-zA-Z0-9_]+)>([\s\S]*?)<\/parameter>/gi;
    let pMatch;
    while ((pMatch = paramPattern.exec(paramBlock)) !== null) {
      const pKey = pMatch[1];
      let pVal: any = pMatch[2].trim();
      try { pVal = JSON.parse(pVal); } catch { /* not JSON — keep the raw string value */ }
      params[pKey] = pVal;
    }
    extractedTools.push({
      id: `tool-${Date.now()}-${extractedTools.length}`,
      tool: toolName,
      params,
      requiresApproval: false,
      status: 'approved',
      timestamp: Date.now(),
    });
  }

  // Pattern 3: <tool_call>{"name": "read_file", "arguments": {"path": "..."}}</tool_call>
  const jsonXmlPattern = /<tool_call>[\s\S]*?({[\s\S]*?})[\s\S]*?<\/tool_call>/gi;
  while ((match = jsonXmlPattern.exec(rawText)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const rawTool = parsed.name || parsed.tool;
      if (rawTool) {
        extractedTools.push({
          id: `tool-${Date.now()}-${extractedTools.length}`,
          tool: normalizeToolName(rawTool),
          params: parsed.arguments || parsed.parameters || parsed.params || {},
          requiresApproval: false,
          status: 'approved',
          timestamp: Date.now(),
        });
      }
    } catch {
      // Malformed JSON in a <tool_call> block — skip it and keep scanning
    }
  }

  // Pattern 4: Glued / un-delimited text tool calls — scanned ONLY inside fenced code blocks
  // (``` or ~~~). Plain prose mentioning a tool name ("read_file README.md to inspect it")
  // is NEVER treated as executable and is left untouched in the visible chat.
  // Built from the LIVE catalog instead of a hand-maintained 12-name allowlist.
  // The old allowlist omitted create_artifact, write_todos, codebase_search,
  // git_*, run_tests, inspect_sqlite_schema and ~40 others, so text-dialect
  // providers (notably ChatGPT Web, which has no native function calling) had
  // those calls silently rendered as chat text and never executed — the exact
  // "cannot name and create artifacts" symptom.
  const KNOWN_GLUED_TOOLS = (SUTRA_TOOLS as ReadonlyArray<{ name: string }>)
    .map((t) => t.name)
    .join('|');

  /** Primary (first required) parameter for a tool, straight from its schema. */
  const primaryParamFor = (toolName: string): string | null => {
    const spec = (SUTRA_TOOLS as ReadonlyArray<{ name: string; input_schema?: any }>).find(
      (t) => t.name === toolName
    );
    const required = spec?.input_schema?.required;
    return Array.isArray(required) && required.length > 0 ? String(required[0]) : null;
  };

  const extractGluedCall = (rawTool: string, rawArg: string): void => {
    const arg = rawArg.trim();
    if (!arg || arg.startsWith('<')) return;
    const toolName = normalizeToolName(rawTool.trim());
    let params: Record<string, any> = {};

    if (['read_file', 'write_file', 'edit_file', 'delete_file', 'list_directory'].includes(toolName)) {
      params = { path: arg.replace(/^["'`]|["'`]$/g, '').trim() };
    } else if (['generate_image_asset', 'generate_video_asset', 'generate_audio_asset'].includes(toolName)) {
      params = { prompt: arg, filename: `generated_${Date.now()}` };
    } else if (['grep_search', 'search_web'].includes(toolName)) {
      params = { query: arg };
    } else if (toolName === 'run_command') {
      params = { command: arg };
    } else if (toolName === 'scrape_url') {
      params = { url: arg };
    } else if (toolName === 'create_artifact' || toolName === 'update_artifact') {
      // Text-dialect models usually emit "create_artifact Name — body…".
      // Split on the first sentence/clause break and treat the remainder as content,
      // so the artifact always gets a real name and never fails the
      // "requires name and content" guard.
      const separator = arg.search(/[:\-–—]\s|\.\s+/);
      const name = separator > 0 ? arg.slice(0, separator).trim() : arg.slice(0, 60).trim();
      const content = separator > 0 ? arg.slice(separator + 1).trim() : arg;
      params = { name: name.replace(/^["'`]|["'`]$/g, ''), content };
    } else {
      // Generic fallback: any other catalog tool takes its first required param.
      const primary = primaryParamFor(toolName);
      if (!primary) return;
      params = { [primary]: arg.replace(/^["'`]|["'`]$/g, '').trim() };
    }

    extractedTools.push({
      id: `tool-${Date.now()}-${extractedTools.length}`,
      tool: toolName,
      params,
      requiresApproval: false,
      status: 'approved',
      timestamp: Date.now(),
    });
  };

  // Locate complete fenced code blocks by scanning line openers (``` or ~~~ at line start).
  // Unterminated fences are ignored — ambiguous regions must never trigger execution.
  const fencedRawLines = rawText.split(/\r?\n/);
  const fenceRanges: Array<{ start: number; end: number }> = [];
  let fenceOpen = false;
  let fenceMarker = '';
  let fenceStart = -1;
  for (let i = 0; i < fencedRawLines.length; i++) {
    const opener = fencedRawLines[i].match(/^\s*(```|~~~)/);
    if (!fenceOpen && opener) {
      fenceOpen = true;
      fenceMarker = opener[1];
      fenceStart = i;
    } else if (fenceOpen && opener && opener[1] === fenceMarker) {
      fenceRanges.push({ start: fenceStart, end: i });
      fenceOpen = false;
    }
  }

  const fenceLinesToRemove = new Set<number>();
  for (const range of fenceRanges) {
    const fenceBody = fencedRawLines.slice(range.start, range.end + 1).join('\n');
    // Word boundary + mandatory whitespace separator so identifiers like
    // `read_file_length(a, b)` in real code are never mistaken for tool calls.
    const knownToolsRegex = new RegExp(`(?<![A-Za-z0-9_.])(?:repo_browser\\.|fs\\.|tools\\.)?(${KNOWN_GLUED_TOOLS})\\s+([^\\n\\r<]+)`, 'gi');
    let extractedFromFence = false;
    let gluedMatch: RegExpExecArray | null;
    while ((gluedMatch = knownToolsRegex.exec(fenceBody)) !== null) {
      const beforeCount = extractedTools.length;
      extractGluedCall(gluedMatch[1], gluedMatch[2]);
      if (extractedTools.length > beforeCount) extractedFromFence = true;
    }
    // Hide the fence from the visible chat only when it genuinely contained an executable call.
    if (extractedFromFence) {
      for (let i = range.start; i <= range.end; i++) fenceLinesToRemove.add(i);
    }
  }

  let cleanText = fencedRawLines.filter((_line, lineIndex) => !fenceLinesToRemove.has(lineIndex)).join('\n');

  // Local seen-set for Pattern 5 only — kept separate from the post-loop dedup below
  // so this code is safe to run before Pattern 4's `seenSignatures` is declared.
  const seenSignatures5 = new Set<string>();

  // Pattern 5 (NEW): {"name": "...", "arguments": {...}} / {"name": "...", "parameters": {...}}
  // inside ```json code fences. Many Frontier-tier models (Claude, GPT-4o/o3, GLM)
  // emit tool calls in this JSON-only form without the <tool_call> wrapper, so the
  // prior patterns missed them and the chat showed them as text ("giving text
  // outputs instead of acting"). We scan every fenced code block whose info-string
  // is JSON, or which contains a "{ \"name\"" opener, and parse the first balanced JSON.
  const tryParseJsonTool = (body: string): { tool: string; params: Record<string, any> } | null => {
    const trimmed = body.trim();
    if (!trimmed.startsWith('{')) return null;
    // The block may contain extra prose; walk braces to find a balanced JSON object.
    let start = -1;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') {
        if (start === -1) start = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = trimmed.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            const rawTool = parsed.name || parsed.tool || parsed.function;
            if (!rawTool || typeof rawTool !== 'string') return null;
            const params = parsed.arguments || parsed.parameters || parsed.params || parsed.input || {};
            if (params && typeof params === 'object' && !Array.isArray(params)) {
              return { tool: normalizeToolName(rawTool), params };
            }
          } catch {
            // Not valid JSON at this brace level — keep scanning for a balanced one
          }
          start = -1;
        }
      }
    }
    return null;
  };

  // Rescan every fenced block we observed (regardless of marker) for JSON tool calls.
  for (const range of fenceRanges) {
    const fenceBody = fencedRawLines.slice(range.start + 1, range.end).join('\n');
    if (!fenceBody.includes('"name"') && !fenceBody.includes('"tool"') && !fenceBody.includes('"function"')) continue;
    const parsed = tryParseJsonTool(fenceBody);
    if (!parsed) continue;
    // De-duplicate against anything Patterns 1-4 already extracted (same name+args).
    const sig = `${parsed.tool}:${JSON.stringify(parsed.params)}`;
    if (seenSignatures5.has(sig)) continue;
    seenSignatures5.add(sig);
    extractedTools.push({
      id: `tool-${Date.now()}-${extractedTools.length}`,
      tool: parsed.tool,
      params: parsed.params,
      requiresApproval: false,
      status: 'approved',
      timestamp: Date.now(),
    });
    for (let i = range.start; i <= range.end; i++) fenceLinesToRemove.add(i);
  }
  cleanText = fencedRawLines.filter((_line, lineIndex) => !fenceLinesToRemove.has(lineIndex)).join('\n');

  // Pattern 6 (NEW — highest impact): Python-style function invocations.
  // antigravityBridge.ts tells the model to emit tools as:
  //     ```python
  //     write_file(path="src/index.ts", content="...")
  //     ```
  // Patterns 1-5 only understand XML tags, space-separated args, and JSON, so
  // every Antigravity / ChatGPT-Web tool call was being rendered as chat text and
  // never executed — the "gives text instead of acting" symptom.
  //
  // Handles: single/double/triple-quoted strings, numbers, booleans, null, and
  // multi-line bodies. Parsed from the ORIGINAL text (before stripping) so the
  // call is found even when a preceding pattern already rewrote `cleanText`.
  {
    /** Char offset in `rawText` → index into `fencedRawLines`. */
    const lineOfOffset = (text: string, offset: number): number => {
      let line = 0;
      for (let idx = 0; idx < offset && idx < text.length; idx++) {
        if (text[idx] === '\n') line++;
      }
      return line;
    };

    /** Call syntax to excise from the visible text, and lines/fences to drop. */
    const pythonCallTexts: string[] = [];
    const pythonDropLines = new Set<number>();

    const parsePythonScalar = (raw: string): any => {
      const v = raw.trim();
      if (!v) return '';
      // Triple-quoted (possibly multi-line) string
      const triple = v.match(/^(['"]){3}([\s\S]*?)\1{3}$/);
      if (triple) return triple[2];
      // Single- or double-quoted string (with escape support)
      if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
        try {
          return JSON.parse(
            '"' + v.slice(1, -1).replace(/\\(['"])/g, '$1').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'
          );
        } catch {
          return v.slice(1, -1);
        }
      }
      if (v === 'True' || v === 'true') return true;
      if (v === 'False' || v === 'false') return false;
      if (v === 'None' || v === 'null') return null;
      const num = Number(v);
      if (Number.isFinite(num) && v !== '') return num;
      // Bare identifier / unquoted value — keep as string
      return v;
    };

    // Walk the original text finding `name(` then scanning to the balanced close paren.
    const src = rawText;
    for (let i = 0; i < src.length; i++) {
      if (src[i] !== '(') continue;
      // Read the identifier immediately before the paren
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      let end = j + 1;
      while (j >= 0 && /[A-Za-z0-9_.]/.test(src[j])) j--;
      const rawName = src.slice(j + 1, end);
      const toolName = normalizeToolName(rawName);
      if (!toolName) continue;
      if (!(SUTRA_TOOLS as ReadonlyArray<{ name: string }>).some((t) => t.name === toolName)) continue;

      // Scan to the matching close paren, honouring quoted strings.
      let depth = 0;
      let inStr: string | null = null;
      let k = i;
      for (; k < src.length; k++) {
        const c = src[k];
        if (inStr) {
          if (c === '\\') { k++; continue; }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === '"' || c === "'") { inStr = c; continue; }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (k >= src.length) continue; // unbalanced — not a complete call

      const argsRaw = src.slice(i + 1, k);
      const params: Record<string, any> = {};
      // Split top-level commas (ignoring those inside quotes or nested brackets)
      let buf = '';
      let d2 = 0;
      let q2: string | null = null;
      const parts: string[] = [];
      for (let m = 0; m < argsRaw.length; m++) {
        const c = argsRaw[m];
        if (q2) {
          buf += c;
          if (c === '\\') { buf += argsRaw[++m] ?? ''; continue; }
          if (c === q2) q2 = null;
          continue;
        }
        if (c === '"' || c === "'") { q2 = c; buf += c; continue; }
        if (c === '(' || c === '[' || c === '{') d2++;
        else if (c === ')' || c === ']' || c === '}') d2--;
        if (c === ',' && d2 === 0) { parts.push(buf); buf = ''; continue; }
        buf += c;
      }
      if (buf.trim()) parts.push(buf);

      for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const key = part.slice(0, eq).trim();
        const val = part.slice(eq + 1);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
        params[key] = parsePythonScalar(val);
      }

      if (Object.keys(params).length === 0) continue;

      extractedTools.push({
        id: `tool-${Date.now()}-${extractedTools.length}`,
        tool: toolName,
        params,
        requiresApproval: false,
        status: 'approved',
        timestamp: Date.now(),
      });

      // Hide the call from the visible chat — and, when it lives inside a fenced
      // block, hide the whole fence so no empty ```python shell is left behind.
      const callText = src.slice(j + 1, k + 1);
      pythonCallTexts.push(callText);

      const startLine = lineOfOffset(src, j + 1);
      const endLine = lineOfOffset(src, k);
      const enclosing = fenceRanges.find((r) => startLine >= r.start && endLine <= r.end);
      if (enclosing) {
        // Drop the entire fence so no empty ```python shell is left in the chat.
        for (let ln = enclosing.start; ln <= enclosing.end; ln++) pythonDropLines.add(ln);
      } else {
        // Standalone call in prose — drop just the lines carrying it.
        for (let ln = startLine; ln <= endLine; ln++) pythonDropLines.add(ln);
      }

      i = k;
    }

    // Rebuild the human-facing text from the original lines, honouring every
    // removal set (Pattern 4/5 fences, Pattern 6 fences and prose lines).
    cleanText = fencedRawLines
      .filter((_line, lineIndex) => !fenceLinesToRemove.has(lineIndex) && !pythonDropLines.has(lineIndex))
      .join('\n');
    for (const callText of pythonCallTexts) {
      cleanText = cleanText.split(callText).join('');
    }
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  }

  // Deduplicate tools by name and params signature
  const seenSignatures2 = new Set<string>();
  const uniqueTools = extractedTools.filter((t) => {
    const sig = `${t.tool}:${JSON.stringify(t.params)}`;
    if (seenSignatures2.has(sig)) return false;
    seenSignatures2.add(sig);
    return true;
  });

  // Strip XML and pseudo-code tool tags from human-facing conversational text.
  // NOTE: prose lines mentioning tool names are deliberately preserved (Pattern 4 is
  // fence-scoped now) — only structured tool syntax is removed here.
  cleanText = cleanText
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function=[a-zA-Z0-9_.]+>[\s\S]*?<\/function>/gi, '')
    .replace(/<parameter=[a-zA-Z0-9_]+>[\s\S]*?<\/parameter>/gi, '')
    .replace(/<\/function>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<\/?(?:tool_call|function|parameter|think|thought|function_call)[^>]*>/gi, '')
    .replace(/```json\s*\{[\s\S]*?"(?:name|tool|function)"\s*:[\s\S]*?\}\s*```/gi, '')
    .trim();

  return { cleanText, extractedTools: uniqueTools };
}

/**
 * Default model catalog — DISCOVERY FIRST, essentially empty by design.
 *
 * This array used to hold ~33 hand-written model definitions spanning OpenAI,
 * Anthropic, Google, DeepSeek, xAI, Groq, Ollama, ChatGPT Web and OpenRouter.
 * Most of them were guesswork: invented names (`gpt-5.6-sol`,
 * `claude-sonnet-5`, `gemini-3.7-flash`), stale ids, and fabricated pricing.
 * They were advertised in the picker even with no credential configured, so
 * users picked models that failed on the very first request.
 *
 * The catalog is now populated live by `ModelRouter.refreshRemoteModels()`:
 *   - Antigravity -> ANTIGRAVITY_CANONICAL_MODELS_LIST (local Google sign-in, no API key)
 *   - Ollama      -> GET localhost:11434/api/tags       (local, no API key)
 *   - LM Studio   -> GET localhost:1234/v1/models       (local, no API key)
 *   - Pollinations-> always-on free tier                (no API key)
 *   - OpenRouter  -> public catalog                     (only when an API key is set)
 *
 * The single static entry below is the `auto` ASTRA sentinel. It is NOT a real
 * model — it is a routing directive that tells the harness to pick the best
 * verified provider at request time.
 */
export const BUILTIN_MODELS: ModelDefinition[] = [
  // SUTRA Multi-Tier ASTRA Engine — routing sentinel, not a concrete model.
  {
    id: 'auto',
    name: 'ASTRA (Autonomous Multi-Model Engine)',
    canonicalId: 'auto',
    provider: 'antigravity',
    providerModelId: 'auto',
    displayName: 'ASTRA (Autonomous Multi-Model Engine)',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 1048576,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Autonomous multi-model intelligence: seamlessly routes to best verified models and stays on the active working model until failure.',
    source: 'curated',
  },

  // Antigravity / Google Gemini Canonical Models
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    canonicalId: 'gemini-3.7-flash',
    provider: 'antigravity',
    providerModelId: 'gemini-3.7-flash',
    wireModelId: 'gemini-2.5-flash',
    displayName: 'Gemini 3.7 Flash',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 1048576,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Antigravity flagship with tunable thinking effort, 1M context, vision and tools.',
    source: 'curated',
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    canonicalId: 'gemini-3.1-pro',
    provider: 'antigravity',
    providerModelId: 'gemini-3.1-pro',
    wireModelId: 'gemini-2.5-pro',
    displayName: 'Gemini 3.1 Pro',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 1048576,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Deepest Gemini Pro reasoning through Antigravity sign-in with 1M context.',
    source: 'curated',
  },

  // OpenAI Verified Active Models
  {
    id: 'gpt-4o',
    name: 'GPT-4o (Omni)',
    canonicalId: 'gpt-4o',
    provider: 'openai',
    providerModelId: 'gpt-4o',
    displayName: 'GPT-4o (Omni)',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.0025, output: 0.01 },
    description: 'OpenAI flagship multimodal intelligence for code generation, vision, and tool calling.',
    source: 'curated',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    canonicalId: 'gpt-4o-mini',
    provider: 'openai',
    providerModelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    description: 'Fast, cost-efficient model for focused coding edits and fast agent turns.',
    source: 'curated',
  },
  {
    id: 'o3-mini',
    name: 'o3-mini (Reasoning)',
    canonicalId: 'o3-mini',
    provider: 'openai',
    providerModelId: 'o3-mini',
    displayName: 'o3-mini (Reasoning)',
    status: 'active',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: false, streaming: true, mcp: true },
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.0011, output: 0.0044 },
    description: 'Specialized STEM, algorithmic, and mathematical reasoning model with tool support.',
    source: 'curated',
  },
  {
    id: 'o1',
    name: 'o1 (Reasoning)',
    canonicalId: 'o1',
    provider: 'openai',
    providerModelId: 'o1',
    displayName: 'o1 (Reasoning)',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.015, output: 0.06 },
    description: 'Deep chain-of-thought frontier reasoning model for complex architectural refactoring.',
    source: 'curated',
  },
  {
    id: 'gpt-4.5-preview',
    name: 'GPT-4.5 Preview',
    canonicalId: 'gpt-4.5-preview',
    provider: 'openai',
    providerModelId: 'gpt-4.5-preview',
    displayName: 'GPT-4.5 Preview',
    status: 'preview',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.075, output: 0.15 },
    description: 'Massive world-knowledge model with natural prose and expansive reasoning depth.',
    source: 'curated',
  },

  // Anthropic Claude Verified Models
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet (Latest)',
    canonicalId: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    providerModelId: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    description: 'The industry benchmark for agentic coding, multi-file edits, and tool use.',
    source: 'curated',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    canonicalId: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    providerModelId: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.0008, output: 0.004 },
    description: 'Sub-second response latency with near-Sonnet code analysis capabilities.',
    source: 'curated',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    canonicalId: 'claude-3-7-sonnet-20250219',
    provider: 'anthropic',
    providerModelId: 'claude-3-7-sonnet-20250219',
    displayName: 'Claude 3.7 Sonnet (Hybrid Reasoning)',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    description: 'Hybrid standard and extended thinking model with superior autonomous agent capabilities.',
    source: 'curated',
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    canonicalId: 'claude-3-opus-20240229',
    provider: 'anthropic',
    providerModelId: 'claude-3-opus-20240229',
    displayName: 'Claude 3 Opus',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.015, output: 0.075 },
    description: 'Deep nuanced intelligence for high-complexity analysis and expansive synthesis.',
    source: 'curated',
  },

  // DeepSeek Models
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3',
    canonicalId: 'deepseek-chat',
    provider: 'deepseek',
    providerModelId: 'deepseek-chat',
    displayName: 'DeepSeek-V3',
    status: 'active',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: false, thinking: false, tools: true, vision: false, streaming: true, mcp: true },
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.00014, output: 0.00028 },
    description: 'High-performance 671B MoE architecture with exceptional reasoning and code synthesis.',
    source: 'curated',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-R1 (Reasoning)',
    canonicalId: 'deepseek-reasoner',
    provider: 'deepseek',
    providerModelId: 'deepseek-reasoner',
    displayName: 'DeepSeek-R1 (Reasoning)',
    status: 'active',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: false, streaming: true, mcp: true },
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.00055, output: 0.00219 },
    description: 'Open-weights frontier reasoning model with native thinking traces and code verification.',
    source: 'curated',
  },

  // xAI Models
  {
    id: 'grok-2',
    name: 'Grok 2',
    canonicalId: 'grok-2',
    provider: 'xai',
    providerModelId: 'grok-2',
    displayName: 'Grok 2',
    status: 'active',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.002, output: 0.01 },
    description: 'xAI frontier model with real-time reasoning, vision, and tool calling.',
    source: 'curated',
  },

  // OpenRouter Free Models
  {
    id: 'inclusionai/ling-3.0-flash-fin:free',
    name: 'Ling 3.0 Flash Fin (free)',
    canonicalId: 'inclusionai/ling-3.0-flash-fin:free',
    provider: 'openrouter',
    providerModelId: 'inclusionai/ling-3.0-flash-fin:free',
    displayName: 'Ling 3.0 Flash Fin (Free)',
    status: 'active',
    category: 'llm',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: false, streaming: true, mcp: true },
    contextWindow: 131072,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Free ultra-fast financial & coding reasoning LLM via OpenRouter.',
    source: 'curated',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra 550B (free)',
    canonicalId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    provider: 'openrouter',
    providerModelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    displayName: 'NVIDIA Nemotron 3 Ultra (Free)',
    status: 'active',
    category: 'llm',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: false, streaming: true, mcp: true },
    contextWindow: 100000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'NVIDIA 550B frontier reasoning model free via OpenRouter.',
    source: 'curated',
  },
  {
    id: 'stealth/ox-alpha',
    name: 'Ox-Alpha (1M Multimodal)',
    canonicalId: 'stealth/ox-alpha',
    provider: 'openrouter',
    providerModelId: 'stealth/ox-alpha',
    displayName: 'Ox-Alpha (1M Multimodal)',
    status: 'active',
    category: 'multimodal',
    modalities: { input: ['text', 'image', 'audio', 'video'], output: ['text', 'image', 'audio', 'video'] },
    capabilities: { reasoning: true, thinking: true, tools: true, vision: true, streaming: true, mcp: true, video: true, audio: true, image: true },
    contextWindow: 1000000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: '1M context multimodal flagship supporting text, audio, video and images.',
    source: 'curated',
  },

  // Sarvam AI Indic & Regional Models
  {
    id: 'sarvam-105b',
    name: 'Sarvam 105B (Indic & Code)',
    canonicalId: 'sarvam-105b',
    provider: 'sarvam',
    providerModelId: 'sarvam-105b',
    displayName: 'Sarvam 105B',
    status: 'active',
    category: 'llm',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: false, streaming: true, mcp: true },
    contextWindow: 32768,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.0002, output: 0.0006 },
    description: 'Sarvam AI frontier 105B foundation model with deep multilingual Indic reasoning and code synthesis.',
    source: 'curated',
  },
  {
    id: 'sarvam-m',
    name: 'Sarvam-M (Indic Foundation)',
    canonicalId: 'sarvam-m',
    provider: 'sarvam',
    providerModelId: 'sarvam-m',
    displayName: 'Sarvam-M',
    status: 'active',
    category: 'llm',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: false, streaming: true, mcp: true },
    contextWindow: 32768,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.0001, output: 0.0003 },
    description: 'Sarvam AI efficient multilingual foundation model supporting 10+ Indian languages.',
    source: 'curated',
  },
  {
    id: 'sarvam-2b',
    name: 'Sarvam 2B (Lightweight)',
    canonicalId: 'sarvam-2b',
    provider: 'sarvam',
    providerModelId: 'sarvam-2b',
    displayName: 'Sarvam 2B',
    status: 'active',
    category: 'llm',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: false, thinking: false, tools: true, vision: false, streaming: true, mcp: true },
    contextWindow: 8192,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.00005, output: 0.0001 },
    description: 'Sarvam AI ultra-fast 2B edge foundation model.',
    source: 'curated',
  },

  // Video Generation Models
  {
    id: 'google/veo-2',
    name: 'Veo 2 (DeepMind Video)',
    canonicalId: 'veo-2',
    provider: 'google',
    providerModelId: 'veo-2',
    displayName: 'Veo 2 (DeepMind Video)',
    status: 'active',
    category: 'video',
    modalities: { input: ['text', 'image'], output: ['video'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: true, streaming: false, mcp: false, video: true },
    contextWindow: 32000,
    supportsVision: true,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Google DeepMind state-of-the-art cinematic video generation model.',
    source: 'curated',
  },
  {
    id: 'openai/sora',
    name: 'OpenAI Sora 2',
    canonicalId: 'sora',
    provider: 'openai',
    providerModelId: 'sora',
    displayName: 'OpenAI Sora 2',
    status: 'active',
    category: 'video',
    modalities: { input: ['text', 'image'], output: ['video'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: true, streaming: false, mcp: false, video: true },
    contextWindow: 32000,
    supportsVision: true,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'OpenAI cinematic video generation model for high-motion clips.',
    source: 'curated',
  },
  {
    id: 'luma/ray-2',
    name: 'Luma Ray 2 (Dream Machine)',
    canonicalId: 'luma-ray',
    provider: 'replicate',
    providerModelId: 'luma/ray-2',
    displayName: 'Luma Dream Machine Ray 2',
    status: 'active',
    category: 'video',
    modalities: { input: ['text', 'image'], output: ['video'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: true, streaming: false, mcp: false, video: true },
    contextWindow: 16000,
    supportsVision: true,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Luma AI ultra-fast cinematic motion video generation.',
    source: 'curated',
  },
  {
    id: 'minimax/video-01',
    name: 'MiniMax Hailuo Video',
    canonicalId: 'minimax-video-01',
    provider: 'minimax',
    providerModelId: 'video-01',
    displayName: 'MiniMax Hailuo Video-01',
    status: 'active',
    category: 'video',
    modalities: { input: ['text', 'image'], output: ['video'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: true, streaming: false, mcp: false, video: true },
    contextWindow: 16000,
    supportsVision: true,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'MiniMax Hailuo 1080p realistic video and physics simulation.',
    source: 'curated',
  },
  {
    id: 'kuaishou/kling-v1.5',
    name: 'Kling v1.5 (Video)',
    canonicalId: 'kling-video',
    provider: 'replicate',
    providerModelId: 'kuaishou/kling-v1.5',
    displayName: 'Kling v1.5 Video',
    status: 'active',
    category: 'video',
    modalities: { input: ['text', 'image'], output: ['video'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: true, streaming: false, mcp: false, video: true },
    contextWindow: 16000,
    supportsVision: true,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Kuaishou Kling dynamic motion and camera control video synthesis.',
    source: 'curated',
  },
  {
    id: 'runway/gen-3-alpha',
    name: 'Runway Gen-3 Alpha',
    canonicalId: 'runway-gen-3',
    provider: 'replicate',
    providerModelId: 'runway/gen-3-alpha',
    displayName: 'Runway Gen-3 Alpha Video',
    status: 'active',
    category: 'video',
    modalities: { input: ['text', 'image'], output: ['video'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: true, streaming: false, mcp: false, video: true },
    contextWindow: 16000,
    supportsVision: true,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Runway photorealistic video generation with structural control.',
    source: 'curated',
  },

  // Audio & Voice Models
  {
    id: 'whisper-large-v3',
    name: 'Whisper Large v3 (Transcription)',
    canonicalId: 'whisper-large-v3',
    provider: 'openai',
    providerModelId: 'whisper-large-v3',
    displayName: 'OpenAI Whisper Large v3',
    status: 'active',
    category: 'audio',
    modalities: { input: ['audio'], output: ['text'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: false, mcp: false, audio: true },
    contextWindow: 32000,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'State-of-the-art multilingual speech recognition and audio transcription.',
    source: 'curated',
  },
  {
    id: 'tts-1-hd',
    name: 'OpenAI TTS-1 HD (Voice)',
    canonicalId: 'tts-1-hd',
    provider: 'openai',
    providerModelId: 'tts-1-hd',
    displayName: 'OpenAI Text-to-Speech HD',
    status: 'active',
    category: 'audio',
    modalities: { input: ['text'], output: ['audio'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: false, mcp: false, audio: true },
    contextWindow: 4096,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Studio-grade natural text-to-speech synthesis with 6 expressive voices.',
    source: 'curated',
  },
  {
    id: 'elevenlabs/turbo-v2',
    name: 'ElevenLabs Turbo v2 (Voice)',
    canonicalId: 'eleven-turbo-v2',
    provider: 'replicate',
    providerModelId: 'elevenlabs/turbo-v2',
    displayName: 'ElevenLabs Turbo v2 Voice',
    status: 'active',
    category: 'audio',
    modalities: { input: ['text'], output: ['audio'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: false, mcp: false, audio: true },
    contextWindow: 4096,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Ultra-low latency expressive speech synthesis across 29 languages.',
    source: 'curated',
  },
  {
    id: 'suno/chirp-v3',
    name: 'Suno v3 (Music & Audio)',
    canonicalId: 'suno-v3',
    provider: 'replicate',
    providerModelId: 'suno/chirp-v3',
    displayName: 'Suno AI Music Generator v3',
    status: 'active',
    category: 'audio',
    modalities: { input: ['text'], output: ['audio'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: false, mcp: false, audio: true },
    contextWindow: 4096,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Full-length studio quality vocal songs and instrumental soundscapes.',
    source: 'curated',
  },

  // Image Generation Models
  {
    id: 'dall-e-3',
    name: 'DALL-E 3 (Image)',
    canonicalId: 'dall-e-3',
    provider: 'openai',
    providerModelId: 'dall-e-3',
    displayName: 'OpenAI DALL-E 3',
    status: 'active',
    category: 'image',
    modalities: { input: ['text'], output: ['image'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: false, mcp: false, image: true },
    contextWindow: 4096,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'OpenAI flagship image generation model with high prompt adherence.',
    source: 'curated',
  },
  {
    id: 'google/imagen-3',
    name: 'Imagen 3 (Image)',
    canonicalId: 'imagen-3',
    provider: 'google',
    providerModelId: 'imagen-3',
    displayName: 'Google Imagen 3',
    status: 'active',
    category: 'image',
    modalities: { input: ['text'], output: ['image'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: false, mcp: false, image: true },
    contextWindow: 4096,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Google DeepMind highest quality text-to-image synthesis model.',
    source: 'curated',
  },
  {
    id: 'black-forest-labs/flux-1-schnell',
    name: 'FLUX.1 Schnell (Image)',
    canonicalId: 'flux-1-schnell',
    provider: 'replicate',
    providerModelId: 'black-forest-labs/flux-1-schnell',
    displayName: 'FLUX.1 Schnell',
    status: 'active',
    category: 'image',
    modalities: { input: ['text'], output: ['image'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: false, mcp: false, image: true },
    contextWindow: 4096,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Black Forest Labs ultra-fast 12B parameter photorealistic image generator.',
    source: 'curated',
  },
];



/**
 * Deprecated / retired models for explicit lookup and legacy tracking.
 */
export const LEGACY_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-4',
    name: 'GPT-4 (Legacy)',
    canonicalId: 'gpt-4',
    provider: 'openai',
    providerModelId: 'gpt-4',
    displayName: 'GPT-4 (Legacy)',
    status: 'deprecated',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: false, streaming: true, mcp: false },
    contextWindow: 8192,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.03, output: 0.06 },
    description: 'Original GPT-4 base release, superseded by GPT-4o.',
    source: 'curated',
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo (Legacy)',
    canonicalId: 'gpt-3.5-turbo',
    provider: 'openai',
    providerModelId: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    status: 'deprecated',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: false, thinking: false, tools: true, vision: false, streaming: true, mcp: false },
    contextWindow: 16384,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.0015, output: 0.002 },
    description: 'Legacy compact model, superseded by GPT-4o Mini.',
    source: 'curated',
  },
  {
    id: 'claude-2.1',
    name: 'Claude 2.1 (Legacy)',
    canonicalId: 'claude-2.1',
    provider: 'anthropic',
    providerModelId: 'claude-2.1',
    displayName: 'Claude 2.1',
    status: 'deprecated',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: true, mcp: false },
    contextWindow: 200000,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0.008, output: 0.024 },
    description: 'Anthropic legacy model with 200K window, superseded by Claude 3.5.',
    source: 'curated',
  },
  {
    id: 'claude-3-sonnet-20240229',
    name: 'Claude 3 Sonnet (Deprecated)',
    canonicalId: 'claude-3-sonnet-20240229',
    provider: 'anthropic',
    providerModelId: 'claude-3-sonnet-20240229',
    displayName: 'Claude 3 Sonnet',
    status: 'deprecated',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: true, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    description: 'Superseded by Claude 3.5 Sonnet.',
    source: 'curated',
  },
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku (Deprecated)',
    canonicalId: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    providerModelId: 'claude-3-haiku-20240307',
    displayName: 'Claude 3 Haiku',
    status: 'deprecated',
    modalities: { input: ['text', 'image'], output: ['text'] },
    capabilities: { reasoning: false, thinking: false, tools: true, vision: true, streaming: true, mcp: true },
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00025, output: 0.00125 },
    description: 'Superseded by Claude 3.5 Haiku.',
    source: 'curated',
  },
  {
    id: 'text-davinci-003',
    name: 'Davinci (Retired)',
    canonicalId: 'text-davinci-003',
    provider: 'openai',
    providerModelId: 'text-davinci-003',
    displayName: 'Davinci 003',
    status: 'retired',
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { reasoning: false, thinking: false, tools: false, vision: false, streaming: false, mcp: false },
    contextWindow: 4096,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0.02, output: 0.02 },
    description: 'Retired completions model.',
    source: 'curated',
  },
];

/**
 * Parses a `data:image/<subtype>;base64,<payload>` URL into its media type and raw base64 payload.
 */
function parseDataUrl(url: unknown): { mimeType: string; data: string } | null {
  if (typeof url !== 'string') return null;
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/** Human-friendly provider labels for user-visible status lines (no internal jargon). */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  google: 'Google Gemini',
  anthropic: 'Claude',
  openai: 'OpenAI GPT',
  'chatgpt-web': 'ChatGPT Web',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  zhipu: 'GLM (Zhipu)',
  glm: 'GLM (Zhipu)',
  xai: 'Grok (xAI)',
  qwen: 'Qwen',
  openrouter: 'OpenRouter',
  github: 'GitHub Models',
  ollama: 'local Ollama',
  antigravity: 'Antigravity bridge',
  'antigravity-ide': 'Antigravity bridge',
  'nvidia-nim': 'NVIDIA NIM',
};

function providerDisplayName(provider: string): string {
  if (PROVIDER_DISPLAY_NAMES[provider]) return PROVIDER_DISPLAY_NAMES[provider];
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * Iterates the `data:` payload lines of an SSE response body.
 * Handles chunk boundaries across network reads, tolerates `\r\n`, ignores
 * event/id/comment lines, and always releases the underlying reader.
 */
async function* iterateSSEData(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      let readTimeout: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<{ done: true; value: undefined }>((_, reject) => {
        readTimeout = setTimeout(() => {
          reject(new Error('SSE stream read timeout (inactivity exceeded 45 seconds)'));
        }, 45000);
      });
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await Promise.race([reader.read(), timeoutPromise]);
      } finally {
        if (readTimeout) clearTimeout(readTimeout);
      }
      const { done, value } = readResult;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload.length > 0) yield payload;
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const remainder = (buffer + decoder.decode()).replace(/\r$/, '');
    if (remainder.startsWith('data:')) {
      const payload = remainder.slice(5).trim();
      if (payload.length > 0) yield payload;
    }
  } finally {
    // Always release the stream reader; cancel errors are not actionable
    try { await reader.cancel(); } catch { /* ignore cancellation failures */ }
  }
}

interface OpenAIStreamToolFragment {
  index: number;
  id?: string;
  name?: string;
  argumentsFragment?: string;
}

interface ParsedOpenAIStreamFrame {
  text?: string;
  thinking?: string;
  toolFragments: OpenAIStreamToolFragment[];
  finishReason?: string;
}

/**
 * Normalizes one OpenAI-compatible SSE `data:` frame into stream chunks.
 * Handles `[DONE]`, delta.content, delta.reasoning_content (DeepSeek R-series),
 * delta.reasoning (OpenAI o-series), fragmented delta.tool_calls, and finish_reason.
 */
function parseOpenAIStreamFrame(frame: string): ParsedOpenAIStreamFrame {
  const empty: ParsedOpenAIStreamFrame = { toolFragments: [] };
  if (!frame || frame === '[DONE]') return empty;
  let evt: any;
  try {
    evt = JSON.parse(frame);
  } catch {
    return empty;
  }
  if (evt?.error) {
    const msg = evt.error?.message || (typeof evt.error === 'string' ? evt.error : 'Stream error from upstream provider');
    throw new Error(msg);
  }
  const choice = evt?.choices?.[0];
  if (!choice) return empty;
  const delta = choice.delta || choice.message || {};
  const result: ParsedOpenAIStreamFrame = {
    toolFragments: [],
    finishReason: typeof choice.finish_reason === 'string' && choice.finish_reason ? choice.finish_reason : undefined,
  };
  if (typeof delta.content === 'string' && delta.content.length > 0) result.text = delta.content;
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) result.thinking = delta.reasoning_content;
  else if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) result.thinking = delta.reasoning;
  const fragments = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
  for (let i = 0; i < fragments.length; i++) {
    const tc = fragments[i] || {};
    result.toolFragments.push({
      index: typeof tc.index === 'number' ? tc.index : i,
      id: typeof tc.id === 'string' && tc.id ? tc.id : undefined,
      name: typeof tc.function?.name === 'string' ? tc.function.name : undefined,
      argumentsFragment: typeof tc.function?.arguments === 'string' ? tc.function.arguments : undefined,
    });
  }
  return result;
}

/**
 * Accumulates streamed OpenAI-style tool_call fragments (index / id / function.name /
 * arguments) into complete calls ready for the agent executor.
 */
class StreamedToolCallAssembler {
  private calls: Map<number, { id: string; name: string; args: string }> = new Map();

  public add(fragment: OpenAIStreamToolFragment): void {
    let targetIndex = typeof fragment.index === 'number' ? fragment.index : 0;
    let entry = this.calls.get(targetIndex);

    // If entry exists and already has a name AND arguments started streaming,
    // and fragment comes in with a different name or different id,
    // this is a separate tool call that must NEVER be merged into the existing one!
    if (entry && (entry.args.length > 0 || (entry.name.length > 0 && fragment.name && !fragment.name.startsWith(entry.name) && !entry.name.startsWith(fragment.name)))) {
      if ((fragment.id && entry.id && fragment.id !== entry.id) || (fragment.name && fragment.name !== entry.name)) {
        // Allocate a new distinct slot
        targetIndex = Math.max(...Array.from(this.calls.keys()), 0) + 1;
        entry = undefined;
      }
    }

    if (!entry) {
      entry = { id: '', name: '', args: '' };
    }

    if (fragment.id) entry.id = fragment.id;
    if (fragment.name) {
      if (!entry.name) {
        entry.name = fragment.name;
      } else if (!entry.name.includes(fragment.name) && !fragment.name.includes(entry.name)) {
        if (entry.args.length > 0) {
          // Arguments already started, this is a new tool call
          targetIndex = Math.max(...Array.from(this.calls.keys()), 0) + 1;
          this.calls.set(targetIndex, { id: fragment.id || '', name: fragment.name, args: fragment.argumentsFragment || '' });
          return;
        } else {
          entry.name += fragment.name;
        }
      }
    }
    if (fragment.argumentsFragment) entry.args += fragment.argumentsFragment;
    this.calls.set(targetIndex, entry);
  }

  public hasCalls(): boolean {
    for (const call of this.calls.values()) {
      if (call.name.trim().length > 0) return true;
    }
    return false;
  }

  public assemble(): any[] {
    const assembled: any[] = [];
    let index = 0;
    for (const call of this.calls.values()) {
      const name = call.name.trim();
      if (!name) continue;
      assembled.push({
        id: call.id || `tool-${Date.now()}-${index}`,
        tool: name,
        params: safeJson(call.args || '{}'),
        requiresApproval: false,
        status: 'approved',
        timestamp: Date.now(),
      });
      index += 1;
    }
    return assembled;
  }
}

/**
 * Consumes an already-connected OpenAI-compatible SSE response and re-emits router chunks.
 * Text/thinking deltas are yielded immediately; tool_call fragments land in the assembler;
 * full text and finish_reason accumulate in the sink for post-stream processing.
 */
async function* consumeOpenAICompatibleSSE(
  res: Response,
  assembler: StreamedToolCallAssembler,
  sink: { fullText: string; finishReason: string },
  externalSignal?: AbortSignal
): AsyncGenerator<{ delta?: string; thinking?: string }> {
  for await (const frame of iterateSSEData(res)) {
    if (externalSignal?.aborted) return;
    const parsed = parseOpenAIStreamFrame(frame);
    if (parsed.thinking) yield { thinking: parsed.thinking };
    if (parsed.text) {
      sink.fullText += parsed.text;
      yield { delta: parsed.text };
    }
    for (const fragment of parsed.toolFragments) assembler.add(fragment);
    if (parsed.finishReason) sink.finishReason = parsed.finishReason;
  }
}

/** Yields buffered fallback text immediately in ~800 character chunks — no artificial pacing. */
function* bufferedTextChunks(text: string): Generator<{ delta: string }> {
  if (!text) return;
  if (text.length <= 800) {
    yield { delta: text };
    return;
  }
  for (let offset = 0; offset < text.length; offset += 800) {
    yield { delta: text.slice(offset, offset + 800) };
  }
}

/**
 * Converts OpenAI-shaped conversation messages into Anthropic /v1/messages format:
 * - system prompt moves to the top-level `system` parameter,
 * - assistant messages with tool_calls become content blocks with tool_use entries,
 * - role:'tool' outputs merge into a following user message of tool_result blocks,
 * - array-content user messages map text/image_url parts to Anthropic block types.
 */
function toAnthropicMessages(messages: any[], systemPrompt?: string): { system?: string; messages: any[] } {
  const converted: any[] = [];
  let pendingToolResults: any[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      converted.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: typeof msg.tool_call_id === 'string' && msg.tool_call_id.trim().length > 0 ? msg.tool_call_id.trim() : `toolu_${Date.now()}`,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
      });
      continue;
    }

    flushToolResults();

    if (msg.role === 'assistant') {
      const blocks: any[] = [];
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === 'text' && part.text) blocks.push({ type: 'text', text: String(part.text) });
        }
      } else if (typeof msg.content === 'string' && msg.content.length > 0) {
        blocks.push({ type: 'text', text: msg.content });
      }
      for (const call of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
        blocks.push({
          type: 'tool_use',
          id: call.id || `toolu_${Date.now()}_${blocks.length}`,
          name: call.function?.name || call.tool || '',
          input: safeJson(call.function?.arguments ?? call.params ?? {}),
        });
      }
      converted.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : [{ type: 'text', text: '(continuing)' }],
      });
      continue;
    }

    // user messages (including OpenAI vision part arrays)
    if (Array.isArray(msg.content)) {
      const blocks: any[] = [];
      for (const part of msg.content) {
        if (part?.type === 'text' && part.text) {
          blocks.push({ type: 'text', text: String(part.text) });
        } else if (part?.type === 'image_url') {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
          const parsedImage = parseDataUrl(url);
          if (parsedImage) {
            blocks.push({ type: 'image', source: { type: 'base64', media_type: parsedImage.mimeType, data: parsedImage.data } });
          }
        }
      }
      if (blocks.length > 0) {
        converted.push({ role: 'user', content: blocks });
        continue;
      }
    }

    let text = typeof msg.content === 'string' ? msg.content : msg.content == null ? '' : String(msg.content);
    text = text
      .replace(/!\[[^\]]*\]\(data:image\/[^)]*\)/g, '[image attached]')
      .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image attached]');
    converted.push({ role: 'user', content: [{ type: 'text', text: text.length > 0 ? text : '(continue)' }] });
  }

  flushToolResults();

  // Anthropic requires strict user/assistant alternation — merge consecutive same-role turns.
  const merged: any[] = [];
  for (const entry of converted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === entry.role) {
      previous.content = [...previous.content, ...entry.content];
    } else {
      merged.push(entry);
    }
  }
  if (merged.length > 0 && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: [{ type: 'text', text: '(resume task)' }] });
  }

  return {
    system: systemPrompt && systemPrompt.length > 0 ? systemPrompt : undefined,
    messages: merged,
  };
}

interface VisionHandoffPlan {
  provider: string;
  modelId: string;
  userText: string;
  images: string[];
  notice: string;
}

const VISION_HANDOFF_SYSTEM_PROMPT = `You are an expert multimodal visual-to-code engineer. Analyze the attached UI screenshot(s) in comprehensive technical detail:
1. Exact layout architecture (flexbox/grid, spacing scale, margins, paddings).
2. Color palette tokens (backgrounds, surfaces, borders, text primary/muted, accents).
3. Typography scale (headers, body font, weights, line heights).
4. All UI components, buttons, inputs, icons, cards, and state transitions.
5. All visible text copy and labels verbatim.
Provide a clean structured Markdown specification so a developer LLM can implement it pixel-perfect.`;

export const isDummyApiKey = (k?: string): boolean => {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return false; // allow mock test keys during test runs
  }
  if (!k || typeof k !== 'string') return true;
  const trimmed = k.trim();
  if (trimmed.length < 8) return true;
  return /^(sk-test-|sk-ant-test-|gsk-test-|test-key|sk-dummy|local-no|placeholder|dummy)/i.test(trimmed);
};

export class ModelRouter {
  private customProviders: Map<string, CustomProviderConfig> = new Map();
  private activeModelId: string = 'auto';
  private stickyAutoProvider: string | null = null;
  private apiKeys: Record<string, string> = {};
  // Context usage of the most recent streaming run (estimate chars/4 when the
  // provider returns nothing) — index.ts attaches it to the done packet.
  public lastRunUsage: { contextUsed: number; contextWindow: number; contextRemaining: number; outputTokens: number } | null = null;

  // Dynamic remote catalog (OpenRouter / ChatGPT Web / Zhipu) with a 10 minute cache
  private remoteModels: ModelDefinition[] = [];
  private remoteModelsFetchedAt: number = 0;
  private remoteModelsInFlight: Promise<{ added: number }> | null = null;
  private unroutedProvidersWarned: Set<string> = new Set();

  constructor() {
    // 1. Load environment variables
    if (process.env.ANTHROPIC_API_KEY) this.apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
    if (process.env.OPENAI_API_KEY) this.apiKeys.openai = process.env.OPENAI_API_KEY;
    if (process.env.GEMINI_API_KEY) this.apiKeys.google = process.env.GEMINI_API_KEY;
    if (process.env.GOOGLE_API_KEY) this.apiKeys.google = process.env.GOOGLE_API_KEY;
    if (process.env.DEEPSEEK_API_KEY) this.apiKeys.deepseek = process.env.DEEPSEEK_API_KEY;
    if (process.env.OPENROUTER_API_KEY) this.apiKeys.openrouter = process.env.OPENROUTER_API_KEY;
    if (process.env.GROQ_API_KEY) this.apiKeys.groq = process.env.GROQ_API_KEY;
    if (process.env.SARVAM_API_KEY) this.apiKeys.sarvam = process.env.SARVAM_API_KEY.trim();
    if (process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY) this.apiKeys.github = (process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY)!;

    // 2. Synchronously load all saved keys from SQLite database
    try {
      const rows = db.prepare('SELECT id, api_key FROM providers WHERE api_key IS NOT NULL').all() as any[];
      for (const row of rows) {
        if (row.api_key && row.api_key.trim().length > 0) {
          const trimmed = row.api_key.trim();
          this.apiKeys[row.id] = trimmed;
          this.apiKeys[row.id.toLowerCase()] = trimmed;
        }
      }
    } catch {
      // Providers table may not exist yet — env vars loaded above are still honored
    }

    // Detect local Ollama once at boot; refreshed lazily before each routing decision
    this.probeOllama(true).catch(() => undefined);

    // Fire-and-forget remote catalog discovery (safe: never throws, cached 10 min)
    this.refreshRemoteModels().catch(() => ({ added: 0 }));
  }

  public setApiKey(provider: string, key: string): void {
    this.apiKeys[provider] = key;
    // Never persist dummy test keys or pollute SQLite during unit tests
    if (process.env.NODE_ENV === 'test' || process.env.VITEST || /^(sk-test-|sk-ant-test-|gsk-test-|test-key|sk-dummy|local-no|placeholder|dummy)/i.test(key.trim())) {
      return;
    }
    try {
      db.prepare(`
        INSERT INTO providers (id, name, api_key, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET api_key=excluded.api_key, updated_at=CURRENT_TIMESTAMP
      `).run(provider, provider, key);
    } catch {
      // Persistence is best-effort — the in-memory key above is already active
    }
  }

  public setBaseUrl(provider: string, url: string): void {
    try {
      db.prepare(`
        INSERT INTO providers (id, name, base_url, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, updated_at=CURRENT_TIMESTAMP
      `).run(provider, provider, url);
    } catch {
      // Persistence is best-effort
    }
  }

  public getApiKey(provider: string): string | undefined {
    if (this.apiKeys[provider] && this.apiKeys[provider].trim().length > 0 && !isDummyApiKey(this.apiKeys[provider])) {
      return this.apiKeys[provider].trim();
    }
    try {
      const row = db.prepare('SELECT api_key FROM providers WHERE id = ?').get(provider) as any;
      if (row?.api_key && row.api_key.trim().length > 0 && !isDummyApiKey(row.api_key)) {
        this.apiKeys[provider] = row.api_key.trim();
        return row.api_key.trim();
      }
    } catch {
      // DB lookup failed — treat as if no stored key exists
    }
    return undefined;
  }

  public getCredential(provider: string): {
    apiKey?: string;
    cookieData?: string;
    authType: string;
    baseUrl?: string;
    headers?: Record<string, string>;
  } {
    const key = this.getApiKey(provider);
    let cookieData: string | undefined;
    let authType = 'api-key';
    let baseUrl: string | undefined;
    let headers: Record<string, string> = {};

    try {
      let row = db.prepare('SELECT * FROM providers WHERE id = ?').get(provider) as any;

      // Cross-lookup for ChatGPT Web session cookies when querying chatgpt-web
      if (!key && (!row?.cookie_data || !row.cookie_data.trim()) && (provider === 'chatgpt-web' || provider === 'chatgpt')) {
        const altRow = db.prepare('SELECT * FROM providers WHERE id = ?').get('openai') as any;
        if (altRow?.cookie_data && altRow.cookie_data.trim().length > 0) {
          if (!row) {
            row = altRow;
          } else {
            row.cookie_data = altRow.cookie_data;
          }
        }
      }

      if (row) {
        if (row.cookie_data && row.cookie_data.trim().length > 0) {
          cookieData = providerAuthHandler.normalizeCookies(row.cookie_data.trim());
        }
        if (row.auth_type) {
          authType = row.auth_type;
        }
        if (row.base_url) {
          baseUrl = row.base_url;
        }
        if (row.headers) {
          try {
            headers = typeof row.headers === 'string' ? JSON.parse(row.headers) : row.headers;
          } catch {
            // Malformed stored headers — keep the default empty header set
          }
        }
      }
    } catch {
      // Provider row unreadable — fall back to in-memory credentials only
    }

    return {
      apiKey: key,
      cookieData,
      authType,
      baseUrl,
      headers,
    };
  }

  /**
   * Availability model: a provider counts as available only when it holds a real
   * credential (API key, cookie session) — or is detected-local Ollama / a live
   * local gateway. Unconfigured providers are never attempted and their failures
   * are never surfaced.
   */
  private ollamaAvailable: boolean = false;
  private ollamaLastProbeAt: number = 0;

  public hasCredential(provider: string, modelId?: string): boolean {
    if (provider === 'pollinations') return true; // Free tier needs no credential
    if (provider === 'custom' || provider.startsWith('custom-')) {
      const customEntries = customModelsManager.getAllCustomModels();
      if (modelId) {
        const match = customEntries.find((c) => c.modelId === modelId || c.id === modelId || c.name === modelId);
        if (match && (match.config?.baseUrl || match.config?.apiKey)) return true;
      }
      if (customEntries.some((c) => c.config?.baseUrl || c.config?.apiKey)) return true;
    }
    const cred = this.getCredential(provider);
    if ((cred.apiKey && cred.apiKey.trim().length > 0 && !isDummyApiKey(cred.apiKey)) || (cred.cookieData && cred.cookieData.trim().length > 0)) {
      return true;
    }
    if (cred.baseUrl && (provider === 'custom' || provider === 'ollama' || provider.startsWith('custom-'))) {
      return true;
    }
    // Antigravity rides the local Google sign-in (~/.gemini/oauth_creds.json) when no
    // explicit bridge endpoint is configured — zero manual auth for the user.
    return isAntigravityProvider(provider) && !cred.baseUrl && hasLocalAntigravitySignIn();
  }

  public isProviderAvailable(provider: string, modelId?: string): boolean {
    if (provider === 'ollama') return this.ollamaAvailable;
    if (provider === 'pollinations') return true; // Free tier — no credential, always routable
    return this.hasCredential(provider, modelId);
  }

  /** Cached Ollama reachability probe (60s TTL, never throws). */
  public async probeOllama(force: boolean = false): Promise<boolean> {
    if (!force && Date.now() - this.ollamaLastProbeAt < 60000) {
      return this.ollamaAvailable;
    }
    this.ollamaLastProbeAt = Date.now();
    try {
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
      const data = res.ok ? await res.json().catch(() => null) : null;
      this.ollamaAvailable = Boolean(data?.models?.length);
    } catch {
      this.ollamaAvailable = false;
    }
    return this.ollamaAvailable;
  }

  /** Providers that can actually serve a request right now (credential-backed or detected-local). */
  public listAvailableProviders(): string[] {
    const known = [
      'google',
      'anthropic',
      'openai',
      'chatgpt-web',
      'groq',
      'deepseek',
      'zhipu',
      'glm',
      'xai',
      'qwen',
      'openrouter',
      'github',
      'antigravity',
      'antigravity-ide',
    ];
    const available = known.filter((p) => this.hasCredential(p));
    if (this.ollamaAvailable) available.push('ollama');
    return available;
  }

  /**
   * Diagnostic snapshot: every model the user *could* plausibly run right now,
   * grouped by provider, with a real readiness reason.
   *
   * The UI uses this to populate the Model Selector dropdown so users never see
   * "ghost models" that look selectable but error out at request time.
   */
  public getUsableModels(): {
    usable: ModelDefinition[];
    providers: Array<{
      provider: string;
      status: 'connected' | 'free' | 'local' | 'missing-key';
      reason: string;
      modelCount: number;
    }>;
  } {
    const all = this.getAllModels();
    const providersSeen = new Set<string>();
    const out: ModelDefinition[] = [];
    const providerReports: Array<{
      provider: string;
      status: 'connected' | 'free' | 'local' | 'missing-key';
      reason: string;
      modelCount: number;
    }> = [];

    const statusOf = (prov: string): {
      status: 'connected' | 'free' | 'local' | 'missing-key';
      reason: string;
    } => {
      if (prov === 'pollinations') return { status: 'free', reason: 'Free tier — always routable' };
      if (prov === 'ollama') {
        return this.ollamaAvailable
          ? { status: 'local', reason: 'Local Ollama detected on :11434' }
          : { status: 'missing-key', reason: 'Start Ollama locally to enable' };
      }
      if (isAntigravityProvider(prov)) {
        if (hasLocalAntigravitySignIn())
          return { status: 'local', reason: 'Antigravity using local Google sign-in' };
        if (this.hasCredential(prov))
          return { status: 'connected', reason: 'Antigravity credential configured' };
        return { status: 'missing-key', reason: 'Sign in to Google or paste an API key' };
      }
      if (this.hasCredential(prov)) return { status: 'connected', reason: 'API key configured' };
      return { status: 'missing-key', reason: 'Add an API key in Settings' };
    };

    for (const m of all) {
      const prov = String(m.provider);
      const s = statusOf(prov);
      if (!providersSeen.has(prov)) {
        providersSeen.add(prov);
        providerReports.push({ provider: prov, ...s, modelCount: 0 });
      }
      if (s.status === 'connected' || s.status === 'free' || s.status === 'local') {
        out.push(m);
        const bucket = providerReports.find((r) => r.provider === prov);
        if (bucket) bucket.modelCount += 1;
      }
    }

    // Synthesize a free-tier candidate for any provider with no usable models yet,
    // so the dropdown at least surfaces something the user can click.
    if (out.length === 0 && !out.some((m) => m.provider === 'pollinations')) {
      out.push({
        id: 'openai',
        name: 'OpenAI (free tier via Pollinations)',
        provider: 'pollinations' as any,
        contextWindow: 8192,
        supportsVision: false,
        supportsTools: false,
        costPer1kTokens: { input: 0, output: 0 },
        description: 'Always-on free tier fallback. Add an API key for higher quality.',
      });
    }

    // Sort so models a provider actually reported (source !== 'curated') rank above
    // hand-written catalog guesses. Curated ids are maintained by hand and can drift
    // out of date; letting them outrank live-discovered ids is how stale or invented
    // names ended up at the top of the picker.
    const isVerified = (m: ModelDefinition): boolean =>
      (m as any)?.source !== undefined && (m as any)?.source !== 'curated';
    out.sort((a, b) => {
      const va = isVerified(a) ? 0 : 1;
      const vb = isVerified(b) ? 0 : 1;
      if (va !== vb) return va - vb;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });

    return { usable: out, providers: providerReports };
  }

  private providerCooldowns: Map<string, number> = new Map();

  public recordProviderCooldown(provider: string, durationMs: number = 10000): void {
    this.providerCooldowns.set(provider, Date.now() + durationMs);
  }

  /**
   * Dynamically ranks providers from best to worst based on:
   * 1. Verified active API key or Cookie session availability
   * 2. Real-time rate-limit backoff status
   * 3. Frontier intelligence tier rating (Claude Sonnet 5 / GPT-5.1 / Gemini 3 Pro / Groq 120B / DeepSeek V3.2 / GLM-4.6)
   * 4. Multimodal vision requirement match
   * 5. User explicit model preference
   */
  public rankProvidersDynamically(requestedModel: ModelDefinition, hasVisionRequirement: boolean = false): string[] {
    const allProviders = [
      'google',
      'anthropic',
      'openai',
      'chatgpt-web',
      'groq',
      'deepseek',
      'zhipu',
      'glm',
      'xai',
      'qwen',
      'openrouter',
      'github',
      'ollama',
      'pollinations',
      'antigravity',
      'antigravity-ide',
    ];
    const scores: Record<string, number> = {};
    const now = Date.now();

    for (const provider of allProviders) {
      let score = 0;

      // 1. Availability check — unconfigured providers are never attempted.
      // Ollama only joins the chain when a local daemon with models was actually detected.
      const isAvailable = provider === 'ollama' ? this.ollamaAvailable : this.hasCredential(provider);
      if (!isAvailable) {
        scores[provider] = -1000; // No credentials configured -> unavailable
        continue;
      }

      if (provider === 'ollama') {
        score += 60; // Detected-local fallback
      } else {
        score += 100; // Verified key or cookie session configured
      }

      // 2. Cooldown / Rate Limit penalty
      const cooldownUntil = this.providerCooldowns.get(provider) || 0;
      if (cooldownUntil > now) {
        // In rate-limit backoff cooldown
        score -= 250;
      }

      // 3. Provider Quality & Benchmark Capability
      switch (provider) {
        case 'anthropic': // Claude Opus/Sonnet/Fable 5 (Best tool calling & coding reasoning)
          score += 98;
          break;
        case 'openai': // GPT-5.1 / GPT-5 family / o-series (Frontier reasoning)
          score += 95;
          break;
        case 'chatgpt-web': // Luna / GPT-5 free web session (incl. image generation)
          score += 93;
          break;
        case 'google': // Gemini 3 Pro / 3.7 Flash / 2.5 (1M context + multimodal)
          score += 92;
          break;
        case 'antigravity': // Antigravity IDE bridge (Available when explicitly selected or as fallback)
        case 'antigravity-ide':
          score += 50;
          break;
        case 'groq': // Groq GPT-OSS 120B / Qwen 3.6 27B (500+ tok/s LPUs)
          score += 90;
          break;
        case 'deepseek': // DeepSeek V3.2 / R1 (Stable aliases, deep open reasoning)
          score += 88;
          break;
        case 'zhipu': // GLM-4.6 flagship coding / GLM-4.5 Air
        case 'glm':
          score += 87;
          break;
        case 'xai': // Grok-4 / Grok Code Fast 1
          score += 86;
          break;
        case 'qwen': // Qwen3 Coder Plus / Qwen3 Max
          score += 84;
          break;
        case 'openrouter': // 300+ frontier models behind one key
          score += 80;
          break;
        case 'github':
          score += 75;
          break;
        case 'ollama':
          score += 65;
          break;
        case 'pollinations':
          score += 40; // Free no-auth tier — real, but tried after keyed/local providers
          break;
      }

      // 4. Multimodal Vision Match
      if (hasVisionRequirement) {
        if (['anthropic', 'openai', 'google', 'groq', 'chatgpt-web', 'xai', 'qwen', 'antigravity', 'antigravity-ide'].includes(provider)) {
          score += 40;
        }
      }

      // 5. User Explicit Preference
      if (requestedModel.id !== 'auto' && requestedModel.provider !== 'sutra' && (requestedModel.provider as string) !== 'astra-auto' && requestedModel.provider === provider) {
        score += 300; // Top priority to user-selected model
      }

      scores[provider] = score;
    }

    return allProviders
      .filter((p) => (scores[p] ?? -1000) > -500)
      .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  }

  /**
   * Auto-Vision Handoff:
   * When images are present and the active model is text-only, detects the embedded
   * base64 images, picks the best available image-capable provider, and returns an
   * executable vision plan. streamChat then runs that plan against the provider's real
   * SSE endpoint and streams the vision model's answer back as the response through the
   * normal delta path. If no image-capable provider is configured, the plan is skipped
   * silently and the normal provider chain continues.
   */
  public async processMultimodalAutoHandoff(
    messages: { role: string; content: any; tool_calls?: any[]; tool_call_id?: string }[],
    primaryModel: ModelDefinition,
    signal?: AbortSignal
  ): Promise<{ augmentedMessages: any[]; hasImage?: boolean; visionPlan?: VisionHandoffPlan }> {
    if (signal?.aborted) {
      return { augmentedMessages: messages.map((m) => ({ ...m })) };
    }

    const imageDataUrls: string[] = [];
    const cleanMessages: any[] = [];

    for (const msg of messages) {
      const copy: any = { ...msg };
      if (typeof msg.content === 'string') {
        const embeddedImages = msg.content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g);
        if (embeddedImages && embeddedImages.length > 0) {
          imageDataUrls.push(...embeddedImages);
        }
        // String contents stay verbatim here; heavy data URLs are scrubbed below only once
        // a real handoff is confirmed, so vision-capable primary models keep their pixels.
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === 'image_url') {
            const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
            if (url && /^data:image\//.test(url)) imageDataUrls.push(url);
          }
        }
        if (!primaryModel.supportsVision) {
          // Text-only primary: flatten OpenAI-style part arrays to plain text.
          let textParts = '';
          for (const part of msg.content) {
            if (part?.type === 'text') textParts += part.text + ' ';
          }
          copy.content = textParts.trim() || 'Analyze the provided image.';
        }
      } else if (msg.content === null || msg.content === undefined) {
        copy.content = null;
      } else {
        copy.content = String(msg.content);
      }
      cleanMessages.push(copy);
    }

    const lastUserMessage = [...cleanMessages].reverse().find((m) => m.role === 'user' && m.content);
    if (primaryModel.supportsVision || imageDataUrls.length === 0 || !lastUserMessage) {
      return { augmentedMessages: cleanMessages, hasImage: imageDataUrls.length > 0 };
    }

    // Choose the best available image-capable endpoint (priority: speed first).
    // Available-only: providers without any credential are skipped entirely.
    const visionCandidates: Array<{ provider: string; modelId: string }> = [];
    if (this.hasCredential('google')) visionCandidates.push({ provider: 'google', modelId: 'gemini-3.7-flash' });
    if (this.hasCredential('chatgpt-web')) visionCandidates.push({ provider: 'chatgpt-web', modelId: 'luna' });
    if (this.hasCredential('openai')) visionCandidates.push({ provider: 'openai', modelId: 'gpt-5' });
    if (this.hasCredential('anthropic')) visionCandidates.push({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
    if (hasLocalAntigravitySignIn()) visionCandidates.push({ provider: 'antigravity', modelId: 'gemini-3.7-flash' });

    if (visionCandidates.length === 0) {
      // No image-capable provider configured — skip silently; the normal chain continues.
      return { augmentedMessages: cleanMessages, hasImage: true };
    }

    const { provider: visionProvider, modelId: visionModelId } = visionCandidates[0];

    const rawUserText = typeof lastUserMessage.content === 'string'
      ? lastUserMessage.content
      : Array.isArray(lastUserMessage.content)
        ? lastUserMessage.content.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join(' ')
        : '';
    const userText = rawUserText.trim().length > 0 ? rawUserText : 'Analyze the attached image(s).';

    // Handoff confirmed: scrub multi-megabyte base64 payloads out of the visible context.
    for (const msg of cleanMessages) {
      if (typeof msg.content === 'string') {
        msg.content = msg.content
          .replace(/!\[[^\]]*\]\(data:image\/[^)]*\)/g, '[image attached]')
          .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image attached]');
      }
    }

    return {
      augmentedMessages: cleanMessages,
      hasImage: true,
      visionPlan: {
        provider: visionProvider,
        modelId: visionModelId,
        userText,
        images: imageDataUrls.slice(-4),
        notice: `Auto-Vision: ${primaryModel.name} is text-only, so your image was analyzed by ${visionModelId} on ${providerDisplayName(visionProvider)}.`,
      },
    };
  }

  /**
   * Executes a prepared Auto-Vision plan against the provider's real SSE endpoint,
   * yielding the vision model's answer incrementally. Falls back to ONE buffered
   * request per attempt when streaming is refused. Yields nothing when the endpoint
   * never answers — callers then continue their normal provider chain silently.
   */
  private async *streamVisionHandoffAnswer(plan: VisionHandoffPlan, signal?: AbortSignal): AsyncGenerator<string> {
    const key = this.getApiKey(plan.provider);
    if (!key || plan.images.length === 0) return;

    if (plan.provider === 'google') {
      const parts: any[] = [{ text: `${VISION_HANDOFF_SYSTEM_PROMPT}\n\n${plan.userText}` }];
      for (const url of plan.images) {
        const parsedImage = parseDataUrl(url);
        if (parsedImage) parts.push({ inlineData: { mimeType: parsedImage.mimeType, data: parsedImage.data } });
      }
      const requestBody = JSON.stringify({ contents: [{ role: 'user', parts }] });
      const requestHeaders = { 'Content-Type': 'application/json' };
      const modelsToTry = plan.modelId !== 'gemini-2.5-flash' ? [plan.modelId, 'gemini-2.5-flash'] : [plan.modelId];

      for (const modelId of modelsToTry) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
            signal,
          });
          if (res.ok && res.body) {
            let delivered = false;
            for await (const frame of iterateSSEData(res)) {
              if (signal?.aborted) return;
              let evt: any;
              try { evt = JSON.parse(frame); } catch { continue; }
              for (const p of evt?.candidates?.[0]?.content?.parts || []) {
                if (typeof p.text === 'string' && p.text) {
                  delivered = true;
                  yield p.text;
                }
              }
            }
            if (delivered) return;
          }
        } catch {
          if (signal?.aborted) return;
        }

        // Buffered fallback (once per model)
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
            signal,
          });
          if (res.ok) {
            const data = await res.json();
            const text = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
            if (text.trim()) {
              yield text;
              return;
            }
          }
        } catch {
          if (signal?.aborted) return;
        }
      }
      return;
    }

    if (plan.provider === 'anthropic') {
      const blocks: any[] = [];
      for (const url of plan.images) {
        const parsedImage = parseDataUrl(url);
        if (parsedImage) blocks.push({ type: 'image', source: { type: 'base64', media_type: parsedImage.mimeType, data: parsedImage.data } });
      }
      blocks.push({ type: 'text', text: `${VISION_HANDOFF_SYSTEM_PROMPT}\n\n${plan.userText}` });
      const bufferedBody: any = {
        model: plan.modelId,
        max_tokens: 16384,
        system: VISION_HANDOFF_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: blocks }],
      };
      const requestHeaders = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({ ...bufferedBody, stream: true }),
          signal,
        });
        if (res.ok && res.body) {
          let delivered = false;
          for await (const frame of iterateSSEData(res)) {
            if (signal?.aborted) return;
            let evt: any;
            try { evt = JSON.parse(frame); } catch { continue; }
            if (evt.type === 'message_stop') break;
            if (evt.type === 'content_block_delta') {
              const d = evt.delta || {};
              if (d.type === 'text_delta' && d.text) {
                delivered = true;
                yield d.text;
              }
            }
          }
          if (delivered) return;
        }
      } catch {
        if (signal?.aborted) return;
      }

      // Buffered fallback (once)
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(bufferedBody),
          signal,
        });
        if (res.ok) {
          const data = await res.json();
          const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text || '').join('');
          if (text.trim()) yield text;
        }
      } catch {
        // Vision handoff is best-effort — no content to fall back to here
      }
      return;
    }

    // Groq / OpenAI: OpenAI-compatible chat completions with image_url parts.
    const baseUrl = PROVIDER_BASE_URLS[plan.provider];
    if (!baseUrl) return;
    const completionsUrl = plan.provider === 'pollinations' ? `${baseUrl}/openai` : `${baseUrl}/chat/completions`;
    const messagesPayload = [
      { role: 'system', content: VISION_HANDOFF_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: plan.userText },
          ...plan.images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ];
    const openAiHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };

    try {
      const res = await resilientFetch(`${completionsUrl}`, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify({ model: plan.modelId, messages: messagesPayload, temperature: 0.2, stream: true }),
        signal,
      });
      if (res.ok && res.body) {
        let delivered = false;
        for await (const frame of iterateSSEData(res)) {
          if (signal?.aborted) return;
          const parsed = parseOpenAIStreamFrame(frame);
          if (parsed.text) {
            delivered = true;
            yield parsed.text;
          }
        }
        if (delivered) return;
      }
    } catch {
      if (signal?.aborted) return;
    }

    // Buffered fallback (once)
    try {
      const res = await resilientFetch(`${completionsUrl}`, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify({ model: plan.modelId, messages: messagesPayload, temperature: 0.2 }),
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text.trim()) yield text;
      }
    } catch {
      // Final fallback exhausted — caller already received any streamed content
    }
  }

  public getAllApiKeys(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(this.apiKeys)) {
      if (v && v.trim().length > 0) result[k] = true;
    }
    // Also include providers with saved cookies or local Antigravity credentials
    try {
      const rows = db.prepare('SELECT id, api_key, cookie_data FROM providers').all() as any[];
      for (const row of rows) {
        if ((row.api_key && row.api_key.trim().length > 0) || (row.cookie_data && row.cookie_data.trim().length > 0)) {
          result[row.id] = true;
        }
      }
    } catch {}
    if (hasLocalAntigravitySignIn()) {
      result['antigravity'] = true;
      result['antigravity-web'] = true;
    }
    return result;
  }

  private customModels: ModelDefinition[] = [];

  /**
   * Live ChatGPT Web session slugs (null until real discovery succeeded).
   * When set, built-in chatgpt-web ids the session does not offer are dropped
   * from the catalog instead of being shown as selectable.
   */
  private chatgptWebLiveIds: string[] | null = null;
  // Per-key live model ids — when discovery succeeds, builtin entries for that
  // provider are replaced so the catalog only shows models the key can use.
  private googleLiveIds: string[] | null = null;
  private groqLiveIds: string[] | null = null;

  public addCustomModel(model: ModelDefinition): void {
    this.customModels = this.customModels.filter(m => m.id !== model.id);
    this.customModels.push(model);
  }

  /**
   * User-added LLM entries from Settings > Custom Models surface directly in the
   * dropdown under their configured provider. A model whose provider has no
   * credential still appears (the UI mutes it as "key needed") but is never routed.
   */
  private getCustomChatModels(): ModelDefinition[] {
    try {
      return customModelsManager.getModelsByCategory('llm').map((entry) => ({
        id: entry.modelId,
        name: entry.name || entry.modelId,
        provider: toProviderId(entry.providerId && entry.providerId.trim() ? entry.providerId : 'custom'),
        baseUrl: entry.config?.baseUrl,
        apiKey: entry.config?.apiKey,
        contextWindow: Number(entry.config?.contextWindow) || 128000,
        supportsVision: Boolean(entry.config?.supportsVision),
        supportsTools: entry.config?.supportsTools !== false,
        costPer1kTokens: { input: 0, output: 0 },
        description: entry.description || 'Custom model added in Settings.',
      } as any));
    } catch {
      return [];
    }
  }

  public getAllModels(): ModelDefinition[] {
    const liveFilter = (m: any): boolean => {
      if ((m.provider as string) === 'chatgpt-web') {
        if (m.id === 'auto') return true;
        return !this.chatgptWebLiveIds || this.chatgptWebLiveIds.includes(m.id);
      }
      if (m.provider === 'google') {
        return !this.googleLiveIds || this.googleLiveIds.some((id) => m.id === id || id.startsWith(m.id));
      }
      if (m.provider === 'groq') {
        return !this.groqLiveIds || this.groqLiveIds.includes(m.id) || this.groqLiveIds.includes(m.id.split('/').pop() || '');
      }
      return true;
    };
    const builtin = BUILTIN_MODELS.filter(liveFilter);
    const all = [...this.remoteModels, ...builtin, ...this.customModels, ...this.getCustomChatModels()];
    for (const cp of this.customProviders.values()) {
      all.push(...cp.models);
    }
    // Deduplicate by provider + id
    return Array.from(new Map(all.map((model) => [`${model.provider}:${model.id}`, model])).values());
  }

  /**
   * Resolves a requested model id to its definition:
   * 1. Compound provider:modelId or provider/modelId (e.g. "chatgpt-web:auto", "antigravity:gemini-2.5-flash")
   * 2. Exact match on ID with matching preferredProvider
   * 3. Exact ID match across any provider
   * 4. Suffix / namespace matching
   */
  /**
   * Closest catalog id to a failed lookup, for "did you mean …?" hints.
   *
   * Ranks by normalised edit distance, falling back to substring containment.
   * Returns null when nothing is remotely close, so callers never print a
   * misleading suggestion.
   */
  public suggestClosestModelId(modelId: string): string | null {
    const target = String(modelId || '').trim().toLowerCase();
    if (!target) return null;

    // Levenshtein distance with a small rolling row (no allocation of a full matrix).
    const distance = (a: string, b: string): number => {
      if (a === b) return 0;
      if (!a.length) return b.length;
      if (!b.length) return a.length;
      let prev = new Array<number>(b.length + 1);
      let curr = new Array<number>(b.length + 1);
      for (let j = 0; j <= b.length; j++) prev[j] = j;
      for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
          const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
          curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
      }
      return prev[b.length];
    };

    let best: { id: string; score: number } | null = null;
    for (const m of this.getAllModels()) {
      const candidate = String(m.id || '').toLowerCase();
      if (!candidate) continue;
      // Containment is a strong signal ("gpt-5" vs "gpt-5.6-sol") — score it well.
      const containment = candidate.includes(target) || target.includes(candidate);
      const dist = distance(target, candidate);
      const score = containment ? dist - 6 : dist;
      if (!best || score < best.score) best = { id: String(m.id), score };
    }

    if (!best) return null;
    // Only suggest when it is plausibly the same model (typo / version drift).
    return best.score <= Math.max(4, Math.floor(target.length / 3)) ? best.id : null;
  }

  public resolveModelDefinition(modelId: string, preferredProvider?: string): ModelDefinition | null {
    if (!modelId || typeof modelId !== 'string') return null;
    const all = this.getAllModels();

    // Normalize duplicate prefixes (e.g. "openrouter:openrouter:ling")
    let cleanModelId = modelId.trim();
    while (/^([a-z0-9_-]+):(\1:)/i.test(cleanModelId)) {
      cleanModelId = cleanModelId.replace(/^([a-z0-9_-]+):/i, '');
    }

    // Direct exact match across catalog before attempting heuristic splitting
    const directExact = all.find((m) =>
      (m.id === cleanModelId || m.canonicalId === cleanModelId || m.providerModelId === cleanModelId) &&
      (!preferredProvider || String(m.provider) === preferredProvider || m.provider === preferredProvider)
    );
    if (directExact) return directExact;

    // 0. Strict ChatGPT Web handling
    if (preferredProvider === 'chatgpt-web' || cleanModelId.startsWith('chatgpt-web:') || cleanModelId.startsWith('chatgpt-web/')) {
      const cleanId = cleanModelId.replace(/^chatgpt-web[:/]/, '');
      const webMatch = all.find((m) => String(m.provider) === 'chatgpt-web' && (m.id === cleanId || m.id === cleanModelId || m.canonicalId === cleanId || m.providerModelId === cleanId || m.id === `chatgpt-web-${cleanId}` || m.name.toLowerCase().includes(cleanId.toLowerCase())));
      if (webMatch) {
        return { ...webMatch, id: cleanId, canonicalId: cleanId, providerModelId: cleanId };
      }
      return {
        id: cleanId,
        name: `${cleanId} (ChatGPT Web)`,
        canonicalId: cleanId,
        provider: toProviderId('chatgpt-web'),
        providerModelId: cleanId,
        displayName: `${cleanId} (ChatGPT Web)`,
        status: 'active',
        modalities: { input: ['text', 'image'], output: ['text'] },
        capabilities: { reasoning: true, thinking: true, tools: true, vision: true, streaming: true, mcp: true },
        contextWindow: estimateContextWindow(cleanId, 128000),
        supportsVision: true,
        supportsTools: true,
        costPer1kTokens: { input: 0, output: 0 },
        description: `ChatGPT Web session model ${cleanId}`,
        source: 'custom',
      };
    }

    // 1. Compound provider:modelId or provider/modelId (only if prefix is a known provider)
    const KNOWN_PROVIDER_PREFIXES = new Set([
      'openrouter', 'google', 'anthropic', 'openai', 'chatgpt-web', 'deepseek',
      'groq', 'xai', 'mistral', 'perplexity', 'cohere', 'replicate', 'suno',
      'elevenlabs', 'minimax', 'luma', 'kuaishou', 'ollama', 'custom', 'sutra', 'antigravity'
    ]);

    if (cleanModelId.includes(':') || cleanModelId.includes('/')) {
      const sep = cleanModelId.includes(':') ? ':' : '/';
      const parts = cleanModelId.split(sep);
      const possibleProv = parts[0].trim().toLowerCase();
      if (KNOWN_PROVIDER_PREFIXES.has(possibleProv)) {
        const prov = possibleProv;
        const mId = parts.slice(1).join(sep).trim();
        const foundCompound = all.find(
          (m) =>
            (String(m.provider) === prov || m.provider === prov) &&
            (m.id === mId || m.canonicalId === mId || m.providerModelId === mId || m.id === `${prov}-${mId}` || m.id === cleanModelId || m.id.endsWith(`/${mId}`))
        );
        if (foundCompound) {
          if (prov === 'chatgpt-web') {
            return { ...foundCompound, id: mId, canonicalId: mId, providerModelId: mId };
          }
          return foundCompound;
        }
        if (prov === 'antigravity' || prov === 'google') {
          const agMatch = ANTIGRAVITY_CANONICAL_MODELS_LIST.find(
            (entry) => entry.canonicalId === mId || entry.providerModelId === mId || entry.wireModelId === mId
          );
          if (agMatch) {
            return {
              id: agMatch.canonicalId,
              name: `${agMatch.displayName} (Antigravity)`,
              canonicalId: agMatch.canonicalId,
              provider: toProviderId('antigravity'),
              providerModelId: agMatch.providerModelId,
              wireModelId: agMatch.wireModelId,
              displayName: agMatch.displayName,
              status: 'active',
              modalities: { input: agMatch.supportsVision ? ['text', 'image'] : ['text'], output: ['text'] },
              capabilities: { reasoning: true, thinking: agMatch.thinkingMode, tools: agMatch.supportsTools, vision: agMatch.supportsVision, streaming: true, mcp: true },
              contextWindow: agMatch.contextWindow,
              supportsVision: agMatch.supportsVision,
              supportsTools: agMatch.supportsTools,
              costPer1kTokens: { input: 0, output: 0 },
              description: agMatch.description,
              source: 'curated',
            };
          }
        }
      }
    }

    // 2. Preferred provider match
    if (preferredProvider) {
      const foundWithProvider = all.find(
        (m) => (String(m.provider) === preferredProvider || m.provider === preferredProvider) && (m.id === modelId || m.canonicalId === modelId || m.providerModelId === modelId || m.id.endsWith(`/${modelId}`))
      );
      if (foundWithProvider) return foundWithProvider;
    }

    // 3. Exact compound string match (provider/id or provider:id)
    const exactCompound = all.find((m) => `${m.provider}/${m.id}` === modelId || `${m.provider}:${m.id}` === modelId);
    if (exactCompound) return exactCompound;

    // 4. Exact ID match (prioritize providers that actually have configured credentials)
    const exactMatches = all.filter((m) => m.id === modelId);
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) {
      const activeMatch = exactMatches.find((m) => this.isProviderAvailable(String(m.provider)));
      if (activeMatch) return activeMatch;
      return exactMatches[0];
    }

    // 5. Suffix match (prioritize providers that actually have configured credentials)
    const suffixMatches = all.filter(
      (m) =>
        m.id.split('/').pop() === modelId ||
        m.id.endsWith(`/${modelId}`) ||
        (modelId.includes('/') && m.id === modelId.split('/').pop())
    );
    if (suffixMatches.length === 1) return suffixMatches[0];
    if (suffixMatches.length > 1) {
      const activeSuffixMatch = suffixMatches.find((m) => this.isProviderAvailable(String(m.provider)));
      if (activeSuffixMatch) return activeSuffixMatch;
      return suffixMatches[0];
    }

    // 5.5 Case-insensitive name and display name match (supports selecting custom models by friendly label)
    const nameMatch = all.find(
      (m) =>
        (m.name && m.name.toLowerCase() === cleanModelId.toLowerCase()) ||
        (m.displayName && m.displayName.toLowerCase() === cleanModelId.toLowerCase())
    );
    if (nameMatch) return nameMatch;

    // The picker intentionally hides Antigravity models until a local Google
    // sign-in is found, but a persisted selection or a mid-run steer must still
    // resolve deterministically. Authentication is checked by the bridge at
    // execution time, where Auto mode can fail over cleanly.
    const antigravityEntry = ANTIGRAVITY_CANONICAL_MODELS_LIST.find(
      (entry) => entry.canonicalId === modelId || entry.providerModelId === modelId
    );
    if (antigravityEntry) {
      return {
        id: antigravityEntry.canonicalId,
        name: `${antigravityEntry.displayName} (Antigravity)`,
        canonicalId: antigravityEntry.canonicalId,
        provider: toProviderId('antigravity'),
        providerModelId: antigravityEntry.providerModelId,
        wireModelId: antigravityEntry.wireModelId,
        displayName: `${antigravityEntry.displayName} (Antigravity)`,
        status: 'active',
        modalities: { input: antigravityEntry.supportsVision ? ['text', 'image'] : ['text'], output: ['text'] },
        capabilities: { reasoning: true, thinking: antigravityEntry.thinkingMode, tools: antigravityEntry.supportsTools, vision: antigravityEntry.supportsVision, streaming: true, mcp: true },
        contextWindow: antigravityEntry.contextWindow,
        supportsVision: antigravityEntry.supportsVision,
        supportsTools: antigravityEntry.supportsTools,
        costPer1kTokens: { input: 0, output: 0 },
        description: antigravityEntry.description,
        source: 'antigravity-catalog',
      };
    }

    // 6. Explicit legacy model fallback (allows direct user lookup of deprecated models)
    const legacy = LEGACY_MODELS.find(
      (m) =>
        m.id === modelId ||
        `${m.provider}:${m.id}` === modelId ||
        `${m.provider}/${m.id}` === modelId ||
        (preferredProvider && m.provider === preferredProvider && m.id === modelId)
    );
    if (legacy) return legacy;

    // Catalog refreshes can omit a provider that has not been authenticated in
    // this process. Preserve a bare, well-known model selection long enough for
    // the normal provider/auth recovery path to handle it rather than silently
    // retaining the previous active model.
    const inferredProvider = modelId.startsWith('claude-')
      ? 'anthropic'
      : modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')
        ? 'openai'
        : modelId.startsWith('deepseek-')
          ? 'deepseek'
          : modelId.startsWith('grok-')
            ? 'xai'
            : null;
    if (inferredProvider) {
      return this.resolveModelDefinition(`${inferredProvider}:${modelId}`);
    }

    // Dynamic resolution for any custom or user-specified model string
    if (preferredProvider || modelId.includes(':') || modelId.includes('/')) {
      let prov = preferredProvider || '';
      let cleanId = modelId.trim();

      // Check for provider prefix with colon e.g. "openrouter:inclusionai/ling-3.0-flash-fin:free" or "openai:gpt-4o"
      const colonIdx = cleanId.indexOf(':');
      if (colonIdx > 0 && !cleanId.startsWith('http://') && !cleanId.startsWith('https://')) {
        const potentialProv = cleanId.slice(0, colonIdx).toLowerCase();
        if (
          PROVIDER_BASE_URLS[potentialProv] ||
          potentialProv === 'sutra' ||
          potentialProv === 'antigravity' ||
          potentialProv === 'google' ||
          potentialProv === 'anthropic' ||
          potentialProv === 'openai' ||
          potentialProv === 'openrouter' ||
          potentialProv === 'custom' ||
          potentialProv === 'chatgpt-web' ||
          potentialProv === 'ollama' ||
          potentialProv === 'deepseek' ||
          potentialProv === 'groq'
        ) {
          prov = prov || potentialProv;
          cleanId = cleanId.slice(colonIdx + 1);
        }
      }

      // Check for provider prefix with slash e.g. "openrouter/inclusionai/ling-3.0-flash-fin:free" or "openai/gpt-4o"
      if (!prov && cleanId.includes('/')) {
        const slashIdx = cleanId.indexOf('/');
        const potentialProv = cleanId.slice(0, slashIdx).toLowerCase();
        if (
          potentialProv === 'openrouter' ||
          potentialProv === 'sutra' ||
          potentialProv === 'antigravity' ||
          potentialProv === 'google' ||
          potentialProv === 'anthropic' ||
          potentialProv === 'openai' ||
          potentialProv === 'custom' ||
          potentialProv === 'ollama' ||
          potentialProv === 'deepseek' ||
          potentialProv === 'groq'
        ) {
          prov = potentialProv;
          cleanId = cleanId.slice(slashIdx + 1);
        }
      }

      prov = prov || (cleanId.includes('/') && this.isProviderAvailable('openrouter') ? 'openrouter' : 'custom');
      cleanId = cleanId.replace(/^\/+/, '');

      // Common typo correction (e.g. winclusionai -> inclusionai)
      if (cleanId.startsWith('winclusionai/')) {
        cleanId = cleanId.replace(/^winclusionai\//, 'inclusionai/');
      }

      return {
        id: cleanId,
        name: cleanId.includes('/') ? cleanId : `${cleanId} (${prov})`,
        canonicalId: cleanId,
        provider: toProviderId(prov),
        providerModelId: cleanId,
        displayName: cleanId.includes('/') ? cleanId : `${cleanId} (${prov})`,
        status: 'active',
        modalities: { input: ['text', 'image'], output: ['text'] },
        capabilities: { reasoning: true, thinking: true, tools: true, vision: true, streaming: true, mcp: true },
        contextWindow: estimateContextWindow(cleanId, 128000),
        supportsVision: true,
        supportsTools: true,
        costPer1kTokens: { input: 0, output: 0 },
        description: `Custom model ${cleanId} via ${prov}`,
        source: 'custom',
      };
    }

    return null;
  }

  /**
   * Antigravity models, built from the bridge's canonical registry.
   *
   * The bridge owns the real Code Assist model ids and their wire mappings, so
   * it — not this file — is the source of truth. We only surface the list when
   * a local Google sign-in actually exists, so the picker never offers an
   * Antigravity model the user cannot run.
   */
  private discoverAntigravityModels(): ModelDefinition[] {
    if (!hasLocalAntigravitySignIn()) return [];
    return ANTIGRAVITY_CANONICAL_MODELS_LIST.map((entry) => ({
      id: entry.canonicalId,
      name: `${entry.displayName} (Antigravity)`,
      canonicalId: entry.canonicalId,
      provider: toProviderId('antigravity'),
      providerModelId: entry.providerModelId,
      wireModelId: entry.wireModelId,
      displayName: `${entry.displayName} (Antigravity)`,
      status: 'active' as const,
      modalities: { input: entry.supportsVision ? ['text', 'image'] : ['text'], output: ['text'] },
      capabilities: {
        reasoning: true,
        thinking: entry.thinkingMode,
        tools: entry.supportsTools,
        vision: entry.supportsVision,
        streaming: true,
        mcp: true,
      },
      thinking: entry.thinkingLevels
        ? { supported: true, levels: entry.thinkingLevels, default: entry.defaultThinkingLevel || 'medium' }
        : undefined,
      contextWindow: entry.contextWindow,
      supportsVision: entry.supportsVision,
      supportsTools: entry.supportsTools,
      costPer1kTokens: { input: 0, output: 0 },
      description: entry.description,
      source: 'antigravity-catalog',
    }));
  }

  /**
   * Ollama models, read live from the local daemon's /api/tags.
   *
   * Ollama exposes the models the user has actually pulled, which is exactly
   * what should appear in the picker. If the daemon is down we return nothing
   * rather than advertising a fixed list of guesses — a model you have not
   * pulled does not exist as far as Ollama is concerned.
   */
  private async discoverOllamaModels(): Promise<ModelDefinition[]> {
    let reachable = false;
    try {
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return [];
      const data = (await res.json().catch(() => null)) as { models?: any[] } | null;
      if (!data?.models?.length) return [];
      reachable = true;
      return data.models
        .map((m: any) => {
          const id = String(m?.name || m?.model || '').trim();
          if (!id) return null;
          const family = String(m?.details?.family || '');
          const paramSize = String(m?.details?.parameter_size || '');
          return {
            id,
            name: `${id}${paramSize ? ` (${paramSize})` : ''}`,
            canonicalId: id,
            provider: toProviderId('ollama'),
            providerModelId: id,
            displayName: `${id}${paramSize ? ` (${paramSize})` : ''}`,
            status: 'active' as const,
            modalities: { input: ['text'], output: ['text'] },
            capabilities: {
              reasoning: true,
              thinking: /deepseek|qwen3|thinker/i.test(id),
              tools: true,
              vision: /llava|bakllava|vision|minicpm/i.test(id) || family.includes('clip'),
              streaming: true,
              mcp: false,
            },
            contextWindow: Number(m?.details?.context_length) || estimateContextWindow(id),
            supportsVision: /llava|bakllava|vision|minicpm/i.test(id),
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `Local Ollama model (${family || 'gguf'})${paramSize ? ` — ${paramSize}` : ''}.`,
            source: 'ollama-local',
          } as ModelDefinition;
        })
        .filter((m: any): m is ModelDefinition => m !== null);
    } catch {
      return [];
    } finally {
      this.ollamaAvailable = reachable;
    }
  }

  /**
   * Generic localhost OpenAI-compatible runtime discovery (LM Studio, LocalAI,
   * Jan, vLLM, LiteLLM …). All of them expose GET /v1/models and need no key.
   */
  private async discoverLocalRuntimeModels(
    provider: string,
    modelsUrl: string,
    label: string
  ): Promise<ModelDefinition[]> {
    try {
      const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(1200) });
      if (!res.ok) return [];
      const payload = (await res.json().catch(() => null)) as { data?: any[] } | null;
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      return rows
        .map((m: any) => {
          const id = String(m?.id || m?.name || '').trim();
          if (!id) return null;
          return {
            id,
            name: `${id} (${label})`,
            canonicalId: id,
            provider: toProviderId(provider),
            providerModelId: id,
            displayName: `${id} (${label})`,
            status: 'active' as const,
            modalities: { input: ['text'], output: ['text'] },
            capabilities: { reasoning: true, thinking: false, tools: true, vision: false, streaming: true, mcp: false },
            contextWindow: Number(m?.context_length || m?.max_model_len) || estimateContextWindow(id),
            supportsVision: false,
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `Local ${label} model served at ${modelsUrl.replace('/v1/models', '')}.`,
            source: 'local-runtime',
          } as ModelDefinition;
        })
        .filter((m: any): m is ModelDefinition => m !== null);
    } catch {
      return [];
    }
  }

  /**
   * Dynamic Remote Model Discovery (never throws, cached for 10 minutes, safe to fire-and-forget):
   * 0. Keyless providers: Antigravity (local Google sign-in), Ollama (localhost:11434),
   *    LM Studio (localhost:1234). These are probed live so only real, runnable
   *    models are ever listed.
   * 1. OpenRouter public catalog (no auth required) — 300+ frontier models.
   * 2. ChatGPT Web session models via chatgptWebProvider.listModels when a cookie is configured
   *    (falls back to ['luna', 'gpt-5'] when the method is unavailable or returns null).
   * 3. Zhipu/GLM hosted catalog when an API key is configured.
   * Discovered models are merged into getAllModels() with the correct provider set,
   * while built-in and user-custom entries always keep priority on id collisions.
   */
  public async refreshRemoteModels(force: boolean = false): Promise<{ added: number }> {
    if (this.remoteModelsInFlight) {
      return this.remoteModelsInFlight;
    }
    if (!force && Date.now() - this.remoteModelsFetchedAt < 10 * 60 * 1000) {
      return { added: 0 };
    }

    this.remoteModelsInFlight = (async (): Promise<{ added: number }> => {
      const discovered: ModelDefinition[] = [];

      // 0. KEYLESS PROVIDERS FIRST — this is the default experience and must never
      //    depend on a pasted API key. Antigravity rides the local Google sign-in;
      //    Ollama and LM Studio are localhost runtimes. All are probed live, so the
      //    picker only ever lists models that genuinely exist right now. This is what
      //    replaced the old hand-written catalog of invented model names.
      discovered.push(...this.discoverAntigravityModels());
      discovered.push(...(await this.discoverOllamaModels()));
      discovered.push(
        ...(await this.discoverLocalRuntimeModels('lmstudio', 'http://localhost:1234/v1/models', 'LM Studio'))
      );

      // 1. OpenRouter public catalog (no auth required)
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const payload = (await res.json()) as { data?: any[] };
          for (const m of (payload.data || []).slice(0, 400)) {
            if (!m?.id) continue;
            const promptPrice = parseFloat(m.pricing?.prompt);
            const completionPrice = parseFloat(m.pricing?.completion);
            discovered.push({
              id: String(m.id),
              name: String(m.name || m.id),
              provider: toProviderId('openrouter'),
              contextWindow: Number(m.context_length) || 128000,
              supportsVision: Array.isArray(m.architecture?.input_modalities)
                ? m.architecture.input_modalities.includes('image')
                : String(m.architecture?.modality || '').includes('image'),
              supportsTools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : true,
              costPer1kTokens: {
                input: Number.isFinite(promptPrice) ? promptPrice * 1000 : 0,
                output: Number.isFinite(completionPrice) ? completionPrice * 1000 : 0,
              },
              description: String(m.description || `OpenRouter hosted model (${m.id})`),
            });
          }
        }
      } catch {
        // Catalog fetch is optional enrichment — built-in models remain available
      }

      // 2. ChatGPT Web session models (requires a configured browser cookie).
      //    Live discovery wins: slugs are surfaced verbatim and stale built-in ids the
      //    session does not offer are dropped from the catalog. On discovery failure the
      //    ['luna', 'gpt-5'] fallback stays routable.
      try {
        const webCred = this.getCredential('chatgpt-web');
        if (webCred.cookieData) {
          let webModelIds: string[] | null = null;
          try {
            const anyWebProvider = chatgptWebProvider as any;
            if (typeof anyWebProvider.listModels === 'function') {
              webModelIds = (await anyWebProvider.listModels(webCred.cookieData)) || null;
            }
          } catch {
            // Optional provider API missing or failed — fallback model ids are used
          }
          if (Array.isArray(webModelIds) && webModelIds.length > 0) {
            this.chatgptWebLiveIds = webModelIds.map((id) => String(id));
          } else {
            this.chatgptWebLiveIds = null; // discovery failed — keep built-in defaults visible
          }
          const rawModelIds =
            webModelIds && webModelIds.length > 0 ? webModelIds : CHATGPT_WEB_FALLBACK_MODEL_IDS;
          const modelIds = Array.from(new Set(['auto', ...rawModelIds]));
          for (const mid of modelIds) {
            let displayName = `ChatGPT Web: ${mid}`;
            if (mid === 'auto') displayName = 'ChatGPT Auto (Web Cookie Session)';
            else if (mid === 'research') displayName = 'OpenAI Deep Research (ChatGPT Web)';
            else if (mid === 'gpt-5-6') displayName = 'GPT-5.6 (ChatGPT Web)';
            else if (mid === 'gpt-5-5') displayName = 'GPT-5.5 (ChatGPT Web)';
            else if (mid === 'gpt-5-6-t-mini') displayName = 'GPT-5.6 Thinking Mini (ChatGPT Web)';
            else if (mid === 'gpt-5-4-t-mini') displayName = 'GPT-5.4 Thinking Mini (ChatGPT Web)';
            else if (mid === 'gpt-5-6-mini') displayName = 'GPT-5.6 Mini (ChatGPT Web)';
            else if (mid === 'gpt-5-5-mini') displayName = 'GPT-5.5 Mini (ChatGPT Web)';
            else if (mid === 'gpt-5-3-mini') displayName = 'GPT-5.3 Mini (ChatGPT Web)';
            else if (mid === 'gpt-4o') displayName = 'ChatGPT 4o (ChatGPT Web Session)';
            else if (mid === 'gpt-4o-mini') displayName = 'ChatGPT 4o-mini (Fast Web Session)';
            else if (mid === 'gpt-5') displayName = 'GPT-5 (ChatGPT Web Session)';
            else if (mid === 'o1') displayName = 'OpenAI o1 Reasoning (ChatGPT Web)';
            else if (mid === 'o3-mini') displayName = 'OpenAI o3-mini Reasoning (ChatGPT Web)';
            else if (mid === 'luna') displayName = 'Luna (ChatGPT Web — Incl. Image Generation)';

            discovered.push({
              id: String(mid),
              name: displayName,
              provider: toProviderId('chatgpt-web'),
              contextWindow: 128000,
              supportsVision: true,
              supportsTools: false,
              costPer1kTokens: { input: 0, output: 0 },
              description: 'Discovered through your live ChatGPT web browser session.',
            });
          }
        } else {
          this.chatgptWebLiveIds = null;
        }
      } catch {
        this.chatgptWebLiveIds = null;
        // ChatGPT Web discovery is optional — skip on failure
      }

      // 2b. Google per-key discovery: only the model ids this exact key supports.
      // Builtin guesses (gemini-3-pro etc.) are dropped when the key lacks them.
      try {
        const googleCred = this.getCredential('google');
        if (googleCred.apiKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${googleCred.apiKey}&pageSize=100`,
            { signal: controller.signal }
          );
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { models?: any[] };
            const usable = (data.models || [])
              .filter((m: any) => Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods.includes('generateContent') : true)
              .map((m: any) => String(m.name || '').replace(/^models\//, ''))
              .filter((id: string) => id && !/embedding|aqa|tts|vision-only/.test(id));
            if (usable.length > 0) {
              this.googleLiveIds = usable;
              for (const id of usable) {
                const isImage = /image/.test(id);
                discovered.push({
                  id,
                  name: id
                    .replace(/^gemini-/, 'Gemini ')
                    .replace(/-preview$/, ' (Preview)')
                    .replace(/-image(-preview)?$/, ' (Image Gen)')
                    .replace(/-lite/, ' Lite')
                    .replace(/-flash$/, ' Flash')
                    .replace(/-pro$/, ' Pro'),
                  provider: toProviderId('google'),
                  contextWindow: estimateContextWindow(id, 1048576),
                  supportsVision: !isImage,
                  supportsTools: !isImage,
                  costPer1kTokens: { input: 0, output: 0 },
                  description: isImage
                    ? 'Google image generation — available on your Gemini key.'
                    : 'Verified against your Gemini API key.',
                });
              }
            }
          }
        } else {
          this.googleLiveIds = null;
        }
      } catch {
        this.googleLiveIds = null;
        // Google discovery is optional enrichment
      }

      // 2c. Groq per-key discovery: the catalog rotates fast — dead default ids
      // are the #1 "model not found" cause. Only live ids survive.
      try {
        const groqCred = this.getCredential('groq');
        if (groqCred.apiKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(`${PROVIDER_BASE_URLS['groq']}/models`, {
            headers: { Authorization: `Bearer ${groqCred.apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { data?: any[] };
            const usable = (data.data || [])
              .map((m: any) => String(m.id))
              .filter((id: string) => !/prompt-guard|whisper|orpheus|tts|guard/.test(id));
            if (usable.length > 0) {
              this.groqLiveIds = usable;
              for (const id of usable) {
                discovered.push({
                  id,
                  name: id.includes('/') ? id.split('/')[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : id,
                  provider: toProviderId('groq'),
                  contextWindow: 131072,
                  supportsVision: false,
                  supportsTools: true,
                  costPer1kTokens: { input: 0, output: 0 },
                  description: 'Verified against your Groq API key (lively free-tier speed).',
                });
              }
            }
          }
        } else {
          this.groqLiveIds = null;
        }
      } catch {
        this.groqLiveIds = null;
        // Groq discovery is optional enrichment
      }

      // 3. Zhipu / GLM hosted catalog (Bearer key required)
      try {
        const zhipuCred = this.getCredential('zhipu');
        const glmCred = this.getCredential('glm');
        const glmc = zhipuCred.apiKey ? zhipuCred : glmCred.apiKey ? glmCred : null;
        if (glmc?.apiKey) {
          const base = (glmc.baseUrl || PROVIDER_BASE_URLS['zhipu']).replace(/\/$/, '');
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(`${base}/models`, {
            headers: { Authorization: `Bearer ${glmc.apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { data?: any[]; models?: any[] };
            for (const m of data.data || data.models || []) {
              const mid = m?.id || m?.model;
              if (!mid) continue;
              discovered.push({
                id: String(mid),
                name: String(m.display_name || mid),
                provider: toProviderId(zhipuCred.apiKey ? 'zhipu' : 'glm'),
                contextWindow: Number(m.context_length) || 200000,
                supportsVision: Boolean(m.capabilities?.vision),
                supportsTools: m.capabilities?.function_call !== false,
                costPer1kTokens: { input: 0.0006, output: 0.0022 },
                description: String(m.description || `Zhipu GLM hosted model (${mid})`),
              });
            }
          }
        }
      } catch {
        // GLM discovery is optional
      }

      // 4. Mistral dynamic discovery
      try {
        const mistralCred = this.getCredential('mistral');
        if (mistralCred.apiKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch('https://api.mistral.ai/v1/models', {
            headers: { Authorization: `Bearer ${mistralCred.apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { data?: any[] };
            for (const m of data.data || []) {
              if (!m?.id) continue;
              discovered.push({
                id: String(m.id),
                name: `Mistral: ${m.name || m.id}`,
                provider: toProviderId('mistral'),
                contextWindow: Number(m.max_context_length) || 128000,
                supportsVision: Boolean(m.capabilities?.vision),
                supportsTools: m.capabilities?.function_calling !== false,
                costPer1kTokens: { input: 0.002, output: 0.006 },
                description: `Verified through your Mistral API key (${m.id}).`,
                source: 'provider-api',
                status: 'active',
                modalities: { input: ['text'], output: ['text'] },
                capabilities: { tools: true, streaming: true },
              });
            }
          }
        }
      } catch {
        // Mistral discovery is optional
      }

      // 5. Together AI dynamic discovery
      try {
        const togetherCred = this.getCredential('together');
        if (togetherCred.apiKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch('https://api.together.xyz/v1/models', {
            headers: { Authorization: `Bearer ${togetherCred.apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as any[];
            for (const m of (Array.isArray(data) ? data : (data as any)?.data || []).slice(0, 100)) {
              if (!m?.id && !m?.name) continue;
              const mid = m.id || m.name;
              discovered.push({
                id: String(mid),
                name: `Together: ${m.display_name || mid.split('/').pop()}`,
                provider: toProviderId('together'),
                contextWindow: Number(m.context_length) || 128000,
                supportsVision: Boolean(m.type === 'image' || m.vision),
                supportsTools: true,
                costPer1kTokens: { input: 0.0008, output: 0.0008 },
                description: `Discovered from your Together AI account (${mid}).`,
                source: 'provider-api',
                status: 'active',
                modalities: { input: ['text'], output: ['text'] },
                capabilities: { tools: true, streaming: true },
              });
            }
          }
        }
      } catch {
        // Together discovery is optional
      }

      // 6. Fireworks AI dynamic discovery
      try {
        const fireworksCred = this.getCredential('fireworks');
        if (fireworksCred.apiKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch('https://api.fireworks.ai/inference/v1/models', {
            headers: { Authorization: `Bearer ${fireworksCred.apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { data?: any[] };
            for (const m of (data.data || []).slice(0, 80)) {
              if (!m?.id) continue;
              discovered.push({
                id: String(m.id),
                name: `Fireworks: ${m.id.split('/').pop()}`,
                provider: toProviderId('fireworks'),
                contextWindow: Number(m.context_length) || 128000,
                supportsVision: false,
                supportsTools: true,
                costPer1kTokens: { input: 0.0009, output: 0.0009 },
                description: `Discovered from your Fireworks AI account (${m.id}).`,
                source: 'provider-api',
                status: 'active',
                modalities: { input: ['text'], output: ['text'] },
                capabilities: { tools: true, streaming: true },
              });
            }
          }
        }
      } catch {
        // Fireworks discovery is optional
      }

      // 7. Cerebras dynamic discovery
      try {
        const cerebrasCred = this.getCredential('cerebras');
        if (cerebrasCred.apiKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch('https://api.cerebras.ai/v1/models', {
            headers: { Authorization: `Bearer ${cerebrasCred.apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { data?: any[] };
            for (const m of data.data || []) {
              if (!m?.id) continue;
              discovered.push({
                id: String(m.id),
                name: `Cerebras: ${m.id} (1800+ tok/s)`,
                provider: toProviderId('cerebras'),
                contextWindow: 128000,
                supportsVision: false,
                supportsTools: true,
                costPer1kTokens: { input: 0.0006, output: 0.0006 },
                description: `Wafer-scale instant inference model on Cerebras (${m.id}).`,
                source: 'provider-api',
                status: 'active',
                modalities: { input: ['text'], output: ['text'] },
                capabilities: { tools: true, streaming: true },
              });
            }
          }
        }
      } catch {
        // Cerebras discovery is optional
      }

      // 8. Novita & Hyperbolic dynamic discovery
      try {
        const novitaCred = this.getCredential('novita');
        if (novitaCred.apiKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch('https://api.novita.ai/v3/openai/models', {
            headers: { Authorization: `Bearer ${novitaCred.apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { data?: any[] };
            for (const m of data.data || []) {
              if (!m?.id) continue;
              discovered.push({
                id: String(m.id),
                name: `Novita: ${m.id.split('/').pop()}`,
                provider: toProviderId('novita'),
                contextWindow: 128000,
                supportsVision: false,
                supportsTools: true,
                costPer1kTokens: { input: 0.0008, output: 0.0008 },
                description: `Novita GPU model (${m.id}).`,
                source: 'provider-api',
                status: 'active',
                modalities: { input: ['text'], output: ['text'] },
                capabilities: { tools: true, streaming: true },
              });
            }
          }
        }
      } catch {
        // Novita discovery is optional
      }

      // 9 & 10 (Ollama / LM Studio) were removed: the keyless discovery at step 0
      // handles both, with a real per-model context window instead of a hardcoded
      // 32k that made the harness compact history far too early on local models.

      try {
        const uniqueRemote = Array.from(
          new Map(discovered.map((m) => [`${m.provider}:${m.id}`, m])).values()
        );
        const knownKeys = new Set(this.getAllModels().map((m) => `${m.provider}:${m.id}`));
        let added = 0;
        for (const m of uniqueRemote) {
          if (!knownKeys.has(`${m.provider}:${m.id}`)) added += 1;
        }
        this.remoteModels = uniqueRemote;
        console.log(`[SUTRA Model Discovery] Merged ${uniqueRemote.length} remote models (${added} newly added).`);
        return { added };
      } catch {
        return { added: 0 };
      }
    })();

    try {
      return await this.remoteModelsInFlight;
    } catch {
      return { added: 0 };
    } finally {
      this.remoteModelsFetchedAt = Date.now();
      this.remoteModelsInFlight = null;
    }
  }

  private activeModelDef: ModelDefinition | null = null;

  public getActiveModel(): ModelDefinition {
    if (this.activeModelDef) return this.activeModelDef;
    const model = this.getAllModels().find((m) => m.id === this.activeModelId);
    return model || BUILTIN_MODELS[0];
  }

  public setActiveModel(modelId: string, preferredProvider?: string): boolean {
    const resolved = this.resolveModelDefinition(modelId, preferredProvider);
    if (resolved) {
      this.activeModelId = resolved.id;
      this.activeModelDef = resolved;
      return true;
    }
    return false;
  }

  public registerCustomProvider(config: CustomProviderConfig): { success: boolean; message: string } {
    try {
      this.customProviders.set(config.id, config);
      return {
        success: true,
        message: `Custom provider "${config.name}" registered successfully with ${config.models.length} model(s).`,
      };
    } catch (err: any) {
      return { success: false, message: `Failed to register provider: ${err.message}` };
    }
  }

  public getCustomProviders(): CustomProviderConfig[] {
    return Array.from(this.customProviders.values());
  }

  public async testProviderConnection(providerId: string, _modelId?: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      if (providerId === 'ollama') {
        const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
        return { ok: true, latencyMs: Date.now() - start };
      }

      if (providerId === 'lmstudio') {
        const res = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`LM Studio returned HTTP ${res.status}`);
        return { ok: true, latencyMs: Date.now() - start };
      }

      const key = this.getApiKey(providerId);
      if (!key) {
        return { ok: false, latencyMs: Date.now() - start, error: 'No API key configured for this provider' };
      }

      let testUrl = '';
      const headers: Record<string, string> = {};

      switch (providerId) {
        case 'groq':
          testUrl = 'https://api.groq.com/openai/v1/models';
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'google':
          testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
          break;
        case 'openai':
          testUrl = 'https://api.openai.com/v1/models';
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'deepseek':
          testUrl = 'https://api.deepseek.com/v1/models';
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'anthropic':
          testUrl = 'https://api.anthropic.com/v1/models';
          headers['x-api-key'] = key;
          headers['anthropic-version'] = '2023-06-01';
          break;
        case 'openrouter':
          testUrl = 'https://openrouter.ai/api/v1/models';
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'github':
          testUrl = 'https://models.inference.ai.azure.com/models';
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'zhipu':
        case 'glm':
          testUrl = `${this.getCredential(providerId).baseUrl || PROVIDER_BASE_URLS['zhipu']}/models`;
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'xai':
          testUrl = 'https://api.x.ai/v1/models';
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'qwen':
          testUrl = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models';
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'mistral':
          testUrl = 'https://api.mistral.ai/v1/models';
          headers['Authorization'] = `Bearer ${key}`;
          break;
        case 'sarvam': {
          const cleanKey = key.trim().replace(/^["']|["']$/g, '');
          const base = (this.getCredential('sarvam').baseUrl || PROVIDER_BASE_URLS['sarvam'] || 'https://api.sarvam.ai/v1').replace(/\/$/, '');
          testUrl = `${base}/models`;
          headers['Authorization'] = `Bearer ${cleanKey}`;
          headers['api-subscription-key'] = cleanKey;
          break;
        }
        default:
          // Any other OpenAI-compatible provider with a known or configured Base URL
          if (PROVIDER_BASE_URLS[providerId] || this.getCredential(providerId).baseUrl) {
            const base = (this.getCredential(providerId).baseUrl || PROVIDER_BASE_URLS[providerId]).replace(/\/$/, '');
            testUrl = `${base}/models`;
            const cleanKey = key.trim().replace(/^["']|["']$/g, '');
            headers['Authorization'] = `Bearer ${cleanKey}`;
            if (providerId === 'sarvam' || base.includes('sarvam')) {
              headers['api-subscription-key'] = cleanKey;
            }
            break;
          }
          return { ok: false, latencyMs: 0, error: `No verification endpoint configured for provider "${providerId}".` };
      }

      const res = await resilientFetch(testUrl, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100) || res.statusText}`);
      }

      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message || 'Connection failed' };
    }
  }

  /**
   * Scans for all active local AI runtimes (Ollama, LM Studio, LocalAI, vLLM, Jan AI, LiteLLM) and auto-registers active models
   */
  public async scanLocalProviders(): Promise<{
    ollama: { active: boolean; models: string[] };
    lmstudio: { active: boolean; models: string[] };
    localai: { active: boolean; models: string[] };
    vllm: { active: boolean; models: string[] };
    jan: { active: boolean; models: string[] };
    litellm: { active: boolean; models: string[] };
  }> {
    const results = {
      ollama: { active: false, models: [] as string[] },
      lmstudio: { active: false, models: [] as string[] },
      localai: { active: false, models: [] as string[] },
      vllm: { active: false, models: [] as string[] },
      jan: { active: false, models: [] as string[] },
      litellm: { active: false, models: [] as string[] },
    };

    // 1. Scan Ollama (default port 11434)
    try {
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        const modelNames = (data.models || []).map((m: any) => m.name || m.model);
        results.ollama = { active: true, models: modelNames };

        for (const mName of modelNames) {
          const modelDef: ModelDefinition = {
            id: `ollama/${mName}`,
            name: `Ollama: ${mName}`,
            provider: 'ollama',
            contextWindow: estimateContextWindow(mName, 32768),
            supportsVision: mName.toLowerCase().includes('vision') || mName.toLowerCase().includes('llava'),
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `Local offline model running on Ollama (${mName}).`,
          };
          this.addCustomModel(modelDef);
        }
      }
    } catch {
      // Runtime not running or unreachable
    }

    // 2. Scan LM Studio (default port 1234)
    try {
      const res = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        const modelNames = (data.data || []).map((m: any) => m.id);
        results.lmstudio = { active: true, models: modelNames };

        for (const mName of modelNames) {
          const modelDef: ModelDefinition = {
            id: `lmstudio/${mName}`,
            name: `LM Studio: ${mName}`,
            provider: toProviderId('lmstudio'),
            contextWindow: estimateContextWindow(mName, 32768),
            supportsVision: false,
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `Local OpenAI-compatible model running on LM Studio (${mName}).`,
          };
          this.addCustomModel(modelDef);
        }
      }
    } catch {
      // Runtime not running or unreachable
    }

    // 3. Scan LocalAI (default port 8080)
    try {
      const res = await fetch('http://localhost:8080/v1/models', { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        const modelNames = (data.data || []).map((m: any) => m.id);
        results.localai = { active: true, models: modelNames };
        for (const mName of modelNames) {
          this.addCustomModel({
            id: `localai/${mName}`,
            name: `LocalAI: ${mName}`,
            provider: toProviderId('localai'),
            contextWindow: estimateContextWindow(mName, 32768),
            supportsVision: false,
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `LocalAI model (${mName}).`,
          });
        }
      }
    } catch {
      // Inactive
    }

    // 4. Scan vLLM (default port 8000)
    try {
      const res = await fetch('http://localhost:8000/v1/models', { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        const modelNames = (data.data || []).map((m: any) => m.id);
        results.vllm = { active: true, models: modelNames };
        for (const mName of modelNames) {
          this.addCustomModel({
            id: `vllm/${mName}`,
            name: `vLLM: ${mName}`,
            provider: toProviderId('vllm'),
            contextWindow: estimateContextWindow(mName, 65536),
            supportsVision: false,
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `High-throughput vLLM instance (${mName}).`,
          });
        }
      }
    } catch {
      // Inactive
    }

    // 5. Scan Jan AI (default port 1337)
    try {
      const res = await fetch('http://localhost:1337/v1/models', { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        const modelNames = (data.data || []).map((m: any) => m.id);
        results.jan = { active: true, models: modelNames };
        for (const mName of modelNames) {
          this.addCustomModel({
            id: `jan/${mName}`,
            name: `Jan: ${mName}`,
            provider: toProviderId('jan-ai'),
            contextWindow: estimateContextWindow(mName, 32768),
            supportsVision: false,
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `Jan AI desktop runtime (${mName}).`,
          });
        }
      }
    } catch {
      // Inactive
    }

    // 6. Scan LiteLLM Proxy (default port 4000)
    try {
      const res = await fetch('http://localhost:4000/v1/models', { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        const modelNames = (data.data || []).map((m: any) => m.id);
        results.litellm = { active: true, models: modelNames };
        for (const mName of modelNames) {
          this.addCustomModel({
            id: `litellm/${mName}`,
            name: `LiteLLM: ${mName}`,
            provider: toProviderId('litellm'),
            contextWindow: estimateContextWindow(mName, 65536),
            supportsVision: true,
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `LiteLLM unified proxy (${mName}).`,
          });
        }
      }
    } catch {
      // Inactive
    }

    return results;
  }

  /**
   * Universal Streaming Dispatcher with Abort & Pause Signal Support
   */
  public async *streamChat(params: {
    messages: Array<{ role: string; content: string }>;
    systemPrompt?: string;
    modelId?: string;
    model?: SutraModel;
    temperature?: number;
    tools?: any[];
    signal?: AbortSignal;
    priorityIds?: string[];
    autoCompact?: boolean;
    autoCompactThreshold?: number;
  }): AsyncGenerator<{ delta?: string; thinking?: string; toolCalls?: any[]; done?: boolean; error?: string; resetContent?: boolean; retryEvent?: { attempt: number; totalAttempts: number; provider: string; model: string; status: string; latencyMs: number; reason: string } }> {
    if (params.signal?.aborted) return;

    // Exact id first, then suffix match (custom / namespaced ids stay reachable by short name).
    const rawRequestedId = typeof params.modelId === 'string' ? params.modelId.trim() : '';

    // Capture the user's INTENT *before* resolving. Resolution failure must never flip a
    // deliberate model choice into silent auto-routing — that is precisely what made an
    // explicit selection appear to "randomly" run through the entire fallback chain.
    const AUTO_ROUTE_ALIASES = new Set(['', 'auto', 'fast', 'balanced', 'quality', 'custom', 'auto (sutra)', 'sutra-auto', 'astra-auto', 'astra']);
    const isModelParamAuto = params.model && (
      AUTO_ROUTE_ALIASES.has(String(params.model.id || '').toLowerCase()) ||
      String(params.model.id || '').toLowerCase().startsWith('auto') ||
      params.model.provider === 'sutra' ||
      (params.model.provider as string) === 'astra-auto'
    );
    const userRequestedSpecificModel =
      !isModelParamAuto &&
      (Boolean(params.model) || (Boolean(rawRequestedId) && !AUTO_ROUTE_ALIASES.has(rawRequestedId.toLowerCase()))) &&
      !rawRequestedId.toLowerCase().startsWith('auto') &&
      !AUTO_ROUTE_ALIASES.has(String(params.model?.id || '').toLowerCase());

    const resolvedModel: ModelDefinition | null =
      (params.model as any) || this.resolveModelDefinition(rawRequestedId || this.activeModelId);
    const requestedModel: ModelDefinition = resolvedModel || BUILTIN_MODELS[0];
    const targetModelId = params.modelId || requestedModel.id || 'auto';

    // An explicit selection that cannot be resolved is a HARD error. Previously this only
    // emitted a faint "thinking" line and fell through to the auto chain, so users saw
    // unrelated providers answering a request they had pinned to one specific model.
    if (userRequestedSpecificModel && !resolvedModel) {
      const suggestion = this.suggestClosestModelId(rawRequestedId);
      yield {
        error:
          `The model "${rawRequestedId}" is not in your connected catalog, so this request was stopped ` +
          `rather than silently routed somewhere else.` +
          (suggestion ? ` Did you mean "${suggestion}"?` : '') +
          ` Open Settings → Models to refresh the catalog, or pick a model marked as connected.`,
      };
      yield { done: true };
      return;
    }

    // Reload keys dynamically from SQLite on every turn
    try {
      const rows = db.prepare('SELECT id, api_key FROM providers WHERE api_key IS NOT NULL').all() as any[];
      for (const row of rows) {
        if (row.api_key && row.api_key.trim().length > 0) {
          const k = row.api_key.trim();
          if (!isDummyApiKey(k)) {
            this.apiKeys[row.id] = k;
          } else {
            delete this.apiKeys[row.id];
          }
        }
      }
    } catch {
      // Key reload is best-effort — constructor-loaded keys remain in effect
    }

    // Availability gate: only credential-backed providers plus detected-local runtimes are
    // routable. With zero connected providers there is nothing to retry — answer honestly once.
    await this.probeOllama();
    if (this.listAvailableProviders().length === 0) {
      yield { thinking: 'No models are connected yet — add an API key or cookie in Settings.' };
      yield* bufferedTextChunks('I cannot reach any AI model yet because no provider is connected.\n\nOpen **Settings** and add an API key (Groq, Google Gemini, OpenAI, Anthropic, DeepSeek or OpenRouter), paste your ChatGPT session cookie, or start Ollama locally — then send your request again.');
      yield { done: true };
      return;
    }

    // ---- Retry ladder state -------------------------------------------------
    // Retryable failures (429/5xx/timeouts/network/empty) retry the SAME model at
    // least 10 times with exponential backoff BEFORE failing over to another
    // provider. Hard failures (401/403/404/model-not-found) switch immediately.
    const MAX_SAME_MODEL_RETRIES = 10;
    const MAX_TOTAL_ATTEMPTS = 30;
    const RETRY_BACKOFF_START_MS = 1000;
    const RETRY_BACKOFF_CAP_MS = 15000;
    let totalAttempts = 0;
    let consecutiveRetries = 0;
    let retryBackoffMs = RETRY_BACKOFF_START_MS;
    const attemptErrors: Array<{ provider: string; error: string }> = [];
    let failedPreviousRoute = '';

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    /** Hard failures switch models immediately; everything else is worth a backoff retry. */
    const isHardFailure = (err: any): boolean => {
      if (err && typeof err.retryable === 'boolean') return !err.retryable;
      const message = String(err?.message || err || '');
      if (/401|402|403|unauthorized|forbidden|invalid\s*(api\s*)?key|incorrect\s*(api\s*)?key|payment required/i.test(message)) return true;
      if (/404|model_not_found|decommissioned|deprecated|does not exist|is not available on|unknown model|no endpoints found|removed/i.test(message)) return true;
      return false;
    };
    // Rate-limit-class failures (429 / TPM / payload / quota / provider overloaded) do not
    // clear by hammering the same endpoint — they get a LOW same-provider retry cap and
    // then the chain moves to the NEXT provider. Transient network errors keep the
    // higher general-purpose cap. Non-retryable classes never retry at all.
    const RATE_LIMIT_PATTERN = /\b429\b|rate[\s_-]*limit|\btpm\b|tokens?\s+per\s+minute|quota|too\s+many\s+requests|resource\s+(has\s+been\s+)?exhausted|overloaded|request\s+too\s+large|reduce\s+your\s+message\s+size/i;
    const isRateLimitFailure = (err: any): boolean => {
      if (isHardFailure(err)) return false; // non-retryable class — never retried, never capped as retryable
      return RATE_LIMIT_PATTERN.test(String(err?.message || err || ''));
    };
    const MAX_RATE_LIMIT_RETRIES = 4;

    // 1. Auto-Vision Handoff: route embedded images to a capable vision model when the
    //    active model is text-only, streaming that answer back as the response.
    const handoff = await this.processMultimodalAutoHandoff(params.messages, requestedModel, params.signal);
    const augmentedMessages = handoff.augmentedMessages;

    if (handoff.visionPlan) {
      let noticeEmitted = false;
      let deliveredAny = false;
      try {
        for await (const fragment of this.streamVisionHandoffAnswer(handoff.visionPlan, params.signal)) {
          if (params.signal?.aborted) return;
          if (!fragment) continue;
          if (!noticeEmitted) {
            // Announce only once the handoff genuinely starts producing output.
            noticeEmitted = true;
            yield { thinking: handoff.visionPlan.notice };
          }
          deliveredAny = true;
          yield { delta: fragment };
        }
      } catch {
        // Handoff stream failed — fall through to the normal routing chain below
      }
      if (deliveredAny) {
        yield { done: true };
        return;
      }
      // No image-capable endpoint answered — continue the normal chain silently.
    }

    // Helper to resolve actual provider-specific model string
    const resolveModelId = (prov: string, mId: string) => {
      if (mId && !['auto', 'fast', 'balanced', 'quality', 'custom'].includes(mId)) {
        return mId;
      }
      // Current flagship default per provider (August 2026 catalog)
      return PROVIDER_DEFAULT_MODEL_IDS[prov] || 'openai/gpt-oss-120b';
    };

    // 1. Check if user explicitly selected a specific model vs SUTRA / Astra Auto Fallback mode.
    // `userRequestedSpecificModel` is the authoritative signal (captured before resolution).
    // A pinned model must NEVER be swapped for the auto chain without the user saying so.
    const isAutoRoute =
      AUTO_ROUTE_ALIASES.has(String(requestedModel.id || '').toLowerCase()) ||
      String(requestedModel.id || '').toLowerCase().startsWith('auto') ||
      requestedModel.provider === 'sutra' ||
      (requestedModel.provider as string) === 'astra-auto' ||
      (requestedModel.id === 'auto' && (requestedModel.name || '').includes('ASTRA'));

    const isSpecificModelChosen = !isAutoRoute && (
      userRequestedSpecificModel ||
      (requestedModel.provider === 'chatgpt-web' ||
       requestedModel.provider === 'cursor-web' ||
       requestedModel.provider === 'qoder-web') ||
      (requestedModel.id !== 'auto' &&
       requestedModel.provider !== 'sutra' &&
       (requestedModel.provider as string) !== 'astra-auto')
    );
    // Available-only: the queue holds credential-backed providers (plus detected-local Ollama and free tier) —
    // unconfigured providers are never enqueued and their failures are never surfaced.
    const isCustomOrExplicitEndpoint = Boolean(
      (requestedModel as any)?.baseUrl ||
      (requestedModel as any)?.apiKey ||
      requestedModel.provider === 'custom' ||
      String(requestedModel.provider).startsWith('custom-') ||
      customModelsManager.getAllCustomModels().some(
        (c) => c.modelId === requestedModel.id || c.id === requestedModel.id || c.name === requestedModel.name
      )
    );

    const requestedProviderAvailable =
      isSpecificModelChosen &&
      (isCustomOrExplicitEndpoint || this.isProviderAvailable(String(requestedModel.provider), String(requestedModel.id)));
    const dynamicRanking = this.rankProvidersDynamically(requestedModel, Boolean(handoff.hasImage));
    if (!dynamicRanking.includes('pollinations')) {
      dynamicRanking.push('pollinations');
    }

    if (isSpecificModelChosen && !requestedProviderAvailable) {
      yield { error: `Model "${requestedModel.name || requestedModel.id}" requires a connected ${providerDisplayName(String(requestedModel.provider))} account or active local Language Server daemon. Please check your credentials in Settings.` };
      yield { done: true };
      return;
    }
    const providersToTry = isSpecificModelChosen
      ? [String(requestedModel.provider)]
      : dynamicRanking;

    // In ASTRA Auto Mode: prioritize the current sticky working provider
    if (!isSpecificModelChosen && this.stickyAutoProvider && providersToTry.includes(this.stickyAutoProvider)) {
      const sIdx = providersToTry.indexOf(this.stickyAutoProvider);
      if (sIdx > 0) {
        providersToTry.splice(sIdx, 1);
        providersToTry.unshift(this.stickyAutoProvider);
      }
    }

    // ---- Context usage snapshot + auto-compact ------------------------------
    // Token counts are estimated at chars/4 when providers do not report usage.
    const estTokens = (value: unknown): number => Math.ceil(JSON.stringify(value ?? '').length / 4);
    // The pre-flight window reflects the model the request will ACTUALLY hit —
    // the selected model, or the top-ranked provider's primary in Auto mode.
    // (Taking the MIN across the whole chain dragged every run down to the
    // smallest local model — e.g. an 8k llama3 made a 1M Antigravity run
    // compact at 8k and the panel report "8k available". Smaller failover
    // targets are handled per-call by calibratePayloadForModel instead.)
    const primaryProvider = isSpecificModelChosen ? String(requestedModel.provider) : providersToTry[0];
    const primaryModel = isSpecificModelChosen
      ? requestedModel
      : this.getAllModels().find((m) => String(m.provider) === primaryProvider);
    const candidateWindows = [Number(primaryModel?.contextWindow) || 128000];
    const contextWindow = candidateWindows.length > 0 ? Math.min(...candidateWindows) : 128000;
    const contextUsed = estTokens(augmentedMessages) + estTokens(params.systemPrompt || '');
    this.lastRunUsage = { contextUsed, contextWindow, contextRemaining: Math.max(0, contextWindow - contextUsed), outputTokens: 0 };

    const compactThresholdPct = typeof params.autoCompactThreshold === 'number' ? params.autoCompactThreshold : 80;
    if (params.autoCompact !== false && contextUsed > contextWindow * (compactThresholdPct / 100) && augmentedMessages.length > 8) {
      // Compact by ATOMIC TURN, not by raw message index.
      //
      // The previous `splice(0, removedCount, summary)` cut the history in half
      // positionally. Half the time that landed inside an assistant message's
      // tool-call group: either orphaned `role:"tool"` messages whose parent was
      // gone, or an assistant still holding `tool_calls` whose results were gone.
      // Both are a hard 400 from every OpenAI-compatible provider, so once a run
      // crossed the compaction threshold it could never complete another round.
      const turns = groupIntoAtomicTurns(augmentedMessages);
      const keepTurns = Math.max(2, Math.ceil(turns.length / 2));
      const droppedTurns = turns.slice(0, turns.length - keepTurns);
      const removedCount = droppedTurns.reduce((acc, group) => acc + group.length, 0);

      augmentedMessages.length = 0;
      augmentedMessages.push({
        role: 'user',
        content: `[Context compacted: ${removedCount} earlier messages were summarized to stay within the model's context window. All file changes are saved in the workspace.]`,
      } as any);
      for (const group of turns.slice(turns.length - keepTurns)) {
        augmentedMessages.push(...group);
      }
      // Guarantee the invariant before the request goes out.
      const repaired = repairToolCallPairing(augmentedMessages);
      augmentedMessages.length = 0;
      augmentedMessages.push(...repaired);

      this.lastRunUsage.contextUsed = estTokens(augmentedMessages) + estTokens(params.systemPrompt || '');
      this.lastRunUsage.contextRemaining = Math.max(0, contextWindow - this.lastRunUsage.contextUsed);
      yield { thinking: 'Compacting context to stay within the model window…' };
    }

    // User-configured model priority (Settings > Routing drag order) is honored first.
    const priorityIds: string[] = Array.isArray(params.priorityIds)
      ? params.priorityIds.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
      : [];
    // Priority entries are stored as "provider:modelId" composite keys by the Settings
    // Routing card (bare model ids accepted for older configs). Rank each PROVIDER by
    // its best-ranked catalog MODEL — comparing provider names against model-id keys
    // never matches, which silently disabled this setting in Auto mode.
    const priorityRank = new Map<string, number>(priorityIds.map((id, i) => [id, i]));
    const rankForModel = (prov: string, mId: string, mName?: string): number => {
      const byKey = priorityRank.get(`${prov}:${mId}`);
      if (byKey !== undefined) return byKey;
      const byId = priorityRank.get(mId);
      if (byId !== undefined) return byId;
      if (mName && mName !== mId) {
        const byNameKey = priorityRank.get(`${prov}:${mName}`);
        if (byNameKey !== undefined) return byNameKey;
        return priorityRank.get(mName) ?? Number.POSITIVE_INFINITY;
      }
      return Number.POSITIVE_INFINITY;
    };
    if (priorityIds.length > 0 && !isSpecificModelChosen) {
      const bestModelRank = new Map<string, number>();
      for (const prov of providersToTry) {
        let best = Number.POSITIVE_INFINITY;
        for (const m of this.getAllModels()) {
          if (String(m.provider) !== prov) continue;
          const r = rankForModel(prov, String(m.id), typeof m.name === 'string' ? m.name : undefined);
          if (r < best) best = r;
        }
        if (Number.isFinite(best)) bestModelRank.set(prov, best);
      }
      providersToTry.sort((a, b) => {
        const ra = bestModelRank.get(a);
        const rb = bestModelRank.get(b);
        if (ra === rb) return 0; // neither (or equally) ranked — keep dynamic order
        if (ra === undefined) return 1; // unranked providers trail ranked ones
        if (rb === undefined) return -1;
        return ra - rb;
      });
    }

    /** Records output size on the run usage snapshot before the stream ends. */
    const finishUsage = (outputText: string): void => {
      if (this.lastRunUsage) this.lastRunUsage.outputTokens = Math.ceil(outputText.length / 4);
    };

    // Queue-based retry ladder: a retryable failure re-enqueues the SAME provider (with
    // backoff, announced as "Retrying with …"); a hard failure moves straight to the next
    // available provider (announced as "Switching to …"). Budget: 8 attempts per prompt.
    const providerQueue: string[] = [...providersToTry];

    while (providerQueue.length > 0) {
      const provider = providerQueue.shift()!;
      if (totalAttempts >= MAX_TOTAL_ATTEMPTS) break;
      const cred = this.getCredential(provider);
      let currentModel = provider === requestedModel.provider ? requestedModel : this.getAllModels().find(m => m.provider === provider);

      // Extract custom model definition and configuration from customModelsManager
      const customEntry = customModelsManager.getAllCustomModels().find(
        (cm) => cm.modelId === currentModel?.id || cm.id === currentModel?.id || cm.name === currentModel?.name || cm.modelId === requestedModel?.id || cm.name === requestedModel?.name
      );

      const key = customEntry?.config?.apiKey || (currentModel as any)?.apiKey || (requestedModel as any)?.apiKey || cred.apiKey;
      const cookie = cred.cookieData;
      // Honor the drag order WITHIN a provider too: when several models exist for it,
      // route to the one the user ranked highest instead of the first catalog hit —
      // a custom model placed first in Settings must actually be the one that runs.
      if (!isSpecificModelChosen && priorityIds.length > 0 && currentModel) {
        for (const m of this.getAllModels()) {
          if (String(m.provider) !== provider) continue;
          if (rankForModel(provider, String(m.id), typeof m.name === 'string' ? m.name : undefined)
            < rankForModel(provider, String(currentModel.id), typeof currentModel.name === 'string' ? currentModel.name : undefined)) {
            currentModel = m;
          }
        }
      }

      // Skip if no key, no cookie, and not a credential-free provider (local runtimes,
      // free tiers, the Antigravity local sign-in, or custom models with an explicit baseUrl).
      if (!key && !cookie && !(provider === 'ollama' && this.ollamaAvailable) && provider !== 'pollinations'
        && !(isAntigravityProvider(provider) && hasLocalAntigravitySignIn())
        && !((currentModel as any)?.baseUrl || customEntry?.config?.baseUrl || cred.baseUrl || provider === 'custom')) {
        continue;
      }
      if (!currentModel && PROVIDER_DEFAULT_MODEL_IDS[provider]) {
        // Dynamic providers (zhipu, glm-web, xai, qwen, antigravity, cerebras, moonshot, ...) may not
        // have a catalog entry yet — synthesize one from the flagship default so they stay routable.
        const fallbackId = resolveModelId(provider, '');
        currentModel = {
          id: fallbackId,
          name: fallbackId,
          provider: toProviderId(provider),
          contextWindow: 128000,
          supportsVision: false,
          supportsTools: true,
          costPer1kTokens: { input: 0, output: 0 },
          description: `Dynamic ${provider} model resolved from the SUTRA provider catalog.`,
        };
      }
      if (!currentModel) continue;

      const providerModelId = resolveModelId(provider, currentModel.id || '');

      // Antigravity WITHOUT an explicit Base URL requires the native bridge path
      // (handled inside the try block); with a Base URL it keeps the generic
      // OpenAI-compatible path for self-hosted bridges.
      if (isAntigravityProvider(provider) && !cred.baseUrl && !hasLocalAntigravitySignIn()) {
        continue; // No local Google sign-in and no bridge endpoint — fall through the chain
      }
      // cloudflare-workers-ai uses a non-OpenAI REST schema — never routed through the generic path.
      if (provider === 'cloudflare-workers-ai') {
        continue;
      }

      // Failover transparency: announce the move only after a real failed attempt upstream.
      if (failedPreviousRoute) {
        yield { resetContent: true };
        yield { thinking: `Switching to ${providerDisplayName(provider)}…` };
        failedPreviousRoute = '';
      }

      const controller = new AbortController();
      // Generous ceiling for slow long-form turns (big file writes stream for minutes).
      // True hangs are still bounded by undici's idle body timeout; user cancel flows
      // through params.signal. A short cap here used to kill legitimate long streams
      // mid-run ("stops automatically after some time").
      const timeout = setTimeout(() => controller.abort(), 600000);
      const relayExternalAbort = () => controller.abort();
      if (params.signal?.aborted) controller.abort();
      else if (params.signal) params.signal.addEventListener('abort', relayExternalAbort, { once: true });

      try {

        // 1b. Antigravity via the local Google sign-in (Code Assist API) — zero manual auth.
        if (isAntigravityProvider(provider) && !cred.baseUrl && hasLocalAntigravitySignIn()) {
          yield { thinking: `Connecting through the local Google sign-in (${providerDisplayName(provider)})…` };
          let bridgeText = '';
          let receivedAny = false;
          try {
            for await (const chunk of streamAntigravityTurn(
              {
                modelId: providerModelId,
                systemPrompt: params.systemPrompt,
                messages: augmentedMessages,
                signal: controller.signal,
              },
              currentModel.supportsTools ? SUTRA_TOOLS : []
            )) {
              if (chunk.thinking) {
                receivedAny = true;
                yield { thinking: chunk.thinking };
              }
              if (chunk.delta) {
                receivedAny = true;
                bridgeText += chunk.delta;
                yield { delta: chunk.delta };
              }
              if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                receivedAny = true;
                yield {
                  toolCalls: chunk.toolCalls.map((c, i) => ({
                    id: c.id || `tool-${Date.now()}-${i}`,
                    tool: c.tool,
                    params: c.params,
                    requiresApproval: false,
                    status: 'approved',
                    timestamp: Date.now(),
                  })),
                };
              }
            }
            if (!receivedAny) throw new Error('Empty response from the Antigravity bridge');
            if (!isSpecificModelChosen) {
              this.stickyAutoProvider = provider;
            }
            finishUsage(bridgeText);
            clearTimeout(timeout);
            yield { done: true };
            return;
          } catch (bridgeErr: any) {
            console.warn(`[ModelRouter] Antigravity bridge error: ${bridgeErr.message}`);
            if (isSpecificModelChosen) {
              yield { error: `[Antigravity] Model "${requestedModel.name || requestedModel.id}" (${providerModelId}) failed: ${bridgeErr.message}. Execution stopped because this model was explicitly selected. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
              yield { done: true };
              return;
            }

            // In Auto Mode: If Antigravity Claude/Pro hits upstream quota 429, fall back to Gemini Flash
            if (/429|quota|exhausted/i.test(bridgeErr.message) && !providerModelId.includes('flash')) {
              yield { thinking: `Antigravity upstream quota for ${requestedModel.name || providerModelId} is temporarily constrained. Auto-routing via Gemini 3.7 Flash on your Antigravity connection…` };
              try {
                let flashText = '';
                let receivedFlash = false;
                for await (const chunk of streamAntigravityTurn(
                  {
                    modelId: 'gemini-3.7-flash',
                    systemPrompt: params.systemPrompt,
                    messages: augmentedMessages,
                    signal: controller.signal,
                  },
                  currentModel.supportsTools ? SUTRA_TOOLS : []
                )) {
                  if (chunk.thinking) {
                    receivedFlash = true;
                    yield { thinking: chunk.thinking };
                  }
                  if (chunk.delta) {
                    receivedFlash = true;
                    flashText += chunk.delta;
                    yield { delta: chunk.delta };
                  }
                  if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                    receivedFlash = true;
                    yield {
                      toolCalls: chunk.toolCalls.map((c, i) => ({
                        id: c.id || `tool-${Date.now()}-${i}`,
                        tool: c.tool,
                        params: c.params,
                        requiresApproval: false,
                        status: 'approved',
                        timestamp: Date.now(),
                      })),
                    };
                  }
                }
                if (receivedFlash) {
                  this.stickyAutoProvider = provider;
                  finishUsage(flashText);
                  clearTimeout(timeout);
                  yield { done: true };
                  return;
                }
              } catch (flashErr: any) {
                console.warn(`[ModelRouter] Antigravity Flash fallback error: ${flashErr.message}`);
              }
            }

            failedPreviousRoute = provider;
            this.recordProviderCooldown(provider, 30000);
            yield { resetContent: true };
            yield { thinking: `Antigravity local session encountered an issue (${bridgeErr.message.slice(0, 80)}). Failing over to next provider in Auto mode…` };
            continue;
          }
        }

        // 2. Anthropic (Key + Cookie session support) — native Messages API format + SSE streaming
        if (provider === 'anthropic' && (key || cookie)) {
          const anthropicHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            ...cred.headers,
          };
          if (key) {
            anthropicHeaders['x-api-key'] = key;
          }
          if (cookie) {
            anthropicHeaders['Cookie'] = cookie;
            if (!anthropicHeaders['x-api-key']) {
              if (cookie.includes('sessionKey=')) {
                const m = cookie.match(/sessionKey=([^;]+)/);
                if (m) anthropicHeaders['x-api-key'] = m[1];
              } else if (cookie.startsWith('sk-ant')) {
                anthropicHeaders['x-api-key'] = cookie;
              }
            }
          }

          // Convert OpenAI-shaped history into Anthropic content blocks (system param,
          // tool_use / tool_result blocks, base64 image blocks). Sending OpenAI message
          // shapes here causes HTTP 400 on tool rounds.
          const converted = toAnthropicMessages(augmentedMessages, params.systemPrompt);
          // Claude model resolution: preserve exact claude-* ID if provided
          const anthropicModelId = providerModelId.startsWith('claude-')
            ? providerModelId
            : providerModelId.includes('opus')
            ? 'claude-opus-5'
            : providerModelId.includes('haiku')
            ? 'claude-haiku-4-5-20251001'
            : providerModelId.includes('fable')
            ? 'claude-fable-5'
            : 'claude-sonnet-5';

          const buildAnthropicBody = (streaming: boolean): Record<string, any> => {
            const body: Record<string, any> = {
              model: anthropicModelId,
              max_tokens: Math.min((params as any).maxTokens || 16384, 16384),
              messages: converted.messages,
            };
            if (converted.system) body.system = converted.system;
            body.temperature = params.temperature ?? 0.7;
            if (currentModel.supportsTools) {
              body.tools = SUTRA_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
            }
            if (streaming) body.stream = true;
            return body;
          };

          const anthropicUrl = cred.baseUrl || 'https://api.anthropic.com/v1/messages';
          let res: Response | null = null;
          let responseIsStreaming = false;
          try {
            res = await resilientFetch(anthropicUrl, {
              method: 'POST',
              headers: anthropicHeaders,
              body: JSON.stringify(buildAnthropicBody(true)),
              signal: controller.signal,
            });
            responseIsStreaming = res.ok;
          } catch {
            res = null;
          }

          // Connection-level refusal (or gateway without SSE support) — ONE buffered retry.
          if (!res || !res.ok) {
            let errorText = 'Could not reach Anthropic Claude API';
            if (res) {
              const errJson = await res.json().catch(() => null);
              errorText = errJson?.error?.message || errJson?.message || `HTTP ${res.status}`;
            } else {
              try {
                res = await resilientFetch(anthropicUrl, {
                  method: 'POST',
                  headers: anthropicHeaders,
                  body: JSON.stringify(buildAnthropicBody(false)),
                  signal: controller.signal,
                });
                responseIsStreaming = false;
                if (!res.ok) {
                  const errJson = await res.json().catch(() => null);
                  errorText = errJson?.error?.message || errJson?.message || `HTTP ${res.status}`;
                }
              } catch (retryErr: any) {
                errorText = retryErr.message || 'Could not reach the Claude endpoint';
              }
            }

            if (!res || !res.ok) {
              if (isSpecificModelChosen) {
                yield { error: `[Anthropic] Model "${requestedModel.name || requestedModel.id}" (${anthropicModelId}) returned HTTP ${res?.status || 500}: ${errorText}. Execution stopped because this model was explicitly selected. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
                yield { done: true };
                return;
              }
              const isRateLimit = (res?.status === 429 || res?.status === 529) || isRateLimitFailure(errorText);
              if (isRateLimit && providerQueue.length > 0) {
                this.recordProviderCooldown(provider, 30000);
                yield { resetContent: true };
                yield { thinking: `[Anthropic] Rate limit reached on ${requestedModel.name || anthropicModelId} (HTTP ${res?.status || 429}). Seamlessly failing over to next available provider…` };
                continue;
              }
              throw new Error(`Anthropic error (HTTP ${res?.status || 500}): ${errorText}`);
            }
          }

          let text = '';
          const toolBlocks: Array<{ id: string; name: string; json: string }> = [];
          const toolBlockByIndex = new Map<number, { id: string; name: string; json: string }>();

          if (responseIsStreaming && res.body) {
            for await (const frame of iterateSSEData(res)) {
              if (params.signal?.aborted) return;
              let evt: any;
              try { evt = JSON.parse(frame); } catch { continue; }
              if (evt.type === 'error') throw new Error(evt.error?.message || 'Claude reported a stream error');
              if (evt.type === 'content_block_start') {
                const block = evt.content_block || {};
                if (block.type === 'tool_use') {
                  const entry = { id: block.id || `tool-${Date.now()}-${evt.index}`, name: block.name || '', json: '' };
                  toolBlocks.push(entry);
                  toolBlockByIndex.set(evt.index, entry);
                }
              } else if (evt.type === 'content_block_delta') {
                const d = evt.delta || {};
                if (d.type === 'text_delta' && d.text) {
                  text += d.text;
                  yield { delta: d.text };
                } else if (d.type === 'thinking_delta' && d.thinking) {
                  yield { thinking: d.thinking };
                } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
                  const entry = toolBlockByIndex.get(evt.index);
                  if (entry) entry.json += d.partial_json;
                }
              } else if (evt.type === 'message_stop') {
                break;
              }
            }
          } else {
            // Buffered response (from the fallback request above)
            const data = await res.json();
            text = data.content?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('') || '';
            for (const block of data.content || []) {
              if (block.type === 'thinking' && block.thinking) yield { thinking: block.thinking };
            }
            yield* bufferedTextChunks(text);
          }

          // Tool approval is handled uniformly by the server layer — no per-provider marking here.
          let toolCalls = toolBlocks.filter((b) => b.name).map((b, index) => ({
            id: b.id || `tool-${Date.now()}-${index}`,
            tool: b.name,
            params: safeJson(b.json || '{}'),
            requiresApproval: false,
            status: 'approved',
            timestamp: Date.now(),
          }));
          if (toolCalls.length === 0 && text) {
            toolCalls = extractAndStripTextToolCalls(text).extractedTools;
          }

          if (toolCalls.length) yield { toolCalls };
          if (!isSpecificModelChosen) this.stickyAutoProvider = provider;
          finishUsage(text);
          yield { done: true };
          return;
        }

        // 3. Google Gemini (Native SSE + OpenAI Gateway Dual Fallback + Cookie Support)
        if (provider === 'google' && (key || cookie)) {
          // Attempt 3a: Gemini OpenAI-compatible endpoint with true SSE streaming
          try {
            const geminiHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...cred.headers,
            };
            if (key) geminiHeaders['Authorization'] = `Bearer ${key}`;
            if (cookie) geminiHeaders['Cookie'] = cookie;

            const res = await resilientFetch(cred.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
              method: 'POST',
              headers: geminiHeaders,
              body: JSON.stringify({
                model: providerModelId.includes('gemini') ? providerModelId : 'gemini-2.5-flash',
                messages: [{ role: 'system', content: params.systemPrompt || '' }, ...augmentedMessages],
                temperature: params.temperature ?? 0.7,
                tools: currentModel.supportsTools
                  ? (params.tools && params.tools.length > 0 ? params.tools : openAITools)
                  : undefined,
                stream: true,
              }),
              signal: controller.signal,
            });

            if (res.ok && res.body) {
              const assembler = new StreamedToolCallAssembler();
              const sink = { fullText: '', finishReason: '' };
              let receivedAny = false;

              for await (const chunk of consumeOpenAICompatibleSSE(res, assembler, sink, params.signal)) {
                receivedAny = true;
                yield chunk;
              }

              let toolCalls = assembler.assemble();
              if (toolCalls.length === 0 && sink.fullText) {
                toolCalls = extractAndStripTextToolCalls(sink.fullText).extractedTools;
              }
              if (!receivedAny && toolCalls.length === 0) throw new Error('Empty gateway stream');

              if (toolCalls.length) yield { toolCalls };
              if (!isSpecificModelChosen) this.stickyAutoProvider = provider;
              finishUsage(sink.fullText);
              yield { done: true };
              return;
            }
          } catch {
            // Attempt 3b: Gemini Native streaming
          }

          try {
            const geminiModel = providerModelId.includes('gemini') ? providerModelId : 'gemini-2.5-flash';
            const nativeBase = 'https://generativelanguage.googleapis.com/v1beta';

            const toGeminiParts = (m: any): any[] => {
              if (Array.isArray(m.content)) {
                const parts: any[] = [];
                for (const part of m.content) {
                  if (part?.type === 'text') {
                    if (part.text) parts.push({ text: String(part.text) });
                  } else if (part?.type === 'image_url') {
                    const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
                    const parsedImage = parseDataUrl(url);
                    if (parsedImage) parts.push({ inlineData: { mimeType: parsedImage.mimeType, data: parsedImage.data } });
                  }
                }
                return parts.length > 0 ? parts : [{ text: '' }];
              }
              const rawText = typeof m.content === 'string' ? m.content : m.content == null ? '' : String(m.content);
              const parts: any[] = [];
              const dataUrlPattern = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
              let cursor = 0;
              let imageMatch: RegExpExecArray | null;
              while ((imageMatch = dataUrlPattern.exec(rawText)) !== null) {
                if (imageMatch.index > cursor) parts.push({ text: rawText.slice(cursor, imageMatch.index) });
                parts.push({ inlineData: { mimeType: imageMatch[1], data: imageMatch[2] } });
                cursor = imageMatch.index + imageMatch[0].length;
              }
              if (cursor < rawText.length) parts.push({ text: rawText.slice(cursor) });
              return parts.length > 0 ? parts : [{ text: '' }];
            };

            const rawContents = augmentedMessages.map((m: any) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: toGeminiParts(m),
            }));
            // Merge consecutive turns with the same role to satisfy Gemini's strict alternation rule
            const contents: Array<{ role: string; parts: any[] }> = [];
            for (const item of rawContents) {
              if (contents.length > 0 && contents[contents.length - 1].role === item.role) {
                contents[contents.length - 1].parts.push(...item.parts);
              } else {
                contents.push({ role: item.role, parts: [...item.parts] });
              }
            }

            const geminiTools = params.tools && params.tools.length > 0
              ? [{
                  functionDeclarations: params.tools.map((t: any) => ({
                    name: t.function?.name || t.name,
                    description: t.function?.description || t.description || '',
                    parameters: t.function?.parameters || t.parameters || { type: 'object', properties: {} },
                  })),
                }]
              : undefined;

            const isThinkingModel = /gemini-2\.5|gemini-3|thinking/i.test(geminiModel);
            const requestBody = JSON.stringify({
              contents,
              systemInstruction: params.systemPrompt ? { parts: [{ text: params.systemPrompt }] } : undefined,
              ...(geminiTools ? { tools: geminiTools } : {}),
              generationConfig: {
                temperature: params.temperature ?? 0.7,
                ...(isThinkingModel ? { thinkingConfig: { thinkingBudget: 4096 } } : {}),
              },
            });

            const nativeHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...cred.headers,
            };
            if (cookie) nativeHeaders['Cookie'] = cookie;

            // Attempt 3b: Native streaming — SSE frames of GenerateContentResponse
            try {
              const sseUrl = key
                ? `${nativeBase}/models/${geminiModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`
                : `${nativeBase}/models/${geminiModel}:streamGenerateContent?alt=sse`;
              const nativeRes = await resilientFetch(sseUrl, {
                method: 'POST',
                headers: nativeHeaders,
                body: requestBody,
                signal: controller.signal,
              });

              if (nativeRes.ok && nativeRes.body) {
                let text = '';
                let receivedAny = false;
                const toolCalls: any[] = [];

                for await (const frame of iterateSSEData(nativeRes)) {
                  if (params.signal?.aborted) return;
                  let evt: any;
                  try { evt = JSON.parse(frame); } catch { continue; }
                  for (const p of evt?.candidates?.[0]?.content?.parts || []) {
                    if (p.thought || p.thought === true) {
                      if (typeof p.text === 'string' && p.text) {
                        yield { thinking: p.text };
                      }
                      continue;
                    }
                    if (typeof p.text === 'string' && p.text) {
                      text += p.text;
                      receivedAny = true;
                      yield { delta: p.text };
                    }
                    if (p.functionCall?.name) {
                      toolCalls.push({
                        id: `tool-${Date.now()}-${toolCalls.length}`,
                        tool: p.functionCall.name,
                        params: p.functionCall.args || {},
                        requiresApproval: false,
                        status: 'approved',
                        timestamp: Date.now(),
                      });
                    }
                  }
                }

                if (!receivedAny && toolCalls.length === 0) throw new Error('Empty Gemini stream');

                if (toolCalls.length === 0 && text) {
                  toolCalls.push(...extractAndStripTextToolCalls(text).extractedTools);
                }
                if (toolCalls.length) yield { toolCalls };
                if (!isSpecificModelChosen) this.stickyAutoProvider = provider;
                finishUsage(text);
                yield { done: true };
                return;
              }
            } catch {
              if (params.signal?.aborted) return;
              // Fall through to the buffered native fallback below
            }

            // Attempt 3c: buffered native generateContent (once per attempt)
            const bufferedUrl = key
              ? `${nativeBase}/models/${geminiModel}:generateContent?key=${encodeURIComponent(key)}`
              : `${nativeBase}/models/${geminiModel}:generateContent`;
            const nativeRes = await resilientFetch(bufferedUrl, {
              method: 'POST',
              headers: nativeHeaders,
              body: requestBody,
              signal: controller.signal,
            });

            if (nativeRes.ok) {
              const nativeData = await nativeRes.json();
              const parts = nativeData.candidates?.[0]?.content?.parts || [];
              let text = '';
              const toolCalls: any[] = [];

              for (const p of parts) {
                if (p.text) text += p.text;
                if (p.functionCall) {
                  toolCalls.push({
                    id: `tool-${Date.now()}-${toolCalls.length}`,
                    tool: p.functionCall.name,
                    params: p.functionCall.args || {},
                    requiresApproval: false,
                    status: 'approved',
                    timestamp: Date.now(),
                  });
                }
              }

              yield* bufferedTextChunks(text);
              if (toolCalls.length === 0 && text) {
                toolCalls.push(...extractAndStripTextToolCalls(text).extractedTools);
              }
              if (toolCalls.length) yield { toolCalls };
              if (!isSpecificModelChosen) this.stickyAutoProvider = provider;
              finishUsage(text);
              yield { done: true };
              return;
            } else {
              const geminiErr = await nativeRes.json().catch(() => null);
              const geminiErrMsg = geminiErr?.error?.message || (await nativeRes.text().catch(() => '')) || `HTTP ${nativeRes.status}`;
              if (isSpecificModelChosen) {
                yield { error: `[Google Gemini] Pinned model "${requestedModel.name || requestedModel.id}" (${geminiModel}) failed with HTTP ${nativeRes.status}: ${geminiErrMsg}. this model was pinned, so the Astra fallback chain is paused. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
                yield { done: true };
                return;
              }
              const isRateLimit = nativeRes.status === 429 || isRateLimitFailure(geminiErrMsg);
              if (isRateLimit && providerQueue.length > 0) {
                this.recordProviderCooldown(provider, 30000);
                yield { resetContent: true };
                yield { thinking: `[Google Gemini] Quota/rate limit reached on ${requestedModel.name || geminiModel} (HTTP ${nativeRes.status}). Seamlessly failing over to next available provider…` };
                continue;
              }
            }
          } catch (geminiCatchErr: any) {
            if (params.signal?.aborted) return;
            if (isSpecificModelChosen) {
              yield { error: `[Google Gemini] Pinned model "${requestedModel.name || requestedModel.id}" failed: ${geminiCatchErr?.message || 'Connection error'}. this model was pinned, so the Astra fallback chain is paused. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
              yield { done: true };
              return;
            }
            const isRateLimit = isRateLimitFailure(geminiCatchErr);
            if (isRateLimit && providerQueue.length > 0) {
              this.recordProviderCooldown(provider, 30000);
              yield { resetContent: true };
              yield { thinking: `[Google Gemini] Rate limit encountered (${geminiCatchErr?.message?.slice(0, 80)}). Failing over to next available provider…` };
              continue;
            }
            // Fall through to next provider in fallback chain
          }
        }

        // 3.5. ChatGPT Web Session Cookie Engine (Direct browser session execution)
        if (provider === 'chatgpt-web' || (provider === 'openai' && cookie && !key)) {
          if (!cookie) {
            if (isSpecificModelChosen) {
              yield { error: `ChatGPT Web session cookie is missing. Open Settings > Providers and paste your session cookie (__Secure-next-auth.session-token).` };
              yield { done: true };
              return;
            }
            continue;
          }
          try {
            let streamedAny = false;
            let capturedText = '';
            for await (const webChunk of chatgptWebProvider.streamConversation({
              cookieString: cookie,
              messages: augmentedMessages,
              systemPrompt: params.systemPrompt,
              model: providerModelId,
              signal: controller.signal,
            })) {
              if (params.signal?.aborted) return;
              if (webChunk.thinking) {
                yield { thinking: webChunk.thinking };
              }
              if (webChunk.error) {
                throw new Error(webChunk.error);
              }
              if (webChunk.delta) {
                streamedAny = true;
                capturedText += webChunk.delta;
                yield { delta: webChunk.delta };
              }
              if (webChunk.done) {
                if (streamedAny) {
                  if (!isSpecificModelChosen) this.stickyAutoProvider = provider;
                  finishUsage(capturedText);
                  clearTimeout(timeout);
                  yield { done: true };
                  return;
                }
              }
            }
            if (streamedAny) {
              if (!isSpecificModelChosen) this.stickyAutoProvider = provider;
              finishUsage(capturedText);
              clearTimeout(timeout);
              yield { done: true };
              return;
            }
            throw new Error('Empty response received from ChatGPT Web session');
          } catch (webErr: any) {
            console.warn(`[ModelRouter] ChatGPT Web session error: ${webErr.message}`);
            if (isSpecificModelChosen) {
              yield { error: `ChatGPT Web error: ${webErr.message}. Open Settings > Providers to paste a fresh session cookie.` };
              yield { done: true };
              return;
            }
            failedPreviousRoute = provider;
            this.recordProviderCooldown(provider, 30000);
            yield { resetContent: true };
            yield { thinking: `ChatGPT Web session encountered an issue (${webErr.message.slice(0, 80)}). Seamlessly failing over to next available provider…` };
            continue;
          }
        }

        // 4. Generic OpenAI-compatible path (OpenAI / DeepSeek / OpenRouter / Groq / GitHub / Ollama /
        //    Zhipu GLM / xAI / Qwen / Cerebras / Moonshot / Together / Fireworks / SambaNova / Sarvam / ... 100+)
        //    True SSE streaming with ONE buffered fallback per attempt.
        if ((key || cookie || provider === 'ollama' || provider === 'pollinations' || provider === 'custom' || (currentModel as any)?.baseUrl || customEntry?.config?.baseUrl) && provider !== 'chatgpt-web') {
          // Resolution order: model explicit baseUrl -> custom model config baseUrl -> credential baseUrl -> known provider default -> graceful skip.
          // NEVER falls back to api.openai.com for non-OpenAI providers (prevents cross-provider key leakage).
          const rawBaseUrl = (currentModel as any)?.baseUrl || customEntry?.config?.baseUrl || (requestedModel as any)?.baseUrl || cred.baseUrl || PROVIDER_BASE_URLS[provider] || '';
          const baseUrl = rawBaseUrl.replace(/\/+$/, '');
          const completionsUrl = baseUrl.endsWith('/chat/completions')
            ? baseUrl
            : provider === 'pollinations'
            ? `${baseUrl}/openai`
            : baseUrl.endsWith('/v1')
            ? `${baseUrl}/chat/completions`
            : baseUrl.includes('/chat/completions')
            ? baseUrl
            : `${baseUrl}/chat/completions`;

          if (!baseUrl) {
            if (!this.unroutedProvidersWarned.has(provider)) {
              this.unroutedProvidersWarned.add(provider);
              console.warn(`[ModelRouter] Provider "${provider}" has no Base URL configured and no known default endpoint — skipping to next fallback in chain.`);
            }
            continue;
          }

          let effectiveModelId = providerModelId;
          if (customEntry?.modelId) {
            effectiveModelId = customEntry.modelId;
          }
          if (effectiveModelId.startsWith('winclusionai/')) {
            effectiveModelId = effectiveModelId.replace(/^winclusionai\//, 'inclusionai/');
          }
          if (provider === 'openrouter') {
            effectiveModelId = effectiveModelId.replace(/^openrouter\//, '').replace(/^openrouter:/, '');
          }

          const candidateModels = isSpecificModelChosen
            ? [effectiveModelId]
            : (provider === 'groq'
                ? Array.from(new Set([effectiveModelId, 'openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'groq/compound', 'openai/gpt-oss-20b'])).filter(
                    (m) => !['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'qwen-2.5-32b', 'qwen-2.5-coder-32b', 'deepseek-r1-distill-llama-70b', 'mixtral-8x7b-32768'].includes(m)
                  )
                : (provider === 'sarvam'
                    ? Array.from(new Set([effectiveModelId, 'sarvam-105b', 'sarvam-m', 'sarvam-2b']))
                    : [effectiveModelId]));

          const reqHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...cred.headers,
          };
          if (key) {
            const cleanKey = key.trim().replace(/^["']|["']$/g, '');
            reqHeaders['Authorization'] = `Bearer ${cleanKey}`;
            // Add api-subscription-key for Sarvam AI or custom endpoints that require it
            if (provider === 'sarvam' || baseUrl.includes('sarvam') || (currentModel?.name || '').toLowerCase().includes('sarvam')) {
              reqHeaders['api-subscription-key'] = cleanKey;
            }
          }
          if (provider === 'openrouter' || baseUrl.includes('openrouter.ai')) {
            reqHeaders['HTTP-Referer'] = 'https://sutra.build';
            reqHeaders['X-Title'] = 'SUTRA IDE';
          }
          if (cookie) {
            reqHeaders['Cookie'] = cookie;
            if (!reqHeaders['Authorization']) {
              if (cookie.includes('session-token=')) {
                const m = cookie.match(/session-token=([^;]+)/);
                if (m) reqHeaders['Authorization'] = `Bearer ${m[1]}`;
              } else if (cookie.includes('userToken=')) {
                const m = cookie.match(/userToken=([^;]+)/);
                if (m) reqHeaders['Authorization'] = `Bearer ${m[1]}`;
              }
            }
          }

          let lastCandidateError = '';
          for (const candModel of candidateModels) {
            try {
              // Preemptively calibrate payload, system prompt, and tools to model's exact tier limit profile
              const calibrated = calibratePayloadForModel(candModel, provider, augmentedMessages, params.systemPrompt);

              let activeMaxTokens = Math.min((params as any).maxTokens || 4096, 8192);

              const buildChatBody = (messagesPayload: any[], systemContent: string, toolsPayload: any[], streaming: boolean, tokenLimit?: number): Record<string, any> => {
                const body: Record<string, any> = {
                  model: candModel,
                  messages: systemContent && systemContent.trim().length > 0
                    ? [{ role: 'system', content: systemContent }, ...messagesPayload]
                    : [...messagesPayload],
                  temperature: params.temperature ?? 0.7,
                  max_tokens: tokenLimit || activeMaxTokens,
                };
                if (currentModel.supportsTools && toolsPayload.length > 0) {
                  body.tools = toolsPayload;
                  body.tool_choice = 'auto';
                }
                if (streaming) body.stream = true;
                return body;
              };

              let res = await resilientFetch(`${completionsUrl}`, {
                method: 'POST',
                headers: reqHeaders,
                body: JSON.stringify(buildChatBody(
                  calibrated.compactedMessages,
                  calibrated.compactedSystemPrompt,
                  currentModel.supportsTools ? calibrated.prunedTools : [],
                  true
                )),
                signal: controller.signal,
              });
              let responseIsStreaming = true;
              const initialContentType = (res.headers.get('content-type') || '').toLowerCase();
              if (res.ok && !initialContentType.includes('text/event-stream') && (initialContentType.includes('application/json') || initialContentType.includes('text/plain'))) {
                responseIsStreaming = false;
              }

              if (!res.ok) {
                const rawBody = await res.text().catch(() => '');
                let errData: any = null;
                try { errData = JSON.parse(rawBody); } catch {}
                const errMsg = errData?.error?.message || errData?.message || (typeof errData?.error === 'string' ? errData.error : '') || rawBody || `HTTP ${res.status}`;
                const errCode = errData?.error?.code || errData?.code || '';

                const isDecommissioned = res.status === 404 || errCode === 'model_not_found' || errCode === 'model_decommissioned';
                const isPaymentRequired = res.status === 402 || errMsg.toLowerCase().includes('payment required') || errMsg.toLowerCase().includes('billing') || errMsg.toLowerCase().includes('account');
                const isToolUnsupported = errMsg.toLowerCase().includes('tool calling is not supported') || errMsg.toLowerCase().includes('tools is not supported');
                const isRateLimited = res.status === 429 || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('tpm limit');
                const isPayloadTooLarge = res.status === 413 || errMsg.toLowerCase().includes('request too large') || errMsg.toLowerCase().includes('tokens per minute (tpm)') || errMsg.toLowerCase().includes('reduce your message size');

                // Auto-retry on HTTP 402 with credit/token limit (e.g. OpenRouter "can only afford X tokens")
                const affordMatch = errMsg.match(/can only afford\s*(\d+)/i);
                if ((isPaymentRequired || res.status === 402) && affordMatch && totalAttempts < 2) {
                  const affordableTokens = Math.max(256, Math.floor(parseInt(affordMatch[1], 10) * 0.95));
                  yield { thinking: `Adjusting max_tokens to ${affordableTokens} based on available account credit...` };
                  activeMaxTokens = affordableTokens;
                  totalAttempts += 1;
                  const retryRes = await resilientFetch(`${completionsUrl}`, {
                    method: 'POST',
                    headers: reqHeaders,
                    body: JSON.stringify(buildChatBody(calibrated.compactedMessages, calibrated.compactedSystemPrompt, currentModel.supportsTools ? calibrated.prunedTools : [], true, affordableTokens)),
                    signal: controller.signal,
                  });
                  if (retryRes.ok) {
                    res = retryRes;
                  } else {
                    const retryErrData = await retryRes.json().catch(() => null);
                    const retryErrMsg = retryErrData?.error?.message || retryErrData?.message || (await retryRes.text().catch(() => '')) || `HTTP ${retryRes.status}`;
                    yield { error: `[${providerDisplayName(provider)}] Pinned model "${requestedModel.name || requestedModel.id}" (${candModel}) returned HTTP ${retryRes.status}: ${retryErrMsg}. Switch to Auto mode or select an active free model like Ling 3.0.` };
                    yield { done: true };
                    return;
                  }
                }

                if (isSpecificModelChosen) {
                  if (isRateLimited && totalAttempts < 2) {
                    const delayMatch = errMsg.match(/try again in\s*([0-9.]+)\s*(s|ms|m)?/i);
                    let waitMs = 1000;
                    if (delayMatch) {
                      const val = parseFloat(delayMatch[1]);
                      const unit = (delayMatch[2] || 's').toLowerCase();
                      if (unit === 'ms') waitMs = Math.round(val);
                      else if (unit === 'm') waitMs = Math.round(val * 60 * 1000);
                      else waitMs = Math.round(val * 1000) + 200;
                    }
                    if (waitMs <= 6000) {
                      yield { thinking: `Rate limit (HTTP 429) on pinned model \`${candModel}\`. Auto-waiting ${(waitMs / 1000).toFixed(1)}s before retry...` };
                      await new Promise((r) => setTimeout(r, waitMs));
                      totalAttempts += 1;
                      const retryRes = await resilientFetch(`${completionsUrl}`, {
                        method: 'POST',
                        headers: reqHeaders,
                        body: JSON.stringify(buildChatBody(calibrated.compactedMessages, calibrated.compactedSystemPrompt, currentModel.supportsTools ? calibrated.prunedTools : [], true)),
                        signal: controller.signal,
                      });
                      if (retryRes.ok) {
                        res = retryRes;
                      } else {
                        const retryErrData = await retryRes.json().catch(() => null);
                        const retryErrMsg = retryErrData?.error?.message || retryErrData?.message || (await retryRes.text().catch(() => '')) || `HTTP ${retryRes.status}`;
                        yield { error: `[${providerDisplayName(provider)}] Pinned model "${requestedModel.name || requestedModel.id}" (${candModel}) failed with HTTP ${retryRes.status}: ${retryErrMsg}. Execution stopped because this model was explicitly selected. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
                        yield { done: true };
                        return;
                      }
                    } else {
                      yield { error: `[${providerDisplayName(provider)}] Pinned model "${requestedModel.name || requestedModel.id}" (${candModel}) rate limit hit (HTTP 429: ${errMsg}). Execution stopped because this model was explicitly selected. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
                      yield { done: true };
                      return;
                    }
                  } else {
                    yield { error: `[${providerDisplayName(provider)}] Pinned model "${requestedModel.name || requestedModel.id}" (${candModel}) returned HTTP ${res.status}: ${errMsg}. Execution stopped because this model was explicitly selected. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
                    yield { done: true };
                    return;
                  }
                }

                if (isDecommissioned) {
                  lastCandidateError = `Model ${candModel} decommissioned/unavailable on ${provider}`;
                  continue;
                }

                if (isPaymentRequired) {
                  lastCandidateError = `Payment/billing required for ${candModel} on ${provider}. Check your account billing or subscription.`;
                  this.recordProviderCooldown(provider, 30000);
                  continue;
                }

                if (isRateLimited || isPayloadTooLarge) {
                  // Learn exact limit from error message (e.g. Limit 8000, Requested 9167)
                  learnedModelLimits.record413Error(candModel, errMsg);
                  lastCandidateError = `TPM/Payload limit on ${candModel}: ${errMsg}.`;

                  // Parse exact retry delay from provider error message (e.g. "Please try again in 4.26s")
                  const delayMatch = errMsg.match(/try again in\s*([0-9.]+)\s*(s|ms|m)?/i);
                  let waitMs = 250;
                  if (delayMatch) {
                    const val = parseFloat(delayMatch[1]);
                    const unit = (delayMatch[2] || 's').toLowerCase();
                    if (unit === 'ms') waitMs = Math.round(val);
                    else if (unit === 'm') waitMs = Math.round(val * 60 * 1000);
                    else waitMs = Math.round(val * 1000) + 200; // 200ms safety buffer
                  }

                  this.recordProviderCooldown(provider, Math.max(waitMs, 5000));

                  // If wait time is short (<= 8s), auto-wait and retry with compacted payload
                  if (waitMs <= 8000) {
                    yield { thinking: `Rate limit reached on \`${candModel}\` (${errMsg.slice(0, 100)}). Auto-waiting ${(waitMs / 1000).toFixed(1)}s before retry...` };
                    await new Promise((r) => setTimeout(r, waitMs));
                  }

                  // Re-calibrate with freshly learned limit
                  const reCalibrated = calibratePayloadForModel(candModel, provider, augmentedMessages, params.systemPrompt);

                  const retryRes = await resilientFetch(`${completionsUrl}`, {
                    method: 'POST',
                    headers: reqHeaders,
                    body: JSON.stringify(buildChatBody(
                      reCalibrated.compactedMessages,
                      reCalibrated.compactedSystemPrompt,
                      currentModel.supportsTools ? reCalibrated.prunedTools : [],
                      true
                    )),
                    signal: controller.signal,
                  });
                  if (retryRes.ok) {
                    res = retryRes;
                  } else {
                    await new Promise((r) => setTimeout(r, 150));
                    continue; // Try next candidate model in chain
                  }
                } else if (isToolUnsupported) {
                  // Retry without native tools parameter, relying on system prompt instructions
                  const retryRes = await resilientFetch(`${completionsUrl}`, {
                    method: 'POST',
                    headers: reqHeaders,
                    body: JSON.stringify(buildChatBody(calibrated.compactedMessages, calibrated.compactedSystemPrompt, [], true)),
                    signal: controller.signal,
                  });
                  if (retryRes.ok) {
                    res = retryRes;
                  } else {
                    continue;
                  }
                } else {
                  // Unclassified refusal (e.g. endpoint without SSE support) — ONE buffered retry.
                  const bufferedRetry = await resilientFetch(`${completionsUrl}`, {
                    method: 'POST',
                    headers: reqHeaders,
                    body: JSON.stringify(buildChatBody(
                      calibrated.compactedMessages,
                      calibrated.compactedSystemPrompt,
                      currentModel.supportsTools ? calibrated.prunedTools : [],
                      false
                    )),
                    signal: controller.signal,
                  });
                  if (bufferedRetry.ok) {
                    res = bufferedRetry;
                    responseIsStreaming = false;
                  } else {
                    continue;
                  }
                }
              }

              const finalContentType = (res.headers.get('content-type') || '').toLowerCase();
              if (res.ok && !finalContentType.includes('text/event-stream') && (finalContentType.includes('application/json') || finalContentType.includes('text/plain'))) {
                responseIsStreaming = false;
              }

              // Consume the response: live SSE deltas when streaming, buffered chunks otherwise.
              const assembler = new StreamedToolCallAssembler();
              const sink = { fullText: '', finishReason: '' };
              let receivedAny = false;
              let extraToolCalls: any[] = [];

              const absorbBufferedCompletion = (parsed: { text: string; finishReason: string; nativeToolCalls: any[]; textToolCalls: any[] }): void => {
                sink.fullText += parsed.text;
                sink.finishReason = parsed.finishReason;
                for (const call of parsed.nativeToolCalls) {
                  extraToolCalls.push({
                    id: call.id || `tool-${Date.now()}-${extraToolCalls.length}`,
                    tool: call.function?.name,
                    params: safeJson(call.function?.arguments),
                    requiresApproval: false,
                    status: 'approved',
                    timestamp: Date.now(),
                  });
                }
                if (extraToolCalls.length === 0 && parsed.textToolCalls.length > 0) {
                  extraToolCalls = parsed.textToolCalls;
                }
                receivedAny = parsed.text.length > 0 || extraToolCalls.length > 0;
              };

              const parseBufferedCompletion = async (bufferedResponse: Response): Promise<{ text: string; finishReason: string; nativeToolCalls: any[]; textToolCalls: any[] }> => {
                const data = await bufferedResponse.json().catch(() => null);
                const choice = data?.choices?.[0] || {};
                const message = choice.message || {};
                const rawContent = (typeof message.content === 'string' && message.content)
                  || (typeof message.reasoning_content === 'string' && message.reasoning_content)
                  || (typeof message.reasoning === 'string' && message.reasoning)
                  || '';
                const { cleanText, extractedTools } = extractAndStripTextToolCalls(rawContent);
                return {
                  text: cleanText,
                  finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : '',
                  nativeToolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
                  textToolCalls: extractedTools,
                };
              };

              if (responseIsStreaming) {
                try {
                  for await (const chunk of consumeOpenAICompatibleSSE(res, assembler, sink, params.signal)) {
                    receivedAny = true;
                    yield chunk;
                  }
                } catch {
                  if (params.signal?.aborted) return;
                  if (!receivedAny) {
                    // Transport-level failure before any content arrived — ONE buffered fallback.
                    try {
                      const bufferedRes = await resilientFetch(`${completionsUrl}`, {
                        method: 'POST',
                        headers: reqHeaders,
                        body: JSON.stringify(buildChatBody(
                          calibrated.compactedMessages,
                          calibrated.compactedSystemPrompt,
                          currentModel.supportsTools ? calibrated.prunedTools : [],
                          false
                        )),
                        signal: controller.signal,
                      });
                      if (!bufferedRes.ok) throw new Error(`HTTP ${bufferedRes.status}`);
                      absorbBufferedCompletion(await parseBufferedCompletion(bufferedRes));
                      yield* bufferedTextChunks(sink.fullText);
                    } catch (bufferedErr: any) {
                      lastCandidateError = bufferedErr.message || 'Stream failed';
                      continue;
                    }
                  }
                  // Partial delivery: keep everything streamed so far and finish below.
                }
              } else {
                // Endpoint refused SSE support — consume the buffered JSON response.
                absorbBufferedCompletion(await parseBufferedCompletion(res));
                yield* bufferedTextChunks(sink.fullText);
              }

              // Auto-Continuation: seamlessly resume when output hit max_tokens mid-answer
              let continuationTurns = 0;
              while (sink.finishReason === 'length' && continuationTurns < 5) {
                if (params.signal?.aborted) return;
                continuationTurns += 1;

                try {
                  // Prune older turns if continuation context is large so we don't blow token limits
                  let contMessages = augmentedMessages;
                  if (contMessages.length > 2) {
                    const lastUser = contMessages.filter((m: any) => m.role === 'user').pop();
                    const firstUser = contMessages.find((m: any) => m.role === 'user');
                    contMessages = firstUser && lastUser && firstUser !== lastUser ? [firstUser, lastUser] : (lastUser ? [lastUser] : contMessages.slice(-2));
                  }

                  const contRes = await resilientFetch(`${completionsUrl}`, {
                    method: 'POST',
                    headers: reqHeaders,
                    body: JSON.stringify(buildChatBody(
                      [
                        ...contMessages,
                        { role: 'assistant', content: sink.fullText },
                        { role: 'user', content: 'Continue generating the remaining code and output exactly from where you stopped. Do not repeat previously outputted lines.' },
                      ],
                      params.systemPrompt || '',
                      [], // Strictly disable tools during text continuation to prevent tool loops
                      true
                    )),
                    signal: controller.signal,
                  });

                  if (!contRes.ok) break;

                  const contSink = { fullText: '', finishReason: '' };
                  const contAssembler = new StreamedToolCallAssembler();
                  for await (const contChunk of consumeOpenAICompatibleSSE(contRes, contAssembler, contSink, params.signal)) {
                    yield contChunk;
                  }
                  if (!contSink.fullText) break;
                  sink.fullText += contSink.fullText;
                  sink.finishReason = contSink.finishReason;
                } catch {
                  break;
                }
              }

              let toolCalls = [...assembler.assemble(), ...extraToolCalls];

              // Extract text-embedded JSON tool calls if native tools were not populated
              if (toolCalls.length === 0 && sink.fullText.includes('```json') && sink.fullText.includes('"tool"')) {
                try {
                  const match = sink.fullText.match(/```json\s*([\s\S]*?)\s*```/);
                  if (match) {
                    const parsed = JSON.parse(match[1]);
                    if (parsed.tool) {
                      toolCalls = [{
                        id: `tool-${Date.now()}-0`,
                        tool: parsed.tool,
                        params: parsed.params || parsed.arguments || {},
                        requiresApproval: false,
                        status: 'approved',
                        timestamp: Date.now(),
                      }];
                    }
                  }
                } catch {
                  // Fenced JSON was malformed — pseudo-tool extraction below still runs
                }
              }

              // Text-based pseudo-tool extraction applied to the final accumulated answer
              if (toolCalls.length === 0 && sink.fullText) {
                toolCalls = extractAndStripTextToolCalls(sink.fullText).extractedTools;
              }

              if (!receivedAny && toolCalls.length === 0) {
                lastCandidateError = `Empty response from ${candModel} on ${provider}`;
                continue;
              }

              if (toolCalls.length) yield { toolCalls };
              if (!isSpecificModelChosen) this.stickyAutoProvider = provider;
              finishUsage(sink.fullText);
              learnedModelLimits.recordSuccess(candModel);
              yield { done: true };
              return;
            } catch (innerErr: any) {
              if (innerErr.name === 'AbortError' && params.signal?.aborted) return;
              lastCandidateError = innerErr.message || 'Execution failed';
              continue;
            }
          }
          if (lastCandidateError) {
            if (isSpecificModelChosen) {
              yield { error: `[${providerDisplayName(provider)}] Model "${requestedModel.name || requestedModel.id}" (${providerModelId}) failed: ${lastCandidateError}. Execution stopped because this model was explicitly selected. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
              yield { done: true };
              return;
            }
            attemptErrors.push({ provider, error: lastCandidateError });
            totalAttempts += 1;
            const retryable = !isHardFailure({ message: lastCandidateError });
            const rateLimited = retryable && isRateLimitFailure({ message: lastCandidateError });
            const sameProviderCap = rateLimited ? MAX_RATE_LIMIT_RETRIES : MAX_SAME_MODEL_RETRIES;
            if (retryable && consecutiveRetries < sameProviderCap && totalAttempts < MAX_TOTAL_ATTEMPTS) {
              consecutiveRetries += 1;
              yield { retryEvent: { attempt: totalAttempts, totalAttempts: MAX_TOTAL_ATTEMPTS, provider, model: providerModelId, status: 'retry', latencyMs: 0, reason: lastCandidateError } };
              // A partially-streamed answer from the failed attempt must not stay
              // glued in front of the retry's answer — clear it for a clean sequence.
              yield { resetContent: true };
              yield { thinking: `Retrying ${providerDisplayName(provider)}… (same-model retry ${consecutiveRetries}/${sameProviderCap}${rateLimited ? ' — rate-limit cap' : ''})` };
              await sleep(retryBackoffMs);
              retryBackoffMs = Math.min(retryBackoffMs * 2, RETRY_BACKOFF_CAP_MS);
              providerQueue.unshift(provider);
            } else {
              retryBackoffMs = RETRY_BACKOFF_START_MS;
              consecutiveRetries = 0;
              failedPreviousRoute = provider;
              if (!isSpecificModelChosen && this.stickyAutoProvider === provider) {
                this.stickyAutoProvider = null;
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError' && params.signal?.aborted) return;
        if (isSpecificModelChosen) {
          yield { error: `[${providerDisplayName(provider)}] Model "${requestedModel.name || requestedModel.id}" (${providerModelId}) failed: ${err.message || 'Execution error'}. Execution stopped because this model was explicitly selected. Switch to Auto mode for full fallback, or pick a different model from the selector.` };
          yield { done: true };
          return;
        }
        if (!isSpecificModelChosen && this.stickyAutoProvider === provider) {
          this.stickyAutoProvider = null;
        }
        attemptErrors.push({ provider, error: err.message || 'Execution error' });
        totalAttempts += 1;
        const retryable = !isHardFailure(err);
        const rateLimited = retryable && isRateLimitFailure(err);
        const sameProviderCap = rateLimited ? MAX_RATE_LIMIT_RETRIES : MAX_SAME_MODEL_RETRIES;
        if (retryable && consecutiveRetries < sameProviderCap && totalAttempts < MAX_TOTAL_ATTEMPTS) {
          consecutiveRetries += 1;
          yield { retryEvent: { attempt: totalAttempts, totalAttempts: MAX_TOTAL_ATTEMPTS, provider, model: providerModelId, status: 'retry', latencyMs: 0, reason: err.message || 'Execution error' } };
          yield { resetContent: true };
          yield { thinking: `Retrying ${providerDisplayName(provider)}… (same-model retry ${consecutiveRetries}/${sameProviderCap}${rateLimited ? ' — rate-limit cap' : ''})` };
          await sleep(retryBackoffMs);
          retryBackoffMs = Math.min(retryBackoffMs * 2, RETRY_BACKOFF_CAP_MS);
          providerQueue.unshift(provider);
        } else {
          retryBackoffMs = RETRY_BACKOFF_START_MS;
          consecutiveRetries = 0;
          failedPreviousRoute = provider;
        }
        continue;
      } finally {
        clearTimeout(timeout);
        params.signal?.removeEventListener('abort', relayExternalAbort);
      }
    }

    // 4. Diagnostic fallback response
    const hasAnyKey = Object.values(this.apiKeys).some((k) => k && k.trim().length > 0);
    
    let helpMessage: string;
    if (attemptErrors.length > 0) {
      const errorDetails = attemptErrors.map(e => `• **${e.provider.toUpperCase()}**: ${e.error}`).join('\n');
      helpMessage = `**AI Provider Execution Notice**\n\nAstra attempted to execute with your configured provider credentials, but encountered an error:\n\n${errorDetails}\n\n**Next Steps:**\n1. Check your API key, endpoint, or model tier in **Settings** (\`⌘K\` → \`Settings\`).\n2. Astra will retry automatically.`;
    } else if (hasAnyKey) {
      helpMessage = `**Astra hit a snag**\n\nThe model endpoint did not respond. Check your connection or keys in Settings.`;
    } else {
      helpMessage = `I am active and ready to build. However, no AI provider API keys are currently configured in this environment.

### Quick Setup (Takes 30 seconds):
1. Open **Settings** (gear icon in the ActivityBar or press \`⌘K\` → \`Settings\`).
2. Add a free **Groq** key, **Google Gemini** key from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey), or an **OpenRouter**, **DeepSeek**, **Anthropic**, or **OpenAI** key.
3. Or run **Ollama** locally (\`ollama run qwen2.5-coder\`) for 100% free offline execution.`;
    }

    yield* bufferedTextChunks(helpMessage);
    yield { done: true };
  }
}

function safeJson(value: unknown): Record<string, any> {
  if (typeof value === 'object' && value !== null) return value as Record<string, any>;
  try {
    return JSON.parse(typeof value === 'string' ? value : '{}');
  } catch {
    return {};
  }
}

export const modelRouter = new ModelRouter();
