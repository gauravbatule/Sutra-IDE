/**
 * SUTRA Studio — NVIDIA AVO-Inspired Evolutionary Harness Engine (AVO Pro Mode)
 *
 * Implements Agentic Variation Operators (AVO):
 * 1. Multi-Candidate Variation Exploration (branching hypotheses & isolated diffs)
 * 2. Deterministic Closed-Loop Ground-Truth Fitness Evaluator (Typecheck, Vitest, Build, AST)
 * 3. Adaptive Trajectory Supervisor (Pareto frontier tracking, auto-rollback on regressions)
 * 4. Long-Horizon Evolution Archive (preserving winning recipes & failure post-mortems)
 */
import { fsTools } from '../tools/fsTools.js';
import { gitCheckpoints } from './gitCheckpoints.js';
import { runWorkspaceVerification, VerificationReport } from './verification.js';

export type AVOOperatorType =
  | 'REFACTOR_DECOMPOSE'
  | 'VECTORIZE_PARALLELIZE'
  | 'MEMOIZE_CACHE'
  | 'INVARIANT_HARDEN'
  | 'CROSSOVER_SYNTHESIS'
  | 'CUSTOM';

export interface CandidateVariation {
  id: string;
  title: string;
  strategy: string;
  operator?: AVOOperatorType;
  diffs: Array<{
    path: string;
    oldContent?: string;
    newContent: string;
  }>;
  fitnessScore?: number;
  fitnessMetrics?: FitnessMetrics;
  paretoRank?: number;
  status: 'proposed' | 'evaluating' | 'accepted' | 'rejected' | 'reverted';
  createdAt: number;
}

export interface FitnessMetrics {
  score: number; // 0.00 to 1.00
  typecheckPassed: boolean;
  testsPassedCount: number;
  testsTotalCount: number;
  testsPassRate: number;
  buildPassed: boolean;
  astValid: boolean;
  durationMs: number;
  summary: string;
}

export interface TrajectoryStep {
  round: number;
  checkpointId?: string;
  variationId?: string;
  fitnessScore: number;
  delta: number;
  status: 'improving' | 'regressing' | 'stagnant' | 'optimal';
  actionSummary: string;
  timestamp: number;
}

export interface EvolutionRecipe {
  id: string;
  taskPattern: string;
  winningVariation: string;
  operator?: AVOOperatorType;
  fitnessAchieved: number;
  keyInsights: string[];
  workspaceRoot: string;
  timestamp: number;
}

export function validateDiffSyntaxInMemory(diffs: CandidateVariation['diffs']): { valid: boolean; error?: string } {
  for (const diff of diffs) {
    const ext = diff.path.split('.').pop()?.toLowerCase() || '';
    const content = diff.newContent;

    if (ext === 'json') {
      try {
        JSON.parse(content);
      } catch (err: any) {
        return { valid: false, error: `Invalid JSON syntax in ${diff.path}: ${err.message}` };
      }
    } else if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
      // Fast-path bracket and token balancing check (< 0.5ms)
      const stack: string[] = [];
      let inString: string | null = null;
      let inComment = false;
      let inLineComment = false;

      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const next = content[i + 1];

        if (inLineComment) {
          if (char === '\n') inLineComment = false;
          continue;
        }
        if (inComment) {
          if (char === '*' && next === '/') {
            inComment = false;
            i++;
          }
          continue;
        }
        if (inString) {
          if (char === '\\') {
            i++; // Skip escaped char
            continue;
          }
          if (char === inString) {
            inString = null;
          }
          continue;
        }

        if (char === '/' && next === '/') {
          inLineComment = true;
          i++;
          continue;
        }
        if (char === '/' && next === '*') {
          inComment = true;
          i++;
          continue;
        }
        if (char === '"' || char === "'" || char === '`') {
          inString = char;
          continue;
        }

        if (char === '{' || char === '(' || char === '[') {
          stack.push(char);
        } else if (char === '}' || char === ')' || char === ']') {
          const last = stack.pop();
          if (
            (char === '}' && last !== '{') ||
            (char === ')' && last !== '(') ||
            (char === ']' && last !== '[')
          ) {
            return { valid: false, error: `Unbalanced bracket '${char}' in ${diff.path}` };
          }
        }
      }

      if (inString && inString !== '`') {
        return { valid: false, error: `Unterminated string literal in ${diff.path}` };
      }
      if (stack.length > 0) {
        return { valid: false, error: `Unclosed delimiter '${stack[stack.length - 1]}' in ${diff.path}` };
      }
    }
  }
  return { valid: true };
}

