/**
 * SUTRA Studio — Intelligent Command & Tool Dependency DAG Scheduler
 *
 * Automatically schedules and orchestrates multi-tool batches within an agent turn:
 * 1. Analyzes tool dependencies (Filesystem mutations, Reads, Package installs, Verification).
 * 2. Executes independent operations (file reads, grep, AST queries) concurrently in parallel (up to 10x throughput).
 * 3. Enforces strict sequential ordering where dependencies exist:
 *    - Directory creation completes before file writes into that directory.
 *    - File writes complete before typecheck, unit tests, or build commands.
 *    - Multiple edits targeting the SAME file execute in strict FIFO sequence.
 *    - Package installations (npm/pip) complete before test or server runs.
 */

export interface ToolCallItem {
  id: string;
  tool: string;
  params: any;
  result?: any;
  status?: string;
  error?: string;
  requiresApproval?: boolean;
  timestamp?: number;
  [key: string]: any;
}

export type ExecutionTier = 
  | 'TIER_1_STRUCTURE_AND_CHECKPOINTS'
  | 'TIER_2_PARALLEL_READS_AND_SEARCHES'
  | 'TIER_3_FILE_MUTATIONS'
  | 'TIER_4_PACKAGE_INSTALLATIONS'
  | 'TIER_5_VERIFICATION_AND_SYSTEM_COMMANDS';

export interface ScheduledToolGroup<TC = ToolCallItem> {
  tier: ExecutionTier;
  description: string;
  isParallel: boolean;
  toolCalls: TC[];
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'grep_search',
  'list_directory',
  'list_dir',
  'codebase_search',
  'search_files',
  'find_by_name',
  'get_codebase_outline',
  'ast_grep',
  'ast_query',
  'git_status',
  'git_diff',
  'git_log',
  'view_image',
  'view_file',
  'inspect_web_page',
  'fetch_web_page',
  'read_url_content',
  'search_web',
  'fetch_json_api',
  'scrape_url',
  'read_code_note',
  'count_loc',
  'find_dead_code',
  'ping_host',
  'dns_lookup',
  'read_todos',
  'list_memories',
  'read_memory',
  'get_run_detail',
  'list_runs',
  'get_diagnostics',
  'get_definition',
  'get_references',
  'get_symbols',
  'read_lint_errors',
  'read_resource',
  'list_resources',
  'get_file_info',
  'model_info',
]);

const STRUCTURE_TOOLS = new Set([
  'create_directory',
  'mkdir',
  'create_checkpoint',
]);

const MUTATING_FILE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'replace_file_content',
  'write_to_file',
  'delete_file',
  'rename_file',
]);

const PARALLEL_SUBAGENT_TOOLS = new Set([
  'invoke_subagent',
  'spawn_subagent',
  'run_subagent_task',
]);

const VERIFICATION_AND_ARTIFACT_TOOLS = new Set([
  'typecheck_project',
  'run_unit_tests',
  'verify_http_server',
  'create_artifact',
  'update_artifact',
  'create_markdown_doc',
  'create_findings_report',
  'write_todos',
  'save_note',
]);

/** Classifies if a run_command is a read-only query that can safely run in parallel */
export function isReadOnlyCommand(commandStr: string): boolean {
  if (!commandStr || typeof commandStr !== 'string') return false;
  const cmd = commandStr.trim().toLowerCase();
  return (
    cmd === 'git status' ||
    cmd.startsWith('git status ') ||
    cmd === 'git diff' ||
    cmd.startsWith('git diff ') ||
    cmd === 'git log' ||
    cmd.startsWith('git log ') ||
    cmd === 'git branch' ||
    cmd.startsWith('git branch ') ||
    cmd === 'ls' ||
    cmd.startsWith('ls ') ||
    cmd === 'dir' ||
    cmd.startsWith('dir ') ||
    cmd === 'pwd' ||
    cmd.startsWith('cat ') ||
    cmd.startsWith('type ') ||
    cmd.startsWith('head ') ||
    cmd.startsWith('tail ') ||
    cmd.startsWith('which ') ||
    cmd.startsWith('where ') ||
    cmd === 'node -v' ||
    cmd === 'node --version' ||
    cmd === 'npm -v' ||
    cmd === 'npm --version' ||
    cmd === 'python --version' ||
    cmd === 'python -v' ||
    cmd === 'python -V'
  );
}

