import { create } from 'zustand';
import { useIDEStore } from './ideStore.js';

/**
 * SUTRA Studio — Authoritative Run Lifecycle Registry
 *
 * One store every surface derives run state from. The audit root cause this
 * replaces: each surface kept its own notion of "is this run done?" — the main
 * area flipped to Ready the instant generation stopped while "Recent Runs"
 * kept rendering whatever the durable log last said (often 'running' forever
 * after a reload or crash), and cancellation looked exactly like completion.
 *
 * Lifecycle model:  queued → running → waiting_for_input → completed | failed | cancelled
 * - Terminal states are completed / failed / cancelled; they always win over
 *   anything older and reconcile never touches them.
 * - Non-terminal claims ('queued' | 'running' | 'waiting_for_input') are
 *   LIVENESS CLAIMS. `reconcile` coerces any claim that is not backed by a
 *   genuinely live session into 'completed', which is what retires historical
 *   rows stuck at 'running'.
 * - Persisted write-through to localStorage under 'sutra-run-states'
 *   (newest-first JSON, capped at ~200 entries). On cold load, persisted
 *   non-terminal entries older than 24h are coerced to 'completed'.
 */

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RunState {
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface MarkRunExtra {
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

const TERMINAL_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export const isTerminalRunStatus = (status: RunStatus): boolean => TERMINAL_STATUSES.includes(status);

/** Coerces a raw server status string; unknown values return null. */
export const normalizeServerRunStatus = (raw: unknown): RunStatus | null =>
  raw === 'running' || raw === 'failed' || raw === 'cancelled' || raw === 'completed' ? raw : null;

interface RunRegistryState {
  /** sessionId (chat session id or run-log id) → lifecycle state. */
  runs: Map<string, RunState>;
  /** Chat session id surfaces pin as "the" live conversation (Manager active session). */
  activeSessionId: string | null;
  markRun: (sessionId: string, status: RunStatus, extra?: MarkRunExtra) => void;
  getRun: (sessionId: string) => RunState | undefined;
  /**
   * Coercion pass: every registry entry whose status is a non-terminal liveness
   * claim AND whose id is NOT in `liveSessionIds` becomes 'completed'. Persisted
   * terminal states are never rewritten.
   */
  reconcile: (liveSessionIds: string[]) => void;
  setActiveSessionId: (sessionId: string | null) => void;
}

const STORAGE_KEY = 'sutra-run-states';
const MAX_PERSISTED_RUNS = 200;
const STALE_RUN_MS = 24 * 60 * 60 * 1000;

interface PersistedRun extends RunState {
  id: string;
}

const persistRuns = (runs: Map<string, RunState>): void => {
  try {
    // Newest-first in the file (Map insertion order is oldest → newest).
    // Liveness claims persist too — the 24h cold-load rule below retires the
    // ones that outlive a crashed or abandoned session.
    const payload: PersistedRun[] = [];
    for (const [id, run] of runs) {
      payload.push({ id, ...run });
    }
    const newestFirst = payload.reverse().slice(0, MAX_PERSISTED_RUNS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newestFirst));
  } catch {
    // Storage unavailable — the in-memory map stays authoritative for the session
  }
};

const loadPersistedRuns = (): Map<string, RunState> => {
  const runs = new Map<string, RunState>();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return runs;
  }
  if (!raw) return runs;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return runs;
  }
  if (!Array.isArray(parsed)) return runs;
  const now = Date.now();
  const cutoff = now - STALE_RUN_MS;
  // File is newest-first; iterate oldest → newest so Map insertion order matches
  // the bump-to-newest convention markRun uses.
  for (let i = parsed.length - 1; i >= 0; i--) {
    const entry = parsed[i] as Partial<PersistedRun> | null;
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.id !== 'string' || !entry.id) continue;
    if (typeof entry.startedAt !== 'number' || !Number.isFinite(entry.startedAt)) continue;
    const status = normalizeServerRunStatus(entry.status);
    if (!status) continue;
    // Cold-load staleness rule: a persisted liveness claim older than 24h is a
    // crashed/reloaded run — retire it instead of showing it as active forever.
    const retired =
      !isTerminalRunStatus(status) && entry.startedAt < cutoff
        ? ({ status: 'completed', startedAt: entry.startedAt, endedAt: now } as RunState)
        : null;
    const run: RunState =
      retired ??
      ({
        status,
        startedAt: entry.startedAt,
        ...(typeof entry.endedAt === 'number' && Number.isFinite(entry.endedAt) ? { endedAt: entry.endedAt } : {}),
        ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
      } as RunState);
    runs.set(entry.id, run);
  }
  return runs;
};

