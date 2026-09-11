import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AsyncFileMutex, fsTools } from '../../server/tools/fsTools.js';

describe('AsyncFileMutex & Atomic File Transactions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-mutex-test-'));
    fsTools.setWorkspaceRoot(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp dir cleanup errors
    }
  });

  it('atomically writes files without leaving orphan temp files', () => {
    const target = path.join(tempDir, 'atomic.txt');
    AsyncFileMutex.atomicWriteFileSync(target, 'hello world', 'utf-8');

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('hello world');

    const filesInDir = fs.readdirSync(tempDir);
    const tmpFiles = filesInDir.filter((f) => f.startsWith('.sutra_tmp_'));
    expect(tmpFiles.length).toBe(0);
  });

  it('queues concurrent async writes sequentially via runWithLock without race conditions', async () => {
    const target = path.join(tempDir, 'concurrent.txt');
    const executionOrder: number[] = [];

    const p1 = AsyncFileMutex.runWithLock(target, async () => {
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push(1);
      fs.writeFileSync(target, 'write 1', 'utf-8');
    });

    const p2 = AsyncFileMutex.runWithLock(target, async () => {
      await new Promise((r) => setTimeout(r, 10));
      executionOrder.push(2);
      fs.writeFileSync(target, 'write 2', 'utf-8');
    });

    const p3 = AsyncFileMutex.runWithLock(target, async () => {
      executionOrder.push(3);
      fs.writeFileSync(target, 'write 3', 'utf-8');
    });

    await Promise.all([p1, p2, p3]);

    expect(executionOrder).toEqual([1, 2, 3]);
    expect(fs.readFileSync(target, 'utf-8')).toBe('write 3');
  });

  it('handles editFile cleanly via fsTools with atomic write staging', () => {
    fsTools.writeFile('app.js', 'const x = 1;\nconst y = 2;\n');
    const res = fsTools.editFile('app.js', 'const y = 2;', 'const y = 42;');

    expect(res.success).toBe(true);
    const content = fsTools.readFile('app.js').content;
    expect(content).toContain('const y = 42;');
  });
});
