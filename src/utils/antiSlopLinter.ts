export interface VisualQAResult {
  score: number; // 0 - 10
  passed: boolean;
  violations: Array<{ rule: string; severity: 'error' | 'warning'; detail: string }>;
  recommendations: string[];
}

export class AntiSlopLinter {
  /**
   * Evaluates CSS / HTML / React code against high-craft Paper+Ink+Accent standards
   */
  public static evaluateCode(code: string): VisualQAResult {
    const violations: VisualQAResult['violations'] = [];
    const recommendations: string[] = [];

    // Rule 1: No purple/violet on dark backgrounds
    if (/(bg-(purple|violet|indigo)-900|bg-\[#1[0-9a-f]1[0-9a-f]3[0-9a-f]\]|text-(purple|violet)-400)/i.test(code)) {
      violations.push({
        rule: 'Forbidden Cliché: Purple on Dark',
        severity: 'error',
        detail: 'Generic purple-on-dark backgrounds detected. Use Obsidian zinc neutral canvas (#09090b).',
      });
      recommendations.push('Replace purple/violet backgrounds with neutral zinc-950 and use cobalt/blue for scarce accents.');
    }

    // Rule 2: No electric glowing colored borders
    if (/(border-(purple|cyan|pink)-500|shadow-\[0_0_.*(cyan|purple|pink)\])/i.test(code)) {
      violations.push({
        rule: 'Forbidden Cliché: Neon Glow Outlines',
        severity: 'warning',
        detail: 'Unnecessary glowing colored borders. Use 1px architectural hairline rules (rgba(255,255,255,0.06)).',
      });
      recommendations.push('Switch to 1px architectural hairlines without colored glow spreads.');
    }

    // Rule 3: No un-tracked huge headlines
    if (/(text-[5-9]xl(?!\s+tracking-))/i.test(code)) {
      violations.push({
        rule: 'Typography: Untracked Display Type',
        severity: 'warning',
        detail: 'Large display headlines must use tight negative tracking (tracking-tight or tracking-[-0.02em]).',
      });
      recommendations.push('Add tracking-tight to headlines >= text-4xl for engineered typographic density.');
    }

    // Calculate score
    const penalty = violations.reduce((acc, v) => acc + (v.severity === 'error' ? 2.5 : 1), 0);
    const score = Math.max(0, Math.min(10, 10 - penalty));

    return {
      score: parseFloat(score.toFixed(1)),
      passed: score >= 8.0,
      violations,
      recommendations: recommendations.length > 0 ? recommendations : ['Code meets high-craft Paper+Ink+Accent standards.'],
    };
  }
}
