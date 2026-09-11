import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Ban,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Film,
  FileCode,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Palette,
  Play,
  PanelRightClose,
  PanelRightOpen,
  ShieldAlert,
  Sparkles,
  Square,
  Terminal,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { ToolCallPayload } from '../../types/ide.js';
import { MarkdownRenderer } from '../Agent/MarkdownRenderer.js';
import { deriveAgentStatus } from '../../utils/agentStatus.js';
import { useResizablePanel } from '../../hooks/useResizablePanel.js';
import { PanelResizeHandle } from '../Layout/PanelResizeHandle.js';
import {
  isTerminalRunStatus,
  mirrorServerRunRows,
  normalizeServerRunStatus,
  useActiveRunState,
  useRunRegistry,
  type RunStatus,
} from '../../stores/runRegistry.js';

const FILE_TOOLS = ['write_file', 'edit_file', 'delete_file'];
const ARTIFACT_TOOLS = ['generate_image_asset', 'generate_svg_asset', 'generate_video_asset', 'generate_audio_asset'];

const basename = (path: string): string => path.split(/[/\\]/).pop() || path;

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  /** Expanded by default; pass false for secondary sections (content stays reachable). */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Small-caps collapsible section used for every panel group. */
const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, count, defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <section aria-label={title}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-1 py-0.5 text-left cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border rounded"
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

/** Clean micro-status indicator — semantic micro-icons without random noisy dots. */
const StatusDot: React.FC<{ tone: 'idle' | 'active' | 'attention' | 'failed' }> = ({ tone }) => {
  if (tone === 'failed') {
    return <ShieldAlert className="w-3 h-3 text-obsidian-danger shrink-0" aria-hidden="true" />;
  }
  if (tone === 'active' || tone === 'attention') {
    return <Loader2 className="w-3 h-3 animate-spin text-obsidian-inkSecondary shrink-0" aria-hidden="true" />;
  }
  return <CheckCircle2 className="w-3 h-3 text-obsidian-inkMuted opacity-60 shrink-0" aria-hidden="true" />;
};

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
  type: 'plan' | 'implementation' | 'design' | 'asset' | 'verification' | 'doc' | 'findings' | 'audit';
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
  findings: ShieldAlert,
  audit: ShieldAlert,
};

/** Shared header for the in-sidebar detail view (back arrow + title + meta). */
const DetailHeader: React.FC<{ title: string; meta?: string; onBack: () => void }> = ({ title, meta, onBack }) => (
  <header className="h-10 flex items-center gap-2 px-2 border-b border-obsidian-hairline shrink-0">
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to activity list"
      title="Back"
      className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border shrink-0"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
    </button>
    <div className="min-w-0 flex-1">
      <div className="text-xs font-medium text-obsidian-inkPrimary truncate leading-tight">{title}</div>
      {meta && (
        <div className="text-[9px] font-mono uppercase tracking-wider text-obsidian-inkMuted truncate">{meta}</div>
      )}
    </div>
  </header>
);

/** In-sidebar readers — clicking an artifact swaps the panel body instead of a modal. */
const ArtifactDetailView: React.FC<{ artifact: ServerArtifact; onBack: () => void }> = ({ artifact, onBack }) => (
  <div className="flex-1 flex flex-col min-h-0" role="region" aria-label={`Artifact: ${artifact.name}`}>
    <DetailHeader title={artifact.name} meta={`${artifact.type} · ${artifact.status}`} onBack={onBack} />
    <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
      <MarkdownRenderer content={artifact.content} />
    </div>
  </div>
);

const MediaDetailView: React.FC<{ artifact: ArtifactEntry; onBack: () => void }> = ({ artifact, onBack }) => (
  <div className="flex-1 flex flex-col min-h-0" role="region" aria-label={`Preview: ${artifact.name}`}>
    <DetailHeader title={artifact.name} onBack={onBack} />
    <div className="flex-1 min-h-0 p-3 bg-obsidian-canvas flex items-center justify-center overflow-hidden">
      {artifact.kind === 'video' ? (
        <video src={artifact.url!} controls autoPlay loop muted playsInline className="max-h-full w-full bg-black object-contain rounded-lg" />
      ) : artifact.kind === 'audio' ? (
        <audio src={artifact.url!} controls className="w-full" />
      ) : (
        <img src={artifact.url!} alt={artifact.name} className="max-w-full max-h-full object-contain rounded-lg" />
      )}
    </div>
  </div>
);