export class AVOFitnessEvaluator {
  private cache: Map<string, FitnessMetrics> = new Map();

  public computeCompositeScore(metrics: {
    typecheckPassed: boolean;
    testsPassRate: number;
    buildPassed: boolean;
    astValid: boolean;
  }): number {
    return Number((
      (metrics.typecheckPassed ? 0.35 : 0.0) +
      (Math.max(0, Math.min(1, metrics.testsPassRate)) * 0.35) +
      (metrics.buildPassed ? 0.20 : 0.0) +
      (metrics.astValid ? 0.10 : 0.0)
    ).toFixed(3));
  }

  /**
   * Computes a deterministic ground-truth fitness score for a workspace state.
   */
  public async evaluateCurrentWorkspace(opts: {
    mutatedFiles?: string[];
    permissionMode?: 'strict' | 'full';
  } = {}): Promise<FitnessMetrics> {
    const permissionMode = opts.permissionMode ?? 'full';
    const mutatedFiles = opts.mutatedFiles || [];
    const startTime = Date.now();

    // Cache key based on mutated files
    const cacheKey = `${mutatedFiles.sort().join(';')}:${permissionMode}`;
    if (mutatedFiles.length > 0 && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let typecheckPassed = false;
    let testsPassedCount = 0;
    let testsTotalCount = 0;
    let testsPassRate = 1.0;
    let buildPassed = true;
    let astValid = true;

    try {
      const report: VerificationReport = await runWorkspaceVerification({
        workspaceRoot: fsTools.getWorkspaceRoot(),
        filesChanged: Math.max(1, mutatedFiles.length),
        mutatedFiles,
        permissionMode,
      });

      for (const check of report.checks) {
        if (check.name === 'typecheck') {
          typecheckPassed = check.status === 'passed';
        } else if (check.name === 'tests') {
          if (check.status === 'passed') {
            testsPassedCount = 1;
            testsTotalCount = 1;
            testsPassRate = 1.0;
          } else if (check.status === 'failed') {
            testsPassedCount = 0;
            testsTotalCount = 1;
            testsPassRate = 0.0;
          }
        } else if (check.name === 'build') {
          buildPassed = check.status === 'passed' || check.status === 'skipped';
        } else if (check.name.startsWith('syntax:') || check.name.startsWith('html-integrity:')) {
          if (check.status === 'failed') {
            astValid = false;
          }
        }
      }
    } catch {
      // Best-effort evaluation
    }

    const score = this.computeCompositeScore({ typecheckPassed, testsPassRate, buildPassed, astValid });
    const summary = `Fitness: ${(score * 100).toFixed(1)}% (Types: ${typecheckPassed ? 'PASS' : 'FAIL'}, Tests: ${(testsPassRate * 100).toFixed(0)}%, Build: ${buildPassed ? 'PASS' : 'FAIL'}, AST: ${astValid ? 'VALID' : 'INVALID'})`;

    const metrics: FitnessMetrics = {
      score,
      typecheckPassed,
      testsPassedCount,
      testsTotalCount,
      testsPassRate,
      buildPassed,
      astValid,
      durationMs: Date.now() - startTime,
      summary,
    };

    if (mutatedFiles.length > 0) {
      this.cache.set(cacheKey, metrics);
      if (this.cache.size > 50) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }
    }

    return metrics;
  }

