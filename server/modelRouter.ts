import db from './db.js';
import { ModelDefinition, CustomProviderConfig, AIProviderId } from './types.js';
import { providerAuthHandler } from './providers/authHandler.js';
import { chatgptWebProvider, CHATGPT_WEB_FALLBACK_MODEL_IDS } from './providers/chatgptWebProvider.js';
import { customModelsManager } from './customModels.js';

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
};

/**
 * Flagship default chat model per dynamic provider (used when no catalog entry exists yet).
 * Kept current for August 2026; users can always pin an explicit model id.
 */
const PROVIDER_DEFAULT_MODEL_IDS: Record<string, string> = {
  groq: 'openai/gpt-oss-120b',
  google: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5',
  deepseek: 'deepseek-chat',
  openrouter: 'anthropic/claude-sonnet-5',
  github: 'gpt-4.1',
  ollama: 'qwen2.5-coder',
  pollinations: 'openai',
  zhipu: 'glm-4.6',
  glm: 'glm-4.6',
  'glm-web': 'glm-4.6',
  xai: 'grok-4',
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
  sarvam: 'sarvam-m',
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
  { name: 'ast_grep', description: 'Search code files by AST structure or pattern.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, language: { type: 'string' } }, required: ['pattern'] } },
  { name: 'format_code', description: 'Auto-format source code file with Prettier/linter.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'lint_code', description: 'Run linter on a file or entire project.', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'typecheck_project', description: 'Run TypeScript compiler typecheck across the project.', input_schema: { type: 'object', properties: {} } },
  { name: 'find_dead_code', description: 'Analyze project to find unused files and exported symbols.', input_schema: { type: 'object', properties: {} } },
  { name: 'count_loc', description: 'Count total lines of code grouped by language and file extension.', input_schema: { type: 'object', properties: {} } },

  // 2. Terminal & Shell Execution (6 Tools)
  { name: 'run_command', description: 'Run a shell command synchronously within the workspace.', input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] } },
  { name: 'run_background_process', description: 'Spawn a long-running background dev server or worker.', input_schema: { type: 'object', properties: { command: { type: 'string' }, name: { type: 'string' } }, required: ['command'] } },
  { name: 'kill_process', description: 'Terminate a running background process by name or PID.', input_schema: { type: 'object', properties: { processId: { type: 'string' } }, required: ['processId'] } },
  { name: 'list_running_processes', description: 'List all active background processes managed by the IDE.', input_schema: { type: 'object', properties: {} } },
  { name: 'inspect_port', description: 'Check if a network port is open or in use by another process.', input_schema: { type: 'object', properties: { port: { type: 'number' } }, required: ['port'] } },
  { name: 'bench_http_endpoint', description: 'Benchmark HTTP API latency and throughput.', input_schema: { type: 'object', properties: { url: { type: 'string' }, requests: { type: 'number' } }, required: ['url'] } },

  // 3. Git & Version Control (8 Tools)
  { name: 'git_status', description: 'Check current git branch, untracked files, and modified files.', input_schema: { type: 'object', properties: {} } },
  { name: 'git_diff', description: 'Inspect exact line-by-line diff of pending workspace changes.', input_schema: { type: 'object', properties: { path: { type: 'string' }, staged: { type: 'boolean' } } } },
  { name: 'git_commit', description: 'Stage all files and commit with a message.', input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
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

  // 6. Multimodal & Asset Generation (5 Tools)
  { name: 'generate_image_asset', description: 'Create an image asset in the project (FLUX / DALL-E / SVG fallback).', input_schema: { type: 'object', properties: { prompt: { type: 'string' }, filename: { type: 'string' }, dimensions: { type: 'string' }, model: { type: 'string' } }, required: ['prompt', 'filename'] } },
  { name: 'generate_video_asset', description: 'Generate and save a real video (Replicate Minimax / Pollinations). If unavailable, ask the user for a real video file instead of using any placeholder.', input_schema: { type: 'object', properties: { prompt: { type: 'string' }, filename: { type: 'string' }, model: { type: 'string' } }, required: ['prompt', 'filename'] } },
  { name: 'generate_audio_asset', description: 'Generate speech or tactile UI sound effects (Google TTS / 44.1kHz PCM Synthesizer fallback).', input_schema: { type: 'object', properties: { type: { type: 'string' }, filename: { type: 'string' }, prompt: { type: 'string' }, model: { type: 'string' }, voice: { type: 'string' } }, required: ['type', 'filename'] } },
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
  { name: 'spawn_subagent', description: 'Spawn a specialist subagent that works in parallel on an independent piece of the task. Use whenever the work splits into 2-3+ independent chunks (one writes UI while another writes tests, or several modules can be built simultaneously). Announce the spawn to the user. Results return to you to integrate.', input_schema: { type: 'object', properties: { role: { type: 'string', description: 'Specialist role, e.g. "UI-designer", "test-writer", "researcher".' }, task: { type: 'string', description: 'Complete, self-contained task description for this specialist.' } }, required: ['role', 'task'] } },
  { name: 'create_artifact', description: 'Create a named, trackable artifact visible in the Artifacts panel: implementation plans, design docs, task breakdowns, verification reports, or work summaries. Prefer this over plain files when the user should see structured progress.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Short artifact name, e.g. "Auth implementation plan".' }, type: { type: 'string', enum: ['plan', 'implementation', 'design', 'asset', 'verification', 'doc'], description: 'Artifact kind.' }, content: { type: 'string', description: 'Markdown content of the artifact.' }, status: { type: 'string', enum: ['draft', 'in_progress', 'done'], description: 'Current status (default draft).' } }, required: ['name', 'content'] } },
  { name: 'update_artifact', description: 'Update an existing artifact by name: replace content and/or move its status forward (draft -> in_progress -> done). Keep artifacts current as work completes.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Artifact name (or id).' }, content: { type: 'string', description: 'New markdown content (omit to keep current).' }, status: { type: 'string', enum: ['draft', 'in_progress', 'done'], description: 'New status (omit to keep current).' } }, required: ['name'] } },
  { name: 'create_implementation_plan', description: 'Create or update implementation_plan.md in workspace to structure architectural decisions and milestones.', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
  { name: 'update_task_progress', description: 'Update task_progress.md in workspace to track completed steps, ongoing work, and remaining roadmap.', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
  { name: 'create_walkthrough', description: 'Create walkthrough.md in workspace summarizing all accomplishments, verification results, and usage.', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },

  // 9. Human Interaction & Clarification (1 Tool)
  { name: 'ask_user', description: 'Ask the user a clarifying question mid-task and wait for their answer. Use when the request is ambiguous or required inputs are missing (paths, scope, design or asset requirements, credentials). Provide 2-4 short answer options when possible.', input_schema: { type: 'object', properties: { question: { type: 'string', description: 'The focused question to ask the user.' }, options: { type: 'array', description: 'Optional short answer choices (2 to 4 items).', items: { type: 'string' }, minItems: 2, maxItems: 4 }, allow_free_text: { type: 'boolean', description: 'Whether the user may also type a free-form answer (default true).' } }, required: ['question'] } },
] as const;

const openAITools = SUTRA_TOOLS.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));

