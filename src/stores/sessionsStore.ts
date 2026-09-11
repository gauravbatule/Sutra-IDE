import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Shared store for the chat-history sidebar (Manager conversation list).
 *
 * Root cause this replaces (history-sidebar flash, issue #24): each surface
 * kept its own `useState` session list whose loader flipped `isLoading` true
 * before every refetch — swapping real rows for skeleton rows — then
 * wholesale-replaced the array even when nothing changed. Because
 * ManagerShell syncs the transcript after every streamed delta and bumps a
 * refreshKey per successful sync, the sidebar cycled rows -> skeletons -> rows
 * continuously during any run.
 *
 * This module fixes the flash at the state layer:
 *  1. The previous list stays rendered while refetching — skeletons only on
 *     the very first (cold) load when there is nothing to keep on screen.
 *  2. Rows merge by id; unchanged rows keep their object references so React
 *     reconciliation never repaints them.
 *  3. The store is only written when the data actually differs.
 *  4. Fetch triggers are deduped — one fetch in flight plus at most one
 *     trailing re-run, no matter how many refresh requests arrive mid-flight.
 */

export interface ChatSessionSummary {
  id: string;
  title?: string;
  updated_at?: string;
  created_at?: string;
  message_count?: number;
}

interface SessionsState {
  sessions: ChatSessionSummary[];
  /** True only while loading with no data yet to render (cold load). */
  isLoading: boolean;
  error: string | null;
  /** Flips true after the first successful load; background refreshes are silent. */
  loadedOnce: boolean;
}

/** Shallow equality over every field the history list renders. */
const rowEquals = (a: ChatSessionSummary, b: ChatSessionSummary): boolean =>
  a.id === b.id &&
  a.title === b.title &&
  a.updated_at === b.updated_at &&
  a.created_at === b.created_at &&
  a.message_count === b.message_count;

/**
 * Merges freshly fetched rows into the previously rendered list without ever
 * clearing it. Unchanged rows reuse the previous object reference (stable
 * identity for React), changed/new rows come from the server payload, deleted
 * rows drop out, and ordering always follows the server. Returns
 * `changed: false` (with the untouched previous array) when nothing differs,
 * letting callers skip the state write entirely.
 */
export const mergeSessions = (
  prev: ChatSessionSummary[],
  next: ChatSessionSummary[]
): { list: ChatSessionSummary[]; changed: boolean } => {
  if (prev === next) return { list: prev, changed: false };

  // Fast path: same length, same ids in the same order, all fields equal.
  if (prev.length === next.length) {
    let identical = true;
    for (let i = 0; i < prev.length; i++) {
      if (!rowEquals(prev[i], next[i])) {
        identical = false;
        break;
      }
    }
    if (identical) return { list: prev, changed: false };
  }

  const prevById = new Map(prev.map((s) => [s.id, s]));
  // Server order wins; stable references wherever a row is unchanged.
  const list = next.map((row) => {
    const existing = row ? prevById.get(row.id) : undefined;
    return existing && rowEquals(existing, row) ? existing : row;
  });
  return { list, changed: true };
};

/** Coerces the API payload into well-formed rows, dropping malformed entries. */
export const sanitizeSessionRows = (payload: unknown): ChatSessionSummary[] => {
  if (!Array.isArray(payload)) return [];
  const rows: ChatSessionSummary[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id) continue;
    rows.push({
      id: record.id,
      title: typeof record.title === 'string' ? record.title : undefined,
      updated_at: typeof record.updated_at === 'string' ? record.updated_at : undefined,
      created_at: typeof record.created_at === 'string' ? record.created_at : undefined,
      message_count: typeof record.message_count === 'number' ? record.message_count : undefined,
    });
  }
  return rows;
};

export const useSessionsStore = create<SessionsState>(() => ({
  sessions: [],
  isLoading: false,
  error: null,
  loadedOnce: false,
}));

// Fetch coordination lives outside the store: it is transport bookkeeping,
// not renderable state, and keeping it out means refreshing never writes it.
let fetchInFlight = false;
let fetchQueued = false;

const runFetch = async (): Promise<void> => {
  // In-flight guard + trailing coalesce: N overlapping triggers collapse into
  // at most one concurrent request followed by one final catch-up request.
  if (fetchInFlight) {
    fetchQueued = true;
    return;
  }
  fetchInFlight = true;

  const state = useSessionsStore.getState();
  const coldLoad = !state.loadedOnce;
  // Skeletons only on a cold load — a background refresh always has rows to
  // keep rendered, which is exactly what prevents the sidebar flash.
  if (coldLoad && !state.isLoading) {
    useSessionsStore.setState({ isLoading: true });
  }
  try {
    const res = await fetch('/api/chat/sessions');
    if (!res.ok) {
      throw new Error(`Could not load conversations (${res.status})`);
    }
    const data = await res.json();
    const incoming = sanitizeSessionRows(data?.sessions);
    const current = useSessionsStore.getState();
    const { list, changed } = mergeSessions(current.sessions, incoming);

    // Only touch state when something observable actually differs — an
    // unchanged payload must not produce a single subscriber notification.
    const patch: Partial<SessionsState> = {};
    if (coldLoad || changed) patch.sessions = list;
    if (current.isLoading) patch.isLoading = false;
    if (current.error !== null) patch.error = null;
    if (!current.loadedOnce) patch.loadedOnce = true;
    if (Object.keys(patch).length > 0) useSessionsStore.setState(patch);
  } catch (err: unknown) {
    const current = useSessionsStore.getState();
    const patch: Partial<SessionsState> = {};
    if (current.isLoading) patch.isLoading = false;
    // A failed background refresh keeps the rendered list; only a cold load
    // surfaces the retry card (the list is empty anyway).
    if (!current.loadedOnce) {
      patch.error = err instanceof Error && err.message ? err.message : 'Could not load conversations';
    }
    if (Object.keys(patch).length > 0) useSessionsStore.setState(patch);
  } finally {
    fetchInFlight = false;
    if (fetchQueued) {
      fetchQueued = false;
      void runFetch();
    }
  }
};

/** Imperative refresh — safe to call from anywhere, deduped while in flight. */
export const refreshSessions = (): Promise<void> => runFetch();

export interface UseChatSessionsResult {
  sessions: ChatSessionSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Drop-in replacement for the component-local useChatSessions hook: same
 * result shape, backed by the shared no-flash store. Primitive selectors keep
 * re-renders limited to components whose slice actually changed.
 */
export const useChatSessionsStore = (): UseChatSessionsResult => {
  const sessions = useSessionsStore((s) => s.sessions);
  const isLoading = useSessionsStore((s) => s.isLoading);
  const error = useSessionsStore((s) => s.error);

  // Initial load only; later refreshes arrive via explicit triggers.
  useEffect(() => {
    void refreshSessions();
  }, []);

  return { sessions, isLoading, error, refresh: refreshSessions };
};

/** Clears state and fetch coordination — used by the test suite only. */
export const resetSessionsForTests = (): void => {
  fetchInFlight = false;
  fetchQueued = false;
  useSessionsStore.setState({ sessions: [], isLoading: false, error: null, loadedOnce: false });
};
