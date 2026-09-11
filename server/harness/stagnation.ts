/**
 * SUTRA Studio — Stagnation Detection & Adaptive Compute
 *
 * Semantic loop detection: goes beyond exact-duplicate signatures to catch
 * repeated work on the same target and consecutive failure spirals, and
 * decides when a run deserves extra compute instead of a hard stop.
 *
 * Design notes (from real-run forensics):
 *  - Read-style tools are CHEAP and legitimately progressive: reading one file
 *    in several line windows is how a grounded agent audits a large codebase.
 *    Their targets therefore include the requested range, and their thresholds
 *    are far looser than mutating tools'. Killing a run for reading four
 *    different ranges of the same file was the "stops without doing anything"
 *    bug.
 *  - A block must never masquerade as success — the caller is expected to end
 *    the run as failed with the block reason, not completed.
 */

export interface ToolAttempt {
  tool: string;
  params: Record<string, unknown> | undefined;
  ok: boolean;
}

export type StagnationLevel = 'none' | 'warn' | 'block';

export interface StagnationAssessment {
  level: StagnationLevel;
  /** What pattern triggered the assessment ('' when none). */
  reason: string;
}

/** Read-only & inspection tools: high-frequency, non-destructive, cheap to repeat. */
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'grep_search',
  'ast_grep',
  'ast_search',
  'extract_symbols',
  'inspect_sqlite_schema',
  'git_status',
  'git_diff',
  'git_log',
  'typecheck_project',
  'lint_code',
  'run_linter',
  'run_unit_tests',
  'check_task_output',
  'read_tool_output',
  'search_web',
  'scrape_url',
  'fetch_url',
  'read_url',
  'browse_url',
  'verify_http_server',
  'inspect_port',
  'bench_http_endpoint',
  'codebase_search',
]);

/**
 * Range/qualifier params that distinguish two reads of the same target as
 * DIFFERENT work. Two read_file calls on one path with disjoint windows are
 * progress, not a loop.
 */
const RANGE_KEYS = [
  'lineRange',
  'line_range',
  'startLine',
  'start_line',
  'endLine',
  'end_line',
  'recursive',
  'caseInsensitive',
  'depth',
  'maxDepth',
  'language',
  'limit',
  'includes',
  'pattern',
] as const;

/** The identity of work being redone — same tool against the same target. */
export function attemptTarget(params: Record<string, unknown> | undefined, tool = ''): string {
  if (!params) return '';

  let base = '';
  if (tool === 'grep_search' || tool === 'ast_grep' || tool === 'ast_search') {
    const query = params.query ?? params.pattern ?? params.searchTerm ?? params.search;
    const searchPath = params.path ?? params.searchPath ?? params.dir;
    if (query !== undefined || searchPath !== undefined) {
      base = `query=${JSON.stringify(query ?? '')}&path=${JSON.stringify(searchPath ?? '')}`;
    }
  } else if (tool === 'run_command' || tool === 'execute_command') {
    return String(params.command ?? params.cmd ?? params.script ?? '');
  }

  if (!base) {
    const candidate =
      params.path ??
      params.filePath ??
      params.oldPath ??
      params.newPath ??
      params.dbPath ??
      params.url ??
      params.query ??
      params.pattern ??
      params.sql ??
      params.command ??
      '';
    if (candidate === '' || candidate === undefined || candidate === null) return '';
    base = String(candidate);
  }

  if (!READ_ONLY_TOOLS.has(tool)) return base;
  // Qualify read targets with their distinguishing arguments so progressive
  // reads (different windows, flags, limits) count as fresh work.
  const qualifiers = RANGE_KEYS.filter((key) => params[key] !== undefined)
    .map((key) => `${key}=${JSON.stringify(params[key])}`)
    .join(',');
  return qualifiers ? `${base}?${qualifiers}` : base;
}

function exactSignature(a: ToolAttempt): string {
  return `${a.tool}:${JSON.stringify(a.params ?? {})}`;
}

/** Per-tool thresholds — mutating tools stay reasonably firm, read & diagnostic tools stay loose. */
function thresholdsFor(tool: string, _params?: Record<string, unknown>): { warnAt: number; blockAt: number; exactBlockAt: number } {
  if (READ_ONLY_TOOLS.has(tool)) return { warnAt: 5, blockAt: 8, exactBlockAt: 6 };
  return { warnAt: 3, blockAt: 4, exactBlockAt: 3 };
}

/**
 * Tracks every executed attempt and assesses whether the run is going in
 * circles. Rules (most severe wins):
 *  - mutating tool: exact duplicate 5th time            -> block
 *  - mutating tool: same target 6th time                -> block (4th warns)
 *  - read tool: exact duplicate 8th time                -> block (6th warns)
 *  - read tool: same qualified target 12th time         -> block (6th warns)
 *  - 4 consecutive failures (any tool)                  -> warn
 *  - 8 consecutive failures (any tool)                  -> block
 */
export class StagnationDetector {
  private history: ToolAttempt[] = [];
  private exactCounts: Map<string, number> = new Map();

  /** Records an executed attempt and returns the resulting assessment. */
  record(attempt: ToolAttempt): StagnationAssessment {
    this.history.push(attempt);

    const thresholds = thresholdsFor(attempt.tool, attempt.params);

    const sig = exactSignature(attempt);
    const exactCount = (this.exactCounts.get(sig) || 0) + 1;
    this.exactCounts.set(sig, exactCount);
    if (exactCount >= thresholds.exactBlockAt) {
      return {
        level: 'block',
        reason: `identical ${attempt.tool} call already made ${exactCount - 1} times`,
      };
    }

    const target = attemptTarget(attempt.params, attempt.tool);
    if (target) {
      const sameWork = this.history.filter(
        (a) => a.tool === attempt.tool && attemptTarget(a.params, a.tool) === target
      ).length;
      if (sameWork >= thresholds.blockAt) {
        return {
          level: 'block',
          reason: `${attempt.tool} has targeted "${target}" ${sameWork} times without converging`,
        };
      }
      if (sameWork >= thresholds.warnAt) {
        return {
          level: 'warn',
          reason: `${attempt.tool} has targeted "${target}" ${sameWork} times — results are not changing`,
        };
      }
    }

    let consecutiveFailures = 0;
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      if (this.history[i].ok) break;
      consecutiveFailures += 1;
    }
    if (consecutiveFailures >= 6) {
      return {
        level: 'block',
        reason: `${consecutiveFailures} actions failed in a row — the current approach cannot proceed`,
      };
    }
    if (consecutiveFailures >= 3) {
      return {
        level: 'warn',
        reason: `${consecutiveFailures} actions failed in a row — the current approach is not working`,
      };
    }

    return { level: 'none', reason: '' };
  }
}

/**
 * Adaptive compute: a run that is demonstrably mid-work (open plan, real
 * progress, no stagnation) earns one bounded extension instead of being cut
 * off at the base round budget.
 */
export function shouldExtendRun(input: {
  /** Rounds consumed so far relative to the CURRENT budget (base or extended). */
  roundsUsed: number;
  maxRounds: number;
  planHasOpenItems: boolean;
  runShowsProgress: boolean;
  stagnationLevel: StagnationLevel;
  extensionsUsed: number;
  /** How many extensions the caller allows for this run kind (goal missions extend further). */
  maxExtensions?: number;
}): boolean {
  return (
    input.extensionsUsed < (input.maxExtensions ?? 1) &&
    input.roundsUsed >= input.maxRounds - 1 &&
    input.planHasOpenItems &&
    input.runShowsProgress &&
    input.stagnationLevel !== 'block'
  );
}
