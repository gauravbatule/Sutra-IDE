import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ReasonDiscoveryEngine } from '../../server/harness/reasonDiscovery.js';

describe('reasonDiscovery', () => {
  let tempDir: string;
  let engine: ReasonDiscoveryEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-reason-test-'));
    engine = new ReasonDiscoveryEngine(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('discovers module resolution rules from errors', () => {
    const rule = engine.analyzeFailure('Cannot find module ./foo');
    expect(rule).not.toBeNull();
    expect(rule?.category).toBe('module-resolution');
    expect(rule?.rule).toContain('.js file extensions');
  });

  it('discovers port binding rules', () => {
    const rule = engine.analyzeFailure('Error: listen EADDRINUSE: address already in use :::3001');
    expect(rule).not.toBeNull();
    expect(rule?.category).toBe('port-binding');
    expect(engine.getRules()).toHaveLength(1);
  });
});
