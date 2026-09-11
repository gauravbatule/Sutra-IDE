import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Film,
  FileCode,
  Image as ImageIcon,
  ListChecks,
  Palette,
  Play,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  Terminal,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { ToolCallPayload } from '../../types/ide.js';
import { MarkdownRenderer } from '../Agent/MarkdownRenderer.js';
import { deriveAgentStatus } from '../../utils/agentStatus.js';

const FILE_TOOLS = ['write_file', 'edit_file', 'delete_file'];
const ARTIFACT_TOOLS = ['generate_image_asset', 'generate_svg_asset', 'generate_video_asset', 'generate_audio_asset'];

const basename = (path: string): string => path.split(/[/\\]/).pop() || path;

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  children: React.ReactNode;
}

/** Small-caps collapsible section used for every panel group. */
const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, count, children }) => {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <section aria-label={title}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-1 py-0.5 text-left cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-obsidian-inkMuted shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-3 h-3 text-obsidian-inkMuted shrink-0" aria-hidden="true" />
        )}
        <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted group-hover:text-obsidian-inkSecondary transition-colors duration-150">
          {title}
        </span>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[10px] font-mono text-obsidian-inkMuted ml-auto">{count}</span>
        )}
      </button>
      {isOpen && <div className="mt-1.5 space-y-1">{children}</div>}
    </section>
  );
};

const EmptyLine: React.FC<{ label: string }> = ({ label }) => (
  <div className="px-2 py-1.5 rounded-lg border border-dashed border-obsidian-hairline text-[10px] font-mono text-obsidian-inkMuted">
    {label}
  </div>
);

