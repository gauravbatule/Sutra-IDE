import net from 'net';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface ManagedProcess {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number | null;
  port: number | null;
  status: 'starting' | 'running' | 'exited' | 'failed' | 'stopped';
  startedAt: number;
  lastError: string | null;
  attempts: number;
  chatId?: string | null;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2500;
/** Cap on how many processes we keep in the roster. Completed ones are
 *  dropped oldest-first so a long session doesn't grow the map (and the
 *  per-poll payload) without bound. */
const MAX_TRACKED_PROCESSES = 50;

/**
 * Tracks long-running processes the agent starts (dev servers, watchers).
 * Detects the listening port, verifies liveness, and auto-retries a failed
 * start so "it tried but is not running" self-heals instead of dead-ending.
 */
class ProcessManager {
  private processes: Map<string, ManagedProcess & { child?: ChildProcess }> = new Map();

  /** Extracts a port from common CLI flags or common framework defaults for genuine server launch commands. */
  public detectPort(command: string, args: string[] = []): number | null {
    const joined = `${command} ${args.join(' ')}`.trim();

    // 0. Exclude diagnostic, search, kill, and build commands from port detection
    if (/\b(?:findstr|grep|netstat|taskkill|kill|ps|lsof|git|test|vitest|jest|tsc|typecheck|lint|eslint|echo|cat|head|tail|curl|wget)\b/i.test(joined)) {
      return null;
    }

    // 1. Explicit port flags or environment variables: --port 8000, -p 8080, PORT=3000
    const flagMatch = joined.match(/(?:--port|-p|PORT=)\s*(\d{2,5})/i);
    if (flagMatch) {
      const p = Number(flagMatch[1]);
      if (p >= 80 && p <= 65535) return p;
    }

    // 2. Python http.server: python -m http.server 8000
    const pyHttpMatch = joined.match(/http\.server(?:\s+(\d{2,5}))?/i);
    if (pyHttpMatch) return pyHttpMatch[1] ? Number(pyHttpMatch[1]) : 8000;

    // 3. Explicit IP/host ports or :PORT on server launches: localhost:8000, 127.0.0.1:8080, :9000
    const hostMatch = joined.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:\s*(\d{2,5})\b/i);
    if (hostMatch) {
      const p = Number(hostMatch[1]);
      if (p >= 80 && p <= 65535) return p;
    }

    // 4. Framework defaults (only on genuine dev/start commands)
    if (/\b(?:vite|astro)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?dev\b/i.test(joined)) return 5173;
    if (/\bnext\s+(?:dev|start)\b/i.test(joined)) return 3000;
    if (/\bserve\b|http-server|live-server/i.test(joined)) return 3000;
    if (/\bflask\s+run\b|python.*app\.py/i.test(joined)) return 5000;
    if (/\buvicorn\b|fastapi/i.test(joined)) return 8000;
    if (/\bexpress\b|node.*(?:server|app|index)\.[cm]?js/i.test(joined) && !/\btest\b/i.test(joined)) return 3000;
    return null;
  }

  private isLongRunning(command: string, args: string[]): boolean {
    const joined = `${command} ${args.join(' ')}`;
    // Exclude diagnostic and batch commands
    if (/\b(?:findstr|grep|netstat|taskkill|kill|ps|lsof|git|test|vitest|jest|tsc|typecheck|lint|eslint|echo|cat|head|tail)\b/i.test(joined)) {
      return false;
    }
    return /\b(dev|start|serve|preview|watch|run dev|run start)\b/i.test(joined) || this.detectPort(command, args) !== null;
  }

  /** Registers a command the agent is about to run; long-running ones get managed.
   *
   *  The child handle MUST be stored: without it `stop()` has no pid to signal
   *  and `verify()` cannot tell a live process from a dead one, so terminated
   *  dev servers were reported "running" forever and could never be killed. */
  public register(command: string, args: string[], cwd: string, child?: ChildProcess, chatId?: string | null): ManagedProcess | null {
    if (!this.isLongRunning(command, args)) return null;
    const id = `proc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const entry: ManagedProcess & { child?: ChildProcess } = {
      id,
      command,
      args,
      cwd: cwd || '.',
      pid: child?.pid ?? null,
      port: this.detectPort(command, args),
      status: 'starting',
      startedAt: Date.now(),
      lastError: null,
      attempts: 1,
      child,
      chatId: chatId || null,
    };
    this.processes.set(id, entry);

    // Track the real lifecycle so `alive` is derived from the OS, not guessed.
    if (child) {
      child.on('exit', (code, signal) => {
        entry.status = 'exited';
        entry.lastError =
          code === 0 || code === null
            ? entry.lastError
            : `Exited with code ${code}${signal ? ` (${signal})` : ''}.`;
      });
      child.on('error', (err: Error) => {
        entry.status = 'failed';
        entry.lastError = err?.message || 'Process spawn error';
      });
    }

    // Keep the map bounded — without this the roster grows for the life of
    // the server and every Activity poll re-serialises dead entries.
    this.reap();

    // Give the server a moment, then verify it is actually listening
    setTimeout(() => void this.verify(id), 4000);
    return entry;
  }

  /**
   * One-click launcher for dev servers and preview environments.
   * Checks if port is already open; if not, spawns the server and verifies port liveness.
   */
  public async launch(command: string, args: string[], cwd: string, expectedPort?: number, chatId?: string | null): Promise<{ success: boolean; port: number | null; error?: string }> {
    const resolvedCwd = cwd || '.';
    const port = expectedPort || this.detectPort(command, args);

    // If port is already active AND owned by THIS workspace, return immediately
    if (port) {
      const isOwned = await this.isPortOwnedByWorkspace(port, resolvedCwd);
      if (isOwned) {
        return { success: true, port };
      }
    }

    // Stop any stale processes previously started for this cwd
    const normCwd = path.resolve(resolvedCwd).toLowerCase().replace(/\\/g, '/');
    for (const [id, proc] of this.processes.entries()) {
      const normProcCwd = path.resolve(proc.cwd).toLowerCase().replace(/\\/g, '/');
      if (normProcCwd === normCwd && (proc.status === 'running' || proc.status === 'starting')) {
        this.stop(id);
      }
    }

    try {
      const isWin = process.platform === 'win32';
      const cmdLine = args.length > 0 ? `${command} ${args.map((a) => (/\s|"/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')}` : command;
      const child = isWin
        ? spawn(cmdLine, {
            cwd: resolvedCwd,
            detached: true,
            stdio: 'ignore',
            shell: true,
            windowsHide: true,
          })
        : spawn(command, args, {
            cwd: resolvedCwd,
            detached: true,
            stdio: 'ignore',
            shell: false,
          });

      const entry = this.register(command, args, resolvedCwd, child, chatId);
      if (entry && port) {
        entry.port = port;
      }

      // Poll port up to 6.5 seconds so user gets a seamless 1-click preview
      if (port) {
        const start = Date.now();
        while (Date.now() - start < 6500) {
          await new Promise((r) => setTimeout(r, 400));
          if (await this.isPortListening(port)) {
            if (entry) entry.status = 'running';
            return { success: true, port };
          }
        }
      }

      return { success: true, port };
    } catch (err: any) {
      return { success: false, port: port || null, error: err?.message || 'Failed to spawn dev server' };
    }
  }

  /** Drops completed processes past a retention cap so the roster and the
   *  per-poll payload stay bounded on long sessions. */
  private reap(): void {
    if (this.processes.size <= MAX_TRACKED_PROCESSES) return;
    const finished = Array.from(this.processes.entries())
      .filter(([, e]) => e.status === 'exited' || e.status === 'failed' || e.status === 'stopped')
      .sort((a, b) => a[1].startedAt - b[1].startedAt);
    let toDrop = this.processes.size - MAX_TRACKED_PROCESSES;
    for (const [id] of finished) {
      if (toDrop <= 0) break;
      this.processes.delete(id);
      toDrop -= 1;
    }
  }

  /** Checks the detected port; on failure retries the start up to MAX_ATTEMPTS. */
  private async verify(id: string): Promise<void> {
    const entry = this.processes.get(id);
    if (!entry || entry.status === 'stopped' || entry.status === 'running') return;

    // A process whose child exited can NEVER be running
    const alive = entry.child ? (entry.child.exitCode === null && !entry.child.killed) : true;
    if (entry.child && !alive) {
      entry.status = 'failed';
      entry.lastError = `Process exited with code ${entry.child.exitCode ?? 'unknown'}${entry.port ? ` while attempting to bind port ${entry.port}` : ''}.`;
      return;
    }

    if (!entry.port) {
      if (alive) entry.status = 'running';
      return;
    }

    // Port specified: check if port is listening AND owned by this workspace process
    const listening = await this.isPortListening(entry.port);
    if (listening) {
      const isOwned = await this.isPortOwnedByWorkspace(entry.port, entry.cwd);
      if (isOwned) {
        entry.status = 'running';
        return;
      }
      // Port is occupied by an external, foreign process
      entry.status = 'failed';
      entry.lastError = `Port ${entry.port} is already in use by an external process not owned by this workspace.`;
      return;
    }

    if (entry.attempts < MAX_ATTEMPTS) {
      entry.attempts += 1;
      entry.status = 'starting';
      setTimeout(() => void this.retry(id), RETRY_DELAY_MS);
    }
  }

  private async retry(id: string): Promise<void> {
    const entry = this.processes.get(id);
    if (!entry || entry.status === 'stopped' || entry.status === 'running') return;

    // Check if port is already listening — if owned by us, mark running; if foreign, mark failed
    if (entry.port && (await this.isPortListening(entry.port))) {
      const isOwned = await this.isPortOwnedByWorkspace(entry.port, entry.cwd);
      if (isOwned) {
        entry.status = 'running';
        entry.lastError = null;
        return;
      } else {
        entry.status = 'failed';
        entry.lastError = `Port ${entry.port} is already occupied by an external process.`;
        return;
      }
    }
    try {
      const isWin = process.platform === 'win32';
      const cmdLine = entry.args.length > 0 ? `${entry.command} ${entry.args.map((a) => (/\s|"/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')}` : entry.command;
      const child = isWin
        ? spawn(cmdLine, {
            cwd: entry.cwd,
            detached: true,
            stdio: 'ignore',
            shell: true,
            windowsHide: true,
          })
        : spawn(entry.command, entry.args, {
            cwd: entry.cwd,
            detached: true,
            stdio: 'ignore',
            shell: false,
          });
      entry.child = child;
      entry.pid = child.pid ?? null;
      child.on('exit', () => {
        if (entry.status === 'running') entry.status = 'exited';
      });
      setTimeout(() => void this.verify(id), 5000);
    } catch (err: any) {
      entry.lastError = err?.message || 'Retry spawn failed';
      if (entry.attempts < MAX_ATTEMPTS) {
        entry.attempts += 1;
        setTimeout(() => void this.retry(id), RETRY_DELAY_MS);
      } else {
        entry.status = 'failed';
      }
    }
  }

  public isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      const done = (result: boolean) => {
        try { socket.destroy(); } catch { /* already closed */ }
        resolve(result);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(350, () => done(false));
    });
  }

  /** Verifies if a listening port is owned by the specified workspace directory */
  public async isPortOwnedByWorkspace(port: number, workspaceDir: string): Promise<boolean> {
    const normWs = path.resolve(workspaceDir).toLowerCase().replace(/\\/g, '/');

    // 1. Fast check: in-process managed processes — MUST be alive
    for (const entry of this.processes.values()) {
      if ((entry.status === 'running' || entry.status === 'starting') && entry.port === port) {
        const isChildAlive = entry.child ? (entry.child.exitCode === null && !entry.child.killed) : true;
        if (!isChildAlive) {
          entry.status = 'failed';
          continue;
        }
        const normProcCwd = path.resolve(entry.cwd).toLowerCase().replace(/\\/g, '/');
        if (normProcCwd === normWs || normProcCwd.startsWith(normWs + '/')) {
          return true;
        }
      }
    }

    const isListening = await this.isPortListening(port);
    if (!isListening) return false;

    // 2. Check system process table via inspectPort
    try {
      const inspect = await this.inspectPort(port);
      if (inspect.inUse && inspect.command) {
        const normCmd = inspect.command.toLowerCase().replace(/\\/g, '/');
        // Explicitly exclude foreign system daemons from matching
        if (normCmd.includes('antigravity') || normCmd.includes('claude-proxy') || normCmd.includes('ollama') || port === 8081) {
          return false;
        }
        if (normCmd.includes(normWs)) {
          return true;
        }
      }
    } catch {}

    return false;
  }

  /** Finds a running process started by a specific chat session */
  public findByChatId(chatId: string): ManagedProcess | undefined {
    return Array.from(this.processes.values()).find(
      (p) => p.chatId === chatId && (p.status === 'running' || p.status === 'starting')
    );
  }

  /** Lists all processes associated with a chat session */
  public listByChatId(chatId: string): ManagedProcess[] {
    return Array.from(this.processes.values()).filter((p) => p.chatId === chatId);
  }

  /** Finds the next available TCP port on localhost */
  public async findAvailablePort(startPort = 3000): Promise<number> {
    for (let p = startPort; p <= 65535; p++) {
      if (!(await this.isPortListening(p))) {
        return p;
      }
    }
    return startPort;
  }

  public list(): ManagedProcess[] {
    return Array.from(this.processes.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((entry) => {
        const { child: _child, ...rest } = entry;
        void _child;
        return rest;
      });
  }

  public stop(id: string): boolean {
    const entry = this.processes.get(id);
    if (!entry) return false;
    entry.status = 'stopped';
    // Prefer tree-kill by PID (taskkill /T /F on Windows) so child processes
    // the launcher spawned are reaped too. Fall back to the handle when the
    // platform didn't give us a usable pid.
    const pid = entry.pid ?? entry.child?.pid ?? null;
    if (pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          // Negative pid kills the process group, matching taskkill /T.
          try { process.kill(-pid); } catch { process.kill(pid); }
        }
      } catch {
        // Already gone
      }
    } else if (entry.child) {
      try { entry.child.kill(); } catch { /* already gone */ }
    }
    return true;
  }

  public stopAll(): void {
    for (const id of this.processes.keys()) {
      this.stop(id);
    }
  }

  /** Inspects a port to determine if it is currently in use, and identifies the occupying process (PID & command) */
  public async inspectPort(port: number): Promise<{
    inUse: boolean;
    port: number;
    pid?: number;
    processName?: string;
    command?: string;
    isManaged: boolean;
    managedProcessId?: string;
  }> {
    const isListening = await this.isPortListening(port);
    if (!isListening) {
      return { inUse: false, port, isManaged: false };
    }

    // Check if it's one of our internal managed processes
    for (const [id, entry] of this.processes.entries()) {
      if (entry.port === port && entry.status === 'running') {
        return {
          inUse: true,
          port,
          pid: entry.pid ?? undefined,
          command: `${entry.command} ${entry.args.join(' ')}`.trim(),
          isManaged: true,
          managedProcessId: id,
        };
      }
    }

    // System inspection on Windows via PowerShell or Linux/Mac via lsof
    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process');
        const psScript = `$ProgressPreference = 'SilentlyContinue'; $conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue; [PSCustomObject]@{ pid = $conn.OwningProcess; name = $proc.ProcessName; cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue).CommandLine } | ConvertTo-Json }`;
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
        const out = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: 4000 });
        const jsonMatch = out.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            inUse: true,
            port,
            pid: parsed.pid ? Number(parsed.pid) : undefined,
            processName: parsed.name || undefined,
            command: parsed.cmd || undefined,
            isManaged: false,
          };
        }
      } catch {}
    } else {
      try {
        const { execSync } = await import('child_process');
        const pidStr = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: 'utf-8', timeout: 3000 }).trim();
        const pid = pidStr ? Number(pidStr.split('\n')[0]) : undefined;
        if (pid) {
          const cmd = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8', timeout: 2000 }).trim();
          return { inUse: true, port, pid, command: cmd, isManaged: false };
        }
      } catch {}
    }

    return { inUse: true, port, isManaged: false };
  }

  /** Kills the process occupying the specified port */
  public async freePort(port: number): Promise<{ success: boolean; message: string; port: number; killedPid?: number }> {
    const info = await this.inspectPort(port);
    if (!info.inUse) {
      return { success: true, message: `Port ${port} is already free.`, port };
    }

    if (info.isManaged && info.managedProcessId) {
      this.stop(info.managedProcessId);
      return { success: true, message: `Stopped internal managed process on port ${port}.`, port, killedPid: info.pid };
    }

    if (info.pid) {
      try {
        const { spawn } = await import('child_process');
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(info.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          process.kill(info.pid, 'SIGKILL');
        }
        return { success: true, message: `Terminated process PID ${info.pid} (${info.processName || info.command || 'unknown'}) occupying port ${port}.`, port, killedPid: info.pid };
      } catch (err: any) {
        return { success: false, message: `Failed to terminate PID ${info.pid}: ${err?.message}`, port, killedPid: info.pid };
      }
    }

    return { success: false, message: `Port ${port} is occupied by an unidentifiable system process.`, port };
  }

  public markExited(command: string): void {
    for (const entry of this.processes.values()) {
      if (entry.command === command && entry.status === 'running') {
        entry.status = 'exited';
      }
    }
  }
}

export const processManager = new ProcessManager();

// Clean up all running background child processes on process termination
process.on('exit', () => {
  processManager.stopAll();
});
process.on('SIGINT', () => {
  processManager.stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  processManager.stopAll();
  process.exit(0);
});
