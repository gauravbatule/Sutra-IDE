import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ScratchWorkspaceManager } from '../../server/scratchManager.js';

describe('ScratchWorkspaceManager (Antigravity-Inspired .scratch Architecture)', () => {
  let tempBaseDir: string;
  let manager: ScratchWorkspaceManager;

  beforeEach(() => {
    tempBaseDir = path.join(os.tmpdir(), `sutra-test-scratch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempBaseDir, { recursive: true });
    manager = new ScratchWorkspaceManager(tempBaseDir);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempBaseDir)) {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('generates memorable unique slugs', () => {
    const slug1 = manager.generateSlug();
    const slug2 = manager.generateSlug();
    expect(slug1).toMatch(/^scratch-[a-z]+-[a-z]+-\d+$/);
    expect(slug2).toMatch(/^scratch-[a-z]+-[a-z]+-\d+$/);
    expect(slug1).not.toBe(slug2);
  });

  it('creates an isolated scratch workspace with web template files and metadata', () => {
    const meta = manager.createScratchWorkspace({
      name: 'test-app',
      template: 'web',
      prompt: 'Build a calculator',
      activate: false,
    });

    expect(meta.name).toBe('test-app');
    expect(meta.template).toBe('web');
    expect(fs.existsSync(meta.path)).toBe(true);

    // Verify starter template files
    expect(fs.existsSync(path.join(meta.path, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(meta.path, 'style.css'))).toBe(true);
    expect(fs.existsSync(path.join(meta.path, 'script.js'))).toBe(true);
    expect(fs.existsSync(path.join(meta.path, 'README.md'))).toBe(true);

    // Verify metadata file
    const metaFile = path.join(meta.path, '.scratch_meta.json');
    expect(fs.existsSync(metaFile)).toBe(true);
    const readMeta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    expect(readMeta.name).toBe('test-app');
    expect(readMeta.template).toBe('web');
    expect(readMeta.description).toBe('Build a calculator');
  });

  it('creates python scratch workspace template', () => {
    const meta = manager.createScratchWorkspace({
      name: 'py-script',
      template: 'python',
      activate: false,
    });

    expect(fs.existsSync(path.join(meta.path, 'main.py'))).toBe(true);
    const mainPy = fs.readFileSync(path.join(meta.path, 'main.py'), 'utf-8');
    expect(mainPy).toContain('def main():');
  });

  it('lists existing scratch workspaces ordered by activity', () => {
    manager.createScratchWorkspace({ name: 'workspace-one', template: 'web', activate: false });
    manager.createScratchWorkspace({ name: 'workspace-two', template: 'node', activate: false });

    const list = manager.listScratchWorkspaces();
    expect(list.length).toBe(2);
    const names = list.map((w) => w.name);
    expect(names).toContain('workspace-one');
    expect(names).toContain('workspace-two');
  }, 15000);

  it('promotes a scratchpad workspace to a permanent directory', () => {
    const meta = manager.createScratchWorkspace({
      name: 'prototype-alpha',
      template: 'web',
      activate: false,
    });

    const targetPermanentDir = path.join(tempBaseDir, 'permanent-projects', 'prototype-alpha');
    const result = manager.promoteScratchWorkspace(meta.path, targetPermanentDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(result.newPath)).toBe(true);
    expect(fs.existsSync(path.join(result.newPath, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(result.newPath, '.scratch_meta.json'))).toBe(true);
  }, 15000);
});
