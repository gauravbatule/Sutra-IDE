import net from 'net';
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
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2500;

/**
 * Tracks long-running processes the agent starts (dev servers, watchers).
 * Detects the listening port, verifies liveness, and auto-retries a failed
 * start so "it tried but is not running" self-heals instead of dead-ending.
 */
class ProcessManager {
  private processes: Map<string, ManagedProcess & { child?: ChildProcess }> = new Map();

  /** Extracts a port from common CLI flags or common framework defaults. */
  private detectPort(command: string, args: string[]): number | null {
    const joined = `${command} ${args.join(' ')}`;
    const flagMatch = joined.match(/(?:--port|-p|PORT=)\s*(\d{2,5})/i);
    if (flagMatch) return Number(flagMatch[1]);
    if (/\bvite\b/.test(joined)) return 5173;
    if (/\bnext\b/.test(joined)) return 3000;
    if (/\bserve\b|http-server|live-server/.test(joined)) return 3000;
    if (/\bflask\b|python.*app\.py/.test(joined)) return 5000;
    if (/\buvicorn\b|fastapi/.test(joined)) return 8000;
    return null;
  }

  private isLongRunning(command: string, args: string[]): boolean {
    const joined = `${command} ${args.join(' ')}`;
    return /\b(dev|start|serve|preview|watch|run dev|run start)\b/i.test(joined) || this.detectPort(command, args) !== null;
  }

  /** Registers a command the agent is about to run; long-running ones get managed. */
  public register(command: string, args: string[], cwd: string, _child?: ChildProcess): ManagedProcess | null {
    if (!this.isLongRunning(command, args)) return null;
    const id = `proc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const entry: ManagedProcess & { child?: ChildProcess } = {
      id,
      command,
      args,
      cwd: cwd || '.',
      pid: null,
      port: this.detectPort(command, args),
      status: 'starting',
      startedAt: Date.now(),
      lastError: null,
      attempts: 1,
    };
    this.processes.set(id, entry);
    // Give the server a moment, then verify it is actually listening
    setTimeout(() => void this.verify(id), 4000);
    return entry;
  }

  /** Checks the detected port; on failure retries the start up to MAX_ATTEMPTS. */
  private async verify(id: string): Promise<void> {
    const entry = this.processes.get(id);
    if (!entry || entry.status === 'stopped' || entry.status === 'running') return;

    const alive = entry.child ? entry.child.exitCode === null : true;
    const listening = entry.port ? await this.isPortListening(entry.port) : alive;

    if (listening || (alive && !entry.port)) {
      entry.status = 'running';
      return;
    }

    if (!alive) {
      entry.status = 'failed';
      entry.lastError = `Process exited before listening${entry.port ? ` on port ${entry.port}` : ''}.`;
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
    // Port occupied by something else is the common cause — report it honestly.
    if (entry.port && (await this.isPortListening(entry.port))) {
      entry.status = 'running';
      entry.lastError = null;
      return;
    }
    try {
      const child = spawn(entry.command, entry.args, {
        cwd: entry.cwd,
        detached: true,
        stdio: 'ignore',
        shell: process.platform === 'win32',
        windowsHide: true,
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
      socket.setTimeout(1500, () => done(false));
    });
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
    if (entry.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(entry.pid), '/T', '/F'], { windowsHide: true });
        } else {
          process.kill(entry.pid);
        }
      } catch {
        // Already gone
      }
    }
    return true;
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
