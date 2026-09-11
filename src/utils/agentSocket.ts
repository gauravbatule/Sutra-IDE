import { useSyncExternalStore } from 'react';
import { useIDEStore } from '../stores/ideStore.js';
import type { OmniAgentMessage, PendingAgentQuestion, ToolCallPayload } from '../types/ide.js';

/**
 * Standalone singleton WebSocket client for the Manager conversation surface.
 *
 * NOTE: This intentionally duplicates (but does not modify) the send/stream
 * pipeline embedded in src/components/Agent/AgentChat.tsx so the two surfaces
 * stay isolated. Packet shapes, channel codes, and store dispatches are kept
 * byte-compatible with AgentChat so both surfaces share one agentMessages
 * state and one generation lifecycle.
 */

const CHANNEL_AGENT_STREAM = 0x05;
const CHANNEL_TOOL_RESULT = 0x06;
const CHANNEL_APPROVAL = 0x07;

let activeSocket: WebSocket | null = null;
let lastSendAt = 0;

/**
 * Transient connection-lost banner slot — the single source of truth for
 * "Connection lost" across BOTH chat surfaces.
 *
 * Root cause this replaces: the notice used to be appended into assistant
 * message content on every abnormal socket close, so each failed attempt
 * (and every reloaded session containing past failures) stacked another red
 * row. The banner is now a module-level boolean set at most once per failure,
 * rendered as one dismissible row, and auto-cleared when the next run starts,
 * the user retries, or the stream is cancelled.
 */
let connectionLost = false;
const connectionLostListeners = new Set<() => void>();

const notifyConnectionLost = (): void => {
  for (const listener of connectionLostListeners) listener();
};

export const reportConnectionLost = (): void => {
  if (connectionLost) return;
  connectionLost = true;
  notifyConnectionLost();
};

export const clearConnectionLost = (): void => {
  if (!connectionLost) return;
  connectionLost = false;
  notifyConnectionLost();
};

const subscribeConnectionLost = (listener: () => void): (() => void) => {
  connectionLostListeners.add(listener);
  return () => connectionLostListeners.delete(listener);
};

/** React binding: [isShowingBanner, dismiss] for the shared transient row. */
export const useConnectionLost = (): [boolean, () => void] => {
  const value = useSyncExternalStore(subscribeConnectionLost, () => connectionLost);
  return [value, clearConnectionLost];
};

/**
 * ask_user ids already answered locally. The toolCall only receives its result
 * packet after the server resumes the run, so this registry keeps fallback
 * hydration from resurrecting a question the user just answered.
 */
const answeredQuestionIds = new Set<string>();

export const markQuestionAnswered = (id: string): void => {
  if (id) answeredQuestionIds.add(id);
};

export const wasQuestionAnswered = (id: string): boolean => {
  return answeredQuestionIds.has(id);
};

/**
 * Optional sender override for agent_answer packets. AgentChat (or any other
 * surface that owns its own socket) registers a forwarding fn so answers reach
 * the parked run even when the Manager singleton socket is closed. A null
 * unregisters and falls back to the singleton socket below.
 */
let questionSender: ((payload: string) => boolean) | null = null;

export const registerQuestionSender = (fn: ((payload: string) => boolean) | null): void => {
  questionSender = fn;
};

/**
 * Sends an agent_answer packet for the given ask_user toolcall id through the
 * registered sender if one exists, else through the singleton socket when open.
 * Returns whether the payload was actually sent.
 */
export const answerAgentQuestion = (id: string, answer: string): boolean => {
  const payload = JSON.stringify({ type: 'agent_answer', id, answer });
  markQuestionAnswered(id);
  if (questionSender) {
    try {
      return Boolean(questionSender(payload));
    } catch {
      // Sender threw — fall through to the singleton socket path
      questionSender = null;
    }
  }
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    try {
      activeSocket.send(payload);
      return true;
    } catch {
      return false;
    }
  }
  return false;
};

export interface SendAgentPromptOptions {
  text: string;
  attachedContext?: string | null;
  isGoalMode?: boolean;
}