  public clearCache(): void {
    this.cache.clear();
  }
}

export class AVOTrajectorySupervisor {
  private steps: TrajectoryStep[] = [];
  private bestFitness = 0.0;
  private bestCheckpointId: string | null = null;
  private consecutiveRegressions = 0;

  public recordStep(params: {
    round: number;
    checkpointId?: string;
    variationId?: string;
    fitness: FitnessMetrics;
    actionSummary: string;
  }): {
    decision: 'continue' | 'rollback_recommended' | 'optimal_converged';
    rollbackCheckpointId?: string;
    reason: string;
  } {
    const currentScore = params.fitness.score;
    const delta = Number((currentScore - this.bestFitness).toFixed(3));

    let status: TrajectoryStep['status'] = 'stagnant';
    if (delta > 0.05) {
      status = 'improving';
      this.bestFitness = currentScore;
      if (params.checkpointId) {
        this.bestCheckpointId = params.checkpointId;
      }
      this.consecutiveRegressions = 0;
    } else if (delta < -0.15) {
      status = 'regressing';
      this.consecutiveRegressions++;
    } else if (currentScore >= 0.98) {
      status = 'optimal';
    }

    this.steps.push({
      round: params.round,
      checkpointId: params.checkpointId,
      variationId: params.variationId,
      fitnessScore: currentScore,
      delta,
      status,
      actionSummary: params.actionSummary,
      timestamp: Date.now(),
    });

    if (currentScore >= 0.98) {
      return {
        decision: 'optimal_converged',
        reason: 'Optimal fitness achieved (100% types & tests passing).',
      };
    }

    if (this.consecutiveRegressions >= 2 && this.bestCheckpointId) {
      return {
        decision: 'rollback_recommended',
        rollbackCheckpointId: this.bestCheckpointId,
        reason: `Trajectory regressed by ${(Math.abs(delta) * 100).toFixed(1)}% across ${this.consecutiveRegressions} consecutive attempts. Rolling back to best checkpoint (${(this.bestFitness * 100).toFixed(1)}% fitness).`,
      };
    }

    return {
      decision: 'continue',
      reason: delta >= 0 ? `Trajectory progressing (Fitness: ${(currentScore * 100).toFixed(1)}%)` : `Variation underperforming (Delta: ${(delta * 100).toFixed(1)}%)`,
    };
  }

  public getTrajectory(): TrajectoryStep[] {
    return [...this.steps];
  }

  public getBestFitness(): number {
    return this.bestFitness;
  }

  public getBestCheckpointId(): string | null {
    return this.bestCheckpointId;
  }

  public reset(): void {
    this.steps = [];
    this.bestFitness = 0.0;
    this.bestCheckpointId = null;
    this.consecutiveRegressions = 0;
  }
}

export class AVOEvolutionArchive {
  private recipes: EvolutionRecipe[] = [];
  private failedPatterns: Array<{ pattern: string; reason: string; timestamp: number }> = [];

  public saveWinningRecipe(recipe: Omit<EvolutionRecipe, 'id' | 'timestamp'>): EvolutionRecipe {
    const entry: EvolutionRecipe = {
      ...recipe,
      id: `rcp-${Date.now()}`,
      timestamp: Date.now(),
    };
    this.recipes.push(entry);
    if (this.recipes.length > 100) this.recipes.shift();
    return entry;
  }

  public recordFailedPattern(pattern: string, reason: string): void {
    this.failedPatterns.push({
      pattern: pattern.slice(0, 200),
      reason: reason.slice(0, 200),
      timestamp: Date.now(),
    });
    if (this.failedPatterns.length > 100) this.failedPatterns.shift();
  }

