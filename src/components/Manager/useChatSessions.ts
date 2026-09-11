import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChatSessionSummary {
  id: string;
  title?: string;
  updated_at?: string;
  created_at?: string;
  message_count?: number;
}

interface UseChatSessionsResult {
  sessions: ChatSessionSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Loads conversation summaries from GET /api/chat/sessions.
 * Response shape: { success: boolean, sessions: Array } — see server/index.ts.
 */
export const useChatSessions = (): UseChatSessionsResult => {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadTick = useRef(0);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/sessions');
      if (!res.ok) {
        throw new Error(`Could not load conversations (${res.status})`);
      }
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (err: any) {
      setError(err?.message || 'Could not load conversations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    reloadTick.current += 1;
    load();
  }, [load]);

  return { sessions, isLoading, error, refresh };
};

/** Compact relative timestamp like "2m ago", "Yesterday", "Mar 12". */
export const formatRelativeTime = (value?: string): string => {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * Ultra-compact relative stamp for conversation-row gutters:
 * "now", "2m", "1h", "6d", "3w", "2mo", "1y".
 */
export const formatCompactTimestamp = (value?: string): string => {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
};
