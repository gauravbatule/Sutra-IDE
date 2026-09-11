import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CornerDownLeft, HelpCircle } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import {
  answerAgentQuestion,
  markQuestionAnswered,
  markQuestionUnanswered,
  wasQuestionAnswered,
  isQuestionUnanswered,
} from '../../utils/agentSocket.js';
import { ToolCallPayload } from '../../types/ide.js';

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

interface AskUserScanHit {
  /** id of the assistant message carrying the unanswered ask_user call */
  messageId: string;
  id: string;
  question: string;
  options: string[];
  allowFreeText: boolean;
}

/**
 * Scans backwards for the LATEST unanswered ask_user toolCall and reports both
 * its host message id and the reconstructed question. Shared by
 * findAskUserFallback (card hydration) and findAskUserAnchorId (#54 inline
 * positioning) so both can never disagree about which question is live.
 * Stops immediately if a user message is encountered, because any earlier
 * question was bypassed/superseded by that new user prompt.
 */
const scanLatestUnansweredAskUser = (
  messages: Array<{ role?: string; id?: string; toolCalls?: Array<{ id: string; tool: string; params?: Record<string, unknown>; status?: string; result?: unknown }> }> | any[]
): AskUserScanHit | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; id?: string; toolCalls?: Array<{ id: string; tool: string; params?: Record<string, unknown>; status?: string; result?: unknown }> };
    // If a user message occurred after the question, the question was superseded/unanswered
    if (message?.role === 'user') {
      break;
    }
    const calls = message?.toolCalls;
    if (!calls) continue;
    for (let j = calls.length - 1; j >= 0; j--) {
      const tc = calls[j];
      if (!tc || tc.tool !== 'ask_user' || !tc.id) continue;
      if (tc.status === 'completed' || tc.status === 'failed' || tc.result) continue;
      if (wasQuestionAnswered(tc.id) || isQuestionUnanswered(tc.id)) continue;
      const params = tc.params || {};
      const question = typeof params.question === 'string' ? params.question.trim() : '';
      if (!question) continue;
      const options = Array.isArray(params.options)
        ? (params.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        : [];
      return {
        messageId: String(message?.id || ''),
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
 * Rebuilds a pending ask_user question from the raw toolCall params when the
 * agent_question packet missed the store slice (e.g. socket timing). Returns
 * null for answered or already-resolved calls so the card never resurrects.
 */
export const findAskUserFallback = (
  messages: Array<{ toolCalls?: Array<{ id: string; tool: string; params?: Record<string, unknown>; status?: string; result?: unknown }> }> | any[]
): AgentQuestion | null => {
  const hit = scanLatestUnansweredAskUser(messages);
  return hit ? { id: hit.id, question: hit.question, options: hit.options, allowFreeText: hit.allowFreeText } : null;
};

/**
 * id of the assistant message that carries the latest unanswered ask_user
 * call, for anchoring the question card inline after that message's bubble.
 */
export const findAskUserAnchorId = (
  messages: Array<{ id?: string; toolCalls?: Array<{ id: string; tool: string; params?: Record<string, unknown>; status?: string; result?: unknown }> }> | any[]
): string | null => scanLatestUnansweredAskUser(messages)?.messageId ?? null;

export interface AskUserCardProps {
  toolCall?: ToolCallPayload | null;
  fallback?: AgentQuestion | null;
}

/**
 * Shared ask_user card (used by Manager mode and the IDE agent panel).
 *
 * Renders the store's pendingAgentQuestion or the inline toolCall as an interactive card;
 * on answer it sends the agent_answer packet via utils/agentSocket and swaps itself for an
 * inline Question / Your answer record that stays firmly in place in the message flow.
 */
export const AskUserCard: React.FC<AskUserCardProps> = ({ toolCall = null, fallback = null }) => {
  const pendingAgentQuestion = useIDEStore((s) => s.pendingAgentQuestion);
  const setPendingAgentQuestion = useIDEStore((s) => s.setPendingAgentQuestion);
  const agentMessages = useIDEStore((s) => s.agentMessages);
  const [resolved, setResolved] = useState<ResolvedQuestion | null>(null);
  const [freeText, setFreeText] = useState('');

  // Extract question from inline toolCall if present
  const toolCallQuestion = useMemo<AgentQuestion | null>(() => {
    if (!toolCall || toolCall.tool !== 'ask_user') return null;
    const params = (toolCall.params || {}) as Record<string, any>;
    const question = typeof params.question === 'string' ? params.question.trim() : '';
    if (!question) return null;
    const options = Array.isArray(params.options)
      ? (params.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
      : [];
    return {
      id: toolCall.id,
      question,
      options: options.slice(0, 4),
      allowFreeText: params.allow_free_text !== false,
    };
  }, [toolCall]);

  // Derive if question has been marked unanswered or superseded by subsequent user prompts
  const isUnanswered = useMemo(() => {
    const qId = toolCallQuestion?.id || fallback?.id;
    if (!qId) return false;
    if (wasQuestionAnswered(qId)) return false;
    if (isQuestionUnanswered(qId)) return true;

    // If toolCall was asked in a previous message and a newer user message exists, it was bypassed
    if (toolCall) {
      let foundThisMsg = false;
      for (const m of agentMessages) {
        if (!foundThisMsg) {
          if (Array.isArray(m.toolCalls) && m.toolCalls.some((tc) => tc.id === toolCall.id)) {
            foundThisMsg = true;
          }
        } else {
          if (m.role === 'user') return true;
        }
      }
    }
    return false;
  }, [toolCallQuestion?.id, fallback?.id, toolCall, agentMessages]);

  const active = useMemo(() => {
    if (isUnanswered) return null;
    if (toolCallQuestion) {
      if (wasQuestionAnswered(toolCallQuestion.id) || toolCall?.status === 'completed' || toolCall?.result) {
        return null;
      }
      return toolCallQuestion;
    }
    if (pendingAgentQuestion) return pendingAgentQuestion;
    if (fallback && !wasQuestionAnswered(fallback.id)) return fallback;
    return null;
  }, [isUnanswered, toolCallQuestion, toolCall?.status, toolCall?.result, pendingAgentQuestion, fallback]);

  // Derive resolved state from toolCall completion or local state
  const effectiveResolved = useMemo<ResolvedQuestion | null>(() => {
    if (resolved) return resolved;
    if (toolCallQuestion && (wasQuestionAnswered(toolCallQuestion.id) || toolCall?.status === 'completed' || toolCall?.result)) {
      const rawResult = toolCall?.result as any;
      const ans =
        typeof toolCall?.result === 'string'
          ? toolCall.result
          : typeof rawResult?.answer === 'string'
          ? rawResult.answer
          : 'Answer submitted';
      return {
        id: toolCallQuestion.id,
        question: toolCallQuestion.question,
        answer: ans,
        delivered: true,
      };
    }
    return null;
  }, [resolved, toolCallQuestion, toolCall?.status, toolCall?.result]);

  // A brand-new question resets any previously resolved record
  useEffect(() => {
    if (active) {
      setResolved(null);
      setFreeText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  if (!active && !effectiveResolved && !isUnanswered) return null;

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

  // Unanswered state: compact inline record tagged as Unanswered
  if (isUnanswered && (toolCallQuestion || fallback)) {
    const unansweredQ = toolCallQuestion || fallback;
    return (
      <div
        className="rounded-xl border border-obsidian-hairline bg-obsidian-surface1 p-3 space-y-1.5 text-xs select-text"
        aria-label="Unanswered question"
      >
        <div className="flex items-start gap-2">
          <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Astra asked</span>
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wide rounded bg-obsidian-surface2 text-obsidian-inkMuted border border-obsidian-border">
                Unanswered
              </span>
            </div>
            <p className="text-obsidian-inkSecondary leading-relaxed break-words line-clamp-3">
              {unansweredQ?.question}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Resolved state: compact inline record of the exchange
  if (!active && effectiveResolved) {
    return (
      <div
        className="rounded-xl border border-obsidian-hairline bg-obsidian-surface1 p-3 space-y-2 text-xs"
        aria-label="Answered question"
      >
        <div className="flex items-start gap-2">
          <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Question</span>
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wide rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Answered
              </span>
            </div>
            <p className="text-obsidian-inkSecondary leading-relaxed break-words">{effectiveResolved.question}</p>
          </div>
        </div>
        <div className="flex items-start gap-2 pl-[22px]">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Your answer</div>
            <p className="text-obsidian-inkPrimary leading-relaxed break-words">{effectiveResolved.answer}</p>
            {!effectiveResolved.delivered && (
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
      className="rounded-xl border border-obsidian-border bg-obsidian-surface2 p-4 space-y-3 shadow-elevation"
      role="group"
      aria-label="The agent asked a question"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Astra asks</span>
      </div>
      <div className="flex items-start gap-2.5">
        <HelpCircle className="w-5 h-5 mt-0.5 shrink-0 text-obsidian-inkSecondary" aria-hidden="true" />
        <p className="text-sm font-semibold text-obsidian-inkPrimary leading-relaxed break-words">{q.question}</p>
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
              className="px-3.5 py-2 rounded-lg border border-obsidian-border bg-obsidian-surface2 hover:bg-obsidian-surface3 hover:border-obsidian-borderBright text-[13px] font-medium text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-obsidian-borderBright"
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
            className="flex-1 min-w-0 bg-obsidian-surface2 px-3 py-2 rounded-lg border border-obsidian-border focus:border-obsidian-borderBright text-[13px] text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none transition-colors duration-150"
          />
          <button
            type="submit"
            disabled={!canSendFreeText}
            aria-label="Send answer"
            title="Send answer"
            className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-obsidian-borderBright ${
              canSendFreeText
                ? 'bg-obsidian-accent text-obsidian-inkInverse hover:bg-obsidian-accentHover'
                // Was `text-zinc-600`: a fixed mid-grey that sat at ~1.6:1
                // against --bg-surface-2 in dark theme, making the disabled
                // send button effectively invisible.
                : 'bg-obsidian-surface2 text-obsidian-inkMuted cursor-not-allowed'
            }`}
          >
            <CornerDownLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>
      )}
    </div>
  );
};
