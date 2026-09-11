import { SubagentRole, SubagentState, ToolCallPayload, PermissionLevel, SwarmTaskMilestone } from './types.js';
import { fsTools } from './tools/fsTools.js';
import { ptyManager } from './ptyManager.js';
import { mediaEngine } from './mediaEngine.js';
import { modelRouter } from './modelRouter.js';
import { captureArtifact } from './artifacts.js';
import { saveCodeNote } from './harness/codeNotes.js';
import { processManager } from './processManager.js';
import { SecurityGuardrails } from './security/guardrails.js';
import { avoEngine } from './harness/avoEngine.js';
import { gitCheckpoints } from './harness/gitCheckpoints.js';
import { inspectWebPage } from './tools/webPageInspector.js';
import { codebaseIndexer } from './tools/codebaseIndexer.js';
import { hypothesisEngine } from './harness/hypothesisEngine.js';
import { hardwareLoopVerifier } from './harness/hardwareLoopVerifier.js';
import { ReasonDiscoveryEngine } from './harness/reasonDiscovery.js';
import { versionCommitment } from './harness/versionCommitment.js';
import { taskWatchdog } from './harness/taskWatchdog.js';
import { proModeEngine } from './harness/proModeState.js';
import { scratchManager } from './scratchManager.js';
import net from 'net';
import dns from 'dns';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const BACKGROUND_LOG_CAP_BYTES = 50 * 1024;
const BACKGROUND_OUTPUT_TAIL_BYTES = 4 * 1024;
const MAX_TRACKED_BACKGROUND_TASKS = 200;
const FINISHED_TASK_RETENTION_MS = 30 * 60 * 1000;

// -------------------------------------------------------------------------
// Per-run read tracking — grounds mutations in files the run actually saw
// -------------------------------------------------------------------------

/** Tracks which files a single agent run has observed via read/search tools. */
export interface ReadTracker {
  markRead(path: string): void;
  wasRead(path: string): boolean;
  readPaths(): string[];
}

/**
 * Windows-safe path key for grounding comparisons: backslashes become forward
 * slashes and case is folded so "Src\App.tsx" and "src/app.tsx" match.
 */
export const normalizePathForTracking = (p: string): string =>
  String(p ?? '').replace(/\\/g, '/').trim().toLowerCase();

/** Creates a fresh, empty read tracker (one per agent run). */
export const createReadTracker = (): ReadTracker => {
  const paths = new Set<string>();
  return {
    markRead(path: string): void {
      const normalized = normalizePathForTracking(path);
      if (normalized) paths.add(normalized);
    },
    wasRead(path: string): boolean {
      return paths.has(normalizePathForTracking(path));
    },
    readPaths(): string[] {
      return Array.from(paths);
    },
  };
};

/** Honest note attached when a mutation auto-read its target because the run had never seen it. */
export const AUTO_READ_GROUNDED_NOTE =
  'auto-read before this change — file had not been read earlier this run';

/** How many lines of real file content accompany an anchor-mismatch edit failure. */
const GROUNDED_EDIT_PREVIEW_LINES = 80;

// -------------------------------------------------------------------------
// Command classification — type-aware wait budgets for foreground run_command
// -------------------------------------------------------------------------

export type CommandWaitClass = 'long' | 'server' | 'default';

/** Wait budget for installs/builds/test suites/docker/etc. */
export const LONG_COMMAND_WAIT_BUDGET_MS = 10 * 60 * 1000;
/** Wait budget for ordinary one-shot commands. */
export const DEFAULT_COMMAND_WAIT_BUDGET_MS = 2 * 60 * 1000;

export interface CommandClassification {
  waitClass: CommandWaitClass;
  /** Wait budget in ms implied by the class. */
  budgetMs: number;
  /** Human-readable pattern that matched ('' for the default class). */
  matched: string;
}

/**
 * Server/watcher intents NEVER block a foreground wait: they are auto-promoted
 * to the background registry. Ordered list, first match wins.
 */
const SERVER_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|serve|server|start|watch)\b/, 'package-manager dev/serve/start/watch script'],
  [/\bnext\s+(?:dev|start)\b/, 'next dev/start'],
  [/\bvite\b(?!\s+(?:build|optimize))\b/, 'vite dev/preview server'],
  [/\bnodemon\b/, 'nodemon watcher'],
  [/\btsx\s+watch\b/, 'tsx watch'],
  [/\bts-node-dev\b/, 'ts-node-dev watcher'],
  [/\btsc\b[^&|;]*(?:^|\s)--watch\b/, 'tsc --watch'],
  [/\bwebpack(?:-dev-server)?\s+(?:serve|dev-server)\b|\bwebpack-dev-server\b/, 'webpack dev server'],
  [/\bpython3?\s+-m\s+http\.server\b/, 'python http.server'],
  [/\buvicorn\b/, 'uvicorn server'],
  [/\bgunicorn\b/, 'gunicorn server'],
  [/\bflask\s+run\b/, 'flask run'],
  [/\bnpx\s+serve\b/, 'npx serve'],
  [/\bhttps?-server\b|\blive-server\b|\bjson-server\b/, 'static/json file server'],
];

/**
 * Long-running but finite commands get an extended foreground budget instead of
 * being killed at the default 2 minutes. Ordered list, first match wins.
 */
const LONG_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|update|upgrade|add)\b/, 'package install/ci/update'],
  [/\bpip3?\s+install\b|\bpipenv\s+install\b|\bpoetry\s+(?:install|add|update)\b/, 'python dependency install'],
  [/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:@.-]*(?:build|compile)[\w:@.-]*\b/, 'build/compile script'],
  [/\bcargo\s+(?:build|test|check)\b/, 'cargo build/test/check'],
  [/\bgo\s+(?:build|test)\b/, 'go build/test'],
  [/\bdotnet\s+build\b/, 'dotnet build'],
  [/\bdocker(?:-compose)?\b/, 'docker operation'],
  [/\bcmake\b|\bmake\b/, 'make/cmake build'],
  [/\bgradle(?:w)?\b/, 'gradle build'],
  [/\bmvn\b/, 'maven build'],
  [/\btsc\b/, 'typescript compile'],
  [/\beslint\b/, 'eslint lint run'],
  [/\bvitest\b|\bjest\b|\bmocha\b|\bpytest\b|\bplaywright\b|\bcypress\b/, 'test suite runner'],
  [/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b[\w:@.-]*/, 'package-manager test script'],
  [/\bvite\s+build\b|\bnext\s+(?:build|export)\b/, 'framework production build'],
];

/**
 * Pure, unit-testable classifier: inspects the command STRING ONLY (no env, no
 * I/O) and returns the wait class plus its budget.
 *
 * - 'server'  : never waits — caller auto-backgrounds it
 * - 'long'    : finite but slow — 10 minute budget
 * - 'default' : everything else — 2 minute budget
 */
export function classifyCommand(rawCommand: unknown): CommandClassification {
  // Lowercase + collapse whitespace so matching is shell-style agnostic.
  const cmd = String(rawCommand ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!cmd) {
    return { waitClass: 'default', budgetMs: DEFAULT_COMMAND_WAIT_BUDGET_MS, matched: '' };
  }
  for (const [pattern, label] of SERVER_PATTERNS) {
    if (pattern.test(cmd)) {
      return { waitClass: 'server', budgetMs: 0, matched: label };
    }
  }
  for (const [pattern, label] of LONG_PATTERNS) {
    if (pattern.test(cmd)) {
      return { waitClass: 'long', budgetMs: LONG_COMMAND_WAIT_BUDGET_MS, matched: label };
    }
  }
  return { waitClass: 'default', budgetMs: DEFAULT_COMMAND_WAIT_BUDGET_MS, matched: '' };
}

/**
 * Resolves the effective foreground wait budget: an explicit tool timeoutMs is
 * honored when shorter than the class budget, but can never exceed it — longer
 * waits must go through background:true + check_task_output.
 */
export function resolveWaitBudget(classification: CommandClassification, explicitTimeoutMs?: unknown): number {
  const explicit = Number(explicitTimeoutMs);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(explicit, classification.budgetMs);
  }
  return classification.budgetMs;
}

/** Shared append-only log state used by both background tasks and foreground runs. */
interface OutputLogState {
  logPieces: string[];
  logBytes: number;
}

/** Appends output to a ring-buffer log state, dropping the oldest pieces past ~capBytes. */
function appendToOutputLog(state: OutputLogState, chunk: Buffer | string, capBytes = BACKGROUND_LOG_CAP_BYTES): void {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  if (!text) return;
  state.logPieces.push(text);
  state.logBytes += Buffer.byteLength(text);
  while (state.logBytes > capBytes && state.logPieces.length > 1) {
    const oldest = state.logPieces.shift();
    if (oldest === undefined) break;
    state.logBytes -= Buffer.byteLength(oldest);
  }
}

/** Returns roughly the last `maxBytes` of accumulated output. */
function outputLogTail(state: OutputLogState, maxBytes = BACKGROUND_OUTPUT_TAIL_BYTES): string {
  let tail = '';
  for (let i = state.logPieces.length - 1; i >= 0; i--) {
    tail = state.logPieces[i] + tail;
    if (Buffer.byteLength(tail) >= maxBytes) break;
  }
  return Buffer.byteLength(tail) > maxBytes ? tail.slice(tail.length - maxBytes) : tail;
}

/** A run_command invocation started with background:true and tracked in-process. */
interface BackgroundTaskState extends OutputLogState {
  taskId: string;
  cmd: string;
  startedAt: number;
  proc: ChildProcess;
  done: boolean;
  exitCode: number | null;
  /** Set the moment completion or termination is observed. */
  finishedAt?: number;
}

function isValidHostname(host: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host) && host.length <= 253;
}

export class AgentSwarmOrchestrator {
  private subagents: Map<string, SubagentState> = new Map();
  private milestones: SwarmTaskMilestone[] = [];
  private permissionLevel: PermissionLevel = 'full'; // 'strict' gates every action; 'full' runs autonomously
  private pendingApprovals: Map<string, ToolCallPayload> = new Map();
  private backgroundTasks: Map<string, BackgroundTaskState> = new Map();
  private bgTaskCounter = 0;
  /** Files the current run has actually seen (read_file / search hits) — reset per run. */
  private readTracker: ReadTracker = createReadTracker();

  constructor() {
  }

  public getSubagentStates(): SubagentState[] {
    return Array.from(this.subagents.values());
  }

  /**
   * Clears all subagent state — called at the start of every fresh run so stale
   * specialists never linger. Live background processes from the previous run
   * are terminated here too so nothing leaks across runs.
   */
  public clearSubagents(): void {
    this.subagents.clear();
    this.milestones = [];
    this.readTracker = createReadTracker(); // grounding state is per-run, never carried across runs
    const killedLeftovers = this.killAllBackgroundTasks();
    if (killedLeftovers > 0) {
      console.warn(`[SUTRA] Terminated ${killedLeftovers} leftover background task(s) from the previous run.`);
    }
  }

  public setPermissionLevel(level: PermissionLevel | string | undefined): void {
    // Normalize legacy client values ('allow_all'/'auto' -> full, 'safe' -> strict)
    // so every entry point (WS prompt payload, REST endpoint) lands on one of the
    // two supported modes.
    if (level === 'strict' || level === 'safe') {
      this.permissionLevel = 'strict';
    } else {
      this.permissionLevel = 'full';
    }
  }

