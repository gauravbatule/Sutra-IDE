import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ManagedProcessRow {
  id: string;
  command: string;
  port: number | null;
  status: string;
  attempts: number;
  lastError: string | null;
}

/** Terminal states — a task in one of these can no longer be stopped. */
const TASK_TERMINAL_STATUSES = new Set(['exited', 'failed', 'stopped']);
const isTaskActive = (status: string): boolean => !TASK_TERMINAL_STATUSES.has(status);

/**
 * Antigravity-style "N tasks running" collapsible above the composer.
 *
 * Every row carries its own stop control (POST /api/processes/:id/stop) and a
 * live status from the shared poll, so a task the agent claimed to stop visibly
 * flips to stopped instead of lingering as "running". The header offers
 * stop-all (POST /api/tasks/kill-all); a failed bulk call degrades to a quiet
 * title hint rather than breaking the bar.
 */
const RunningTasksBar: React.FC = () => {
  const [processes, setProcesses] = useState<ManagedProcessRow[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch('/api/processes')
        .then((r) => r.json())
        .then((d) => setProcesses(Array.isArray(d.processes) ? d.processes : []))
        .catch(() => undefined);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const active = processes.filter((p) => isTaskActive(p.status));
  // Active rows first so the running work leads; finished ones stay readable below.
  const rows = useMemo(
    () =>
      [...processes].sort((a, b) => Number(isTaskActive(b.status)) - Number(isTaskActive(a.status))),
    [processes]
  );

  if (processes.length === 0 || (!expanded && active.length === 0)) return null;

  const stopTask = async (id: string) => {
    // Optimistic flip — the 5s poll reconciles with server truth either way.
    setProcesses((list) => list.map((p) => (p.id === id ? { ...p, status: 'stopped' } : p)));
    try {
      await fetch(`/api/processes/${encodeURIComponent(id)}/stop`, { method: 'POST' });
    } catch {
      // Poll will reflect reality
    }
  };

  const stopAllTasks = async () => {
    if (stoppingAll) return;
    setStoppingAll(true);
    // Optimistically reflect the stop in the local list so the UI is
    // responsive even when no /api/tasks/kill-all route exists; the poll
    // tick a few seconds later will confirm against server truth.
    setProcesses((list) =>
      list.map((p) => (isTaskActive(p.status) ? { ...p, status: 'stopped' as const } : p))
    );
    try {
      // Prefer a single bulk endpoint if the server exposes one; fall back
      // to per-row stop calls either way (a 404 should not be treated as
      // "nothing to do" because we still have local state to keep in sync).
      let bulk: Response;
      try {
        bulk = await fetch('/api/tasks/kill-all', { method: 'POST' });
      } catch {
        bulk = null as unknown as Response;
      }
      const bulkOk = bulk && (bulk.ok || bulk.status === 404 || bulk.status === 405);
      if (!bulkOk) {
        await Promise.allSettled(
          active.map((p) =>
            fetch(`/api/processes/${encodeURIComponent(p.id)}/stop`, { method: 'POST' })
          )
        );
      }
    } finally {
      setStoppingAll(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-obsidian-hairline bg-obsidian-canvas">
      <div className="max-w-3xl mx-auto w-full px-4 pt-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-obsidian-border bg-obsidian-surface1 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="flex-1 min-w-0 flex items-center gap-2 text-[11px] font-mono text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border rounded text-left"
          >
            {active.length > 0 ? (
              <Loader2 className="w-3 h-3 animate-spin shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
            )}
            <span className="shrink-0">
              {active.length > 0
                ? `${active.length} task${active.length === 1 ? '' : 's'} running`
                : `${processes.length} task${processes.length === 1 ? '' : 's'} finished`}
            </span>
            <span className="flex-1 min-w-0 truncate text-obsidian-inkMuted text-left">
              {(active[0] ?? rows[0]).command.split(/\s+/).slice(0, 3).join(' ')}
              {(active[0] ?? rows[0]).port ? ` :${(active[0] ?? rows[0]).port}` : ''}
            </span>
            <ChevronDown
              className={`w-3 h-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          {active.length > 0 && (
            <button
              type="button"
              onClick={stopAllTasks}
              disabled={stoppingAll}
              aria-label="Stop all background tasks"
              title="Stop all background tasks"
              className="w-6 h-6 min-h-[24px] min-w-[24px] shrink-0 rounded-md flex items-center justify-center text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-borderBright"
            >
              {stoppingAll ? (
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : (
                <Square className="w-3 h-3 fill-current" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
        {expanded && (
          <div className="mt-1 space-y-1">
            {rows.map((proc) => (
              <div
                key={proc.id}
                className="group px-3 py-1.5 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline text-[10px] font-mono text-obsidian-inkMuted flex items-center gap-2"
                title={`${proc.command}${proc.lastError ? ` — ${proc.lastError}` : ''}`}
              >
                <span
                  aria-hidden="true"
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    proc.status === 'failed'
                      ? 'bg-red-400'
                      : isTaskActive(proc.status)
                        ? 'bg-obsidian-inkPrimary animate-pulse'
                        : 'bg-obsidian-inkMuted opacity-60'
                  }`}
                />
                <span className="flex-1 min-w-0 truncate">{proc.command}</span>
                {proc.port ? <span className="shrink-0">:{proc.port}</span> : null}
                <span
                  className={`shrink-0 uppercase tracking-wider ${
                    proc.status === 'failed' ? 'text-red-400' : isTaskActive(proc.status) ? 'text-obsidian-inkSecondary' : ''
                  }`}
                >
                  {proc.status}
                  {proc.status === 'starting' && proc.attempts > 1 ? ` (retry ${proc.attempts})` : ''}
                </span>
                {isTaskActive(proc.status) && (
                  <button
                    type="button"
                    onClick={() => stopTask(proc.id)}
                    aria-label="Stop task"
                    title="Stop task"
                    className="w-6 h-6 min-h-[24px] min-w-[24px] shrink-0 -mr-1 rounded-md flex items-center justify-center text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-borderBright"
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
import { CheckCircle2, ChevronDown, ChevronRight, Coffee, Bot, FileCode, KeyRound, Loader2, MonitorPlay, Square, X, Music, Sparkles, Copy, Check, Undo2, Play, Terminal, TerminalSquare, Sun, Moon, GitBranch, PanelLeft, PanelLeftClose, AlertCircle, RotateCw, Download, Trash2, Code, Eye } from 'lucide-react';
import { ConPTYTerminal } from '../Terminal/ConPTYTerminal.js';
import { useIDEStore } from '../../stores/ideStore.js';
import { useTheme } from '../../hooks/useTheme.js';
import { cancelAgentStream, registerQuestionSender, sendAgentPrompt, markQuestionUnanswered, wasQuestionAnswered, answerAgentQuestion, markQuestionAnswered, appendUserMessageDeduped } from '../../utils/agentSocket.js';
import { MarkdownRenderer } from '../Agent/MarkdownRenderer.js';
import { ToolCard } from '../Agent/ToolCard.js';
import { ArtifactCard } from '../Agent/ArtifactCard.js';
import { ApprovalCard } from '../Agent/ApprovalCard.js';
import { ThinkingBlock } from '../Agent/AgentChat.js';
import { SettingsModal } from '../Settings/SettingsModal.js';
import { QRPairingModal } from '../MobileConnect/QRPairingModal.js';
import { CoffeeModal } from '../Coffee/CoffeeModal.js';
import { UserGuideModal } from '../Guide/UserGuideModal.js';
import { SkillsModal } from '../Skills/SkillsModal.js';
import { MemoryModal } from '../Memory/MemoryModal.js';
import { ArtifactViewerModal } from '../Artifacts/ArtifactViewerModal.js';
import { OpenFolderModal } from '../Explorer/OpenFolderModal.js';
import { MultiViewport } from '../Preview/MultiViewport.js';
import { AskUserCard, findAskUserFallback } from '../Common/AskUserCard.js';
import { MediaInlineCard, resolveInlineMedia } from '../Common/MediaInlineCard.js';
import { SutraAgentMessage, ToolCallPayload } from '../../types/ide.js';
import { ManagerSidebar } from './ManagerSidebar.js';
import { useAuthStore } from '../../stores/authStore.js';
import { ManagerComposer } from './ManagerComposer.js';
import { HeroComposer } from './HeroComposer.js';
import { ActivityPanel } from './ActivityPanel.js';
import { ManagerDiffView, collectChangedFiles } from './ManagerDiffView.js';
import { deriveAgentStatus } from '../../utils/agentStatus.js';
import { AgentStatusBanner } from '../Common/AgentStatusBanner.js';
import { summarizeRun, STATUS_META, type RunSummary } from '../Common/ResultSummaryCard.js';
import { TRACK_METADATA } from '../../utils/audioSynth.js';

const WELCOME_MESSAGE: SutraAgentMessage = {
  id: 'msg-welcome',
  role: 'assistant',
  content: `I'm Astra — I read, write, and run code in your workspace. What are we building?`,
  timestamp: Date.now(),
};

const ATTACH_MARKER = '\n\n[Attached file: ';

/** Idle gap that must elapse after the last transcript change before a sync fires. */
const TRANSCRIPT_SYNC_IDLE_MS = 1500;

/**
 * Cheap change detector for the transcript sync: message count plus the length
 * of the newest message's content. Streamed tokens mutate only the tail, so
 * this catches every meaningful delta while staying O(1) per render.
 */
const transcriptSyncSignature = (id: string, messages: SutraAgentMessage[]): string => {
  const last = messages[messages.length - 1];
  return `${id}|${messages.length}|${last && typeof last.content === 'string' ? last.content.length : 0}`;
};

/** Splits a stored user message into display text and attachment name (if any). */
const splitAttachment = (content: string): { display: string; attachmentName: string | null } => {
  // Strip well-known send-time prefixes the runtime used to add for steers /
  // attachments / system injections. They were useful for routing but never
  // meant to surface in the chat bubble — leaving them in makes short
  // instructions look like broken system events.
  const stripped = content.replace(
    /^\s*\[(STEER(ING)?|Steer|User|You|Continue|Resume)\]:\s*/i,
    ''
  );
  const idx = stripped.indexOf(ATTACH_MARKER);
  if (idx === -1) return { display: stripped, attachmentName: null };
  const rest = stripped.slice(idx + ATTACH_MARKER.length);
  const end = rest.indexOf(']');
  return { display: stripped.slice(0, idx), attachmentName: end === -1 ? rest : rest.slice(0, end) };
};

const ARTIFACT_TOOLS = new Set([
  'create_artifact',
  'update_artifact',
  'create_markdown_doc',
  'write_documentation',
  'create_findings_report',
  'record_findings',
  'create_audit_report',
  'create_implementation_plan',
]);

/**
 * Picks the inline renderer for a tool call:
 * - artifact tools become rich interactive Artifact cards
 * - completed media tools with a usable asset URL become compact media cards
 * - everything else stays a standard ToolCard.
 */
const renderManagerToolElement = (elements: React.ReactNode[], toolCall: ToolCallPayload): void => {
  const inlineMedia = resolveInlineMedia(toolCall);
  if (inlineMedia) {
    elements.push(<MediaInlineCard key={toolCall.id} media={inlineMedia} />);
  } else if (toolCall.tool === 'ask_user') {
    elements.push(<AskUserCard key={toolCall.id} toolCall={toolCall} />);
  } else if (ARTIFACT_TOOLS.has(toolCall.tool)) {
    elements.push(<ArtifactCard key={toolCall.id} toolCall={toolCall} />);
  } else {
    elements.push(<ToolCard key={toolCall.id} toolCall={toolCall} />);
  }
};

/**
 * Chronological renderer for assistant output: interleaves markdown text
 * chunks with tool cards using the <!-- TOOL_CALL:id --> markers the stream
 * injects. Mirrors the sanitizer in AgentChat so raw protocol tags never leak.
 */
const AssistantMessageBody: React.FC<{ message: SutraAgentMessage }> = React.memo(({ message }) => {
  const safeTools = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const toolMap = new Map(safeTools.map((tc) => [tc.id, tc]));
  const renderedToolIds = new Set<string>();

  const sanitized = (typeof message.content === 'string' ? message.content : '')
    .replace(/>\s*⚙️\s*\*\[Round\s*\d+\]\s*Executing[\s\S]*?\*\s*\n*/gi, '')
    .replace(/Stage\s*\[[^\]]+\]:\s*Executing\s*\d+\s*tool\(s\)[\s\S]*?(?:\n|$)/gi, '')
    .replace(/\[Auto-continuation\]:[\s\S]*?(?:\n|$)/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function=[a-zA-Z0-9_]+>[\s\S]*?<\/function>/gi, '')
    .replace(/<parameter=[a-zA-Z0-9_]+>[\s\S]*?<\/parameter>/gi, '')
    .replace(/<\/function>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<\/?(?:tool_call|function|parameter|think|thought|function_call)[^>]*>/gi, '')
    .replace(/```json\s*\{[\s\S]*?"(?:name|tool)"\s*:[\s\S]*?\}\s*```/gi, '')
    .replace(/<!--\s*GOAL_COMPLETE\s*-->|\[GOAL_COMPLETE\]/gi, '')
    .replace(/\*?\*?Autonomous Goal Execution Concluded\*?\*?:\s*All allocated execution steps completed\.?/gi, '')
    .replace(/\s*\*\(Stopped a repeating action loop[^\)]*\)\*\s*/gi, '')
    .replace(/\s*\*\(Generation stopped\.[^)]*\)\*\s*/gi, '')
    .replace(/\[(?:phase|action|status|step):\s*[^\]]+\]\s*/gi, '')
    .replace(/\[phase[-_]?(?:planning|thinking|acting|executing|verifying|done|self-correct|branching)\]\s*/gi, '')
    .replace(/\[(?:CONTINUE|IMMEDIATE ACTION|AUTONOMOUS \/GOAL CONTINUATION)[^\]]*\]:?\s*/gi, '')
    .trim();

  const parts = sanitized.split(/<!-- TOOL_CALL:(.*?) -->/g);
  const elements: React.ReactNode[] = [];

  if (message.thinking && message.thinking.trim()) {
    elements.push(<ThinkingBlock key="thinking-trace" thinking={message.thinking} />);
  }

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      const cleanChunk = (parts[i] || '').replace(/<!--[\s\S]*?-->/g, '').trim();
      if (cleanChunk) {
        elements.push(<MarkdownRenderer key={`text-${i}`} content={cleanChunk} />);
      }
    } else {
      const toolCall = toolMap.get(parts[i].trim());
      if (toolCall) {
        renderedToolIds.add(toolCall.id);
        renderManagerToolElement(elements, toolCall);
      }
    }
  }

  for (const tc of safeTools.filter((t) => !renderedToolIds.has(t.id))) {
    renderManagerToolElement(elements, tc);
  }

  if (elements.length === 0) {
    const cleanFallback = sanitized.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (cleanFallback) {
      return <MarkdownRenderer content={cleanFallback} />;
    }
    return null;
  }
  return <div className="space-y-3 w-full leading-relaxed">{elements}</div>;
}, (prev, next) => {
  return prev.message === next.message || (
    prev.message.content === next.message.content &&
    prev.message.thinking === next.message.thinking &&
    prev.message.toolCalls === next.message.toolCalls
  );
});

