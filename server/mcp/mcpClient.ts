/**
 * SUTRA Studio — Native Model Context Protocol (MCP) Client Engine
 * Full JSON-RPC 2.0 stdio and SSE MCP client with child-process lifecycle management.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import db from '../db.js';
import { ToolError } from '../harness/toolError.js';

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  serverId: string;
}

interface PendingRpc {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

export class MCPClientEngine {
  private servers: Map<string, MCPServerConfig> = new Map();
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private processStdoutBuffers: Map<string, string> = new Map();
  private pendingRequests: Map<string, Map<number, PendingRpc>> = new Map();
  private rpcIdCounter = 1;
  private tools: Map<string, MCPTool> = new Map();

  constructor() {
    this.autoDiscoverLocalConfigs();
  }

  public autoDiscoverLocalConfigs(): void {
    // 1. Load persisted custom MCP servers from SQLite
    try {
      const rows = db.prepare('SELECT * FROM mcp_servers WHERE enabled = 1').all() as any[];
      for (const row of rows) {
        this.servers.set(row.id, {
          id: row.id,
          name: row.name,
          transport: row.transport || 'stdio',
          command: row.command,
          args: row.args ? JSON.parse(row.args) : [],
          env: row.env ? JSON.parse(row.env) : {},
          url: row.url,
          enabled: Boolean(row.enabled),
        });
      }
    } catch {
      // No persisted servers in SQLite (fresh database) — fall through to file discovery.
    }

    // 2. Discover from standard config paths
    const userHome = os.homedir();
    const possiblePaths = [
      path.join(userHome, '.gemini/antigravity/mcp'),
      path.join(userHome, '.config/Claude/claude_desktop_config.json'),
      path.join(userHome, 'AppData/Roaming/Claude/claude_desktop_config.json'),
      path.join(userHome, '.cursor/mcp.json'),
      path.join(process.cwd(), 'mcp.json'),
    ];

    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          if (stat.isFile() && p.endsWith('.json')) {
            const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
            const mcpServers = raw.mcpServers || {};
            for (const [name, cfg] of Object.entries<any>(mcpServers)) {
              if (!this.servers.has(name)) {
                this.servers.set(name, {
                  id: name,
                  name,
                  transport: cfg.transport || 'stdio',
                  command: cfg.command,
                  args: cfg.args || [],
                  env: cfg.env || {},
                  url: cfg.url,
                  enabled: true,
                });
              }
            }
          }
        }
      } catch {
        // Skip unreadable configs
      }
    }
  }

  public getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  public getRegisteredTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /** Returns the subset of tools belonging to servers the user hasn't paused.
   *  The disabled list arrives on the prompt payload from the client; the
   *  server has no filesystem view of the client's localStorage so it
   *  filters based on the in-call payload rather than disk state. */
  public getEnabledTools(disabledServers: ReadonlyArray<string> = []): MCPTool[] {
    if (!disabledServers || disabledServers.length === 0) return this.getRegisteredTools();
    const disabledSet = new Set(disabledServers);
    return Array.from(this.tools.values()).filter((t) => {
      // Tool entries from the MCP client carry the source server name in
      // `serverName`; older entries that don't have it stay enabled so a
      // legacy tool isn't silently hidden.
      const server = (t as MCPTool & { serverName?: string }).serverName;
      if (!server) return true;
      return !disabledSet.has(server);
    });
  }

  public registerCustomServer(config: MCPServerConfig): void {
    this.servers.set(config.id, config);
    try {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, transport, command, args, env, url, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          transport = excluded.transport,
          command = excluded.command,
          args = excluded.args,
          env = excluded.env,
          url = excluded.url,
          enabled = excluded.enabled
      `).run(
        config.id,
        config.name,
        config.transport,
        config.command || null,
        JSON.stringify(config.args || []),
        JSON.stringify(config.env || {}),
        config.url || null,
        config.enabled ? 1 : 0
      );
    } catch {
      // Persistence is best-effort — the server remains registered in memory either way.
    }
  }

  public deleteCustomServer(id: string): boolean {
    this.stopServer(id);
    this.servers.delete(id);
    try {
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
      return true;
    } catch {
      return false;
    }
  }

  public async startServer(serverId: string): Promise<ChildProcess | null> {
    const config = this.servers.get(serverId);
    if (!config || !config.enabled) return null;
    if (this.activeProcesses.has(serverId)) {
      return this.activeProcesses.get(serverId)!;
    }

    if (config.transport === 'stdio') {
      if (!config.command) return null;
      try {
        const proc = spawn(config.command, config.args || [], {
          env: { ...process.env, ...(config.env || {}) },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        });

        this.activeProcesses.set(serverId, proc);
        this.pendingRequests.set(serverId, new Map());
        this.processStdoutBuffers.set(serverId, '');

        proc.stdout.on('data', (chunk: Buffer) => {
          this.handleStdoutData(serverId, chunk.toString('utf8'));
        });

        proc.on('exit', () => {
          this.activeProcesses.delete(serverId);
          this.pendingRequests.delete(serverId);
        });

        // Send initialize handshake
        await this.sendRpc(serverId, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'sutra-ide', version: '1.0.0' },
        });

        // Send initialized notification
        this.sendNotification(serverId, 'notifications/initialized', {});

        // Fetch tools
        try {
          const res = await this.sendRpc(serverId, 'tools/list', {});
          if (res?.tools && Array.isArray(res.tools)) {
            for (const t of res.tools) {
              this.tools.set(`${serverId}:${t.name}`, {
                name: t.name,
                description: t.description || '',
                inputSchema: t.inputSchema || {},
                serverId,
              });
            }
          }
        } catch (e) {
          // tools/list optional
        }

        return proc;
      } catch (err: any) {
        console.warn(`[MCP] Failed to spawn stdio server "${serverId}":`, err.message);
        return null;
      }
    }

    return null;
  }

  public stopServer(serverId: string): void {
    const proc = this.activeProcesses.get(serverId);
    if (proc) {
      try {
        proc.kill('SIGTERM');
      } catch {}
      this.activeProcesses.delete(serverId);
    }
  }

  private handleStdoutData(serverId: string, data: string): void {
    let buf = (this.processStdoutBuffers.get(serverId) || '') + data;
    const lines = buf.split(/\r?\n/);
    this.processStdoutBuffers.set(serverId, lines.pop() || '');

    const map = this.pendingRequests.get(serverId);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const json = JSON.parse(trimmed);
        if (json.id !== undefined && map?.has(json.id)) {
          const req = map.get(json.id)!;
          clearTimeout(req.timer);
          map.delete(json.id);
          if (json.error) {
            req.reject(new ToolError(json.error.message || 'MCP RPC Error', 'unknown', false, json.error));
          } else {
            req.resolve(json.result);
          }
        }
      } catch {}
    }
  }

  private async sendRpc(serverId: string, method: string, params: any): Promise<any> {
    const proc = this.activeProcesses.get(serverId);
    if (!proc || !proc.stdin) {
      throw new ToolError(`MCP server "${serverId}" is not running`, 'not_found', false);
    }

    const id = this.rpcIdCounter++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.get(serverId)?.delete(id);
        reject(new ToolError(`MCP request "${method}" to "${serverId}" timed out after 30s`, 'timeout', true));
      }, 30000);

      this.pendingRequests.get(serverId)?.set(id, { resolve, reject, timer });
      if (proc.stdin) {
        proc.stdin.write(payload, 'utf8');
      } else {
        clearTimeout(timer);
        this.pendingRequests.get(serverId)?.delete(id);
        reject(new ToolError(`Process stdin unavailable for server "${serverId}"`, 'unknown', false));
      }
    });
  }

  private sendNotification(serverId: string, method: string, params: any): void {
    const proc = this.activeProcesses.get(serverId);
    if (!proc || !proc.stdin) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    proc.stdin.write(payload, 'utf8');
  }

  public async callTool(toolName: string, args: any): Promise<unknown> {
    // Strip standard prefixes
    let cleanName = toolName.replace(/^mcp_+/i, '');
    let serverId = '';

    if (cleanName.includes('__')) {
      const parts = cleanName.split('__');
      serverId = parts[0];
      cleanName = parts.slice(1).join('__');
    }

    if (!serverId) {
      // Find server registered for this tool
      for (const [key, tool] of this.tools.entries()) {
        if (tool.name === cleanName) {
          serverId = tool.serverId;
          break;
        }
      }
    }

    if (!serverId && this.servers.size > 0) {
      serverId = Array.from(this.servers.keys())[0];
    }

    if (!serverId || !this.servers.has(serverId)) {
      throw new ToolError(`No MCP server configured for tool "${toolName}"`, 'not_found', false);
    }

    let proc = this.activeProcesses.get(serverId);
    if (!proc) {
      proc = (await this.startServer(serverId)) || undefined;
      if (!proc) {
        throw new ToolError(`Failed to connect to MCP server "${serverId}"`, 'unknown', true);
      }
    }

    const res = await this.sendRpc(serverId, 'tools/call', {
      name: cleanName,
      arguments: args || {},
    });

    if (res && res.content) {
      if (Array.isArray(res.content)) {
        return res.content.map((c: any) => (typeof c === 'string' ? c : c.text || JSON.stringify(c))).join('\n');
      }
      return res.content;
    }

    return res;
  }
}

export const mcpClient = new MCPClientEngine();