export const useRunRegistry = create<RunRegistryState>((set, get) => ({
  runs: loadPersistedRuns(),
  activeSessionId: null,

  markRun: (sessionId, status, extra) => {
    if (!sessionId) return;
    const current = get();
    const prev = current.runs.get(sessionId);
    const now = Date.now();
    const terminal = isTerminalRunStatus(status);
    const next: RunState = {
      status,
      // A fresh liveness claim with an explicit start (new run) resets the clock;
      // otherwise the original start time survives so durations stay truthful.
      startedAt: extra?.startedAt ?? prev?.startedAt ?? now,
      // Only terminal verdicts carry an end — a new run must not inherit the
      // previous run's endedAt.
      ...(terminal ? { endedAt: extra?.endedAt ?? now } : {}),
      ...(extra?.error !== undefined ? { error: extra.error } : prev?.error !== undefined && terminal ? { error: prev.error } : {}),
    };
    // Rebuild the Map so subscribers see a new reference; untouched entries keep
    // their object identity so per-row selectors stay quiet.
    const runs = new Map(current.runs);
    runs.delete(sessionId);
    runs.set(sessionId, next);
    set({ runs });
    persistRuns(runs);
  },

  getRun: (sessionId) => get().runs.get(sessionId),

  reconcile: (liveSessionIds) => {
    const current = get();
    const live = new Set(liveSessionIds);
    const now = Date.now();
    let changed = false;
    const runs = new Map(current.runs);
    for (const [id, run] of runs) {
      if (isTerminalRunStatus(run.status)) continue; // Persisted terminal states are sacred
      if (live.has(id)) continue; // Caller vouches this one is genuinely live
      runs.set(id, { ...run, status: 'completed', endedAt: run.endedAt ?? now });
      changed = true;
    }
    if (changed) {
      set({ runs });
      persistRuns(runs);
    }
  },

  setActiveSessionId: (sessionId) => {
    if (get().activeSessionId === sessionId) return;
    set({ activeSessionId: sessionId });
  },
}));

/** Reactive per-session lookup — stable reference until that session's entry changes. */
export const useRunState = (sessionId: string | null | undefined): RunState | undefined =>
  useRunRegistry((s) => (sessionId ? s.runs.get(sessionId) : undefined));

/** Reactive lookup for the pinned active conversation's run. */
export const useActiveRunState = (): RunState | undefined =>
  useRunRegistry((s) => (s.activeSessionId ? s.runs.get(s.activeSessionId) : undefined));

/** Surfaces that know the active chat session (ConversationList) pin it here. */
export const setActiveRunSession = (sessionId: string | null): void => {
  useRunRegistry.getState().setActiveSessionId(sessionId);
};

/**
 * Mirrors authoritative server-side outcomes (/api/runs rows) into the registry.
 * Rules:
 *  - Server terminal status fills any absent or non-terminal registry entry
 *    (never overwrites an existing terminal verdict — deliberate client-side
 *    cancel detection outranks a racing server row).
 *  - A server row still claiming 'running' with nothing generating is a stale
 *    audit row: represented locally as completed unless the run just ended and
 *    its real verdict is still landing (caller passes `justEndedAfter`).
 */
export const mirrorServerRunRows = (
  rows: Array<{ id: unknown; status?: unknown; startedAt?: unknown; finishedAt?: unknown }>,
  currentlyGenerating: boolean,
  justEndedAfter: number | null
): void => {
  const registry = useRunRegistry.getState();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !row.id) continue;
    const mapped = normalizeServerRunStatus(row.status);
    if (!mapped) continue;
    const startedAt = typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) ? row.startedAt : undefined;
    const existing = registry.getRun(row.id);
    if (isTerminalRunStatus(mapped)) {
      if (!existing || !isTerminalRunStatus(existing.status)) {
        registry.markRun(row.id, mapped, {
          ...(startedAt !== undefined ? { startedAt } : {}),
          ...(typeof row.finishedAt === 'number' && Number.isFinite(row.finishedAt) ? { endedAt: row.finishedAt } : {}),
        });
      }
    } else if (!existing && !currentlyGenerating && !justEndedAfter) {
      registry.markRun(row.id, 'completed', { ...(startedAt !== undefined ? { startedAt } : {}) });
    }
  }
};

