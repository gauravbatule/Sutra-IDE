export interface Hypothesis {
  id: string;
  strategy: string;
  expectedOutcome: string;
  falsificationCondition: string;
  hardwareTarget: string;
  status: 'formulated' | 'testing' | 'confirmed' | 'falsified';
  evidence?: string;
  createdAt: number;
  updatedAt: number;
}

export class HypothesisEngine {
  private activeHypotheses: Map<string, Hypothesis> = new Map();


  public formulate(params: {
    strategy: string;
    expectedOutcome: string;
    falsificationCondition: string;
    hardwareTarget?: string;
  }): Hypothesis {
    const id = `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const hypothesis: Hypothesis = {
      id,
      strategy: params.strategy,
      expectedOutcome: params.expectedOutcome,
      falsificationCondition: params.falsificationCondition,
      hardwareTarget: params.hardwareTarget || 'general-correctness',
      status: 'formulated',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.activeHypotheses.set(id, hypothesis);
    return hypothesis;
  }


  public evaluateHypothesis(
    id: string,
    evidence: {
      testsPassed: boolean;
      typecheckPassed: boolean;
      memoryLeak: boolean;
      summary: string;
    }
  ): Hypothesis {
    const hyp = this.activeHypotheses.get(id);
    if (!hyp) {
      throw new Error(`Hypothesis with id "${id}" not found.`);
    }

    hyp.updatedAt = Date.now();
    hyp.evidence = evidence.summary;

    if (!evidence.testsPassed || !evidence.typecheckPassed || evidence.memoryLeak) {
      hyp.status = 'falsified';
    } else {
      hyp.status = 'confirmed';
    }

    return hyp;
  }


  public getHypothesis(id: string): Hypothesis | undefined {
    return this.activeHypotheses.get(id);
  }


  public listHypotheses(): Hypothesis[] {
    return Array.from(this.activeHypotheses.values());
  }
}

export const hypothesisEngine = new HypothesisEngine();
