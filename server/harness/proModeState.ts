/**
 * SUTRA Studio — Pro Mode Long-Horizon Harness Engine
 *
 * Implements the 7-Phase Loop State APIs, Typed Structured Verification,
 * Iteration Checkpointing, and Escalation Supervisors (Stagnation & Oscillation).
 */
import fs from 'fs';
import path from 'path';
import { fsTools } from '../tools/fsTools.js';
import { ptyManager } from '../ptyManager.js';

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeNode[];
}

export interface FileTreeState {
  snapshotId: string;
  root: string;
  totalFiles: number;
  totalDirectories: number;
  tree: FileTreeNode[];
  timestamp: number;
}

export interface DiffState {
  diffId: string;
  path?: string;
  staged: boolean;
  rawDiff: string;
  filesChangedCount: number;
  files: Array<{
    path: string;
    insertions: number;
    deletions: number;
  }>;
  timestamp: number;
}

export interface TestStatusState {
  statusId: string;
  passed: boolean;
  total: number;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  failures: Array<{
    test: string;
    error: string;
  }>;
  rawOutput: string;
  timestamp: number;
}

export interface BuildStatusState {
  statusId: string;
  passed: boolean;
  typecheck: {
    passed: boolean;
    errorCount: number;
    errors: Array<{ file: string; line: number; message: string }>;
  };
  build: {
    passed: boolean;
    exitCode: number;
    errors: string[];
    output: string;
  };
  timestamp: number;
}

export interface LoopIterationRecord {
  checkpointId: string;
  taskId: string;
  iteration: number;
  phase: 'INSPECT' | 'HYPOTHESIZE' | 'PLAN' | 'ACT' | 'EXECUTE' | 'INTERPRET' | 'CHECKPOINT' | 'ESCALATE';
  hypothesis: string;
  action: string;
  result: {
    passed: boolean;
    summary: string;
    details?: any;
  };
  status: 'confirmed' | 'refuted' | 'inconclusive' | 'escalated' | 'completed';
  tags?: string[];
  timestamp: number;
}

export interface EscalationAssessment {
  escalate: boolean;
  reason?: 'stagnation' | 'oscillation' | 'verification_unavailable' | 'scope_ambiguity' | 'budget_exhausted';
  message?: string;
  consecutiveRefutedCount?: number;
  detectedOscillations?: string[];
}

export class ProModeEngine {
  private lastTestStatus: TestStatusState | null = null;
  private lastBuildStatus: BuildStatusState | null = null;
  private checkpoints: Map<string, LoopIterationRecord[]> = new Map();

  /**
   * 1. INSPECT: get_file_tree
   */
  public getFileTree(subDir?: string, maxDepth: number = 3): FileTreeState {
    const workspaceRoot = fsTools.getWorkspaceRoot();
    const targetDir = subDir ? path.resolve(workspaceRoot, subDir) : workspaceRoot;
    const snapshotId = `snap-tree-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    let fileCount = 0;
    let dirCount = 0;

    const buildNode = (currentDir: string, currentDepth: number): FileTreeNode[] => {
      if (currentDepth > maxDepth) return [];
      if (!fs.existsSync(currentDir)) return [];

      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      const nodes: FileTreeNode[] = [];

      for (const entry of entries) {
        if (['node_modules', '.git', 'dist', 'dist-server', '.sutra', '.gemini', 'coverage', '.cache'].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          dirCount++;
          const children = buildNode(fullPath, currentDepth + 1);
          nodes.push({
            name: entry.name,
            path: relPath,
            type: 'directory',
            children,
          });
        } else if (entry.isFile()) {
          fileCount++;
          let size = 0;
          try {
            size = fs.statSync(fullPath).size;
          } catch {}
          nodes.push({
            name: entry.name,
            path: relPath,
            type: 'file',
            size,
          });
        }
      }

      return nodes;
    };

    const tree = buildNode(targetDir, 1);

    return {
      snapshotId,
      root: path.relative(workspaceRoot, targetDir).replace(/\\/g, '/') || '.',
      totalFiles: fileCount,
      totalDirectories: dirCount,
      tree,
      timestamp: Date.now(),
    };
  }

  /**
   * 1. INSPECT: get_diff
   */
  public getDiff(filterPath?: string, staged: boolean = false): DiffState {
    const diffResult = fsTools.getGitDiff(filterPath, staged);
    const diffId = `snap-diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const rawDiff = diffResult?.diff || '';

    const files: Array<{ path: string; insertions: number; deletions: number }> = [];
    const diffBlocks = rawDiff.split(/^diff --git /m).filter(Boolean);

    for (const block of diffBlocks) {
      const match = block.match(/a\/(.+?)\s+b\/(.+)/);
      const filePath = match ? match[2].split('\n')[0].trim() : 'unknown';
      const insertions = (block.match(/^\+[^+]/gm) || []).length;
      const deletions = (block.match(/^-[^-]/gm) || []).length;
      files.push({ path: filePath, insertions, deletions });
    }

    return {
      diffId,
      path: filterPath,
      staged,
      rawDiff,
      filesChangedCount: files.length,
      files,
      timestamp: Date.now(),
    };
  }

