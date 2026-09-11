/**
 * Central human-label map for SUTRA tool calls (chat audit #8/#9).
 *
 * Tool cards must never surface raw internal names (`repo_browser.list_directory`,
 * `write_todos`, ...) as their primary label. This module maps EVERY tool this
 * codebase can emit — sourced from server/modelRouter.ts `SUTRA_TOOLS` plus the
 * execute-switch cases in server/agentSwarm.ts (which accepts legacy aliases such
 * as `generate_image`, `ast_search`, `check_background_task`) — to a short human
 * phrase. Unknown tools fall back to a prettifier that strips namespaces and
 * snake_case into Title Case.
 */

const HUMAN_TOOL_LABELS: Record<string, string> = {
  // Filesystem & code inspection
  read_file: 'Reading file',
  write_file: 'Writing file',
  edit_file: 'Editing file',
  delete_file: 'Deleting file',
  create_directory: 'Creating directory',
  rename_path: 'Renaming path',
  list_directory: 'Scanning project files',
  grep_search: 'Searching codebase',
  grep: 'Searching codebase',
  search_code: 'Searching codebase',
  code_search: 'Searching codebase',
  ast_grep: 'Searching code structure',
  ast_search: 'Searching code structure',
  extract_symbols: 'Extracting symbols',
  format_code: 'Formatting file',
  lint_code: 'Linting code',
  typecheck_project: 'Typechecking project',
  find_dead_code: 'Finding dead code',
  count_loc: 'Counting lines of code',

  // Commands & background processes
  run_command: 'Running command',
  run_background_process: 'Starting background process',
  kill_process: 'Stopping process',
  kill_task: 'Stopping background task',
  list_running_processes: 'Listing processes',
  list_tasks: 'Listing background tasks',
  get_process_logs: 'Reading process logs',
  manage_task: 'Managing background tasks',
  check_task_output: 'Checking background task',
  check_background_task: 'Checking background task',
  inspect_port: 'Checking port',
  bench_http_endpoint: 'Benchmarking endpoint',

  // Git
  git_status: 'Checking git status',
  git_diff: 'Inspecting diff',
  git_commit: 'Committing changes',
  git_branch: 'Managing git branches',
  git_checkout: 'Switching branch',
  git_stash: 'Stashing changes',
  git_log: 'Viewing commit history',
  git_cherry_pick: 'Cherry-picking commit',

  // Web
  search_web: 'Searching the web',
  scrape_url: 'Reading web page',
  fetch_json_api: 'Calling API endpoint',
  ping_host: 'Pinging host',
  dns_lookup: 'Resolving DNS',
  download_file: 'Downloading file',

  // Database
  inspect_sqlite_schema: 'Inspecting database schema',
  query_sqlite: 'Querying database',
  export_sqlite_data: 'Exporting data',
  run_db_migration: 'Running migration',

  // Generated media
  generate_image_asset: 'Generating image',
  generate_image: 'Generating image',
  image_generate: 'Generating image',
  create_image: 'Generating image',
  generate_svg_asset: 'Generating vector graphic',
  generate_video_asset: 'Generating video',
  generate_video: 'Generating video',
  generate_audio_asset: 'Generating audio',
  generate_audio: 'Generating audio',
  generate_sound_effect: 'Generating sound effect',
  generate_sfx: 'Generating sound effect',
  generate_music_asset: 'Generating music',
  generate_music: 'Generating music',
  generate_song_asset: 'Generating song',
  generate_song: 'Generating song',
  extract_color_palette: 'Extracting color palette',

  // Testing, audits & quality gates
  run_unit_tests: 'Running tests',
  audit_accessibility_wcag: 'Auditing accessibility',
  audit_performance_vitals: 'Auditing performance',
  audit_security_dependencies: 'Auditing dependencies',
  validate_env_variables: 'Validating environment variables',
  parse_pdf_content: 'Extracting PDF text',
  ocr_image_text: 'Reading text from image',
  generate_test_suite: 'Generating tests',
  generate_openapi_spec: 'Generating API spec',

  // Planning, scaffolding & delegation
  write_todos: 'Creating task plan',
  todo_write: 'Creating task plan',
  scaffold_component: 'Scaffolding component',
  generate_dockerfile: 'Generating Dockerfile',
  spawn_subagent: 'Delegating to specialist',
  dispatch_subagents: 'Delegating to specialists',
  ask_user: 'Asking you',
  remember_memory: 'Saving insight',
  save_note: 'Saving insight',
  create_artifact: 'Creating artifact',
  update_artifact: 'Updating artifact',
  create_implementation_plan: 'Creating implementation plan',
  update_task_progress: 'Updating task progress',
  create_walkthrough: 'Creating walkthrough',
};

/** Namespace prefixes the server strips before dispatch (server/agentSwarm.ts). */
const NAMESPACE_PREFIX_RE = /^(?:repo_browser|workspace|fs|file_system|tools|functions)\./i;

/**
 * Fallback prettifier for tools missing from the map: strips namespace
 * prefixes, splits snake_case/camelCase, and Title Cases the remainder.
 */
export const prettifyToolLabel = (rawTool: string): string => {
  const words = rawTool
    .replace(NAMESPACE_PREFIX_RE, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'Working';
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Short human phrase for a tool call ('Reading file', 'Scanning project files').
 * Falls back to a Title Case prettifier for tools missing from the map.
 */
export const humanToolLabel = (tool: string): string => {
  if (!tool || typeof tool !== 'string') return 'Working';
  const bare = tool.trim().replace(NAMESPACE_PREFIX_RE, '');
  return HUMAN_TOOL_LABELS[bare] ?? HUMAN_TOOL_LABELS[bare.toLowerCase()] ?? prettifyToolLabel(bare);
};