/**
 * Dynamic Tool Search & Pruning
 * Prunes the 45+ tool schemas down to only relevant tools based on query intent & model constraints.
 */
export function getPrunedToolsForModel(modelId: string, messages: any[], systemPrompt?: string): any[] {
  // Custom / discovered ids may be arbitrary strings — coerce defensively so unknown
  // or malformed ids never crash tool pruning.
  const safeModelId = typeof modelId === 'string' ? modelId : '';
  const isTightTpm = safeModelId.includes('gpt-oss-20b') || safeModelId.includes('llama-3.1-8b') || safeModelId.includes('groq');
  if (!isTightTpm && messages.length < 6) {
    return openAITools;
  }

  const queryContext = (messages.map((m: any) => (typeof m.content === 'string' ? m.content : '')).join(' ') + ' ' + (systemPrompt || '')).toLowerCase();
  const selectedToolNames = new Set([
    'read_file',
    'write_file',
    'edit_file',
    'run_command',
    'grep_search',
    'list_directory',
    'typecheck_project',
    'ask_user',
  ]);

  if (queryContext.includes('git') || queryContext.includes('commit') || queryContext.includes('branch') || queryContext.includes('diff') || queryContext.includes('stash')) {
    selectedToolNames.add('git_status');
    selectedToolNames.add('git_diff');
    selectedToolNames.add('git_commit');
    selectedToolNames.add('git_branch');
    selectedToolNames.add('git_log');
  }
  if (queryContext.includes('image') || queryContext.includes('video') || queryContext.includes('audio') || queryContext.includes('media') || queryContext.includes('svg')) {
    selectedToolNames.add('generate_image_asset');
    selectedToolNames.add('generate_video_asset');
    selectedToolNames.add('generate_audio_asset');
    selectedToolNames.add('generate_svg_asset');
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
    maxToolOutputChars: 4000,
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
    maxToolOutputChars: 300,
  },
  'llama-3.1-8b-instant': {
    maxContextTokens: 128000,
    safeTpmTokens: 24000,
    maxToolSchemaTokens: 1500,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 1200,
  },
  'qwen/qwen3.6-27b': {
    maxContextTokens: 131072,
    safeTpmTokens: 20000,
    maxToolSchemaTokens: 2000,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 300,
  },
  'mistral-saba-24b': {
    maxContextTokens: 32768,
    safeTpmTokens: 5500,
    maxToolSchemaTokens: 450,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 300,
  },
  'deepseek-r1-distill-llama-70b': {
    maxContextTokens: 128000,
    safeTpmTokens: 5500,
    maxToolSchemaTokens: 450,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 300,
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
    maxToolOutputChars: 6000,
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
    maxToolOutputChars: 4000,
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
    maxToolOutputChars: 4000,
  },
  'o3-mini': {
    maxContextTokens: 128000,
    safeTpmTokens: 90000,
    maxToolSchemaTokens: 3500,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 6000,
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

  // Anthropic
  'claude-3-7-sonnet': {
    maxContextTokens: 200000,
    safeTpmTokens: 35000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 6000,
  },
  'claude-3-5-sonnet': {
    maxContextTokens: 200000,
    safeTpmTokens: 35000,
    maxToolSchemaTokens: 4000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 6000,
  },
  'claude-3-5-haiku': {
    maxContextTokens: 200000,
    safeTpmTokens: 45000,
    maxToolSchemaTokens: 3000,
    maxSingleTurnTokens: 4096,
    maxToolOutputChars: 4000,
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
    maxToolOutputChars: 6000,
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
    maxToolOutputChars: 6000,
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
    maxToolOutputChars: 3000,
  },
  'deepseek-coder': {
    maxContextTokens: 32768,
    safeTpmTokens: 32000,
    maxToolSchemaTokens: 2000,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 3000,
  },
  'llama3.2': {
    maxContextTokens: 16384,
    safeTpmTokens: 16000,
    maxToolSchemaTokens: 1500,
    maxSingleTurnTokens: 2048,
    maxToolOutputChars: 2000,
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
        baseProfile = { maxContextTokens: 131072, safeTpmTokens: 24000, maxToolSchemaTokens: 2000, maxSingleTurnTokens: 8192, maxToolOutputChars: 6000 };
      } else if (provider === 'google') {
        baseProfile = { maxContextTokens: 1048576, safeTpmTokens: 800000, maxToolSchemaTokens: 6000, maxSingleTurnTokens: 8192, maxToolOutputChars: 32000 };
      } else if (provider === 'openai') {
        baseProfile = { maxContextTokens: 128000, safeTpmTokens: 30000, maxToolSchemaTokens: 3000, maxSingleTurnTokens: 4096, maxToolOutputChars: 5000 };
      } else if (provider === 'anthropic') {
        baseProfile = { maxContextTokens: 200000, safeTpmTokens: 35000, maxToolSchemaTokens: 3500, maxSingleTurnTokens: 4096, maxToolOutputChars: 5000 };
      } else if (provider === 'deepseek') {
        baseProfile = { maxContextTokens: 64000, safeTpmTokens: 50000, maxToolSchemaTokens: 3000, maxSingleTurnTokens: 4096, maxToolOutputChars: 5000 };
      } else {
        baseProfile = { maxContextTokens: 32768, safeTpmTokens: 20000, maxToolSchemaTokens: 2000, maxSingleTurnTokens: 2048, maxToolOutputChars: 3000 };
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

  // Level 2: Keep first turn + last 4 turns, shrink middle turns aggressively
  const initial = compactedMessages.slice(0, 2);
  const recent = compactedMessages.slice(-4);
  const middle = compactedMessages.slice(2, -4).map((m: any) => {
    if (m.role === 'tool' && typeof m.content === 'string') {
      return { ...m, content: `${m.content.slice(0, 120)}...\n[Compacted tool output]` };
    }
    if (m.role === 'assistant' && typeof m.content === 'string') {
      return { ...m, content: `${m.content.slice(0, 150)}...\n[Compacted assistant step]` };
    }
    return m;
  });

  compactedMessages = [...initial, ...middle, ...recent];

  // Level 3: Semantic Turn Collapse for long-running missions (10+ turns)
  // Collapses dozens of intermediate turns into a single high-density summary so the agent can run 100+ turns flawlessly
  if (compactedMessages.length > 8) {
    const firstUser = compactedMessages.slice(0, 1);
    const recentTurns = compactedMessages.slice(-4);
    const middleSpan = compactedMessages.slice(1, -4);

    const executedToolNames: string[] = [];
    for (const m of middleSpan) {
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          const fn = tc.function?.name || tc.tool;
          if (fn) executedToolNames.push(fn);
        }
      }
    }

    const collapsedSummary = {
      role: 'user',
      content: `[Astra Executive History Summary: ${middleSpan.length} intermediate execution turns completed successfully (${executedToolNames.slice(-12).join(', ')}). All created/modified files are active in workspace. Continue with next phase.]`,
    };

    compactedMessages = [...firstUser, collapsedSummary, ...recentTurns];
  }

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
  const KNOWN_GLUED_TOOLS = 'generate_image_asset|generate_video_asset|generate_audio_asset|read_file|write_file|edit_file|delete_file|list_directory|grep_search|run_command|scrape_url|search_web';
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
    } else {
      return;
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

  // Deduplicate tools by name and params signature
  const seenSignatures = new Set<string>();
  const uniqueTools = extractedTools.filter((t) => {
    const sig = `${t.tool}:${JSON.stringify(t.params)}`;
    if (seenSignatures.has(sig)) return false;
    seenSignatures.add(sig);
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
    .replace(/```json\s*\{[\s\S]*?"(?:name|tool)"\s*:[\s\S]*?\}\s*```/gi, '')
    .trim();

  return { cleanText, extractedTools: uniqueTools };
}

export const BUILTIN_MODELS: ModelDefinition[] = [
  // SUTRA Multi-Tier Auto-Chain
  {
    id: 'auto',
    name: 'Astra Auto-Chain (Gemini → Claude → GPT → ChatGPT Web → Groq → DeepSeek → GLM → Grok → Ollama)',
    provider: 'google',
    contextWindow: 1000000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Autonomous fallback chain: routes to the best available working model with zero latency.',
  },

  // Google Gemini Frontier Models (August 2026)
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro (Google Flagship)',
    provider: 'google',
    contextWindow: 1000000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00125, output: 0.01 },
    description: 'Frontier multimodal reasoning with a 1M token context window and native tool use.',
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash (Reasoning — Medium Effort)',
    provider: 'google',
    contextWindow: 1000000,
    reasoningEffort: 'medium',
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    description: 'Fast adaptive-reasoning flash generation with tunable effort levels and vision.',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro (Google)',
    provider: 'google',
    contextWindow: 1000000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00125, output: 0.01 },
    description: 'Proven long-context multimodal workhorse for deep analysis and coding.',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Google Fast Tier)',
    provider: 'google',
    contextWindow: 1000000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    description: 'High-speed multimodal default with excellent price-performance for agents.',
  },

  // Anthropic Claude 5 Family
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5 (Anthropic Flagship)',
    provider: 'anthropic',
    contextWindow: 200000,
    reasoningEffort: 'high',
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.005, output: 0.025 },
    description: 'Deepest reasoning capacity for autonomous multi-hour agentic engineering missions.',
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5 (Anthropic)',
    provider: 'anthropic',
    contextWindow: 200000,
    reasoningEffort: 'high',
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    description: 'Best-in-class tool calling, full-repo surgical edits, and agentic coding balance.',
  },
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5 (Anthropic Creative)',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.002, output: 0.01 },
    description: 'Narrative-grade long-form generation tuned for creative and design-heavy flows.',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5 (Anthropic Fast)',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.001, output: 0.005 },
    description: 'Near-instant responses with vision and tools at a fraction of flagship cost.',
  },

  // OpenAI Frontier Models (August 2026)
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1 (OpenAI Flagship)',
    provider: 'openai',
    contextWindow: 400000,
    reasoningEffort: 'high',
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00125, output: 0.01 },
    description: 'OpenAI frontier flagship for architecture planning, UI design, and deep coding.',
  },
  {
    id: 'gpt-5',
    name: 'GPT-5 (OpenAI)',
    provider: 'openai',
    contextWindow: 400000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00125, output: 0.01 },
    description: 'Reliable frontier generalist with a 400K token input window and native tools.',
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 mini (OpenAI Balanced)',
    provider: 'openai',
    contextWindow: 400000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00025, output: 0.002 },
    description: 'Cost-efficient frontier quality for high-volume agentic execution loops.',
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 nano (OpenAI Ultra-Fast)',
    provider: 'openai',
    contextWindow: 400000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00005, output: 0.0004 },
    description: 'Latency-optimized micro model for real-time file operations and classification.',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini (OpenAI Reasoning)',
    provider: 'openai',
    contextWindow: 200000,
    reasoningEffort: 'high',
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.0011, output: 0.0044 },
    description: 'Compact chain-of-thought engine for math, algorithms, and rigorous verification.',
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1 (OpenAI Legacy 1M Context)',
    provider: 'openai',
    contextWindow: 1000000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.002, output: 0.008 },
    description: 'Legacy million-token context model still ideal for giant repo-wide sweeps.',
  },

  // ChatGPT Web Session Models (Free via browser cookie)
  {
    id: 'luna',
    name: 'Luna (ChatGPT Web — Free, incl. image generation)',
    provider: toProviderId('chatgpt-web'),
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Free ChatGPT web session model with image generation — no API key required.',
  },
  {
    id: 'gpt-5',
    name: 'GPT-5 (ChatGPT Web Session — Free)',
    provider: toProviderId('chatgpt-web'),
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'GPT-5 served through your logged-in ChatGPT web browser session cookie.',
  },

  // Groq LPUs (High Speed 500+ tok/s)
  {
    id: 'openai/gpt-oss-120b',
    name: 'Groq GPT-OSS 120B Flagship (500+ tok/s)',
    provider: 'groq',
    contextWindow: 131072,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.00059, output: 0.00079 },
    description: 'State-of-the-art open reasoning & coding model running on Groq LPUs.',
  },
  {
    id: 'qwen/qwen3.6-27b',
    name: 'Groq Qwen 3.6 27B (Vision & Tools)',
    provider: 'groq',
    contextWindow: 131072,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.00049, output: 0.00069 },
    description: 'Multimodal vision, function calling, and deep coding on Groq LPUs.',
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'Groq GPT-OSS 20B High-Speed',
    provider: 'groq',
    contextWindow: 131072,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.00029, output: 0.00049 },
    description: 'Ultra low latency 800+ tok/s model for real-time file operations.',
  },
  {
    id: 'groq/compound',
    name: 'Groq Compound System',
    provider: 'groq',
    contextWindow: 131072,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.00059, output: 0.00079 },
    description: 'Groq multi-agent compound reasoning system.',
  },

  // DeepSeek Stable Aliases (always latest V3.x / R-series, 128K context)
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3.2 (deepseek-chat)',
    provider: 'deepseek',
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.00028, output: 0.00042 },
    description: 'Stable alias that always points to the latest DeepSeek V3.x coding flagship.',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1 (deepseek-reasoner)',
    provider: 'deepseek',
    contextWindow: 128000,
    reasoningEffort: 'high',
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.00055, output: 0.00219 },
    description: 'Stable alias for the latest chain-of-thought R-series reasoning model.',
  },

  // Zhipu GLM (OpenAI-compatible z.ai endpoint)
  {
    id: 'glm-4.6',
    name: 'GLM-4.6 (Zhipu Flagship Coding)',
    provider: toProviderId('zhipu'),
    contextWindow: 200000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.0006, output: 0.0022 },
    description: 'Zhipu flagship with 200K context and elite agentic coding/tool-calling scores.',
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5 Air (Zhipu Light)',
    provider: toProviderId('zhipu'),
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.0002, output: 0.0011 },
    description: 'Lightweight fast GLM variant for high-volume tool loops on a budget.',
  },

  // xAI Grok
  {
    id: 'grok-4',
    name: 'Grok 4 (xAI Flagship)',
    provider: toProviderId('xai'),
    contextWindow: 256000,
    reasoningEffort: 'high',
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    description: 'xAI frontier reasoning model with vision and a 256K context window.',
  },
  {
    id: 'grok-code-fast-1',
    name: 'Grok Code Fast 1 (xAI Agentic Coding)',
    provider: toProviderId('xai'),
    contextWindow: 256000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.0002, output: 0.0015 },
    description: 'Blazing fast agentic coding specialist purpose-built for IDE tool loops.',
  },

  // Alibaba Qwen (DashScope International)
  {
    id: 'qwen3-coder-plus',
    name: 'Qwen3 Coder Plus (Alibaba)',
    provider: toProviderId('qwen'),
    contextWindow: 1000000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0.0003, output: 0.0012 },
    description: 'Alibaba agentic coding flagship with up to 1M tokens of repository context.',
  },
  {
    id: 'qwen3-max',
    name: 'Qwen3 Max (Alibaba Flagship)',
    provider: toProviderId('qwen'),
    contextWindow: 262144,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.0016, output: 0.0064 },
    description: 'Qwen3 max-capability tier for complex multilingual reasoning and vision.',
  },

  // Antigravity IDE Bridge (routes through local Antigravity gateway when Base URL configured)
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash (Antigravity Bridge)',
    provider: toProviderId('antigravity'),
    contextWindow: 1000000,
    reasoningEffort: 'medium',
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Gemini 3.7 Flash via your authenticated Antigravity / Antigravity IDE bridge.',
  },

  // OpenRouter Unified Gateway
  {
    id: 'openrouter/auto',
    name: 'OpenRouter (300+ Frontier Models)',
    provider: 'openrouter',
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0.001, output: 0.002 },
    description: 'Unified gateway routing to Claude, GPT-5, Gemini 3, Grok, Llama, Qwen, GLM.',
  },

  // Local Ollama Models
  {
    id: 'qwen2.5-coder',
    name: 'Qwen 2.5 Coder (Local Ollama)',
    provider: 'ollama',
    contextWindow: 32000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: '100% private, offline coding model running locally on your machine.',
  },

  // NVIDIA NIM (free build.nvidia.com tier — explicit selection only, not in the auto-failover chain)
  {
    id: 'meta/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct (NVIDIA NIM — Free Tier)',
    provider: toProviderId('nvidia-nim'),
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Meta Llama 3.3 70B served free on NVIDIA NIM with native tool calling.',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    name: 'Llama 3.1 Nemotron 70B Instruct (NVIDIA NIM — Free Tier)',
    provider: toProviderId('nvidia-nim'),
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'NVIDIA Nemotron-tuned Llama 3.1 70B aligned for helpfulness on the free NIM tier.',
  },
  {
    id: 'deepseek-ai/deepseek-r1',
    name: 'DeepSeek R1 (NVIDIA NIM — Free Tier)',
    provider: toProviderId('nvidia-nim'),
    contextWindow: 128000,
    reasoningEffort: 'high',
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Open chain-of-thought reasoning flagship hosted free on NVIDIA NIM.',
  },
  {
    id: 'qwen/qwen2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B Instruct (NVIDIA NIM — Free Tier)',
    provider: toProviderId('nvidia-nim'),
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Qwen code-specialist 32B for repository edits and generation on NIM.',
  },
  {
    id: 'mistralai/mixtral-8x22b-instruct-v0.1',
    name: 'Mixtral 8x22B Instruct v0.1 (NVIDIA NIM — Free Tier)',
    provider: toProviderId('nvidia-nim'),
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Mixture-of-experts Mixtral 8x22B general instruct model on NIM.',
  },
  {
    id: 'openai',
    name: 'Pollinations Free (no key needed)',
    provider: 'pollinations',
    contextWindow: 32000,
    supportsVision: false,
    supportsTools: false,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'Community free tier — always available even with zero keys configured.',
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
      const { done, value } = await reader.read();
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
  const choice = evt?.choices?.[0];
  if (!choice) return empty;
  const delta = choice.delta || {};
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
    const entry = this.calls.get(fragment.index) || { id: '', name: '', args: '' };
    if (fragment.id) entry.id = fragment.id;
    if (fragment.name && !entry.name.includes(fragment.name)) entry.name += fragment.name;
    if (fragment.argumentsFragment) entry.args += fragment.argumentsFragment;
    this.calls.set(fragment.index, entry);
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
        tool_use_id: typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '',
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

export class ModelRouter {
  private customProviders: Map<string, CustomProviderConfig> = new Map();
  private activeModelId: string = 'auto';
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
    if (process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY) this.apiKeys.github = (process.env.GITHUB_TOKEN || process.env.GITHUB_API_KEY)!;

    // 2. Synchronously load all saved keys from SQLite database
    try {
      const rows = db.prepare('SELECT id, api_key FROM providers WHERE api_key IS NOT NULL').all() as any[];
      for (const row of rows) {
        if (row.api_key && row.api_key.trim().length > 0) {
          this.apiKeys[row.id] = row.api_key.trim();
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

  public getApiKey(provider: string): string | undefined {
    if (this.apiKeys[provider] && this.apiKeys[provider].trim().length > 0) {
      return this.apiKeys[provider];
    }
    try {
      const row = db.prepare('SELECT api_key FROM providers WHERE id = ?').get(provider) as any;
      if (row?.api_key && row.api_key.trim().length > 0) {
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
      const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(provider) as any;
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

  public hasCredential(provider: string): boolean {
    if (provider === 'pollinations') return true; // Free tier needs no credential
    const cred = this.getCredential(provider);
    return Boolean((cred.apiKey && cred.apiKey.trim().length > 0) || (cred.cookieData && cred.cookieData.trim().length > 0));
  }

  public isProviderAvailable(provider: string): boolean {
    if (provider === 'ollama') return this.ollamaAvailable;
    if (provider === 'pollinations') return true; // Free tier — no credential, always routable
    return this.hasCredential(provider);
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
        case 'antigravity': // Antigravity IDE bridge (Gemini 3.7 Flash via authenticated gateway)
        case 'antigravity-ide':
          score += 89;
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
      if (requestedModel.id !== 'auto' && requestedModel.provider === provider) {
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
    if (this.hasCredential('groq')) visionCandidates.push({ provider: 'groq', modelId: 'qwen/qwen3.6-27b' });
    if (this.hasCredential('google')) visionCandidates.push({ provider: 'google', modelId: 'gemini-3.7-flash' });
    if (this.hasCredential('openai')) visionCandidates.push({ provider: 'openai', modelId: 'gpt-5' });
    if (this.hasCredential('anthropic')) visionCandidates.push({ provider: 'anthropic', modelId: 'claude-sonnet-5' });

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
        if (parsedImage) parts.push({ inline_data: { mime_type: parsedImage.mimeType, data: parsedImage.data } });
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
        max_tokens: 4096,
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
      const res = await fetch(`${completionsUrl}`, {
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
      const res = await fetch(`${completionsUrl}`, {
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
    return Object.fromEntries(
      Object.entries(this.apiKeys).map(([k, v]) => [k, Boolean(v && v.trim().length > 0)])
    );
  }

  public getAllApiKeysRaw(): Record<string, string> {
    return { ...this.apiKeys };
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
        contextWindow: Number(entry.config?.contextWindow) || 128000,
        supportsVision: Boolean(entry.config?.supportsVision),
        supportsTools: entry.config?.supportsTools !== false,
        costPer1kTokens: { input: 0, output: 0 },
        description: entry.description || 'Custom model added in Settings.',
      }));
    } catch {
      return [];
    }
  }

  public getAllModels(): ModelDefinition[] {
    const liveFilter = (m: any): boolean => {
      if ((m.provider as string) === 'chatgpt-web') {
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
   * Resolves a requested model id to its definition: exact match first, then a
   * suffix match so short ids like "sonnet-5" or "luna" reach namespaced entries.
   */
  public resolveModelDefinition(modelId: string): ModelDefinition | null {
    if (!modelId || typeof modelId !== 'string') return null;
    const all = this.getAllModels();
    return (
      all.find((m) => m.id === modelId) ||
      all.find((m) => m.id.split('/').pop() === modelId || m.id.endsWith(`/${modelId}`)) ||
      null
    );
  }

  /**
   * Dynamic Remote Model Discovery (never throws, cached for 10 minutes, safe to fire-and-forget):
   * 1. OpenRouter public catalog (no auth required) — 300+ frontier models.
   * 2. ChatGPT Web session models via chatgptWebProvider.listModels when a cookie is configured
   *    (falls back to ['luna', 'gpt-5'] when the method is unavailable or returns null).
   * 3. Zhipu/GLM hosted catalog when an API key is configured.
   * Discovered models are merged into getAllModels() with the correct provider set,
   * while built-in and user-custom entries always keep priority on id collisions.
   */
  public async refreshRemoteModels(): Promise<{ added: number }> {
    if (this.remoteModelsInFlight) {
      return this.remoteModelsInFlight;
    }
    if (Date.now() - this.remoteModelsFetchedAt < 10 * 60 * 1000) {
      return { added: 0 };
    }

    this.remoteModelsInFlight = (async (): Promise<{ added: number }> => {
      const discovered: ModelDefinition[] = [];

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
          const modelIds =
            webModelIds && webModelIds.length > 0 ? webModelIds : CHATGPT_WEB_FALLBACK_MODEL_IDS;
          for (const mid of modelIds) {
            discovered.push({
              id: String(mid),
              name: String(mid) === 'luna' ? 'Luna (ChatGPT Web — Free, incl. image generation)' : `ChatGPT Web: ${mid}`,
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
                  contextWindow: /2\.5|3\./.test(id) ? 1000000 : 32000,
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
        // Catalog probe is optional — GLM models are simply not listed on failure
      }

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

  public getActiveModel(): ModelDefinition {
    const model = this.getAllModels().find((m) => m.id === this.activeModelId);
    return model || BUILTIN_MODELS[0];
  }

  public setActiveModel(modelId: string): boolean {
    // Exact id first, then suffix match (custom / namespaced ids stay reachable by short name).
    const resolved = this.resolveModelDefinition(modelId);
    if (resolved) {
      this.activeModelId = resolved.id;
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
        default:
          // Any other OpenAI-compatible provider with a known or configured Base URL
          if (PROVIDER_BASE_URLS[providerId] || this.getCredential(providerId).baseUrl) {
            const base = (this.getCredential(providerId).baseUrl || PROVIDER_BASE_URLS[providerId]).replace(/\/$/, '');
            testUrl = `${base}/models`;
            headers['Authorization'] = `Bearer ${key}`;
            break;
          }
          return { ok: false, latencyMs: 0, error: `No verification endpoint configured for provider "${providerId}".` };
      }

      const res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(6000) });
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
   * Scans for local AI runtimes (Ollama, LM Studio, vLLM) and auto-registers active models
   */
  public async scanLocalProviders(): Promise<{
    ollama: { active: boolean; models: string[] };
    lmstudio: { active: boolean; models: string[] };
  }> {
    const results = {
      ollama: { active: false, models: [] as string[] },
      lmstudio: { active: false, models: [] as string[] },
    };

    // 1. Scan Ollama
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
            contextWindow: 64000,
            supportsVision: mName.toLowerCase().includes('vision') || mName.toLowerCase().includes('llava'),
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `Local offline model running on Ollama (${mName}).`,
          };
          this.addCustomModel(modelDef);
        }
      }
    } catch {
      // Runtime not running or unreachable — reported as inactive in results
    }

    // 2. Scan LM Studio
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
            provider: 'custom',
            contextWindow: 64000,
            supportsVision: false,
            supportsTools: true,
            costPer1kTokens: { input: 0, output: 0 },
            description: `Local OpenAI-compatible model running on LM Studio (${mName}).`,
          };
          this.addCustomModel(modelDef);
        }
      }
    } catch {
      // Runtime not running or unreachable — reported as inactive in results
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
    temperature?: number;
    tools?: any[];
    signal?: AbortSignal;
    priorityIds?: string[];
    autoCompact?: boolean;
    autoCompactThreshold?: number;
  }): AsyncGenerator<{ delta?: string; thinking?: string; toolCalls?: any[]; done?: boolean; resetContent?: boolean; retryEvent?: { attempt: number; totalAttempts: number; provider: string; model: string; status: string; latencyMs: number; reason: string } }> {
    if (params.signal?.aborted) return;

    // Exact id first, then suffix match (custom / namespaced ids stay reachable by short name).
    const targetModelId = params.modelId || this.activeModelId;
    const requestedModel = this.resolveModelDefinition(targetModelId) || BUILTIN_MODELS[0];

    if (targetModelId !== 'auto' && !this.resolveModelDefinition(targetModelId)) {
      yield { thinking: `Model "${targetModelId}" is not available — using automatic routing instead.` };
    }

    // Reload keys dynamically from SQLite on every turn
    try {
      const rows = db.prepare('SELECT id, api_key FROM providers WHERE api_key IS NOT NULL').all() as any[];
      for (const row of rows) {
        if (row.api_key && row.api_key.trim().length > 0) {
          this.apiKeys[row.id] = row.api_key.trim();
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
    // Up to 8 real attempts per user prompt across the available chain.
    // Retryable failures (429/5xx/timeouts/network/empty): exponential backoff to the SAME
    // model, then failover. Hard failures (401/403/404/model-not-found): immediate failover.
    const MAX_TOTAL_ATTEMPTS = 8;
    const RETRY_BACKOFF_START_MS = 1000;
    const RETRY_BACKOFF_CAP_MS = 15000;
    let totalAttempts = 0;
    let retryBackoffMs = RETRY_BACKOFF_START_MS;
    const attemptErrors: Array<{ provider: string; error: string }> = [];
    let failedPreviousRoute = '';

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    /** Hard failures switch models immediately; everything else is worth a backoff retry. */
    const isHardFailure = (err: any): boolean => {
      if (err && typeof err.retryable === 'boolean') return !err.retryable; // ProviderError contract
      const message = String(err?.message || err || '');
      if (/401|403|unauthorized|forbidden|invalid\s*(api\s*)?key|incorrect\s*(api\s*)?key/i.test(message)) return true;
      if (/404|model_not_found|decommissioned|does not exist|is not available on|unknown model|no endpoints found/i.test(message)) return true;
      return false;
    };

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

    // 1. Check if user explicitly selected a specific model vs SUTRA Auto Fallback mode
    const isSpecificModelChosen = requestedModel.id !== 'auto' && requestedModel.provider !== 'sutra';
    // Available-only: the queue holds credential-backed providers (plus detected-local Ollama) —
    // unconfigured providers are never enqueued and their failures are never surfaced.
    const requestedProviderAvailable = isSpecificModelChosen && this.isProviderAvailable(String(requestedModel.provider));
    if (isSpecificModelChosen && !requestedProviderAvailable) {
      yield { thinking: `"${requestedModel.name}" needs a connected ${providerDisplayName(String(requestedModel.provider))} account — add its key or cookie in Settings.` };
    }
    const providersToTry = isSpecificModelChosen
      ? (requestedProviderAvailable ? [String(requestedModel.provider)] : [])
      : this.rankProvidersDynamically(requestedModel, Boolean(handoff.hasImage));

    // ---- Context usage snapshot + auto-compact ------------------------------
    // Token counts are estimated at chars/4 when providers do not report usage.
    const estTokens = (value: unknown): number => Math.ceil(JSON.stringify(value ?? '').length / 4);
    const contextWindow = Number(requestedModel.contextWindow) || 128000;
    const contextUsed = estTokens(augmentedMessages) + estTokens(params.systemPrompt || '');
    this.lastRunUsage = { contextUsed, contextWindow, contextRemaining: Math.max(0, contextWindow - contextUsed), outputTokens: 0 };

    const compactThresholdPct = typeof params.autoCompactThreshold === 'number' ? params.autoCompactThreshold : 80;
    if (params.autoCompact !== false && contextUsed > contextWindow * (compactThresholdPct / 100) && augmentedMessages.length > 8) {
      const keepCount = Math.ceil(augmentedMessages.length / 2);
      const removedCount = augmentedMessages.length - keepCount;
      augmentedMessages.splice(0, removedCount, {
        role: 'user',
        content: `[Context compacted: ${removedCount} earlier messages were summarized to stay within the model's context window. All file changes are saved in the workspace.]`,
      } as any);
      this.lastRunUsage.contextUsed = estTokens(augmentedMessages) + estTokens(params.systemPrompt || '');
      this.lastRunUsage.contextRemaining = Math.max(0, contextWindow - this.lastRunUsage.contextUsed);
      yield { thinking: 'Compacting context to stay within the model window…' };
    }

    // User-configured model priority (Settings > Routing drag order) is honored first.
    const priorityIds: string[] = Array.isArray(params.priorityIds)
      ? params.priorityIds.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
      : [];
    if (priorityIds.length > 0 && !isSpecificModelChosen) {
      const rank = new Map<string, number>(priorityIds.map((id, i) => [id, i]));
      providersToTry.sort((a, b) => (rank.has(a) ? rank.get(a)! : 999) - (rank.has(b) ? rank.get(b)! : 999));
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
      const key = cred.apiKey;
      const cookie = cred.cookieData;

      // Skip if no key, no cookie, and not a credential-free provider (local runtimes, free tiers)
      if (!key && !cookie && !(provider === 'ollama' && this.ollamaAvailable) && provider !== 'pollinations') {
        continue;
      }

      let currentModel = provider === requestedModel.provider ? requestedModel : this.getAllModels().find(m => m.provider === provider);
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

      const providerModelId = resolveModelId(provider, currentModel.id);

      // Bridge providers that REQUIRE an explicit Base URL (no public default endpoint).
      if ((provider === 'antigravity' || provider === 'antigravity-ide') && !cred.baseUrl) {
        continue; // No Antigravity bridge configured — fall through the chain (e.g. to Google)
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
      const timeout = setTimeout(() => controller.abort(), 120000);
      const relayExternalAbort = () => controller.abort();
      if (params.signal?.aborted) controller.abort();
      else if (params.signal) params.signal.addEventListener('abort', relayExternalAbort, { once: true });

      try {

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
          // Claude 5 family routing: opus → flagship, haiku → fast, fable → creative, else sonnet default
          const anthropicModelId = providerModelId.includes('opus')
            ? 'claude-opus-5'
            : providerModelId.includes('haiku')
            ? 'claude-haiku-4-5-20251001'
            : providerModelId.includes('fable')
            ? 'claude-fable-5'
            : 'claude-sonnet-5';
          const buildAnthropicBody = (streaming: boolean): Record<string, any> => {
            const body: Record<string, any> = {
              model: anthropicModelId,
              max_tokens: 4096,
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
            res = await fetch(anthropicUrl, {
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
            try {
              res = await fetch(anthropicUrl, {
                method: 'POST',
                headers: anthropicHeaders,
                body: JSON.stringify(buildAnthropicBody(false)),
                signal: controller.signal,
              });
              responseIsStreaming = false;
            } catch {
              throw new Error('Could not reach the Claude endpoint');
            }
            if (!res || !res.ok) throw new Error(`HTTP ${res?.status || 0}`);
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

            const res = await fetch(cred.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
              method: 'POST',
              headers: geminiHeaders,
              body: JSON.stringify({
                model: providerModelId.includes('gemini') ? providerModelId : 'gemini-2.5-flash',
                messages: [{ role: 'system', content: params.systemPrompt || '' }, ...augmentedMessages],
                temperature: params.temperature ?? 0.7,
                tools: currentModel.supportsTools ? openAITools : undefined,
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
                    if (parsedImage) parts.push({ inline_data: { mime_type: parsedImage.mimeType, data: parsedImage.data } });
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
                parts.push({ inline_data: { mime_type: imageMatch[1], data: imageMatch[2] } });
                cursor = imageMatch.index + imageMatch[0].length;
              }
              if (cursor < rawText.length) parts.push({ text: rawText.slice(cursor) });
              return parts.length > 0 ? parts : [{ text: '' }];
            };

            const contents = augmentedMessages.map((m: any) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: toGeminiParts(m),
            }));

            const requestBody = JSON.stringify({
              contents,
              systemInstruction: params.systemPrompt ? { parts: [{ text: params.systemPrompt }] } : undefined,
              generationConfig: { temperature: params.temperature ?? 0.7 },
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
              const nativeRes = await fetch(sseUrl, {
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
            const nativeRes = await fetch(bufferedUrl, {
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
              finishUsage(text);
              yield { done: true };
              return;
            }
          } catch {
            if (params.signal?.aborted) return;
            // Fall through to next provider in fallback chain
          }
        }

        // 3.5. ChatGPT Web Session Cookie Engine (Direct browser session execution)
        if ((provider === 'openai' || provider === 'chatgpt-web') && cookie && !key) {
          try {
            let streamedAny = false;
            for await (const webChunk of chatgptWebProvider.streamConversation({
              cookieString: cookie,
              messages: augmentedMessages,
              systemPrompt: params.systemPrompt,
              model: providerModelId,
              signal: controller.signal,
            })) {
              if (params.signal?.aborted) return;
              if (webChunk.delta) {
                streamedAny = true;
                yield { delta: webChunk.delta };
              }
              if (webChunk.done) {
                if (streamedAny) {
                  yield { done: true };
                  return;
                }
              }
            }
            if (streamedAny) {
              yield { done: true };
              return;
            }
          } catch (webErr: any) {
            console.warn(`[ModelRouter] ChatGPT Web session cookie attempt: ${webErr.message}. Seamlessly continuing with resilient fallback chain.`);
          }
        }

        // 4. Generic OpenAI-compatible path (OpenAI / DeepSeek / OpenRouter / Groq / GitHub / Ollama /
        //    Zhipu GLM / xAI / Qwen / Cerebras / Moonshot / Together / Fireworks / SambaNova / ... 100+)
        //    True SSE streaming with ONE buffered fallback per attempt.
        if (key || cookie || provider === 'ollama' || provider === 'pollinations') {
          // Resolution order: explicit Base URL -> known provider default -> graceful skip.
          // NEVER falls back to api.openai.com for non-OpenAI providers (prevents cross-provider key leakage).
          const baseUrl = cred.baseUrl || PROVIDER_BASE_URLS[provider] || '';
          const completionsUrl = provider === 'pollinations' ? `${baseUrl}/openai` : `${baseUrl}/chat/completions`;
          if (!baseUrl) {
            if (!this.unroutedProvidersWarned.has(provider)) {
              this.unroutedProvidersWarned.add(provider);
              console.warn(`[ModelRouter] Provider "${provider}" has no Base URL configured and no known default endpoint — skipping to next fallback in chain.`);
            }
            continue;
          }

          const candidateModels = provider === 'groq'
            ? Array.from(new Set([providerModelId, 'openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'groq/compound', 'openai/gpt-oss-20b'])).filter(
                (m) => !['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'qwen-2.5-32b', 'qwen-2.5-coder-32b', 'deepseek-r1-distill-llama-70b', 'mixtral-8x7b-32768'].includes(m)
              )
            : [providerModelId];

          const reqHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...cred.headers,
          };
          if (key) {
            reqHeaders['Authorization'] = `Bearer ${key}`;
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

              const buildChatBody = (messagesPayload: any[], systemContent: string, toolsPayload: any[], streaming: boolean): Record<string, any> => {
                const body: Record<string, any> = {
                  model: candModel,
                  messages: [{ role: 'system', content: systemContent }, ...messagesPayload],
                  temperature: params.temperature ?? 0.7,
                };
                if (currentModel.supportsTools && toolsPayload.length > 0) {
                  body.tools = toolsPayload;
                  body.tool_choice = 'auto';
                }
                if (streaming) body.stream = true;
                return body;
              };

              let res = await fetch(`${completionsUrl}`, {
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

              // Fallback to text-based tool execution if model doesn't support native function tools
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const errMsg = errData?.error?.message || '';
                const isDecommissioned = res.status === 404 || errData?.error?.code === 'model_not_found' || errData?.error?.code === 'model_decommissioned';
                const isToolUnsupported = errMsg.toLowerCase().includes('tool calling is not supported') || errMsg.toLowerCase().includes('tools is not supported');
                const isRateLimited = res.status === 429 || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('tpm limit');
                const isPayloadTooLarge = res.status === 413 || errMsg.toLowerCase().includes('request too large') || errMsg.toLowerCase().includes('tokens per minute (tpm)') || errMsg.toLowerCase().includes('reduce your message size');

                if (isDecommissioned) {
                  lastCandidateError = `Model ${candModel} decommissioned/unavailable on ${provider}`;
                  continue; // Try next candidate model
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

                  const retryRes = await fetch(`${completionsUrl}`, {
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
                  const retryRes = await fetch(`${completionsUrl}`, {
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
                  const bufferedRetry = await fetch(`${completionsUrl}`, {
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
                const { cleanText, extractedTools } = extractAndStripTextToolCalls(message.content || '');
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
                      const bufferedRes = await fetch(`${completionsUrl}`, {
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
                yield { delta: `\n\n*(Auto-continuing from token limit cutoff [Part ${continuationTurns + 1}]...)*\n\n` };

                try {
                  const contRes = await fetch(`${completionsUrl}`, {
                    method: 'POST',
                    headers: reqHeaders,
                    body: JSON.stringify({
                      model: candModel,
                      messages: [
                        { role: 'system', content: params.systemPrompt || '' },
                        ...augmentedMessages,
                        { role: 'assistant', content: sink.fullText },
                        { role: 'user', content: 'Continue generating the remaining code and output exactly from where you stopped. Do not repeat previously outputted lines.' },
                      ],
                      temperature: params.temperature ?? 0.7,
                      stream: true,
                    }),
                    signal: controller.signal,
                  });

                  if (!contRes.ok) break;

                  const contSink = { fullText: '', finishReason: '' };
                  for await (const contChunk of consumeOpenAICompatibleSSE(contRes, new StreamedToolCallAssembler(), contSink, params.signal)) {
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
            attemptErrors.push({ provider, error: lastCandidateError });
            totalAttempts += 1;
            if (!isHardFailure({ message: lastCandidateError }) && totalAttempts < MAX_TOTAL_ATTEMPTS) {
              yield { retryEvent: { attempt: totalAttempts, totalAttempts: MAX_TOTAL_ATTEMPTS, provider, model: providerModelId, status: 'retry', latencyMs: 0, reason: lastCandidateError } };
              // A partially-streamed answer from the failed attempt must not stay
              // glued in front of the retry's answer — clear it for a clean sequence.
              yield { resetContent: true };
              yield { thinking: `Retrying with ${providerDisplayName(provider)}… (attempt ${totalAttempts}/${MAX_TOTAL_ATTEMPTS})` };
              await sleep(retryBackoffMs);
              retryBackoffMs = Math.min(retryBackoffMs * 2, RETRY_BACKOFF_CAP_MS);
              providerQueue.unshift(provider);
            } else {
              retryBackoffMs = RETRY_BACKOFF_START_MS;
              failedPreviousRoute = provider;
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError' && params.signal?.aborted) return;
        attemptErrors.push({ provider, error: err.message || 'Execution error' });
        totalAttempts += 1;
        if (!isHardFailure(err) && totalAttempts < MAX_TOTAL_ATTEMPTS) {
          yield { retryEvent: { attempt: totalAttempts, totalAttempts: MAX_TOTAL_ATTEMPTS, provider, model: providerModelId, status: 'retry', latencyMs: 0, reason: err.message || 'Execution error' } };
          yield { resetContent: true };
          yield { thinking: `Retrying with ${providerDisplayName(provider)}… (attempt ${totalAttempts}/${MAX_TOTAL_ATTEMPTS})` };
          await sleep(retryBackoffMs);
          retryBackoffMs = Math.min(retryBackoffMs * 2, RETRY_BACKOFF_CAP_MS);
          providerQueue.unshift(provider);
        } else {
          retryBackoffMs = RETRY_BACKOFF_START_MS;
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
