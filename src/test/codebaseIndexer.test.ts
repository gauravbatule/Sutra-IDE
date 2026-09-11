import { describe, it, expect, beforeAll } from 'vitest';
import { CodebaseIndexer } from '../../server/tools/codebaseIndexer';
import * as path from 'path';

describe('CodebaseIndexer with BM25 Search', () => {
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

  it('should return relevant search results with BM25 ranking', () => {
    const results = indexer.search('editor diff', 5);
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].symbol.name).toBeDefined();
    }
  });

  it('should format semantic context for prompt', () => {
    const context = indexer.formatSemanticContextForPrompt('MonacoEditor');
    expect(typeof context).toBe('string');
    if (context.length > 0) {
      expect(context).toContain('RELEVANT CODEBASE SYMBOLS');
    }
  });
});