const UserMessageBody: React.FC<{
  display: string;
  attachmentName?: string;
  images: string[];
}> = React.memo(({ display, attachmentName, images }) => {
  // 1. Check if this is a targeted element edit request
  if (display.startsWith('[Targeted Element Edit]')) {
    const targetMatch = display.match(/Target Element:\s*`([^`]+)`/);
    const modMatch = display.match(/Requested Modification:\s*([^\n]+)/);
    const target = targetMatch ? targetMatch[1] : 'Element';
    const mod = modMatch ? modMatch[1] : display;

    return (
      <div className="space-y-1.5 text-left">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-obsidian-surface2 text-cyan-400 border border-obsidian-border font-medium">
            Visual Edit · {target}
          </span>
        </div>
        <p className="text-sm font-medium text-obsidian-inkPrimary">{mod}</p>
      </div>
    );
  }

  // 2. Check if this is a slash command
  const slashMatch = display.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (slashMatch) {
    const cmd = slashMatch[1].toLowerCase();
    const arg = slashMatch[2] || '';
    const cmdTitleMap: Record<string, string> = {
      goal: 'Autonomous Goal Mode',
      plan: 'Implementation Plan',
      test: 'Verify & Test Suite',
      fix: 'Auto-Diagnose & Fix',
      browser: 'Web Research',
      explain: 'Codebase Architecture',
      refactor: 'Codebase Refactor',
      schedule: 'Scheduled Task / Timer',
      skills: 'Skills & Custom Guidelines',
      'grill-me': 'Design Alignment Interview',
      learn: 'Persist Custom Preference',
    };
    const title = cmdTitleMap[cmd] || `Command /${cmd}`;

    return (
      <div className="space-y-1.5 text-left">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-obsidian-inkPrimary text-obsidian-canvas font-bold shadow-xs">
            /{cmd}
          </span>
          <span className="text-[10px] font-mono text-obsidian-inkMuted uppercase tracking-wider">
            {title}
          </span>
        </div>
        {arg && <p className="text-sm leading-relaxed text-obsidian-inkPrimary">{arg}</p>}
      </div>
    );
  }

  // 3. Check for short pre-canned actions like "run it" or "Run site"
  if (/^run\s+(?:it|site|app|preview)$/i.test(display.trim())) {
    return (
      <div className="flex items-center gap-2 text-left">
        <Play className="w-3.5 h-3.5 text-emerald-400 fill-current" />
        <span className="text-sm font-medium text-obsidian-inkPrimary">
          Run workspace application in Live Preview
        </span>
      </div>
    );
  }

  // Standard user message
  return (
    <>
      {images.length > 0 && (
        <div className="mb-2 flex items-center gap-1.5 flex-wrap justify-end">
          {images.map((url, imageIdx) => (
            <img
              key={`${imageIdx}-${url}`}
              src={url}
              alt="Attached"
              className="max-w-40 max-h-40 rounded-lg object-contain border border-obsidian-border cursor-zoom-in"
              onClick={() => window.open(url, '_blank', 'noopener')}
            />
          ))}
        </div>
      )}
      {display}
      {attachmentName && (
        <div className="mt-1.5 pt-1.5 border-t border-obsidian-border text-[10px] font-mono text-obsidian-inkMuted">
          Attached: {attachmentName}
        </div>
      )}
    </>
  );
}, (prev, next) => {
  return prev.display === next.display &&
    prev.attachmentName === next.attachmentName &&
    prev.images.length === next.images.length;
});

const AssistantMessageActions: React.FC<{
  message: SutraAgentMessage;
  onRegenerate?: () => void;
}> = React.memo(({ message, onRegenerate }) => {
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const isGenerating = useIDEStore((s) => s.isAgentGenerating);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasCode = /```[\s\S]*?```/.test(message.content || '');

  const handleCopyCode = () => {
    const codeBlocks = Array.from((message.content || '').matchAll(/```(?:\w+)?\n([\s\S]*?)```/g))
      .map((m) => m[1].trim())
      .join('\n\n// --------------------\n\n');
    if (codeBlocks) {
      navigator.clipboard.writeText(codeBlocks);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  if (isGenerating) return null;

  return (
    <div className="flex items-center gap-1.5 pt-2 text-obsidian-inkMuted select-none">
      <button
        onClick={handleCopy}
        aria-label="Copy response"
        title="Copy response to clipboard"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline hover:border-obsidian-borderBright font-mono text-[11px] font-medium transition-all shadow-xs cursor-pointer select-none active:scale-95"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>

      {hasCode && (
        <button
          onClick={handleCopyCode}
          aria-label="Copy code blocks"
          title="Copy code blocks only"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline hover:border-obsidian-borderBright font-mono text-[11px] font-medium transition-all shadow-xs cursor-pointer select-none active:scale-95"
        >
          {codeCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Code className="w-3.5 h-3.5" />}
          <span>{codeCopied ? 'Code Copied' : 'Copy Code'}</span>
        </button>
      )}

      {onRegenerate && (
        <button
          onClick={onRegenerate}
          aria-label="Regenerate response"
          title="Re-run the previous user prompt"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline hover:border-obsidian-borderBright font-mono text-[11px] font-medium transition-all shadow-xs cursor-pointer select-none active:scale-95"
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>Regenerate</span>
        </button>
      )}
    </div>
  );
}, (prev, next) => {
  return prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.onRegenerate === next.onRegenerate;
});

const UserMessageActions: React.FC<{
  message: SutraAgentMessage;
  onUndo: (message: SutraAgentMessage) => void;
}> = React.memo(({ message, onUndo }) => {
  const [isReverting, setIsReverting] = useState(false);
  const isGenerating = useIDEStore((s) => s.isAgentGenerating);

  const handleClickUndo = async () => {
    if (isReverting) return;
    setIsReverting(true);
    try {
      await onUndo(message);
    } finally {
      setIsReverting(false);
    }
  };

  if (isGenerating) return null;

  return (
    <div className="flex items-center gap-1.5 pt-1.5 select-none opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleClickUndo}
        disabled={isReverting}
        aria-label="Undo this turn"
        title="Restore this prompt to the composer and undo its file mutations"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline hover:border-obsidian-borderBright font-mono text-[11px] font-medium transition-all shadow-xs cursor-pointer select-none active:scale-95 disabled:opacity-50"
      >
        <Undo2 className={`w-3 h-3 ${isReverting ? 'animate-spin' : ''}`} />
        <span>{isReverting ? 'Undoing...' : 'Undo'}</span>
      </button>
    </div>
  );
}, (prev, next) => {
  return prev.message.id === next.message.id &&
    prev.onUndo === next.onUndo;
});

/**
 * Phase detector for the live reasoning trace. Two layers:
 *  1. The agent emits an explicit `[phase: <name>]` tag at the top of its
 *     thinking block per the buildThinkingProtocolContract in
 *     server/harness/agentPromptArchitecture.ts. When present, it wins.
 *  2. Fallback heuristic: maps the most-recent paragraph of the trace
 *     onto one of the same phase buckets so the panel still shows a
 *     sensible label on models that ignore the protocol.
 */
type ReasoningPhase = 'thinking' | 'planning' | 'self_correct' | 'branching' | 'verifying' | 'acting' | 'done';

const PHASE_TAG_RE = /\[phase:\s*(thinking|planning|acting|verifying|self[-_]correct|branching|done)\]/i;

const detectReasoningPhase = (trace: string): ReasoningPhase => {
  // 1. Honour an explicit tag emitted by the model.
  const tagMatch = trace.match(PHASE_TAG_RE);
  if (tagMatch) {
    const raw = tagMatch[1].toLowerCase().replace(/[-_]/g, '_');
    if (raw === 'self_correct' || raw === 'selfcorrect') return 'self_correct';
    if (raw === 'thinking' || raw === 'planning' || raw === 'branching' || raw === 'verifying' || raw === 'acting' || raw === 'done') {
      return raw;
    }
  }
  // 2. Heuristic fallback. Search the *recent* paragraphs first so an old
  //    tag doesn't keep showing once the agent has moved on.
  const recent = trace.split(/\n+/).slice(-6).join(' ').toLowerCase();
  if (/\b(verif|check|test|run|build)\b/.test(recent) && /\b(again|retry|re-?run)\b/.test(recent)) return 'self_correct';
  if (/\b(branch|alternative|instead|or\b|maybe)\b/.test(recent)) return 'branching';
  if (/\b(verif|check|confirm|test|build|run)\b/.test(recent)) return 'verifying';
  if (/\b(plan|outline|step\s*1|approach)\b/.test(recent)) return 'planning';
  return 'thinking';
};

const REASONING_PHASE_META: Record<ReasoningPhase, { label: string; tone: string }> = {
  thinking:     { label: 'Thinking',     tone: 'text-obsidian-inkPrimary' },
  planning:     { label: 'Planning',     tone: 'text-obsidian-inkPrimary' },
  acting:       { label: 'Acting',       tone: 'text-obsidian-inkPrimary' },
  self_correct: { label: 'Self-correct', tone: 'text-obsidian-inkPrimary' },
  branching:    { label: 'Branching',    tone: 'text-obsidian-inkPrimary' },
  verifying:    { label: 'Verifying',    tone: 'text-obsidian-inkPrimary' },
  done:         { label: 'Done',         tone: 'text-obsidian-inkPrimary' },
};

/**
 * Live reasoning panel — replaces the previous plain-text "Reasoning"
 * expander. Surfaces (1) the current phase, (2) the live trace with
 * selectable text, (3) any streaming error that would otherwise be dropped,
 * and (4) a toggle to keep the trace out of the next provider call when
 * context is tight. Phase detection is heuristic — it never blocks the
 * model; the worst it can do is mis-label a section of the trace.
 */
const ReasoningPanel: React.FC<{
  trace: string;
  isOpen: boolean;
  onToggle: () => void;
  sendToModel: boolean;
  onToggleSendToModel: (next: boolean) => void;
  lastError: string | null;
}> = ({ trace, isOpen, onToggle, sendToModel, onToggleSendToModel, lastError }) => {
  const phase = detectReasoningPhase(trace);
  const phaseMeta = REASONING_PHASE_META[phase];
  return (
    <div className="rounded-lg border border-obsidian-hairline bg-obsidian-surface1 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer group rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
        )}
        <span className="shrink-0 text-[11px] font-mono text-obsidian-inkMuted group-hover:text-obsidian-inkSecondary transition-colors duration-150">
          Reasoning
        </span>
        <span
          className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-obsidian-hairline bg-obsidian-surface2 ${phaseMeta.tone}`}
          aria-label={`Current reasoning phase: ${phaseMeta.label}`}
        >
          <span className="w-1 h-1 rounded-full bg-current anim-heartbeat" aria-hidden="true" />
          {phaseMeta.label}
        </span>
        {!isOpen && (
          <span className="truncate text-[11px] font-mono text-obsidian-inkMuted max-w-[280px]">
            {trace.trim().split('\n').filter(Boolean).pop() || 'Reasoning trace'}
          </span>
        )}
        <span className="text-[10px] text-obsidian-inkMuted font-mono ml-auto">
          {isOpen ? 'Hide' : 'Show reasoning'}
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-2.5 pl-[26px] space-y-2">
          {lastError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-200 text-[11px] font-mono px-2.5 py-1.5 flex items-start gap-2" role="alert">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="font-semibold uppercase tracking-wider text-[10px]">Reasoning stream error</div>
                <div className="break-words">{lastError}</div>
              </div>
            </div>
          )}
          <div className="text-[11px] leading-relaxed text-obsidian-inkSecondary whitespace-pre-wrap break-words select-text max-h-72 overflow-y-auto">
            {trace}
          </div>
        </div>
      )}
    </div>
  );
};