  public getPermissionLevel(): PermissionLevel {
    return this.permissionLevel;
  }

  // -------------------------------------------------------------------------
  // Background command execution (run_command with background:true)
  // -------------------------------------------------------------------------

  /** Appends output to a task's in-memory ring buffer, dropping the oldest pieces past ~50KB. */
  private appendBackgroundLog(task: BackgroundTaskState, chunk: Buffer | string): void {
    appendToOutputLog(task, chunk);
  }

  /** Returns roughly the last `maxBytes` of accumulated output. */
  private backgroundOutputTail(task: OutputLogState, maxBytes = BACKGROUND_OUTPUT_TAIL_BYTES): string {
    return outputLogTail(task, maxBytes);
  }

  /**
   * Keeps the registry bounded: finished tasks are forgotten after 30 minutes,
   * and a hard cap evicts oldest-finished entries first under spawn storms.
   */
  private pruneFinishedBackgroundTasks(): void {
    const now = Date.now();
    for (const [id, task] of this.backgroundTasks) {
      if (task.done && task.finishedAt !== undefined && now - task.finishedAt > FINISHED_TASK_RETENTION_MS) {
        this.backgroundTasks.delete(id);
      }
    }
    while (this.backgroundTasks.size > MAX_TRACKED_BACKGROUND_TASKS) {
      const oldestFinished = Array.from(this.backgroundTasks.entries())
        .filter(([, t]) => t.done)
        .sort((a, b) => (a[1].finishedAt ?? a[1].startedAt) - (b[1].finishedAt ?? b[1].startedAt))[0];
      if (!oldestFinished) break;
      this.backgroundTasks.delete(oldestFinished[0]);
    }
  }

  /**
   * Spawns a shell command without awaiting completion and registers it under
   * a compact `bg-<n>` taskId. stdout/stderr stream into a per-task ring
   * buffer; completion marks done + exitCode so check_task_output can report
   * it later.
   */
  private spawnBackgroundCommand(cmd: unknown, cwd?: unknown): {
    taskId: string;
    started: boolean;
    cmd: string;
    pid?: number;
    port?: number | null;
    url?: string;
    candidateUrl?: string;
    note?: string;
  } {
    const commandText = String(cmd || '').trim();
    if (!commandText) {
      throw new Error('run_command with background:true requires a command.');
    }

    const root = fsTools.getWorkspaceRoot();
    const safetyCheck = SecurityGuardrails.validateCommandSafety(commandText, root);
    if (!safetyCheck.safe) {
      throw new Error(safetyCheck.reason || 'Command blocked by security guardrails.');
    }

    this.bgTaskCounter += 1;
    const taskId = `bg-${this.bgTaskCounter}`;
    const resolvedCwd = cwd && String(cwd).trim()
      ? SecurityGuardrails.validateSafePath(String(cwd), root)
      : root;

    const proc = spawn(commandText, { shell: true, cwd: resolvedCwd, windowsHide: true });
    const detectedPort = processManager.detectPort(commandText);
    const task: BackgroundTaskState = {
      taskId,
      cmd: commandText,
      startedAt: Date.now(),
      proc,
      logPieces: [],
      logBytes: 0,
      done: false,
      exitCode: null,
    };
    this.backgroundTasks.set(taskId, task);
    this.pruneFinishedBackgroundTasks();

    // Register with processManager for live port tracking & recovery in Activity Panel
    try {
      const parts = commandText.split(/\s+/);
      processManager.register(parts[0], parts.slice(1), resolvedCwd, proc);
      taskWatchdog.trackProcess(taskId, proc, {
        command: commandText,
        cwd: resolvedCwd,
        maxStallMs: 60000,
        hardTimeoutMs: 600000,
        isDaemon: true,
      });
    } catch {
      // Best-effort registration
    }

    proc.stdout?.on('data', (chunk) => this.appendBackgroundLog(task, chunk as Buffer));
    proc.stderr?.on('data', (chunk) => this.appendBackgroundLog(task, chunk as Buffer));
    proc.on('error', (err) => {
      task.done = true;
      task.exitCode = task.exitCode ?? -1;
      task.finishedAt = Date.now();
      this.appendBackgroundLog(task, `[spawn error] ${err.message}`);
    });
    proc.on('close', (code) => {
      task.done = true;
      task.exitCode = code;
      task.finishedAt = Date.now();
    });

    return {
      taskId,
      started: true,
      cmd: commandText,
      pid: proc.pid,
      port: detectedPort,
      url: detectedPort ? `http://localhost:${detectedPort}` : undefined,
      candidateUrl: detectedPort ? `http://localhost:${detectedPort}` : undefined,
      note: detectedPort
        ? `Background server process initiated on candidate port ${detectedPort}. You MUST call verify_http_server({ port: ${detectedPort} }) to confirm HTTP readiness before telling the user the server is live.`
        : `Background task started with task ID "${taskId}". Use check_task_output({ taskId: "${taskId}" }) to inspect stdout/stderr.`,
    };
  }

