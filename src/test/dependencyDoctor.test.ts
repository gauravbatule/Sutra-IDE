import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DependencyDoctor } from '../../server/harness/dependencyDoctor.js';

describe('Proactive Dependency Doctor & Phantom Module Resolver', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-dep-doctor-'));
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0',
          '@radix-ui/react-dialog': '^1.0.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
          vitest: '^1.0.0',
        },
      }),
      'utf-8'
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp dir cleanup errors
    }
  });

  it('correctly extracts third-party package names and ignores builtins & local files', () => {
    const code = `
      import React, { useState } from 'react';
      import * as fs from 'fs';
      import path from 'path';
      import { Dialog } from '@radix-ui/react-dialog';
      import { motion } from 'framer-motion';
      import { Header } from './components/Header';
      import { util } from '@/lib/utils';
      const confetti = require('canvas-confetti');
    `;

    const pkgs = DependencyDoctor.extractImportedPackages(code);
    expect(pkgs).toContain('react');
    expect(pkgs).toContain('@radix-ui/react-dialog');
    expect(pkgs).toContain('framer-motion');
    expect(pkgs).toContain('canvas-confetti');

    expect(pkgs).not.toContain('fs');
    expect(pkgs).not.toContain('path');
    expect(pkgs).not.toContain('./components/Header');
    expect(pkgs).not.toContain('@/lib/utils');
  });

  it('detects missing packages when code imports uninstalled libraries', () => {
    const code = `
      import { motion } from 'framer-motion';
      import { create } from 'zustand';
      import React from 'react';
    `;

    const res = DependencyDoctor.checkMissingDependencies(tempDir, 'src/App.tsx', code);
    expect(res.hasMissing).toBe(true);
    expect(res.missingDependencies).toContain('framer-motion');
    expect(res.missingDependencies).toContain('zustand');
    expect(res.missingDependencies).not.toContain('react');
    expect(res.warning).toContain('Phantom dependency alert');
  });

  it('returns clean when all imported packages are present in package.json', () => {
    const code = `
      import React from 'react';
      import * as Dialog from '@radix-ui/react-dialog';
    `;

    const res = DependencyDoctor.checkMissingDependencies(tempDir, 'src/Modal.tsx', code);
    expect(res.hasMissing).toBe(false);
    expect(res.missingDependencies.length).toBe(0);
  });
});