export const resolveWsUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.port === '5173' ? `${window.location.hostname}:3001` : window.location.host;
  return `${protocol}//${wsHost}/ws`;
};

/** Cancels the in-flight stream with the same cancel packet AgentChat sends. */
export const cancelAgentStream = (): void => {
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    activeSocket.send(
      JSON.stringify({
        channel: CHANNEL_AGENT_STREAM,
        type: 'cancel',
        timestamp: Date.now(),
      })
    );
    activeSocket.close();
  }
  activeSocket = null;
  clearConnectionLost();
  useIDEStore.getState().setIsAgentGenerating(false);
};

export const isAgentSocketBusy = (): boolean => Boolean(activeSocket && activeSocket.readyState === WebSocket.OPEN);

/**
 * Dedupe guard for optimistic user echoes. Both send paths (Manager prompt
 * send, AgentChat send/steer/retry) append locally; a retry or a double
 * submit previously produced two identical bubbles side by side because the
 * shared store had no cross-surface guard. Skips the add when an identical
 * user message already exists within DEDUPE_WINDOW_MS.
 */
const USER_DEDUPE_WINDOW_MS = 8000;
const DEDUPE_SCAN_DEPTH = 8;

export const appendUserMessageDeduped = (msg: OmniAgentMessage): boolean => {
  const state = useIDEStore.getState();
  const trimmed = (msg.content || '').trim();
  const messages = state.agentMessages;
  for (let i = messages.length - 1; i >= 0 && i >= messages.length - DEDUPE_SCAN_DEPTH; i--) {
    const existing = messages[i];
    if (existing.role !== 'user') continue;
    if ((existing.content || '').trim() !== trimmed) continue;
    if (Math.abs(msg.timestamp - existing.timestamp) <= USER_DEDUPE_WINDOW_MS) return false;
  }
  state.addAgentMessage(msg);
  return true;
};

/** Clears the debounce window and dangling socket — used by the test suite only. */
export const resetAgentSocketForTests = (): void => {
  activeSocket = null;
  lastSendAt = 0;
  questionSender = null;
  connectionLost = false;
};

/**
 * Sends a user prompt through the identical pipeline AgentChat uses:
 * appends the user message + assistant placeholder into ideStore, opens a
 * WebSocket to /ws, replays full preserved history, and streams chunks,
 * tool calls, approvals, and inline diffs back into the shared store.
 */
/** User-configured model priority (Settings > Routing drag order). */
export const readStoredPriorityIds = (): string[] => {
  try {
    const raw = localStorage.getItem('sutra-model-priority');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v: unknown) => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

/** Auto-compact preference (Settings > Routing). */
export const readStoredAutoCompact = (): { enabled: boolean; threshold: number } => {
  try {
    const raw = localStorage.getItem('sutra-autocompact');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      enabled: parsed.enabled !== false,
      threshold: typeof parsed.threshold === 'number' ? parsed.threshold : 80,
    };
  } catch {
    return { enabled: true, threshold: 80 };
  }
};

