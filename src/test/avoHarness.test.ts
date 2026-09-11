import { describe, it, expect, beforeEach } from 'vitest';
import {
  AVOFitnessEvaluator,
  AVOTrajectorySupervisor,
  AVOEvolutionArchive,
  AVOEngine,
  FitnessMetrics,
} from '../../server/harness/avoEngine.js';
import { GitCheckpointsManager } from '../../server/harness/gitCheckpoints.js';
import { useIDEStore } from '../stores/ideStore.js';

describe('SUTRA AVO Pro Harness Engine', () => {
  describe('AVOFitnessEvaluator', () => {
    it('computes composite fitness scores based on typecheck, test, build and ast metrics', () => {
      const evaluator = new AVOFitnessEvaluator();
      
      const perfectScore = evaluator.computeCompositeScore({
        typecheckPassed: true,
        testsPassRate: 1.0,
        buildPassed: true,
        astValid: true,
      });
      expect(perfectScore).toBe(1.0);

      const partialScore = evaluator.computeCompositeScore({
        typecheckPassed: true,
        testsPassRate: 0.5,
        buildPassed: false,
        astValid: true,
      });
      // 0.35 (types) + 0.175 (tests) + 0 (build) + 0.10 (ast) = 0.625
      expect(partialScore).toBe(0.625);

      const zeroScore = evaluator.computeCompositeScore({
        typecheckPassed: false,
        testsPassRate: 0.0,
        buildPassed: false,
        astValid: false,
      });
      expect(zeroScore).toBe(0.0);
    });
  });

  describe('AVOTrajectorySupervisor', () => {
    let supervisor: AVOTrajectorySupervisor;

    beforeEach(() => {
      supervisor = new AVOTrajectorySupervisor();
    });

    it('tracks improving steps and updates best fitness', () => {
      const step1Fitness: FitnessMetrics = {
        score: 0.60,
        typecheckPassed: true,
        testsPassedCount: 1,
        testsTotalCount: 2,
        testsPassRate: 0.5,
        buildPassed: true,
        astValid: true,
        durationMs: 50,
        summary: 'Baseline fitness',
      };

      const decision1 = supervisor.recordStep({
        round: 1,
        checkpointId: 'chk-1',
        variationId: 'var-1',
        fitness: step1Fitness,
        actionSummary: 'Initial variation',
      });

      expect(decision1.decision).toBe('continue');
      expect(supervisor.getBestFitness()).toBe(0.60);
      expect(supervisor.getBestCheckpointId()).toBe('chk-1');

      // Second step improves fitness
      const step2Fitness: FitnessMetrics = {
        ...step1Fitness,
        score: 0.85,
        testsPassRate: 1.0,
      };

      const decision2 = supervisor.recordStep({
        round: 2,
        checkpointId: 'chk-2',
        variationId: 'var-2',
        fitness: step2Fitness,
        actionSummary: 'Optimized variation',
      });

      expect(decision2.decision).toBe('continue');
      expect(supervisor.getBestFitness()).toBe(0.85);
      expect(supervisor.getBestCheckpointId()).toBe('chk-2');
    });

    it('triggers rollback recommendation when candidate variations consistently regress', () => {
      // Step 1: Good baseline
      supervisor.recordStep({
        round: 1,
        checkpointId: 'chk-good',
        fitness: { score: 0.85, typecheckPassed: true, testsPassedCount: 1, testsTotalCount: 1, testsPassRate: 1.0, buildPassed: true, astValid: true, durationMs: 10, summary: 'Good' },
        actionSummary: 'Baseline',
      });

      // Step 2: Regression 1
      supervisor.recordStep({
        round: 2,
        checkpointId: 'chk-bad-1',
        fitness: { score: 0.40, typecheckPassed: false, testsPassedCount: 0, testsTotalCount: 1, testsPassRate: 0.0, buildPassed: false, astValid: true, durationMs: 10, summary: 'Regression 1' },
        actionSummary: 'Bad variation 1',
      });

      // Step 3: Regression 2
      const decision3 = supervisor.recordStep({
        round: 3,
        checkpointId: 'chk-bad-2',
        fitness: { score: 0.35, typecheckPassed: false, testsPassedCount: 0, testsTotalCount: 1, testsPassRate: 0.0, buildPassed: false, astValid: true, durationMs: 10, summary: 'Regression 2' },
        actionSummary: 'Bad variation 2',
      });

      expect(decision3.decision).toBe('rollback_recommended');
      expect(decision3.rollbackCheckpointId).toBe('chk-good');
      expect(decision3.reason).toContain('Rolling back to best checkpoint');
    });

    it('identifies optimal convergence when score reaches near 100%', () => {
      const decision = supervisor.recordStep({
        round: 1,
        checkpointId: 'chk-opt',
        fitness: { score: 1.0, typecheckPassed: true, testsPassedCount: 10, testsTotalCount: 10, testsPassRate: 1.0, buildPassed: true, astValid: true, durationMs: 10, summary: 'Optimal' },
        actionSummary: 'Clean implementation',
      });

      expect(decision.decision).toBe('optimal_converged');
    });
  });

  describe('AVOEvolutionArchive', () => {
    it('stores and retrieves winning recipes by keyword relevance', () => {
      const archive = new AVOEvolutionArchive();

      archive.saveWinningRecipe({
        taskPattern: 'fix react hydration mismatch with useEffect and dynamic import',
        winningVariation: 'Wrap browser-only window access in useEffect and render fallback',
        fitnessAchieved: 1.0,
        keyInsights: ['Check typeof window === undefined', 'Use suppressHydrationWarning if needed'],
        workspaceRoot: '/test',
      });

      archive.saveWinningRecipe({
        taskPattern: 'sqlite database migration transaction error',
        winningVariation: 'Execute ALTER TABLE inside db.transaction block',
        fitnessAchieved: 0.95,
        keyInsights: ['Wrap in better-sqlite3 transaction'],
        workspaceRoot: '/test',
      });

      const hydrationMatches = archive.findRelevantRecipes('debugging a react hydration');
      expect(hydrationMatches.length).toBeGreaterThanOrEqual(1);
      expect(hydrationMatches[0].taskPattern).toContain('hydration mismatch');

      const dbMatches = archive.findRelevantRecipes('sqlite migration failure');
      expect(dbMatches.length).toBeGreaterThanOrEqual(1);
      expect(dbMatches[0].taskPattern).toContain('sqlite database');
    });

    it('records failed mutation patterns', () => {
      const archive = new AVOEvolutionArchive();
      archive.recordFailedPattern('Direct DOM query in SSR component', 'Throws ReferenceError: document is not defined');

      const failed = archive.getFailedPatterns();
      expect(failed.length).toBe(1);
      expect(failed[0].pattern).toContain('Direct DOM query');
      expect(failed[0].reason).toContain('ReferenceError');
    });
  });

  describe('AVOEngine', () => {
    it('registers proposed candidate variations', () => {
      const engine = new AVOEngine();
      const variation = engine.proposeVariation(
        'Refactor to Strategy Pattern',
        'Extract routing logic into discrete handler classes',
        [{ path: 'src/router.ts', newContent: 'export class Router {}' }],
        'REFACTOR_DECOMPOSE'
      );

      expect(variation.id).toMatch(/^var-/);
      expect(variation.title).toBe('Refactor to Strategy Pattern');
      expect(variation.operator).toBe('REFACTOR_DECOMPOSE');
      expect(variation.status).toBe('proposed');
      expect(engine.getVariations()).toHaveLength(1);
    });

    it('computes non-dominated Pareto frontier across multiple candidate variations', async () => {
      const { computeParetoFrontier } = await import('../../server/harness/avoEngine.js');

      const varA: any = {
        id: 'var-a',
        title: 'Variation A',
        fitnessMetrics: { score: 0.9, testsPassRate: 1.0, typecheckPassed: true },
      };
      const varB: any = {
        id: 'var-b',
        title: 'Variation B',
        fitnessMetrics: { score: 0.7, testsPassRate: 0.5, typecheckPassed: true },
      };
      const varC: any = {
        id: 'var-c',
        title: 'Variation C',
        fitnessMetrics: { score: 0.95, testsPassRate: 1.0, typecheckPassed: true },
      };

      const { frontier, ranked } = computeParetoFrontier([varA, varB, varC]);
      expect(frontier.length).toBeGreaterThanOrEqual(1);
      expect(frontier.some((v) => v.id === 'var-c')).toBe(true);
      expect(ranked[0].id).toBe('var-c');
    });
  });

  describe('GitCheckpointsManager Baseline Fallback', () => {
    it('creates and lists micro-checkpoints with metadata', async () => {
      const checkpoints = new GitCheckpointsManager();
      const result = await checkpoints.createCheckpoint('Test pre-flight checkpoint', ['package.json']);

      expect(result.checkpoint.id).toMatch(/^chk-/);
      expect(result.checkpoint.description).toBe('Test pre-flight checkpoint');
      expect(checkpoints.getCheckpoints().length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('IDE Store Harness Mode State', () => {
    it('toggles harnessMode between standard and avo with persistence', () => {
      const store = useIDEStore.getState();
      expect(store.harnessMode).toBeDefined();

      store.setHarnessMode('avo');
      expect(useIDEStore.getState().harnessMode).toBe('avo');

      store.setHarnessMode('standard');
      expect(useIDEStore.getState().harnessMode).toBe('standard');
    });
  });
});
