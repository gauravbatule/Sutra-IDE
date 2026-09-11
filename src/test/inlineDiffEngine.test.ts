import { describe, it, expect } from 'vitest';
import { inlineDiffEngine } from '../../server/tools/inlineDiffEngine';

describe('InlineDiffEngine', () => {
  const oldContent = `function hello() {
  console.log("Hello");
  return 42;
}`;

  const newContent = `function hello() {
  console.log("Hello, World!");
  console.log("Additional line");
  return 42;
}`;

  it('should generate structured diff', () => {
    const diff = inlineDiffEngine.generateDiff('test.ts', oldContent, newContent);

    expect(diff.filePath).toBe('test.ts');
    expect(diff.additions).toBeGreaterThan(0);
    expect(diff.hunks.length).toBeGreaterThan(0);
  });

  it('should count additions and deletions correctly', () => {
    const diff = inlineDiffEngine.generateDiff('test.ts', oldContent, newContent);

    // We added one line and modified one line
    expect(diff.additions).toBe(2); // "Hello, World!" + new line
    expect(diff.deletions).toBe(1); // Old "Hello" line
  });

  it('should generate Monaco decorations', () => {
    const diff = inlineDiffEngine.generateDiff('test.ts', oldContent, newContent);
    const decorations = inlineDiffEngine.generateMonacoDecorations(diff);

    expect(decorations.additions).toBeDefined();
    expect(decorations.deletions).toBeDefined();
    expect(Array.isArray(decorations.additions)).toBe(true);
    expect(Array.isArray(decorations.deletions)).toBe(true);
  });

  it('should generate unified diff string', () => {
    const unifiedDiff = inlineDiffEngine.generateUnifiedDiff('test.ts', oldContent, newContent);

    expect(unifiedDiff).toContain('--- test.ts');
    expect(unifiedDiff).toContain('+++ test.ts');
    expect(unifiedDiff).toContain('@@');
    expect(unifiedDiff).toContain('+  console.log("Hello, World!");');
  });

  it('should apply diff correctly', () => {
    const unifiedDiff = inlineDiffEngine.generateUnifiedDiff('test.ts', oldContent, newContent);
    const result = inlineDiffEngine.applyDiff(oldContent, unifiedDiff);

    expect(result).toBe(newContent);
  });

  it('should format diff summary', () => {
    const diff = inlineDiffEngine.generateDiff('src/utils/helper.ts', oldContent, newContent);
    const summary = inlineDiffEngine.formatDiffSummary(diff);

    expect(summary).toContain('src/utils/helper.ts');
    expect(summary).toContain('+2');
    expect(summary).toContain('-1');
  });

  it('should handle identical content', () => {
    const diff = inlineDiffEngine.generateDiff('test.ts', oldContent, oldContent);

    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.hunks.length).toBe(0);
  });

  it('should handle empty files', () => {
    const diff = inlineDiffEngine.generateDiff('test.ts', '', 'new content');

    expect(diff.additions).toBeGreaterThan(0);
    expect(diff.deletions).toBe(0);
  });
});
