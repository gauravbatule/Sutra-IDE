import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  Mic,
  Plus,
  BrainCircuit,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Compass,
  Loader2,
  Paperclip,
  ShieldCheck,
  Zap,
  Rocket,
  X,
  History,
  ListPlus,
  Trash2,
  MessageSquare,
  Clock,
  FileCode2,
  Settings,
  Sparkles,
  Copy,
  Check,
  FileText,
  MousePointerClick,
  Paintbrush,
  ChevronRight,
  FileCode,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { deriveAgentStatus } from '../../utils/agentStatus.js';
import {
  appendUserMessageDeduped,
  clearConnectionLost,
  registerQuestionSender,
  reportConnectionLost,
  useConnectionLost,
  markQuestionUnanswered,
  wasQuestionAnswered,
} from '../../utils/agentSocket.js';
import { AskUserCard, findAskUserAnchorId, findAskUserFallback } from '../Common/AskUserCard.js';
import { AgentStatusBanner } from '../Common/AgentStatusBanner.js';
import { ConnectionLostBanner } from '../Common/ConnectionLostBanner.js';
import { MediaInlineCard, resolveInlineMedia } from '../Common/MediaInlineCard.js';
import { ToolCard } from './ToolCard.js';
import { ApprovalCard } from './ApprovalCard.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { MentionAutocomplete, MentionItem } from './MentionAutocomplete.js';
import { ModelSelectorDropdown } from '../Common/ModelSelectorDropdown.js';
import { McpStatusPill } from '../Manager/ManagerComposer.js';
import { useVoiceInput } from '../../hooks/useVoiceInput.js';
import { ToolCallPayload, SutraAgentMessage } from '../../types/ide.js';
import { ManagerDiffView, collectChangedFiles } from '../Manager/ManagerDiffView.js';
import { ArtifactCard } from './ArtifactCard.js';
import { useTheme } from '../../hooks/useTheme.js';

const ARTIFACT_TOOLS = new Set([
  'create_artifact',
  'update_artifact',
  'create_markdown_doc',
  'write_documentation',
  'create_findings_report',
  'record_findings',
  'create_audit_report',
  'create_implementation_plan',
]);

/**
 * Picks the inline renderer for a tool call:
 * - ask_user becomes an interactive question card
 * - artifact tools become rich interactive Artifact cards
 * - completed media tools become compact media preview cards
 * - everything else stays a standard ToolCard
 */
const renderToolElement = (elements: React.ReactNode[], toolCall: ToolCallPayload): void => {
  if (toolCall.tool === 'ask_user') {
    elements.push(<AskUserCard key={toolCall.id} toolCall={toolCall} />);
    return;
  }
  if (ARTIFACT_TOOLS.has(toolCall.tool)) {
    elements.push(<ArtifactCard key={toolCall.id} toolCall={toolCall} />);
    return;
  }
  const inlineMedia = resolveInlineMedia(toolCall);
  if (inlineMedia) {
    elements.push(<MediaInlineCard key={toolCall.id} media={inlineMedia} />);
  } else {
    elements.push(<ToolCard key={toolCall.id} toolCall={toolCall} />);
  }
};

/** How long the thinking trace can stay unchanged before the UI starts to
 *  surface a "still working" hint. Tuned to be longer than the typical gap
 *  between model chunks (~2-3s) so we don't flicker the indicator during a
 *  normal long thinking phase, but short enough that an actual hang is
 *  surfaced within a user-noticeable window. */
const THINKING_STALL_MS = 5000;

/** The five reasoning phases the agent can declare with `[phase: <name>]`
 *  in its thinking block. The model is free to skip ahead (e.g. trivial
 *  fixes go straight from thinking to acting), but the strip in the UI
 *  always shows the canonical five so the user can see progress. */
export type ReasoningPhase = 'thinking' | 'planning' | 'acting' | 'verifying' | 'self_correct' | 'branching' | 'done';

/** Collapsible inline reasoning trace attached to the assistant message turn.
 *  Uses a heartbeat so a long thinking phase never reads as frozen between
 *  model chunks: the three trailing dots keep cycling and a "still working"
 *  hint appears if the text has not advanced in a few seconds.
 *
 *  - `phase` is the current phase (thinking/planning/acting/verifying/done).
 *    Either the model emitted a `[phase: <name>]` tag (preferred) or the
 *    manager-shell detector inferred it; either way, the user sees the
 *    current phase as the first thing in the header.
 *  - `phasesCompleted` lists phases the model has tagged as done in this
 *    turn so the phase strip can show a check on each.
 *  - `goals` is an optional list of goal strings (taken from the most
 *    recent task plan) so the user sees the run's goals next to the trace.
 *  - `onSkipToModel` flips the per-turn "send trace to model" toggle.
 */
