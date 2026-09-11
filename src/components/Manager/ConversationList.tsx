import React, { useEffect, useState } from 'react';
import { MessageSquare, Pin, PinOff, Trash2, MessageCircleDashed, RotateCcw, Loader2, AlertCircle, XCircle } from 'lucide-react';
import { ChatSessionSummary, formatCompactTimestamp } from './useChatSessions.js';
import { setActiveRunSession, useRunState } from '../../stores/runRegistry.js';

/**
 * Cap on sidebar rows before "Show more" appears. Keeps the new-conversation
 * landing page calm — long histories stay accessible but stop dominating the
 * first viewport.
 */
const DEFAULT_VISIBLE_SESSIONS = 5;

interface ConversationListProps {
  sessions: ChatSessionSummary[];
  isLoading: boolean;
  error: string | null;
  activeSessionId: string | null;
  pinnedSessionIds: string[];
  emptyMessage: string;
  /** Session currently generating a response — shows the quiet working dot. */
  workingSessionId?: string | null;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}

/**
 * Leading filler phrases stripped for DISPLAY ONLY — stored titles are never
 * mutated. Ordered longest-first so overlapping prefixes resolve cleanly.
 */
const DISPLAY_FILLER_PREFIXES = ['i want to', 'can you', 'help me', 'please', 'hey'] as const;

/** Titles cut at or below this many characters, always on a word boundary. */
const MAX_DISPLAY_TITLE_LENGTH = 42;

/** Only accept a filler strip when a separator follows, so "helper bot" keeps its head. */
const FILLER_TAIL_SEPARATOR = /^[\s,.;:!-]/;

const stripLeadingFiller = (title: string): string => {
  const lower = title.toLowerCase();
  for (const filler of DISPLAY_FILLER_PREFIXES) {
    if (!lower.startsWith(filler)) continue;
    const remainder = title.slice(filler.length);
    if (!FILLER_TAIL_SEPARATOR.test(remainder)) continue;
    const cleaned = remainder.replace(/^[\s,.;:!-]+/, '');
    if (cleaned.length > 0) return cleaned;
  }
  return title;
};

/**
 * Display title: strips leading filler words and truncates at the last space
 * before the 42-char limit instead of mid-word. Pure function of the stored
 * title — the session record itself is never touched.
 */
export const displayTitle = (rawTitle?: string): string => {
  if (typeof rawTitle !== 'string') return 'Untitled conversation';
  const trimmed = rawTitle.trim();
  if (!trimmed) return 'Untitled conversation';
  const stripped = stripLeadingFiller(trimmed);
  if (stripped.length <= MAX_DISPLAY_TITLE_LENGTH) return stripped;
  const head = stripped.slice(0, MAX_DISPLAY_TITLE_LENGTH);
  const spaceIdx = head.lastIndexOf(' ');
  const cutAt = spaceIdx >= Math.floor(MAX_DISPLAY_TITLE_LENGTH / 2) ? spaceIdx : head.length;
  return `${stripped.slice(0, cutAt).replace(/[\s,.;:]+$/, '')}…`;
};

/**
 * Per-row run marker driven by the shared run registry (single source of truth
 * for run lifecycle). A liveness claim pulses; a failed/cancelled run leaves a
 * quiet badge so history never masquerades as "still working". When the
 * registry has no verdict yet, falls back to the caller's working hint so the
 * first moments of a brand-new session still show activity.
 */
const RunStatusBadge: React.FC<{ sessionId: string; sessionTitle: string; fallbackWorking: boolean }> = ({
  sessionId,
  sessionTitle,
  fallbackWorking,
}) => {
  const run = useRunState(sessionId);
  const status = run?.status;
  if (status === 'running' || status === 'queued' || status === 'waiting_for_input' || fallbackWorking) {
    return (
      <span className="shrink-0 flex items-center justify-center" role="status" aria-label={`Generating: ${sessionTitle}`} title="Astra is working on this conversation">
        <Loader2 className="w-3 h-3 animate-spin text-obsidian-inkSecondary" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="shrink-0 flex items-center justify-center" aria-label={`Failed: ${sessionTitle}`} title="Last run failed">
        <AlertCircle className="w-3 h-3 text-obsidian-danger" />
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="shrink-0 flex items-center justify-center" aria-label={`Cancelled: ${sessionTitle}`} title="Cancelled">
        <XCircle className="w-3 h-3 text-obsidian-inkMuted opacity-60" />
      </span>
    );
  }
  return null;
};

