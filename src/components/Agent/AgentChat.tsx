import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
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
  Target,
  Wrench,
  Film,
  Smartphone,
  X,
  History,
  Plus,
  Trash2,
  MessageSquare,
  Clock,
  FileCode2,
  Settings
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { deriveAgentStatus } from '../../utils/agentStatus.js';
import {
  appendUserMessageDeduped,
  clearConnectionLost,
  registerQuestionSender,
  reportConnectionLost,
  useConnectionLost,
} from '../../utils/agentSocket.js';
import { AskUserCard, findAskUserFallback } from '../Common/AskUserCard.js';
import { ConnectionLostBanner } from '../Common/ConnectionLostBanner.js';
import { ToolCard } from './ToolCard.js';
import { ApprovalCard } from './ApprovalCard.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { MentionAutocomplete, MentionItem } from './MentionAutocomplete.js';
import { ModelSelectorDropdown } from '../Common/ModelSelectorDropdown.js';
import { ToolCallPayload, OmniAgentMessage } from '../../types/ide.js';
import { ManagerDiffView, collectChangedFiles } from '../Manager/ManagerDiffView.js';

/** Renders assistant text chunks and executed tool cards in exact chronological interleaved sequence */
const SequentialMessageRenderer: React.FC<{ content?: string; toolCalls?: ToolCallPayload[] }> = ({
  content = '',
  toolCalls = [],
}) => {
  const safeTools = Array.isArray(toolCalls) ? toolCalls : [];
  const renderedToolIds = new Set<string>();
  const toolMap = new Map(safeTools.map((tc) => [tc.id, tc]));

  // Sanitize text: strip raw XML delimiters, orphaned tool tags, round execution logs, and think blocks
  const sanitizedContent = (typeof content === 'string' ? content : '')
    .replace(/>\s*⚙️\s*\*\[Round\s*\d+\]\s*Executing[\s\S]*?\*\s*\n*/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function=[a-zA-Z0-9_]+>[\s\S]*?<\/function>/gi, '')
    .replace(/<parameter=[a-zA-Z0-9_]+>[\s\S]*?<\/parameter>/gi, '')
    .replace(/<\/function>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<\/?(?:tool_call|function|parameter|think|thought|function_call)[^>]*>/gi, '')
    .replace(/```json\s*\{[\s\S]*?"(?:name|tool)"\s*:[\s\S]*?\}\s*```/gi, '')
    .trim();

  // Split content by tool markers <!-- TOOL_CALL:id -->
  const parts = sanitizedContent.split(/<!-- TOOL_CALL:(.*?) -->/g);
  const elements: React.ReactNode[] = [];

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
        elements.push(<ToolCard key={toolCall.id} toolCall={toolCall} />);
      }
    }
  }

  // Any tool calls that didn't have an inline marker (legacy or fallback)
  const remainingTools = safeTools.filter((tc) => !renderedToolIds.has(tc.id));
  for (const tc of remainingTools) {
    elements.push(<ToolCard key={tc.id} toolCall={tc} />);
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

/** Cleans stored user text before it is resent (retry): drops steering prefixes and image placeholders */
const sanitizeResendText = (raw: string): string =>
  raw
    .replace(/^(?:\s*\[STEERING\]:\s*)+/i, '')
    .replace(/\[Image Attached\]/gi, '')
    .trim();

/** Fresh conversation opener shared by new chats and empty sessions */
const makeWelcomeThread = (): OmniAgentMessage[] => [
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

/** Outgoing chat message extended with attached image data URLs */
type ChatMessage = OmniAgentMessage & { images?: string[] };

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
  const pendingAgentQuestion = useIDEStore((s) => s.pendingAgentQuestion);
  const [connectionLost, dismissConnectionLost] = useConnectionLost();
  const {
    agentMessages,
    addAgentMessage,
    updateLastMessageContent,
    addToolCallsToLastMessage,
    updateToolCallResult,
    updateToolCallError,
    updateAgentThinking,
    currentAgentThinking,
    isAgentGenerating,
    setIsAgentGenerating,
    activeModel,
    permissionLevel,
    pendingApprovals,
    setPendingApprovals,
    setSubagents,
    setAssets,
  } = useIDEStore();

  const [inputPrompt, setInputPrompt] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const agentStatus = deriveAgentStatus({
    isGenerating: isAgentGenerating,
    hasPendingQuestion: Boolean(pendingAgentQuestion),
    hasPendingApprovals: pendingApprovals.length > 0,
  });
  // Collapsed by default: a stable single-line trace while streaming instead of a growing block
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isGoalMode, setIsGoalMode] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
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
      const firstUserMsg = msgs.find((m) => m.role === 'user');
      title = firstUserMsg ? sanitizeResendText(firstUserMsg.content).slice(0, 45) || 'Autonomous Mission' : 'Autonomous Mission';
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

  // Handle image attachment selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

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
    setTimeout(() => textarea?.focus(), 50);
  };

  // Single dedup-by-id merge so repeated tool announcements never duplicate approval cards
  const mergePendingApprovals = (incoming: ToolCallPayload[]) => {
    setPendingApprovals((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const tc of incoming) byId.set(tc.id, tc);
      return Array.from(byId.values());
    });
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
  const handleSendOrSteer = async (customText?: string, isSteering = false) => {
    if (isSubmittingRef.current) return;
    const textToSend = customText || inputPrompt;
    if (!textToSend.trim() && !attachedImage) return;

    isSubmittingRef.current = true;
    setTimeout(() => {
      isSubmittingRef.current = false;
    }, 400);

    // If generating and user wants to steer, first pause the active stream cleanly
    if (isAgentGenerating) {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        intentionalCloseRef.current = true;
        socketRef.current.send(
          JSON.stringify({
            channel: 0x05,
            type: 'cancel',
            timestamp: Date.now(),
          })
        );
        socketRef.current.close();
      }
      socketRef.current = null;
      registerQuestionSender(null);
      updateLastMessageContent('\n\n*(Steering agent with new direction...)*');
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    let userContent = textToSend.trim();
    const isGoalTriggered = isGoalMode || userContent.includes('/goal');
    if (userContent.includes('/goal')) {
      userContent = userContent.replace(/\/goal/g, '').trim() || 'Autonomous mission execution';
    }

    const userText = isSteering ? `[STEERING]: ${userContent}` : userContent;
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
      timestamp: Date.now(),
    };
    appendUserMessageDeduped(userMsg);

    // Prepare assistant message (appends seamlessly to preserved history)
    const assistantMsg: OmniAgentMessage = {
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
      const wsHost = window.location.port === '5173' ? `${window.location.hostname}:3001` : window.location.host;
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
            const hasText = Boolean(stripToolCallMarkers(m.content || '').trim());
            const hasToolCalls = Boolean(m.toolCalls && m.toolCalls.length > 0);
            const hasImages = Boolean(chatMsg.images && chatMsg.images.length > 0);
            return m.role !== 'tool' && (hasText || hasToolCalls || hasImages);
          })
          .flatMap((m): WireMessage[] => {
            const chatMsg = m as ChatMessage;
            const text = stripToolCallMarkers(m.content || '').trim();

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

        ws.send(
          JSON.stringify({
            channel: 0x05, // AGENT_STREAM
            type: 'prompt',
            payload: {
              model: useIDEStore.getState().activeModel?.id || 'auto',
              messages: serializedMessages,
              permissionLevel: permissionLevel,
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
        // Ignore packets arriving from a superseded socket during steer/pause transitions
        if (socketRef.current !== ws) return;
        try {
          const packet = JSON.parse(event.data);

          // Shared ask_user contract: surface the question through the store-backed card
          if (packet.type === 'agent_question') {
            const qid = String(packet.id ?? `question-${Date.now()}`);
            const questionText = String(packet.question ?? '');
            askQuestionsRef.current.set(qid, questionText);
            useIDEStore.getState().setPendingAgentQuestion({
              id: qid,
              question: questionText,
              options: Array.isArray(packet.options) ? packet.options.map(String) : [],
              allowFreeText: packet.allowFreeText !== false,
            });
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
            updateToolCallResult(id, tool, result);

            // Refresh stores
            fetch('/api/swarm/status').then((r) => r.json()).then((d) => setSubagents(d.subagents || [])).catch(() => undefined);
            fetch('/api/media/assets').then((r) => r.json()).then((d) => setAssets(d || [])).catch(() => undefined);
            return;
          }

          if (packet.channel === 0x06 && packet.type === 'error') {
            const { tool, error, id } = packet.payload;
            updateToolCallError(id, tool, error);
            return;
          }

          if (packet.channel === 0x05 && packet.type === 'inline_diff') {
            useIDEStore.getState().setInlineDiff(packet.payload);
            return;
          }

          if (packet.channel === 0x05 && packet.type === 'chunk') {
            const chunk = packet.payload;
            if (chunk.thinking) {
              updateAgentThinking(chunk.thinking);
            }
            if (chunk.resetContent) {
              useIDEStore.getState().resetLastMessageContent();
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
              setIsAgentGenerating(false);
              setIsPaused(false);
              flushSessionSync();
              const sock = socketRef.current;
              socketRef.current = null;
              sock?.close();
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

  const handleApprove = async (toolId: string) => {
    try {
      await fetch('/api/swarm/approve-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId: toolId }),
      });
      setPendingApprovals(pendingApprovals.filter((p) => p.id !== toolId));
    } catch (e) {
      console.error(e);
    }
  };

  const handleReject = async (toolId: string) => {
    try {
      await fetch('/api/swarm/reject-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId: toolId }),
      });
      setPendingApprovals(pendingApprovals.filter((p) => p.id !== toolId));
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

  const handleRetryLastPrompt = useCallback(() => {
    dismissConnectionLost();
    const lastUserMsg = [...agentMessagesRef.current].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      handleSendOrSteer(sanitizeResendText(lastUserMsg.content));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissConnectionLost]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0c10] border-l border-white/[0.07] select-text">
      {/* Header */}
      <div className="p-2.5 border-b border-obsidian-hairline bg-obsidian-surface1 flex items-center justify-between relative z-20">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkPrimary overflow-hidden shrink-0">
            <img src="/assets/sutra-icon.svg" alt="Astra" className="w-5 h-5 object-contain" />
          </div>
          <div className="min-w-0 relative">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-xs font-bold text-obsidian-inkPrimary">Astra</h3>
              {isAgentGenerating && (
                <span className="flex items-center gap-1 text-[10px] font-mono text-obsidian-inkSecondary bg-white/[0.08] border border-white/10 px-1.5 py-0.5 rounded-full">
                  <Clock className="w-2.5 h-2.5 text-obsidian-inkPrimary" />
                  <span>{elapsedSeconds.toFixed(1)}s</span>
                </span>
              )}
              <button
                onClick={() => setIsGoalMode(!isGoalMode)}
                className={`px-2 py-0.5 rounded-full border text-[9px] font-mono transition-colors cursor-pointer flex items-center gap-1 ${
                  isGoalMode
                    ? 'bg-white/10 border-white/20 text-white font-semibold'
                    : 'bg-obsidian-surface2 border-obsidian-hairline text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                }`}
                title="Toggle /goal Continuous Autonomous Loop Mode"
              >
                <Target className="w-2.5 h-2.5" />
                <span>{isGoalMode ? '/goal ON' : '/goal'}</span>
              </button>
              <ModelSelectorDropdown buttonVariant="compact" />
            </div>
          </div>
        </div>

        {/* Dynamic Pause / Resume Header Control & Session History */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* New Chat & History Controls */}
          <button
            onClick={handleNewChat}
            className="px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-obsidian-inkSecondary hover:text-white border border-white/10 text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
            title="Start a fresh chat session"
          >
            <Plus className="w-3 h-3 text-obsidian-inkMuted" />
            <span className="hidden sm:inline">New</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className={`px-2 py-1 rounded-lg border text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer ${
                isHistoryOpen
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-white/[0.04] hover:bg-white/[0.08] text-obsidian-inkSecondary hover:text-white border-white/10'
              }`}
              title="View past chat sessions"
            >
              <History className="w-3 h-3 text-obsidian-inkMuted" />
              <span className="hidden sm:inline">History</span>
            </button>

            {/* History Dropdown Drawer */}
            {isHistoryOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsHistoryOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-80 max-h-96 overflow-y-auto bg-obsidian-surface1 border border-white/15 rounded-xl shadow-2xl p-2 z-50 space-y-1 text-xs">
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/10 text-[10px] font-mono text-obsidian-inkMuted uppercase tracking-wider px-1">
                    <span>Chat Sessions ({sessions.length})</span>
                    <button
                      onClick={handleNewChat}
                      className="text-white hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New Chat</span>
                    </button>
                  </div>
                  {sessions.length === 0 ? (
                    <div className="p-4 text-center text-obsidian-inkMuted text-xs font-mono">No previous sessions</div>
                  ) : (
                    sessions.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => handleSelectSession(s.id)}
                        className={`w-full p-2 rounded-lg flex items-center justify-between group transition-colors cursor-pointer ${
                          s.id === currentSessionId
                            ? 'bg-white/10 text-white'
                            : 'hover:bg-white/[0.06] text-obsidian-inkSecondary hover:text-white'
                        }`}
                      >
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <MessageSquare className="w-3.5 h-3.5 text-obsidian-inkMuted mt-0.5 shrink-0" />
                          <div className="truncate text-left">
                            <div className="truncate text-[11px]">{s.title || 'Autonomous Task'}</div>
                            <div className="text-[9px] text-obsidian-inkMuted font-mono">
                              {s.message_count || 0} msgs • {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : ''}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteSession(s.id, e)}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-obsidian-inkMuted hover:text-red-400 transition-all cursor-pointer ml-1"
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
        </div>
      </div>

      {/* Messages Feed */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 relative"
      >
        {agentMessages.length === 0 && (
          <div className="min-h-full flex flex-col items-center justify-center text-center p-6 text-obsidian-inkMuted select-none my-auto">
            <div className="w-12 h-12 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkPrimary mb-3 overflow-hidden shadow-lg shadow-black/40">
              <img src="/assets/sutra-icon.svg" alt="Astra" className="w-8 h-8 object-contain" />
            </div>
            <div className="font-semibold text-obsidian-inkPrimary text-xs mb-1">Astra — Autonomous Engineering Agent</div>
            <p className="text-[11px] max-w-xs text-obsidian-inkMuted leading-relaxed">
              Describe the feature, bugfix, or full stack app you want to build in this workspace.
            </p>
          </div>
        )}

        {agentMessages.map((msg, idx) => {
          const isLastMessage = idx === agentMessages.length - 1;
          const isPausedMessage = isLastMessage && isPaused && msg.role === 'assistant';
          const isErrorNotice = msg.role === 'assistant' && typeof msg.content === 'string' && (msg.content.includes('Error:') || msg.content.includes('Connection lost'));
          const userImages = msg.role === 'user' ? (msg as ChatMessage).images : undefined;

          // Hide placeholder bubbles while they carry nothing at all — failed attempts stay visible
          if (msg.role === 'assistant' && !isErrorNotice && !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0)) {
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
                className={`max-w-[94%] p-3 rounded-xl transition-colors ${
                  msg.role === 'user'
                    ? 'bg-white text-black font-medium'
                    : isPausedMessage
                    ? 'bg-obsidian-surface3 border border-white/20 text-white shadow-xl'
                    : isErrorNotice
                    ? 'bg-red-950/40 border border-red-500/30 text-red-50'
                    : 'bg-obsidian-surface3/90 border border-white/10 text-obsidian-inkPrimary'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <SequentialMessageRenderer content={msg.content} toolCalls={msg.toolCalls || []} />
                ) : (
                  <>
                    <div className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{msg.content}</div>
                    {userImages && userImages.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {userImages.map((src, i) => (
                          <img key={i} src={src} alt={`Attachment ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-black/10" />
                        ))}
                      </div>
                    )}
                  </>
                )}

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
                  <div className="mt-3 pt-2.5 border-t border-red-500/20 flex flex-wrap items-center gap-2 select-none">
                    <button
                      onClick={handleRetryLastPrompt}
                      className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                      title="Retry Last Request"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry Prompt</span>
                    </button>
                    <button
                      onClick={() => useIDEStore.getState().setSettingsOpen(true)}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-obsidian-inkSecondary hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Configure AI API Keys in Settings"
                    >
                      <Settings className="w-3 h-3" />
                      <span>Configure API Keys</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Shared transient connection-lost banner — at most ONE, dismissible, auto-clears on the next run */}
        {connectionLost && (
          <ConnectionLostBanner onRetry={handleRetryLastPrompt} />
        )}

        {/* Single quiet status row while Astra works or waits — the only loader on this surface */}
        {agentStatus.key !== 'idle' && (
          <div
            role="status"
            aria-live="polite"
            title={agentStatus.detail}
            className="px-2.5 h-8 flex items-center gap-2 rounded-xl bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkSecondary text-[11px]"
          >
            {agentStatus.key === 'working' && (
              <Loader2 className="w-3 h-3 animate-spin shrink-0 text-obsidian-inkPrimary" />
            )}
            <span>{agentStatus.label}</span>
          </div>
        )}

        {/* Live Thinking / Reasoning Trace — collapsible one-liner with no loader semantics */}
        {isAgentGenerating && currentAgentThinking && (
          <div className="rounded-xl bg-obsidian-surface1 border border-obsidian-hairline text-xs animate-in fade-in overflow-hidden">
            <div
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              className="flex items-center justify-between cursor-pointer text-obsidian-inkSecondary font-mono text-[11px] select-none h-9 px-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <BrainCircuit className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" />
                <span className="shrink-0">Thinking</span>
                {!isThinkingExpanded && (
                  <span className="truncate text-obsidian-inkMuted font-normal">— {currentAgentThinking}</span>
                )}
              </div>
              {isThinkingExpanded ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
            </div>

            {isThinkingExpanded && (
              <div className="font-mono text-[10px] text-obsidian-inkMuted whitespace-pre-wrap pl-3 border-l border-obsidian-hairline mx-3 mb-2 max-h-40 overflow-y-auto rounded-lg">
                {currentAgentThinking}
              </div>
            )}
          </div>
        )}

        {/* Action Approvals */}
        {pendingApprovals.map((pa) => (
          <ApprovalCard
            key={pa.id}
            toolCall={pa}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))}

        {/* Pending Agent Question (shared ask_user card, with toolCall-params hydration fallback) */}
        {(pendingAgentQuestion || askUserFallback) && <AskUserCard fallback={askUserFallback} />}

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

      {/* Quick Steer & Action Chips */}
      <div className="px-3 py-1 bg-obsidian-surface1 border-t border-obsidian-hairline flex items-center gap-1.5 overflow-x-auto no-scrollbar select-none">
        <span className="text-[10px] font-mono text-obsidian-inkMuted shrink-0">
          Steer:
        </span>
        {[
          { label: '/goal Autonomous Loop', icon: Target, prompt: '/goal Run full autonomous iteration loop: inspect codebase, execute all steps, write files, run tests, and fix issues until completely finished.' },
          { label: 'Fix All Errors', icon: Wrench, prompt: 'Audit all files in the workspace, run typecheck, and fix errors autonomously' },
          { label: 'Scaffold App', icon: Rocket, prompt: 'Scaffold and complete the full web application architecture in this workspace' },
          { label: 'QA & Security Audit', icon: ShieldCheck, prompt: 'Run complete Anti-Slop Visual QA, WCAG 2.2 AA, and dependency security audit' },
          { label: 'Responsive UI', icon: Smartphone, prompt: 'Make sure all components are responsive across desktop, tablet, and mobile' },
          { label: 'Generate Assets', icon: Film, prompt: 'Generate the required image and audio assets for this project' },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <button
              key={i}
              onClick={() => handleSendOrSteer(item.prompt, isAgentGenerating || isPaused)}
              className="px-2.5 py-0.5 rounded-full bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-hairline text-[10px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 font-mono"
            >
              <Icon className="w-2.5 h-2.5 text-obsidian-inkMuted" />
              <span>{item.label}</span>
            </button>
          );
        })}
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] text-[10px] font-mono uppercase tracking-wider text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            >
              Review
            </button>
          </div>
        )}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageSelect}
          accept="image/*"
          className="hidden"
        />

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

        <div className="rounded-lg bg-obsidian-surface2 border border-obsidian-hairline focus-within:border-obsidian-border transition-colors relative">
          {mentionFilter !== null && (
            <MentionAutocomplete
              filter={mentionFilter}
              onSelect={handleSelectMention}
              onClose={() => setMentionFilter(null)}
            />
          )}

          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={handleInputChange}
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
              isAgentGenerating
                ? "Type to steer agent mid-flight..."
                : isPaused
                ? "Instruct or steer resumed execution..."
                : "Instruct Astra (type @ for files, symbols, docs)..."
            }
            rows={3}
            className="w-full bg-transparent px-3 py-2 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none resize-none font-sans"
          />

          <div className="flex items-center justify-between px-3 py-1.5 border-t border-obsidian-hairline text-[10px] text-obsidian-inkMuted">
            <div className="flex items-center gap-2 font-mono min-w-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
                title="Attach image"
                aria-label="Attach image"
              >
                <Paperclip className="w-3 h-3" />
              </button>
              <span className="truncate">@ to mention · Shift+Enter for newline</span>
            </div>

            {/* Fixed-height action slot: Send / Steer / Pause swap inside an equal box so the composer never shifts */}
            <div className="flex items-center gap-2 shrink-0">
              {isAgentGenerating ? (
                inputPrompt.trim() ? (
                  <button
                    onClick={() => handleSendOrSteer(undefined, true)}
                    className="px-3 py-1 rounded bg-obsidian-inkPrimary text-obsidian-canvas text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                    title="Steer agent mid-flight with this new instruction"
                  >
                    <Compass className="w-3 h-3" />
                    <span>Steer</span>
                  </button>
                ) : (
                  <button
                    onClick={handlePauseGeneration}
                    className="px-3 py-1 rounded bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                    title="Pause Generation"
                  >
                    <Pause className="w-3 h-3 fill-current" />
                    <span>Pause</span>
                  </button>
                )
              ) : (
                <button
                  onClick={() => handleSendOrSteer()}
                  disabled={!inputPrompt.trim() && !attachedImage}
                  className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    inputPrompt.trim() || attachedImage
                      ? 'bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-obsidian-accentHover'
                      : 'bg-obsidian-surface3 text-obsidian-inkMuted opacity-50 cursor-not-allowed'
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
    </div>
  );
};