export const sendAgentPrompt = async (options: SendAgentPromptOptions): Promise<void> => {
  const state = useIDEStore.getState();

  // Debounce double submits, mirroring AgentChat's isSubmittingRef guard
  if (Date.now() - lastSendAt < 400) return;
  if (state.isAgentGenerating) return;

  const trimmed = options.text.trim();
  if (!trimmed) return;
  lastSendAt = Date.now();

  let userContent = trimmed;
  const isGoalTriggered = Boolean(options.isGoalMode) || userContent.includes('/goal');
  if (userContent.includes('/goal')) {
    userContent = userContent.replace(/\/goal/g, '').trim() || 'Autonomous mission execution';
  }
  if (options.attachedContext) {
    userContent = `${userContent}\n\n${options.attachedContext}`;
  }

  // Snapshot history BEFORE appending, so the replay excludes the placeholder
  const historySnapshot: OmniAgentMessage[] = state.agentMessages;

  // A new run always clears any lingering connection-lost banner
  clearConnectionLost();
  // ...and any evidence card from the previous run's verification stage
  useIDEStore.getState().setLastVerification(null);

  const userMsg: OmniAgentMessage = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: userContent,
    timestamp: Date.now(),
  };
  appendUserMessageDeduped(userMsg);

  const assistantMsg: OmniAgentMessage = {
    id: `msg-asst-${Date.now()}`,
    role: 'assistant',
    content: '',
    toolCalls: [],
    timestamp: Date.now(),
    modelUsed: state.activeModel?.name || 'SUTRA Multi-Model Engine',
  };
  state.addAgentMessage(assistantMsg);

  state.setIsAgentGenerating(true);
  // No staged loader copy — the transcript shows one quiet "Astra is working" row
  // and the reasoning trace fills in only when real thinking chunks arrive.
  state.updateAgentThinking('');

  try {
    const ws = new WebSocket(resolveWsUrl());
    activeSocket = ws;

    ws.onopen = () => {
      const serializedMessages = [...historySnapshot, userMsg]
        .filter((m) => Boolean(m.content && m.content.trim()) || Boolean(m.toolCalls && m.toolCalls.length > 0))
        .map((m) => {
          if (m.role === 'assistant' && (!m.content || !m.content.trim()) && m.toolCalls && m.toolCalls.length > 0) {
            return {
              role: 'assistant',
              content: null,
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.tool, arguments: JSON.stringify(tc.params) },
              })),
            };
          }
          return {
            role: m.role,
            content: m.content || '',
            ...(m.toolCalls && m.toolCalls.length > 0
              ? {
                  tool_calls: m.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.tool, arguments: JSON.stringify(tc.params) },
                  })),
                }
              : {}),
          };
        });

      const {
        activeTabPath,
        openTabs,
        cursorPosition,
        selectedText,
        selectionRange,
        visibleRange,
        activeFileDiagnostics,
      } = useIDEStore.getState();
      const activeTab = openTabs.find((t) => t.path === activeTabPath);

      ws.send(
        JSON.stringify({
          channel: CHANNEL_AGENT_STREAM,
          type: 'prompt',
          payload: {
            messages: serializedMessages,
            permissionLevel: useIDEStore.getState().permissionLevel,
            priorityIds: readStoredPriorityIds(),
            autoCompact: readStoredAutoCompact().enabled,
            autoCompactThreshold: readStoredAutoCompact().threshold,
            isGoalMode: isGoalTriggered,
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
      try {
        const packet = JSON.parse(event.data);
        const store = useIDEStore.getState();

        // ask_user: the agent parked its run and wants input (no channel field
        // — it rides the same JSON text channel as every other event).
        if (packet.type === 'agent_question') {
          const question: PendingAgentQuestion = {
            id: String(packet.id ?? ''),
            question: String(packet.question ?? ''),
            options: Array.isArray(packet.options) ? packet.options.map((o: unknown) => String(o)) : [],
            allowFreeText: packet.allowFreeText !== false,
          };
          store.setPendingAgentQuestion(question);
          return;
        }

        if (packet.channel === CHANNEL_APPROVAL && packet.type === 'request') {
          const toolCall = packet.payload?.toolCall;
          if (toolCall) {
            store.setPendingApprovals((prev: ToolCallPayload[]) => [
              ...prev.filter((p: ToolCallPayload) => p.id !== toolCall.id),
              toolCall,
            ]);
          }
          return;
        }

        if (packet.channel === CHANNEL_TOOL_RESULT && packet.type === 'result') {
          const { tool, result, id } = packet.payload;
          store.updateToolCallResult(id, tool, result);
          fetch('/api/swarm/status')
            .then((r) => r.json())
            .then((d) => store.setSubagents(d.subagents || []))
            .catch(() => undefined);
          fetch('/api/media/assets')
            .then((r) => r.json())
            .then((d) => store.setAssets(d || []))
            .catch(() => undefined);
          return;
        }

        if (packet.channel === CHANNEL_TOOL_RESULT && packet.type === 'error') {
          const { tool, error, id } = packet.payload;
          store.updateToolCallError(id, tool, error);
          return;
        }

        if (packet.channel === CHANNEL_AGENT_STREAM && packet.type === 'inline_diff') {
          // Record the before/after snapshot for the Manager Review flow while
          // preserving the existing single-diff editor overlay behavior.
          const diffPayload = packet.payload;
          if (
            diffPayload &&
            typeof diffPayload.path === 'string' &&
            (typeof diffPayload.proposedContent === 'string' || typeof diffPayload.originalContent === 'string')
          ) {
            const lastToolCall = [...(store.agentMessages[store.agentMessages.length - 1]?.toolCalls || [])].pop();
            useIDEStore.getState().recordReviewDiff({
              path: diffPayload.path,
              tool: lastToolCall?.tool || 'edit_file',
              originalContent: typeof diffPayload.originalContent === 'string' ? diffPayload.originalContent : null,
              proposedContent: typeof diffPayload.proposedContent === 'string' ? diffPayload.proposedContent : null,
              capturedAt: Date.now(),
            });
          }
          useIDEStore.getState().setInlineDiff(packet.payload);
          return;
        }

        if (packet.channel === 0x0a && packet.type === 'update') {
          // Swarm state: subagent roster (server clears it at the start of each run;
          // setSubagents owns the auto-open Swarm-tab logic)
          store.setSubagents(Array.isArray(packet.payload?.subagents) ? packet.payload.subagents : []);
          return;
        }

        if (packet.channel === CHANNEL_AGENT_STREAM && packet.type === 'verification') {
          // End-of-run verification evidence from the server's verification stage
          if (packet.payload?.report) {
            useIDEStore.getState().setLastVerification(packet.payload.report);
          }
          return;
        }

        if (packet.channel === CHANNEL_AGENT_STREAM && packet.type === 'chunk') {
          const chunk = packet.payload;
          if (chunk.thinking) {
            store.updateAgentThinking(chunk.thinking);
          }
          if (chunk.retryEvent) {
            useIDEStore.getState().addRetryEvent(chunk.retryEvent);
          }
          if (chunk.resetContent) {
            useIDEStore.getState().resetLastMessageContent();
          }
          if (chunk.delta) {
            store.updateLastMessageContent(chunk.delta);
          }
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            store.addToolCallsToLastMessage(chunk.toolCalls);
            for (const tc of chunk.toolCalls) {
              store.updateLastMessageContent(`\n<!-- TOOL_CALL:${tc.id} -->\n`);
            }
          }
          if (chunk.done) {
            useIDEStore.getState().setLastRunUsage(chunk.usage || null);
            useIDEStore.getState().setIsAgentGenerating(false);
            // A finished run can no longer be waiting on ask_user
            if (useIDEStore.getState().pendingAgentQuestion) {
              useIDEStore.getState().setPendingAgentQuestion(null);
            }
            activeSocket = null;
            ws.close();
          }
        }
      } catch {
        // Malformed packet — ignore, matching AgentChat behavior
      }
    };

    let sawTransportError = false;

    ws.onerror = () => {
      // Keep the socket slot until onclose fires; record the failure so close
      // reports it exactly once through the shared banner.
      if (activeSocket !== ws) return;
      sawTransportError = true;
    };

    ws.onclose = () => {
      const wasActive = activeSocket === ws;
      if (wasActive) activeSocket = null;
      useIDEStore.getState().setIsAgentGenerating(false);
      // Server resolves parked ask_user runs on socket loss — drop the card
      useIDEStore.getState().setPendingAgentQuestion(null);
      if (sawTransportError) {
        reportConnectionLost();
      } else if (wasActive && !useIDEStore.getState().agentMessages.some((m) => m.role === 'assistant' && m.content)) {
        // Clean server-side close with no assistant output at all — treat as lost
        reportConnectionLost();
      }
    };
  } catch (err: any) {
    const store = useIDEStore.getState();
    store.updateLastMessageContent(`\n\nError: ${err?.message || 'Connection failed'}`);
    store.setIsAgentGenerating(false);
    activeSocket = null;
  }
};
