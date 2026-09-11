import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { planVerificationChecks, runWorkspaceVerification } from '../../server/harness/verification.js';

const tempDirs: string[] = [];

function makeWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-verify-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  }
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Temp cleanup is best-effort
    }
  }
});

describe('planVerificationChecks', () => {
  const EMPTY = { exists: true, scripts: {}, hasVitest: false };

  it('proposes no checks without package.json or tsconfig', () => {
    expect(planVerificationChecks({ exists: false, scripts: {}, hasVitest: false }, false)).toEqual([]);
  });

  it('uses npx tsc when a tsconfig exists but no typecheck script', () => {
    const checks = planVerificationChecks(EMPTY, true);
    expect(checks.map((c) => c.name)).toEqual(['typecheck']);
    expect(checks[0].args).toEqual(['tsc', '--noEmit']);
    expect(checks[0].executesCode).toBe(false);
  });

  it('prefers the explicit typecheck script over bare tsc', () => {
    const checks = planVerificationChecks({ ...EMPTY, scripts: { typecheck: 'tsc -p tsconfig.build.json' } }, true);
    expect(checks[0].command).toBe('npm');
    expect(checks[0].args).toEqual(['run', 'typecheck']);
  });

  it('runs vitest directly to avoid watch mode hanging the stage', () => {
    const checks = planVerificationChecks({ ...EMPTY, hasVitest: true }, false);
    const tests = checks.find((c) => c.name === 'tests');
    expect(tests?.args).toEqual(['vitest', 'run']);
    expect(tests?.executesCode).toBe(true);
  });

  it('falls back to the test script when vitest is absent', () => {
    const checks = planVerificationChecks({ ...EMPTY, scripts: { test: 'jest' } }, false);
    expect(checks.map((c) => c.name)).toEqual(['tests']);
    expect(checks[0].args).toEqual(['run', 'test']);
  });

  it('includes the build script when present', () => {
    const checks = planVerificationChecks({ ...EMPTY, scripts: { build: 'vite build' } }, false);
    expect(checks.some((c) => c.name === 'build')).toBe(true);
  });
});

describe('runWorkspaceVerification', () => {
  it('reports a passing check for a clean workspace script', async () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({ name: 'ok', version: '1.0.0', scripts: { typecheck: 'node exit0.js' } }),
      'exit0.js': 'process.exit(0);',
    });
    const report = await runWorkspaceVerification({
      workspaceRoot: root,
      filesChanged: 2,
      permissionMode: 'full',
    });
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ name: 'typecheck', status: 'passed' });
    expect(report.allPassed).toBe(true);
    expect(report.filesChanged).toBe(2);
  }, 30_000);

  it('captures failure output as the check summary', async () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({ name: 'bad', version: '1.0.0', scripts: { typecheck: 'node boom.js' } }),
      'boom.js': "console.error('Error: TS9999 something exploded'); process.exit(1);",
    });
    const report = await runWorkspaceVerification({ workspaceRoot: root, filesChanged: 1, permissionMode: 'full' });
    expect(report.checks[0].status).toBe('failed');
    expect(report.allPassed).toBe(false);
    expect(report.checks[0].summary).toMatch(/TS9999/i);
  }, 30_000);

  it('marks hung checks as timed out and still resolves', async () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({ name: 'slow', version: '1.0.0', scripts: { typecheck: 'node slow.js' } }),
      'slow.js': 'setTimeout(() => {}, 10000);',
    });
    const started = Date.now();
    const report = await runWorkspaceVerification({
      workspaceRoot: root,
      filesChanged: 1,
      permissionMode: 'full',
      timeoutOverrideMs: 500,
    });
    expect(Date.now() - started).toBeLessThan(8000);
    expect(report.checks[0].status).toBe('timeout');
    expect(report.allPassed).toBe(false);
  }, 20_000);

  it('never auto-runs code-executing checks in strict approval mode', async () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'strict',
        version: '1.0.0',
        scripts: {},
        devDependencies: { vitest: '^4.0.0' },
      }),
    });
    const report = await runWorkspaceVerification({ workspaceRoot: root, filesChanged: 3, permissionMode: 'strict' });
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ name: 'tests', status: 'skipped' });
    // Skips are not failures — the stage reports what it could prove.
    expect(report.allPassed).toBe(true);
  });

  it('returns an empty report for workspaces with nothing verifiable', async () => {
    const root = makeWorkspace({});
    const report = await runWorkspaceVerification({ workspaceRoot: root, filesChanged: 1, permissionMode: 'full' });
    expect(report.checks).toEqual([]);
    expect(report.allPassed).toBe(true);
  });

  it('executes instant fast verification when only HTML/CSS/JSON are mutated', async () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({ name: 'heavy', version: '1.0.0', scripts: { typecheck: 'node heavy.js' } }),
      'heavy.js': 'setTimeout(() => process.exit(0), 10000);',
      'index.html': '<!DOCTYPE html><html><head><title>Mini Minecraft</title></head><body></body></html>',
      'style.css': 'body { margin: 0; }',
      'config.json': '{"theme":"dark"}',
    });
    const started = Date.now();
    const report = await runWorkspaceVerification({
      workspaceRoot: root,
      filesChanged: 3,
      mutatedFiles: ['index.html', 'style.css', 'config.json'],
      permissionMode: 'full',
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1500);
    expect(report.allPassed).toBe(true);
    expect(report.checks.some((c) => c.name.startsWith('html:'))).toBe(true);
    expect(report.checks.some((c) => c.name.startsWith('css:'))).toBe(true);
    expect(report.checks.some((c) => c.name.startsWith('syntax:'))).toBe(true);
  });
});
