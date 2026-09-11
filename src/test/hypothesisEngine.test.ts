import { describe, it, expect } from 'vitest';
import { hypothesisEngine } from '../../server/harness/hypothesisEngine.js';

describe('hypothesisEngine', () => {
  it('formulates and tracks a coding hypothesis', () => {
    const hyp = hypothesisEngine.formulate({
      strategy: 'Add index to SQL query',
      expectedOutcome: 'Reduce query latency below 10ms',
      falsificationCondition: 'Query latency still > 50ms',
      hardwareTarget: 'database-storage',
    });

    expect(hyp.id).toContain('hyp-');
    expect(hyp.status).toBe('formulated');
    expect(hyp.strategy).toBe('Add index to SQL query');
  });

  it('evaluates and confirms a verified hypothesis', () => {
    const hyp = hypothesisEngine.formulate({
      strategy: 'Tree-shake lodash imports',
      expectedOutcome: 'Bundle size reduction',
      falsificationCondition: 'Typecheck or test failures',
    });

    const confirmed = hypothesisEngine.evaluateHypothesis(hyp.id, {
      testsPassed: true,
      typecheckPassed: true,
      memoryLeak: false,
      summary: 'Typecheck and tests passed cleanly',
    });

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.evidence).toContain('passed cleanly');
  });

  it('falsifies hypotheses when evidence reveals failures', () => {
    const hyp = hypothesisEngine.formulate({
      strategy: 'Remove promise await',
      expectedOutcome: 'Faster execution',
      falsificationCondition: 'Async race conditions',
    });

    const falsified = hypothesisEngine.evaluateHypothesis(hyp.id, {
      testsPassed: false,
      typecheckPassed: true,
      memoryLeak: false,
      summary: 'Test faced uncaught reference error',
    });

    expect(falsified.status).toBe('falsified');
  });
});
