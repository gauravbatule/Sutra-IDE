import React, { useEffect, useState } from 'react';
import { CheckCircle2, CornerDownLeft, HelpCircle } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { answerAgentQuestion, markQuestionAnswered, wasQuestionAnswered } from '../../utils/agentSocket.js';

export interface AgentQuestion {
  id: string;
  question: string;
  options: string[];
  allowFreeText: boolean;
}

interface ResolvedQuestion {
  id: string;
  question: string;
  answer: string;
  delivered: boolean;
}

/**
 * Rebuilds a pending ask_user question from the raw toolCall params when the
 * agent_question packet missed the store slice (e.g. socket timing). Returns
 * null for answered or already-resolved calls so the card never resurrects.
 */
export const findAskUserFallback = (
  messages: Array<{ toolCalls?: Array<{ id: string; tool: string; params?: Record<string, unknown>; status?: string; result?: unknown }> }> | any[]
): AgentQuestion | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = (messages[i] as { toolCalls?: Array<{ id: string; tool: string; params?: Record<string, unknown>; status?: string; result?: unknown }> })?.toolCalls;
    if (!calls) continue;
    for (let j = calls.length - 1; j >= 0; j--) {
      const tc = calls[j];
      if (!tc || tc.tool !== 'ask_user' || !tc.id) continue;
      if (tc.status === 'completed' || tc.status === 'failed' || tc.result) continue;
      if (wasQuestionAnswered(tc.id)) continue;
      const params = tc.params || {};
      const question = typeof params.question === 'string' ? params.question.trim() : '';
      if (!question) continue;
      const options = Array.isArray(params.options)
        ? (params.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        : [];
      return {
        id: tc.id,
        question,
        options: options.slice(0, 4),
        allowFreeText: params.allow_free_text !== false,
      };
    }
  }
  return null;
};

/**
 * Shared ask_user card (used by Manager mode and the IDE agent panel).
 *
 * Renders the store's pendingAgentQuestion as an interactive card; on answer it
 * sends the agent_answer packet via utils/agentSocket and swaps itself for an
 * inline Question / Your answer record. When the store slice is empty a caller
 * may pass a toolCall-derived `fallback` question instead. Self-hiding when
 * there is nothing to show — mount it unconditionally in the transcript.
 */
export const AskUserCard: React.FC<{ fallback?: AgentQuestion | null }> = ({ fallback = null }) => {
  const pendingAgentQuestion = useIDEStore((s) => s.pendingAgentQuestion);
  const setPendingAgentQuestion = useIDEStore((s) => s.setPendingAgentQuestion);
  const [resolved, setResolved] = useState<ResolvedQuestion | null>(null);
  const [freeText, setFreeText] = useState('');

  const active = pendingAgentQuestion ?? (fallback && !wasQuestionAnswered(fallback.id) ? fallback : null);

  // A brand-new question resets any previously resolved record
  useEffect(() => {
    if (active) {
      setResolved(null);
      setFreeText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  if (!active && !resolved) return null;

  const submit = (answer: string) => {
    const trimmed = answer.trim();
    if (!active || !trimmed) return;
    const delivered = answerAgentQuestion(active.id, trimmed);
    markQuestionAnswered(active.id);
    setResolved({
      id: active.id,
      question: active.question,
      answer: trimmed,
      delivered,
    });
    setPendingAgentQuestion(null);
  };

  // Resolved state: compact inline record of the exchange
  if (!active && resolved) {
    return (
      <div
        className="rounded-xl border border-obsidian-hairline bg-obsidian-surface1 p-3 space-y-2 text-xs"
        aria-label="Answered question"
      >
        <div className="flex items-start gap-2">
          <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Question</div>
            <p className="text-obsidian-inkSecondary leading-relaxed break-words">{resolved.question}</p>
          </div>
        </div>
        <div className="flex items-start gap-2 pl-[22px]">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Your answer</div>
            <p className="text-obsidian-inkPrimary leading-relaxed break-words">{resolved.answer}</p>
            {!resolved.delivered && (
              <p className="mt-1 text-[10px] font-mono text-red-400">
                Not delivered — the run may have ended. Note this in your next message.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const q = active!;
  const canSendFreeText = Boolean(freeText.trim());

  return (
    <div
      className="rounded-xl border border-white/20 bg-obsidian-surface2 p-4 space-y-3 shadow-elevation"
      role="group"
      aria-label="The agent asked a question"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Astra asks</span>
      </div>
      <div className="flex items-start gap-2.5">
        <HelpCircle className="w-5 h-5 mt-0.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
        <p className="text-sm font-semibold text-white leading-relaxed break-words">{q.question}</p>
      </div>

      {q.options.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-7" role="listbox" aria-label="Answer options">
          {q.options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => submit(option)}
              className="px-3.5 py-2 rounded-lg border border-white/15 bg-white/[0.06] hover:bg-white/[0.14] hover:border-white/35 text-[13px] font-medium text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {(q.allowFreeText || q.options.length === 0) && (
        <form
          className="flex items-center gap-2 pl-7"
          onSubmit={(e) => {
            e.preventDefault();
            submit(freeText);
          }}
        >
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="Or type your own answer..."
            aria-label="Type your answer"
            autoComplete="off"
            className="flex-1 min-w-0 bg-black/30 px-3 py-2 rounded-lg border border-white/20 focus:border-white/45 text-[13px] text-white placeholder-zinc-500 focus:outline-none transition-colors duration-150"
          />
          <button
            type="submit"
            disabled={!canSendFreeText}
            aria-label="Send answer"
            title="Send answer"
            className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              canSendFreeText
                ? 'bg-white text-black hover:bg-zinc-200'
                : 'bg-white/[0.06] text-zinc-600 cursor-not-allowed'
            }`}
          >
            <CornerDownLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>
      )}
    </div>
  );
};
