import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mergeSessions,
  refreshSessions,
  resetSessionsForTests,
  sanitizeSessionRows,
  useChatSessionsStore,
  useSessionsStore,
  type ChatSessionSummary,
} from '../stores/sessionsStore.js';
import { act, renderHook } from '@testing-library/react';

const row = (id: string, overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary => ({
  id,
  title: `Conversation ${id}`,
  updated_at: '2026-01-01T00:00:00Z',
  message_count: 2,
  ...overrides,
});

const jsonResponse = (sessions: unknown) =>
  ({ ok: true, json: async () => ({ success: true, sessions }) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSessionsForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mergeSessions', () => {
  it('returns the untouched previous array when nothing changed', () => {
    const prev = [row('a'), row('b')];
    const next = [
      { id: 'a', title: 'Conversation a', updated_at: '2026-01-01T00:00:00Z', message_count: 2 },
      { id: 'b', title: 'Conversation b', updated_at: '2026-01-01T00:00:00Z', message_count: 2 },
    ];
    const { list, changed } = mergeSessions(prev, next as ChatSessionSummary[]);
    expect(changed).toBe(false);
    expect(list).toBe(prev); // Same reference — no store write, no re-render
  });

  it('reuses previous references for unchanged rows and updates only changed ones', () => {
    const prev = [row('a'), row('b'), row('c')];
    const next = [row('a'), row('b', { title: 'Renamed' }), row('c', { message_count: 9 })];
    const { list, changed } = mergeSessions(prev, next);
    expect(changed).toBe(true);
    expect(list[0]).toBe(prev[0]); // Identity preserved
    expect(list[1].title).toBe('Renamed');
    expect(list[2].message_count).toBe(9);
  });

  it('adds new rows and drops deleted ones while following server order', () => {
    const prev = [row('a'), row('b')];
    const next = [row('new'), row('a')]; // b deleted, new prepended
    const { list, changed } = mergeSessions(prev, next);
    expect(changed).toBe(true);
    expect(list.map((s) => s.id)).toEqual(['new', 'a']);
  });

  it('treats a pure reorder as a change so server ordering wins', () => {
    const prev = [row('a'), row('b')];
    const next = [row('b'), row('a')];
    const { list, changed } = mergeSessions(prev, next);
    expect(changed).toBe(true);
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('sanitizeSessionRows', () => {
  it('keeps well-formed rows and drops malformed entries', () => {
    const rows = sanitizeSessionRows([
      row('ok'),
      null,
      { nope: true },
      { id: 42 },
      { id: 'also-ok', title: 7, message_count: '3' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['ok', 'also-ok']);
    expect(rows[1].title).toBeUndefined();
    expect(rows[1].message_count).toBeUndefined();
  });

  it('returns an empty array for non-array payloads', () => {
    expect(sanitizeSessionRows(undefined)).toEqual([]);
    expect(sanitizeSessionRows({ sessions: [] })).toEqual([]);
  });
});

describe('sessions store (no-flash refetch behavior)', () => {
  it('cold load shows the loading flag, then fills the empty list', async () => {
    let resolveFetch!: (v: Response) => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve))
    );

    const { result } = renderHook(() => useChatSessionsStore());
    expect(useSessionsStore.getState().isLoading).toBe(true);

    await act(async () => {
      resolveFetch(jsonResponse([row('a')]));
    });
    expect(result.current.sessions.map((s) => s.id)).toEqual(['a']);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('background refresh never flips isLoading — previous list stays rendered', async () => {
    fetchMock.mockResolvedValue(jsonResponse([row('a'), row('b')]));

    await act(async () => {
      await refreshSessions(); // Cold load
    });
    const afterColdLoad = useSessionsStore.getState();

    // The refetch that used to flash the sidebar: trigger it with a deferred
    // response so we can observe the state DURING the in-flight window.
    let resolveRefresh!: (v: Response) => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (resolveRefresh = resolve))
    );
    let refreshPromise: Promise<void> = Promise.resolve();
    act(() => {
      refreshPromise = refreshSessions();
    });

    const during = useSessionsStore.getState();
    expect(during.isLoading).toBe(false); // Skeletons must NOT appear
    expect(during.sessions).toBe(afterColdLoad.sessions); // Old rows still rendered

    await act(async () => {
      resolveRefresh(jsonResponse([row('a', { title: 'Updated title' }), row('b')]));
      await refreshPromise;
    });

    const after = useSessionsStore.getState();
    expect(after.isLoading).toBe(false);
    expect(after.sessions.map((s) => s.title)).toEqual(['Updated title', 'Conversation b']);
  });

  it('skips the state write entirely when refreshed data is unchanged', async () => {
    fetchMock.mockResolvedValue(jsonResponse([row('a'), row('b')]));
    await act(async () => {
      await refreshSessions();
    });
    const snapshot = useSessionsStore.getState();
    const sessionsRef = snapshot.sessions;

    await act(async () => {
      await refreshSessions(); // Identical payload from the server
    });

    const after = useSessionsStore.getState();
    expect(after.sessions).toBe(sessionsRef); // No swap-in of equal data
    expect(after.loadedOnce).toBe(true);
    expect(after.error).toBeNull();
  });

  it('collapses overlapping triggers into one fetch plus one trailing catch-up', async () => {
    let activeCount = 0;
    let maxConcurrency = 0;
    const resolvers: Array<(v: Response) => void> = [];
    fetchMock.mockImplementation(() => {
      activeCount += 1;
      maxConcurrency = Math.max(maxConcurrency, activeCount);
      return new Promise<Response>((resolve) =>
        resolvers.push((v) => {
          activeCount -= 1;
          resolve(v);
        })
      );
    });

    const first = refreshSessions();
    const second = refreshSessions();
    const third = refreshSessions();

    expect(fetchMock).toHaveBeenCalledTimes(1); // Others coalesced while in flight

    await act(async () => {
      resolvers[0](jsonResponse([row('a')]));
      await first;
    });

    // Trailing catch-up runs once for the two queued triggers.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers[1](jsonResponse([row('a'), row('z')]));
    });
    await Promise.all([second, third]);
    await vi.waitFor(() => {
      expect(useSessionsStore.getState().sessions.map((s) => s.id)).toEqual(['a', 'z']);
    });

    expect(maxConcurrency).toBe(1); // Never two concurrent requests
  });

  it('a failed background refresh keeps the rendered list and hides the error card', async () => {
    fetchMock.mockResolvedValue(jsonResponse([row('keep-me')]));
    await act(async () => {
      await refreshSessions();
    });

    fetchMock.mockRejectedValue(new Error('Server exploded'));
    await act(async () => {
      await refreshSessions();
    });

    const state = useSessionsStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual(['keep-me']);
    expect(state.error).toBeNull(); // No error card swapping out real rows
    expect(state.isLoading).toBe(false);
  });

  it('a failed cold load surfaces the error so the retry card can show', async () => {
    fetchMock.mockRejectedValue(new Error('Could not load conversations (500)'));
    await act(async () => {
      await refreshSessions();
    });
    expect(useSessionsStore.getState().error).toContain('500');
    expect(useSessionsStore.getState().isLoading).toBe(false);
  });
});