  /**
   * 1. INSPECT / 5. EXECUTE: run_tests & get_test_status
   */
  public async runTests(testPath?: string): Promise<TestStatusState> {
    const statusId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const cmd = testPath ? `npx vitest run ${testPath}` : 'npm test';
    const startedAt = Date.now();

    const execResult = await ptyManager.executeCommand(cmd);
    const durationMs = Date.now() - startedAt;
    const output = typeof execResult === 'string' ? execResult : `${execResult?.stdout || ''}\n${execResult?.stderr || ''}`.trim();
    const exitCode = typeof execResult === 'object' && typeof execResult?.exitCode === 'number' ? execResult.exitCode : 0;

    // Parse Vitest / Jest outputs
    const passMatch = output.match(/(\d+)\s+passed/i);
    const failMatch = output.match(/(\d+)\s+failed/i);
    const totalMatch = output.match(/Tests\s+(\d+)\s+total/i) || output.match(/(\d+)\s+tests?/i);

    const passedCount = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failedCount = failMatch ? parseInt(failMatch[1], 10) : 0;
    const total = totalMatch ? parseInt(totalMatch[1], 10) : passedCount + failedCount;

    const failures: Array<{ test: string; error: string }> = [];
    const failureSections = output.split(/FAIL\s+/).slice(1);
    for (const sec of failureSections.slice(0, 10)) {
      const firstLine = sec.split('\n')[0].trim();
      const errSnippet = sec.slice(0, 300).trim();
      failures.push({ test: firstLine, error: errSnippet });
    }

    const state: TestStatusState = {
      statusId,
      passed: exitCode === 0 && failedCount === 0,
      total: total || (exitCode === 0 ? 1 : 0),
      passedCount: passedCount || (exitCode === 0 ? 1 : 0),
      failedCount: failedCount || (exitCode !== 0 ? 1 : 0),
      durationMs,
      failures,
      rawOutput: output.slice(-4000),
      timestamp: Date.now(),
    };

    this.lastTestStatus = state;
    return state;
  }

  public getTestStatus(): TestStatusState {
    if (this.lastTestStatus) return this.lastTestStatus;
    return {
      statusId: 'test-unrun',
      passed: false,
      total: 0,
      passedCount: 0,
      failedCount: 0,
      durationMs: 0,
      failures: [],
      rawOutput: 'No tests executed yet this session.',
      timestamp: Date.now(),
    };
  }

  /**
   * 1. INSPECT / 5. EXECUTE: check_types & run_build & get_build_status
   */
  public checkTypes(): BuildStatusState['typecheck'] {
    const tcResult = fsTools.typecheckProject();
    const passed = tcResult?.success ?? (tcResult?.errors?.length === 0);
    const rawErrors = tcResult?.errors || [];

    const errors: Array<{ file: string; line: number; message: string }> = [];
    for (const err of rawErrors) {
      if (typeof err === 'string') {
        const m = err.match(/(.+?)\((\d+),(\d+)\):\s*(.+)/);
        if (m) {
          errors.push({ file: m[1].trim(), line: parseInt(m[2], 10), message: m[4].trim() });
        } else {
          errors.push({ file: 'unknown', line: 1, message: err });
        }
      } else if (err && typeof err === 'object') {
        const anyErr = err as any;
        errors.push({
          file: anyErr.file || 'unknown',
          line: anyErr.line || 1,
          message: anyErr.message || JSON.stringify(err),
        });
      }
    }

    return {
      passed,
      errorCount: errors.length,
      errors: errors.slice(0, 20),
    };
  }

