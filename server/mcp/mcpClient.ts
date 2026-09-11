/**
 * SUTRA Studio — Native Model Context Protocol (MCP) Client Engine
 * Supports stdio and SSE MCP servers, auto-discovering local tools from Claude/Cursor/Antigravity configs.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ChildProcess } from 'child_process';
import db from '../db.js';

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

export class MCPClientEngine {
  private servers: Map<string, MCPServerConfig> = new Map();
  private activeProcesses: Map<string, ChildProcess> = new Map();
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
    this.servers.delete(id);
    try {
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
      return true;
    } catch {
      return false;
    }
  }
}

export const mcpClient = new MCPClientEngine();
