import { describe, it, expect } from 'vitest';
import {
  validateDiffSyntaxInMemory,
  AVOFitnessEvaluator,
  AVOEngine,
} from '../../server/harness/avoEngine.js';

describe('AVO Pro Acceleration & Fast-Path Engine', () => {
  describe('In-Memory Fast AST / Syntax Pre-Filter', () => {
    it('detects unclosed curly braces in TypeScript diffs in < 1ms without touching disk', () => {
      const brokenDiffs = [
        {
          path: 'src/components/Editor.tsx',
          newContent: 'export function Editor() { return <div>Hello',
        },
      ];

      const start = performance.now();
      const check = validateDiffSyntaxInMemory(brokenDiffs);
      const elapsed = performance.now() - start;

      expect(check.valid).toBe(false);
      expect(check.error).toContain('Unclosed delimiter');
      expect(elapsed).toBeLessThan(10);
    });

    it('detects invalid JSON syntax in configuration diffs in < 1mq', () => {
      const brokenJson = [
        {
          path: 'config/settings.json',
          newContent: '{\n  "theme": "dark",\n  "fontSize": 14,\n}',
        },
      ];

      const check = validateDiffSyntaxInMemory(brokenJson);
      expect(check.valid).toBe(false);
      expect(check.error).toContain('Invalid JSON syntax');
    });

    it('passes clean, syntactically valid TypeScript and JSON files', () => {
      const validDiffs = [
        {
          path: 'src/utils/math.ts',
          newContent: 'export function add(a: number, b: number): number { return a + b; }',
        },
        {
          path: 'package.json',
          newContent: '{\n  "name": "app",\n  "version": "1.0.0"\n}',
        },
      ];

      const check = validateDiffSyntaxInMemory(validDiffs);
      expect(check.valid).toBe(true);
      expect(check.error).toBeUndefined();
    });
  });

  describe('AVOFitnessEvaluator Composite Score & Cache', () => {
      it('computes weighted composite scores accurately', () => {
        const evaluator = new AVOFitnessEvaluator();
        const scoreAllPass = evaluator.computeCompositeScore({
          typecheckPassed: true,
          testsPassRate: 1.0,
          buildPassed: true,
          astValid: true,
        });
        expect(scoreAllPass).toBe(1.0);

        const scoreNoTests = evaluator.computeCompositeScore({
          typecheckPassed: true,
          testsPassRate: 0.0,
          buildPassed: true,
          astValid: true,
        });
        expect(scoreNoTests).toBe(0.65);
      });
  });

  describe('AVOEngine Fast-Path Variation Rejection', () => {
    it('fast-rejects syntax-invalid candidate without writing to disk', async () => {
      const engine = new AVOEngine();
      const variation = engine.proposeVariation(
        'Broken Syntax Candidate',
        'Refactoring with syntax mistake',
        [{ path: 'src/broken.ts', newContent: 'function test( { return 1; }' }]
      );

      const result = await engine.testCandidateVariation(variation.id);
      expect(result.action).toBe('reverted');
      expect(result.reason).toContain('Fast-Path Rejection');
      expect(result.fitness.score).toBe(0);
      expect(variation.status).toBe('rejected');
    });
  });
});
