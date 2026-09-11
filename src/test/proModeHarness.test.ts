import { describe, it, expect } from 'vitest';
import { buildMasterSystemPrompt, buildProModeContract } from '../../server/harness/agentPromptArchitecture.js';
import { proModeEngine } from '../../server/harness/proModeState.js';
import { SUTRA_TOOLS } from '../../server/modelRouter.js';

describe('SUTRA Studio — Pro Mode Long-Horizon Autonomous Coding Harness', () => {
  describe('1. Pro Mode Prompt Architecture & Contract Invariants', () => {
    it('generates the verbatim 7-phase loop contract in Pro Mode', () => {
      const contract = buildProModeContract('SUTRA IDE');
      expect(contract).toContain('Pro Mode — Agent System Prompt');
      expect(contract).toContain('1. **INSPECT**');
      expect(contract).toContain('2. **HYPOTHESIZE**');
      expect(contract).toContain('3. **PLAN**');
      expect(contract).toContain('4. **ACT**');
      expect(contract).toContain('5. **EXECUTE / VERIFY**');
      expect(contract).toContain('6. **INTERPRET**');
      expect(contract).toContain('7. **CHECKPOINT**');
    });

    it('enforces all non-negotiable hard rules in the contract', () => {
      const contract = buildProModeContract('SUTRA IDE');
      expect(contract).toContain('Never mark a task, subtask, or todo complete without a structured pass result');
      expect(contract).toContain('Never fabricate a tool result');
      expect(contract).toContain('No silent scope expansion');
      expect(contract).toContain('No fallback-as-fix');
      expect(contract).toContain('One hypothesis, one test, one iteration');
    });

    it('defines explicit escalation conditions to stop runaway loops', () => {
      const contract = buildProModeContract('SUTRA IDE');
      expect(contract).toContain('Stagnation');
      expect(contract).toContain('Oscillation');
      expect(contract).toContain('Verification unavailable');
      expect(contract).toContain('Scope ambiguity');
      expect(contract).toContain('Budget');
    });

    it('assembles the Pro Mode contract into master system prompt when harnessMode is pro', () => {
      const prompt = buildMasterSystemPrompt({
        workspaceRoot: 'C:/mock/workspace',
        harnessMode: 'pro',
      });
      expect(prompt).toContain('Pro Mode — Agent System Prompt');
      expect(prompt).toContain('get_file_tree()');
      expect(prompt).toContain('get_diff()');
    });
  });

  describe('2. Harness State APIs (Phase 1 INSPECT)', () => {
    it('getFileTree returns typed file counts and snapshot IDs', () => {
      const tree = proModeEngine.getFileTree(undefined, 2);
      expect(tree.snapshotId).toBeDefined();
      expect(typeof tree.totalFiles).toBe('number');
      expect(typeof tree.totalDirectories).toBe('number');
      expect(Array.isArray(tree.tree)).toBe(true);
    });

    it('getDiff returns structured diff metadata with file breakdown', () => {
      const diffState = proModeEngine.getDiff();
      expect(diffState.diffId).toBeDefined();
      expect(typeof diffState.filesChangedCount).toBe('number');
      expect(Array.isArray(diffState.files)).toBe(true);
    });

    it('getTestStatus and getBuildStatus return structured snapshots', () => {
      const testStatus = proModeEngine.getTestStatus();
      expect(testStatus.statusId).toBeDefined();
      expect(typeof testStatus.passed).toBe('boolean');

      const buildStatus = proModeEngine.getBuildStatus();
      expect(buildStatus.statusId).toBeDefined();
      expect(typeof buildStatus.passed).toBe('boolean');
      expect(buildStatus.typecheck).toBeDefined();
    });
  });

  describe('3. Iteration Checkpointing & Supervisor Escalation (Phase 7)', () => {
    const taskId = `test-task-${Date.now()}`;

    it('records typed loop iteration checkpoints to persistent memory', () => {
      const record = proModeEngine.checkpointIteration({
        taskId,
        iteration: 1,
        phase: 'EXECUTE',
        hypothesis: 'Fixing typo in helper function will make unit test pass.',
        action: 'edit_file(src/helper.ts)',
        result: { passed: false, summary: 'Test failed with syntax error.' },
        status: 'refuted',
        tags: ['bugfix', 'unit-test'],
      });

      expect(record.checkpointId).toBeDefined();
      expect(record.iteration).toBe(1);
      expect(record.status).toBe('refuted');

      const all = proModeEngine.getCheckpoints(taskId);
      expect(all.length).toBeGreaterThanOrEqual(1);
      expect(all[all.length - 1].hypothesis).toBe('Fixing typo in helper function will make unit test pass.');
    });

    it('detects stagnation after 3 consecutive refuted/inconclusive outcomes', () => {
      const stagTaskId = `stag-task-${Date.now()}`;

      proModeEngine.checkpointIteration({
        taskId: stagTaskId,
        iteration: 1,
        hypothesis: 'Attempt 1',
        action: 'edit 1',
        result: { passed: false, summary: 'Fail 1' },
        status: 'refuted',
      });

      expect(proModeEngine.assessEscalation(stagTaskId, 3).escalate).toBe(false);

      proModeEngine.checkpointIteration({
        taskId: stagTaskId,
        iteration: 2,
        hypothesis: 'Attempt 2',
        action: 'edit 2',
        result: { passed: false, summary: 'Fail 2' },
        status: 'inconclusive',
      });

      expect(proModeEngine.assessEscalation(stagTaskId, 3).escalate).toBe(false);

      proModeEngine.checkpointIteration({
        taskId: stagTaskId,
        iteration: 3,
        hypothesis: 'Attempt 3',
        action: 'edit 3',
        result: { passed: false, summary: 'Fail 3' },
        status: 'refuted',
      });

      const escalation = proModeEngine.assessEscalation(stagTaskId, 3);
      expect(escalation.escalate).toBe(true);
      expect(escalation.reason).toBe('stagnation');
      expect(escalation.message).toContain('Stagnation detected');
    });

    it('detects oscillation when actions/hypotheses repeat across iterations', () => {
      const oscTaskId = `osc-task-${Date.now()}`;

      for (let i = 1; i <= 4; i++) {
        proModeEngine.checkpointIteration({
          taskId: oscTaskId,
          iteration: i,
          hypothesis: i % 2 === 0 ? 'Hypothesis B' : 'Hypothesis A',
          action: i % 2 === 0 ? 'revert code' : 'apply code',
          result: { passed: false, summary: 'Oscillating' },
          status: 'refuted',
        });
      }

      const escalation = proModeEngine.assessEscalation(oscTaskId, 3);
      expect(escalation.escalate).toBe(true);
    });
  });

  describe('4. Tool Registry Verification', () => {
    it('registers all 9 Pro Mode harness tools in SUTRA_TOOLS', () => {
      const toolNames = SUTRA_TOOLS.map((t) => t.name);
      expect(toolNames).toContain('get_file_tree');
      expect(toolNames).toContain('get_diff');
      expect(toolNames).toContain('get_test_status');
      expect(toolNames).toContain('get_build_status');
      expect(toolNames).toContain('run_tests');
      expect(toolNames).toContain('check_types');
      expect(toolNames).toContain('run_build');
      expect(toolNames).toContain('checkpoint_loop_iteration');
      expect(toolNames).toContain('get_loop_checkpoints');
    });
  });
});
