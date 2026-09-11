import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LSPManager } from '../../server/lsp/lspManager';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('LSPManager', () => {
  let lspManager: LSPManager;
  let testDir: string;
  let testFilePath: string;

  beforeAll(async () => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), 'lsp-test-' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });

    // Create a test TypeScript file with an error
    testFilePath = path.join(testDir, 'test.ts');
    fs.writeFileSync(
      testFilePath,
      `
      const x: number = "hello"; // Type error
      function add(a: number, b: number): number {
        return a + b;
      }
      `
    );

    // Create tsconfig.json
    fs.writeFileSync(
      path.join(testDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
        },
      })
    );

    lspManager = new LSPManager(testDir);
    await lspManager.initialize();
  });

  afterAll(async () => {
    await lspManager.shutdown();
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize successfully', () => {
    expect(lspManager.isReady()).toBe(true);
  });

  it('should detect diagnostics for a file with errors', async () => {
    // Open the document to trigger diagnostics
    const content = fs.readFileSync(testFilePath, 'utf-8');
    await lspManager.didOpen(testFilePath, 'typescript', content);

    // Wait a bit for diagnostics to arrive
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const diagnostics = lspManager.getDiagnostics(testFilePath);
    expect(diagnostics).toBeDefined();
    // Should have at least one error (type mismatch)
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('should find definition of a function', async () => {
    const content = fs.readFileSync(testFilePath, 'utf-8');
    await lspManager.didOpen(testFilePath, 'typescript', content);

    // Wait for language server to process
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Try to find definition of 'add' function (line 3, character 16)
    const locations = await lspManager.getDefinition(testFilePath, 'typescript', 3, 16);

    // Definition should be found
    expect(Array.isArray(locations)).toBe(true);
  });

  it('should shutdown cleanly', async () => {
    await lspManager.shutdown();
    expect(lspManager.isReady()).toBe(false);
  });
});