/**
 * Lifecycle auto-wiring. The registry subscribes to the shared IDE store so
 * every send/cancel/answer path (Manager shell, AgentChat) feeds ONE lifecycle
 * without touching transport code. Live runs key off the pinned active chat
 * session when known, else a designated fallback key.
 */
const LIVE_FALLBACK_KEY = 'session-live';

/** ManagerShell appends this marker when the user stops generation (same pattern ResultSummaryCard strips). */
const CANCELLED_MARKER_RE = /\*\(Generation stopped\./;

/** How long after the generating flip we re-check for the late-landing cancel marker. */
const CANCEL_DECISION_LAG_MS = 80;

let prevGenerating = useIDEStore.getState().isAgentGenerating;
let pendingRecheck: ReturnType<typeof setTimeout> | null = null;
/** True while a provisional 'completed' may still be upgraded to 'cancelled'. */
let upgradeWindowOpen = false;

const liveKey = (): string => useRunRegistry.getState().activeSessionId || LIVE_FALLBACK_KEY;

/**
 * End-of-run verdict, evaluated twice: immediately at the generating flip
 * (so surfaces never linger on 'running'), then once more after the cancel
 * marker has had its turn to land — ManagerShell appends it AFTER the flag
 * drops. A provisional 'completed' may be upgraded to 'cancelled' during the
 * recheck; nothing else rewrites an existing verdict.
 */
const applyEndVerdict = (phase: 'immediate' | 'recheck'): void => {
  if (phase === 'recheck') {
    if (!upgradeWindowOpen) return;
    upgradeWindowOpen = false;
    // A newer run already took over — its verdict is not ours to touch
    if (useIDEStore.getState().isAgentGenerating) return;
  }

  const ide = useIDEStore.getState();
  const key = liveKey();
  const registry = useRunRegistry.getState();
  const existing = registry.getRun(key);

  const lastAssistant = [...ide.agentMessages].reverse().find((m) => m.role === 'assistant');
  const content = typeof lastAssistant?.content === 'string' ? lastAssistant.content : '';
  const cancelled = CANCELLED_MARKER_RE.test(content);

  if (cancelled) {
    registry.markRun(key, 'cancelled'); // upgrades a provisional completed too
    return;
  }

  if (existing && isTerminalRunStatus(existing.status)) return; // failed/cancelled/completed stand

  if (phase === 'immediate') {
    upgradeWindowOpen = true;
    registry.markRun(key, 'completed'); // provisional until the recheck closes
  }
};

useIDEStore.subscribe((state) => {
  const generating = state.isAgentGenerating;
  const registry = useRunRegistry.getState();
  const key = liveKey();

  if (generating && !prevGenerating) {
    // New run supersedes any pending end-of-run decision
    if (pendingRecheck) {
      clearTimeout(pendingRecheck);
      pendingRecheck = null;
    }
    upgradeWindowOpen = false;
    registry.markRun(key, 'running', { startedAt: Date.now() });
  } else if (!generating && prevGenerating) {
    applyEndVerdict('immediate');
    pendingRecheck = setTimeout(() => {
      pendingRecheck = null;
      applyEndVerdict('recheck');
    }, CANCEL_DECISION_LAG_MS);
  }

  // Parked-on-user transitions while the run stays open (ask_user flow)
  if (generating) {
    const waiting = Boolean(state.pendingAgentQuestion);
    const current = useRunRegistry.getState().getRun(key);
    if (waiting && current && current.status === 'running') {
      registry.markRun(key, 'waiting_for_input');
    } else if (!waiting && current && current.status === 'waiting_for_input') {
      registry.markRun(key, 'running');
    }
  }

  prevGenerating = generating;
});
