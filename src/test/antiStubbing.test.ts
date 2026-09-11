import { describe, it, expect } from 'vitest';
import { detectStubbingMarkers, validateNonDestructiveEdit } from '../../server/tools/inlineDiffEngine.js';
import { sutraHarness } from '../../server/harness/sutraHarness.js';

describe('Anti-Stubbing & Semantic Code Integrity Engine', () => {
  it('detects common lazy LLM placeholder markers', () => {
    const codeWithStub1 = `
      function authenticate(user) {
        // ... existing code ...
        return isValid;
      }
    `;
    const res1 = detectStubbingMarkers(codeWithStub1);
    expect(res1.hasStub).toBe(true);
    expect(res1.stubMarkers).toContain('// ... existing code');

    const codeWithStub2 = `
      export class OrderManager {
        /* ... existing code ... */
        cancelOrder(id) {
          /* implement the rest */
        }
      }
    `;
    const res2 = detectStubbingMarkers(codeWithStub2);
    expect(res2.hasStub).toBe(true);
    expect(res2.stubMarkers.length).toBeGreaterThanOrEqual(2);
  });

  it('passes completely written clean code without false positives', () => {
    const cleanCode = `
      import React from 'react';

      export const Counter = () => {
        const [count, setCount] = React.useState(0);
        return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>;
      };
    `;
    const res = detectStubbingMarkers(cleanCode);
    expect(res.hasStub).toBe(false);
    expect(res.stubMarkers.length).toBe(0);
  });

  it('rejects destructive edits that wipe out existing multi-line modules', () => {
    const original = Array.from({ length: 60 }, (_, i) => `function handler${i}() { return ${i}; }`).join('\n');
    const wiped = `function handler0() { return 0; }`;

    const validation = validateNonDestructiveEdit(original, wiped);
    expect(validation.safe).toBe(false);
    expect(validation.reason).toContain('Destructive truncation alert');
  });

  it('harness plugin blocks tool execution when stub markers are present in edit params', async () => {
    const context: any = { sessionId: 'test', metadata: {} };
    const blocked = await sutraHarness.runToolExecutionHooks(
      {
        id: 'call-1',
        tool: 'edit_file',
        params: {
          path: 'src/service.ts',
          content: 'class Service { // ... existing code ... }',
        },
        requiresApproval: false,
        status: 'pending',
        timestamp: Date.now(),
      },
      context
    );

    expect(blocked).toBe(false);
  });
});
