import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface WatchdogTaskOptions {
  taskId: string;
  command: string;
  cwd?: string;
  maxStallMs?: number;       // Max ms without output before flagging stalled (default: 45s)
  hardTimeoutMs?: number;    // Absolute max runtime before termination (default: 300s)
  maxRetries?: number;       // Max auto-retries (default: 3)
  isDaemon?: boolean;        // If true, disables stall and hard timeouts for persistent dev servers
}

export interface WatchdogEvent {
  taskId: string;
  reason: 'interactive_prompt' | 'stall_timeout' | 'hard_timeout' | 'error';
  details: string;
  promptType?: string;
}

export class TaskWatchdog extends EventEmitter {
  private activeTasks: Map<string, {
    proc?: ChildProcess;
    command: string;
    cwd?: string;
    startedAt: number;
    lastActivity: number;
    attempt: number;
    maxRetries: number;
    isDaemon: boolean;
    maxStallMs: number;
    stallTimer?: NodeJS.Timeout | null;
    hardTimer?: NodeJS.Timeout | null;
  }> = new Map();

  /** Interactive prompt patterns that cause unattended background processes to deadlock */
  private static INTERACTIVE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /\[y\/n\]/i, type: 'yes_no_confirmation' },
    { pattern: /\(y\/n\)/i, type: 'yes_no_confirmation' },
    { pattern: /\[yes\/no\]/i, type: 'yes_no_confirmation' },
    { pattern: /\(yes\/no\)/i, type: 'yes_no_confirmation' },
    { pattern: /password:\s*$/i, type: 'password_prompt' },
    { pattern: /enter passphrase/i, type: 'passphrase_prompt' },
    { pattern: /press (?:any key|enter) to continue/i, type: 'pause_prompt' },
    { pattern: /do you want to continue\?/i, type: 'continue_prompt' },
    { pattern: /are you sure you want to proceed\?/i, type: 'confirmation_prompt' },
    { pattern: /terminate batch job \(y\/n\)\?/i, type: 'batch_abort_prompt' },
    { pattern: /overwrite\s+.*?\?\s*\(y\/n\)/i, type: 'overwrite_prompt' },
  ];

  /**
   * Scans a chunk of stdout/stderr for interactive prompt patterns.
   * Resets the stall timer on any output.
   */
  public inspectChunk(taskId: string, chunk: string): { isInteractive: boolean; promptType?: string; matchedText?: string } {
    if (!chunk || typeof chunk !== 'string') return { isInteractive: false };

    const task = this.activeTasks.get(taskId);
    if (task) {
      task.lastActivity = Date.now();
      // Reset stall timer on active output for non-daemons
      if (task.stallTimer && !task.isDaemon) {
        clearTimeout(task.stallTimer);
        task.stallTimer = setTimeout(() => {
          this.handleStall(taskId);
        }, task.maxStallMs);
      }
    }

    // If stdin is already closed or not writable, the process cannot wait for input
    if (task?.proc?.stdin && !task.proc.stdin.writable) {
      return { isInteractive: false };
    }

    const trimmed = chunk.trim();
    // Only check trailing line of output (prompts wait at the end of the line)
    const lastLine = trimmed.split('\n').pop()?.trim() || '';
    if (!lastLine) return { isInteractive: false };

    // Ignore Windows batch exit prompt "Terminate batch job (Y/N)?"
    if (/terminate batch job/i.test(lastLine)) {
      return { isInteractive: false };
    }

    for (const { pattern, type } of TaskWatchdog.INTERACTIVE_PATTERNS) {
      if (type === 'batch_abort_prompt') continue;
      if (pattern.test(lastLine)) {
        return { isInteractive: true, promptType: type, matchedText: lastLine.slice(-100) };
      }
    }

    return { isInteractive: false };
  }

  /** Registers a running child process with the watchdog */
  public trackProcess(
    taskId: string,
    proc: ChildProcess,
    opts: { command: string; cwd?: string; maxStallMs?: number; hardTimeoutMs?: number; maxRetries?: number; isDaemon?: boolean }
  ): void {
    const isDaemon = Boolean(opts.isDaemon);
    const maxStallMs = opts.maxStallMs ?? 45000;
    const hardTimeoutMs = opts.hardTimeoutMs ?? 300000;
    const maxRetries = opts.maxRetries ?? 3;

    const existing = this.activeTasks.get(taskId);
    const attempt = existing ? existing.attempt : 1;

    // Clear previous timers if any
    if (existing?.stallTimer) clearTimeout(existing.stallTimer);
    if (existing?.hardTimer) clearTimeout(existing.hardTimer);

    const stallTimer = (!isDaemon && maxStallMs > 0)
      ? setTimeout(() => {
          this.handleStall(taskId);
        }, maxStallMs)
      : null;

    const hardTimer = (!isDaemon && hardTimeoutMs > 0)
      ? setTimeout(() => {
          this.handleHardTimeout(taskId);
        }, hardTimeoutMs)
      : null;

    this.activeTasks.set(taskId, {
      proc,
      command: opts.command,
      cwd: opts.cwd,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      attempt,
      maxRetries,
      isDaemon,
      maxStallMs,
      stallTimer,
      hardTimer,
    });

    proc.on('close', () => {
      this.untrack(taskId);
    });
    proc.on('error', () => {
      this.untrack(taskId);
    });
  }

  /** Stops tracking a completed or killed task */
  public untrack(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (task) {
      if (task.stallTimer) clearTimeout(task.stallTimer);
      if (task.hardTimer) clearTimeout(task.hardTimer);
      this.activeTasks.delete(taskId);
    }
  }

  private handleStall(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    this.emit('stalled', {
      taskId,
      reason: 'stall_timeout',
      details: `Task produced zero output for 45s and is considered deadlocked.`,
    });

    if (task.proc) {
      this.terminateProcessTree(task.proc);
    }
  }

  private handleHardTimeout(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    this.emit('timedOut', {
      taskId,
      reason: 'hard_timeout',
      details: `Task exceeded maximum runtime budget.`,
    });

    if (task.proc) {
      this.terminateProcessTree(task.proc);
    }
  }

  /**
   * Two-stage clean process termination:
   * Graceful SIGTERM, then hard OS tree kill (taskkill /PID /T /F on Windows, SIGKILL on POSIX)
   */
  public async terminateProcessTree(proc: ChildProcess): Promise<void> {
    if (!proc.pid || proc.exitCode !== null) return;

    if (process.platform === 'win32') {
      return new Promise<void>((resolve) => {
        try {
          const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('close', () => resolve());
          killer.on('error', () => resolve());
        } catch {
          resolve();
        }
      });
    } else {
      try {
        // Kill process group
        process.kill(-proc.pid, 'SIGTERM');
        setTimeout(() => {
          try {
            if (proc.exitCode === null) {
              process.kill(-proc.pid!, 'SIGKILL');
            }
          } catch {
            // Already gone
          }
        }, 1500);
      } catch {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Already gone
        }
      }
    }
  }

  /**
   * Intelligently mutates a command for automated non-interactive retry
   */
  public mutateCommandForRetry(cmd: string, attempt: number): string {
    let mutated = cmd.trim();

    // 1. Package manager non-interactive flags
    if (/\bnpm\s+(?:install|i)\b/.test(mutated) && !mutated.includes('--yes') && !mutated.includes('-y')) {
      mutated = mutated.replace(/\bnpm\s+(?:install|i)\b/, 'npm install --yes --no-audit --prefer-offline');
    }
    if (/\bnpm\s+init\b/.test(mutated) && !mutated.includes('-y')) {
      mutated = mutated.replace(/\bnpm\s+init\b/, 'npm init -y');
    }
    if (/\bnpx\b/.test(mutated) && !mutated.includes('--yes') && !mutated.includes('-y')) {
      mutated = mutated.replace(/\bnpx\b/, 'npx --yes');
    }
    if (/\bpip3?\s+install\b/.test(mutated) && !mutated.includes('--no-input')) {
      mutated = mutated.replace(/\bpip3?\s+install\b/, '$& --no-input --disable-pip-version-check');
    }
    if (/\bgit\b/.test(mutated) && !mutated.includes('-c core.askPass=')) {
      mutated = `git -c core.askPass=echo -c credential.helper= ${mutated.replace(/^git\s+/, '')}`;
    }

    // 2. Add CI and non-interactive environment variables
    const isWindows = process.platform === 'win32';
    if (!mutated.includes('CI=')) {
      if (isWindows) {
        mutated = `$env:CI='true'; $env:DEBIAN_FRONTEND='noninteractive'; ${mutated}`;
      } else {
        mutated = `CI=true DEBIAN_FRONTEND=noninteractive ${mutated}`;
      }
    }

    return mutated;
  }
}

export const taskWatchdog = new TaskWatchdog();