/** Classifies if a run_command is a package installation that must precede build/test commands */
export function isPackageInstallCommand(commandStr: string): boolean {
  if (!commandStr || typeof commandStr !== 'string') return false;
  const cmd = commandStr.trim().toLowerCase();
  return (
    cmd.startsWith('npm i') ||
    cmd.startsWith('npm install') ||
    cmd.startsWith('pnpm i') ||
    cmd.startsWith('pnpm install') ||
    cmd.startsWith('yarn add') ||
    cmd.startsWith('yarn install') ||
    cmd.startsWith('pip install') ||
    cmd.startsWith('cargo add') ||
    cmd.startsWith('cargo build') ||
    cmd.startsWith('go get')
  );
}

function classifyToolTier(rawTool: string | undefined, params: any): ExecutionTier {
  const tool = typeof rawTool === 'string' ? rawTool : '';
  if (STRUCTURE_TOOLS.has(tool)) return 'TIER_1_STRUCTURE_AND_CHECKPOINTS';
  if (
    READ_ONLY_TOOLS.has(tool) ||
    PARALLEL_SUBAGENT_TOOLS.has(tool) ||
    tool.startsWith('get_') ||
    tool.startsWith('read_') ||
    tool.startsWith('list_') ||
    tool.startsWith('search_') ||
    (tool === 'run_command' && isReadOnlyCommand(params?.command || params?.CommandLine))
  ) {
    return 'TIER_2_PARALLEL_READS_AND_SEARCHES';
  }
  if (MUTATING_FILE_TOOLS.has(tool)) return 'TIER_3_FILE_MUTATIONS';
  if (tool === 'run_command' && isPackageInstallCommand(params?.command || params?.CommandLine)) return 'TIER_4_PACKAGE_INSTALLATIONS';
  return 'TIER_5_VERIFICATION_AND_SYSTEM_COMMANDS';
}

/**
 * Stages a flat array of tool calls into ordered dependency tiers.
 */
export function scheduleToolBatch<TC extends ToolCallItem = ToolCallItem>(toolCalls: TC[]): ScheduledToolGroup<TC>[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  const tier1Structure: TC[] = [];
  const tier2Reads: TC[] = [];
  const tier3Mutations: TC[] = [];
  const tier4Installs: TC[] = [];
  const tier5Verification: TC[] = [];

  for (const call of toolCalls) {
    const toolName = call.tool || (call as any).name || '';
    const tier = classifyToolTier(toolName, call.params);
    switch (tier) {
      case 'TIER_1_STRUCTURE_AND_CHECKPOINTS':
        tier1Structure.push(call);
        break;
      case 'TIER_2_PARALLEL_READS_AND_SEARCHES':
        tier2Reads.push(call);
        break;
      case 'TIER_3_FILE_MUTATIONS':
        tier3Mutations.push(call);
        break;
      case 'TIER_4_PACKAGE_INSTALLATIONS':
        tier4Installs.push(call);
        break;
      case 'TIER_5_VERIFICATION_AND_SYSTEM_COMMANDS':
      default:
        tier5Verification.push(call);
        break;
    }
  }

  const groups: ScheduledToolGroup<TC>[] = [];

  if (tier1Structure.length > 0) {
    groups.push({
      tier: 'TIER_1_STRUCTURE_AND_CHECKPOINTS',
      description: 'Filesystem Setup & Pre-Mutation Checkpoints',
      isParallel: true,
      toolCalls: tier1Structure,
    });
  }

  if (tier2Reads.length > 0) {
    groups.push({
      tier: 'TIER_2_PARALLEL_READS_AND_SEARCHES',
      description: 'Concurrent Read & Search Operations',
      isParallel: true,
      toolCalls: tier2Reads,
    });
  }

  if (tier3Mutations.length > 0) {
    groups.push({
      tier: 'TIER_3_FILE_MUTATIONS',
      description: 'File Mutations with Path Isolation',
      isParallel: false,
      toolCalls: tier3Mutations,
    });
  }

  if (tier4Installs.length > 0) {
    groups.push({
      tier: 'TIER_4_PACKAGE_INSTALLATIONS',
      description: 'Package Manager Dependency Installations',
      isParallel: false,
      toolCalls: tier4Installs,
    });
  }

  if (tier5Verification.length > 0) {
    groups.push({
      tier: 'TIER_5_VERIFICATION_AND_SYSTEM_COMMANDS',
      description: 'Project Verification, Tests & Artifact Generation',
      isParallel: false,
      toolCalls: tier5Verification,
    });
  }

  return groups;
}

export interface DAGTaskItem {
  id: string;
  dependsOn?: string[];
  [key: string]: any;
}

export interface DAGResolutionResult<TC extends DAGTaskItem = DAGTaskItem> {
  isAcyclic: boolean;
  topologicalOrder: TC[];
  executionWaves: TC[][]; // Parallel execution waves (wave 0 runs concurrently, then wave 1, etc.)
  cyclePath?: string[];
  criticalPathLength: number;
  inDegrees: Map<string, number>;
}