  public async runBuild(): Promise<BuildStatusState> {
    const statusId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const typecheck = this.checkTypes();

    const buildExec = await ptyManager.executeCommand('npm run build');
    const output = typeof buildExec === 'string' ? buildExec : `${buildExec?.stdout || ''}\n${buildExec?.stderr || ''}`.trim();
    const exitCode = typeof buildExec === 'object' && typeof buildExec?.exitCode === 'number' ? buildExec.exitCode : 0;

    const buildPassed = exitCode === 0;
    const errors: string[] = [];
    if (!buildPassed) {
      const lines = output.split('\n');
      for (const line of lines) {
        if (/error|failed|syntaxerror/i.test(line)) {
          errors.push(line.trim());
        }
      }
    }

    const state: BuildStatusState = {
      statusId,
      passed: typecheck.passed && buildPassed,
      typecheck,
      build: {
        passed: buildPassed,
        exitCode,
        errors: errors.slice(0, 10),
        output: output.slice(-4000),
      },
      timestamp: Date.now(),
    };

    this.lastBuildStatus = state;
    return state;
  }

  public getBuildStatus(forceRefresh: boolean = false): BuildStatusState {
    if (this.lastBuildStatus && !forceRefresh) return this.lastBuildStatus;
    const typecheck = forceRefresh ? this.checkTypes() : { passed: true, errorCount: 0, errors: [] };
    return {
      statusId: 'build-snapshot',
      passed: typecheck.passed,
      typecheck,
      build: {
        passed: true,
        exitCode: 0,
        errors: [],
        output: 'Build snapshot available. Call run_build() or check_types() to re-verify.',
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 7. CHECKPOINT: record loop iteration outcome to durable memory
   */
  public checkpointIteration(params: {
    taskId: string;
    iteration: number;
    phase?: LoopIterationRecord['phase'];
    hypothesis: string;
    action: string;
    result: { passed: boolean; summary: string; details?: any };
    status: LoopIterationRecord['status'];
    tags?: string[];
  }): LoopIterationRecord {
    const checkpointId = `chk-${params.taskId}-${params.iteration}-${Date.now()}`;
    const record: LoopIterationRecord = {
      checkpointId,
      taskId: params.taskId,
      iteration: params.iteration,
      phase: params.phase || 'CHECKPOINT',
      hypothesis: params.hypothesis,
      action: params.action,
      result: params.result,
      status: params.status,
      tags: params.tags || [],
      timestamp: Date.now(),
    };

    const list = this.checkpoints.get(params.taskId) || [];
    list.push(record);
    this.checkpoints.set(params.taskId, list);

    this.persistCheckpoints(params.taskId);

    return record;
  }

  public getCheckpoints(taskId: string): LoopIterationRecord[] {
    return this.checkpoints.get(taskId) || [];
  }

  /**
   * Escalation Supervisor: detects Stagnation and Oscillation
   */
  public assessEscalation(taskId: string, thresholdN: number = 3): EscalationAssessment {
    const list = this.checkpoints.get(taskId) || [];
    if (list.length < thresholdN) {
      return { escalate: false };
    }

    // 1. Stagnation check: N consecutive refuted or inconclusive outcomes without a new confirmed hypothesis
    const recent = list.slice(-thresholdN);
    const allRefutedOrInconclusive = recent.every((r) => r.status === 'refuted' || r.status === 'inconclusive');
    if (allRefutedOrInconclusive) {
      return {
        escalate: true,
        reason: 'stagnation',
        message: `Stagnation detected: ${thresholdN} consecutive iterations resulted in refuted/inconclusive outcomes without verification success. Escalating to supervisor for strategic intervention.`,
        consecutiveRefutedCount: thresholdN,
      };
    }

    // 2. Oscillation check: repeating actions or alternating hypotheses
    const actionSignatures = list.slice(-4).map((r) => `${r.action}:${r.hypothesis}`);
    const hasRepeats = new Set(actionSignatures).size < actionSignatures.length - 1;
    if (hasRepeats && list.length >= 4) {
      return {
        escalate: true,
        reason: 'oscillation',
        message: `Oscillation detected: actions or hypotheses are repeating across iterations without convergence. Escalating to supervisor.`,
        detectedOscillations: actionSignatures,
      };
    }

    return { escalate: false };
  }

  private persistCheckpoints(taskId: string): void {
    try {
      const sutraDir = path.join(fsTools.getWorkspaceRoot(), '.sutra');
      if (!fs.existsSync(sutraDir)) {
        fs.mkdirSync(sutraDir, { recursive: true });
      }
      const storageFile = path.join(sutraDir, 'pro_mode_checkpoints.json');
      const data: Record<string, LoopIterationRecord[]> = {};
      for (const [tId, records] of this.checkpoints.entries()) {
        data[tId] = records;
      }
      fs.writeFileSync(storageFile, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Best-effort storage persistence
    }
  }
}

export const proModeEngine = new ProModeEngine();
