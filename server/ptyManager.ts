import * as pty from 'node-pty';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import { WSChannel, createPacket } from './wsProtocol.js';
import { SecurityGuardrails } from './security/guardrails.js';

export class PTYManager {
  private activePtyProcesses: Map<string, pty.IPty> = new Map();
  private workspaceRoot: string = process.cwd();

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Spawns a true interactive ConPTY session via node-pty
   */
  public createSession(sessionId: string, clientWs: WebSocket, cols = 80, rows = 24): void {
    // Terminate any existing session with this ID
    this.killSession(sessionId);

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || 'bash');
    const args = isWindows ? ['-NoLogo'] : [];

    try {
      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: Math.max(cols, 10),
        rows: Math.max(rows, 5),
        cwd: this.workspaceRoot,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as any,
        useConpty: isWindows,
      });

      this.activePtyProcesses.set(sessionId, ptyProcess);

      ptyProcess.onData((data: string) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(createPacket(WSChannel.PTY_OUTPUT, 'data', data));
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        this.activePtyProcesses.delete(sessionId);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(createPacket(WSChannel.PTY_OUTPUT, 'exit', { code: exitCode }));
        }
      });

      // Welcome banner
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          createPacket(
            WSChannel.PTY_OUTPUT,
            'data',
            `\r\n\x1b[38;2;59;130;246m SUTRA Native Terminal (Windows ConPTY / PowerShell)\x1b[0m\r\n\x1b[38;2;113;113;122m Workspace: ${this.workspaceRoot}\x1b[0m\r\n\r\n`
          )
        );
      }
    } catch (err: any) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          createPacket(
            WSChannel.PTY_OUTPUT,
            'data',
            `\r\n\x1b[31mFailed to spawn terminal: ${err.message}\x1b[0m\r\n`
          )
        );
      }
    }
  }

  public writeData(sessionId: string, data: string): void {
    const proc = this.activePtyProcesses.get(sessionId);
    if (proc) {
      proc.write(data);
    }
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const proc = this.activePtyProcesses.get(sessionId);
    if (proc && cols > 0 && rows > 0) {
      try {
        proc.resize(Math.max(cols, 10), Math.max(rows, 5));
      } catch {
        // Ignore resize error on exit
      }
    }
  }

  public killSession(sessionId: string): void {
    const proc = this.activePtyProcesses.get(sessionId);
    if (proc) {
      try {
        proc.kill();
      } catch {
        // Process may already be dead — session cleanup below still runs.
      }
      this.activePtyProcesses.delete(sessionId);
    }
  }

  private backgroundProcesses: Map<string, {
    id: string;
    pid: number;
    command: string;
    name: string;
    startTime: number;
    logs: string[];
    child: any;
  }> = new Map();

  private completedProcesses: Map<string, {
    id: string;
    pid: number;
    command: string;
    name: string;
    startTime: number;
    endTime: number;
    exitCode: number | null;
    logs: string[];
  }> = new Map();

  /**
   * Spawns a resilient background process, waits for initial startup verification, and captures streaming logs.
   */
  public async runBackgroundProcess(
    command: string,
    name?: string,
    cwd?: string,
    waitMsBeforeAsync = 3000
  ): Promise<{ status: string; taskId: string; pid: number; name: string; initialLogs: string }> {
    // The agent can reach this directly via the `run_background_process` tool, which
    // bypasses executeCommand's guardrail check, so validate here too.
    const safetyCheck = SecurityGuardrails.validateCommandSafety(command, this.workspaceRoot);
    if (!safetyCheck.safe) {
      throw new Error(safetyCheck.reason || 'Command blocked by security guardrails.');
    }

    const taskId = `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const effectiveName = name || command.slice(0, 30);
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : 'bash';
    const args = isWindows 
      ? ['/d', '/s', '/c', command]
      : ['-c', command];

    const effectiveCwd = cwd ? SecurityGuardrails.validateSafePath(cwd, this.workspaceRoot) : this.workspaceRoot;

    const child = spawn(shell, args, {
      cwd: effectiveCwd,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '1' },
      detached: false,
    });

    const logs: string[] = [];
    const appendLog = (chunk: string) => {
      const lines = chunk.split('\n').filter(Boolean);
      for (const line of lines) {
        logs.push(`[${new Date().toLocaleTimeString()}] ${line}`);
        if (logs.length > 200) logs.shift(); // Retain rolling 200 lines
      }
    };

    child.stdout?.on('data', (d) => appendLog(d.toString('utf-8')));
    child.stderr?.on('data', (d) => appendLog(d.toString('utf-8')));

    const taskEntry = {
      id: taskId,
      pid: child.pid || 0,
      command,
      name: effectiveName,
      startTime: Date.now(),
      logs,
      child,
    };
    this.backgroundProcesses.set(taskId, taskEntry);

    child.on('close', (code) => {
      appendLog(`[Process Exited with code ${code}]`);
      this.backgroundProcesses.delete(taskId);
      this.completedProcesses.set(taskId, {
        id: taskId,
        pid: taskEntry.pid,
        command: taskEntry.command,
        name: taskEntry.name,
        startTime: taskEntry.startTime,
        endTime: Date.now(),
        exitCode: code,
        logs: [...logs],
      });
      if (this.completedProcesses.size > 50) {
        const oldestKey = this.completedProcesses.keys().next().value;
        if (oldestKey) this.completedProcesses.delete(oldestKey);
      }
    });

    child.on('error', (err) => {
      appendLog(`[Process Error: ${err.message}]`);
      this.backgroundProcesses.delete(taskId);
      this.completedProcesses.set(taskId, {
        id: taskId,
        pid: taskEntry.pid,
        command: taskEntry.command,
        name: taskEntry.name,
        startTime: taskEntry.startTime,
        endTime: Date.now(),
        exitCode: -1,
        logs: [...logs],
      });
      if (this.completedProcesses.size > 50) {
        const oldestKey = this.completedProcesses.keys().next().value;
        if (oldestKey) this.completedProcesses.delete(oldestKey);
      }
    });

    // Wait waitMsBeforeAsync to verify successful boot and capture startup banners/port output
    await new Promise((r) => setTimeout(r, waitMsBeforeAsync));

    const initialLogs = logs.join('\n') || `Process ${effectiveName} started successfully in background.`;
    return {
      status: 'running_in_background',
      taskId,
      pid: child.pid || 0,
      name: effectiveName,
      initialLogs,
    };
  }

  public listRunningProcesses(): Array<{
    id: string;
    pid: number;
    command: string;
    name: string;
    runtimeSeconds: number;
    lastLog: string;
  }> {
    const now = Date.now();
    return Array.from(this.backgroundProcesses.values()).map((p) => ({
      id: p.id,
      pid: p.pid,
      command: p.command,
      name: p.name,
      runtimeSeconds: Math.floor((now - p.startTime) / 1000),
      lastLog: p.logs.slice(-3).join('\n') || 'Running...',
    }));
  }

  public getProcessLogs(processId: string, maxLines = 50): { id: string; logs: string; isRunning: boolean } {
    const proc = this.backgroundProcesses.get(processId) || 
      Array.from(this.backgroundProcesses.values()).find((p) => p.name === processId || p.pid.toString() === processId);

    if (proc) {
      return {
        id: proc.id,
        logs: proc.logs.slice(-maxLines).join('\n'),
        isRunning: true,
      };
    }

    const completed = this.completedProcesses.get(processId) ||
      Array.from(this.completedProcesses.values()).find((p) => p.name === processId || p.pid.toString() === processId);

    if (completed) {
      return {
        id: completed.id,
        logs: completed.logs.slice(-maxLines).join('\n'),
        isRunning: false,
      };
    }

    return { id: processId, logs: `Process ${processId} not found or has already terminated.`, isRunning: false };
  }

  public killProcess(processId: string): { success: boolean; message: string } {
    const proc = this.backgroundProcesses.get(processId) || 
      Array.from(this.backgroundProcesses.values()).find((p) => p.name === processId || p.pid.toString() === processId);

    if (!proc) {
      return { success: false, message: `Background task "${processId}" is not currently running or managed by PTYManager.` };
    }

    try {
      if (process.platform === 'win32' && proc.pid) {
        spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
      } else if (proc.child) {
        proc.child.kill('SIGKILL');
      }
      this.backgroundProcesses.delete(proc.id);
      return { success: true, message: `Successfully terminated process ${proc.name} (PID: ${proc.pid}).` };
    } catch (err: any) {
      return { success: false, message: `Error terminating process ${proc.name}: ${err.message}` };
    }
  }

  /**
   * One-shot command execution for autonomous agents with Security Guardrails and Timeout Guard
   */
  public async executeCommand(
    command: string, 
    cwd?: string, 
    timeoutMs = 90000,
    isBackground = false,
    waitMsBeforeAsync = 3000
  ): Promise<{ stdout: string; stderr: string; exitCode: number; taskId?: string; isBackground?: boolean }> {
    const safetyCheck = SecurityGuardrails.validateCommandSafety(command, this.workspaceRoot);
    if (!safetyCheck.safe) {
      return {
        stdout: '',
        stderr: safetyCheck.reason || 'Command blocked by security guardrails.',
        exitCode: 1,
      };
    }

    // Auto-detect dev server or daemon commands (vite, npm run dev, python -m http.server, etc.)
    const isDaemonIntent = isBackground || /^(npm\s+(?:run\s+)?(?:dev|start|serve)|npx\s+(?:vite|nodemon|next|live-server)|python\s+.*(?:app|server)\.py|node\s+.*(?:server|index)\.js)/i.test(command.trim());

    if (isDaemonIntent) {
      const bg = await this.runBackgroundProcess(command, undefined, cwd, waitMsBeforeAsync);
      return {
        stdout: bg.initialLogs,
        stderr: '',
        exitCode: 0,
        taskId: bg.taskId,
        isBackground: true,
      };
    }

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : 'bash';
      const args = isWindows 
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ProgressPreference = 'SilentlyContinue'; ${command}; if (-not $?) { if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } else { exit 1 } }`] 
        : ['-c', command];

      const effectiveCwd = cwd ? SecurityGuardrails.validateSafePath(cwd, this.workspaceRoot) : this.workspaceRoot;

      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const child = spawn(shell, args, {
        cwd: effectiveCwd,
        env: { ...process.env, CI: 'true' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d) => {
        stdout += d.toString('utf-8');
      });

      child.stderr?.on('data', (d) => {
        stderr += d.toString('utf-8');
      });

      const finish = (code: number | null, errMessage?: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);

        if (errMessage) {
          stderr += (stderr ? '\n' : '') + errMessage;
        }

        const cleanStdout = SecurityGuardrails.truncateToolOutput(SecurityGuardrails.redactSecrets(stdout), 15000);
        const cleanStderr = SecurityGuardrails.truncateToolOutput(SecurityGuardrails.redactSecrets(stderr), 15000);
        resolve({ stdout: cleanStdout, stderr: cleanStderr, exitCode: code ?? (errMessage ? 1 : 0) });
      };

      timer = setTimeout(() => {
        try {
          if (isWindows && child.pid) {
            spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // Best-effort kill — the timeout result is reported regardless.
        }
        finish(124, `[TIMEOUT] Command exceeded maximum execution time of ${Math.round(timeoutMs / 1000)}s.`);
      }, timeoutMs);

      child.on('close', (code) => {
        finish(code);
      });

      child.on('error', (err) => {
        finish(1, `Process spawn error: ${err.message}`);
      });
    });
  }
}

export const ptyManager = new PTYManager();