export const ActivityPanel: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  const { width, isResizing, handleProps } = useResizablePanel({
    storageKey: 'sutra-activity-panel-width',
    defaultWidth: 320,
    minWidth: 260,
    maxWidthRatio: 0.5,
  });
  const agentMessages = useIDEStore((s) => s.agentMessages);
  const isAgentGenerating = useIDEStore((s) => s.isAgentGenerating);
  const activeModelName = useIDEStore((s) => s.activeModel?.name);
  const pendingAgentQuestion = useIDEStore((s) => s.pendingAgentQuestion);
  const subagents = useIDEStore((s) => s.subagents);
  const assets = useIDEStore((s) => s.assets);
  const lastRunUsage = useIDEStore((s) => s.lastRunUsage);
  const harnessMode = useIDEStore((s) => s.harnessMode);

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
    if (!viewingArtifact && !viewingMedia) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewingArtifact(null);
        setViewingMedia(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewingArtifact, viewingMedia]);
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
    if (collapsed) return;
    const load = () =>
      fetch('/api/processes')
        .then((r) => r.json())
        .then((d) => setManagedProcesses(Array.isArray(d.processes) ? d.processes : []))
        .catch(() => undefined);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [collapsed]);

  const stopProcess = async (id: string) => {
    try {
      await fetch(`/api/processes/${id}/stop`, { method: 'POST' });
      setManagedProcesses((list) => list.map((p) => (p.id === id ? { ...p, status: 'stopped' } : p)));
    } catch {
      // Poll will reflect reality
    }
  };

  // Bulk stop for every live process — mirrors the chat's stop-all control.
  const stopAllProcesses = async () => {
    const activeIds = managedProcesses
      .filter((p) => p.status !== 'stopped' && p.status !== 'exited')
      .map((p) => p.id);
    if (activeIds.length === 0) return;
    try {
      await fetch('/api/tasks/kill-all', { method: 'POST' });
    } catch {
      // Endpoint unavailable — fall back to stopping the known rows one by one.
      await Promise.allSettled(
        activeIds.map((id) => fetch(`/api/processes/${encodeURIComponent(id)}/stop`, { method: 'POST' }))
      );
    } finally {
      setManagedProcesses((list) =>
        list.map((p) => (p.status !== 'stopped' && p.status !== 'exited' ? { ...p, status: 'stopped' as const } : p))
      );
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
      const norm = path.replace(/\\/g, '/');
      if (norm.startsWith('.sutra') || norm.includes('/.sutra/') || norm === 'task_plan.md' || norm.endsWith('/task_plan.md')) continue;
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

  // Extract the latest Task Execution Plan from transcript tool calls in real time
  const latestTaskPlan = useMemo(() => {
    const planCalls = allToolCalls.filter((tc) => tc.tool === 'write_todos' || tc.tool === 'todo_write');
    if (planCalls.length === 0) return null;
    const last = planCalls[planCalls.length - 1];
    const rawTodos = (
      Array.isArray(last.params?.todos) ? last.params.todos :
      Array.isArray(last.result?.todos) ? last.result.todos : []
    );
    const baseTodos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> = rawTodos
      .filter((t: any) => t && typeof t.content === 'string')
      .map((t: any) => ({
        content: String(t.content),
        status: (['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending') as 'pending' | 'in_progress' | 'completed',
      }));
    if (baseTodos.length === 0) return null;

    const completedFileSet = new Set(
      fileChanges.filter((f) => !f.failed).map((f) => f.path.toLowerCase().replace(/\\/g, '/'))
    );
    const completedCommandSet = backgroundTasks
      .filter((tc) => toolCompleted(tc))
      .map((tc) => String(tc.params?.command || '').toLowerCase());

    const todos = baseTodos.map((t) => {
      if (t.status === 'completed') return t;
      const lower = t.content.toLowerCase().replace(/\\/g, '/');
      for (const f of completedFileSet) {
        const bname = f.split('/').pop();
        if (lower.includes(f) || (bname && bname.length > 3 && lower.includes(bname))) {
          return { ...t, status: 'completed' as const };
        }
      }
      if (lower.includes('test') || lower.includes('verify') || lower.includes('run')) {
        const hasMatchingRun = completedCommandSet.some(
          (cmd) => cmd.includes('test') || cmd.includes('jest') || cmd.includes('vitest') || cmd.includes('build') || cmd.includes('check')
        );
        if (hasMatchingRun) {
          return { ...t, status: 'completed' as const };
        }
      }
      return t;
    });

    const doneCount = todos.filter((t: { status: string }) => t.status === 'completed').length;
    const inProgressCount = todos.filter((t: { status: string }) => t.status === 'in_progress').length;
    const totalCount = todos.length;
    const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    return { todos, doneCount, inProgressCount, totalCount, progressPct };
  }, [allToolCalls, fileChanges, backgroundTasks]);

  const pendingApprovals = useIDEStore((s) => s.pendingApprovals);
  // Run lifecycle derives from the shared registry first — every surface reads
  // the same verdict, so the header can never disagree with Recent Runs.
  const activeRun = useActiveRunState();
  const runsMap = useRunRegistry((s) => s.runs);
  const activeRunStatus = activeRun?.status;
  const agentStatus =
    activeRunStatus === 'running' || activeRunStatus === 'queued'
      ? deriveAgentStatus({ isGenerating: true })
      : activeRunStatus === 'waiting_for_input'
        ? deriveAgentStatus({ hasPendingQuestion: true })
        : deriveAgentStatus({
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

  // Run-end edge marker: lets the next idle refetch link the just-finished run
  // to its newest audit row even when the server write races the socket close.
  const prevGeneratingRef = useRef(isAgentGenerating);
  const justEndedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevGeneratingRef.current && !isAgentGenerating) justEndedAtRef.current = Date.now();
    prevGeneratingRef.current = isAgentGenerating;
  }, [isAgentGenerating]);

  // Reconcile every displayed row through the registry (single source of truth):
  // 1) server terminal outcomes fill absent/non-terminal entries;
  // 2) the run that JUST ended inherits the live session's verdict (cancel feedback);
  // 3) zombie liveness claims (crash/reload leftovers, historical 'running')
  //    coerce to completed so nothing stays visually active forever.
  useEffect(() => {
    if (isAgentGenerating || recentRuns.length === 0) return;
    const registry = useRunRegistry.getState();

    // 1) Mirror server truth; stale server rows claiming 'running' while idle
    //    coerce to completed inside the mirror helper.
    mirrorServerRunRows(recentRuns, isAgentGenerating, justEndedAtRef.current);

    // 2) The run that JUST ended inherits the live session's verdict so cancel
    //    feedback lands even when the server write races the socket close.
    if (justEndedAtRef.current) {
      justEndedAtRef.current = null;
      const liveKey = registry.activeSessionId;
      const live = liveKey ? registry.getRun(liveKey) : undefined;
      if (live && isTerminalRunStatus(live.status)) {
        const newest = recentRuns[0];
        // Only rows started at/after the live run qualify as its audit record
        if (newest.startedAt >= live.startedAt - 1000) {
          const target = registry.getRun(newest.id);
          if (!target || !isTerminalRunStatus(target.status)) {
            registry.markRun(newest.id, live.status, {
              startedAt: newest.startedAt,
              endedAt: newest.finishedAt ?? Date.now(),
            });
          }
        }
      }
    }

    // 3) Retire any remaining zombie liveness claims (crash/reload leftovers).
    useRunRegistry.getState().reconcile([]);
  }, [recentRuns, isAgentGenerating]);

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

  // Memory stays server-side only — what Astra learns is never surfaced in the
  // panel (user directive), so there is no memory section here by design.

  if (collapsed) {
    return (
      <aside className="hidden lg:flex w-11 min-w-[44px] max-w-[44px] h-full flex-col items-center bg-obsidian-surface1 border-l border-obsidian-hairline shrink-0 select-none">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand activity panel"
          title="Expand activity panel"
          className="mt-2 p-2 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
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
    <aside
      style={{ width: `${width}px` }}
      className="hidden lg:flex h-full flex-col bg-obsidian-surface1 border-l border-obsidian-hairline shrink-0 select-none relative"
    >
      <PanelResizeHandle handleProps={handleProps} isResizing={isResizing} label="Resize activity panel" />
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
          className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
        >
          <PanelRightClose className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>

      {viewingArtifact ? (
        <ArtifactDetailView artifact={viewingArtifact} onBack={() => setViewingArtifact(null)} />
      ) : viewingMedia && viewingMedia.url ? (
        <MediaDetailView artifact={viewingMedia} onBack={() => setViewingMedia(null)} />
      ) : (
      <>
      {/* Internally scrolling body — fixed outer width, no horizontal shift */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4 min-h-0">
        {/* Live Status Summary — deliberately slim: status line, model, context bar */}
        <CollapsibleSection title="Status">
          <div className="rounded-lg border border-obsidian-hairline bg-obsidian-surface2 p-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <StatusDot tone={statusTone} />
              <span className="text-xs text-obsidian-inkPrimary">{agentStatus.label}</span>
              {/* Cancellation feedback: muted chip for the session whose run was
                  stopped; stays until the next run starts (registry verdict). */}
              {activeRun?.status === 'cancelled' && (
                <span
                  role="status"
                  aria-label="Last run cancelled"
                  title="Last run was cancelled before completion — send a new prompt to start again"
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-obsidian-border bg-obsidian-surface1 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkSecondary"
                >
                  <Ban className="w-3 h-3 text-obsidian-inkMuted" aria-hidden="true" />
                  Cancelled
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono uppercase tracking-wider text-[10px] text-obsidian-inkMuted">Model</span>
              <span className="truncate pl-2 text-obsidian-inkSecondary" title={activeModelName || undefined}>
                {activeModelName || 'Not selected'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono uppercase tracking-wider text-[10px] text-obsidian-inkMuted">Harness</span>
              <span className="truncate pl-2 text-obsidian-inkSecondary flex items-center gap-1">
                {harnessMode === 'avo' ? (
                  <>
                    <Sparkles className="w-3 h-3 text-obsidian-inkPrimary inline" />
                    <span>AVO Pro</span>
                  </>
                ) : (
                  <span>Standard</span>
                )}
              </span>
            </div>
            {lastRunUsage && lastRunUsage.contextWindow > 0 && (() => {
              const usedPct = Math.min(100, Math.max(0, (lastRunUsage.contextUsed / lastRunUsage.contextWindow) * 100));
              return (
                <div
                  title={`${lastRunUsage.contextUsed} of ${lastRunUsage.contextWindow} tokens used`}
                  className="space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono uppercase tracking-wider text-[10px] text-obsidian-inkMuted">Context</span>
                    <span className="font-mono text-obsidian-inkSecondary">{Math.round(usedPct)}% used</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Context window usage"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(usedPct)}
                    className="h-1 rounded-full bg-obsidian-surface2 overflow-hidden"
                  >
                    <div
                      className="h-full rounded-full bg-obsidian-inkSecondary transition-[width] duration-300"
                      style={{ width: `${usedPct}%` }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        </CollapsibleSection>

        {/* Task Plan (Live Dynamic Checklist) */}
        {latestTaskPlan && (
          <CollapsibleSection
            title="Task Plan"
            count={latestTaskPlan.totalCount}
            defaultOpen={true}
          >
            <div className="rounded-lg border border-obsidian-hairline bg-obsidian-surface2 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
                  {latestTaskPlan.doneCount}/{latestTaskPlan.totalCount} Completed
                </span>
                <span className="text-[10px] font-mono text-obsidian-inkPrimary font-semibold">
                  {latestTaskPlan.progressPct}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Task plan completion progress"
                aria-valuenow={latestTaskPlan.progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 rounded-full bg-obsidian-surface2 overflow-hidden"
              >
                <div
                  className="h-full rounded-full bg-obsidian-inkPrimary transition-[width] duration-300"
                  style={{ width: `${latestTaskPlan.progressPct}%` }}
                />
              </div>
              <div className="space-y-1 pt-1">
                {latestTaskPlan.todos.map((todo: { content: string; status: string }, idx: number) => {
                  const isDone = todo.status === 'completed';
                  const isInProgress = todo.status === 'in_progress';
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded text-[11px] transition-colors ${
                        isInProgress
                          ? 'bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkPrimary font-medium shadow-sm'
                          : isDone
                          ? 'bg-obsidian-surface2 text-obsidian-inkMuted'
                          : 'bg-obsidian-surface1 text-obsidian-inkSecondary'
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {isDone ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-obsidian-inkPrimary" aria-hidden="true" />
                        ) : isInProgress ? (
                          <Clock className="w-3.5 h-3.5 text-obsidian-inkPrimary animate-spin" aria-hidden="true" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-obsidian-inkMuted" aria-hidden="true" />
                        )}
                      </div>
                      <span className={`flex-1 break-words leading-relaxed ${isDone ? 'line-through opacity-70' : ''}`}>
                        {todo.content}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CollapsibleSection>
        )}

        {/* Persistent memory is intentionally not surfaced — it stays server-side only */}

        {/* Recent run history from the durable audit log */}
        {recentRuns.length > 0 && (
          <CollapsibleSection title="Recent Runs" count={recentRuns.length} defaultOpen={false}>
            {recentRuns.map((run) => {
              // Displayed status derives from the registry — an audit row stuck at
              // 'running' reads as completed unless this run is genuinely live.
              const effStatus: RunStatus = (() => {
                const entry = runsMap.get(run.id);
                if (entry) return entry.status;
                const raw = normalizeServerRunStatus(run.status);
                if (raw === 'running') return isAgentGenerating ? 'running' : 'completed';
                return raw ?? 'completed';
              })();
              const rowTone: 'idle' | 'active' | 'failed' =
                effStatus === 'failed'
                  ? 'failed'
                  : effStatus === 'running' || effStatus === 'queued' || effStatus === 'waiting_for_input'
                    ? 'active'
                    : 'idle';
              const endedMs =
                run.finishedAt ?? (isTerminalRunStatus(effStatus) ? runsMap.get(run.id)?.endedAt ?? null : null);
              return (
              <div key={run.id} className="rounded-lg">
                <button
                  type="button"
                  onClick={() => toggleRunTimeline(run.id)}
                  aria-expanded={expandedRunId === run.id}
                  title={`${run.promptPreview || 'Empty prompt'} — ${effStatus}. Click for the event timeline.`}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-obsidian-surface1 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
                >
                  <div className="flex items-center gap-2">
                    <StatusDot tone={rowTone} />
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
                          run.verificationPassed ? 'text-obsidian-inkSecondary' : 'text-red-400'
                        }`}
                        aria-label={run.verificationPassed ? 'Verification passed' : 'Verification failed'}
                      />
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-obsidian-inkMuted pl-3.5">
                    {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    {effStatus}
                    {endedMs !== null ? ` · ${fmtDuration(endedMs - run.startedAt)}` : ` · ${effStatus}`}
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
              );
            })}
          </CollapsibleSection>
        )}

        {/* Retry/failover noise is intentionally not shown here — the per-run
            event timeline (/api/runs/:id) remains the place to inspect it */}

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
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-obsidian-surface1 transition-colors duration-150"
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
                    className="shrink-0 p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
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
        <CollapsibleSection title="Work Items" count={workArtifacts.length} defaultOpen={false}>
          {workArtifacts.length === 0 ? (
            <EmptyLine label="Plans, builds & reports land here" />
          ) : (
            <>
            {workArtifacts.slice(0, VISIBLE_ARTIFACTS).map((artifact) => {
              const Icon = ARTIFACT_TYPE_ICONS[artifact.type] || BookOpen;
              return (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => setViewingArtifact(artifact)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-obsidian-surface1 transition-colors duration-150 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
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
            </>
          )}
        </CollapsibleSection>

        {/* Artifacts (generated media) */}
        <CollapsibleSection title="Artifacts" count={artifacts.length} defaultOpen={false}>
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
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-obsidian-surface1 transition-colors duration-150 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
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
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-obsidian-surface1 transition-colors duration-150"
                  title={`${artifact.name} — click to preview`}
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
                className="w-full px-2 py-1 text-left text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border rounded"
                aria-expanded={showAllArtifacts}
              >
                {showAllArtifacts ? 'Show less' : `See all (${artifacts.length})`}
              </button>
            )}
            </>
          )}
        </CollapsibleSection>

        {/* Background Tasks */}
        <CollapsibleSection
          title="Background Tasks"
          count={backgroundTasks.length + managedProcesses.length}
          defaultOpen={false}
        >
          {managedProcesses.some((p) => p.status !== 'stopped' && p.status !== 'exited') && (
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-obsidian-inkMuted">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                <span>live now</span>
              </span>
              <button
                type="button"
                onClick={stopAllProcesses}
                aria-label="Stop all background tasks"
                title="Stop all background tasks"
                className="w-8 h-8 rounded-md flex items-center justify-center text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-borderBright"
              >
                <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              </button>
            </div>
          )}
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
                    <span className="shrink-0 text-[9px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
                      {proc.status}
                    </span>
                    {proc.status !== 'stopped' && proc.status !== 'exited' && (
                      <button
                        type="button"
                        onClick={() => stopProcess(proc.id)}
                        title="Stop task"
                        aria-label="Stop task"
                        className="w-6 h-6 rounded-md flex items-center justify-center text-obsidian-inkSecondary hover:text-red-400 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/40"
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
        <CollapsibleSection title="Subagents" count={subagents.length} defaultOpen={false}>
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
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-obsidian-surface1 transition-colors duration-150"
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
      </>
      )}
    </aside>
  );
};