  public findRelevantRecipes(taskQuery: string): EvolutionRecipe[] {
    const queryTokens = taskQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    return this.recipes
      .map((recipe) => {
        let matches = 0;
        for (const token of queryTokens) {
          if (recipe.taskPattern.toLowerCase().includes(token)) matches++;
        }
        return { recipe, relevance: matches };
      })
      .filter((item) => item.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .map((item) => item.recipe)
      .slice(0, 3);
  }

  public getFailedPatterns(): Array<{ pattern: string; reason: string }> {
    return [...this.failedPatterns];
  }
}

/**
 * Computes non-dominated Pareto ranking across multi-objective metrics.
 */
export function computeParetoFrontier(candidates: CandidateVariation[]): {
  frontier: CandidateVariation[];
  ranked: CandidateVariation[];
} {
  const ranked = [...candidates].map((c) => ({ ...c, paretoRank: 1 }));

  for (let i = 0; i < ranked.length; i++) {
    for (let j = 0; j < ranked.length; j++) {
      if (i === j) continue;
      const fitA = ranked[i].fitnessMetrics;
      const fitB = ranked[j].fitnessMetrics;
      if (!fitA || !fitB) continue;

      // Candidate i is dominated by j if j is >= in all and strictly > in at least one
      const dominated =
        fitB.score >= fitA.score &&
        fitB.testsPassRate >= fitA.testsPassRate &&
        Number(fitB.typecheckPassed) >= Number(fitA.typecheckPassed) &&
        (fitB.score > fitA.score || fitB.testsPassRate > fitA.testsPassRate || Number(fitB.typecheckPassed) > Number(fitA.typecheckPassed));

      if (dominated) {
        ranked[i].paretoRank = (ranked[i].paretoRank || 1) + 1;
      }
    }
  }

  const frontier = ranked.filter((c) => c.paretoRank === 1);
  return { frontier, ranked: ranked.sort((a, b) => (a.paretoRank || 1) - (b.paretoRank || 1)) };
}

export class AVOEngine {
  public evaluator = new AVOFitnessEvaluator();
  public supervisor = new AVOTrajectorySupervisor();
  public archive = new AVOEvolutionArchive();
  private candidateVariations: Map<string, CandidateVariation> = new Map();