export const ConversationList: React.FC<ConversationListProps> = ({
  sessions,
  isLoading,
  error,
  activeSessionId,
  pinnedSessionIds,
  emptyMessage,
  workingSessionId = null,
  onRetry,
  onOpen,
  onDelete,
  onTogglePin,
}) => {
  // Skeletons belong to the cold load only — a background refresh always has
  // previous rows to keep on screen, so swapping them out is what caused the
  // history flash. Refreshing rows stay rendered, just slightly dimmed.
  const isColdLoad = isLoading && sessions.length === 0;
  const [isExpanded, setExpanded] = useState(false);

  // The sidebar knows which conversation is live — pin it in the run registry
  // so lifecycle entries key off the real chat session id. Must run before the
  // early returns below (hooks order).
  useEffect(() => {
    setActiveRunSession(activeSessionId);
  }, [activeSessionId]);

  if (isColdLoad) {
    // Skeleton rows at exact conversation-row height — no layout shift on load
    return (
      <div className="px-1.5 space-y-0.5" role="status" aria-label="Loading conversations">
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-h-[46px] rounded-lg px-2 py-1.5 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-obsidian-surface2 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="h-2 rounded bg-obsidian-surface2 w-3/4" aria-hidden="true" />
              <div className="h-1.5 rounded bg-obsidian-surface1 w-1/2" aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-2 my-1 p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex flex-col items-center gap-2 text-center">
        <span className="text-[11px] text-obsidian-inkSecondary leading-relaxed">{error}</span>
        <button
          onClick={onRetry}
          title="Reload conversations"
          className="px-2 py-0.5 rounded bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary text-[10px] font-mono flex items-center gap-1 transition-colors duration-150 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" aria-hidden="true" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="px-3 py-5 flex flex-col items-center gap-1.5 text-center" role="status">
        <MessageCircleDashed className="w-3.5 h-3.5 text-obsidian-inkMuted" aria-hidden="true" />
        <span className="text-[11px] text-obsidian-inkSecondary leading-relaxed">{emptyMessage}</span>
      </div>
    );
  }

  // Show pinned sessions first (always visible), then cap the rest so the
  // landing page doesn't drown in old conversations.
  const pinned = sessions.filter((s) => pinnedSessionIds.includes(s.id));
  const recent = sessions.filter((s) => !pinnedSessionIds.includes(s.id));
  const collapsedRecent = recent.slice(0, DEFAULT_VISIBLE_SESSIONS);
  const hiddenCount = recent.length - collapsedRecent.length;
  const orderedSessions = [...pinned, ...collapsedRecent];

  return (
    <div className="space-y-3">
      <div className={`space-y-0.5 px-1.5 transition-opacity duration-150 ${isLoading ? 'opacity-70' : ''}`} role="list">
        {orderedSessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const isPinned = pinnedSessionIds.includes(session.id);
          const isWorking = session.id === workingSessionId;
          const compactTime = formatCompactTimestamp(session.updated_at);
          return (
            <div
              key={session.id}
              role="listitem"
              tabIndex={0}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => onOpen(session.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(session.id);
              }
            }}
            className={`group relative w-full min-h-[46px] rounded-lg pl-2.5 pr-2 py-1.5 flex items-center gap-2 outline-none transition-colors duration-150 cursor-pointer focus-visible:ring-1 focus-visible:ring-obsidian-border ${
              isActive
                ? 'bg-obsidian-surface2 text-obsidian-inkPrimary'
                : 'hover:bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            {/* Active-row indicator: 2px white bar flush with the left edge */}
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-white transition-opacity duration-150 ${
                isActive ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {isPinned ? (
              <Pin className="w-3 h-3 shrink-0 text-obsidian-inkSecondary fill-current" aria-hidden="true" />
            ) : (
              <MessageSquare className="w-3 h-3 shrink-0 opacity-60" aria-hidden="true" />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-xs leading-snug flex-1 min-w-0" title={session.title || undefined}>
                  {displayTitle(session.title)}
                </div>
                <RunStatusBadge
                  sessionId={session.id}
                  sessionTitle={session.title || 'Untitled conversation'}
                  fallbackWorking={isWorking}
                />
                {compactTime && (
                  <span className="shrink-0 text-[10px] font-mono tabular-nums text-obsidian-inkSecondary">
                    {compactTime}
                  </span>
                )}
              </div>
              {typeof session.message_count === 'number' && session.message_count > 0 && (
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono tabular-nums text-obsidian-inkMuted">
                  <span>{`${session.message_count} msg${session.message_count === 1 ? '' : 's'}`}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(session.id);
                }}
                aria-label={
                  isPinned
                    ? `Unpin conversation: ${session.title || 'Untitled'}`
                    : `Pin conversation: ${session.title || 'Untitled'}`
                }
                title={isPinned ? 'Unpin' : 'Pin'}
                className="p-1.5 rounded text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors duration-150 cursor-pointer"
              >
                {isPinned ? <PinOff className="w-3 h-3" aria-hidden="true" /> : <Pin className="w-3 h-3" aria-hidden="true" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
                aria-label={`Delete conversation: ${session.title || 'Untitled'}`}
                title="Delete"
                className="p-1.5 rounded text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors duration-150 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
      </div>

      {/* "Show more" only renders when conversations were collapsed; pinned
          ones above stay reachable without inflating the sidebar. */}
      {hiddenCount > 0 && (
        <div className="px-2.5 -mt-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={isExpanded}
            className="w-full px-2 py-1.5 rounded-md text-[11px] font-medium text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
          >
            {isExpanded
              ? `Show less`
              : `Show ${hiddenCount} more conversation${hiddenCount === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {isExpanded && hiddenCount > 0 && (
        <div className="space-y-0.5 px-1.5" role="list">
          {recent.slice(DEFAULT_VISIBLE_SESSIONS).map((session) => {
            const isActive = session.id === activeSessionId;
            const compactTime = formatCompactTimestamp(session.updated_at);
            return (
              <div
                key={session.id}
                role="listitem"
                tabIndex={0}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onOpen(session.id)}
                className={`group relative w-full min-h-[46px] rounded-lg pl-2.5 pr-2 py-1.5 flex items-center gap-2 outline-none transition-colors duration-150 cursor-pointer focus-visible:ring-1 focus-visible:ring-obsidian-border ${
                  isActive
                    ? 'bg-obsidian-surface2 text-obsidian-inkPrimary'
                    : 'hover:bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-white transition-opacity duration-150 ${
                    isActive ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                <MessageSquare className="w-3 h-3 shrink-0 opacity-60" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <div className="truncate text-xs leading-snug flex-1 min-w-0" title={session.title || undefined}>
                      {displayTitle(session.title)}
                    </div>
                    {compactTime && (
                      <span className="shrink-0 text-[10px] font-mono tabular-nums text-obsidian-inkSecondary">
                        {compactTime}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
