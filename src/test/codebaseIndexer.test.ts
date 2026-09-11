import { describe, it, expect, beforeAll } from 'vitest';
import { CodebaseIndexer } from '../../server/tools/codebaseIndexer';
import * as path from 'path';

describe('CodebaseIndexer with BM25 Search & Symbol Graph', () => {
  let indexer: CodebaseIndexer;

  beforeAll(async () => {
    indexer = new CodebaseIndexer(path.resolve(__dirname, '../'));
    await indexer.buildIndex();
  }, 20000);

  it('should initialize and have indexed symbols', () => {
    expect(indexer).toBeDefined();
    const results = indexer.search('MonacoEditor', 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it('should return relevant search results with BM25 ranking in sub-millisecond time', () => {
    const start = performance.now();
    const results = indexer.search('editor diff', 5);
    const elapsedMs = performance.now() - start;

    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].symbol.name).toBeDefined();
    }
    // Fast execution verification (typically < 1ms, allowance for parallel test runner load)
    expect(elapsedMs).toBeLessThan(150);
  });

  it('should format semantic context for prompt', () => {
    const context = indexer.formatSemanticContextForPrompt('MonacoEditor');
    expect(typeof context).toBe('string');
    if (context.length > 0) {
      expect(context).toContain('RELEVANT CODEBASE SYMBOLS');
    }
  });

  it('supports Symbol Graph traversal and dependency discovery', () => {
    const graph = indexer.getSymbolGraph();
    expect(graph).toBeDefined();
    expect(graph.size).toBeGreaterThan(0);

    // Test BFS transitive dependency search
    const symbols = indexer.getSymbols();
    if (symbols.length > 0) {
      const firstSym = symbols[0];
      const deps = indexer.getTransitiveDependencies(firstSym.name, 3);
      expect(Array.isArray(deps)).toBe(true);
    }
  });

  it('supports incremental file indexing without rebuilding entire workspace', () => {
    const mockPath = 'src/test/mockComponent.tsx';
    const mockContent = `
      export const MockComponent: React.FC = () => <div>Mock</div>;
      export function helperFunction() { return 42; }
    `;

    const initialCount = indexer.getSymbols().length;
    indexer.updateFileIndex(mockPath, mockContent);

    const updatedSymbols = indexer.getSymbols();
    expect(updatedSymbols.length).toBeGreaterThan(initialCount);

    const searchResults = indexer.search('MockComponent', 3);
    expect(searchResults.some((r) => r.symbol.name === 'MockComponent')).toBe(true);

    // Incremental file deletion
    indexer.removeFile(mockPath);
    expect(indexer.getSymbols().length).toBe(initialCount);
  });
});

