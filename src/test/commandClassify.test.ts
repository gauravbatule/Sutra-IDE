import { describe, it, expect } from 'vitest';
import {
  classifyCommand,
  resolveWaitBudget,
  LONG_COMMAND_WAIT_BUDGET_MS,
  DEFAULT_COMMAND_WAIT_BUDGET_MS,
} from '../../server/agentSwarm.js';

describe('classifyCommand', () => {
  it('classifies package installs and dependency updates as LONG', () => {
    for (const cmd of ['npm install', 'pnpm ci', 'yarn add react', 'bun update', 'pip install requests']) {
      const c = classifyCommand(cmd);
      expect(c.waitClass).toBe('long');
      expect(c.budgetMs).toBe(LONG_COMMAND_WAIT_BUDGET_MS);
    }
  });

  it('classifies builds, compiles, tests, docker, and lint runs as LONG', () => {
    for (const cmd of [
      'npm run build',
      'tsc --noEmit',
      'pytest -q',
      'cargo build --release',
      'docker compose up -d',
      'eslint "src/**/*.{ts,tsx}"',
      'gradle assemble',
    ]) {
      expect(classifyCommand(cmd).waitClass).toBe('long');
    }
  });

  it('leaves ordinary one-shot commands on the DEFAULT budget', () => {
    for (const cmd of ['echo hello', 'git status', 'ls -la', 'node scratch_verify.ts']) {
      const c = classifyCommand(cmd);
      expect(c.waitClass).toBe('default');
      expect(c.budgetMs).toBe(DEFAULT_COMMAND_WAIT_BUDGET_MS);
    }
  });

  it('detects server/watcher intents as SERVER regardless of package manager', () => {
    for (const cmd of [
      'npm run dev',
      'yarn serve',
      'pnpm start',
      'vite',
      'nodemon server.js',
      'next dev',
      'python -m http.server 5173',
      'python3 -m http.server',
      'uvicorn main:app',
      'flask run',
    ]) {
      expect(classifyCommand(cmd).waitClass).toBe('server');
    }
  });

  it('keeps one-shot framework builds LONG even when the tool name looks server-like', () => {
    expect(classifyCommand('vite build').waitClass).toBe('long');
    expect(classifyCommand('next build').waitClass).toBe('long');
    // Watch flags flip a compiler into SERVER; without them tsc stays LONG.
    expect(classifyCommand('tsc --watch').waitClass).toBe('server');
    expect(classifyCommand('npx tsc src/index.ts').waitClass).toBe('long');
  });

  it('classifies chained commands by their most dangerous stage', () => {
    expect(classifyCommand('npm ci && npm run build && npm test').waitClass).toBe('long');
    // Anything in a chain that serves forever means the whole call must not block.
    expect(classifyCommand('npm run build && npm run serve').waitClass).toBe('server');
  });

  it('is insensitive to casing and extra whitespace', () => {
    expect(classifyCommand('  NPM   INSTALL ').waitClass).toBe('long');
    expect(classifyCommand('Npm Run DEV').waitClass).toBe('server');
  });

  it('resolveWaitBudget honors shorter explicit timeouts but caps at the class budget', () => {
    const long = classifyCommand('npm install');
    expect(resolveWaitBudget(long, undefined)).toBe(LONG_COMMAND_WAIT_BUDGET_MS);
    expect(resolveWaitBudget(long, 30000)).toBe(30000);
    expect(resolveWaitBudget(long, 60 * 60 * 1000)).toBe(LONG_COMMAND_WAIT_BUDGET_MS);

    const fallback = classifyCommand('echo hi');
    expect(resolveWaitBudget(fallback)).toBe(DEFAULT_COMMAND_WAIT_BUDGET_MS);
    expect(resolveWaitBudget(fallback, Number.NaN)).toBe(DEFAULT_COMMAND_WAIT_BUDGET_MS);
  });
});
