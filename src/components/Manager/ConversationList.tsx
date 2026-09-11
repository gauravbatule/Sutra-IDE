import React from 'react';
import { MessageSquare, Pin, PinOff, Trash2, MessageCircleDashed, RotateCcw } from 'lucide-react';
import { ChatSessionSummary, formatCompactTimestamp } from './useChatSessions.js';

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
  if (isLoading) {
    // Skeleton rows at exact conversation-row height — no layout shift on load
    return (
      <div className="px-1.5 space-y-0.5" role="status" aria-label="Loading conversations">
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-h-[46px] rounded-lg px-2 py-1.5 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-white/[0.06] shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="h-2 rounded bg-white/[0.07] w-3/4" aria-hidden="true" />
              <div className="h-1.5 rounded bg-white/[0.04] w-1/2" aria-hidden="true" />
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
          className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-obsidian-inkPrimary text-[10px] font-mono flex items-center gap-1 transition-colors duration-150 cursor-pointer"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="px-3 py-5 flex flex-col items-center gap-1.5 text-center" role="status">
        <MessageCircleDashed className="w-4 h-4 text-obsidian-inkMuted" />
        <span className="text-[11px] text-obsidian-inkMuted leading-relaxed">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-1.5" role="list">
      {sessions.map((session) => {
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
            className={`group w-full min-h-[46px] rounded-lg px-2 py-1.5 flex items-center gap-2 outline-none transition-colors duration-150 cursor-pointer focus-visible:ring-1 focus-visible:ring-white/30 ${
              isActive
                ? 'bg-white/[0.08] text-obsidian-inkPrimary'
                : 'hover:bg-white/[0.04] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            {isPinned ? (
              <Pin className="w-3 h-3 shrink-0 text-zinc-300 fill-current" aria-hidden="true" />
            ) : (
              <MessageSquare className="w-3 h-3 shrink-0 opacity-60" aria-hidden="true" />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="truncate text-xs leading-snug flex-1 min-w-0">{session.title || 'Untitled conversation'}</div>
                <div className="flex items-center gap-1 shrink-0">
                  {isWorking && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-obsidian-inkPrimary"
                      role="status"
                      aria-label={`Generating: ${session.title || 'Untitled conversation'}`}
                      title="Astra is working on this conversation"
                    />
                  )}
                  {compactTime && (
                    <span className="text-[10px] font-mono text-obsidian-inkMuted">{compactTime}</span>
                  )}
                </div>
              </div>
              <div className="text-[10px] font-mono text-obsidian-inkMuted truncate">
                {typeof session.message_count === 'number' ? `${session.message_count} msgs` : ''}
              </div>
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
                className="p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/10 transition-colors duration-150 cursor-pointer"
              >
                {isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
                aria-label={`Delete conversation: ${session.title || 'Untitled'}`}
                title="Delete"
                className="p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/10 transition-colors duration-150 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
