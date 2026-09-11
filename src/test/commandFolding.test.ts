import { describe, it, expect } from 'vitest';
import { SecurityGuardrails } from '../../server/security/guardrails.js';

describe('Bi-Directional Head+Tail Command Output Folding', () => {
  it('leaves short command outputs untouched', () => {
    const output = 'Compiling TypeScript...\nAll files valid.\nDone in 0.4s.';
    const result = SecurityGuardrails.truncateToolOutput(output, 20000);
    expect(result).toBe(output);
  });

  it('folds large command outputs preserving top context and error tail', () => {
    const lines = [
      'vite v5.0.0 building for production...',
      'transforming (1/240) index.html',
      'transforming (2/240) src/main.tsx',
      ...Array.from({ length: 500 }, (_, i) => `chunk ${i}: processing intermediate AST module...`),
      'src/components/Dashboard.tsx:42:15 - error TS2304: Cannot find name "activeSubscription".',
      '42   const status = activeSubscription.status;',
      '                    ~~~~~~~~~~~~~~~~~~',
      'Found 1 error in src/components/Dashboard.tsx:42',
      'Build failed with exit code 1',
    ];

    const fullOutput = lines.join('\n');
    const folded = SecurityGuardrails.truncateToolOutput(fullOutput, 1000);

    expect(folded.length).toBeLessThanOrEqual(1500);
    expect(folded).toContain('vite v5.0.0 building for production...');
    expect(folded).toContain('Cannot find name "activeSubscription"');
    expect(folded).toContain('Build failed with exit code 1');
    expect(folded).toContain('FOLDED');
    expect(folded).toContain('PRESERVING TOP CONTEXT & RECENT DIAGNOSTIC TAIL');
  });
});