export const ManagerShell: React.FC = () => {
  const {
    setUiMode,
    agentMessages,
    updateLastMessageContent,
    isAgentGenerating,
    currentAgentThinking,
    sendThinkingToModel,
    setSendThinkingToModel,
    lastThinkingError,
    pendingApprovals,
    pendingAgentQuestion,
    setPendingApprovals,
    availableModels,
    isSettingsOpen,
    setSettingsOpen,
    lastVerification,
    harnessMode,
    setCoffeeModalOpen,
    isMusicPlaying,
    toggleMusicPlaying,
    musicTrack,
    setMusicTrack,
    setFolderPickerOpen,
    currentWorkspacePath,
    currentWorkspaceName,
    fetchCurrentWorkspace,
    setActiveChatSessionId,
    isTerminalOpen,
    toggleTerminal,
    isPreviewOpen,
    togglePreview,
    setPreviewUrl,
    setIsPreviewOpen,
  } = useIDEStore();

  // Powers the header theme toggle. Was imported but never invoked, which
  // left the toggle referencing undefined bindings.
  const { theme, toggleTheme } = useTheme();

  const [sessionId, setSessionId] = useState<string>(() => `session-${Date.now()}`);
  // Audio track picker dropdown — right-click or chevron-click on the audio
  // button opens it. Fitts's law: the dropdown trigger is the same button
  // the user already knows; Miller's law: cap the menu at 4-5 visible tracks.
  const [isMusicMenuOpen, setIsMusicMenuOpen] = useState(false);
  const [isReviewDismissed, setIsReviewDismissed] = useState(false);
  const musicMenuRef = useRef<HTMLDivElement | null>(null);
  // Sidebar visibility lives in the store so the header slot and the panel
  // share one source of truth (persistence happens inside the store action).
  const isManagerSidebarOpen = useIDEStore((s) => s.isManagerSidebarOpen);
  const toggleManagerSidebar = useIDEStore((s) => s.toggleManagerSidebar);

  useEffect(() => {
    fetchCurrentWorkspace();
  }, [fetchCurrentWorkspace]);

  useEffect(() => {
    setActiveChatSessionId(sessionId);
  }, [sessionId, setActiveChatSessionId]);
  const authWorkspaces = useAuthStore((s) => s.workspaces);
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);

  // Click-outside closes the audio track picker (Jakob's law — every
  // dropdown the user has used closes on outside click; this one must too).
  useEffect(() => {
    if (!isMusicMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (musicMenuRef.current && !musicMenuRef.current.contains(e.target as Node)) {
        setIsMusicMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMusicMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [isMusicMenuOpen]);
  const workspaceName =
    currentWorkspaceName ||
    (currentWorkspacePath ? currentWorkspacePath.split(/[/\\]/).filter(Boolean).pop() : '') ||
    authWorkspaces.find((w) => w.id === activeWorkspaceId)?.name ||
    'omnicraft-ide';
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSettingsBannerDismissed, setIsSettingsBannerDismissed] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const forcedScrollSessionRef = useRef<string | null>(null);

  // End-of-run digest: captured once per generating true->false edge, keyed by
  // sessionId + end timestamp so restored history never grows a card mid-file.
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [showCancelledNotice, setShowCancelledNotice] = useState(false);
  const cancelRequestedRef = useRef(false);
  const lastRunKeyRef = useRef<string | null>(null);
  const heroComposerRef = useRef<HTMLDivElement | null>(null);

  // Landing -> docked composer transition: the chat view fades/rises in over
  // 300ms instead of hard-swapping under the user's cursor.
  const [isPetActive, setIsPetActive] = useState(() => {
    try {
      return localStorage.getItem('sutra-pet-visible') !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const handlePetToggle = (e: CustomEvent<boolean>) => {
      setIsPetActive(e.detail);
    };
    window.addEventListener('sutra-pet-toggle' as any, handlePetToggle as any);
    return () => window.removeEventListener('sutra-pet-toggle' as any, handlePetToggle as any);
  }, []);
  const [chatViewEntered, setChatViewEntered] = useState(false);

  const hasUserMessages = agentMessages.some((m) => m.role === 'user');
  const showGreeting = !hasUserMessages;

  // ask_user hydration fallback: when the agent_question packet missed the
  // store slice, rebuild the question from the raw ask_user toolCall params.
  const askUserFallback = useMemo(
    () => (isAgentGenerating ? findAskUserFallback(agentMessages) : null),
    [agentMessages, isAgentGenerating]
  );
  const showSettingsBanner = availableModels.length === 0 && !isSettingsBannerDismissed;

  // Review flow: distinct files changed via completed write/edit/delete calls
  const changedFiles = useMemo(() => collectChangedFiles(agentMessages), [agentMessages]);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    let timer: any;
    if (isAgentGenerating && !isPaused) {
      const startTime = Date.now();
      timer = setInterval(() => {
        setElapsedSeconds((Date.now() - startTime) / 1000);
      }, 100);
    } else if (!isAgentGenerating) {
      setElapsedSeconds(0);
      setIsPaused(false);
    }
    return () => clearInterval(timer);
  }, [isAgentGenerating, isPaused]);

  // Single consolidated run status: comprehensive banner replaces quiet loader.
  // While an ask_user question or approval is pending, Astra is parked on the user.
  const agentStatus = deriveAgentStatus({
    isGenerating: isAgentGenerating,
    isPaused,
    hasPendingQuestion: Boolean(pendingAgentQuestion),
    hasPendingApprovals: pendingApprovals.length > 0,
    harnessMode,
  });
  const showStatusRow = agentStatus.key !== 'idle';

  // Unregister the ask_user sender and drop any parked question when leaving Manager mode
  useEffect(() => {
    return () => {
      registerQuestionSender(null);
      useIDEStore.getState().setPendingAgentQuestion(null);
    };
  }, []);

  // Persist transcript to the shared session store (same endpoint AgentChat
  // syncs to). Debounced: agentMessages changes on every streamed token, so an
  // eager effect here POSTed per token and tripped server rate limits — the
  // "429" rows the sidebar used to surface. A sync fires only after
  // TRANSCRIPT_SYNC_IDLE_MS of quiet, is skipped when nothing changed since the
  // last one, and is flushed immediately when a run ends.
  const syncPayloadRef = useRef({ messages: agentMessages, sessionId });
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedSignatureRef = useRef<string | null>(null);
  const wasGeneratingRef = useRef(isAgentGenerating);

  const postTranscriptSync = useCallback(() => {
    const { messages, sessionId: id } = syncPayloadRef.current;
    if (messages.length <= 1 || !id) return;
    const signature = transcriptSyncSignature(id, messages);
    if (signature === lastSyncedSignatureRef.current) return;
    lastSyncedSignatureRef.current = signature;
    const meaningfulUserMsg = messages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && /[a-zA-Z0-9]{2,}/.test(m.content)
    ) || messages.find((m) => m.role === 'user');
    const rawText = meaningfulUserMsg ? splitAttachment(meaningfulUserMsg.content).display.split('\n')[0].trim() : '';
    const cleanTitle = rawText.replace(/^[^a-zA-Z0-9]+$/, '').trim() || rawText;
    const defaultTitle = workspaceName ? `${workspaceName} — Chat` : 'New conversation';
    const title = (cleanTitle.slice(0, 45).trim()) || defaultTitle;
    fetch(`/api/chat/sessions/${id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, messages, workspace: currentWorkspacePath, workspaceName }),
    })
      .then(() => setRefreshKey((k) => k + 1))
      .catch(() => {
        // Mark this state unsynced so the next trigger retries it.
        lastSyncedSignatureRef.current = null;
      });
  }, []);

  // Debounce scheduler: every transcript/session change resets the idle window.
  useEffect(() => {
    syncPayloadRef.current = { messages: agentMessages, sessionId };
    if (agentMessages.length <= 1 || !sessionId) return;
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      postTranscriptSync();
    }, TRANSCRIPT_SYNC_IDLE_MS);
    return () => {
      // Session switch or unmount must not leave a stray timer behind.
      if (syncTimerRef.current !== null) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [agentMessages, sessionId, postTranscriptSync]);

  // Run-end edge: flush the final transcript right away instead of waiting out
  // the idle window. Declared after the scheduler so the payload ref already
  // holds this commit's messages when both effects run in the same pass.
  // The same edge captures the run digest (ResultSummaryCard) and, when the
  // stop button caused the end, a one-line "Cancelled by you" notice.
  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    wasGeneratingRef.current = isAgentGenerating;
    if (!wasGenerating || isAgentGenerating) return;
    postTranscriptSync();

    const { messages, sessionId: id } = syncPayloadRef.current;
    if (!id || !messages.some((m) => m.role === 'user')) return;
    const endedAt = Date.now();
    const key = `${id}@${endedAt}`;
    if (lastRunKeyRef.current === key) return;
    lastRunKeyRef.current = key;

    const cancelled = cancelRequestedRef.current;
    cancelRequestedRef.current = false;
    setRunSummary({ ...summarizeRun(messages, { cancelled }), key, endedAt });
    setShowCancelledNotice(cancelled);
  }, [isAgentGenerating, postTranscriptSync]);

  // Landing -> docked handoff: arm the entrance transition whenever the shell
  // leaves the hero. Double-rAF so the hidden state commits before it animates.
  useEffect(() => {
    if (showGreeting) {
      setChatViewEntered(false);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setChatViewEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [showGreeting]);

  // Landing / New Conversation hero state: automatically ensure preview is dismissed
  // so the greeting view is clean, full-width, and not cluttered by empty preview boxes.
  useEffect(() => {
    if (showGreeting && isPreviewOpen) {
      setIsPreviewOpen(false);
    }
  }, [showGreeting, isPreviewOpen, setIsPreviewOpen]);

  // ⌘B / Ctrl+B — toggle the manager sidebar. Wired in the manager shell
  // because the global CommandPalette handler targets the IDE sidebar, not
  // this conversation list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key !== 'b' && e.key !== 'B') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      toggleManagerSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleManagerSidebar]);

  // Auto-scroll only when already near the bottom — streaming never yanks the
  // viewport; a fresh session always lands on the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (forcedScrollSessionRef.current !== sessionId) {
      forcedScrollSessionRef.current = sessionId;
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }));
      return;
    }
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 160) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [agentMessages, currentAgentThinking, sessionId]);

  const handleSend = useCallback((
    text: string,
    attachment: { name: string; content: string } | null,
    images: string[] = [],
    mode?: 'build' | 'plan' | 'edit' | 'chat'
  ) => {
    if (!text.trim() && !attachment && images.length === 0) return;
    // A new prompt starts a fresh run — the previous run's digest retires
    setRunSummary(null);
    setShowCancelledNotice(false);
    useIDEStore.getState().updateAgentThinking('');
    // If an ask_user question is actively waiting, forward the user's message as the answer so the agent unparks!
    const currentPending = useIDEStore.getState().pendingAgentQuestion;
    if (currentPending) {
      answerAgentQuestion(currentPending.id, text.trim());
      markQuestionAnswered(currentPending.id);
      useIDEStore.getState().setPendingAgentQuestion(null);
      appendUserMessageDeduped({
        id: `user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      });
      return;
    }

    // Check if the latest message has an unanswered ask_user toolCall while agent is paused waiting:
    const activeWaitingQuestion = agentMessages
      .flatMap((m) => m.toolCalls || [])
      .find((tc) => tc.tool === 'ask_user' && tc.id && !wasQuestionAnswered(tc.id));
    if (activeWaitingQuestion && isAgentGenerating) {
      answerAgentQuestion(activeWaitingQuestion.id, text.trim());
      markQuestionAnswered(activeWaitingQuestion.id);
      appendUserMessageDeduped({
        id: `user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      });
      return;
    }

    for (const m of agentMessages) {
      if (Array.isArray(m.toolCalls)) {
        for (const tc of m.toolCalls) {
          if (tc.tool === 'ask_user' && tc.id && !wasQuestionAnswered(tc.id)) {
            markQuestionUnanswered(tc.id);
          }
        }
      }
    }
    const attachedContext = attachment ? `${ATTACH_MARKER}${attachment.name}]\n${attachment.content}` : null;
    sendAgentPrompt({ text, attachedContext, chatId: sessionId, images, mode }).catch(() => undefined);
  }, [sessionId, agentMessages, isAgentGenerating]);

  // Listen for targeted element edit requests dispatched from the visual inspector
  useEffect(() => {
    const handleElementEdit = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { elementData, selector, outerHTML, prompt } = detail;
      const cleanSelector = (selector || 'element').trim();
      let technicalBriefing = `<!-- Target Element Selector: ${cleanSelector} -->\n${outerHTML}\n\nPlease apply the requested change specifically to this element/component without modifying unrelated code.`;

      try {
        const res = await fetch('/api/preview/locate-element', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tagName: elementData?.tagName,
            selector: cleanSelector,
            outerHTML,
            textContent: elementData?.textContent,
            classList: elementData?.classList,
            pageUrl: elementData?.pageUrl,
          }),
        });
        if (res.ok) {
          const located = await res.json();
          if (located.briefing) {
            technicalBriefing = `${located.briefing}\n\nOuter HTML:\n${outerHTML}\n\nPlease apply the requested change specifically to this element/component without modifying unrelated code.`;
          }
        }
      } catch {}

      const attachment = {
        name: `element-${cleanSelector.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)}.html`,
        content: technicalBriefing,
      };
      handleSend(prompt || `Modify ${cleanSelector}`, attachment, [], 'build');
    };
    window.addEventListener('sutra-element-edit', handleElementEdit);
    return () => window.removeEventListener('sutra-element-edit', handleElementEdit);
  }, [handleSend]);

  /** Fills the active composer from an example prompt or Undo turn. Writes
   *  through React's own textarea setter so the composer state updates immediately. */
  const fillComposerInput = (text: string) => {
    const el = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message Astra"], textarea');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  /** 1-Click Undo: Restores user prompt to input, vanishes turn & all subsequent messages, and reverts changes */
  const handleUndoMessage = async (msg: SutraAgentMessage) => {
    const msgs = useIDEStore.getState().agentMessages;
    const msgIdx = msgs.findIndex((m) => m.id === msg.id);
    if (msgIdx === -1) return;

    // 1. Put the prompt text back into the composer
    const { display } = splitAttachment(msg.content);
    fillComposerInput(display);

    // 2. Vanish this message and everything afterwards from the transcript
    const remaining = msgs.slice(0, msgIdx);
    useIDEStore.setState({
      agentMessages: remaining.length > 0 ? remaining : [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
    });

    // 3. Rollback any filesystem changes made by that turn
    try {
      await fetch('/api/checkpoints/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'latest' }),
      });
      useIDEStore.getState().triggerFileTreeRefresh();
    } catch {
      // Best-effort rollback
    }
  };

  const handleCancel = () => {
    // Remember the stop was user-initiated so the run-end edge can surface it
    cancelRequestedRef.current = true;
    cancelAgentStream();
    useIDEStore.getState().setPendingAgentQuestion(null);
    updateLastMessageContent('\n\n*(Generation stopped. All progress preserved — continue anytime.)*');
  };

  // Review overlay: jump into the full IDE with the first changed file loaded
  const handleOpenInIde = (path: string) => {
    setIsDiffOpen(false);
    setUiMode('ide');
    void useIDEStore.getState().openFilePath(path);
  };

  const handleNewConversation = () => {
    const newId = `session-${Date.now()}`;
    setSessionId(newId);
    // Fresh session — nothing from the previous run carries over
    setRunSummary(null);
    setShowCancelledNotice(false);
    setIsPreviewOpen(false);
    setIsReviewDismissed(false);
    useIDEStore.setState({ agentMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }] });
    const initialTitle = workspaceName ? `${workspaceName} — Chat` : 'New conversation';
    fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId, title: initialTitle, workspace: currentWorkspacePath, workspaceName }),
    })
      .then(() => setRefreshKey((k) => k + 1))
      .catch(() => undefined);
  };

  const handleRegenerate = (msgIndex: number) => {
    if (isAgentGenerating) return;
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (agentMessages[i].role === 'user') {
        const userPrompt = agentMessages[i].content;
        handleSend(userPrompt, null, agentMessages[i].images || [], agentMessages[i].mode);
        break;
      }
    }
  };

  const handleExportConversation = () => {
    if (!agentMessages || agentMessages.length === 0) return;
    const lines: string[] = [
      `# SUTRA Conversation Export`,
      `*Session ID: ${sessionId}*`,
      `*Exported: ${new Date().toLocaleString()}*`,
      '',
    ];
    agentMessages.forEach((m) => {
      const author = m.role === 'user' ? '👤 User' : '🤖 SUTRA';
      lines.push(`## ${author}`);
      lines.push('');
      lines.push(m.content || '');
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sutra-conversation-${sessionId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearConversation = () => {
    if (confirm('Clear all messages in the current conversation?')) {
      useIDEStore.setState({ agentMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }] });
      setRunSummary(null);
      setShowCancelledNotice(false);
    }
  };

  const handleOpenConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        useIDEStore.setState({ agentMessages: data.messages });
        setSessionId(id);
        // Restored history is never the just-finished run
        setRunSummary(null);
        setShowCancelledNotice(false);
      }
    } catch {
      // Keep current view on failure — list row simply won't switch
    }
  };

  // Reopening the app lands back in the most recent conversation instead of a
  // blank hero — the chat survives refreshes and closes.
  useEffect(() => {
    let cancelled = false;
    const restoreLastSession = async () => {
      try {
        const res = await fetch('/api/chat/sessions');
        const data = await res.json();
        const sessions: Array<{ id: string; message_count: number }> = Array.isArray(data.sessions) ? data.sessions : [];
        const latest = sessions.find((s) => s.message_count > 0);
        if (latest && !cancelled) {
          await handleOpenConversation(latest.id);
        }
      } catch {
        // Offline or fresh install — the hero stays
      }
    };
    restoreLastSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDeleteConversation = async (id: string) => {
    const confirmed = window.confirm('Delete this conversation? This cannot be undone.');
    if (!confirmed) return;
    try {
      await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
      if (useIDEStore.getState().pinnedSessionIds.includes(id)) {
        useIDEStore.getState().togglePinSession(id);
      }
      if (id === sessionId) handleNewConversation();
      else setRefreshKey((k) => k + 1);
    } catch {
      // Deletion failed server-side; list refreshes and shows the truth
      setRefreshKey((k) => k + 1);
    }
  };

  const handleApprove = async (toolId: string) => {
    try {
      setPendingApprovals((prev) => prev.filter((p) => p.id !== toolId));
      useIDEStore.getState().setPendingApprovals((prev: ToolCallPayload[]) => prev.filter((p: ToolCallPayload) => p.id !== toolId));
      await fetch('/api/swarm/approve-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId: toolId }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleReject = async (toolId: string) => {
    try {
      setPendingApprovals((prev) => prev.filter((p) => p.id !== toolId));
      useIDEStore.getState().setPendingApprovals((prev: ToolCallPayload[]) => prev.filter((p: ToolCallPayload) => p.id !== toolId));
      await fetch('/api/swarm/reject-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId: toolId }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const isDesktop = typeof window !== 'undefined' && /electron/i.test(navigator.userAgent);

  return (
    <div className="h-screen w-screen flex flex-col bg-obsidian-canvas text-obsidian-inkPrimary overflow-hidden font-sans">
      {/* Top bar */}
      <header className={`h-10 shrink-0 bg-obsidian-canvas border-b border-obsidian-hairline flex items-center justify-between px-3 select-none z-30 relative gap-3 overflow-x-auto overflow-y-hidden app-region-drag ${isDesktop ? 'pr-[140px]' : ''}`}>
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <button
            type="button"
            onClick={toggleManagerSidebar}
            title={isManagerSidebarOpen ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
            aria-label={isManagerSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            className="icon-btn-sm"
          >
            {isManagerSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeft className="w-4 h-4" />
            )}
          </button>
          <div className="flex items-center gap-2 shrink-0" aria-label="Sutra">
            <img src="/assets/sutra-icon.svg" alt="SUTRA" className="w-4 h-4 object-contain" />
            <span className="font-bold tracking-widest uppercase text-[11px] text-obsidian-inkPrimary font-mono">SUTRA</span>
          </div>
          <div className="h-3 w-px bg-obsidian-hairline mx-1 shrink-0" />

          {/* Active workspace breadcrumb */}
          <span className="text-[11px] font-mono text-obsidian-inkSecondary max-w-[180px] sm:max-w-[220px] truncate select-none" title={`Active workspace: ${currentWorkspacePath || workspaceName}`}>
            {workspaceName}
          </span>
        </div>

        {/* Action Controls (Audio Focus, Terminal, Stop, Preview, Open IDE) */}
        <div className="flex items-center gap-1.5 relative shrink-0 flex-nowrap">
          {/* Lo-Fi Focus Audio Toggle */}
          <div ref={musicMenuRef} className="relative">
            <button
              onClick={toggleMusicPlaying}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsMusicMenuOpen((open) => !open);
              }}
              className={`flex items-center justify-center h-7 w-7 rounded-md text-[10px] font-mono transition-all cursor-pointer border select-none ${
                isMusicPlaying
                  ? 'bg-obsidian-surface3 text-obsidian-inkPrimary border-obsidian-borderBright shadow-[0_0_12px_rgba(255,255,255,0.08)] ring-1 ring-obsidian-hairline font-semibold'
                  : 'bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border-obsidian-hairline'
              }`}
              title={isMusicPlaying ? 'Stop Focus Audio (right-click for tracks)' : 'Play Focus Audio (right-click for tracks)'}
              aria-label="Toggle Focus Audio"
            >
              <Music className={`w-3.5 h-3.5 shrink-0 ${isMusicPlaying ? 'animate-pulse text-obsidian-inkPrimary' : 'text-obsidian-inkMuted'}`} />
            </button>
            {isMusicMenuOpen && (
              <div
                role="menu"
                aria-label="Focus audio track"
                className="absolute right-0 top-full mt-1.5 z-50 min-w-52 glass-dropdown p-1 anim-appear border border-obsidian-border shadow-2xl rounded-xl"
              >
                <div className="px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.14em] text-obsidian-inkMuted border-b border-obsidian-hairline mb-1">
                  Focus audio track
                </div>
                {TRACK_METADATA.map((track) => {
                  const isActive = musicTrack === track.id;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      role="menuitem"
                      aria-pressed={isActive}
                      onClick={() => {
                        setMusicTrack(track.id);
                        if (!isMusicPlaying) toggleMusicPlaying();
                        setIsMusicMenuOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-[11px] transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-medium'
                          : 'text-obsidian-inkSecondary hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary'
                      }`}
                    >
                      <span className="block leading-tight">{track.title}</span>
                      <span className="block text-[10px] text-obsidian-inkMuted leading-snug mt-0.5">{track.description}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Terminal Toggle */}
          <button
            type="button"
            onClick={toggleTerminal}
            aria-pressed={isTerminalOpen}
            title={isTerminalOpen ? 'Hide Terminal (Ctrl+`)' : 'Show Terminal (Ctrl+`)'}
            aria-label="Toggle Terminal"
            className={`flex items-center justify-center h-7 w-7 rounded-md border text-[10px] font-mono transition-colors cursor-pointer select-none ${
              isTerminalOpen
                ? 'bg-obsidian-inkPrimary text-obsidian-canvas border-obsidian-inkPrimary'
                : 'bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border-obsidian-hairline hover:bg-obsidian-surface2'
            }`}
          >
            <TerminalSquare className="w-3.5 h-3.5" />
          </button>

          {/* Buy Me a Coffee button */}
          <button
            type="button"
            onClick={() => setCoffeeModalOpen(true)}
            aria-label="Support SUTRA / Buy Me A Coffee"
            title="Support SUTRA / Buy Me A Coffee"
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-obsidian-hairline hover:border-obsidian-border bg-obsidian-surface1 hover:bg-obsidian-surface2 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer select-none font-semibold group"
          >
            <Coffee className="w-3.5 h-3.5 text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary" />
            <span className="hidden sm:inline">Coffee</span>
          </button>

          {/* Cyber Pet Companion Toggle */}
          <button
            type="button"
            onClick={() => {
              const next = !isPetActive;
              setIsPetActive(next);
              localStorage.setItem('sutra-pet-visible', String(next));
              window.dispatchEvent(new CustomEvent('sutra-pet-toggle', { detail: next }));
            }}
            aria-label={isPetActive ? 'Hide AI Pet Companion' : 'Show AI Pet Companion'}
            title={isPetActive ? 'Hide AI Pet Companion' : 'Show AI Pet Companion'}
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer select-none font-semibold ${
              isPetActive
                ? 'bg-obsidian-surface3 text-obsidian-inkPrimary border-obsidian-borderBright'
                : 'bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border-obsidian-hairline'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary" />
            <span className="hidden sm:inline">Pet</span>
          </button>

          {/* Live Preview toggle button — only available during an active conversation */}
          {!showGreeting && (
            <button
              type="button"
              onClick={togglePreview}
              aria-label="Toggle live website preview"
              title="Toggle live website preview & visual inspector"
              className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer select-none font-semibold border ${
                isPreviewOpen
                  ? 'bg-obsidian-surface3 text-obsidian-inkPrimary border-obsidian-borderBright shadow-xs'
                  : 'bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border-obsidian-hairline'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Preview</span>
            </button>
          )}

          {/* More conversation options (Export, Clear) */}
          {!showGreeting && agentMessages.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleExportConversation}
                aria-label="Export conversation as Markdown"
                title="Export conversation as Markdown (.md)"
                className="flex items-center justify-center w-7 h-7 rounded-md border border-obsidian-hairline bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer select-none"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleClearConversation}
                aria-label="Clear conversation"
                title="Clear conversation and return to home"
                className="flex items-center justify-center w-7 h-7 rounded-md border border-obsidian-hairline bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-red-400 hover:bg-obsidian-surface2 transition-colors cursor-pointer select-none"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="h-3 w-px bg-obsidian-hairline mx-0.5" />

          {/* Direct Dark / Light Mode Switcher */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="flex items-center justify-center w-7 h-7 rounded-md border border-obsidian-hairline bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer select-none"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-transform duration-200 hover:rotate-45" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-obsidian-inkPrimary transition-transform duration-200 hover:-rotate-12" />
            )}
          </button>

          {/* Switch to IDE mode */}
          <button
            onClick={() => setUiMode('ide')}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-border transition-colors text-[10px] font-mono uppercase tracking-wider cursor-pointer font-semibold"
            title="Switch to full IDE workspace view"
          >
            <MonitorPlay className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Open IDE</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar can be hidden for a calmer hero — defaults open, persisted in
            localStorage so the choice survives reloads. */}
        {isManagerSidebarOpen && (
          <ManagerSidebar
            activeSessionId={sessionId}
            refreshKey={refreshKey}
            onNewConversation={handleNewConversation}
            onOpenConversation={handleOpenConversation}
            onDeleteConversation={handleDeleteConversation}
            onCollapse={toggleManagerSidebar}
          />
        )}


        {/* Hero mode: openCode-style landing with dedicated dark/light Sutra watermark */}
        {showGreeting ? (
          <main className="flex-1 min-w-0 relative flex flex-col items-center justify-center overflow-y-auto px-4 py-8 pb-16 bg-obsidian-canvas">
            {/* Squared boxes grid background pattern */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-grid-pattern bg-grid-mask opacity-75 dark:opacity-60 z-0"
            />

            {/* Prominent Sutra Architectural Watermark & Atmospheric Glow Backdrop */}
            <div role="img" aria-label="Sutra Backdrop" className="pointer-events-none absolute inset-0 overflow-hidden flex flex-col items-center justify-center select-none z-0">
              {/* Radial atmospheric ambient glow */}
              <div
                className="absolute w-[800px] h-[480px] -translate-y-8 rounded-full pointer-events-none"
                style={{
                  background:
                    theme === 'dark'
                      ? 'radial-gradient(ellipse at 50% 50%, rgba(56, 189, 248, 0.08) 0%, rgba(99, 102, 241, 0.04) 45%, transparent 75%)'
                      : 'radial-gradient(ellipse at 50% 50%, rgba(56, 189, 248, 0.12) 0%, transparent 70%)',
                }}
              />
              {/* Grand Architectural Sutra Wordmark */}
              <div className="absolute top-[10%] sm:top-[12%] text-[100px] sm:text-[160px] md:text-[220px] font-black tracking-[0.18em] uppercase text-obsidian-inkPrimary/[0.08] dark:text-obsidian-inkPrimary/[0.14] select-none font-mono pointer-events-none leading-none">
                SUTRA
              </div>
            </div>

            <div className="relative z-10 w-full max-w-2xl flex flex-col items-center text-center space-y-6 anim-fade-up translate-y-4 sm:translate-y-6">
              {/* Headline — clean and uncluttered below the prominent embossed SUTRA wordmark */}
              <div className="space-y-1.5 pb-1">
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-obsidian-inkPrimary">
                  What would you like to build?
                </h1>
                <p className="text-xs sm:text-sm text-obsidian-inkMuted max-w-md">
                  Autonomous codebase generation, surgical refactors, and test verification.
                </p>
              </div>

              {/* Composer — single-line, auto-grows, inline pill toolbar */}
              <div className="w-full" ref={heroComposerRef}>
                <HeroComposer
                  isGenerating={isAgentGenerating}
                  onSend={(text, images, attachment, mode) => handleSend(text, attachment || null, images, mode)}
                  onCancel={handleCancel}
                />
              </div>

              {/* Workspace + branch strip + connect models link */}
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={() => setFolderPickerOpen(true)}
                  title={`Current workspace: ${workspaceName}. Click to open or switch folder.`}
                  className="group flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono text-obsidian-inkMuted hover:text-obsidian-inkSecondary hover:bg-obsidian-surface1 transition-colors cursor-pointer"
                >
                  <span className="w-3.5 h-3.5 rounded-[3px] bg-[color:var(--accent-soft)] border border-obsidian-border flex items-center justify-center text-[8px] font-bold text-obsidian-inkPrimary leading-none">
                    {(workspaceName || 'o').charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate max-w-[240px]">{workspaceName}</span>
                  <span className="text-obsidian-inkFaint px-0.5">/</span>
                  <GitBranch className="w-3 h-3" aria-hidden="true" />
                  <span>main</span>
                </button>

                {availableModels.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1 transition-colors cursor-pointer"
                  >
                    <KeyRound className="w-3 h-3 text-obsidian-inkMuted" />
                    <span>Connect models in Settings</span>
                  </button>
                )}
              </div>
            </div>
          </main>
        ) : (
        <main
          className={`flex-1 min-w-0 flex flex-col overflow-hidden transition-all duration-300 ease-out ${
            chatViewEntered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          }`}
        >
          {/* Transcript region */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-4 pt-3 pb-6">
            {showSettingsBanner && (
              <div role="status" className="-mx-4 mb-3 px-4 pt-2">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-obsidian-border bg-obsidian-surface2 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0 text-[11px] text-obsidian-inkSecondary">
                    <KeyRound className="w-3.5 h-3.5 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
                    <span className="truncate">Add API keys or cookies in Settings to connect models.</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setSettingsOpen(true)}
                      className="px-2.5 py-1 rounded-md border border-obsidian-border bg-obsidian-surface2 hover:bg-obsidian-surface3 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-borderBright"
                    >
                      Open Settings
                    </button>
                    <button
                      onClick={() => setIsSettingsBannerDismissed(true)}
                      aria-label="Dismiss settings banner"
                      title="Dismiss"
                      className="p-1 rounded-md text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showGreeting && (
              <div className="pt-12 pb-6 text-center space-y-2.5 animate-in fade-in duration-150">
                <div className="text-sm font-mono uppercase tracking-[0.35em] text-obsidian-inkSecondary select-none">
                  Astra
                </div>
                <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-obsidian-inkPrimary">
                  What are we building today?
                </h1>
                <p className="text-xs text-obsidian-inkMuted max-w-md mx-auto leading-relaxed">
                  Describe a feature or paste an error — Astra reads your workspace, plans the change, builds it, and verifies the result before handing it back.
                </p>
                {availableModels.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-obsidian-inkMuted hover:text-obsidian-inkSecondary underline underline-offset-2 decoration-obsidian-inkFaint transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border rounded"
                  >
                    Connect models in Settings
                  </button>
                )}
              </div>
            )}

            {/* Transcript */}
            {!showGreeting && (
              <div className="space-y-4" role="log" aria-label="Conversation transcript" aria-live="polite">
                {/* Active workspace & conversation header */}
                <div className="flex items-center justify-between pb-3 border-b border-obsidian-hairline text-[11px] font-mono text-obsidian-inkSecondary select-none">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-obsidian-inkPrimary font-medium truncate" title={`Active workspace: ${currentWorkspacePath || workspaceName}`}>
                      {workspaceName}
                    </span>
                    <span className="text-obsidian-inkFaint">/</span>
                    <span className="text-obsidian-inkMuted truncate" title={`Session ID: ${sessionId}`}>
                      {sessionId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-obsidian-inkFaint uppercase tracking-wider">Active Chat</span>
                  </div>
                </div>
                {agentMessages.map((msg, index) => {
                  if (msg.role === 'user') {
                    const { display, attachmentName } = splitAttachment(msg.content);
                    const images = (msg as typeof msg & { images?: string[] }).images || [];
                    return (
                      <div key={msg.id} className="flex flex-col items-end group defer-render">
                        <div className="max-w-[85%] rounded-2xl bg-obsidian-surface3 text-obsidian-inkPrimary border border-obsidian-border px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words select-text shadow-sm">
                          <UserMessageBody display={display} attachmentName={attachmentName || undefined} images={images} />
                        </div>
                        <UserMessageActions message={msg} onUndo={handleUndoMessage} />
                      </div>
                    );
                  }

                  const hasAssistantContent =
                    Boolean(msg.content && msg.content.trim()) ||
                    Boolean(msg.toolCalls && msg.toolCalls.length > 0) ||
                    Boolean(msg.thinking && msg.thinking.trim());
                  // Empty placeholders render nothing — never render empty boxed container
                  if (!hasAssistantContent) {
                    return null;
                  }

                  return (
                    <div key={msg.id} className="flex flex-col items-start w-full text-xs leading-relaxed select-text space-y-1.5 py-1 defer-render">
                      <AssistantMessageBody message={msg} />
                      <AssistantMessageActions message={msg} onRegenerate={() => handleRegenerate(index)} />
                    </div>
                  );
                })}

                {/* Quiet cancellation receipt — appended once when this run was stopped by you */}
                {showCancelledNotice && !isAgentGenerating && (
                  <p role="status" className="px-1 text-[11px] italic text-obsidian-inkMuted select-none">
                    Cancelled by you
                  </p>
                )}

                {/* Reasoning panel — phase-aware live trace. Four logical
                    phases (thinking → planning → self-correct → branching) are
                    detected from the trace content so the user can see where
                    the agent is in its decision loop, plus a "Send to model"
                    toggle that drops the trace from the next provider call
                    when context is tight. Errors surface inline rather than
                    silently truncating. */}
                {isAgentGenerating && currentAgentThinking && (
                  <ReasoningPanel
                    trace={currentAgentThinking}
                    isOpen={isTraceOpen}
                    onToggle={() => setIsTraceOpen((open) => !open)}
                    sendToModel={sendThinkingToModel}
                    onToggleSendToModel={setSendThinkingToModel}
                    lastError={lastThinkingError}
                  />
                )}

                {pendingApprovals.map((pa) => (
                  <ApprovalCard key={pa.id} toolCall={pa} onApprove={handleApprove} onReject={handleReject} />
                ))}

                {/* ask_user card — rendered inline inside assistant messages via renderManagerToolElement;
                    this bottom slot is only a fallback for the rare race where the question
                    lands before any assistant message carries it. */}
                {!agentMessages.some((m) => Array.isArray(m.toolCalls) && m.toolCalls.some((tc) => tc.tool === 'ask_user')) &&
                  (pendingAgentQuestion || askUserFallback) && <AskUserCard fallback={askUserFallback} />}

                {/* Comprehensive Live Task Status Banner with Running/Paused/Approval indicators */}
                <AgentStatusBanner
                  status={agentStatus}
                  isGenerating={isAgentGenerating}
                  isPaused={isPaused}
                  thinking={currentAgentThinking}
                  elapsedSeconds={elapsedSeconds}
                  onPause={() => setIsPaused(true)}
                  onResume={() => setIsPaused(false)}
                  onVerify={() => {
                    handleSend('Run full verification, typecheck, and tests on the latest changes', null);
                  }}
                />
              </div>
            )}

            <div ref={bottomRef} aria-hidden="true" />
          </div>
          </div>

          {/* Review summary row — completed write/edit/delete calls in this session; fixed above the composer */}
          {!showGreeting && !isReviewDismissed && changedFiles.length > 0 && (
            <div className="shrink-0 border-t border-obsidian-hairline bg-obsidian-canvas animate-in fade-in slide-in-from-bottom-2 duration-150">
              <div className="max-w-3xl mx-auto w-full px-4 py-2">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-obsidian-border bg-obsidian-surface1 px-3 py-1.5 shadow-xs">
                  <div className="flex items-center gap-2 min-w-0 text-[11px] font-mono text-obsidian-inkSecondary">
                    <FileCode className="w-3.5 h-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                    <span className="shrink-0 font-medium text-obsidian-inkPrimary">
                      {changedFiles.length} file{changedFiles.length === 1 ? '' : 's'} changed
                    </span>
                    <span className="truncate text-obsidian-inkMuted" title={changedFiles.map((f) => f.path).join(', ')}>
                      {changedFiles
                        .map((f) => f.path.split(/[/\\]/).pop())
                        .filter(Boolean)
                        .slice(0, 3)
                        .join(', ')}
                      {changedFiles.length > 3 ? `, +${changedFiles.length - 3}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(() => {
                      const siteFile = changedFiles.find((f) => /index\.html?$/i.test(f.path))
                        || changedFiles.find((f) => /\.html?$/i.test(f.path))
                        || changedFiles.find((f) => /(?:package\.json|App\.[tj]sx?|page\.[tj]sx?)$/i.test(f.path));
                      if (!siteFile) return null;
                      return (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/preview/launch', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ path: siteFile.path, chatId: sessionId }),
                              });
                              const data = await res.json();
                              if (data?.url || data?.previewUrl) {
                                setPreviewUrl(data.previewUrl || data.url, sessionId);
                                setIsPreviewOpen(true);
                                return;
                              }
                            } catch {}
                            const fallbackUrl = /\.html?$/i.test(siteFile.path)
                              ? `/workspace/${String(siteFile.path).replace(/\\/g, '/').replace(/^\//, '')}`
                              : '/preview';
                            setPreviewUrl(fallbackUrl, sessionId);
                            setIsPreviewOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-mono font-medium transition-all shadow-xs cursor-pointer active:scale-95 shrink-0 select-none"
                          title="Run project with live dev server in preview"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Run site</span>
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => setIsDiffOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-obsidian-border bg-obsidian-surface2 hover:bg-obsidian-surface3 text-[11px] font-mono font-medium text-obsidian-inkPrimary transition-all shadow-xs cursor-pointer active:scale-95 shrink-0 select-none"
                    >
                      <FileCode className="w-3 h-3" />
                      <span>Review</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsReviewDismissed(true)}
                      aria-label="Dismiss changes banner"
                      title="Dismiss changes banner"
                      className="p-1 rounded-md text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer select-none"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Live task indicator (Antigravity-style) — above the composer */}
          <RunningTasksBar />

          {/* Composer — anchored to the bottom edge; never floats between sections or shifts */}
          <div className="shrink-0 bg-obsidian-canvas">
            <div className="max-w-3xl mx-auto w-full px-4 pt-2 pb-3">
              <ManagerComposer
                isGenerating={isAgentGenerating}
                onSend={handleSend}
                onCancel={handleCancel}
                showQuickActions={false}
              />
            </div>
          </div>
        </main>
        )}

        {/* Right-side activity panel: hides while live preview is open so both have ample room */}
        {!showGreeting && !isPreviewOpen && <ActivityPanel />}

        {/* Live Website Preview & Targeted Visual Element Inspector: never shown on new conversation hero */}
        {!showGreeting && isPreviewOpen && <MultiViewport />}
      </div>

      {/* Terminal Drawer in Manager Mode */}
      {isTerminalOpen && <ConPTYTerminal />}

      {/* Settings renders above Manager mode via its fixed z-50 overlay */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Modals & Dialogs */}
      <QRPairingModal />
      <CoffeeModal />
      <UserGuideModal />
      <SkillsModal />
      <MemoryModal />
      <ArtifactViewerModal />
      <OpenFolderModal />

      {/* Review overlay: side-by-side diffs of every file changed this session */}
      <ManagerDiffView
        open={isDiffOpen}
        entries={changedFiles}
        onClose={() => setIsDiffOpen(false)}
        onOpenInIde={handleOpenInIde}
      />
    </div>
  );
};