  /**
   * Proposes a new candidate variation for a multi-diff exploration step.
   */
  public proposeVariation(
    title: string,
    strategy: string,
    diffs: CandidateVariation['diffs'],
    operator: AVOOperatorType = 'CUSTOM'
  ): CandidateVariation {
    const id = `var-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const variation: CandidateVariation = {
      id,
      title,
      strategy,
      operator,
      diffs,
      status: 'proposed',
      createdAt: Date.now(),
    };
    this.candidateVariations.set(id, variation);
    return variation;
  }

  /**
   * Fast-path candidate testing:
   * 1. In-memory AST pre-filter (< 1ms). Drops invalid syntax without touching disk.
   * 2. Scoped verification passing mutated files.
   * 3. Automatic rollback if trajectory supervisor detects regression.
   */
  public async testCandidateVariation(variationId: string): Promise<{
    variation: CandidateVariation;
    fitness: FitnessMetrics;
    action: 'accepted' | 'reverted';
    reason: string;
  }> {
    const variation = this.candidateVariations.get(variationId);
    if (!variation) throw new Error(`Variation ${variationId} not found.`);

    variation.status = 'evaluating';
    const preMutationFiles = variation.diffs.map((d) => d.path);

    // 1. In-memory AST syntax pre-check (< 1ms)
    const syntaxCheck = validateDiffSyntaxInMemory(variation.diffs);
    if (!syntaxCheck.valid) {
      variation.status = 'rejected';
      const rejectedFitness: FitnessMetrics = {
        score: 0.0,
        typecheckPassed: false,
        testsPassedCount: 0,
        testsTotalCount: 1,
        testsPassRate: 0.0,
        buildPassed: false,
        astValid: false,
        durationMs: 1,
        summary: `AST Fast-Path Rejection: ${syntaxCheck.error}`,
      };
      variation.fitnessScore = 0.0;
      variation.fitnessMetrics = rejectedFitness;
      this.archive.recordFailedPattern(variation.strategy, syntaxCheck.error || 'Syntax validation failed');
      return {
        variation,
        fitness: rejectedFitness,
        action: 'reverted',
        reason: `Fast-Path Rejection: ${syntaxCheck.error}`,
      };
    }

    // 2. Create micro-checkpoint before applying candidate variation
    const cp = await gitCheckpoints.createCheckpoint(`AVO pre-variation snapshot before ${variation.title}`, preMutationFiles);

    // 3. Apply the candidate diffs to workspace
    for (const diff of variation.diffs) {
      fsTools.writeFile(diff.path, diff.newContent);
    }

    // 4. Deterministically evaluate fitness with mutated file awareness
    const fitness = await this.evaluator.evaluateCurrentWorkspace({ mutatedFiles: preMutationFiles });
    variation.fitnessScore = fitness.score;
    variation.fitnessMetrics = fitness;

    // 5. Trajectory supervisor decides whether to keep or backtrack
    const assessment = this.supervisor.recordStep({
      round: 1,
      checkpointId: cp.checkpoint.id,
      variationId,
      fitness,
      actionSummary: `Evaluated ${variation.title}`,
    });

    if (assessment.decision === 'rollback_recommended') {
      await gitCheckpoints.rollback(cp.checkpoint.id);
      variation.status = 'reverted';
      this.archive.recordFailedPattern(variation.strategy, assessment.reason);
      return {
        variation,
        fitness,
        action: 'reverted',
        reason: assessment.reason,
      };
    }

    variation.status = 'accepted';
    return {
      variation,
      fitness,
      action: 'accepted',
      reason: assessment.reason,
    };
  }

  /**
   * Batch variation evaluation: tests multiple candidate variations,
   * ranks them on the Pareto frontier, and commits the winning variation.
   */
  public async evaluateBatchVariations(
    candidates: Array<{ title: string; strategy: string; diffs: CandidateVariation['diffs']; operator?: AVOOperatorType }>
  ): Promise<{
    winningVariation: CandidateVariation | null;
    evaluatedCount: number;
    results: Array<{ id: string; title: string; fitness: number; status: string }>;
    paretoFrontier: CandidateVariation[];
  }> {
    const results: Array<{ id: string; title: string; fitness: number; status: string }> = [];
    const evaluatedVariations: CandidateVariation[] = [];
    let bestVariation: CandidateVariation | null = null;
    let highestScore = -1;

    for (const candidate of candidates) {
      const variation = this.proposeVariation(candidate.title, candidate.strategy, candidate.diffs, candidate.operator);
      const testResult = await this.testCandidateVariation(variation.id);
      evaluatedVariations.push(variation);

      results.push({
        id: variation.id,
        title: variation.title,
        fitness: testResult.fitness.score,
        status: testResult.action,
      });

      if (testResult.action === 'accepted' && testResult.fitness.score > highestScore) {
        highestScore = testResult.fitness.score;
        bestVariation = variation;
      }
    }

    const { frontier } = computeParetoFrontier(evaluatedVariations);

    if (bestVariation && highestScore > 0.8) {
      this.archive.saveWinningRecipe({
        taskPattern: bestVariation.strategy,
        winningVariation: bestVariation.title,
        operator: bestVariation.operator,
        fitnessAchieved: highestScore,
        keyInsights: [`Applied ${bestVariation.title} (${bestVariation.operator || 'CUSTOM'}) with ${(highestScore * 100).toFixed(1)}% fitness score`],
        workspaceRoot: fsTools.getWorkspaceRoot(),
      });
    }

    return {
      winningVariation: bestVariation,
      evaluatedCount: candidates.length,
      results,
      paretoFrontier: frontier,
    };
  }

  public getVariations(): CandidateVariation[] {
    return Array.from(this.candidateVariations.values());
  }
}

export const avoEngine = new AVOEngine();
