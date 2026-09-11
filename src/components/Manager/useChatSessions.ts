import {
  ChatSessionSummary,
  UseChatSessionsResult,
  useChatSessionsStore,
} from '../../stores/sessionsStore.js';

export type { ChatSessionSummary, UseChatSessionsResult };

/**
 * Loads conversation summaries from the shared sessions store (zero-flicker).
 */
export const useChatSessions = (): UseChatSessionsResult => {
  return useChatSessionsStore();
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
