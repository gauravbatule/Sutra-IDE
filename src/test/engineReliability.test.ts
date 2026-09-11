import { describe, it, expect } from 'vitest';
import { InlineDiffEngine } from '../../server/tools/inlineDiffEngine';
import { areMemoriesSimilar } from '../../server/harness/memory';
import { TaskWatchdog } from '../../server/harness/taskWatchdog';
import { fsTools } from '../../server/tools/fsTools';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Engine Reliability & Invariant Hardening', () => {
  describe('InlineDiffEngine Multi-line Additions', () => {
    const diffEngine = new InlineDiffEngine();

    it('should accurately calculate startLine and endLine for multi-line additions without squashing', () => {
      const oldCode = `line 1
line 2
line 3`;

      const newCode = `line 1
added line A
added line B
added line C
line 2
line 3`;

      const diff = diffEngine.generateDiff('test.ts', oldCode, newCode);
      const decorations = diffEngine.generateMonacoDecorations(diff);

      expect(decorations.additions.length).toBe(1);
      const addition = decorations.additions[0];

      // Added lines are at new line numbers 2, 3, 4
      expect(addition.startLine).toBe(2);
      expect(addition.endLine).toBe(4);
      expect(addition.content).toContain('added line A\nadded line B\nadded line C');
    });

    it('should correctly handle removals and additions simultaneously', () => {
      const oldCode = `const a = 1;
const b = 2;
const c = 3;`;

      const newCode = `const a = 1;
const b = 200;
const b2 = 201;
const c = 3;`;

      const diff = diffEngine.generateDiff('test.ts', oldCode, newCode);
      const decorations = diffEngine.generateMonacoDecorations(diff);

      expect(decorations.additions.length).toBeGreaterThan(0);
      expect(decorations.deletions.length).toBeGreaterThan(0);

      const addition = decorations.additions[0];
      expect(addition.startLine).toBe(2);
      expect(addition.endLine).toBe(3);
    });
  });

  describe('Memory Polarity & Similarity Invariants', () => {
    it('should NOT treat contradictory directives as similar memories', () => {
      const affirmative = 'Always run tests before committing code';
      const negative = 'Never run tests before committing code';

      expect(areMemoriesSimilar(affirmative, negative)).toBe(false);
    });

    it('should recognize truly similar memories with slight phrasing differences', () => {
      const mem1 = 'Always use const instead of let for variables that are not reassigned';
      const mem2 = 'Always use const rather than let for variables that are not reassigned';

      expect(areMemoriesSimilar(mem1, mem2)).toBe(true);
    });
  });

  describe('TaskWatchdog Daemon Protection', () => {
    it('should not set a stall timer for long-running daemon processes', () => {
      const watchdog = new TaskWatchdog();
      const mockProc: any = {
        pid: 12345,
        on: () => {},
        kill: () => {},
      };

      watchdog.trackProcess('daemon-task-1', mockProc, {
        command: 'npm run dev',
        isDaemon: true,
        maxStallMs: 1000,
      });

      const active = (watchdog as any).activeTasks.get('daemon-task-1');
      expect(active).toBeDefined();
      expect(active.isDaemon).toBe(true);
      expect(active.stallTimer).toBeNull();
      expect(active.hardTimer).toBeNull();

      watchdog.untrack('daemon-task-1');
    });

    it('should set a stall timer for standard non-daemon commands', () => {
      const watchdog = new TaskWatchdog();
      const mockProc: any = {
        pid: 12346,
        on: () => {},
        kill: () => {},
      };

      watchdog.trackProcess('cli-task-1', mockProc, {
        command: 'npm test',
        isDaemon: false,
        maxStallMs: 5000,
      });

      const active = (watchdog as any).activeTasks.get('cli-task-1');
      expect(active).toBeDefined();
      expect(active.isDaemon).toBe(false);
      expect(active.stallTimer).not.toBeNull();

      watchdog.untrack('cli-task-1');
    });
  });

  describe('fsTools formatCode Safety', () => {
    it('should report failure when formatting a file with broken syntax', () => {
      const workspace = fsTools.getWorkspaceRoot();
      const brokenFileName = `temp-broken-${Date.now()}.js`;
      const brokenFilePath = path.join(workspace, brokenFileName);
      fs.writeFileSync(brokenFilePath, 'const x = ;;; {{{ broken syntax !!@#$');

      try {
        const res = fsTools.formatCode(brokenFileName);
        expect(res.success).toBe(false);
        expect(res.message.toLowerCase()).toContain('fail');
      } finally {
        if (fs.existsSync(brokenFilePath)) {
          try { fs.unlinkSync(brokenFilePath); } catch {}
        }
      }
    }, 15000);
  });
});
