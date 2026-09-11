import { describe, it, expect } from 'vitest';
import { VersionCommitmentEngine } from '../../server/harness/versionCommitment.js';

describe('versionCommitment', () => {
  it('registers candidate versions and computes composite scores', () => {
    const engine = new VersionCommitmentEngine();
    const v1 = engine.registerCandidate({
      title: 'Variation 1: Simple loop',
      fitnessScore: 0.7,
      hardwareModifier: 0.05,
    });

    expect(v1.id).toBe('v-1');
    expect(v1.compositeScore).toBe(0.75);
    expect(v1.status).toBe('candidate');
  });

  it('commits the Pareto-best variation', async () => {
    const engine = new VersionCommitmentEngine();
    engine.registerCandidate({ title: 'Var 1', fitnessScore: 0.6 });
    engine.registerCandidate({ title: 'Var 2', fitnessScore: 0.95 });
    engine.registerCandidate({ title: 'Var 3', fitnessScore: 0.8 });

    const committed = await engine.commitBestVariation();
    expect(committed).not.toBeNull();
    expect(committed?.id).toBe('v-2');
    expect(committed?.status).toBe('committed');
  });
});
