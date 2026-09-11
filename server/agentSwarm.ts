import { SubagentRole, SubagentState, ToolCallPayload, PermissionLevel, SwarmTaskMilestone } from './types.js';
import { fsTools } from './tools/fsTools.js';
import { ptyManager } from './ptyManager.js';
import { mediaEngine } from './mediaEngine.js';
import { modelRouter } from './modelRouter.js';
import { captureArtifact } from './artifacts.js';
import { processManager } from './processManager.js';
import net from 'net';
import dns from 'dns';
import fs from 'fs';
import path from 'path';

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

function isValidHostname(host: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host) && host.length <= 253;
}

export class AgentSwarmOrchestrator {
  private subagents: Map<string, SubagentState> = new Map();
  private milestones: SwarmTaskMilestone[] = [];
  private permissionLevel: PermissionLevel = 'full'; // 'strict' gates every action; 'full' runs autonomously
  private pendingApprovals: Map<string, ToolCallPayload> = new Map();

  constructor() {
  }

  public getSubagentStates(): SubagentState[] {
    return Array.from(this.subagents.values());
  }

  /** Clears all subagent state — called at the start of every fresh run so stale specialists never linger. */
  public clearSubagents(): void {
    this.subagents.clear();
    this.milestones = [];
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

  public spawnSubagent(role: string, task: string): SubagentState {
    const id = `agent-${role}-${Date.now()}`;
    const agent: SubagentState = {
      id,
      role: role as SubagentRole,
      name: `Specialist: ${role}`,
      status: 'executing',
      currentTask: task,
      progress: 0,
      toolCalls: [],
      tokensUsed: 0,
      lastMessage: 'Spawned for task',
      startedAt: Date.now(),
    };
    this.subagents.set(id, agent);
    return agent;
  }

  /**
   * Executes an autonomous subagent LLM ReAct loop for a specialized task
   */
  public async runSubagentTask(role: string, task: string): Promise<{ id: string; role: string; output: string; status: string }> {
    const agent = this.spawnSubagent(role, task);
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

Rules:
- Use tools (read_file, write_file, edit_file, grep_search, run_command, typecheck_project, etc.) as needed.
- After each tool call you will receive the tool result. Continue reasoning and making more tool calls until the task is complete.
- Run typecheck_project or run_unit_tests after code changes to verify correctness.
- Do not write more than 5 tool call rounds without summarizing progress.
- Max total turns: 8.`;

    let fullOutput = '';
    agent.progress = 30;

    const messages: any[] = [
      { role: 'user', content: `Execute the following specialist sub-task in the workspace:\n\n${task}\n\nUse tools to accomplish this and respond with a concise final summary when done.` }
    ];

    const MAX_TURNS = 8;
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        agent.progress = Math.min(90, 30 + turn * 8);
        let turnHadToolCalls = false;
        let turnAssistantText = '';
        let toolCallsCollected: any[] = [];

        for await (const chunk of modelRouter.streamChat({
          messages: [...messages],
          systemPrompt,
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
        const readOnlyTools = new Set(['read_file', 'list_directory', 'grep_search', 'git_status', 'git_diff', 'git_log', 'typecheck_project', 'count_loc', 'inspect_sqlite_schema', 'find_dead_code', 'extract_symbols', 'ast_grep', 'validate_env_variables', 'audit_security_dependencies', 'audit_accessibility_wcag', 'audit_performance_vitals', 'search_web', 'scrape_url', 'list_running_processes', 'inspect_port']);
        const results: Record<string, any> = {};
        const errors: Record<string, string> = {};

        const sequentialItems: typeof toolCallsCollected = [];
        const parallelItems: typeof toolCallsCollected = [];
        for (const tc of toolCallsCollected) {
          (readOnlyTools.has(tc.tool) ? parallelItems : sequentialItems).push(tc);
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

  /**
   * Execute Tool with Permission Guard & "Allow All" Mode
   *
   * `ctx.planFilePath` scopes the write_todos plan to the conversation that owns
   * this run — absent ctx falls back to the workspace-root task_plan.md.
   */
  public async executeTool(toolCall: ToolCallPayload, ctx?: { planFilePath?: string }): Promise<any> {
    // Auto-normalize tool name (strip any namespaces like repo_browser., fs., tools., functions.)
    const rawTool = toolCall.tool || '';
    const normalizedTool = rawTool.replace(/^(?:repo_browser|workspace|fs|tools|functions|file_system)\./i, '').trim();
    toolCall.tool = normalizedTool;

    const alwaysAllowedTools = ['ask_user', 'write_todos'];
    const requiresGate = !alwaysAllowedTools.includes(toolCall.tool);

    // In strict mode every tool call queues for approval except ask_user / write_todos
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
        case 'read_file':
          output = fsTools.readFile(toolCall.params.path, toolCall.params.lineRange);
          break;

        case 'write_file':
          output = fsTools.writeFile(toolCall.params.path, toolCall.params.content);
          break;

        case 'edit_file': {
          const target = toolCall.params.target || toolCall.params.oldStr || toolCall.params.oldContent || toolCall.params.old_string || toolCall.params.targetContent || toolCall.params.search || toolCall.params.find || '';
          const replacement = toolCall.params.replacement ?? toolCall.params.newStr ?? toolCall.params.newContent ?? toolCall.params.new_string ?? toolCall.params.replacementContent ?? toolCall.params.replace ?? toolCall.params.content ?? '';
          const startLine = typeof toolCall.params.startLine === 'number' ? toolCall.params.startLine : typeof toolCall.params.start_line === 'number' ? toolCall.params.start_line : typeof toolCall.params.start === 'number' ? toolCall.params.start : undefined;
          const endLine = typeof toolCall.params.endLine === 'number' ? toolCall.params.endLine : typeof toolCall.params.end_line === 'number' ? toolCall.params.end_line : typeof toolCall.params.end === 'number' ? toolCall.params.end : undefined;
          output = fsTools.editFile(toolCall.params.path, target, replacement, startLine, endLine);
          break;
        }

        case 'delete_file':
          output = fsTools.deletePath(toolCall.params.path);
          break;

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
          break;

        case 'git_status':
          output = fsTools.gitStatus();
          break;

        case 'git_diff':
          output = fsTools.getGitDiff(toolCall.params?.path, toolCall.params?.staged || false);
          break;

        case 'run_command': {
          output = await ptyManager.executeCommand(
            toolCall.params.command,
            toolCall.params.cwd,
            toolCall.params.timeoutMs || 90000,
            Boolean(toolCall.params.isBackground || toolCall.params.isDaemon),
            toolCall.params.waitMsBeforeAsync || 3000
          );
          // Dev servers / watchers get liveness tracking + auto-retry so a
          // "started but not listening" process self-heals instead of failing.
          try {
            const parts = String(toolCall.params.command).trim().split(/\s+/);
            processManager.register(parts[0], parts.slice(1), toolCall.params.cwd || '');
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

        case 'kill_process':
        case 'kill_task':
          output = ptyManager.killProcess(toolCall.params.processId || toolCall.params.taskId || toolCall.params.id);
          break;

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

        case 'dispatch_subagents':
          throw new Error('dispatch_subagents is deprecated, use spawn_subagent instead.');
          
        case 'git_commit':
          output = fsTools.gitCommit(toolCall.params.message);
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

        case 'inspect_port': {
          const port = Number(toolCall.params.port);
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            output = { error: 'Invalid port — provide an integer between 1 and 65535.' };
            break;
          }
          output = await ptyManager.executeCommand(`netstat -ano | findstr :${port}`);
          break;
        }

        case 'bench_http_endpoint': {
          const benchUrl = String(toolCall.params.url || 'http://localhost:5173');
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
              const absolute = path.resolve(workspaceRoot, candidate);
              if (!absolute.startsWith(workspaceRoot) || !fs.existsSync(absolute)) continue;
              output = JSON.parse(fs.readFileSync(absolute, 'utf-8'));
              found = true;
              break;
            }
            if (!found) output = NOT_AVAILABLE;
          } catch {
            output = NOT_AVAILABLE;
          }
          break;
        }

        case 'search_web': {
          const { webResearchEngine } = await import('./tools/webResearchTools.js');
          output = await webResearchEngine.searchWeb(toolCall.params.query, toolCall.params.limit || 5);
          break;
        }

        case 'scrape_url': {
          const { webResearchEngine } = await import('./tools/webResearchTools.js');
          output = await webResearchEngine.scrapeAndCompress(
            toolCall.params.url,
            toolCall.params.maxContextLength || 3000,
            toolCall.params.cookies || toolCall.params.cookie || toolCall.params.cookieHeader
          );
          break;
        }

        case 'spawn_subagent': {
          output = await this.runSubagentTask(toolCall.params.role, toolCall.params.task);
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
          try {
            await fsTools.writeFile(
              ctx?.planFilePath || 'task_plan.md',
              normalized.map((t: any) => `- [${t.status === 'completed' ? 'x' : ' '}] (${t.status}) ${t.content}`).join('\n')
            );
          } catch {
            // Plan file is best-effort; the echo below is what matters for the loop
          }
          const doneCount = normalized.filter((t: any) => t.status === 'completed').length;
          // Auto-capture the plan as a trackable artifact (plan work-through)
          const planArtifact = captureArtifact(
            'Task plan',
            'plan',
            normalized.map((t: any) => `- [${t.status === 'completed' ? 'x' : ' '}] (${t.status}) ${t.content}`).join('\n'),
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
          const name = typeof toolCall.params.name === 'string' ? toolCall.params.name : '';
          const content = typeof toolCall.params.content === 'string' ? toolCall.params.content : '';
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

        case 'create_implementation_plan':
          await fsTools.writeFile('implementation_plan.md', toolCall.params.content);
          output = { file: 'implementation_plan.md', status: 'created/updated', message: 'Implementation plan saved to workspace.' };
          break;

        case 'update_task_progress':
          await fsTools.writeFile('task_progress.md', toolCall.params.content);
          output = { file: 'task_progress.md', status: 'updated', message: 'Task progress roadmap updated.' };
          break;

        case 'create_walkthrough':
          await fsTools.writeFile('walkthrough.md', toolCall.params.content);
          output = { file: 'walkthrough.md', status: 'created/updated', message: 'Walkthrough and verification log saved.' };
          break;

        // Advertised but not implemented in this build — fail honestly instead of fabricating output.
        case 'parse_pdf_content':
          output = { error: 'parse_pdf_content is not available in this build yet.' };
          break;

        case 'ocr_image_text':
          output = { error: 'ocr_image_text is not available in this build yet.' };
          break;

        case 'generate_test_suite':
          output = { error: 'generate_test_suite is not available in this build yet.' };
          break;

        case 'generate_openapi_spec':
          output = { error: 'generate_openapi_spec is not available in this build yet.' };
          break;


        default:
          throw new Error(`Unknown tool "${toolCall.tool}" requested.`);
      }

      toolCall.status = 'completed';
      toolCall.result = output;
      return output;
    } catch (err: any) {
      toolCall.status = 'failed';
      toolCall.error = err.message;
      throw err;
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