/** Neutral status dot — obsidian neutrals; red strictly for failures. */
const StatusDot: React.FC<{ tone: 'idle' | 'active' | 'attention' | 'failed' }> = ({ tone }) => (
  <span
    aria-hidden="true"
    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
      tone === 'failed'
        ? 'bg-red-400'
        : tone === 'active' || tone === 'attention'
          ? 'bg-obsidian-inkPrimary'
          : 'bg-obsidian-inkMuted opacity-60'
    }`}
  />
);

const toolFailed = (tc: ToolCallPayload): boolean =>
  tc.status === 'failed' || Boolean(tc.error) || Boolean(tc.result?.error || tc.result?.failed);

const toolCompleted = (tc: ToolCallPayload): boolean => tc.status === 'completed' || Boolean(tc.result);

interface FileChangeEntry {
  path: string;
  tool: string;
  failed: boolean;
  running: boolean;
}

interface ArtifactEntry {
  key: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  url: string | null;
}

const VISIBLE_ARTIFACTS = 4;

/** 94000 -> "94k"; 128000000 -> "128M" */
const fmtK = (n: number): string => {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
};

/** 4200 -> "4s"; 82000 -> "1m 22s" */
const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

/** 65 -> "1:05"; 3700 -> "1:01:40" */
const fmtElapsed = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

interface ServerArtifact {
  id: string;
  name: string;
  type: 'plan' | 'implementation' | 'design' | 'asset' | 'verification' | 'doc';
  status: 'draft' | 'in_progress' | 'done';
  content: string;
  updatedAt: number;
}

const ARTIFACT_TYPE_ICONS: Record<ServerArtifact['type'], typeof FileCode> = {
  plan: ListChecks,
  implementation: FileCode,
  design: Palette,
  asset: ImageIcon,
  verification: CheckCircle2,
  doc: BookOpen,
};

/** Trackable work artifacts (plans, implementations, verification) from .sutra/artifacts. */
const ArtifactViewer: React.FC<{ artifact: ServerArtifact; onClose: () => void }> = ({ artifact, onClose }) => (
  <div
    className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6"
    role="dialog"
    aria-label={`Artifact: ${artifact.name}`}
    onClick={onClose}
  >
    <div
      className="w-full max-w-2xl max-h-[80vh] rounded-xl border border-obsidian-border bg-obsidian-surface2 shadow-elevation flex flex-col overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-obsidian-hairline shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-obsidian-inkPrimary truncate">{artifact.name}</div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
            {artifact.type} · {artifact.status}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close artifact"
          className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 text-sm">
        <MarkdownRenderer content={artifact.content} />
      </div>
    </div>
  </div>
);

/** Lightbox preview for generated media artifacts (images, video, audio). */
const MediaViewer: React.FC<{ artifact: ArtifactEntry; onClose: () => void }> = ({ artifact, onClose }) => (
  <div
    className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6"
    role="dialog"
    aria-label={`Preview: ${artifact.name}`}
    onClick={onClose}
  >
    <div
      className="w-full max-w-2xl rounded-xl border border-obsidian-border bg-obsidian-surface2 shadow-elevation overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-obsidian-hairline shrink-0">
        <div className="min-w-0 text-sm font-semibold text-obsidian-inkPrimary truncate">{artifact.name}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>
      <div className="p-4 bg-obsidian-canvas flex items-center justify-center">
        {artifact.kind === 'video' ? (
          <video src={artifact.url!} controls autoPlay loop muted playsInline className="max-h-[60vh] w-full bg-black object-contain" />
        ) : artifact.kind === 'audio' ? (
          <audio src={artifact.url!} controls className="w-full" />
        ) : (
          <img src={artifact.url!} alt={artifact.name} className="max-h-[60vh] object-contain" />
        )}
      </div>
    </div>
  </div>
);

export const ActivityPanel: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  const agentMessages = useIDEStore((s) => s.agentMessages);
  const isAgentGenerating = useIDEStore((s) => s.isAgentGenerating);
  const activeModelName = useIDEStore((s) => s.activeModel?.name);
  const pendingAgentQuestion = useIDEStore((s) => s.pendingAgentQuestion);
  const subagents = useIDEStore((s) => s.subagents);
  const assets = useIDEStore((s) => s.assets);
  const retryLog = useIDEStore((s) => s.retryLog);
  const lastRunUsage = useIDEStore((s) => s.lastRunUsage);

  // Ticking clock so subagent elapsed timers stay live while anything runs
  const [, setTick] = useState(0);
  const anySubagentActive = subagents.some((sa) => sa.status !== 'completed' && sa.status !== 'failed');
  useEffect(() => {
    if (!anySubagentActive) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [anySubagentActive]);

  // Server-side work artifacts (plans, implementations, verification) — refreshed when runs end
  const [workArtifacts, setWorkArtifacts] = useState<ServerArtifact[]>([]);
  const [viewingArtifact, setViewingArtifact] = useState<ServerArtifact | null>(null);
  const [viewingMedia, setViewingMedia] = useState<ArtifactEntry | null>(null);
  useEffect(() => {
    const load = () =>
      fetch('/api/artifacts')
        .then((r) => r.json())
        .then((d) => setWorkArtifacts(Array.isArray(d.artifacts) ? d.artifacts : []))
        .catch(() => undefined);
    load();
    if (isAgentGenerating) {
      const interval = setInterval(load, 15000);
      return () => clearInterval(interval);
    }
  }, [isAgentGenerating]);

  // Managed processes (dev servers the agent started) — port, liveness, auto-retry state
  interface ManagedProcessRow {
    id: string;
    command: string;
    port: number | null;
    status: string;
    attempts: number;
    lastError: string | null;
  }
  const [managedProcesses, setManagedProcesses] = useState<ManagedProcessRow[]>([]);
  useEffect(() => {
    const load = () =>
      fetch('/api/processes')
        .then((r) => r.json())
        .then((d) => setManagedProcesses(Array.isArray(d.processes) ? d.processes : []))
        .catch(() => undefined);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const stopProcess = async (id: string) => {
    try {
      await fetch(`/api/processes/${id}/stop`, { method: 'POST' });
      setManagedProcesses((list) => list.map((p) => (p.id === id ? { ...p, status: 'stopped' } : p)));
    } catch {
      // Poll will reflect reality
    }
  };

  // Flatten every tool call across the transcript in chronological order
  const allToolCalls = useMemo(
    () => agentMessages.flatMap((m) => (Array.isArray(m.toolCalls) ? m.toolCalls : [])),
    [agentMessages]
  );

  const fileChanges = useMemo<FileChangeEntry[]>(() => {
    const byPath = new Map<string, FileChangeEntry>();
    const order: string[] = [];
    for (const tc of allToolCalls) {
      if (!FILE_TOOLS.includes(tc.tool)) continue;
      const path = typeof tc.params?.path === 'string' ? tc.params.path : '';
      if (!path) continue;
      if (!byPath.has(path)) {
        order.push(path);
        byPath.set(path, {
          path,
          tool: tc.tool,
          failed: toolFailed(tc),
          running: !toolCompleted(tc) && !toolFailed(tc),
        });
      } else {
        byPath.set(path, {
          path,
          tool: tc.tool,
          failed: toolFailed(tc),
          running: !toolCompleted(tc) && !toolFailed(tc),
        });
      }
    }
    return order.map((p) => byPath.get(p)!);
  }, [allToolCalls]);

  const artifacts = useMemo<ArtifactEntry[]>(() => {
    const fromTools: ArtifactEntry[] = allToolCalls
      .filter((tc) => ARTIFACT_TOOLS.includes(tc.tool))
      .map((tc) => ({
        key: tc.id,
        kind: tc.tool === 'generate_video_asset' ? 'video' : tc.tool === 'generate_audio_asset' ? 'audio' : 'image',
        name:
          basename(String(tc.params?.filename || '')) ||
          basename(String(tc.params?.path || '')) ||
          String(tc.params?.prompt || '').slice(0, 48) ||
          'Untitled asset',
        url:
          (typeof tc.result?.url === 'string' && tc.result.url) ||
          (tc.result?.path ? `/assets/images/${tc.params?.filename || ''}` : null),
      }));
    const fromStore: ArtifactEntry[] = assets.map((a) => ({
      key: `asset-${a.id}`,
      kind: a.type === 'video' ? 'video' : a.type === 'audio' ? 'audio' : 'image',
      name: a.name || basename(a.path) || 'Untitled asset',
      url: a.url || null,
    }));
    return [...fromTools, ...fromStore];
  }, [allToolCalls, assets]);

  const backgroundTasks = useMemo(() => allToolCalls.filter((tc) => tc.tool === 'run_command'), [allToolCalls]);
  const bgRunning = backgroundTasks.filter((tc) => !toolCompleted(tc) && !toolFailed(tc)).length;
  const bgFailed = backgroundTasks.filter(toolFailed).length;
  const bgCompleted = backgroundTasks.length - bgRunning - bgFailed;
  const latestCommand =
    backgroundTasks.length > 0 ? String(backgroundTasks[backgroundTasks.length - 1].params?.command || '') : '';

  const assistantRounds = agentMessages.filter((m) => m.role === 'assistant' && m.id !== 'msg-welcome').length;
  const pendingApprovals = useIDEStore((s) => s.pendingApprovals);
  const agentStatus = deriveAgentStatus({
    isGenerating: isAgentGenerating,
    hasPendingQuestion: Boolean(pendingAgentQuestion),
    hasPendingApprovals: pendingApprovals.length > 0,
  });
  const visibleArtifacts = showAllArtifacts ? artifacts : artifacts.slice(0, VISIBLE_ARTIFACTS);
  const statusTone: 'idle' | 'active' | 'attention' =
    agentStatus.key === 'waiting' ? 'attention' : agentStatus.key === 'working' ? 'active' : 'idle';

  // Recent run history from the durable audit log — refreshed when a run ends.
  interface RunRow {
    id: string;
    startedAt: number;
    finishedAt: number | null;
    status: string;
    promptPreview: string;
    filesMutated: number;
    verificationPassed: boolean | null;
  }
  const [recentRuns, setRecentRuns] = useState<RunRow[]>([]);
  useEffect(() => {
    if (isAgentGenerating) return; // Refresh on run completion, not mid-run
    fetch('/api/runs?limit=6')
      .then((r) => r.json())
      .then((d) => setRecentRuns(Array.isArray(d.runs) ? d.runs : []))
      .catch(() => undefined);
  }, [isAgentGenerating]);

  // Expandable per-run event timeline (fetched lazily from /api/runs/:id)
  interface RunEventRow {
    id: number;
    at: number;
    type: string;
    payload: unknown;
  }
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<Record<string, RunEventRow[]>>({});
  const toggleRunTimeline = (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (runEvents[runId]) return;
    fetch(`/api/runs/${encodeURIComponent(runId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setRunEvents((prev) => ({ ...prev, [runId]: Array.isArray(d?.events) ? d.events : [] })))
      .catch(() => setRunEvents((prev) => ({ ...prev, [runId]: [] })));
  };
  const summarizeEvent = (type: string, payload: unknown): string => {
    const p = payload as any;
    switch (type) {
      case 'RunStarted':
        return `${p?.permissionMode ?? ''}${p?.modelId ? ` · ${p.modelId}` : ''}`;
      case 'ToolsExecuted':
        return `round ${p?.round ?? '?'} · ${(p?.tools || []).map((t: any) => t.tool).join(', ') || 'no tools'}`;
      case 'VerificationCompleted':
        return `${p?.allPassed ? 'all checks passed' : 'checks failed'}${Array.isArray(p?.checks) ? ` (${p.checks.length})` : ''}`;
      case 'RunEnded':
        return String(p?.status ?? '');
      default:
        return '';
    }
  };

  // What Astra remembers across runs — visible, teachable, correctable.
  interface MemoryRow {
    id: number;
    kind: 'lesson' | 'preference' | 'fact';
    content: string;
    useCount: number;
  }
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [memoryDraft, setMemoryDraft] = useState('');
  const loadMemories = () =>
    fetch('/api/memory')
      .then((r) => r.json())
      .then((d) => setMemories(Array.isArray(d.memories) ? d.memories : []))
      .catch(() => undefined);
  useEffect(() => {
    if (isAgentGenerating) return;
    loadMemories();
  }, [isAgentGenerating]);
  const teachMemory = async () => {
    const content = memoryDraft.trim();
    if (!content) return;
    try {
      await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, kind: 'preference' }),
      });
      setMemoryDraft('');
      await loadMemories();
    } catch {
      // Optimistic silence — next refresh reflects reality
    }
  };
  const forgetMemory = async (id: number) => {
    try {
      await fetch(`/api/memory/${id}`, { method: 'DELETE' });
      setMemories((list) => list.filter((m) => m.id !== id));
    } catch {
      // Next refresh reflects reality
    }
  };

  if (collapsed) {
    return (
      <aside className="hidden lg:flex w-11 min-w-[44px] max-w-[44px] h-full flex-col items-center bg-obsidian-surface1 border-l border-obsidian-hairline shrink-0 select-none">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand activity panel"
          title="Expand activity panel"
          className="mt-2 p-2 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        >
          <PanelRightOpen className="w-4 h-4" aria-hidden="true" />
        </button>
        <span className="mt-3 text-[10px] font-mono uppercase tracking-widest text-obsidian-inkMuted [writing-mode:vertical-rl]">
          Activity
        </span>
      </aside>
    );
  }

  return (
    <aside className="hidden lg:flex w-[320px] min-w-[320px] max-w-[320px] h-full flex-col bg-obsidian-surface1 border-l border-obsidian-hairline shrink-0 select-none">
      {/* Panel header */}
      <header className="h-10 flex items-center justify-between px-3 border-b border-obsidian-hairline shrink-0">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
          <Activity className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Activity</span>
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse activity panel"
          title="Collapse activity panel"
          className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        >
          <PanelRightClose className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>

      {/* Internally scrolling body — fixed outer width, no horizontal shift */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4 min-h-0">
        {/* Live Status Summary */}
        <CollapsibleSection title="Status">
          <div className="rounded-lg border border-obsidian-hairline bg-obsidian-surface2 p-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <StatusDot tone={statusTone} />
              <span className="text-xs text-obsidian-inkPrimary">{agentStatus.label}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono uppercase tracking-wider text-[10px] text-obsidian-inkMuted">Model</span>
              <span className="truncate pl-2 text-obsidian-inkSecondary" title={activeModelName || undefined}>
                {activeModelName || 'Not selected'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono uppercase tracking-wider text-[10px] text-obsidian-inkMuted">Rounds</span>
              <span className="font-mono text-obsidian-inkSecondary">{assistantRounds}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono uppercase tracking-wider text-[10px] text-obsidian-inkMuted">Tool calls</span>
              <span className="font-mono text-obsidian-inkSecondary">{allToolCalls.length}</span>
            </div>
            {lastRunUsage && (
              <div
                className="flex items-center justify-between text-[11px]"
                title={`${lastRunUsage.contextUsed} of ${lastRunUsage.contextWindow} tokens used`}
              >
                <span className="font-mono uppercase tracking-wider text-[10px] text-obsidian-inkMuted">Context</span>
                <span className="font-mono text-obsidian-inkSecondary">
                  {fmtK(lastRunUsage.contextRemaining)} / {fmtK(lastRunUsage.contextWindow)} left
                </span>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Persistent memory — what Astra remembers, teachable and correctable */}
        <CollapsibleSection title="What Astra Remembers" count={memories.length}>
          {memories.length === 0 ? (
            <EmptyLine label="Nothing remembered yet — failures become lessons here" />
          ) : (
            memories.map((memory) => (
              <div
                key={memory.id}
                className="group flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors duration-150"
                title={`Used ${memory.useCount}x · ${memory.kind}`}
              >
                <span
                  className={`shrink-0 mt-0.5 px-1 py-px rounded text-[8px] font-mono uppercase tracking-wider border ${
                    memory.kind === 'lesson'
                      ? 'border-obsidian-hairline text-obsidian-inkSecondary'
                      : 'border-obsidian-hairline text-obsidian-inkMuted'
                  }`}
                >
                  {memory.kind === 'preference' ? 'pref' : memory.kind}
                </span>
                <span className="flex-1 min-w-0 text-[10px] leading-snug text-obsidian-inkSecondary">
                  {memory.content}
                </span>
                <button
                  type="button"
                  onClick={() => forgetMemory(memory.id)}
                  aria-label="Forget this memory"
                  title="Forget"
                  className="shrink-0 p-0.5 rounded text-obsidian-inkMuted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all cursor-pointer focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            ))
          )}
          <div className="flex items-center gap-1.5 pt-1">
            <input
              type="text"
              value={memoryDraft}
              onChange={(e) => setMemoryDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') teachMemory();
              }}
              placeholder="Teach a preference…"
              aria-label="Teach Astra a preference"
              className="flex-1 min-w-0 h-7 px-2 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline text-[10px] font-mono text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none focus:ring-1 focus:ring-white/30"
            />
            <button
              type="button"
              onClick={() => teachMemory()}
              disabled={!memoryDraft.trim()}
              aria-label="Remember this preference"
              title="Remember"
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg bg-obsidian-surface2 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </CollapsibleSection>

        {/* Recent run history from the durable audit log */}
        {recentRuns.length > 0 && (
          <CollapsibleSection title="Recent Runs" count={recentRuns.length}>
            {recentRuns.map((run) => (
              <div key={run.id} className="rounded-lg">
                <button
                  type="button"
                  onClick={() => toggleRunTimeline(run.id)}
                  aria-expanded={expandedRunId === run.id}
                  title={`${run.promptPreview || 'Empty prompt'} — ${run.status}. Click for the event timeline.`}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                >
                  <div className="flex items-center gap-2">
                    <StatusDot
                      tone={run.status === 'failed' ? 'failed' : run.status === 'running' ? 'active' : 'idle'}
                    />
                    <span className="flex-1 min-w-0 truncate text-[11px] text-obsidian-inkSecondary">
                      {run.promptPreview.split('\n')[0].slice(0, 60) || 'Empty prompt'}
                    </span>
                    <ChevronRight
                      className={`w-3 h-3 shrink-0 text-obsidian-inkMuted transition-transform duration-150 ${
                        expandedRunId === run.id ? 'rotate-90' : ''
                      }`}
                      aria-hidden="true"
                    />
                    {run.verificationPassed !== null && (
                      <CheckCircle2
                        className={`w-3 h-3 shrink-0 ${
                          run.verificationPassed ? 'text-emerald-400/80' : 'text-red-400'
                        }`}
                        aria-label={run.verificationPassed ? 'Verification passed' : 'Verification failed'}
                      />
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-obsidian-inkMuted pl-3.5">
                    {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    {run.status}
                    {run.finishedAt ? ` · ${fmtDuration(run.finishedAt - run.startedAt)}` : ' · running'}
                    {run.filesMutated > 0 ? ` · ${run.filesMutated} file${run.filesMutated > 1 ? 's' : ''}` : ''}
                  </div>
                </button>
                {expandedRunId === run.id && (
                  <div className="mt-1 ml-3.5 pl-3 border-l border-obsidian-hairline space-y-0.5 py-0.5">
                    {(runEvents[run.id] || []).map((ev) => (
                      <div key={ev.id} className="flex items-baseline gap-2 text-[9px] font-mono">
                        <span className="shrink-0 text-obsidian-inkMuted">
                          {new Date(ev.at).toLocaleTimeString([], { hour12: false })}
                        </span>
                        <span className="shrink-0 text-obsidian-inkSecondary">{ev.type}</span>
                        <span className="min-w-0 truncate text-obsidian-inkMuted" title={summarizeEvent(ev.type, ev.payload)}>
                          {summarizeEvent(ev.type, ev.payload)}
                        </span>
                      </div>
                    ))}
                    {!runEvents[run.id] && <div className="text-[9px] font-mono text-obsidian-inkMuted">Loading timeline…</div>}
                    {runEvents[run.id] && runEvents[run.id].length === 0 && (
                      <div className="text-[9px] font-mono text-obsidian-inkMuted">Timeline unavailable</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CollapsibleSection>
        )}

        {/* Provider retries + failovers for the current run */}
        <CollapsibleSection title="Network" count={retryLog.length}>
          {retryLog.length === 0 ? (
            <EmptyLine label="No retries this run" />
          ) : (
            retryLog
              .slice()
              .reverse()
              .map((entry, index) => (
                <div
                  key={`${entry.at}-${index}`}
                  className="px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors duration-150"
                  title={entry.reason}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-[10px] font-mono text-obsidian-inkSecondary">
                      {entry.provider} · {entry.model}
                    </span>
                    <span
                      className="shrink-0 text-[9px] font-mono text-obsidian-inkMuted"
                      title={`At ${new Date(entry.at).toLocaleTimeString()}`}
                    >
                      {new Date(entry.at).toLocaleTimeString([], { hour12: false })}
                    </span>
                    <span className="shrink-0 text-[9px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
                      {entry.status}
                      {entry.latencyMs > 0 ? ` · ${(entry.latencyMs / 1000).toFixed(1)}s` : ''}
                    </span>
                  </div>
                  <div className="text-[9px] font-mono text-obsidian-inkMuted">
                    attempt {entry.attempt}/{entry.totalAttempts}
                    {entry.reason ? ` — ${entry.reason.slice(0, 90)}` : ''}
                  </div>
                </div>
              ))
          )}
        </CollapsibleSection>

        {/* Files Changed */}
        <CollapsibleSection title="Files Changed" count={fileChanges.length}>
          {fileChanges.length === 0 ? (
            <EmptyLine label="No files changed yet" />
          ) : (
            fileChanges.map((fc) => {
              const isHtml = /\.html?$/i.test(fc.path);
              const runUrl = `/workspace/${String(fc.path).replace(/\\/g, '/').replace(/^\//, '')}`;
              return (
              <div
                key={fc.path}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors duration-150"
                title={`${fc.tool} - ${fc.path}`}
              >
                <FileCode className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate text-[11px] font-mono text-obsidian-inkSecondary">
                  {basename(fc.path)}
                </span>
                {isHtml && !fc.failed && (
                  <button
                    type="button"
                    onClick={() => window.open(runUrl, '_blank', 'noopener')}
                    title="Run in browser"
                    aria-label={`Run ${basename(fc.path)}`}
                    className="shrink-0 p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.08] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                  >
                    <Play className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
                <span className="shrink-0 text-[9px] font-mono uppercase tracking-wider">
                  {fc.failed ? (
                    <span className="text-red-400">Failed</span>
                  ) : fc.running ? (
                    <span className="text-obsidian-inkMuted">Running</span>
                  ) : fc.tool === 'delete_file' ? (
                    <span className="text-obsidian-inkMuted">Deleted</span>
                  ) : (
                    <span className="text-obsidian-inkMuted">Written</span>
                  )}
                </span>
              </div>
              );
            })
          )}
        </CollapsibleSection>

        {/* Work artifacts (plans, implementations, verification) */}
        {workArtifacts.length > 0 && (
          <CollapsibleSection title="Work Items" count={workArtifacts.length}>
            {workArtifacts.slice(0, VISIBLE_ARTIFACTS).map((artifact) => {
              const Icon = ARTIFACT_TYPE_ICONS[artifact.type] || BookOpen;
              return (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => setViewingArtifact(artifact)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors duration-150 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                  title={`${artifact.name} — click to view`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
                  <span className="flex-1 min-w-0 truncate text-[11px] text-obsidian-inkSecondary">{artifact.name}</span>
                  <span
                    className={`shrink-0 text-[9px] font-mono uppercase tracking-wider ${
                      artifact.status === 'done' ? 'text-obsidian-inkSecondary' : 'text-obsidian-inkMuted'
                    }`}
                  >
                    {artifact.status === 'in_progress' ? 'working' : artifact.status}
                  </span>
                </button>
              );
            })}
            {workArtifacts.length > VISIBLE_ARTIFACTS && (
              <div className="px-2 py-1 text-[10px] font-mono text-obsidian-inkMuted">
                +{workArtifacts.length - VISIBLE_ARTIFACTS} more
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* Artifacts (generated media) */}
        <CollapsibleSection title="Artifacts" count={artifacts.length}>
          {artifacts.length === 0 ? (
            <EmptyLine label="No artifacts yet" />
          ) : (
            <>
              {visibleArtifacts.map((artifact) => {
                const icon =
                  artifact.kind === 'video' ? (
                    <Film className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
                  ) : artifact.kind === 'audio' ? (
                    <Volume2 className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
                  );
                if (artifact.url) {
                  return (
                    <button
                      key={artifact.key}
                      type="button"
                      onClick={() => setViewingMedia(artifact)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors duration-150 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                      title={`${artifact.name} — click to preview`}
                    >
                      {icon}
                      <span className="flex-1 min-w-0 truncate text-[11px] text-obsidian-inkSecondary">{artifact.name}</span>
                    </button>
                  );
                }
                return (
                  <div
                    key={artifact.key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors duration-150"
                    title={artifact.name}
                  >
                    {icon}
                    <span className="flex-1 min-w-0 truncate text-[11px] text-obsidian-inkSecondary">{artifact.name}</span>
                  </div>
                );
              })}
              {artifacts.length > VISIBLE_ARTIFACTS && (
                <button
                  type="button"
                  onClick={() => setShowAllArtifacts((show) => !show)}
                  className="w-full px-2 py-1 text-left text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
                  aria-expanded={showAllArtifacts}
                >
                  {showAllArtifacts ? 'Show less' : `See all (${artifacts.length})`}
                </button>
              )}
            </>
          )}
        </CollapsibleSection>

        {/* Background Tasks */}
        <CollapsibleSection title="Background Tasks" count={backgroundTasks.length + managedProcesses.length}>
          {managedProcesses.length > 0 && (
            <div className="space-y-1 mb-1">
              {managedProcesses.map((proc) => (
                <div
                  key={proc.id}
                  className="px-2 py-1.5 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline"
                  title={`${proc.command}${proc.lastError ? ` — ${proc.lastError}` : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <StatusDot
                      tone={proc.status === 'running' ? 'active' : proc.status === 'failed' ? 'failed' : 'attention'}
                    />
                    <span className="flex-1 min-w-0 truncate text-[10px] font-mono text-obsidian-inkSecondary">
                      {proc.command.split(/\s+/).slice(0, 3).join(' ')}
                    </span>
                    {proc.port && <span className="text-[9px] font-mono text-obsidian-inkMuted">:{proc.port}</span>}
                    {proc.status !== 'stopped' && proc.status !== 'exited' && (
                      <button
                        type="button"
                        onClick={() => stopProcess(proc.id)}
                        title="Stop process"
                        aria-label="Stop process"
                        className="p-0.5 rounded text-obsidian-inkMuted hover:text-red-400 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/40"
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-obsidian-inkMuted">
                    {proc.status}
                    {proc.status === 'starting' && proc.attempts > 1 ? ` (retry ${proc.attempts})` : ''}
                    {proc.status === 'failed' && proc.lastError ? ` — ${proc.lastError.slice(0, 60)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          {backgroundTasks.length === 0 && managedProcesses.length === 0 ? (
            <EmptyLine label="No background tasks yet" />
          ) : (
            <>
              <div className="flex items-center gap-3 px-2 py-1 text-[10px] font-mono text-obsidian-inkMuted">
                <span>{bgRunning} running</span>
                <span>{bgCompleted} completed</span>
                {bgFailed > 0 && <span className="text-red-400">{bgFailed} failed</span>}
              </div>
              {latestCommand && (
                <div
                  className="mx-1 px-2 py-1.5 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline truncate text-[10px] font-mono text-obsidian-inkSecondary"
                  title={latestCommand}
                >
                  <Terminal className="inline w-3 h-3 mr-1.5 align-[-2px]" aria-hidden="true" />
                  {latestCommand}
                </div>
              )}
            </>
          )}
        </CollapsibleSection>

        {/* Subagents */}
        <CollapsibleSection title="Subagents" count={subagents.length}>
          {subagents.length === 0 ? (
            <EmptyLine label="No subagents running" />
          ) : (
            subagents.map((sa) => {
              const elapsedSeconds = sa.startedAt
                ? Math.max(0, Math.floor((Date.now() - sa.startedAt) / 1000))
                : null;
              return (
                <div
                  key={sa.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors duration-150"
                  title={`${sa.currentTask || sa.name}${sa.currentTool ? ` — running ${sa.currentTool}` : ''}`}
                >
                  <Users className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
                  <span className="flex-1 min-w-0 truncate text-[11px] text-obsidian-inkSecondary">{sa.name}</span>
                  {elapsedSeconds !== null && (
                    <span className="shrink-0 text-[9px] font-mono text-obsidian-inkMuted" title="Elapsed time">
                      {fmtElapsed(elapsedSeconds)}
                    </span>
                  )}
                  <StatusDot tone={sa.status === 'failed' ? 'failed' : sa.status === 'completed' ? 'idle' : 'active'} />
                </div>
              );
            })
          )}
        </CollapsibleSection>
      </div>

      {viewingArtifact && (
        <ArtifactViewer artifact={viewingArtifact} onClose={() => setViewingArtifact(null)} />
      )}
      {viewingMedia && viewingMedia.url && (
        <MediaViewer artifact={viewingMedia} onClose={() => setViewingMedia(null)} />
      )}
    </aside>
  );
};
