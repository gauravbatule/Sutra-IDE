/**
 * SUTRA Studio — Stagnation Detection & Adaptive Compute
 *
 * Semantic loop detection: goes beyond exact-duplicate signatures to catch
 * repeated work on the same target and consecutive failure spirals, and
 * decides when a run deserves extra compute instead of a hard stop.
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

/** The identity of work being redone — same tool against the same target. */
export function attemptTarget(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const candidate =
    params.path ??
    params.oldPath ??
    params.newPath ??
    params.url ??
    params.query ??
    params.pattern ??
    params.command ??
    '';
  return String(candidate);
}

function exactSignature(a: ToolAttempt): string {
  return `${a.tool}:${JSON.stringify(a.params ?? {})}`;
}

/**
 * Tracks every executed attempt and assesses whether the run is going in
 * circles. Rules (most severe wins):
 *  - exact duplicate invocation 3rd time          -> block
 *  - same tool on same target, 4th time           -> block
 *  - same tool on same target, 3rd time           -> warn
 *  - 3 consecutive failures (any tool)            -> warn
 */
export class StagnationDetector {
  private history: ToolAttempt[] = [];
  private exactCounts: Map<string, number> = new Map();

  /** Records an executed attempt and returns the resulting assessment. */
  record(attempt: ToolAttempt): StagnationAssessment {
    this.history.push(attempt);

    const sig = exactSignature(attempt);
    const exactCount = (this.exactCounts.get(sig) || 0) + 1;
    this.exactCounts.set(sig, exactCount);
    if (exactCount >= 3) {
      return { level: 'block', reason: `identical ${attempt.tool} call already made ${exactCount - 1} times` };
    }

    const target = attemptTarget(attempt.params);
    if (target) {
      const sameWork = this.history.filter(
        (a) => a.tool === attempt.tool && attemptTarget(a.params) === target
      ).length;
      if (sameWork >= 4) {
        return { level: 'block', reason: `${attempt.tool} has targeted "${target}" ${sameWork} times without converging` };
      }
      if (sameWork >= 3) {
        return { level: 'warn', reason: `${attempt.tool} has targeted "${target}" ${sameWork} times — results are not changing` };
      }
    }

    let consecutiveFailures = 0;
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      if (this.history[i].ok) break;
      consecutiveFailures += 1;
    }
    if (consecutiveFailures >= 3) {
      return { level: 'warn', reason: `${consecutiveFailures} actions failed in a row — the current approach is not working` };
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
}): boolean {
  return (
    input.extensionsUsed < 1 &&
    input.roundsUsed >= input.maxRounds - 1 &&
    input.planHasOpenItems &&
    input.runShowsProgress &&
    input.stagnationLevel !== 'block'
  );
}