/**
 * Resolves an arbitrary Task Dependency DAG using Kahn's Algorithm in $O(V + E)$ time.
 * Detects cycles with cycle path reconstruction and groups tasks into parallel execution waves.
 */
export function resolveTaskDAG<TC extends DAGTaskItem = DAGTaskItem>(tasks: TC[]): DAGResolutionResult<TC> {
  if (!tasks || tasks.length === 0) {
    return {
      isAcyclic: true,
      topologicalOrder: [],
      executionWaves: [],
      criticalPathLength: 0,
      inDegrees: new Map(),
    };
  }

  const taskMap = new Map<string, TC>();
  const inDegree = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>(); // u -> list of v where v depends on u

  // Initialize nodes
  for (const task of tasks) {
    taskMap.set(task.id, task);
    inDegree.set(task.id, 0);
    adjacencyList.set(task.id, []);
  }

  // Build directed edges and in-degrees
  for (const task of tasks) {
    const deps = task.dependsOn || [];
    for (const depId of deps) {
      if (taskMap.has(depId)) {
        // depId -> task.id (task depends on depId)
        adjacencyList.get(depId)!.push(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
      }
    }
  }

  // Kahn's Algorithm (BFS)
  const queue: Array<{ id: string; depth: number }> = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push({ id, depth: 0 });
    }
  }

  const topologicalOrder: TC[] = [];
  const waveMap = new Map<number, TC[]>();
  let maxDepth = 0;

  const inDegreeCopy = new Map(inDegree);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const task = taskMap.get(id)!;
    topologicalOrder.push(task);

    maxDepth = Math.max(maxDepth, depth);
    const wave = waveMap.get(depth) || [];
    wave.push(task);
    waveMap.set(depth, wave);

    const neighbors = adjacencyList.get(id) || [];
    for (const nextId of neighbors) {
      const currentInDeg = inDegreeCopy.get(nextId)! - 1;
      inDegreeCopy.set(nextId, currentInDeg);
      if (currentInDeg === 0) {
        queue.push({ id: nextId, depth: depth + 1 });
      }
    }
  }

  // Cycle detection
  if (topologicalOrder.length < tasks.length) {
    // Reconstruct cycle path using DFS on remaining nodes with in-degree > 0
    const cyclePath = findCyclePath(tasks, adjacencyList, inDegreeCopy);
    return {
      isAcyclic: false,
      topologicalOrder,
      executionWaves: [],
      cyclePath,
      criticalPathLength: maxDepth,
      inDegrees: inDegree,
    };
  }

  const executionWaves: TC[][] = [];
  for (let d = 0; d <= maxDepth; d++) {
    if (waveMap.has(d)) {
      executionWaves.push(waveMap.get(d)!);
    }
  }

  return {
    isAcyclic: true,
    topologicalOrder,
    executionWaves,
    criticalPathLength: maxDepth + 1,
    inDegrees: inDegree,
  };
}

/**
 * Traces a cycle path in a directed graph using DFS.
 */
function findCyclePath<TC extends DAGTaskItem>(
  tasks: TC[],
  adjacencyList: Map<string, string[]>,
  remainingInDegrees: Map<string, number>
): string[] {
  const candidateIds = tasks.filter((t) => (remainingInDegrees.get(t.id) || 0) > 0).map((t) => t.id);
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const parent = new Map<string, string>();

  const dfs = (curr: string): string[] | null => {
    visited.add(curr);
    recStack.add(curr);

    for (const neighbor of adjacencyList.get(curr) || []) {
      if (!visited.has(neighbor)) {
        parent.set(neighbor, curr);
        const cycle = dfs(neighbor);
        if (cycle) return cycle;
      } else if (recStack.has(neighbor)) {
        // Cycle detected: backtrack path
        const path = [neighbor, curr];
        let p = curr;
        while (p !== neighbor && parent.has(p)) {
          p = parent.get(p)!;
          path.push(p);
        }
        return path.reverse();
      }
    }

    recStack.delete(curr);
    return null;
  };

  for (const id of candidateIds) {
    if (!visited.has(id)) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
  }

  return candidateIds.slice(0, 3);
}

/**
 * Executes a DAG batch wave-by-wave concurrently in parallel.
 */
