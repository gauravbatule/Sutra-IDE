import { describe, it, expect } from 'vitest';
import {
  scheduleToolBatch,
  executeToolBatchWithScheduler,
  isPackageInstallCommand,
  resolveTaskDAG,
  executeDAGBatch,
  ToolCallItem,
  DAGTaskItem
} from '../../server/harness/toolExecutionScheduler.js';

describe('toolExecutionScheduler', () => {
  it('identifies package manager install commands', () => {
    expect(isPackageInstallCommand('npm install lucide-react')).toBe(true);
    expect(isPackageInstallCommand('pnpm i zustand')).toBe(true);
    expect(isPackageInstallCommand('pip install flask')).toBe(true);
    expect(isPackageInstallCommand('cargo build')).toBe(true);
    expect(isPackageInstallCommand('node server.js')).toBe(false);
    expect(isPackageInstallCommand('git status')).toBe(false);
  });

  it('correctly stages tools into ordered execution tiers', () => {
    const tools: ToolCallItem[] = [
      { id: '1', tool: 'run_unit_tests', params: {} },
      { id: '2', tool: 'read_file', params: { path: 'src/App.tsx' } },
      { id: '3', tool: 'create_directory', params: { path: 'src/components' } },
      { id: '4', tool: 'write_file', params: { path: 'src/components/Card.tsx', content: '// card' } },
      { id: '5', tool: 'grep_search', params: { query: 'Button' } },
      { id: '6', tool: 'run_command', params: { command: 'npm install' } },
    ];

    const plan = scheduleToolBatch(tools);

    expect(plan.length).toBe(5);
    expect(plan[0].tier).toBe('TIER_1_STRUCTURE_AND_CHECKPOINTS');
    expect(plan[0].toolCalls.map((t: any) => t.id)).toEqual(['3']);

    expect(plan[1].tier).toBe('TIER_2_PARALLEL_READS_AND_SEARCHES');
    expect(plan[1].toolCalls.map((t: any) => t.id)).toEqual(['2', '5']);

    expect(plan[2].tier).toBe('TIER_3_FILE_MUTATIONS');
    expect(plan[2].toolCalls.map((t: any) => t.id)).toEqual(['4']);

    expect(plan[3].tier).toBe('TIER_4_PACKAGE_INSTALLATIONS');
    expect(plan[3].toolCalls.map((t: any) => t.id)).toEqual(['6']);

    expect(plan[4].tier).toBe('TIER_5_VERIFICATION_AND_SYSTEM_COMMANDS');
    expect(plan[4].toolCalls.map((t: any) => t.id)).toEqual(['1']);
  });

  it('executes independent reads in parallel and same-file edits in sequential order', async () => {
    const executionOrder: string[] = [];

    const tools: ToolCallItem[] = [
      { id: 'r1', tool: 'read_file', params: { path: 'file1.ts' } },
      { id: 'r2', tool: 'read_file', params: { path: 'file2.ts' } },
      { id: 'w1', tool: 'edit_file', params: { path: 'main.ts', target: 'a', replacement: 'b' } },
      { id: 'w2', tool: 'edit_file', params: { path: 'main.ts', target: 'b', replacement: 'c' } },
      { id: 't1', tool: 'typecheck_project', params: {} },
    ];

    const executeSingle = async (call: ToolCallItem) => {
      executionOrder.push(`start:${call.id}`);
      await new Promise(r => setTimeout(r, 10));
      executionOrder.push(`end:${call.id}`);
      return { success: true, id: call.id };
    };

    const results = await executeToolBatchWithScheduler(tools, executeSingle);

    expect(results.length).toBe(5);
    expect(results[0].toolCall.id).toBe('r1');
    expect(results[1].toolCall.id).toBe('r2');
    expect(results[2].toolCall.id).toBe('w1');
    expect(results[3].toolCall.id).toBe('w2');
    expect(results[4].toolCall.id).toBe('t1');

    // Reads (r1, r2) must start before mutations (w1, w2)
    const startR1 = executionOrder.indexOf('start:r1');
    const startR2 = executionOrder.indexOf('start:r2');
    const startW1 = executionOrder.indexOf('start:w1');
    const startW2 = executionOrder.indexOf('start:w2');
    const startT1 = executionOrder.indexOf('start:t1');

    expect(startR1).toBeLessThan(startW1);
    expect(startR2).toBeLessThan(startW1);
    // w1 must complete before w2 starts for the SAME file
    const endW1 = executionOrder.indexOf('end:w1');
    expect(endW1).toBeLessThan(startW2);
    // Mutations must end before typecheck (t1) starts
    const endW2 = executionOrder.indexOf('end:w2');
    expect(endW2).toBeLessThan(startT1);
  });

  it('serializes mutations on the same file even when using parameter aliases (filePath vs targetFile)', async () => {
    const order: string[] = [];
    const tools: ToolCallItem[] = [
      { id: 'm1', tool: 'write_file', params: { targetFile: 'src/index.ts', content: 'v1' } },
      { id: 'm2', tool: 'edit_file', params: { filePath: 'src/index.ts', target: 'v1', replacement: 'v2' } },
      { id: 'm3', tool: 'edit_file', params: { path: 'src/index.ts', target: 'v2', replacement: 'v3' } },
    ];

    const executeSingle = async (call: ToolCallItem) => {
      order.push(`start:${call.id}`);
      await new Promise(r => setTimeout(r, 10));
      order.push(`end:${call.id}`);
      return { success: true, id: call.id };
    };

    await executeToolBatchWithScheduler(tools, executeSingle);

    expect(order.indexOf('end:m1')).toBeLessThan(order.indexOf('start:m2'));
    expect(order.indexOf('end:m2')).toBeLessThan(order.indexOf('start:m3'));
  });

  describe('DAG Resolution and Kahn Topological Sort', () => {
    it('resolves acyclic task dependencies into topological order and parallel waves', () => {
      const tasks: DAGTaskItem[] = [
        { id: 'A' },
        { id: 'B', dependsOn: ['A'] },
        { id: 'C', dependsOn: ['A'] },
        { id: 'D', dependsOn: ['B', 'C'] },
        { id: 'E' },
      ];

      const dag = resolveTaskDAG(tasks);
      expect(dag.isAcyclic).toBe(true);
      expect(dag.topologicalOrder.map((t) => t.id)).toHaveLength(5);

      // Wave 0: A and E have in-degree 0
      expect(dag.executionWaves[0].map((t) => t.id).sort()).toEqual(['A', 'E'].sort());
      // Wave 1: B and C depend only on A
      expect(dag.executionWaves[1].map((t) => t.id).sort()).toEqual(['B', 'C'].sort());
      // Wave 2: D depends on B and C
      expect(dag.executionWaves[2].map((t) => t.id)).toEqual(['D']);
      expect(dag.criticalPathLength).toBe(3);
    });

    it('detects cycles in DAG and reports cycle path', () => {
      const cyclicTasks: DAGTaskItem[] = [
        { id: '1', dependsOn: ['3'] },
        { id: '2', dependsOn: ['1'] },
        { id: '3', dependsOn: ['2'] },
        { id: '4' },
      ];

      const dag = resolveTaskDAG(cyclicTasks);
      expect(dag.isAcyclic).toBe(false);
      expect(dag.cyclePath).toBeDefined();
      expect(dag.cyclePath!.length).toBeGreaterThan(0);
    });

    it('executes DAG tasks wave-by-wave with concurrency', async () => {
      const tasks: DAGTaskItem[] = [
        { id: 'fetch-schema' },
        { id: 'gen-types', dependsOn: ['fetch-schema'] },
        { id: 'gen-client', dependsOn: ['fetch-schema'] },
        { id: 'build-app', dependsOn: ['gen-types', 'gen-client'] },
      ];

      const order: string[] = [];
      const executor = async (task: DAGTaskItem) => {
        order.push(task.id);
        return { done: true, id: task.id };
      };

      const results = await executeDAGBatch(tasks, executor);
      expect(results).toHaveLength(4);
      expect(order[0]).toBe('fetch-schema');
      expect(order.indexOf('gen-types')).toBeLessThan(order.indexOf('build-app'));
      expect(order.indexOf('gen-client')).toBeLessThan(order.indexOf('build-app'));
    });
  });
});