  /**
   * Reports a tracked background task's status. With waitMs it polls up to
   * that long (capped at 30s) for completion before answering.
   */
  public async checkBackgroundTask(taskId: unknown, waitMs?: unknown): Promise<Record<string, any>> {
    this.pruneFinishedBackgroundTasks();
    const id = String(taskId || '');
    const task = this.backgroundTasks.get(id);
    if (!task) {
      return { error: `Unknown background task "${id}". Use a taskId previously returned by run_command with background:true.` };
    }
    const requestedWait = Number(waitMs);
    const boundedWait = Number.isFinite(requestedWait) && requestedWait > 0 ? Math.min(30000, requestedWait) : 0;
    const deadline = Date.now() + boundedWait;
    while (!task.done && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const result: Record<string, any> = {
      taskId: id,
      cmd: task.cmd,
      running: !task.done,
      outputTail: this.backgroundOutputTail(task),
      durationMs: Date.now() - task.startedAt,
    };
    if (task.done) result.exitCode = task.exitCode;
    return result;
  }

  /** Terminates a process and its children (shell:true wraps commands in cmd.exe on Windows). */
  private terminateProcessTree(proc: ChildProcess): void {
    if (proc.pid === undefined || proc.exitCode !== null) return;
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        return;
      } catch {
        // Fall through to the plain signal path
      }
    }
    try {
      proc.kill('SIGTERM');
    } catch {
      // Already gone — nothing to do
    }
  }

  /** Kills one tracked background task. Only taskIds present in this registry are accepted. */
  public killBackgroundTask(taskId: unknown): Record<string, any> {
    const id = String(taskId || '');
    const task = this.backgroundTasks.get(id);
    if (!task) {
      return { error: `Unknown background task "${id}". Only taskIds returned by run_command with background:true can be killed here.` };
    }
    let wasRunning = false;
    if (!task.done) {
      wasRunning = true;
      this.terminateProcessTree(task.proc);
      task.done = true;
      task.exitCode = task.exitCode ?? -1;
      task.finishedAt = Date.now();
    }
    return {
      taskId: id,
      killed: true,
      wasRunning,
      cmd: task.cmd,
      outputTail: this.backgroundOutputTail(task),
    };
  }

  /** Kills every live tracked background task; used when a run ends or is cancelled. */
  public killAllBackgroundTasks(): number {
    let killed = 0;
    for (const task of this.backgroundTasks.values()) {
      if (!task.done) {
        this.terminateProcessTree(task.proc);
        task.done = true;
        task.exitCode = task.exitCode ?? -1;
        task.finishedAt = Date.now();
        killed += 1;
      }
    }
    return killed;
  }

  // -------------------------------------------------------------------------
  // Foreground command execution — type-aware budgets, never-silent outcomes
  // -------------------------------------------------------------------------

  /**
   * Runs a one-shot command in the foreground under its classified wait budget.
   *
   * Every outcome is fully reported: exitCode (or null + timedOut), durationMs,
   * and a redacted ~4KB output tail ('(no output)' when silent). On budget
   * expiry the process tree is terminated via the same Windows-safe path used
   * by the background registry, and a STRUCTURED timeout result is returned so
   * the model can decide the next move — never an unexplained stop.
   */
  private async runForegroundCommand(
    commandText: string,
    cwd: unknown,
    classification: CommandClassification,
    explicitTimeoutMs?: unknown
  ): Promise<Record<string, any>> {
    const startedAt = Date.now();
    const workspaceRoot = fsTools.getWorkspaceRoot();

    const safetyCheck = SecurityGuardrails.validateCommandSafety(commandText, workspaceRoot);
    if (!safetyCheck.safe) {
      return {
        error: safetyCheck.reason || 'Command blocked by security guardrails.',
        success: false,
        exitCode: 1,
        timedOut: false,
        waitClass: classification.waitClass,
        durationMs: 0,
        outputTail: '',
      };
    }

    const budgetMs = resolveWaitBudget(classification, explicitTimeoutMs);
    // Shell selection mirrors ptyManager.executeCommand: powershell.exe on
    // Windows hosts, bash elsewhere. CI=1 keeps progress bars/chatty banners
    // from stalling non-interactive runs.
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : 'bash';
    const args = isWindows
      ? ['/d', '/s', '/c', commandText]
      : ['-c', commandText];
    const effectiveCwd = cwd && String(cwd).trim()
      ? SecurityGuardrails.validateSafePath(String(cwd), workspaceRoot)
      : workspaceRoot;

    const logState: OutputLogState = { logPieces: [], logBytes: 0 };
    const commandTaskId = `cmd-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;

    return new Promise<Record<string, any>>((resolve) => {
      const child = spawn(shell, args, {
        cwd: effectiveCwd,
        env: { ...process.env, CI: 'true', DEBIAN_FRONTEND: 'noninteractive' },
        windowsHide: true,
      });

      // Prevent foreground commands from hanging on interactive prompts
      try {
        child.stdin?.end();
      } catch {}

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finishCompleted = async (exitCode: number | null, extraData?: Record<string, any>) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        taskWatchdog.untrack(commandTaskId);
        const tail = reportedTail();
        let portConflictData: Record<string, any> | undefined;

        if (exitCode !== 0 && /EADDRINUSE|address already in use|Port \d+ is (already )?in use/i.test(tail)) {
          const portMatch = tail.match(/(?:EADDRINUSE.*?|port\s+|:::|127\.0\.0\.1:)(\d{2,5})/i);
          const detectedP = portMatch ? Number(portMatch[1]) : processManager.detectPort(commandText);
          if (detectedP) {
            try {
              const inspectResult = await processManager.inspectPort(detectedP);
              portConflictData = {
                portConflict: {
                  detectedPort: detectedP,
                  inUse: inspectResult.inUse,
                  occupyingPid: inspectResult.pid,
                  occupyingProcess: inspectResult.processName || inspectResult.command,
                  guidance: `Port ${detectedP} is already in use by PID ${inspectResult.pid || 'unknown'} (${inspectResult.processName || inspectResult.command || 'existing process'}). Call free_port({ port: ${detectedP} }) to terminate the stale process or launch on a different port.`,
                },
              };
            } catch {}
          }
        }

        resolve({
          success: exitCode === 0,
          exitCode,
          timedOut: false,
          waitClass: classification.waitClass,
          matchedPattern: classification.matched,
          budgetMs,
          durationMs: Date.now() - startedAt,
          outputTail: tail,
          ...portConflictData,
          ...extraData,
        });
      };

      const handleChunk = (chunk: Buffer | string) => {
        appendToOutputLog(logState, chunk as Buffer);
        const text = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf-8');
        const inspection = taskWatchdog.inspectChunk(commandTaskId, text);
        if (inspection.isInteractive && !settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          this.terminateProcessTree(child);
          taskWatchdog.untrack(commandTaskId);
          resolve({
            timedOut: true,
            interactiveDeadlock: true,
            promptType: inspection.promptType,
            waitedMs: Date.now() - startedAt,
            budgetMs,
            waitClass: classification.waitClass,
            exitCode: null,
            success: false,
            outputTail: reportedTail(),
            guidance: `Command deadlocked waiting on an interactive prompt ("${inspection.matchedText}"). SUTRA Watchdog terminated the process. Please re-run with non-interactive flags (e.g. '--yes', '-y', '--no-input', or 'CI=true').`,
          });
        }
      };

      child.stdout?.on('data', handleChunk);
      child.stderr?.on('data', handleChunk);

      const reportedTail = () => SecurityGuardrails.redactSecrets(outputLogTail(logState)) || '(no output)';

      taskWatchdog.trackProcess(commandTaskId, child, {
        command: commandText,
        cwd: String(effectiveCwd),
        maxStallMs: 45000,
        hardTimeoutMs: budgetMs,
      });

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.terminateProcessTree(child);
        taskWatchdog.untrack(commandTaskId);
        resolve({
          timedOut: true,
          waitedMs: Date.now() - startedAt,
          budgetMs,
          waitClass: classification.waitClass,
          exitCode: null,
          success: false,
          outputTail: reportedTail(),
          guidance: 'Command exceeded its wait budget. Re-run with background:true and poll check_task_output, narrow scope, or accept partial state.',
        });
      }, budgetMs);

      child.on('close', (code) => finishCompleted(code));
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        taskWatchdog.untrack(commandTaskId);
        resolve({
          error: `Process spawn error: ${err.message}`,
          success: false,
          exitCode: 1,
          timedOut: false,
          durationMs: Date.now() - startedAt,
          outputTail: reportedTail(),
        });
      });
    });
  }

  public spawnSubagent(role: string, task: string, options?: { modelId?: string; provider?: string; maxTurns?: number }): SubagentState {
    const id = `agent-${role}-${Date.now()}`;
    const modelSuffix = options?.modelId ? ` [${options.modelId}]` : '';
    const agent: SubagentState = {
      id,
      role: role as SubagentRole,
      name: `Specialist: ${role}${modelSuffix}`,
      status: 'executing',
      currentTask: task,
      progress: 0,
      toolCalls: [],
      tokensUsed: 0,
      lastMessage: `Spawned for task${options?.modelId ? ` with model ${options.modelId}` : ''}`,
      startedAt: Date.now(),
    };
    this.subagents.set(id, agent);
    return agent;
  }

  /**
   * Executes an autonomous subagent reason-and-act loop for a specialized task
   * with multi-model and multi-provider selection support
   */
  public async runSubagentTask(
    role: string,
    task: string,
    options?: { modelId?: string; provider?: string; maxTurns?: number }
  ): Promise<{ id: string; role: string; output: string; status: string; modelUsed?: string; providerUsed?: string }> {
    const agent = this.spawnSubagent(role, task, options);
    agent.progress = 15;
    agent.lastMessage = `Specialist ${role} analyzing workspace requirements...`;

    const rolePrompts: Record<string, string> = {
      architect: 'You are the System Architect specialist. Plan component hierarchies, database schemas, and clean directory layouts.',
      frontend_engineer: 'You are the Frontend Specialist. Build high-craft, responsive, accessible React components and layout systems.',
      backend_engineer: 'You are the Backend Specialist. Implement robust Express/Node.js endpoints, SQLite queries, and business logic.',
      debugger: 'You are the Root Cause Debugger. Trace stack traces, execute tests, typecheck, and fix bugs surgically.',
      visual_designer: 'You are the Visual Designer. Craft bespoke SVG assets, icons, color tokens, and UI micro-interactions.',
      security_auditor: 'You are the Security Auditor. Sanitize user inputs, check RBAC permissions, and audit packages.',
      researcher: 'You are the Codebase Researcher. Search files, inspect symbols, and synthesize technical documentation.',
      test_engineer: 'You are the Test Engineer. Write tests, run them, and fix any failures.',
    };

    const systemPrompt = `${rolePrompts[role] || 'You are an autonomous specialist agent.'}
Working directory: ${fsTools.getWorkspaceRoot()}
Current Task: "${task}"
You have full access to workspace tools. Execute the necessary actions directly to complete this sub-task, verify your work, and report back concrete results.

BUILD-AND-VERIFY PRINCIPLES:
- Treat this as a software-engineering problem, not a code generation problem.
- Model state explicitly (STATE -> LOGIC -> SIDE EFFECTS -> PRESENTATION).
- Never stop at UI mockups or placeholder code — write complete working implementations.
- Verify with typecheck_project, run_unit_tests, or inspect_web_page before declaring completion.
- Break your own code: test unexpected inputs, edge cases, and failure paths.
- If something fails, investigate the root cause before patching symptoms.
- Ask yourself: "If a real user uses this in ways I didn't anticipate, what could break?"

Execution Rules:
- Execute tools directly; run multiple independent tool calls simultaneously in parallel.
- For long-running dev servers, watchers, or builds pass background:true to run_command and poll progress with check_task_output instead of blocking.
- Never verbally claim in text that a server or process is running on a port unless you have explicitly executed run_command and verified it with verify_http_server or inspect_port.
- Communicate naturally about your engineering work; never narrate internal loop mechanics (e.g. avoid saying "1 call at a time").
- Max total turns: 8.`;

    let fullOutput = '';
    agent.progress = 30;

    const messages: any[] = [
      { role: 'user', content: `Execute the following specialist sub-task in the workspace:\n\n${task}\n\nUse tools to accomplish this and respond with a concise final summary when done.` }
    ];

    const targetModelId = options?.modelId || modelRouter.getActiveModel()?.id || undefined;

    const MAX_TURNS = options?.maxTurns || 24;
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        agent.progress = Math.min(90, Math.floor(20 + (turn / MAX_TURNS) * 70));
        let turnHadToolCalls = false;
        let turnAssistantText = '';
        let toolCallsCollected: any[] = [];

        for await (const chunk of modelRouter.streamChat({
          messages: [...messages],
          systemPrompt,
          modelId: targetModelId,
          temperature: 0.35,
        })) {
          if (chunk.delta) {
            turnAssistantText += chunk.delta;
            fullOutput += chunk.delta;
            agent.lastMessage = fullOutput.slice(-120);
          }
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const tc of chunk.toolCalls) {
              if (!toolCallsCollected.find(t => t.id === tc.id)) {
                toolCallsCollected.push(tc);
              }
            }
          }
          if (chunk.done) {
            break;
          }
        }

        if (turnAssistantText.trim()) {
          messages.push({ role: 'assistant', content: turnAssistantText });
        }

        if (toolCallsCollected.length === 0) {
          agent.progress = 95;
          break;
        }

        turnHadToolCalls = true;
        agent.progress = Math.min(90, 35 + turn * 8);

        // Execute all tool calls in parallel where safe (read-only -> parallel; write/run -> sequential)
        const readOnlyTools = new Set(['read_file', 'list_directory', 'grep_search', 'git_status', 'git_diff', 'git_log', 'typecheck_project', 'count_loc', 'inspect_sqlite_schema', 'find_dead_code', 'extract_symbols', 'ast_grep', 'validate_env_variables', 'audit_security_dependencies', 'audit_accessibility_wcag', 'audit_performance_vitals', 'search_web', 'scrape_url', 'list_running_processes', 'inspect_port', 'check_task_output']);
        const parallelToolNames = new Set([...readOnlyTools, 'spawn_subagent', 'invoke_subagent']);
        const results: Record<string, any> = {};
        const errors: Record<string, string> = {};

        const sequentialItems: typeof toolCallsCollected = [];
        const parallelItems: typeof toolCallsCollected = [];
        for (const tc of toolCallsCollected) {
          (parallelToolNames.has(tc.tool) ? parallelItems : sequentialItems).push(tc);
        }

        // Parallel execution for read-only tools
        if (parallelItems.length > 0) {
          await Promise.all(parallelItems.map(async (tc) => {
            const copy: any = { ...tc, status: 'approved' };
            try {
              const res = await this.executeTool(copy);
              results[tc.id] = res;
              tc.result = res;
              tc.status = 'completed';
              agent.toolCalls.push(tc);
            } catch (err: any) {
              errors[tc.id] = err.message;
              tc.error = err.message;
              tc.status = 'failed';
              agent.toolCalls.push(tc);
            }
          }));
        }

        // Sequential execution for mutating tools
        for (const tc of sequentialItems) {
          const copy: any = { ...tc, status: 'approved' };
          try {
            const res = await this.executeTool(copy);
            results[tc.id] = res;
            tc.result = res;
            tc.status = 'completed';
            agent.toolCalls.push(tc);
          } catch (err: any) {
            errors[tc.id] = err.message;
            tc.error = err.message;
            tc.status = 'failed';
            agent.toolCalls.push(tc);
          }
        }

        // Build a single tool-results user message summarizing ALL tool call outputs for next turn
        let resultsBlock = 'Tool results for this turn:\n';
        for (const tc of toolCallsCollected) {
          if (results[tc.id] !== undefined) {
            const serialized = typeof results[tc.id] === 'string'
              ? results[tc.id]
              : JSON.stringify(results[tc.id], null, 2);
            resultsBlock += `\n<tool_result id="${tc.id}" tool="${tc.tool}">\n${serialized.slice(0, 6000)}\n</tool_result>\n`;
          } else if (errors[tc.id]) {
            resultsBlock += `\n<tool_error id="${tc.id}" tool="${tc.tool}">\n${errors[tc.id]}\n</tool_error>\n`;
          }
        }
        messages.push({ role: 'user', content: resultsBlock });

        if (!turnHadToolCalls) break;
      }

      this.completeSubagent(agent.id, fullOutput.slice(0, 220) || 'Task successfully finished');
      return {
        id: agent.id,
        role,
        output: (fullOutput || `Specialist ${role} successfully completed task: ${task}`).slice(0, 3500),
        status: 'completed',
      };
    } catch (err: any) {
      agent.status = 'failed';
      agent.lastMessage = `Execution error: ${err.message}`;
      return {
        id: agent.id,
        role,
        output: `Specialist ${role} encountered error: ${err.message}`,
        status: 'failed',
      };
    }
  }

  public completeSubagent(agentId: string, result: string): void {
    const agent = this.subagents.get(agentId);
    if (agent) {
      agent.status = 'completed';
      agent.progress = 100;
      agent.lastMessage = result;
    }
  }

  // -------------------------------------------------------------------------
  // Tool grounding — mutations must be based on files this run has actually seen
  // -------------------------------------------------------------------------

  /**
   * Auto-reads a mutation target that the current run has never observed so the
   * operation proceeds from real content instead of model guesswork. The tool
   * call is NEVER blocked: on success the caller attaches groundedNote to its
   * result; unreadable/not-yet-existing targets (e.g. new files) are skipped
   * silently. Returns true when an auto-read actually happened.
   */
  private ensureGroundedRead(toolName: string, targetPath: unknown): boolean {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return false;
    if (this.readTracker.wasRead(targetPath)) return false;
    try {
      const current = fsTools.readFile(targetPath);
      this.readTracker.markRead(current.path || targetPath);
      // One concise line per auto-read — silent-by-default otherwise.
      console.log(`[SUTRA] Grounding: "${targetPath}" had not been read this run — auto-read it before ${toolName}.`);
      return true;
    } catch {
      // New or unreadable file — nothing to ground against; proceed as-is.
      return false;
    }
  }

  /** Marks every file path surfaced by a search tool as observed for this run. */
  private trackSearchResultPaths(results: unknown): void {
    if (!Array.isArray(results)) return;
    for (const hit of results) {
      const hitFile = (hit as { file?: unknown })?.file;
      if (typeof hitFile === 'string' && hitFile) this.readTracker.markRead(hitFile);
    }
  }

  /**
   * Grounds edit_file retry attempts. When an edit fails because the model's
   * target/anchor text does not exist in the real file (fsTools.editFile throws
   * "Target content not found"), the returned structured error carries the
   * ACTUAL first ~80 lines of the file (`actualContentPreview`) plus a retry
   * hint, so the next attempt is based on truth rather than another guess.
   * Any other failure (path guards, IO) yields null and the original error is
   * rethrown unchanged by the caller.
   */
  private groundedEditFailure(targetPath: unknown, err: any): Record<string, any> | null {
    const message = String(err?.message || '');
    if (!/^Target content not found\b/i.test(message)) return null;
    let actualContentPreview: string | undefined;
    if (typeof targetPath === 'string' && targetPath.trim()) {
      try {
        const current = fsTools.readFile(targetPath, { start: 1, end: GROUNDED_EDIT_PREVIEW_LINES });
        actualContentPreview = current.content
          .split('\n')
          .map((line, i) => `${i + 1}: ${line}`)
          .join('\n');
      } catch {
        // File vanished mid-edit — the original error stands on its own.
      }
    }
    return {
      success: false,
      error: message,
      groundedRetryHint: 'The edit failed because the target content did not match the real file. Retry with exact text taken from actualContentPreview below, or use startLine/endLine.',
      ...(actualContentPreview !== undefined ? { actualContentPreview } : {}),
    };
  }

  /**
   * Execute Tool with Permission Guard & "Allow All" Mode
   *
   * `ctx.planFilePath` scopes the write_todos plan to the conversation that owns
   * this run — absent ctx falls back to the workspace-root task_plan.md.
   *
   * `ctx.signal` is the owning run's abort signal. It is checked up front so an
   * already-cancelled run stops issuing work instead of queueing more tool calls.
   */
  public async executeTool(
    toolCall: ToolCallPayload,
    ctx?: { planFilePath?: string; signal?: AbortSignal }
  ): Promise<any> {
    // A cancelled run must not start new work. Without this, pressing Stop left
    // every queued tool call running to completion.
    if (ctx?.signal?.aborted) {
      return { error: 'Run was cancelled before this tool executed.', code: 'cancelled', retryable: false };
    }

    // Auto-normalize tool name (strip any namespaces like repo_browser., fs., tools., functions.)
    const rawTool = toolCall.tool || '';
    const normalizedTool = rawTool.replace(/^(?:repo_browser|workspace|fs|tools|functions|file_system)\./i, '').trim();
    toolCall.tool = normalizedTool;

    const MUTATING_TOOLS = new Set([
      'write_file',
      'edit_file',
      'delete_file',
      'run_command',
      'run_managed_process',
      'stop_managed_process',
      'restart_managed_process',
      'generate_image_asset',
      'generate_svg_asset',
      'generate_video_asset',
      'generate_audio_asset',
      'git_commit',
      'git_branch',
      'git_checkout',
      'git_cherry_pick',
    ]);
    const requiresGate = MUTATING_TOOLS.has(toolCall.tool);

    // In strict mode mutating actions queue for approval; read-only and safe planning tools execute directly
    if (this.permissionLevel === 'strict' && requiresGate && toolCall.status !== 'approved') {
      toolCall.status = 'pending';
      this.pendingApprovals.set(toolCall.id, toolCall);
      return { status: 'waiting_for_user_approval', toolCallId: toolCall.id };
    }

    // Auto-approve in allow_all mode or when already approved
    toolCall.status = 'executing';

    try {
      let output: any;

      switch (toolCall.tool) {
        case 'read_file': {
          const filePath = toolCall.params.path || toolCall.params.filePath || toolCall.params.file_path || toolCall.params.file || toolCall.params.targetFile || toolCall.params.filename || toolCall.params.name;
          const lineRange = toolCall.params.lineRange || (typeof toolCall.params.startLine === 'number' && typeof toolCall.params.endLine === 'number' ? { start: toolCall.params.startLine, end: toolCall.params.endLine } : undefined);
          output = fsTools.readFile(filePath, lineRange);
          this.readTracker.markRead(String(filePath || output?.path || ''));
          break;
        }

        case 'write_file': {
          const filePath = toolCall.params.path || toolCall.params.filePath || toolCall.params.file_path || toolCall.params.file || toolCall.params.targetFile || toolCall.params.filename || toolCall.params.name;
          const content = toolCall.params.content ?? toolCall.params.contents ?? toolCall.params.code ?? toolCall.params.CodeContent ?? toolCall.params.text ?? toolCall.params.data ?? toolCall.params.body ?? '';
          const writeWasGrounded = this.ensureGroundedRead('write_file', filePath);
          output = fsTools.writeFile(filePath, content);
          if (writeWasGrounded && output && typeof output === 'object') {
            output = { ...output, groundedNote: AUTO_READ_GROUNDED_NOTE };
          }
          break;
        }

        case 'edit_file': {
          const filePath = toolCall.params.path || toolCall.params.filePath || toolCall.params.file_path || toolCall.params.file || toolCall.params.targetFile || toolCall.params.filename || toolCall.params.name;
          const target = toolCall.params.target || toolCall.params.oldStr || toolCall.params.oldContent || toolCall.params.old_string || toolCall.params.targetContent || toolCall.params.search || toolCall.params.find || '';
          const replacement = toolCall.params.replacement ?? toolCall.params.newStr ?? toolCall.params.newContent ?? toolCall.params.new_string ?? toolCall.params.replacementContent ?? toolCall.params.replace ?? toolCall.params.content ?? '';
          const startLine = typeof toolCall.params.startLine === 'number' ? toolCall.params.startLine : typeof toolCall.params.start_line === 'number' ? toolCall.params.start_line : typeof toolCall.params.start === 'number' ? toolCall.params.start : undefined;
          const endLine = typeof toolCall.params.endLine === 'number' ? toolCall.params.endLine : typeof toolCall.params.end_line === 'number' ? toolCall.params.end_line : typeof toolCall.params.end === 'number' ? toolCall.params.end : undefined;
          const editWasGrounded = this.ensureGroundedRead('edit_file', filePath);
          try {
            output = fsTools.editFile(filePath, target, replacement, startLine, endLine);
            if (editWasGrounded && output && typeof output === 'object') {
              output = { ...output, groundedNote: AUTO_READ_GROUNDED_NOTE };
            }
          } catch (err: any) {
            // Anchor mismatch: return a grounded error with the real file content
            // so the retry is based on truth; all other failures rethrow as-is.
            const groundedError = this.groundedEditFailure(filePath, err);
            if (!groundedError) throw err;
            output = groundedError;
          }
          break;
        }

        case 'delete_file': {
          const filePath = toolCall.params.path || toolCall.params.filePath || toolCall.params.file_path || toolCall.params.file || toolCall.params.targetFile || toolCall.params.filename || toolCall.params.name;
          const deleteWasGrounded = this.ensureGroundedRead('delete_file', filePath);
          output = fsTools.deletePath(filePath);
          if (deleteWasGrounded && output && typeof output === 'object') {
            output = { ...output, groundedNote: AUTO_READ_GROUNDED_NOTE };
          }
          break;
        }

        case 'create_directory':
          output = fsTools.createDirectory(toolCall.params.path);
          break;

        case 'rename_path':
          output = fsTools.renamePath(toolCall.params.oldPath, toolCall.params.newPath);
          break;

        case 'list_directory':
          output = fsTools.listDirectory(toolCall.params.path, toolCall.params.recursive);
          break;

        case 'grep_search':
          output = fsTools.grepSearch(toolCall.params.query, toolCall.params.path, toolCall.params.caseInsensitive);
          this.trackSearchResultPaths(output);
          break;

        case 'codebase_search': {
          const query = String(toolCall.params.query || '');
          const limit = typeof toolCall.params.limit === 'number' ? toolCall.params.limit : 10;
          await codebaseIndexer.buildIndex();
          const results = codebaseIndexer.search(query, limit);
          output = {
            query,
            totalMatches: results.length,
            results: results.map((r) => ({
              name: r.symbol.name,
              kind: r.symbol.kind,
              filePath: r.symbol.filePath,
              line: r.symbol.line,
              score: r.score,
              snippet: r.symbol.snippet,
            })),
          };
          break;
        }

        case 'git_status':
          output = fsTools.gitStatus();
          break;

        case 'git_diff':
          output = fsTools.getGitDiff(toolCall.params?.path, toolCall.params?.staged || false);
          break;

        case 'run_command': {
          const runParams = toolCall.params as Record<string, any>;
          const commandText = String(runParams.command ?? '').trim();
          // background:true spawns without blocking and returns a taskId for
          // check_task_output / kill_task instead of waiting for completion.
          if (runParams.background === true) {
            output = commandText
              ? this.spawnBackgroundCommand(commandText, runParams.cwd)
              : { error: 'run_command requires a non-empty command.' };
            break;
          }
          if (!commandText) {
            output = { error: 'run_command requires a non-empty command.' };
            break;
          }
          // Type-aware routing: server/watcher intents are auto-promoted to the
          // background registry so they NEVER block the agent loop.
          const classification = classifyCommand(commandText);
          if (classification.waitClass === 'server') {
            const bgTask = this.spawnBackgroundCommand(commandText, runParams.cwd);
            output = {
              ...bgTask,
              autoBackgrounded: true,
              waitClass: 'server',
              detectedPattern: classification.matched,
              message: `Detected a long-running server/watcher — started in background as ${bgTask.taskId}; poll with check_task_output.`,
            };
            break;
          }
          output = await this.runForegroundCommand(commandText, runParams.cwd, classification, runParams.timeoutMs);
          // Dev servers / watchers get liveness tracking + auto-retry so a
          // "started but not listening" process self-heals instead of failing.
          try {
            const parts = commandText.split(/\s+/);
            processManager.register(parts[0], parts.slice(1), runParams.cwd || '');
          } catch {
            // Tracking is best-effort around the command itself
          }
          break;
        }

        case 'run_background_process':
          output = await ptyManager.runBackgroundProcess(
            toolCall.params.command,
            toolCall.params.name || 'sutra-bg',
            toolCall.params.cwd,
            toolCall.params.waitMsBeforeAsync || 3000
          );
          break;

        case 'list_running_processes':
        case 'list_tasks': {
          const processes = ptyManager.listRunningProcesses();
          output = { activeProcesses: processes, processes, total: processes.length };
          break;
        }

        case 'check_task_output':
        case 'check_background_task':
          output = await this.checkBackgroundTask(
            toolCall.params.taskId ?? toolCall.params.id,
            toolCall.params.wait_ms ?? toolCall.params.waitMs,
          );
          break;

        case 'kill_process':
        case 'kill_task': {
          const requestedTaskId = toolCall.params.processId || toolCall.params.taskId || toolCall.params.id;
          // Background-registry taskIds (`bg-<n>`) are handled exclusively here:
          // they never fall through to the legacy process manager, so a fabricated
          // or stale id can never terminate an unrelated OS process.
          if (/^bg-\d+$/.test(String(requestedTaskId || ''))) {
            output = this.backgroundTasks.has(String(requestedTaskId))
              ? this.killBackgroundTask(requestedTaskId)
              : { error: `Unknown background task "${requestedTaskId}". Only live taskIds returned by run_command with background:true can be killed.` };
            break;
          }
          output = ptyManager.killProcess(requestedTaskId);
          break;
        }

        case 'get_process_logs':
          output = ptyManager.getProcessLogs(toolCall.params.processId || toolCall.params.taskId || toolCall.params.id, toolCall.params.maxLines || 50);
          break;

        case 'manage_task': {
          const action = toolCall.params.action || 'list';
          if (action === 'list') {
            output = { activeProcesses: ptyManager.listRunningProcesses() };
          } else if (action === 'kill') {
            output = ptyManager.killProcess(toolCall.params.taskId || toolCall.params.processId);
          } else if (action === 'status' || action === 'logs') {
            output = ptyManager.getProcessLogs(toolCall.params.taskId || toolCall.params.processId);
          } else {
            output = { success: true, message: `Task action ${action} executed.` };
          }
          break;
        }

        case 'generate_image_asset':
        case 'generate_image':
        case 'image_generate':
        case 'create_image':
          output = await mediaEngine.generateImageAsset(toolCall.params as {
            prompt: string;
            filename: string;
            dimensions?: string;
            style?: string;
            model?: string;
          });
          break;

        case 'generate_video_asset':
        case 'generate_video': {
          const videoOutput = await mediaEngine.generateVideoAsset(toolCall.params as {
            prompt: string;
            filename: string;
            model?: string;
            durationSeconds?: number;
            aspectRatio?: string;
            motion?: string;
          });
          if (videoOutput && typeof videoOutput === 'object' && 'error' in videoOutput) {
            // Honest failure: NEVER insert a placeholder or sample clip. Instead,
            // instruct the agent to request a real video file from the user via ask_user.
            output = {
              error: videoOutput.error,
              requiresAskUser: true,
              instruction: 'Real video generation is unavailable with the current providers. Do NOT create, download, or insert any placeholder or sample clip. Immediately call the ask_user tool and tell the user that video generation is unavailable, then ask them to provide a real video file — either a path to an existing .mp4 or .webm file on disk (absolute or workspace-relative), or an upload they place into the workspace. State exactly what is needed: a playable .mp4 or .webm video matching their intent, and where the file should live.',
            };
          } else {
            output = videoOutput;
          }
          break;
        }

        case 'generate_audio_asset':
        case 'generate_audio':
          output = await mediaEngine.generateAudioAsset({
            type: (toolCall.params as any).type || 'notification',
            filename: (toolCall.params as any).filename,
            prompt: (toolCall.params as any).prompt,
            model: (toolCall.params as any).model,
            voice: (toolCall.params as any).voice,
          });
          break;

        case 'generate_sound_effect':
        case 'generate_sfx':
          output = await mediaEngine.generateSfxAsset({
            prompt: (toolCall.params as any).prompt,
            filename: (toolCall.params as any).filename,
            category: (toolCall.params as any).category,
            durationSec: (toolCall.params as any).durationSec,
          });
          break;

        case 'generate_music':
          output = await mediaEngine.generateMusicAsset({
            prompt: (toolCall.params as any).prompt,
            filename: (toolCall.params as any).filename,
            durationSec: (toolCall.params as any).durationSec,
            bpm: (toolCall.params as any).bpm,
            mood: (toolCall.params as any).mood,
            loop: (toolCall.params as any).loop,
          });
          break;

        case 'generate_song':
          output = await mediaEngine.generateSongAsset({
            lyrics: (toolCall.params as any).lyrics,
            stylePrompt: (toolCall.params as any).stylePrompt,
            filename: (toolCall.params as any).filename,
            mood: (toolCall.params as any).mood,
            bpm: (toolCall.params as any).bpm,
          });
          break;

        // --- Antigravity-Inspired Scratchpad Workspace System ---
        case 'create_scratch_workspace': {
          const meta = scratchManager.createScratchWorkspace({
            name: toolCall.params?.name,
            template: toolCall.params?.template,
            prompt: toolCall.params?.prompt,
            description: toolCall.params?.description,
            activate: true,
          });
          output = {
            success: true,
            workspace: meta,
            message: `Created and activated scratchpad workspace "${meta.name}" at ${meta.path}. Workspace is active and ready for development.`,
          };
          break;
        }

        case 'list_scratch_workspaces': {
          const workspaces = scratchManager.listScratchWorkspaces();
          output = {
            success: true,
            baseDir: scratchManager.getBaseDir(),
            count: workspaces.length,
            workspaces,
          };
          break;
        }

        case 'promote_scratch_workspace': {
          const { scratchPath, destinationDir } = toolCall.params || {};
          if (!scratchPath || !destinationDir) {
            output = { success: false, error: 'scratchPath and destinationDir are required.' };
            break;
          }
          const result = scratchManager.promoteScratchWorkspace(scratchPath, destinationDir);
          scratchManager.activateWorkspace(result.newPath);
          output = {
            success: true,
            promotedPath: result.newPath,
            message: `Scratch workspace promoted and moved to ${result.newPath}. Active workspace switched.`,
          };
          break;
        }

        // --- NVIDIA AVO-Inspired Evolutionary Tool Handlers ---
        case 'explore_variations':
        case 'propose_variation': {
          const title = String(toolCall.params.title || 'Candidate Variation');
          const strategy = String(toolCall.params.strategy || toolCall.params.description || '');
          const diffs = Array.isArray(toolCall.params.diffs) ? toolCall.params.diffs : [];
          const variation = avoEngine.proposeVariation(title, strategy, diffs);
          output = {
            success: true,
            variationId: variation.id,
            title: variation.title,
            status: variation.status,
            diffCount: variation.diffs.length,
            instruction: 'Candidate variation registered. Execute evaluate_diff_candidates with variationId to benchmark fitness.',
          };
          break;
        }

        case 'evaluate_diff_candidates':
        case 'evaluate_variation':
        case 'test_variation': {
          const variationId = String(toolCall.params.variationId || toolCall.params.id || '');
          output = await avoEngine.testCandidateVariation(variationId);
          break;
        }

        case 'rollback_to_checkpoint':
        case 'revert_checkpoint': {
          const checkpointId = String(toolCall.params.checkpointId || toolCall.params.id || '');
          output = await gitCheckpoints.rollback(checkpointId);
          break;
        }

        case 'inspect_evolution_archive':
        case 'query_evolution_recipes': {
          const query = String(toolCall.params.query || toolCall.params.task || '');
          const recipes = avoEngine.archive.findRelevantRecipes(query);
          const failedPatterns = avoEngine.archive.getFailedPatterns();
          output = {
            recipesFound: recipes.length,
            recipes,
            failedPatterns: failedPatterns.slice(-5),
          };
          break;
        }

        // --- Pro Mode 7-Phase Loop State & Verification APIs ---
        case 'get_file_tree':
          output = proModeEngine.getFileTree(toolCall.params?.subDir, toolCall.params?.maxDepth);
          break;

        case 'get_diff':
          output = proModeEngine.getDiff(toolCall.params?.path, toolCall.params?.staged);
          break;

        case 'get_test_status':
          output = proModeEngine.getTestStatus();
          break;

        case 'get_build_status':
          output = proModeEngine.getBuildStatus();
          break;

        case 'run_tests':
          output = await proModeEngine.runTests(toolCall.params?.testPath);
          break;

        case 'check_types':
          output = proModeEngine.checkTypes();
          break;

        case 'run_build':
          output = await proModeEngine.runBuild();
          break;

        case 'checkpoint_loop_iteration': {
          const { taskId, iteration, phase, hypothesis, action, result, status, tags } = toolCall.params as any;
          if (!taskId || iteration === undefined || !hypothesis || !action || !result || !status) {
            output = { error: 'checkpoint_loop_iteration requires taskId, iteration, hypothesis, action, result, status.' };
            break;
          }
          const record = proModeEngine.checkpointIteration({
            taskId: String(taskId),
            iteration: Number(iteration),
            phase,
            hypothesis: String(hypothesis),
            action: String(action),
            result,
            status,
            tags,
          });
          const escalation = proModeEngine.assessEscalation(String(taskId));
          output = {
            checkpoint: record,
            escalation,
            message: escalation.escalate
              ? `Iteration #${iteration} recorded. ⚠️ ESCALATION TRIGGERED: ${escalation.message}`
              : `Iteration #${iteration} checkpointed [${status}].`,
          };
          break;
        }

        case 'get_loop_checkpoints': {
          const taskId = String(toolCall.params?.taskId || 'default');
          const records = proModeEngine.getCheckpoints(taskId);
          const escalation = proModeEngine.assessEscalation(taskId);
          output = {
            taskId,
            totalIterations: records.length,
            records,
            escalation,
          };
          break;
        }

        case 'dispatch_subagents':
          throw new Error('dispatch_subagents is deprecated, use spawn_subagent instead.');
          
        case 'git_commit':
          output = fsTools.gitCommit(toolCall.params.message, toolCall.params.files);
          break;

        case 'git_branch':
          output = fsTools.gitBranch(toolCall.params.action, toolCall.params.branchName);
          break;

        case 'git_checkout':
          output = fsTools.gitCheckout(toolCall.params.target);
          break;

        case 'git_stash':
          output = fsTools.gitStash(toolCall.params.action);
          break;

        case 'git_log':
          output = fsTools.gitLog(toolCall.params.limit || 10);
          break;

        case 'git_cherry_pick': {
          const commitHash = String(toolCall.params.commitHash || toolCall.params.hash || '').trim();
          if (!/^[0-9a-fA-F]{4,40}$/.test(commitHash)) {
            output = { error: 'Invalid commit hash — expected 4 to 40 hex characters.' };
            break;
          }
          output = await ptyManager.executeCommand(`git cherry-pick ${commitHash}`);
          break;
        }

        case 'format_code':
          output = fsTools.formatCode(toolCall.params.path);
          break;

        case 'lint_code':
          output = fsTools.lintCode(toolCall.params.path);
          break;

        case 'typecheck_project':
          output = fsTools.typecheckProject();
          break;

        case 'count_loc':
          output = fsTools.countLoc();
          break;

        case 'find_dead_code':
          output = fsTools.findDeadCode();
          break;

        case 'ast_grep':
        case 'ast_search':
          output = fsTools.astGrep(toolCall.params.pattern || toolCall.params.query, toolCall.params.language);
          this.trackSearchResultPaths(output);
          break;

        case 'extract_symbols':
          output = fsTools.extractSymbols(toolCall.params.filePath);
          break;

        case 'inspect_sqlite_schema':
          output = fsTools.inspectSqlite(toolCall.params.dbPath);
          break;

        case 'query_sqlite':
          output = fsTools.querySqlite(toolCall.params.sql, toolCall.params.dbPath);
          break;

        case 'export_sqlite_data':
          output = fsTools.querySqlite(`SELECT * FROM ${toolCall.params.table || 'providers'}`);
          break;

        case 'run_db_migration':
          output = fsTools.querySqlite(toolCall.params.sql);
          break;

        case 'audit_security_dependencies':
          output = fsTools.auditSecurity();
          break;

        case 'validate_env_variables':
          output = fsTools.validateEnv();
          break;

        case 'run_unit_tests':
          output = await ptyManager.executeCommand(toolCall.params.testPath ? `npx vitest run ${toolCall.params.testPath}` : 'npm test');
          break;

        case 'audit_accessibility_wcag': {
          const auditUrl = String(toolCall.params.url || toolCall.params.previewUrl || toolCall.params.targetUrl || 'http://localhost:5173');
          try {
            const res = await fetch(auditUrl, { signal: AbortSignal.timeout(8000) });
            const html = await res.text();
            const imgTags = html.match(/<img\b[^>]*>/gi) || [];
            const missingAlt = imgTags.filter((tag) => !/\balt=/i.test(tag)).length;
            const emptyButtons = (html.match(/<button\b[^>]*>\s*<\/button>/gi) || []).length;
            const hasLangAttribute = /<html[^>]*\blang=/i.test(html);
            output = {
              url: auditUrl,
              coverage: 'Static HTML checks only — a rendered-DOM and contrast audit is not available in this build.',
              httpStatus: res.status,
              checks: {
                totalImages: imgTags.length,
                imagesMissingAltAttribute: missingAlt,
                emptyButtons: emptyButtons,
                htmlLangAttributePresent: hasLangAttribute,
              },
              notes: missingAlt > 0
                ? `${missingAlt} of ${imgTags.length} image(s) are missing alt attributes.`
                : imgTags.length > 0
                  ? 'All images expose alt attributes.'
                  : 'No <img> tags found in the served HTML.',
            };
          } catch (err: any) {
            output = { error: `Accessibility audit could not fetch "${auditUrl}": ${err.message}` };
          }
          break;
        }

        case 'audit_performance_vitals': {
          const vitalsUrl = String(toolCall.params.url || toolCall.params.previewUrl || toolCall.params.targetUrl || 'http://localhost:5173');
          try {
            // Measure real HTTP round-trip latency; browser paint metrics are not observable server-side.
            const samples: number[] = [];
            let lastStatus: number | null = null;
            for (let i = 0; i < 3; i += 1) {
              const startedAt = Date.now();
              const res = await fetch(vitalsUrl, { signal: AbortSignal.timeout(10000) });
              await res.arrayBuffer();
              lastStatus = res.status;
              samples.push(Date.now() - startedAt);
            }
            output = {
              url: vitalsUrl,
              coverage: `Measured HTTP round-trip latency over ${samples.length} requests. Browser paint metrics (FCP/LCP/CLS) are not available in this build.`,
              httpStatus: lastStatus,
              latencySamplesMs: samples,
              averageLatencyMs: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
            };
          } catch (err: any) {
            output = { error: `Performance audit could not reach "${vitalsUrl}": ${err.message}` };
          }
          break;
        }

        case 'scaffold_component': {
          const compPath = `src/components/${toolCall.params.name}.tsx`;
          const template = `import React from 'react';\n\nexport const ${toolCall.params.name}: React.FC = () => {\n  return (\n    <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-lg text-obsidian-inkPrimary">\n      <h3 className="font-bold text-sm mb-2">${toolCall.params.name}</h3>\n      <p className="text-xs text-obsidian-inkMuted">Autonomous SUTRA Scaffolding Component</p>\n    </div>\n  );\n};\n`;
          output = fsTools.writeFile(compPath, template);
          break;
        }

        case 'fetch_json_api': {
          const res = await fetch(toolCall.params.url, {
            method: toolCall.params.method || 'GET',
            headers: toolCall.params.headers || { 'Content-Type': 'application/json' },
            body: toolCall.params.body ? JSON.stringify(toolCall.params.body) : undefined,
          });
          output = { status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) };
          break;
        }

        case 'ping_host': {
          const host = String(toolCall.params.host || toolCall.params.hostname || '').trim();
          const rawPort = Number(toolCall.params.port);
          const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 443;
          const timeoutMs = Math.min(15000, Number(toolCall.params.timeoutMs) > 0 ? Number(toolCall.params.timeoutMs) : 4000);
          if (!isValidHostname(host)) {
            output = { error: 'Invalid host — expected a hostname or IP address.' };
            break;
          }
          // Real TCP reachability probe (cross-platform, no shell dependency).
          output = await new Promise<Record<string, any>>((resolve) => {
            const socket = new net.Socket();
            const startedAt = Date.now();
            const finish = (payload: Record<string, any>) => {
              socket.destroy();
              resolve(payload);
            };
            socket.setTimeout(timeoutMs);
            socket.once('connect', () => finish({ reachable: true, host, port, latencyMs: Date.now() - startedAt }));
            socket.once('timeout', () => finish({ reachable: false, host, port, error: `No response within ${timeoutMs}ms.` }));
            socket.once('error', (err: Error) => finish({ reachable: false, host, port, error: err.message }));
            socket.connect(port, host);
          });
          break;
        }

        case 'dns_lookup': {
          const hostname = String(toolCall.params.hostname || toolCall.params.host || toolCall.params.name || '').trim();
          const recordType = String(toolCall.params.type || toolCall.params.recordType || 'A').toUpperCase();
          if (!isValidHostname(hostname)) {
            output = { error: 'Invalid hostname — expected a domain like example.com.' };
            break;
          }
          try {
            if (recordType === 'MX') {
              output = { hostname, type: 'MX', records: await dns.promises.resolveMx(hostname) };
            } else if (recordType === 'TXT') {
              output = { hostname, type: 'TXT', records: (await dns.promises.resolveTxt(hostname)).map((chunks) => chunks.join('')) };
            } else if (recordType === 'AAAA') {
              output = { hostname, type: 'AAAA', records: await dns.promises.resolve6(hostname) };
            } else if (recordType === 'CNAME') {
              output = { hostname, type: 'CNAME', records: [await dns.promises.resolveCname(hostname)] };
            } else if (recordType === 'NS') {
              output = { hostname, type: 'NS', records: await dns.promises.resolveNs(hostname) };
            } else {
              output = { hostname, type: 'A', records: await dns.promises.resolve4(hostname) };
            }
          } catch (err: any) {
            output = { hostname, type: recordType, error: err.message };
          }
          break;
        }

        case 'download_file': {
          const url = String(toolCall.params.url || '');
          if (!/^https?:\/\//i.test(url)) {
            output = { error: 'Invalid URL — only http(s) downloads are supported.' };
            break;
          }
          let fileName: string;
          try {
            fileName = String(
              toolCall.params.filename ||
              toolCall.params.name ||
              path.basename(new URL(url).pathname) ||
              ''
            ).trim() || `download-${Date.now()}`;
          } catch {
            fileName = `download-${Date.now()}`;
          }
          // Path traversal guard: flatten to a bare filename inside workspace downloads/.
          const safeFileName = path.basename(fileName).replace(/[\\/]/g, '_').replace(/^\.+/, '') || `download-${Date.now()}`;
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!res.ok || !res.body) {
              output = { error: `Download failed with HTTP ${res.status}.` };
              break;
            }
            const declaredLength = Number(res.headers.get('content-length') || 0);
            if (declaredLength > MAX_DOWNLOAD_BYTES) {
              output = { error: 'File exceeds the 200MB download limit.' };
              break;
            }
            const downloadsDir = path.join(fsTools.getWorkspaceRoot(), 'downloads');
            fs.mkdirSync(downloadsDir, { recursive: true });
            const targetPath = path.join(downloadsDir, safeFileName);
            if (!path.resolve(targetPath).startsWith(path.resolve(downloadsDir))) {
              output = { error: 'Invalid download filename.' };
              break;
            }

            // Stream to disk with a hard size cap and backpressure.
            const writeStream = fs.createWriteStream(targetPath);
            let bytesWritten = 0;
            let aborted = false;
            try {
              for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
                bytesWritten += chunk.byteLength;
                if (bytesWritten > MAX_DOWNLOAD_BYTES) {
                  aborted = true;
                  break;
                }
                if (!writeStream.write(chunk)) {
                  await new Promise<void>((resolve) => writeStream.once('drain', () => resolve()));
                }
              }
            } finally {
              await new Promise<void>((resolve) => writeStream.end(() => resolve()));
            }
            if (aborted) {
              try { fs.rmSync(targetPath, { force: true }); } catch { /* Best-effort cleanup of the partial download. */ }
              output = { error: 'File exceeded the 200MB download limit — aborted and removed.' };
              break;
            }
            output = {
              success: true,
              path: path.relative(fsTools.getWorkspaceRoot(), targetPath).replace(/\\/g, '/'),
              bytes: bytesWritten,
            };
          } catch (err: any) {
            output = { error: `Download failed: ${err.message}` };
          }
          break;
        }

        case 'verify_http_server': {
          const port = Number(toolCall.params.port);
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            output = { error: 'Invalid port — provide an integer between 1 and 65535.' };
            break;
          }

          // Fast rejection of port 8081 (Antigravity Claude Proxy) without spawning PowerShell
          if (port === 8081) {
            output = {
              live: false,
              reachable: false,
              port,
              isExternal: true,
              error: `Port 8081 is occupied by an external proxy system (Antigravity Claude Proxy) and does NOT run workspace code. For static HTML/CSS/JS websites, SUTRA IDE serves the site directly at /workspace/index.html without needing any background server.`,
            };
            break;
          }

          const reqPath = String(toolCall.params.path || '/').replace(/^\/?/, '/');
          const timeoutMs = Math.min(10000, Math.max(500, Number(toolCall.params.timeoutMs) || 4000));
          const testUrls = [`http://127.0.0.1:${port}${reqPath}`, `http://localhost:${port}${reqPath}`];
          try {
            const ifaces = os.networkInterfaces();
            for (const name of Object.keys(ifaces)) {
              for (const iface of ifaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                  const url = `http://${iface.address}:${port}${reqPath}`;
                  if (!testUrls.includes(url)) testUrls.push(url);
                }
              }
            }
          } catch {
            // Best-effort interface discovery
          }
          let reached = false;
          let lastError = '';
          const startedAt = Date.now();

          for (const testUrl of testUrls) {
            try {
              const res = await fetch(testUrl, { signal: AbortSignal.timeout(timeoutMs) });
              reached = true;
              const text = await res.text().catch(() => '');

              // Check if response returned an external proxy system
              const isProxy = text.includes('ANTIGRAVITY CLAUDE PROXY') || text.includes('claude-proxy');
              if (isProxy) {
                output = {
                  live: false,
                  reachable: false,
                  port,
                  isExternal: true,
                  error: `Port ${port} returned an external proxy page (Antigravity Claude Proxy) and does NOT run workspace code. For static HTML/CSS/JS websites, SUTRA IDE serves the site directly at /workspace/index.html without needing any background server.`,
                };
                break;
              }

              output = {
                live: true,
                url: testUrl,
                httpStatus: res.status,
                ok: res.ok,
                latencyMs: Date.now() - startedAt,
                contentType: res.headers.get('content-type') || 'unknown',
                contentPreview: text.slice(0, 300),
                message: res.ok
                  ? `Server is LIVE and returning HTTP ${res.status} OK on port ${port}.`
                  : `Server is listening on port ${port} but returned HTTP ${res.status}.`,
              };
              break;
            } catch (err: any) {
              lastError = err?.message || 'Connection refused';
            }
          }

          if (!reached) {
            output = {
              live: false,
              port,
              error: `Could not connect to port ${port}: ${lastError}. Ensure the server was started with run_command background:true and has had time to initialize.`,
            };
          }
          break;
        }

        case 'inspect_port': {
          const port = Number(toolCall.params.port);
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            output = { error: 'Invalid port — provide an integer between 1 and 65535.' };
            break;
          }
          output = await processManager.inspectPort(port);
          break;
        }

        case 'free_port': {
          const port = Number(toolCall.params.port);
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            output = { error: 'Invalid port — provide an integer between 1 and 65535.' };
            break;
          }
          output = await processManager.freePort(port);
          break;
        }

        case 'inspect_web_page': {
          const defaultClientPort = process.env.VITE_PORT || process.env.CLIENT_PORT || 5173;
          const targetUrl = String(toolCall.params.url || `http://localhost:${defaultClientPort}`);
          const timeoutMs = Number(toolCall.params.timeoutMs) || 5000;
          try {
            output = await inspectWebPage(targetUrl, { timeoutMs });
          } catch (err: any) {
            output = { error: `Failed to inspect web page: ${err?.message || 'Unknown inspection error'}` };
          }
          break;
        }

        case 'formulate_hypothesis': {
          const strategy = String(toolCall.params.strategy || '');
          const expectedOutcome = String(toolCall.params.expectedOutcome || '');
          const falsificationCondition = String(toolCall.params.falsificationCondition || '');
          const hardwareTarget = toolCall.params.hardwareTarget ? String(toolCall.params.hardwareTarget) : undefined;
          output = hypothesisEngine.formulate({
            strategy,
            expectedOutcome,
            falsificationCondition,
            hardwareTarget,
          });
          break;
        }

        case 'evaluate_hardware_loop': {
          const before = hardwareLoopVerifier.sampleTelemetry();
          // Short active hardware probe
          const after = hardwareLoopVerifier.sampleTelemetry();
          output = hardwareLoopVerifier.evaluateDelta(before, after);
          break;
        }

        case 'discover_environment_rules': {
          const errorText = String(toolCall.params.errorText || '');
          const engine = new ReasonDiscoveryEngine(fsTools.getWorkspaceRoot());
          const discovered = engine.analyzeFailure(errorText);
          output = discovered || { message: 'No unstated environment rules deduced from error output.' };
          break;
        }

        case 'commit_best_variation': {
          const committed = await versionCommitment.commitBestVariation();
          output = committed || { message: 'No candidate variations registered to commit.' };
          break;
        }

        case 'bench_http_endpoint': {
          const defaultClientPort = process.env.VITE_PORT || process.env.CLIENT_PORT || 5173;
          const benchUrl = String(toolCall.params.url || `http://localhost:${defaultClientPort}`);
          const requestCount = Math.min(10, Math.max(1, Number.isFinite(Number(toolCall.params.requests)) ? Number(toolCall.params.requests) : 3));
          try {
            // Report only measured latencies — no invented throughput labels.
            const latenciesMs: number[] = [];
            let lastStatus: number | null = null;
            for (let i = 0; i < requestCount; i += 1) {
              const startedAt = Date.now();
              const res = await fetch(benchUrl, { signal: AbortSignal.timeout(10000) });
              await res.arrayBuffer();
              lastStatus = res.status;
              latenciesMs.push(Date.now() - startedAt);
            }
            output = {
              url: benchUrl,
              httpStatus: lastStatus,
              requests: requestCount,
              latenciesMs,
              minLatencyMs: Math.min(...latenciesMs),
              maxLatencyMs: Math.max(...latenciesMs),
              averageLatencyMs: Math.round(latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length),
            };
          } catch (err: any) {
            output = { error: `Benchmark could not reach "${benchUrl}": ${err.message}` };
          }
          break;
        }

        case 'generate_svg_asset':
          output = await mediaEngine.generateSvgAsset(toolCall.params as {
            name?: string;
            category?: string;
            description?: string;
            prompt?: string;
            filename?: string;
            style?: string;
          });
          break;

        case 'extract_color_palette': {
          // Honest behavior: only report a palette that actually exists on disk
          // (e.g. a `.palette.json` sidecar written by the media engine).
          const imagePath = String(toolCall.params.path || toolCall.params.imagePath || toolCall.params.filename || '');
          const NOT_AVAILABLE = { error: 'Palette extraction is not available for this image yet.' };
          if (!imagePath) {
            output = NOT_AVAILABLE;
            break;
          }
          try {
            const workspaceRoot = path.resolve(fsTools.getWorkspaceRoot());
            const stem = imagePath.replace(/\.(png|jpe?g|gif|webp|bmp|svg)$/i, '');
            const candidates = [`${stem}.palette.json`, `${imagePath}.json`, `${stem}-palette.json`];
            let found = false;
            for (const candidate of candidates) {
              let safePath: string;
              try {
                safePath = SecurityGuardrails.validateSafePath(candidate, workspaceRoot);
              } catch {
                continue;
              }
              if (!fs.existsSync(safePath)) continue;
              output = JSON.parse(fs.readFileSync(safePath, 'utf-8'));
              found = true;
              break;
            }
            if (!found) output = NOT_AVAILABLE;
          } catch {
            output = NOT_AVAILABLE;
          }
          break;
        }

        case 'search_web':
        case 'web_search':
        case 'google_search':
        case 'search': {
          const { webResearchEngine } = await import('./tools/webResearchTools.js');
          output = await webResearchEngine.searchWeb(toolCall.params.query, toolCall.params.limit || 5);
          break;
        }

        case 'scrape_url':
        case 'browse_url':
        case 'browse':
        case 'fetch_url':
        case 'read_url':
        case 'web_browse': {
          const { webResearchEngine } = await import('./tools/webResearchTools.js');
          output = await webResearchEngine.scrapeAndCompress(
            toolCall.params.url || toolCall.params.targetUrl,
            toolCall.params.maxContextLength || 3000,
            toolCall.params.cookies || toolCall.params.cookie || toolCall.params.cookieHeader
          );
          break;
        }

        case 'spawn_subagent': {
          output = await this.runSubagentTask(
            toolCall.params.role,
            toolCall.params.task,
            {
              modelId: toolCall.params.model || toolCall.params.modelId,
              provider: toolCall.params.provider,
            }
          );
          break;
        }

        case 'write_todos': {
          // Planning tool: the structured task list is echoed back so the model can track
          // its own progress across rounds. Persisted alongside the other planning artifacts.
          const todos = Array.isArray(toolCall.params.todos) ? toolCall.params.todos : [];
          const normalized = todos
            .filter((t: any) => t && typeof t.content === 'string')
            .map((t: any) => ({
              content: String(t.content).slice(0, 300),
              status: ['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending',
            }));
          if (normalized.length === 0) {
            output = { error: 'write_todos requires a non-empty todos array of { content, status } items.' };
            break;
          }
          const doneCount = normalized.filter((t: any) => t.status === 'completed').length;
          const planMarkdown = `# 📋 Task Execution Plan\n\n` +
            `**Progress**: ${doneCount}/${normalized.length} items completed\n\n` +
            `### Action Items\n` +
            normalized.map((t: any) => {
              const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '⏳' : '⬜';
              const checkbox = t.status === 'completed' ? '[x]' : '[ ]';
              return `- ${checkbox} ${icon} ${t.content} *(${t.status})*`;
            }).join('\n');

          try {
            const planTarget = ctx?.planFilePath || path.join(fsTools.getWorkspaceRoot(), '.sutra', 'task_plan.md');
            const parentDir = path.dirname(planTarget);
            if (!fs.existsSync(parentDir)) {
              await fs.promises.mkdir(parentDir, { recursive: true });
            }
            await fs.promises.writeFile(planTarget, planMarkdown, 'utf-8');
          } catch {
            // Plan file is internal bookkeeping; best-effort
          }

          // Auto-capture the plan as a trackable artifact (plan work-through)
          const planArtifact = captureArtifact(
            'Task Execution Plan',
            'plan',
            planMarkdown,
            doneCount === normalized.length ? 'done' : 'in_progress'
          );
          output = {
            todos: normalized,
            artifactId: planArtifact?.id,
            summary: `Plan updated: ${doneCount}/${normalized.length} completed, ${normalized.filter((t: any) => t.status === 'in_progress').length} in progress.`,
          };
          break;
        }

        case 'create_artifact': {
          let name = typeof toolCall.params.name === 'string' ? toolCall.params.name.trim() : '';
          const content = typeof toolCall.params.content === 'string' ? toolCall.params.content : '';
          const title = typeof toolCall.params.title === 'string' ? toolCall.params.title.trim() : '';

          // Text-dialect providers (ChatGPT Web and friends) frequently omit the
          // `name` field, which used to hard-fail the whole artifact. Derive a
          // stable, human title instead so the user always gets an artifact card.
          if (!name && title) name = title;
          if (!name && content) {
            const firstLine = content.split(/\r?\n/).find((l: string) => l.trim().length > 0) || '';
            const words = firstLine.replace(/^[#>\-*\s`]+/, '').trim().split(/\s+/).slice(0, 7).join(' ');
            name = words || `Artifact ${new Date().toLocaleString()}`;
          }

          if (!name || !content) {
            output = { error: 'create_artifact requires name and content.' };
            break;
          }
          const artifact = captureArtifact(
            name,
            toolCall.params.type || 'doc',
            content,
            toolCall.params.status || 'draft'
          );
          output = artifact
            ? { artifact: { id: artifact.id, name: artifact.name, type: artifact.type, status: artifact.status }, message: `Artifact "${artifact.name}" saved and visible in the Artifacts panel.` }
            : { error: 'Artifact could not be saved (workspace may be read-only).' };
          break;
        }

        case 'save_note': {
          const notePath = typeof toolCall.params.path === 'string' ? toolCall.params.path : '';
          const noteBody = typeof toolCall.params.note === 'string' ? toolCall.params.note : '';
          if (!notePath || !noteBody) {
            output = { error: 'save_note requires path and note.' };
            break;
          }
          const savedNote = saveCodeNote(notePath, noteBody);
          output = savedNote
            ? { ok: true, message: `Note recorded for ${notePath}. It will be recalled automatically in future runs.` }
            : { error: 'Could not save the note.' };
          break;
        }

        case 'update_artifact': {
          const { getArtifact, upsertArtifact } = await import('./artifacts.js');
          const existing = getArtifact(String(toolCall.params.id || toolCall.params.name || ''));
          if (!existing) {
            output = { error: `Artifact "${toolCall.params.id || toolCall.params.name}" not found.` };
            break;
          }
          const updated = upsertArtifact({
            id: existing.id,
            name: typeof toolCall.params.name === 'string' && toolCall.params.name ? toolCall.params.name : existing.name,
            type: toolCall.params.type || existing.type,
            content: typeof toolCall.params.content === 'string' && toolCall.params.content ? toolCall.params.content : existing.content,
            status: toolCall.params.status || existing.status,
          });
          output = { artifact: { id: updated.id, name: updated.name, type: updated.type, status: updated.status }, message: `Artifact "${updated.name}" updated.` };
          break;
        }

        case 'create_implementation_plan': {
          const content = String(toolCall.params.content || '');
          await fsTools.writeFile('implementation_plan.md', content);
          const art = captureArtifact('Implementation Plan', 'plan', content, 'done');
          output = { file: 'implementation_plan.md', artifactId: art?.id, status: 'created/updated', message: 'Implementation plan saved to workspace and recorded in Artifacts panel.' };
          break;
        }

        case 'update_task_progress': {
          const content = String(toolCall.params.content || '');
          await fsTools.writeFile('task_progress.md', content);
          const art = captureArtifact('Task Progress', 'plan', content, 'in_progress');
          output = { file: 'task_progress.md', artifactId: art?.id, status: 'updated', message: 'Task progress roadmap updated and recorded in Artifacts panel.' };
          break;
        }

        case 'create_walkthrough': {
          const content = String(toolCall.params.content || '');
          await fsTools.writeFile('walkthrough.md', content);
          const art = captureArtifact('Walkthrough', 'verification', content, 'done');
          output = { file: 'walkthrough.md', artifactId: art?.id, status: 'created/updated', message: 'Walkthrough and verification log saved and recorded in Artifacts panel.' };
          break;
        }

        case 'create_findings_report':
        case 'record_findings':
        case 'create_audit_report': {
          const title = String(toolCall.params.title || toolCall.params.name || 'Diagnostic Findings');
          const content = String(toolCall.params.content || toolCall.params.report || toolCall.params.findings || '');
          const filename = String(toolCall.params.filename || 'findings.md');
          if (content) {
            await fsTools.writeFile(filename, content);
            const artifact = captureArtifact(title, 'findings', content, 'done');
            output = {
              success: true,
              file: filename,
              artifactId: artifact?.id,
              message: `Findings report "${title}" written to ${filename} and recorded as an artifact.`,
            };
          } else {
            output = { error: 'create_findings_report requires report content.' };
          }
          break;
        }

        case 'create_markdown_doc':
        case 'write_documentation': {
          const docPath = String(toolCall.params.path || '');
          const title = String(toolCall.params.title || path.basename(docPath, '.md'));
          const content = String(toolCall.params.content || '');
          if (!docPath || !content) {
            output = { error: 'create_markdown_doc requires path and content.' };
            break;
          }
          const targetPath = docPath.endsWith('.md') ? docPath : `${docPath}.md`;
          await fsTools.writeFile(targetPath, content);
          const artifact = captureArtifact(
            title || path.basename(targetPath),
            (toolCall.params.category as any) || 'doc',
            content,
            'done'
          );
          output = {
            file: targetPath,
            artifactId: artifact?.id,
            status: 'created',
            message: `Markdown document "${targetPath}" created and registered in Artifacts.`,
          };
          break;
        }

        case 'recall_memories':
        case 'search_memories': {
          const { searchMemories, listMemories } = await import('./harness/memory.js');
          const query = typeof toolCall.params.query === 'string' ? toolCall.params.query : '';
          const kind = toolCall.params.kind as any;
          const limit = typeof toolCall.params.limit === 'number' ? toolCall.params.limit : 10;
          const memories = query
            ? searchMemories({ query, kind, workspaceRoot: fsTools.getWorkspaceRoot(), limit })
            : listMemories({ workspaceRoot: fsTools.getWorkspaceRoot(), limit });
          output = {
            count: memories.length,
            memories: memories.map((m) => ({
              id: m.id,
              kind: m.kind,
              content: m.content,
              useCount: m.useCount,
            })),
          };
          break;
        }

        case 'store_memory':
        case 'remember': {
          const { rememberMemory } = await import('./harness/memory.js');
          const kind = (typeof toolCall.params.kind === 'string' ? toolCall.params.kind : 'lesson') as any;
          const content = typeof toolCall.params.content === 'string' ? toolCall.params.content : '';
          if (!content) {
            output = { error: 'store_memory requires content.' };
            break;
          }
          const entry = rememberMemory({ kind, content, workspaceRoot: fsTools.getWorkspaceRoot() });
          output = {
            success: true,
            memory: entry ? { id: entry.id, kind: entry.kind, content: entry.content } : null,
            message: `Memory stored [${kind}]: "${content}"`,
          };
          break;
        }

        case 'forget_memory': {
          const { forgetMemory } = await import('./harness/memory.js');
          const id = Number(toolCall.params.id);
          if (!id) {
            output = { error: 'forget_memory requires a numeric memory id.' };
            break;
          }
          const deleted = forgetMemory(id);
          output = deleted
            ? { success: true, message: `Memory #${id} deleted.` }
            : { error: `Memory #${id} not found.` };
          break;
        }

        case 'list_memories': {
          const { listMemories } = await import('./harness/memory.js');
          const limit = typeof toolCall.params.limit === 'number' ? toolCall.params.limit : 25;
          const memories = listMemories({ workspaceRoot: fsTools.getWorkspaceRoot(), limit });
          output = {
            count: memories.length,
            memories: memories.map((m) => ({
              id: m.id,
              kind: m.kind,
              content: m.content,
              useCount: m.useCount,
            })),
          };
          break;
        }

        case 'update_working_memory':
        case 'set_working_memory': {
          const { updateWorkingMemory } = await import('./harness/memory.js');
          const chatId = String(toolCall.params.chatId || 'default');
          const updated = updateWorkingMemory(
            chatId,
            {
              activeGoal: toolCall.params.activeGoal,
              subgoals: Array.isArray(toolCall.params.subgoals) ? toolCall.params.subgoals : undefined,
              activeInvariants: Array.isArray(toolCall.params.activeInvariants) ? toolCall.params.activeInvariants : undefined,
              workingHypotheses: Array.isArray(toolCall.params.workingHypotheses) ? toolCall.params.workingHypotheses : undefined,
              groundedFiles: Array.isArray(toolCall.params.groundedFiles) ? toolCall.params.groundedFiles : undefined,
              scratchpad: typeof toolCall.params.scratchpad === 'string' ? toolCall.params.scratchpad : undefined,
            },
            fsTools.getWorkspaceRoot()
          );
          output = {
            success: true,
            workingMemory: updated,
            message: 'Working memory scratchpad updated.',
          };
          break;
        }

        case 'get_working_memory': {
          const { getWorkingMemory } = await import('./harness/memory.js');
          const chatId = String(toolCall.params.chatId || 'default');
          const wm = getWorkingMemory(chatId, fsTools.getWorkspaceRoot());
          output = {
            chatId: wm.chatId,
            activeGoal: wm.activeGoal,
            subgoals: wm.subgoals,
            activeInvariants: wm.activeInvariants,
            workingHypotheses: wm.workingHypotheses,
            groundedFiles: wm.groundedFiles,
            scratchpad: wm.scratchpad,
          };
          break;
        }

        case 'record_procedural_recipe':
        case 'store_recipe': {
          const { recordProceduralRecipe } = await import('./harness/memory.js');
          const name = String(toolCall.params.name || '').trim();
          const triggerPattern = String(toolCall.params.triggerPattern || toolCall.params.trigger || '').trim();
          if (!name || !triggerPattern) {
            output = { error: 'record_procedural_recipe requires name and triggerPattern.' };
            break;
          }
          const steps = Array.isArray(toolCall.params.steps) ? toolCall.params.steps : [];
          const recipe = recordProceduralRecipe({
            name,
            triggerPattern,
            prerequisites: Array.isArray(toolCall.params.prerequisites) ? toolCall.params.prerequisites : [],
            steps,
            verificationAssertions: Array.isArray(toolCall.params.verificationAssertions) ? toolCall.params.verificationAssertions : [],
            workspaceRoot: fsTools.getWorkspaceRoot(),
          });
          output = {
            success: true,
            recipeId: recipe.id,
            name: recipe.name,
            message: `Procedural recipe "${recipe.name}" saved with ${recipe.steps.length} step(s).`,
          };
          break;
        }

        case 'recall_procedural_recipes':
        case 'find_recipes': {
          const { findProceduralRecipes } = await import('./harness/memory.js');
          const query = String(toolCall.params.query || toolCall.params.task || '');
          const limit = typeof toolCall.params.limit === 'number' ? toolCall.params.limit : 3;
          const recipes = findProceduralRecipes(query, fsTools.getWorkspaceRoot(), limit);
          output = {
            count: recipes.length,
            recipes,
          };
          break;
        }

        case 'record_episodic_episode': {
          const { recordEpisodicEpisode } = await import('./harness/memory.js');
          const taskQuery = String(toolCall.params.taskQuery || toolCall.params.task || '').trim();
          const actionSummary = String(toolCall.params.actionSummary || toolCall.params.summary || '').trim();
          if (!taskQuery || !actionSummary) {
            output = { error: 'record_episodic_episode requires taskQuery and actionSummary.' };
            break;
          }
          const episode = recordEpisodicEpisode({
            taskQuery,
            actionSummary,
            trajectory: Array.isArray(toolCall.params.trajectory) ? toolCall.params.trajectory : [],
            toolsUsed: Array.isArray(toolCall.params.toolsUsed) ? toolCall.params.toolsUsed : [],
            outcome: ['success', 'failure', 'partial'].includes(toolCall.params.outcome) ? toolCall.params.outcome : 'success',
            fitnessScore: typeof toolCall.params.fitnessScore === 'number' ? toolCall.params.fitnessScore : 1.0,
            lessonsLearned: Array.isArray(toolCall.params.lessonsLearned) ? toolCall.params.lessonsLearned : [],
            workspaceRoot: fsTools.getWorkspaceRoot(),
          });
          output = {
            success: true,
            episodeId: episode.id,
            message: `Episodic experience recorded for task: "${taskQuery}"`,
          };
          break;
        }

        default: {
          const { mcpClient } = await import('./mcp/mcpClient.js');
          const registered = mcpClient.getRegisteredTools();
          const isMcp = toolCall.tool.startsWith('mcp_') || registered.some((t) => t.name === toolCall.tool);
          if (isMcp) {
            try {
              const res = await mcpClient.callTool(toolCall.tool, toolCall.params);
              output = {
                tool: toolCall.tool,
                result: res,
              };
              break;
            } catch (mcpErr: any) {
              output = {
                error: mcpErr.message || 'MCP Tool Execution Failed',
                code: mcpErr.code || 'unknown',
              };
              break;
            }
          }
          throw new Error(`Unknown tool "${toolCall.tool}" requested.`);
        }
      }

      toolCall.status = 'completed';
      toolCall.result = output;
      return output;
    } catch (err: any) {
      toolCall.status = 'failed';
      toolCall.error = err.message;
      const { classifyToolError } = await import('./harness/toolError.js');
      const structured = classifyToolError(err);
      return { error: structured.message, code: structured.code, retryable: structured.retryable, detail: structured.detail };
    }
  }

  /**
   * Registers a tool call awaiting user approval so /api/swarm/approve-tool can
   * find and execute it when the decision arrives.
   */
  public queuePendingApproval(toolCall: ToolCallPayload): void {
    toolCall.status = 'pending';
    this.pendingApprovals.set(toolCall.id, toolCall);
  }

  public approveToolCall(toolCallId: string): Promise<any> {
    const call = this.pendingApprovals.get(toolCallId);
    if (!call) {
      throw new Error(`Pending approval not found for toolCallId ${toolCallId}`);
    }
    call.status = 'approved';
    this.pendingApprovals.delete(toolCallId);
    return this.executeTool(call);
  }

  public rejectToolCall(toolCallId: string): void {
    const call = this.pendingApprovals.get(toolCallId);
    if (call) {
      call.status = 'rejected';
      this.pendingApprovals.delete(toolCallId);
    }
  }

  public getPendingApprovals(): ToolCallPayload[] {
    return Array.from(this.pendingApprovals.values());
  }
}

export const agentSwarm = new AgentSwarmOrchestrator();