export async function executeDAGBatch<TC extends DAGTaskItem = DAGTaskItem, R = any>(
  tasks: TC[],
  executeSingle: (task: TC) => Promise<R>,
  onWaveChange?: (waveIndex: number, wave: TC[]) => void
): Promise<Array<{ task: TC; result: R }>> {
  const dag = resolveTaskDAG(tasks);
  if (!dag.isAcyclic) {
    throw new Error(`Cannot execute cyclic task DAG: cycle detected along [${(dag.cyclePath || []).join(' -> ')}]`);
  }

  const results: Array<{ task: TC; result: R }> = [];

  for (let w = 0; w < dag.executionWaves.length; w++) {
    const wave = dag.executionWaves[w];
    if (onWaveChange) onWaveChange(w, wave);

    const waveResults = await Promise.all(
      wave.map(async (task) => {
        const res = await executeSingle(task);
        return { task, result: res };
      })
    );
    results.push(...waveResults);
  }

  return results;
}

/**
 * Executes a batch of tool calls using the Dependency DAG Scheduler.
 */
export async function executeToolBatchWithScheduler<TC extends ToolCallItem = ToolCallItem, R = any>(
  toolCalls: TC[],
  executeSingleTool: (toolCall: TC) => Promise<R>,
  onStageChange?: (stage: ScheduledToolGroup<TC>) => void
): Promise<Array<{ toolCall: TC; result: R }>> {
  // If tasks declare explicit DAG dependencies via dependsOn, use DAG Wave execution
  const hasExplicitDAG = toolCalls.some((c) => Array.isArray(c.dependsOn) && c.dependsOn.length > 0);
  if (hasExplicitDAG) {
    const dag = resolveTaskDAG(toolCalls as (TC & DAGTaskItem)[]);
    if (dag.isAcyclic) {
      const dagResults = await executeDAGBatch(
        toolCalls as (TC & DAGTaskItem)[],
        executeSingleTool as (t: TC & DAGTaskItem) => Promise<R>
      );
      const resultMap = new Map<string, { toolCall: TC; result: R }>();
      for (const item of dagResults) {
        resultMap.set(item.task.id, { toolCall: item.task as TC, result: item.result });
      }
      return toolCalls.map((call) => resultMap.get(call.id) || { toolCall: call, result: undefined as any });
    }
  }

  const groups = scheduleToolBatch(toolCalls);
  const results: Array<{ toolCall: TC; result: R }> = [];

  for (const group of groups) {
    if (onStageChange) onStageChange(group);

    if (group.tier === 'TIER_3_FILE_MUTATIONS') {
      // Path-isolated execution: group tool calls by file path
      const pathGroups = new Map<string, TC[]>();
      const otherCalls: TC[] = [];

      for (const call of group.toolCalls) {
        const rawParam =
          call.params?.path ||
          call.params?.filePath ||
          call.params?.targetPath ||
          call.params?.targetFile ||
          call.params?.file_path ||
          call.params?.target_path ||
          call.params?.target_file ||
          call.params?.oldPath ||
          call.params?.file ||
          call.params?.filename;
        if (rawParam && typeof rawParam === 'string' && rawParam.trim()) {
          const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
          let normPath = rawParam.trim().replace(/\\/g, '/');
          if (isCaseInsensitive) normPath = normPath.toLowerCase();
          const list = pathGroups.get(normPath) || [];
          list.push(call);
          pathGroups.set(normPath, list);
        } else {
          otherCalls.push(call);
        }
      }

      // Execute different file paths concurrently in parallel;
      // execute multiple edits on the SAME file path in strict FIFO sequence
      const pathPromises = Array.from(pathGroups.values()).map(async (callsForPath) => {
        const pathResults: Array<{ toolCall: TC; result: R }> = [];
        for (const call of callsForPath) {
          const res = await executeSingleTool(call);
          pathResults.push({ toolCall: call, result: res });
        }
        return pathResults;
      });

      const otherPromises = otherCalls.map(async (call) => {
        const res = await executeSingleTool(call);
        return [{ toolCall: call, result: res }];
      });

      const mutationBatchResults = await Promise.all([...pathPromises, ...otherPromises]);
      for (const batch of mutationBatchResults) {
        results.push(...batch);
      }
    } else if (group.isParallel) {
      // Fully concurrent parallel execution for independent reads or structure
      const tierResults = await Promise.all(
        group.toolCalls.map(async (call: TC) => {
          const res = await executeSingleTool(call);
          return { toolCall: call, result: res };
        })
      );
      results.push(...tierResults);
    } else {
      // Strict sequential execution for commands, installs, and verification
      for (const call of group.toolCalls) {
        const res = await executeSingleTool(call);
        results.push({ toolCall: call, result: res });
      }
    }
  }

  // Preserve original requested order in return value
  const resultMap = new Map<string, { toolCall: TC; result: R }>();
  for (const item of results) {
    resultMap.set(item.toolCall.id, item);
  }

  return toolCalls.map((call) => {
    return resultMap.get(call.id) || { toolCall: call, result: results.find((r) => r.toolCall.id === call.id)?.result as R };
  });
}