export const ThinkingBlock: React.FC<{
  thinking?: string;
  defaultExpanded?: boolean;
  live?: boolean;
  phase?: ReasoningPhase;
  phasesCompleted?: ReadonlyArray<ReasoningPhase>;
  goals?: ReadonlyArray<string>;
  sendToModel?: boolean;
  onSkipToModel?: (next: boolean) => void;
}> = ({
  thinking,
  defaultExpanded = false,
  live = false,
  phase = 'thinking',
  phasesCompleted = [],
  goals = [],
  sendToModel = true,
  onSkipToModel,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const text = (thinking || '').trim();
  const lastChangeRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const lastTextRef = useRef<string>(text);
  const [stalled, setStalled] = useState(false);
  const [, force] = useState(0);

  // Reset the stall timer whenever the trace text actually changes; if it
  // doesn't change for STALL_MS while `live` is true, flip into "still
  // working" state and animate the indicator. This is what makes long
  // thinking phases feel alive even on quiet models.
  useEffect(() => {
    if (text !== lastTextRef.current) {
      lastTextRef.current = text;
      lastChangeRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (stalled) setStalled(false);
    }
    if (!live) {
      if (stalled) setStalled(false);
      return;
    }
    const id = window.setInterval(() => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const sinceChange = now - lastChangeRef.current;
      const isStalled = sinceChange > THINKING_STALL_MS;
      if (isStalled !== stalled) setStalled(isStalled);
      // Re-render once a second so the "x s" countdown stays fresh even
      // without a state change in the trace.
      force((n) => (n + 1) % 1000000);
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, live, stalled]);

  if (!text) return null;

  const sinceChangeSec = Math.max(
    0,
    Math.floor(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - lastChangeRef.current) / 1000)
  );

  return (
    <div className="rounded-md bg-obsidian-surface1 border border-obsidian-hairline text-xs overflow-hidden mb-2.5 transition-colors duration-300">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between cursor-pointer text-obsidian-inkSecondary font-mono text-[11px] select-none h-7 px-2.5 text-left hover:bg-obsidian-surface1 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <BrainCircuit className={`w-3.5 h-3.5 shrink-0 ${live ? 'text-obsidian-inkPrimary' : 'text-obsidian-inkMuted'}`} />
          <span className="shrink-0 font-medium">{live ? 'Thinking…' : 'Thought Process'}</span>

          {live && (
            <Loader2 className="w-3 h-3 animate-spin text-obsidian-inkSecondary ml-1 shrink-0" aria-hidden="true" />
          )}
          {live && stalled && (
            <span className="text-[10px] font-mono text-obsidian-inkMuted ml-1">
              · still working {sinceChangeSec > 0 ? `· ${sinceChangeSec}s` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onSkipToModel && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onSkipToModel(!sendToModel);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onSkipToModel(!sendToModel);
                }
              }}
              title={sendToModel ? 'Skip this trace from the next model call (manual skip)' : 'Send this trace to the next model call'}
              aria-pressed={sendToModel}
              className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border cursor-pointer font-mono ${
                sendToModel
                  ? 'border-obsidian-hairline text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                  : 'border-obsidian-inkPrimary text-obsidian-inkPrimary bg-obsidian-surface3'
              }`}
            >
              {sendToModel ? 'skip' : 'in context'}
            </span>
          )}
          <span className="text-obsidian-inkMuted text-[10px]">{expanded ? 'Hide' : 'Show reasoning'}</span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </div>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2">
          {goals.length > 0 && (
            <div className="rounded border border-obsidian-hairline bg-obsidian-canvas px-2.5 py-1.5 text-[10px] font-mono">
              <div className="text-[9px] uppercase tracking-wider text-obsidian-inkMuted mb-0.5">Goals this turn</div>
              <ul className="space-y-0.5 text-obsidian-inkSecondary">
                {goals.map((g, i) => (
                  <li key={`${g}-${i}`} className="flex items-start gap-1.5">
                    <span className="text-obsidian-inkFaint shrink-0">{i + 1}.</span>
                    <span className="min-w-0 break-words">{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="font-mono text-[10px] text-obsidian-inkMuted whitespace-pre-wrap pl-3 border-l border-obsidian-border mx-0.5 my-1 max-h-56 overflow-y-auto leading-relaxed">
            {text}
          </div>
        </div>
      )}
    </div>
  );
};

/** Lightweight phase detector mirroring the one in ManagerShell. Honours
 *  an explicit `[phase: <name>]` tag emitted by the model and falls back
 *  to a small keyword scan. Kept local to this file because importing
 *  from ManagerShell would create a one-way dependency the harness
 *  audit flags as a smell. */
const PHASE_TAG_RE = /\[phase:\s*(thinking|planning|acting|verifying|self[-_]correct|branching|done)\]/i;
const detectThinkingPhase = (trace: string): ReasoningPhase => {
  const tag = trace.match(PHASE_TAG_RE);
  if (tag) {
    const raw = tag[1].toLowerCase().replace(/[-_]/g, '_');
    if (raw === 'self_correct' || raw === 'selfcorrect') return 'self_correct';
    if (raw === 'thinking' || raw === 'planning' || raw === 'acting' || raw === 'verifying' || raw === 'branching' || raw === 'done') {
      return raw;
    }
  }
  const recent = trace.split(/\n+/).slice(-4).join(' ').toLowerCase();
  if (/\b(verif|check|test|run|build)\b/.test(recent) && /\b(again|retry|re-?run)\b/.test(recent)) return 'self_correct';
  if (/\b(branch|alternative|instead|or\b|maybe)\b/.test(recent)) return 'branching';
  if (/\b(verif|check|confirm|test|build|run)\b/.test(recent)) return 'verifying';
  if (/\b(plan|outline|step\s*1|approach)\b/.test(recent)) return 'planning';
  return 'thinking';
};

/** Renders assistant text chunks, reasoning traces, and executed tool cards in exact chronological sequence */
const SequentialMessageRenderer: React.FC<{ content?: string; toolCalls?: ToolCallPayload[]; thinking?: string; live?: boolean }> = ({
  content = '',
  toolCalls = [],
  thinking = '',
  live = false,
}) => {
  const safeTools = Array.isArray(toolCalls) ? toolCalls : [];
  const renderedToolIds = new Set<string>();
  const toolMap = new Map(safeTools.map((tc) => [tc.id, tc]));

  // Sanitize text: strip raw XML delimiters, orphaned tool tags, round execution logs, and think blocks
  const sanitizedContent = (typeof content === 'string' ? content : '')
    .replace(/>\s*⚙️\s*\*\[Round\s*\d+\]\s*Executing[\s\S]*?\*\s*\n*/gi, '')
    .replace(/Stage\s*\[[^\]]+\]:\s*Executing\s*\d+\s*tool\(s\)[\s\S]*?(?:\n|$)/gi, '')
    .replace(/\[Auto-continuation\]:[\s\S]*?(?:\n|$)/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function=[a-zA-Z0-9_]+>[\s\S]*?<\/function>/gi, '')
    .replace(/<parameter=[a-zA-Z0-9_]+>[\s\S]*?<\/parameter>/gi, '')
    .replace(/<\/function>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<\/?(?:tool_call|function|parameter|think|thought|function_call)[^>]*>/gi, '')
    .replace(/```json\s*\{[\s\S]*?"(?:name|tool)"\s*:[\s\S]*?\}\s*```/gi, '')
    .replace(/<!--\s*GOAL_COMPLETE\s*-->|\[GOAL_COMPLETE\]/gi, '')
    .replace(/\*?\*?Autonomous Goal Execution Concluded\*?\*?:\s*All allocated execution steps completed\.?/gi, '')
    .replace(/\s*\*\(Stopped a repeating action loop[^\)]*\)\*\s*/gi, '')
    .replace(/\s*\*\(Generation stopped\.[^)]*\)\*\s*/gi, '')
    .replace(/\[(?:phase|action|status|step):\s*[^\]]+\]\s*/gi, '')
    .replace(/\[phase[-_]?(?:planning|thinking|acting|executing|verifying|done|self-correct|branching)\]\s*/gi, '')
    .replace(/\[(?:CONTINUE|IMMEDIATE ACTION|AUTONOMOUS \/GOAL CONTINUATION)[^\]]*\]:?\s*/gi, '')
    .trim();

  // Split content by tool markers <!-- TOOL_CALL:id -->
  const parts = sanitizedContent.split(/<!-- TOOL_CALL:(.*?) -->/g);
  const elements: React.ReactNode[] = [];

  // Prepend inline reasoning trace if present (only meaningful for the
  // currently-streaming assistant message; for finished turns the trace is
  // already persisted on the message itself and we want it stable, not live).
  if (thinking && thinking.trim()) {
    // Phase strip needs both the current phase and a list of phases the
    // model has *already* completed. We mine the trace for `[phase: X]`
    // markers and dedupe in order of first appearance so the strip fills
    // left-to-right as the run progresses. `done` always wins at the end
    // so the user sees the run finish.
    const tagMatches = thinking.match(/\[phase:\s*([a-z_-]+)\]/gi) || [];
    const seen = new Set<ReasoningPhase>();
    const completed: ReasoningPhase[] = [];
    for (const m of tagMatches) {
      const t = m.replace(/\[phase:\s*|\]/gi, '').toLowerCase().replace(/[-]/g, '_');
      const normalized = t === 'selfcorrect' ? 'self_correct' : (t as ReasoningPhase);
      if (
        ['thinking', 'planning', 'acting', 'verifying', 'branching', 'self_correct', 'done'].includes(normalized) &&
        !seen.has(normalized)
      ) {
        seen.add(normalized);
        completed.push(normalized);
      }
    }
    if (completed.includes('done')) {
      // No need to re-detect "current" — the strip picks "done" as the
      // active state and the user sees the full chain lit.
    }
    const currentPhase = live ? detectThinkingPhase(thinking) : 'thinking';
    elements.push(
      <ThinkingBlock
        key="thinking-trace"
        thinking={thinking}
        live={live}
        phase={currentPhase}
        phasesCompleted={completed}
      />
    );
  }

  for (let i = 0; i < parts.length; i++) {
    // Even indices are text chunks
    if (i % 2 === 0) {
      if (parts[i] && parts[i].trim()) {
        elements.push(<MarkdownRenderer key={`text-${i}`} content={parts[i]} />);
      }
    } else {
      // Odd indices are tool IDs
      const toolId = parts[i].trim();
      const toolCall = toolMap.get(toolId);
      if (toolCall) {
        renderedToolIds.add(toolId);
        renderToolElement(elements, toolCall);
      }
    }
  }

  // Any tool calls that didn't have an inline marker (legacy or fallback)
  const remainingTools = safeTools.filter((tc) => !renderedToolIds.has(tc.id));
  for (const tc of remainingTools) {
    renderToolElement(elements, tc);
  }

  if (elements.length === 0) {
    if (sanitizedContent) {
      return <MarkdownRenderer content={sanitizedContent} />;
    }
    return null;
  }

  return <div className="space-y-2.5">{elements}</div>;
};

/** Removes injected inline tool markers so internal bookkeeping never leaks back into the model history */
const stripToolCallMarkers = (text: string): string => text.replace(/<!--\s*TOOL_CALL:[^>]*-->/g, '');

/** Muted row inserted when a provider retry hands the answer to another model attempt */
const CONTINUATION_DIVIDER = '*— continued by another model —*';

/** Strips continuation dividers so replayed model history never sees UI bookkeeping */
const stripContinuationDividers = (text: string): string => text.split(CONTINUATION_DIVIDER).join('');

/** Cleans stored user text before it is resent (retry): drops steering prefixes and image placeholders */
const sanitizeResendText = (raw: string): string =>
  raw
    .replace(/^(?:\s*\[STEERING\]:\s*)+/i, '')
    .replace(/\[Image Attached\]/gi, '')
    .trim();

/** Fresh conversation opener shared by new chats and empty sessions */
const makeWelcomeThread = (): SutraAgentMessage[] => [
  {
    id: 'msg-welcome',
    role: 'assistant',
    content: `I'm Astra — your autonomous software engineering agent. I can read and write files, run commands, and build entire projects. What would you like to build?`,
    timestamp: Date.now(),
  },
];

/** Minimal shape of a session record returned by /api/chat/sessions */
interface ChatSessionSummary {
  id: string;
  title?: string;
  message_count?: number;
  updated_at?: string;
}

export interface ElementContextInfo {
  tagName: string;
  selector: string;
  textContent: string;
  classList: string[];
  attributes?: Record<string, string>;
  pageUrl?: string;
  outerHTML?: string;
  sourceMatches?: Array<{ file: string; line: number; snippet: string; reason?: string }>;
  cssMatches?: Array<{ file: string; line: number; selector: string; rule: string }>;
}

/** Outgoing chat message extended with attached image data URLs and structured element context */
type ChatMessage = SutraAgentMessage & {
  images?: string[];
  elementContext?: ElementContextInfo;
};

/** Parses legacy raw markdown attached context (e.g. from history) into clean user prompt and structured context */
function parseLegacyElementContext(rawContent: string): { userPrompt: string; elementContext: ElementContextInfo | null } {
  if (!rawContent || (!rawContent.includes('[Attached File: element-') && !rawContent.includes('<!-- Target Element Selector:'))) {
    return { userPrompt: rawContent, elementContext: null };
  }

  const promptPart = rawContent.split('[Attached File:')[0].trim();
  const selectorMatch = rawContent.match(/<!-- Target Element Selector:\s*([^\n]+?)\s*-->/);
  const selector = selectorMatch ? selectorMatch[1].trim() : '';

  const htmlMatch = rawContent.match(/<([a-zA-Z0-9_-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9_-]+)([^>]*)\/?>/);
  const tagName = htmlMatch ? (htmlMatch[1] || htmlMatch[4]).toLowerCase() : 'element';
  const tagAttrs = htmlMatch ? (htmlMatch[2] || htmlMatch[5] || '') : '';
  const textContent = htmlMatch && htmlMatch[3] ? htmlMatch[3].replace(/<[^>]+>/g, '').trim() : '';

  const classMatch = tagAttrs.match(/class=["']([^"']+)["']/);
  const classList = classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [];

  const elementContext: ElementContextInfo = {
    tagName,
    selector: selector || `<${tagName}>`,
    textContent,
    classList,
    outerHTML: htmlMatch ? htmlMatch[0] : '',
    pageUrl: '/workspace/index.html',
  };

  return {
    userPrompt: promptPart || `Modify <${tagName}>`,
    elementContext,
  };
}

/** Sleek, interactive component card for inspected UI elements */
const ElementContextCard: React.FC<{ element: ElementContextInfo }> = ({ element }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-2.5 p-2.5 rounded-xl bg-obsidian-surface2 border border-obsidian-border text-left font-sans select-text shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="p-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
            <MousePointerClick className="w-3 h-3" />
          </span>
          <span className="font-mono text-xs font-semibold text-obsidian-inkPrimary truncate">
            &lt;{element.tagName}&gt; {element.textContent ? `"${element.textContent}"` : ''}
          </span>
        </div>
        {element.pageUrl && (
          <span className="text-[10px] font-mono text-obsidian-inkMuted shrink-0">
            {element.pageUrl.replace('/workspace/', '')}
          </span>
        )}
      </div>

      {/* Class chips */}
      {element.classList && element.classList.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 items-center">
          {element.classList.slice(0, 4).map((cls) => (
            <span key={cls} className="px-1.5 py-0.5 rounded bg-obsidian-surface3 border border-obsidian-hairline text-[10px] font-mono text-obsidian-inkSecondary">
              .{cls}
            </span>
          ))}
          {element.classList.length > 4 && (
            <span className="text-[9px] font-mono text-obsidian-inkMuted">
              +{element.classList.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Source Location Badges (The "where is it" information!) */}
      {((element.sourceMatches && element.sourceMatches.length > 0) || (element.cssMatches && element.cssMatches.length > 0)) && (
        <div className="mt-2 pt-2 border-t border-obsidian-hairline flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] font-mono text-obsidian-inkMuted font-medium">Located in:</span>
          {element.sourceMatches?.map((sm, i) => (
            <span
              key={`src-${i}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono font-medium shadow-xs"
              title={`${sm.file}:${sm.line} — ${sm.reason || 'Source code match'}`}
            >
              <FileCode className="w-3 h-3 shrink-0" />
              <span>{sm.file}:{sm.line}</span>
            </span>
          ))}
          {element.cssMatches?.map((cm, i) => (
            <span
              key={`css-${i}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-mono font-medium shadow-xs"
              title={`${cm.file}:${cm.line} — Rule ${cm.selector}`}
            >
              <Paintbrush className="w-3 h-3 shrink-0" />
              <span>{cm.file}:{cm.line}</span>
            </span>
          ))}
        </div>
      )}

      {/* Expandable Element Code & DOM Details */}
      <div className="mt-2 pt-1">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[10px] font-mono text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer select-none"
        >
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span>{isExpanded ? 'Hide element details' : 'View target element snippet'}</span>
        </button>
        {isExpanded && (
          <div className="mt-1.5 p-2 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline font-mono text-[10px] text-obsidian-inkSecondary overflow-x-auto space-y-1">
            <div className="text-[9px] text-obsidian-inkMuted select-all">
              <span className="text-zinc-500 font-semibold">Selector:</span> {element.selector}
            </div>
            {element.outerHTML && (
              <pre className="text-obsidian-inkPrimary whitespace-pre-wrap break-all mt-1">
                {element.outerHTML}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** OpenAI-style multimodal content part for image-bearing user messages */
type MessageContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Serialized conversation entry sent over the agent websocket */
interface WireMessage {
  role: string;
  content: string | MessageContentPart[] | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/** Scroll distance (px) under which the feed is considered pinned to the bottom */
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export const AgentChat: React.FC = () => {
  const { theme } = useTheme();
  const pendingAgentQuestion = useIDEStore((s) => s.pendingAgentQuestion);
  const [connectionLost] = useConnectionLost();
  const {
    agentMessages,
    addAgentMessage,
    updateLastMessageContent,
    addToolCallsToLastMessage,
    updateToolCallResult,
    updateToolCallError,
    updateAgentThinking,
    appendAgentThinking,
    currentAgentThinking,
    isAgentGenerating,
    setIsAgentGenerating,
    activeModel,
    permissionLevel,
    setPermissionLevel,
    pendingApprovals,
    setPendingApprovals,
    harnessMode,
    setHarnessMode,
    setSkillsModalOpen,
    toggleAgentPanel,
    composerDraft,
    setComposerDraft,
  } = useIDEStore();

  const [inputPrompt, setInputPrompt] = useState('');

  useEffect(() => {
    if (composerDraft) {
      setInputPrompt(composerDraft);
      setComposerDraft('');
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
          textareaRef.current.focus();
        }
      });
    }
  }, [composerDraft, setComposerDraft]);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [showAvoModal, setShowAvoModal] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const agentStatus = deriveAgentStatus({
    isGenerating: isAgentGenerating,
    isPaused,
    hasPendingQuestion: Boolean(pendingAgentQuestion),
    hasPendingApprovals: pendingApprovals.length > 0,
    harnessMode,
  });
  // Prompt queue: messages staged while a run is active. They dispatch
  // automatically, in order, the moment the current run finishes.
  const [queuedPrompts, setQueuedPrompts] = useState<{ id: string; text: string }[]>([]);
  const queuedPromptsRef = useRef<{ id: string; text: string }[]>([]);
  const updateQueue = (next: { id: string; text: string }[]) => {
    queuedPromptsRef.current = next;
    setQueuedPrompts(next);
  };
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // Keyboard equivalent for the click-catcher backdrop: Escape dismisses the
  // history drawer, so it is closable without a mouse.
  useEffect(() => {
    if (!isHistoryOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsHistoryOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isHistoryOpen]);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => `session-${Date.now()}`);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Changed-files summary for the IDE Review row (same derivation as Manager mode)
  const changedFiles = useMemo(() => collectChangedFiles(agentMessages), [agentMessages]);
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const agentMessagesRef = useRef(agentMessages);
  const currentSessionIdRef = useRef(currentSessionId);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titledSessionsRef = useRef<Set<string>>(new Set());
  const streamDoneRef = useRef<boolean>(false);
  const intentionalCloseRef = useRef<boolean>(false);
  // Mirrors "is the viewport pinned near the bottom" without triggering effect churn on every scroll tick
  const isNearBottomRef = useRef<boolean>(true);
  // ask_user bookkeeping: questions seen over the socket and answers already echoed into the transcript
  const askQuestionsRef = useRef<Map<string, string>>(new Map());
  const answeredEchoIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    agentMessagesRef.current = agentMessages;
  }, [agentMessages]);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (isAgentGenerating) {
      setElapsedSeconds(0);
      const start = Date.now();
      timer = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - start) / 100) / 10);
      }, 100);
    }
    return () => clearInterval(timer);
  }, [isAgentGenerating]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/sessions');
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch {
      // Session history is best-effort; keep the current list on failure.
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleNewChat = () => {
    const newId = `session-${Date.now()}`;
    setCurrentSessionId(newId);
    titledSessionsRef.current.delete(newId);
    updateQueue([]); // a fresh session starts with a clean queue
    useIDEStore.setState({ agentMessages: makeWelcomeThread() });
    fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId, title: 'New Autonomous Task' }),
    }).then(fetchSessions).catch(() => {});
  };

  const handleSelectSession = async (sId: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sId}`);
      const data = await res.json();
      const fetched = (Array.isArray(data.messages) ? data.messages : []) as ChatMessage[];
      if (fetched.length === 0) {
        // Empty session: start a fresh thread instead of carrying over messages from the previous one
        useIDEStore.setState({ agentMessages: makeWelcomeThread() });
      } else {
        useIDEStore.setState({ agentMessages: fetched });
      }
      setCurrentSessionId(sId);
      updateQueue([]); // queued prompts belong to the session they were typed in
      setIsHistoryOpen(false);
      // Loaded sessions already have a server-side title; never overwrite it on sync
      titledSessionsRef.current.add(sId);
    } catch {
      // Loading a session is best-effort; keep the current thread on failure.
    }
  };

  const handleDeleteSession = async (sId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/chat/sessions/${sId}`, { method: 'DELETE' });
      fetchSessions();
      if (sId === currentSessionId) {
        handleNewChat();
      }
    } catch {
      // Deleting a session is best-effort; the list refresh below tolerates failure.
    }
  };

  // Pushes the full conversation to the server; called when the stream goes idle or ends
  const flushSessionSync = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    const msgs = agentMessagesRef.current;
    const sessionId = currentSessionIdRef.current;
    if (msgs.length <= 1 || !sessionId) return;

    // Only send a title on the first sync of a session; null lets the server keep its existing one
    let title: string | null = null;
    if (!titledSessionsRef.current.has(sessionId)) {
      const meaningfulUserMsg = msgs.find(
        (m) => m.role === 'user' && typeof m.content === 'string' && /[a-zA-Z0-9]{2,}/.test(m.content)
      ) || msgs.find((m) => m.role === 'user');
      const rawText = meaningfulUserMsg ? sanitizeResendText(meaningfulUserMsg.content).split('\n')[0].trim() : '';
      const cleanTitle = rawText.replace(/^[^a-zA-Z0-9]+$/, '').trim() || rawText;
      title = (cleanTitle.slice(0, 45).trim()) || 'Autonomous Mission';
      titledSessionsRef.current.add(sessionId);
    }

    fetch(`/api/chat/sessions/${sessionId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, messages: msgs }),
    })
      .then(() => fetchSessions())
      .catch(() => {});
  }, [fetchSessions]);

  useEffect(() => {
    if (agentMessages.length <= 1 || !currentSessionId) return;
    // Debounce: wait for a 1.5s idle gap so streaming tokens do not trigger a sync per token
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(flushSessionSync, 1500);
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [agentMessages, currentSessionId, flushSessionSync]);

  // Unmount: flush any pending sync, close the live socket, and release the ask_user sender slot
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      flushSessionSync();
      registerQuestionSender(null);
      const sock = socketRef.current;
      socketRef.current = null;
      if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) {
        sock.close();
      }
    };
  }, [flushSessionSync]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;
    setUserScrolledUp(!isNearBottomRef.current);
  };

  // Auto-scroll only while the user is already near the bottom; never yank the viewport mid-read.
  // Instant scrolling avoids smooth-scroll lag fighting rapid stream updates.
  useEffect(() => {
    if (!isNearBottomRef.current) return;
    scrollRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [agentMessages, currentAgentThinking]);

  /**
   * ask_user sender bridge: forwards the serialized agent_answer packet over THIS
   * socket and echoes the resolved Q&A into the local transcript exactly once.
   * Runs synchronously at submit time so it works no matter whether the shared
   * card clears the store slice before or after dispatching.
   */
  const sendAgentAnswerRaw = useCallback((raw: string): boolean => {
    const sock = socketRef.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) return false;
    sock.send(raw);

    let answerId = '';
    let answerText = '';
    try {
      const parsed = JSON.parse(raw) as { type?: string; id?: unknown; answer?: unknown };
      if (parsed && parsed.type === 'agent_answer') {
        answerId = String(parsed.id ?? '');
        answerText = String(parsed.answer ?? '');
      }
    } catch {
      return true; // Opaque payload was forwarded successfully; nothing to echo
    }
    if (!answerId || answeredEchoIdsRef.current.has(answerId)) return true;
    answeredEchoIdsRef.current.add(answerId);

    const store = useIDEStore.getState();
    const pending = store.pendingAgentQuestion;
    const knownQuestion = askQuestionsRef.current.get(answerId) ?? '';
    const questionText = pending && pending.id === answerId ? pending.question : knownQuestion;

    if (pending && pending.id === answerId) {
      store.setPendingAgentQuestion(null);
    }
    askQuestionsRef.current.delete(answerId);

    store.addAgentMessage({
      id: `msg-answer-${Date.now()}`,
      role: 'user',
      content: `Question: ${questionText}\nYour answer: ${answerText}`,
      timestamp: Date.now(),
    });

    // Keep the streaming placeholder last so subsequent deltas land in the right bubble
    if (useIDEStore.getState().isAgentGenerating) {
      useIDEStore.getState().addAgentMessage({
        id: `msg-asst-${Date.now()}`,
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: Date.now() + 1,
        modelUsed: useIDEStore.getState().activeModel?.name || 'SUTRA Multi-Model Engine',
      });
    }
    flushSessionSync();
    return true;
  }, [flushSessionSync]);

  // Handle image and file attachment selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const content = typeof reader.result === 'string' ? reader.result : '';
        setAttachedFile({ name: file.name, content });
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  // Clipboard paste of a screenshot attaches it like the file picker
  const handleImagePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAttachedImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Jitter-free autosize for the textarea
  const autosizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const minHeight = 44;
    const maxHeight = 160;
    const target = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${target}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  // Handle @mention typing detection
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputPrompt(val);

    const cursor = e.target.selectionStart || val.length;
    const textBefore = val.slice(0, cursor);
    const match = textBefore.match(/@([a-zA-Z0-9_\-.:/]*)$/);
    if (match) {
      setMentionFilter(match[1]);
    } else {
      setMentionFilter(null);
    }
    requestAnimationFrame(autosizeTextarea);
  };

  // Handle @mention selection
  const handleSelectMention = (item: MentionItem) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart || inputPrompt.length;
    const textBefore = inputPrompt.slice(0, cursor);
    const textAfter = inputPrompt.slice(cursor);
    const replaced = textBefore.replace(/@([a-zA-Z0-9_\-.:/]*)$/, `${item.value} `);
    setInputPrompt(replaced + textAfter);
    setMentionFilter(null);
    setTimeout(() => {
      textarea?.focus();
      autosizeTextarea();
    }, 50);
  };

  // --- Voice dictation (#50): Web Speech API through the shared hook ---
  const dictationPrefixRef = useRef('');
  const dictationSuffixRef = useRef('');
  const dictationGotTextRef = useRef(false);
  const dictationStartedAtRef = useRef(0);
  const dictationStoppedOnPurposeRef = useRef(false);
  const [micHint, setMicHint] = useState<string | null>(null);

  /** Joins a dictated chunk with one separating space when neither side has any */
  const joinDictation = (base: string, text: string): string =>
    base && !/\s$/.test(base) && !/^\s/.test(text) ? `${base} ${text}` : `${base}${text}`;

  const voice = useVoiceInput({
    onInterim: (text) => {
      dictationGotTextRef.current = true;
      // Interim hypotheses stream live between the cursor-anchored prefix/suffix
      setInputPrompt(`${joinDictation(dictationPrefixRef.current, text)}${dictationSuffixRef.current}`);
      requestAnimationFrame(autosizeTextarea);
    },
    onFinalChunk: (text) => {
      dictationGotTextRef.current = true;
      dictationPrefixRef.current = joinDictation(dictationPrefixRef.current, text);
      setInputPrompt(`${dictationPrefixRef.current}${dictationSuffixRef.current}`);
      requestAnimationFrame(autosizeTextarea);
    },
  });

  const handleMicClick = () => {
    if (!voice.isSupported) return;
    if (voice.isListening) {
      dictationStoppedOnPurposeRef.current = true;
      voice.stop();
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? inputPrompt.length;
    const end = textarea?.selectionEnd ?? start;
    dictationPrefixRef.current = inputPrompt.slice(0, Math.min(start, end));
    dictationSuffixRef.current = inputPrompt.slice(Math.max(start, end));
    dictationGotTextRef.current = false;
    dictationStoppedOnPurposeRef.current = false;
    setMicHint(null);
    voice.start();
  };

  // Quiet inline hint when the microphone is blocked — never alert().
  // The Permissions API covers Chromium browsers; elsewhere the instant-stop
  // detector below surfaces denial as a generic "check microphone access" row.
  useEffect(() => {
    const MIC_DENIED_HINT = 'Microphone access is blocked — allow it in your browser site settings to dictate.';
    let status: PermissionStatus | null = null;
    let cancelled = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        navigator.permissions
          .query({ name: 'microphone' })
          .then((s) => {
            if (cancelled) return;
            status = s;
            if (s.state === 'denied') setMicHint(MIC_DENIED_HINT);
            s.onchange = () => {
              if (s.state === 'denied') {
                setMicHint(MIC_DENIED_HINT);
                voice.stop();
              } else {
                setMicHint(null);
              }
            };
          })
          .catch(() => undefined);
      }
    } catch {
      // Permissions API unavailable — degrade silently to the stop detector
    }
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recognition that dies within ~2s without producing any transcript almost
  // always means a denied or unavailable microphone — surface it quietly.
  // Intentional stops (mic toggle, Escape) never trigger the hint.
  useEffect(() => {
    if (voice.isListening) {
      dictationStartedAtRef.current = Date.now();
      return;
    }
    if (
      dictationStartedAtRef.current &&
      !dictationGotTextRef.current &&
      !dictationStoppedOnPurposeRef.current &&
      Date.now() - dictationStartedAtRef.current < 2000
    ) {
      setMicHint('Voice input stopped — check microphone access and try again.');
    }
    dictationStartedAtRef.current = 0;
    dictationStoppedOnPurposeRef.current = false;
  }, [voice.isListening]);

  // Escape also stops the shared hook — flag it as intentional before the
  // isListening transition above evaluates.
  useEffect(() => {
    const markIntentionalStop = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dictationStartedAtRef.current) {
        dictationStoppedOnPurposeRef.current = true;
      }
    };
    window.addEventListener('keydown', markIntentionalStop);
    return () => window.removeEventListener('keydown', markIntentionalStop);
  }, []);

  // The hint self-clears so it never turns into permanent UI
  useEffect(() => {
    if (!micHint) return;
    const timer = setTimeout(() => setMicHint(null), 6000);
    return () => clearTimeout(timer);
  }, [micHint]);

  // Single dedup-by-id merge so repeated tool announcements never duplicate approval cards
  const mergePendingApprovals = (incoming: ToolCallPayload[]) => {
    setPendingApprovals((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const tc of incoming) byId.set(tc.id, tc);
      return Array.from(byId.values());
    });
  };

  /**
   * Result/error packets resolve against the newest assistant bubble. When a
   * mid-run steer opened a continuation bubble, calls that were already in
   * flight live one message up — scan back for the owning id and apply the
   * patch immutably so those cards still reach completion instead of spinning
   * forever. Returns without touching state when the id sits in the last
   * message (the store action already covers it).
   */
  const patchToolCallById = (id: string, patch: Partial<ToolCallPayload>): void => {
    const msgs = useIDEStore.getState().agentMessages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.role !== 'assistant' || !msg.toolCalls?.some((tc) => tc.id === id)) continue;
      if (i === msgs.length - 1) return;
      const patched: SutraAgentMessage = {
        ...msg,
        toolCalls: msg.toolCalls.map((tc) => (tc.id === id ? { ...tc, ...patch } : tc)),
      };
      useIDEStore.setState({
        agentMessages: [...msgs.slice(0, i), patched, ...msgs.slice(i + 1)],
      });
      return;
    }
  };

  // Handle Pause / Stop Generation while strictly preserving all progress
  const handlePauseGeneration = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      intentionalCloseRef.current = true;
      socketRef.current.send(
        JSON.stringify({
          channel: 0x05, // AGENT_STREAM
          type: 'cancel',
          timestamp: Date.now(),
        })
      );
      socketRef.current.close();
    }
    socketRef.current = null;
    registerQuestionSender(null);
    setIsAgentGenerating(false);
    setIsPaused(true);
    updateLastMessageContent('\n\n*(Generation paused. All progress, files, and tool outputs preserved. Ready to Resume or Steer.)*');
    flushSessionSync();
  };

  // Main Send & Steer Dispatcher with Duplicate Prevention
  const handleSendOrSteer = async (customText?: string, isSteering = false, customAttachedContext?: string, elementContext?: ElementContextInfo) => {
    if (isSubmittingRef.current) return;
    const textToSend = customText || inputPrompt;
    if (!textToSend.trim() && !attachedImage && !attachedFile && !customAttachedContext && !elementContext) return;

    isSubmittingRef.current = true;
    setTimeout(() => {
      isSubmittingRef.current = false;
    }, 400);

    // A new prompt supersedes any parked ask_user card and marks prior questions unanswered
    const currentPending = useIDEStore.getState().pendingAgentQuestion;
    if (currentPending) {
      markQuestionUnanswered(currentPending.id);
      useIDEStore.getState().setPendingAgentQuestion(null);
    }
    for (const m of agentMessages) {
      if (Array.isArray(m.toolCalls)) {
        for (const tc of m.toolCalls) {
          if (tc.tool === 'ask_user' && tc.id && !wasQuestionAnswered(tc.id)) {
            markQuestionUnanswered(tc.id);
          }
        }
      }
    }

    // Mid-flight input never kills the run. An explicit steer joins the live
    // conversation at the next round boundary (server drains pendingSteers);
    // anything else sent while generating belongs in the queue.
    if (isAgentGenerating) {
      const activeSocket = socketRef.current;
      const midFlightText = textToSend.trim();
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const added = appendUserMessageDeduped({
          id: `msg-${Date.now()}`,
          role: 'user',
          content: midFlightText,
          ...(elementContext ? { elementContext } : {}),
          timestamp: Date.now(),
        });
        if (added && useIDEStore.getState().isAgentGenerating) {
          useIDEStore.getState().addAgentMessage({
            id: `msg-asst-${Date.now()}`,
            role: 'assistant',
            content: '',
            toolCalls: [],
            timestamp: Date.now() + 1,
            modelUsed: useIDEStore.getState().activeModel?.name || 'SUTRA Multi-Model Engine',
          });
        }
        const currentModel = useIDEStore.getState().activeModel;
        activeSocket.send(
          JSON.stringify({
            channel: 0x05,
            type: 'steer',
            payload: {
              text: customAttachedContext ? `${midFlightText}\n\n${customAttachedContext}` : midFlightText,
              model: currentModel?.id,
              provider: currentModel?.provider,
            },
            timestamp: Date.now(),
          })
        );
        if (!customText) setInputPrompt('');
        return;
      }
    }

    let userContent = textToSend.trim();
    const isGoalTriggered = userContent.includes('/goal');
    if (userContent.includes('/goal')) {
      userContent = userContent.replace(/\/goal/g, '').trim() || 'Autonomous mission execution';
    }
    if (attachedFile) {
      userContent = `${userContent}${userContent ? '\n\n' : ''}[Attached File: ${attachedFile.name}]\n${attachedFile.content}`;
      setAttachedFile(null);
    } else if (customAttachedContext && !elementContext) {
      userContent = `${userContent}${userContent ? '\n\n' : ''}${customAttachedContext}`;
    }

    // No `[STEERING]:` prefix on the rendered text — the runtime is the only
    // thing that needs to know the message was a steer, and leaking the tag
    // into the bubble made short instructions look like broken system events.
    const userText = userContent;
    if (!customText) setInputPrompt('');
    const currentImages = attachedImage ? [attachedImage] : [];
    setAttachedImage(null);
    setIsPaused(false);

    // A new run always clears any lingering connection-lost banner
    clearConnectionLost();

    // Add user message through the shared dedupe guard so retry/double-submit
    // never renders the same text twice; screenshots ride along as data URLs.
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userText,
      ...(currentImages.length > 0 ? { images: currentImages } : {}),
      ...(elementContext ? { elementContext } : {}),
      timestamp: Date.now(),
    };
    appendUserMessageDeduped(userMsg);

    // Prepare assistant message (appends seamlessly to preserved history)
    const assistantMsg: SutraAgentMessage = {
      id: `msg-asst-${Date.now()}`,
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: Date.now(),
      modelUsed: activeModel?.name || 'SUTRA Multi-Model Engine',
    };
    addAgentMessage(assistantMsg);

    setIsAgentGenerating(true);
    updateAgentThinking('');

    streamDoneRef.current = false;
    intentionalCloseRef.current = false;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const backendPort = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BACKEND_PORT) || '3001';
      const wsHost = window.location.port === '5173' ? `${window.location.hostname}:${backendPort}` : window.location.host;
      const ws = new WebSocket(`${protocol}//${wsHost}/ws`);
      socketRef.current = ws;
      // This socket becomes the answer transport for any pending agent question
      registerQuestionSender(sendAgentAnswerRaw);

      ws.onopen = () => {
        // Ignore stale sockets superseded by a newer send mid-steer
        if (socketRef.current !== ws) return;

        const serializedMessages: WireMessage[] = [...agentMessages, userMsg]
          .filter((m) => {
            const chatMsg = m as ChatMessage;
            const hasText = Boolean(stripContinuationDividers(stripToolCallMarkers(m.content || '')).trim());
            const hasToolCalls = Boolean(m.toolCalls && m.toolCalls.length > 0);
            const hasImages = Boolean(chatMsg.images && chatMsg.images.length > 0);
            return m.role !== 'tool' && (hasText || hasToolCalls || hasImages);
          })
          .flatMap((m): WireMessage[] => {
            const chatMsg = m as ChatMessage;
            let text = stripContinuationDividers(stripToolCallMarkers(m.content || '')).trim();
            if (chatMsg.elementContext && m.id === userMsg.id && customAttachedContext) {
              text = `${text}\n\n${customAttachedContext}`;
            }

            const entry: WireMessage = { role: m.role, content: text };
            if (chatMsg.images && chatMsg.images.length > 0) {
              entry.content = [
                ...(text ? [{ type: 'text' as const, text }] : []),
                ...chatMsg.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
              ];
            }

            const toolResults: WireMessage[] = [];
            if (m.toolCalls && m.toolCalls.length > 0) {
              entry.tool_calls = m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.tool, arguments: JSON.stringify(tc.params ?? {}) },
              }));
              if (!text) entry.content = null;
              // Every assistant tool_call must be answered by a role:"tool" message or strict providers reject the history
              for (const tc of m.toolCalls) {
                toolResults.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content:
                    tc.result !== undefined && tc.result !== null
                      ? typeof tc.result === 'string'
                        ? tc.result
                        : JSON.stringify(tc.result)
                      : tc.error || 'Completed',
                });
              }
            }

            return [entry, ...toolResults];
          });

        const {
          activeTabPath,
          openTabs,
          cursorPosition,
          selectedText,
          selectionRange,
          visibleRange,
          activeFileDiagnostics
        } = useIDEStore.getState();
        const activeTab = openTabs.find((t) => t.path === activeTabPath);

        const currentActiveModel = useIDEStore.getState().activeModel;
        ws.send(
          JSON.stringify({
            channel: 0x05, // AGENT_STREAM
            type: 'prompt',
            payload: {
              model: currentActiveModel?.id || 'auto',
              provider: currentActiveModel?.provider,
              fullModelId: currentActiveModel ? `${currentActiveModel.provider}:${currentActiveModel.id}` : undefined,
              messages: serializedMessages,
              permissionLevel: permissionLevel,
              harnessMode: useIDEStore.getState().harnessMode,
              isGoalMode: isGoalTriggered,
              chatId: currentSessionIdRef.current || null,
              activeTabPath: activeTabPath || null,
              activeTabContent: activeTab?.content ? activeTab.content.slice(0, 4000) : null,
              openTabPaths: openTabs.map((t) => t.path),
              cursorPosition,
              selectedText: selectedText?.trim() || null,
              selectionRange,
              visibleRange,
              activeFileDiagnostics: activeFileDiagnostics || [],
            },
            timestamp: Date.now(),
          })
        );
      };

      ws.onmessage = (event) => {
        // Ignore packets arriving from a superseded socket during steer/pause transitions
        if (socketRef.current !== ws) return;
        try {
          const packet = JSON.parse(event.data);

          // Shared ask_user contract: surface the question through the store-backed card
          if (packet.type === 'agent_question') {
            const q = (packet.payload || {}) as Record<string, unknown>;
            const qid = String(q.id ?? `question-${Date.now()}`);
            const questionText = String(q.question ?? '');
            askQuestionsRef.current.set(qid, questionText);
            useIDEStore.getState().setPendingAgentQuestion({
              id: qid,
              question: questionText,
              options: Array.isArray(q.options) ? q.options.map(String) : [],
              allowFreeText: q.allowFreeText !== false,
            });
            return;
          }

          // Mid-flight steering receipts — the user bubble was already rendered
          // optimistically; the server just confirms or hands the text back.
          if (packet.channel === 0x05 && packet.type === 'steer_ack') {
            return;
          }
          if (packet.channel === 0x05 && packet.type === 'steer_reject') {
            const rejectText = String(packet.payload?.text || '');
            if (packet.payload?.reason === 'run_ended' && rejectText) {
              // The run wrapped up before this steer could join — queue it so it
              // still runs next, in order, instead of disappearing.
              updateQueue([...queuedPromptsRef.current, { id: `q-${Date.now()}`, text: rejectText }]);
            }
            return;
          }

          // Handle Safe Mode Approval Requests
          if (packet.channel === 0x07 && packet.type === 'request') {
            const toolCall = packet.payload?.toolCall;
            if (toolCall) {
              mergePendingApprovals([toolCall]);
            }
            return;
          }

          if (packet.channel === 0x06 && packet.type === 'result') {
            const { tool, result, id } = packet.payload;
            setPendingApprovals((prev) => prev.filter((p) => p.id !== id));
            useIDEStore.getState().setPendingApprovals((prev: ToolCallPayload[]) => prev.filter((p: ToolCallPayload) => p.id !== id));
            updateToolCallResult(id, tool, result);
            // Steer-displaced calls live in an earlier bubble — route the result home
            patchToolCallById(id, { status: 'completed', result });

            if (['write_file', 'edit_file', 'delete_file', 'rename_path'].includes(tool)) {
              useIDEStore.getState().triggerFileTreeRefresh();
            }

            if (tool === 'verify_http_server' && result && (result.reachable === true || result.status === 200 || result.live === true) && !result.isExternal && !result.error) {
              const port = result.port || 3000;
              if (port !== 8081) {
                const targetUrl = `http://localhost:${port}`;
                useIDEStore.getState().setPreviewUrl(targetUrl);
                if (!useIDEStore.getState().isPreviewOpen) {
                  useIDEStore.getState().togglePreview();
                }
              }
            }

            return;
          }

          if (packet.channel === 0x06 && packet.type === 'error') {
            const { tool, error, id } = packet.payload;
            setPendingApprovals((prev) => prev.filter((p) => p.id !== id));
            useIDEStore.getState().setPendingApprovals((prev: ToolCallPayload[]) => prev.filter((p: ToolCallPayload) => p.id !== id));
            updateToolCallError(id, tool, error);
            patchToolCallById(id, { status: 'failed', error });
            return;
          }

          if (packet.channel === 0x05 && packet.type === 'inline_diff') {
            useIDEStore.getState().setInlineDiff(packet.payload);
            return;
          }

          if (packet.channel === 0x05 && packet.type === 'chunk') {
            const chunk = packet.payload;
            if (chunk.thinking) {
              if (chunk.resetThinking) {
                updateAgentThinking(chunk.thinking, false);
              } else {
                appendAgentThinking(chunk.thinking);
              }
            }
            if (chunk.resetContent) {
              // Seamless provider retry/failover — keep narration clean
            }
            if (chunk.delta) {
              updateLastMessageContent(chunk.delta);
            }
            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              addToolCallsToLastMessage(chunk.toolCalls);
              for (const tc of chunk.toolCalls) {
                updateLastMessageContent(`\n<!-- TOOL_CALL:${tc.id} -->\n`);
              }
              if (permissionLevel === 'strict') {
                const needsApproval = chunk.toolCalls.filter((tc: any) =>
                  ['write_file', 'edit_file', 'delete_file', 'run_command'].includes(tc.tool)
                );
                if (needsApproval.length > 0) {
                  mergePendingApprovals(needsApproval);
                }
              }
            }
            if (chunk.done) {
              streamDoneRef.current = true;
              const thinkingTrace = useIDEStore.getState().currentAgentThinking;
              if (thinkingTrace && thinkingTrace.trim()) {
                const msgs = useIDEStore.getState().agentMessages;
                const lastIdx = msgs.length - 1;
                if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
                  const updated = { ...msgs[lastIdx], thinking: thinkingTrace };
                  useIDEStore.setState({
                    agentMessages: [...msgs.slice(0, lastIdx), updated],
                  });
                }
              }
              setIsAgentGenerating(false);
              setIsPaused(false);
              flushSessionSync();
              const sock = socketRef.current;
              socketRef.current = null;
              sock?.close();
              // The run finished cleanly — dispatch the next queued prompt, in order.
              const nextQueued = queuedPromptsRef.current.shift();
              if (nextQueued) {
                updateQueue([...queuedPromptsRef.current]);
                setTimeout(() => queuedDispatchRef.current?.(nextQueued.text), 150);
              }
            }
          }
        } catch (e) {
          console.warn('Astra agent: failed to process a stream packet.', e);
        }
      };

      ws.onerror = () => {
        // Keep socketRef pointing at this socket so the following close event can report the failure
        if (socketRef.current !== ws) return;
        setIsAgentGenerating(false);
      };

      ws.onclose = () => {
        if (socketRef.current !== ws) return;
        socketRef.current = null;
        registerQuestionSender(null);
        setIsAgentGenerating(false);
        // Abnormal close surfaces the shared transient banner — never appended
        // into message content, so repeated failures cannot stack rows.
        if (!streamDoneRef.current && !intentionalCloseRef.current) {
          reportConnectionLost();
          flushSessionSync();
        }
      };
    } catch {
      reportConnectionLost();
      setIsAgentGenerating(false);
      socketRef.current = null;
      registerQuestionSender(null);
      flushSessionSync();
    }
  };

  const handleRetryLastPrompt = () => {
    const msgs = useIDEStore.getState().agentMessages;
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === 'user');
    if (lastUserMsg && typeof lastUserMsg.content === 'string') {
      const text = sanitizeResendText(lastUserMsg.content);
      if (text) {
        handleSendOrSteer(text);
      }
    }
  };

  const handleApprove = async (toolId: string) => {
    try {
      setPendingApprovals((prev) => prev.filter((p) => p.id !== toolId));
      useIDEStore.getState().setPendingApprovals((prev: ToolCallPayload[]) => prev.filter((p: ToolCallPayload) => p.id !== toolId));
      await fetch('/api/swarm/approve-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId: toolId }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleReject = async (toolId: string) => {
    try {
      setPendingApprovals((prev) => prev.filter((p) => p.id !== toolId));
      useIDEStore.getState().setPendingApprovals((prev: ToolCallPayload[]) => prev.filter((p: ToolCallPayload) => p.id !== toolId));
      await fetch('/api/swarm/reject-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId: toolId }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  // ask_user hydration fallback: when the agent_question packet missed the
  // store slice, rebuild the question from the raw ask_user toolCall params so
  // the card still renders instead of an empty shell.
  const askUserFallback = useMemo(
    () => (isAgentGenerating ? findAskUserFallback(agentMessages) : null),
    [agentMessages, isAgentGenerating]
  );

  // #54: attach the question card to the assistant message that asked it.
  // Null whenever nothing is pending; when set, the card renders inline right
  // after that message's bubble instead of at the bottom of the feed.
  const askAnchorMessageId = useMemo(() => {
    if (!pendingAgentQuestion && !askUserFallback) return null;
    return findAskUserAnchorId(agentMessages);
  }, [agentMessages, pendingAgentQuestion, askUserFallback]);

  // Queue dispatch bridge: the socket handler lives above the dispatcher's
  // declaration, so it calls through this always-current ref instead.
  const queuedDispatchRef = useRef<(customText?: string, isSteering?: boolean) => void>(() => undefined);
  queuedDispatchRef.current = (customText?: string, isSteering?: boolean) => {
    void handleSendOrSteer(customText, isSteering);
  };

  // Stage the composer's current text for after the active run — no interrupt.
  const handleQueuePrompt = () => {
    const text = inputPrompt.trim();
    if (!text) return;
    updateQueue([...queuedPromptsRef.current, { id: `q-${Date.now()}`, text }]);
    setInputPrompt('');
  };

  // Instantly dispatch a specific queued prompt to the agent
  const handleSendQueuedNow = (id: string) => {
    const item = queuedPrompts.find((q) => q.id === id);
    if (!item) return;
    updateQueue(queuedPrompts.filter((q) => q.id !== id));
    void handleSendOrSteer(item.text, true);
  };

  // Instantly dispatch all queued prompts to the agent
  const handleSendAllQueued = () => {
    if (queuedPrompts.length === 0) return;
    const allPrompts = [...queuedPrompts];
    updateQueue([]);
    const combinedText = allPrompts.map((q) => q.text).join('\n\n');
    void handleSendOrSteer(combinedText, true);
  };

  // Listen for targeted element edit events from the preview inspector
  useEffect(() => {
    const handleElementEdit = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { elementData, selector, outerHTML, prompt } = detail;
      const cleanSelector = (selector || 'element').trim();
      const userPrompt = prompt || `Modify ${cleanSelector}`;

      let elementContext: ElementContextInfo = {
        tagName: elementData?.tagName || 'element',
        selector: cleanSelector,
        textContent: elementData?.textContent,
        classList: elementData?.classList || [],
        outerHTML: outerHTML || '',
        pageUrl: elementData?.pageUrl || '/workspace/index.html',
      };

      let technicalBriefing = `[Target Element Context]\nSelector: ${cleanSelector}\nOuter HTML:\n${outerHTML}\n\nPlease apply the requested change specifically to this element/component without modifying unrelated code.`;

      try {
        const res = await fetch('/api/preview/locate-element', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tagName: elementData?.tagName,
            selector: cleanSelector,
            outerHTML,
            textContent: elementData?.textContent,
            classList: elementData?.classList,
            pageUrl: elementData?.pageUrl,
          }),
        });
        if (res.ok) {
          const located = await res.json();
          if (located.success) {
            elementContext = {
              tagName: located.tagName || elementContext.tagName,
              selector: located.selector || elementContext.selector,
              textContent: located.textContent || elementContext.textContent,
              classList: located.classList || elementContext.classList,
              outerHTML: outerHTML || '',
              pageUrl: located.pageUrl || elementContext.pageUrl,
              sourceMatches: located.sourceMatches,
              cssMatches: located.cssMatches,
            };
            if (located.briefing) {
              technicalBriefing = `${located.briefing}\n\nOuter HTML:\n${outerHTML}\n\nPlease apply the requested change specifically to this element/component without modifying unrelated code.`;
            }
          }
        }
      } catch {}

      void handleSendOrSteer(userPrompt, false, technicalBriefing, elementContext);
    };
    window.addEventListener('sutra-element-edit', handleElementEdit);
    return () => window.removeEventListener('sutra-element-edit', handleElementEdit);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-canvas select-text">
      {/* Header */}
      <div className="h-11 px-2.5 border-b border-obsidian-hairline bg-obsidian-surface1 flex items-center justify-between relative z-20">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary overflow-hidden shrink-0">
            <img src="/assets/sutra-icon.svg" alt="Astra" className="w-4 h-4 object-contain" />
          </div>
          <div className="min-w-0 relative">
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-obsidian-inkPrimary">Astra</h3>
              {isAgentGenerating && (
                <span className="flex items-center gap-1 text-[10px] font-mono tabular-nums text-obsidian-inkSecondary bg-obsidian-surface2 border border-obsidian-border px-1.5 py-px rounded">
                  <Clock className="w-2.5 h-2.5 text-obsidian-inkMuted" />
                  <span>{elapsedSeconds.toFixed(1)}s</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setPermissionLevel(permissionLevel === 'strict' ? 'full' : 'strict')}
                className={`h-5 px-1.5 rounded border text-[9px] font-mono transition-colors cursor-pointer flex items-center gap-1 ${
                  permissionLevel === 'strict'
                    ? 'bg-obsidian-surface3 border-obsidian-border text-obsidian-inkPrimary'
                    : 'bg-transparent border-obsidian-border text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                }`}
                title={
                  permissionLevel === 'strict'
                    ? 'Strict Mode: Asks for confirmation before edits. Click for Full Access.'
                    : 'Full Access Mode: Autonomous execution. Click for Strict Mode.'
                }
              >
                <ShieldCheck className="w-2.5 h-2.5" />
                <span>{permissionLevel === 'strict' ? 'Strict' : 'Full'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Session controls — icon-only, tooltips carry the labels.
            32px hit targets per Fitts's law: the visual icon stays at 14px
            but the button is 8×8 so the user's pointer doesn't need to
            land on a tiny glyph. */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleNewChat}
            className="w-8 h-8 rounded-md flex items-center justify-center bg-transparent hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="New session"
            aria-label="New session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          <div className="relative">
            <button
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                isHistoryOpen
                  ? 'bg-obsidian-surface3 text-obsidian-inkPrimary'
                  : 'text-obsidian-inkMuted hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary'
              }`}
              title="Session history"
              aria-label="Session history"
            >
              <History className="w-3.5 h-3.5" />
            </button>

            {/* History Dropdown Drawer */}
            {isHistoryOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsHistoryOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full mt-1.5 w-80 max-h-96 overflow-y-auto bg-obsidian-surface2 border border-obsidian-border rounded-lg shadow-2xl shadow-black/60 p-1.5 z-50 space-y-0.5 text-xs">
                  <div className="flex items-center justify-between py-1 px-1.5 border-b border-obsidian-hairline text-[9px] font-mono text-obsidian-inkMuted uppercase tracking-widest">
                    <span>Sessions · {sessions.length}</span>
                    <button
                      onClick={handleNewChat}
                      className="text-obsidian-inkSecondary hover:text-obsidian-inkPrimary flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New</span>
                    </button>
                  </div>
                  {sessions.length === 0 ? (
                    <div className="p-4 text-center text-obsidian-inkMuted text-[11px] font-mono">No previous sessions</div>
                  ) : (
                    sessions.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => handleSelectSession(s.id)}
                        className={`w-full px-2 py-1.5 rounded-md flex items-center justify-between group transition-colors cursor-pointer ${
                          s.id === currentSessionId
                            ? 'bg-obsidian-surface2 text-obsidian-inkPrimary'
                            : 'hover:bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
                        }`}
                      >
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <MessageSquare className="w-3 h-3 text-obsidian-inkMuted mt-1 shrink-0" />
                          <div className="truncate text-left min-w-0">
                            <div className="truncate text-[11px] leading-4">{s.title || 'Autonomous Task'}</div>
                            <div className="text-[9px] text-obsidian-inkMuted font-mono tabular-nums">
                              {s.message_count || 0} msgs · {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : ''}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteSession(s.id, e)}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/15 text-obsidian-inkMuted hover:text-red-400 transition-all cursor-pointer ml-1 shrink-0"
                          title="Delete Session"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Close the Astra panel. This panel lives on the right edge, so its
              close control belongs here — on the panel itself. 32px target
              so the close affordance matches the other session buttons. */}
          <button
            onClick={toggleAgentPanel}
            className="w-8 h-8 rounded-md flex items-center justify-center bg-transparent hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Close Astra panel"
            aria-label="Close Astra panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 relative"
      >
        {agentMessages.length === 0 && (
          <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-6 text-obsidian-inkMuted select-none my-auto relative overflow-hidden rounded-2xl border border-obsidian-hairline glass-panel shadow-2xl">
            {/* Squared boxes grid background pattern */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-grid-pattern bg-grid-mask opacity-70 dark:opacity-50 z-0"
            />

            <div className="relative z-10 flex flex-col items-center text-center max-w-md w-full space-y-4">
              <div className="w-10 h-10 rounded-xl bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary shadow-sm">
                <Sparkles className="w-5 h-5 text-obsidian-inkSecondary" />
              </div>

              <div>
                <div className="inline-flex items-center px-2 py-0.5 rounded-md border border-obsidian-border bg-obsidian-surface2 text-[10px] font-mono text-obsidian-inkSecondary tracking-wider mb-2">
                  ASTRA AUTONOMOUS ENGINE
                </div>
                <h3 className="font-medium text-obsidian-inkPrimary text-base tracking-tight">What do you want to build today?</h3>
                <p className="text-xs text-obsidian-inkMuted leading-relaxed mt-1">
                  Full-stack generation, surgical debugging, algorithmic optimization, or live architecture synthesis.
                </p>
              </div>

              {/* Starter Action Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full pt-2">
                <button
                  onClick={() => setInputPrompt('Build a modern responsive full-stack web app for this workspace')}
                  className="p-3 rounded-xl border border-obsidian-hairline hover:border-obsidian-border bg-obsidian-surface1 hover:bg-obsidian-surface2 text-left transition-all duration-150 group cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary">
                    <Rocket className="w-3.5 h-3.5 text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary transition-colors" />
                    <span>Build Web App</span>
                  </div>
                  <div className="text-[10px] text-obsidian-inkMuted mt-0.5 line-clamp-1">Scaffold responsive UI & features</div>
                </button>

                <button
                  onClick={() => setInputPrompt('Audit this codebase for bugs, race conditions, and performance bottlenecks')}
                  className="p-3 rounded-xl border border-obsidian-hairline hover:border-obsidian-border bg-obsidian-surface1 hover:bg-obsidian-surface2 text-left transition-all duration-150 group cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary">
                    <ShieldCheck className="w-3.5 h-3.5 text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary transition-colors" />
                    <span>Audit & Fix Bugs</span>
                  </div>
                  <div className="text-[10px] text-obsidian-inkMuted mt-0.5 line-clamp-1">Zero-guess root cause & tests</div>
                </button>

                <button
                  onClick={() => setInputPrompt('Optimize data structures, AST indexing algorithms, and latency')}
                  className="p-3 rounded-xl border border-obsidian-hairline hover:border-obsidian-border bg-obsidian-surface1 hover:bg-obsidian-surface2 text-left transition-all duration-150 group cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary">
                    <Zap className="w-3.5 h-3.5 text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary transition-colors" />
                    <span>Optimize Algorithms</span>
                  </div>
                  <div className="text-[10px] text-obsidian-inkMuted mt-0.5 line-clamp-1">Sub-millisecond compute loops</div>
                </button>

                <button
                  onClick={() => setInputPrompt('Explain the system architecture, data models, and API boundaries')}
                  className="p-3 rounded-xl border border-obsidian-hairline hover:border-obsidian-border bg-obsidian-surface1 hover:bg-obsidian-surface2 text-left transition-all duration-150 group cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary">
                    <Compass className="w-3.5 h-3.5 text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary transition-colors" />
                    <span>Explain Architecture</span>
                  </div>
                  <div className="text-[10px] text-obsidian-inkMuted mt-0.5 line-clamp-1">Deep system & state walk</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {agentMessages.map((msg, idx) => {
          const isLastMessage = idx === agentMessages.length - 1;
          const isPausedMessage = isLastMessage && isPaused && msg.role === 'assistant';
          const isErrorNotice = msg.role === 'assistant' && typeof msg.content === 'string' && (msg.content.includes('Error:') || msg.content.includes('Connection lost'));
          const userImages = msg.role === 'user' ? (msg as ChatMessage).images : undefined;

          // Hide placeholder bubbles while they carry nothing at all — failed attempts stay visible
          const hasThinking = Boolean(msg.thinking || (isLastMessage && isAgentGenerating && currentAgentThinking));
          if (msg.role === 'assistant' && !isErrorNotice && !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0) && !hasThinking) {
            return null;
          }

          return (
            <div
              key={msg.id}
              className={`flex flex-col text-xs leading-relaxed ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[94%] p-3 rounded-lg transition-colors ${
                  msg.role === 'user'
                    ? 'bg-obsidian-surface3 text-obsidian-inkPrimary border border-obsidian-border shadow-sm'
                    : isPausedMessage
                    ? 'bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary shadow-xl'
                    : isErrorNotice
                    ? 'bg-obsidian-surface2 border border-obsidian-danger/30 text-obsidian-inkPrimary'
                    : 'bg-obsidian-surface1 border border-obsidian-border text-obsidian-inkPrimary'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <SequentialMessageRenderer
                    content={msg.content}
                    toolCalls={msg.toolCalls || []}
                    thinking={msg.thinking || (isLastMessage && isAgentGenerating ? currentAgentThinking : undefined)}
                    live={Boolean(isLastMessage && isAgentGenerating)}
                  />
                ) : (() => {
                  const chatMsg = msg as ChatMessage;
                  let displayPrompt = msg.content;
                  let activeElement = chatMsg.elementContext;

                  if (!activeElement && typeof msg.content === 'string') {
                    const parsed = parseLegacyElementContext(msg.content);
                    if (parsed.elementContext) {
                      displayPrompt = parsed.userPrompt;
                      activeElement = parsed.elementContext;
                    }
                  }

                  return (
                    <>
                      <div className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{displayPrompt}</div>
                      {activeElement && <ElementContextCard element={activeElement} />}
                      {userImages && userImages.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {userImages.map((src, i) => (
                            <img key={i} src={src} alt={`Attachment ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-black/10" />
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Interactive Resume / Steer Box for Paused State */}
                {isPausedMessage && (
                  <div className="mt-3 pt-2.5 border-t border-obsidian-hairline flex flex-wrap items-center gap-2 select-none">
                    <button
                      onClick={() => handleSendOrSteer('Continue directly where you left off from the previous step.')}
                      className="px-2.5 py-1 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Resume</span>
                    </button>
                    <button
                      onClick={() => handleSendOrSteer('Audit all files, run typecheck and tests, and verify everything works as expected.', true)}
                      className="px-2.5 py-1 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Zap className="w-3 h-3" />
                      <span>Verify</span>
                    </button>
                  </div>
                )}

                {/* Interactive Error Notice & One-Click Retry Box (legacy in-content error rows only — new failures use the shared banner) */}
                {isLastMessage && !isAgentGenerating && typeof msg.content === 'string' && (msg.content.includes('Error:') || msg.content.includes('Execution Notice') || msg.content.includes('hit a snag') || msg.content.includes('WebSocket')) && (
                  <div className="mt-3 pt-2.5 border-t border-obsidian-hairline flex flex-wrap items-center gap-2 select-none">
                    <button
                      onClick={handleRetryLastPrompt}
                      className="px-2.5 py-1 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                      title="Retry Last Request"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry Prompt</span>
                    </button>
                    <button
                      onClick={() => useIDEStore.getState().setSettingsOpen(true)}
                      className="px-2.5 py-1 rounded-lg bg-obsidian-surface1 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Configure AI API Keys in Settings"
                    >
                      <Settings className="w-3 h-3" />
                      <span>Configure API Keys</span>
                    </button>
                  </div>
                )}

                {/* Assistant Message Actions: Copy response and 1-Click Undo Turn.
                    Fitts's law: 28px tall hit target so the user can land the
                    cursor without aiming for the text. */}
                {msg.role === 'assistant' && !isAgentGenerating && (
                  <div className="mt-2 pt-1.5 border-t border-obsidian-hairline flex items-center gap-1.5 select-none text-[11px] font-mono text-obsidian-inkMuted opacity-75 hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(typeof msg.content === 'string' ? msg.content : '');
                      }}
                      className="h-7 px-2.5 rounded hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Copy message"
                      aria-label="Copy message"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await fetch('/api/checkpoints/rollback', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: 'latest' }),
                          });
                          useIDEStore.getState().triggerFileTreeRefresh();
                        } catch {}
                      }}
                      className="h-7 px-2.5 rounded hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary text-obsidian-inkMuted flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="1-Click Undo: Revert all file modifications from this turn"
                      aria-label="Undo this turn"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Undo Turn</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Pending question fallback when ask_user was not attached as a toolCall */}
              {msg.role === 'assistant' &&
                msg.id === askAnchorMessageId &&
                (!Array.isArray(msg.toolCalls) || !msg.toolCalls.some((tc) => tc.tool === 'ask_user')) && (
                  <div className="max-w-[94%] mt-2">
                    <AskUserCard fallback={askUserFallback} />
                  </div>
                )}
            </div>
          );
        })}

        {/* Shared transient connection-lost banner — at most ONE, dismissible, auto-clears on the next run */}
        {connectionLost && (
          <ConnectionLostBanner onRetry={handleRetryLastPrompt} />
        )}

        {/* Comprehensive Live Task Status Banner with Running/Paused/Approval indicators */}
        <AgentStatusBanner
          status={agentStatus}
          isGenerating={isAgentGenerating}
          isPaused={isPaused}
          thinking={currentAgentThinking}
          elapsedSeconds={elapsedSeconds}
          onPause={handlePauseGeneration}
          onResume={() => handleSendOrSteer('Continue directly where you left off from the previous step.')}
          onVerify={() => handleSendOrSteer('Audit all files, run typecheck and tests, and verify everything works as expected.', true)}
        />

        {/* Action Approvals */}
        {pendingApprovals.map((pa) => (
          <ApprovalCard
            key={pa.id}
            toolCall={pa}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))}

        {/* Pending Agent Question — rendered inline inside the asking message above;
            this bottom slot is only a fallback for the rare race where the question
            lands before any assistant message exists. */}
        {!askAnchorMessageId &&
          !agentMessages.some((m) => Array.isArray(m.toolCalls) && m.toolCalls.some((tc) => tc.tool === 'ask_user')) &&
          (pendingAgentQuestion || askUserFallback) && <AskUserCard fallback={askUserFallback} />}

        {/* Floating Scroll to Bottom Indicator */}
        {userScrolledUp && (
          <div className="sticky bottom-2 flex justify-center z-30">
            <button
              onClick={() => {
                isNearBottomRef.current = true;
                setUserScrolledUp(false);
                scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-2.5 py-1 rounded-full bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary text-[10px] font-mono shadow-lg flex items-center gap-1.5 transition-all cursor-pointer animate-in fade-in"
            >
              <ChevronDown className="w-3 h-3" />
              <span>Scroll to latest</span>
            </button>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input Composer Box */}
      <div className="p-3 border-t border-obsidian-hairline bg-obsidian-surface1">
        {/* Review row — changed files summary with diff overlay (parity with Manager mode) */}
        {changedFiles.length > 0 && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-obsidian-border bg-obsidian-surface2 px-3 py-1.5">
            <div className="flex items-center gap-2 min-w-0 text-[11px] font-mono text-obsidian-inkSecondary">
              <FileCode2 className="w-3.5 h-3.5 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
              <span className="shrink-0">
                {changedFiles.length} file{changedFiles.length === 1 ? '' : 's'} changed
              </span>
              <span className="truncate text-obsidian-inkMuted" title={changedFiles.map((f) => f.path).join(', ')}>
                {changedFiles
                  .map((f) => f.path.split(/[/\\]/).pop())
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(', ')}
                {changedFiles.length > 3 ? `, +${changedFiles.length - 3}` : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsDiffOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-obsidian-border bg-obsidian-surface2 hover:bg-obsidian-surface3 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-borderBright"
            >
              Review
            </button>
          </div>
        )}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageSelect}
          multiple
          accept="image/*,text/*,.ts,.tsx,.js,.jsx,.json,.md,.py,.rs,.go,.css,.html,.txt"
          className="hidden"
        />

        {/* Queued prompts — staged while Astra works; users can let them run in order or Send immediately */}
        {queuedPrompts.length > 0 && (
          <div className="mb-2 space-y-1">
            <div className="flex items-center justify-between px-1 text-[10px] font-mono text-obsidian-inkMuted">
              <span>Queued messages ({queuedPrompts.length})</span>
              <button
                type="button"
                onClick={handleSendAllQueued}
                className="flex items-center gap-1 text-cyan-400 hover:underline cursor-pointer font-medium"
                title="Send all queued messages immediately"
              >
                <Send className="w-2.5 h-2.5" />
                <span>Send All Now</span>
              </button>
            </div>
            {queuedPrompts.map((q, i) => (
              <div
                key={q.id}
                className="group flex items-center gap-2 rounded-md border border-obsidian-border bg-obsidian-surface1 px-2 py-1"
                title={q.text}
              >
                <span className="flex items-center gap-1 text-[9px] font-mono text-obsidian-inkMuted shrink-0">
                  <ListPlus className="w-3 h-3" />
                  {i + 1}
                </span>
                <span className="truncate text-[10px] text-obsidian-inkSecondary flex-1 min-w-0">{q.text}</span>
                {/* Instant Send button for this queued prompt */}
                <button
                  type="button"
                  onClick={() => handleSendQueuedNow(q.id)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkPrimary border border-obsidian-hairline flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                  title="Send this message now"
                >
                  <Send className="w-2.5 h-2.5" />
                  <span>Send</span>
                </button>
                <button
                  onClick={() => updateQueue(queuedPrompts.filter((item) => item.id !== q.id))}
                  className="w-5 h-5 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-all cursor-pointer shrink-0 flex items-center justify-center"
                  title="Remove from queue"
                  aria-label="Remove from queue"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {attachedImage && (
          <div className="mb-2 p-1.5 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={attachedImage} alt="Attached preview" className="w-8 h-8 rounded-lg object-cover border border-obsidian-hairline" />
              <div className="text-[10px] text-obsidian-inkPrimary font-mono">
                <span>UI Reference / Screenshot attached</span>
                <p className="text-obsidian-inkMuted text-[9px]">Auto-Vision Handoff Active</p>
              </div>
            </div>
            <button
              onClick={() => setAttachedImage(null)}
              aria-label="Remove attachment"
              title="Remove attachment"
              className="p-1 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {attachedFile && (
          <div className="mb-2 p-1.5 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg flex items-center justify-between font-mono">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-obsidian-inkSecondary shrink-0" />
              <div className="text-[10px] text-obsidian-inkPrimary truncate">
                <span className="font-semibold">{attachedFile.name}</span>
                <p className="text-obsidian-inkMuted text-[9px]">Attached as context</p>
              </div>
            </div>
            <button
              onClick={() => setAttachedFile(null)}
              aria-label="Remove file attachment"
              title="Remove file attachment"
              className="p-1 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="composer relative" data-disabled={isAgentGenerating && !inputPrompt.trim() ? 'true' : undefined}>
          {mentionFilter !== null && (
            <MentionAutocomplete
              filter={mentionFilter}
              onSelect={handleSelectMention}
              onClose={() => setMentionFilter(null)}
            />
          )}

          {/* Slash-command discoverability — typing "/" surfaces the full command and skill set */}
          {inputPrompt.startsWith('/') && !inputPrompt.slice(1).includes(' ') && (
            <div className="glass-dropdown absolute left-2 right-2 bottom-full mb-2 p-1 z-30 max-h-60 overflow-y-auto">
              <div className="px-2.5 py-1.5 text-[9px] uppercase tracking-[0.18em] text-obsidian-inkMuted flex items-center justify-between border-b border-obsidian-hairline mb-1">
                <span>Commands & Skills</span>
                <span>↑↓ Navigate</span>
              </div>
              {[
                { cmd: '/goal', desc: 'Continuous autonomous loop until goal is 100% achieved' },
                { cmd: '/plan', desc: 'Plan step by step and wait for review' },
                { cmd: '/godmode', desc: 'Highest-rigor autonomous execution mode' },
                { cmd: '/skills', desc: 'Browse installed skill catalog (117+ auto-activated skills)' },
                { cmd: '/add-skill', desc: 'Create and register a custom skill for Astra' },
                { cmd: '/fix', desc: 'Find and fix every error, verify with build/tests' },
                { cmd: '/test', desc: 'Write and run unit & integration test suites' },
                { cmd: '/explain', desc: 'Explain architecture, entry points, and data flow' },
                { cmd: '/refactor', desc: 'Clean up code architecture and eliminate technical debt' },
                { cmd: '/browser', desc: 'Web search, live doc lookup, and web research' },
                { cmd: '/schedule', desc: 'Schedule recurring background cron or one-shot timer' },
                { cmd: '/grill-me', desc: 'Interactive interview to align on design decisions' },
                { cmd: '/learn', desc: 'Persist custom preferences & agent behavior rules' },
              ]
                .filter((c) => c.cmd.startsWith(inputPrompt.trim().toLowerCase()))
                .map((c) => (
                  <button
                    key={c.cmd}
                    type="button"
                    onClick={() => {
                      if (c.cmd === '/skills' || c.cmd === '/add-skill') {
                        setSkillsModalOpen(true);
                        setInputPrompt('');
                      } else {
                        setInputPrompt(`${c.cmd} `);
                        textareaRef.current?.focus();
                      }
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-obsidian-surface2 text-left transition-colors cursor-pointer group"
                  >
                    <span className="text-[11px] font-mono text-obsidian-inkPrimary shrink-0 group-hover:text-obsidian-inkPrimary">{c.cmd}</span>
                    <span className="text-[10px] text-obsidian-inkMuted truncate group-hover:text-obsidian-inkSecondary">{c.desc}</span>
                  </button>
                ))}
            </div>
          )}

          {voice.isListening && (
            <div className="flex items-center justify-between gap-2 mx-2.5 mt-2 px-2.5 py-1 rounded-md bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary text-xs animate-in fade-in">
              <div className="flex items-center gap-2">
                <Mic className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />
                <span className="text-[11px] font-medium">Listening... speak prompt</span>
              </div>
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-obsidian-inkSecondary" />
                <button
                  type="button"
                  onClick={voice.stop}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors"
                  title="Stop listening (Esc)"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={handleInputChange}
            onPaste={handleImagePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (mentionFilter !== null) {
                  e.preventDefault(); // Let the popup consume Enter without inserting a newline behind it
                  return;
                }
                e.preventDefault();
                handleSendOrSteer(undefined, isAgentGenerating || isPaused);
              }
              if (e.key === 'Escape') {
                if (mentionFilter !== null) {
                  e.preventDefault();
                  setMentionFilter(null);
                  return;
                }
                if (isAgentGenerating) {
                  e.preventDefault();
                  handlePauseGeneration();
                }
              }
            }}
            placeholder={
              voice.isListening
                ? "Listening... speak now"
                : isAgentGenerating
                ? "Type to steer agent mid-flight..."
                : isPaused
                ? "Instruct or steer resumed execution..."
                : "Instruct Astra — / for commands, @ for files..."
            }
            rows={3}
            className="w-full bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none resize-none font-sans tracking-[-0.01em]"
          />

          <div className="flex items-center justify-between px-2.5 py-2 border-t border-obsidian-hairline text-[10px] text-obsidian-inkMuted">
            <div className="flex items-center gap-2 font-mono min-w-0 flex-wrap">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-obsidian-inkSecondary hover:text-obsidian-inkPrimary bg-obsidian-surface1 hover:bg-obsidian-surface2 border border-obsidian-hairline hover:border-obsidian-borderBright transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border disabled:opacity-50 select-none shrink-0 shadow-xs active:scale-95"
                title="Attach file or image"
                aria-label="Attach file or image"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>

              <McpStatusPill />

              <ModelSelectorDropdown buttonVariant="pill" className="shrink-0" />

              {voice.isSupported && (
                <button
                  type="button"
                  onClick={handleMicClick}
                  title={voice.isListening ? 'Stop voice input (Esc)' : 'Voice input'}
                  aria-label={voice.isListening ? 'Stop voice input' : 'Start voice input'}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border select-none shrink-0 border shadow-xs active:scale-95 ${
                    voice.isListening
                      ? 'text-cyan-300 bg-cyan-500/20 border-cyan-500/40 animate-pulse'
                      : 'bg-obsidian-surface1 hover:bg-obsidian-surface2 border-obsidian-hairline hover:border-obsidian-borderBright text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Fixed-height action slot: Send / Steer / Pause swap inside an equal box so the composer never shifts */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isAgentGenerating ? (
                <>
                  {inputPrompt.trim() && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSendOrSteer(undefined, true)}
                        className="h-8 px-2.5 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95 select-none hover:opacity-90"
                        title="Instant Send (Enter) — immediately sends and steers the live agent"
                      >
                        <Send className="w-3 h-3" />
                        <span>Send</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleQueuePrompt}
                        className="h-8 px-2.5 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline hover:border-obsidian-borderBright text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 text-[11px] font-mono font-medium flex items-center gap-1 transition-colors cursor-pointer select-none shadow-xs"
                        title="Queue — run this automatically when the current task finishes"
                      >
                        <ListPlus className="w-3 h-3" />
                        <span>Queue</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={handlePauseGeneration}
                    className="w-8 h-8 rounded-lg bg-transparent border border-obsidian-hairline hover:border-obsidian-borderBright text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 flex items-center justify-center transition-colors cursor-pointer select-none shadow-xs"
                    title="Pause Generation"
                  >
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendOrSteer()}
                  disabled={!inputPrompt.trim() && !attachedImage}
                  className={`h-8 px-3 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer select-none shadow-xs active:scale-95 ${
                    inputPrompt.trim() || attachedImage
                      ? 'bg-obsidian-inkPrimary text-obsidian-canvas hover:opacity-90'
                      : 'bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkMuted opacity-50 cursor-not-allowed'
                  }`}
                  title="Send Prompt (Enter)"
                >
                  <Send className="w-3 h-3" />
                  <span>Send</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Review overlay — side-by-side diff for this session's changed files */}
      <ManagerDiffView
        open={isDiffOpen}
        entries={changedFiles}
        onClose={() => setIsDiffOpen(false)}
        onOpenInIde={(path) => {
          setIsDiffOpen(false);
          useIDEStore.getState().openFilePath(path);
        }}
      />

      {/* AVO Pro Activation Modal */}
      {showAvoModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 anim-fade-in">
          <div className="bg-obsidian-surface1 border border-obsidian-hairline rounded-xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-md bg-obsidian-surface3 text-obsidian-inkPrimary">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <h3 className="text-sm font-semibold text-obsidian-inkPrimary">Activate AVO Pro Mode?</h3>
                </div>
                <p className="text-xs text-obsidian-inkSecondary leading-relaxed pt-1">
                  AVO Pro activates NVIDIA-inspired Autonomous Variation Optimization. It runs multi-candidate diff exploration, automated fitness evaluations, and rollback safety.
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-obsidian-surface1 border border-obsidian-border p-2.5 text-[11px] text-obsidian-inkSecondary leading-snug">
              ⚡ <strong className="text-obsidian-inkPrimary">Notice:</strong> Pro mode evaluates multiple candidate branches and verification loops. It may consume more model usage and compute budget.
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAvoModal(false)}
                className="px-3 py-1.5 rounded-lg border border-obsidian-hairline text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setHarnessMode('avo');
                  setShowAvoModal(false);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-obsidian-accent hover:bg-obsidian-accentHover text-obsidian-inkInverse font-medium text-xs transition-colors cursor-pointer shadow-sm"
              >
                Activate AVO Pro
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
