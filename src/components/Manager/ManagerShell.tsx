import React, { useEffect, useMemo, useRef, useState } from 'react';

interface ManagedProcessRow {
  id: string;
  command: string;
  port: number | null;
  status: string;
  attempts: number;
  lastError: string | null;
}

/** Antigravity-style "N tasks running" collapsible above the composer. */
const RunningTasksBar: React.FC = () => {
  const [processes, setProcesses] = useState<ManagedProcessRow[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch('/api/processes')
        .then((r) => r.json())
        .then((d) => setProcesses(Array.isArray(d.processes) ? d.processes : []))
        .catch(() => undefined);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const active = processes.filter((p) => p.status === 'running' || p.status === 'starting');
  if (active.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-obsidian-hairline bg-obsidian-canvas">
      <div className="max-w-3xl mx-auto w-full px-4 pt-2">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="w-full flex items-center gap-2 rounded-lg border border-obsidian-border bg-obsidian-surface1 px-3 py-1.5 text-[11px] font-mono text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        >
          <Loader2 className="w-3 h-3 animate-spin text-obsidian-inkSecondary" aria-hidden="true" />
          <span>
            {active.length} task{active.length === 1 ? '' : 's'} running
          </span>
          <span className="flex-1 min-w-0 truncate text-obsidian-inkMuted text-left">
            {active[0].command.split(/\s+/).slice(0, 3).join(' ')}
            {active[0].port ? ` :${active[0].port}` : ''}
          </span>
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {expanded && (
          <div className="mt-1 space-y-1">
            {active.map((proc) => (
              <div key={proc.id} className="px-3 py-1.5 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline text-[10px] font-mono text-obsidian-inkMuted truncate">
                {proc.command}
                {proc.port ? ` → :${proc.port}` : ''}
                {proc.status === 'starting' && proc.attempts > 1 ? ` (retry ${proc.attempts})` : ''}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
import { ChevronDown, ChevronRight, Coffee, FileCode, KeyRound, Loader2, MonitorPlay, X } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { cancelAgentStream, registerQuestionSender, sendAgentPrompt } from '../../utils/agentSocket.js';
import { MarkdownRenderer } from '../Agent/MarkdownRenderer.js';
import { ToolCard } from '../Agent/ToolCard.js';
import { ApprovalCard } from '../Agent/ApprovalCard.js';
import { SettingsModal } from '../Settings/SettingsModal.js';
import { QRPairingModal } from '../MobileConnect/QRPairingModal.js';
import { AskUserCard, findAskUserFallback } from '../Common/AskUserCard.js';
import { OmniAgentMessage } from '../../types/ide.js';
import { ManagerSidebar, WorkspaceMenu } from './ManagerSidebar.js';
import { useAuthStore } from '../../stores/authStore.js';
import { ManagerComposer } from './ManagerComposer.js';
import { ActivityPanel } from './ActivityPanel.js';
import { ManagerDiffView, collectChangedFiles } from './ManagerDiffView.js';

const WELCOME_MESSAGE: OmniAgentMessage = {
  id: 'msg-welcome',
  role: 'assistant',
  content: `I'm Astra — I read, write, and run code in your workspace. What are we building?`,
  timestamp: Date.now(),
};

const ATTACH_MARKER = '\n\n[Attached file: ';

/** Splits a stored user message into display text and attachment name (if any). */
const splitAttachment = (content: string): { display: string; attachmentName: string | null } => {
  const idx = content.indexOf(ATTACH_MARKER);
  if (idx === -1) return { display: content, attachmentName: null };
  const rest = content.slice(idx + ATTACH_MARKER.length);
  const end = rest.indexOf(']');
  return { display: content.slice(0, idx), attachmentName: end === -1 ? rest : rest.slice(0, end) };
};

/**
 * Chronological renderer for assistant output: interleaves markdown text
 * chunks with tool cards using the <!-- TOOL_CALL:id --> markers the stream
 * injects. Mirrors the sanitizer in AgentChat so raw protocol tags never leak.
 */
const AssistantMessageBody: React.FC<{ message: OmniAgentMessage }> = ({ message }) => {
  const safeTools = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const toolMap = new Map(safeTools.map((tc) => [tc.id, tc]));
  const renderedToolIds = new Set<string>();

  const sanitized = (typeof message.content === 'string' ? message.content : '')
    .replace(/>\s*⚙️\s*\*\[Round\s*\d+\]\s*Executing[\s\S]*?\*\s*\n*/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function=[a-zA-Z0-9_]+>[\s\S]*?<\/function>/gi, '')
    .replace(/<parameter=[a-zA-Z0-9_]+>[\s\S]*?<\/parameter>/gi, '')
    .replace(/<\/function>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<\/?(?:tool_call|function|parameter|think|thought|function_call)[^>]*>/gi, '')
    .replace(/```json\s*\{[\s\S]*?"(?:name|tool)"\s*:[\s\S]*?\}\s*```/gi, '')
    .trim();

  const parts = sanitized.split(/<!-- TOOL_CALL:(.*?) -->/g);
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i] && parts[i].trim()) {
        elements.push(<MarkdownRenderer key={`text-${i}`} content={parts[i]} />);
      }
    } else {
      const toolCall = toolMap.get(parts[i].trim());
      if (toolCall) {
        renderedToolIds.add(toolCall.id);
        elements.push(<ToolCard key={toolCall.id} toolCall={toolCall} />);
      }
    }
  }

  for (const tc of safeTools.filter((t) => !renderedToolIds.has(t.id))) {
    elements.push(<ToolCard key={tc.id} toolCall={tc} />);
  }

  if (elements.length === 0) {
    return <MarkdownRenderer content={sanitized} />;
  }
  return <div className="space-y-2.5">{elements}</div>;
};

export const ManagerShell: React.FC = () => {
  const {
    setUiMode,
    agentMessages,
    updateLastMessageContent,
    isAgentGenerating,
    currentAgentThinking,
    pendingApprovals,
    pendingAgentQuestion,
    setPendingApprovals,
    availableModels,
    isSettingsOpen,
    setSettingsOpen,
  } = useIDEStore();

  const [sessionId, setSessionId] = useState<string>(() => `session-${Date.now()}`);
  const authWorkspaces = useAuthStore((s) => s.workspaces);
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const workspaceName =
    authWorkspaces.find((w) => w.id === activeWorkspaceId)?.name || authWorkspaces[0]?.name || 'This workspace';
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSettingsBannerDismissed, setIsSettingsBannerDismissed] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const forcedScrollSessionRef = useRef<string | null>(null);

  const hasUserMessages = agentMessages.some((m) => m.role === 'user');
  const showGreeting = !hasUserMessages;

  // ask_user hydration fallback: when the agent_question packet missed the
  // store slice, rebuild the question from the raw ask_user toolCall params.
  const askUserFallback = useMemo(
    () => (isAgentGenerating ? findAskUserFallback(agentMessages) : null),
    [agentMessages, isAgentGenerating]
  );
  const showSettingsBanner = availableModels.length === 0 && !isSettingsBannerDismissed;

  // Review flow: distinct files changed via completed write/edit/delete calls
  const changedFiles = useMemo(() => collectChangedFiles(agentMessages), [agentMessages]);

  // Single consolidated run status: one quiet row replaces every staged loader.
  // While an ask_user question or approval is pending, Astra is parked on the user.
  const isWaitingOnUser = Boolean(pendingAgentQuestion) || pendingApprovals.length > 0;
  const showStatusRow = isAgentGenerating || isWaitingOnUser;

  // Unregister the ask_user sender and drop any parked question when leaving Manager mode
  useEffect(() => {
    return () => {
      registerQuestionSender(null);
      useIDEStore.getState().setPendingAgentQuestion(null);
    };
  }, []);

  // Persist transcript to the shared session store (same endpoint AgentChat syncs to)
  useEffect(() => {
    if (agentMessages.length <= 1 || !sessionId) return;
    const firstUserMsg = [...agentMessages].reverse().find((m) => m.role === 'user');
    const title = firstUserMsg
      ? splitAttachment(firstUserMsg.content).display.split('\n')[0].slice(0, 45)
      : 'New conversation';
    fetch(`/api/chat/sessions/${sessionId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, messages: agentMessages }),
    })
      .then(() => setRefreshKey((k) => k + 1))
      .catch(() => undefined);
  }, [agentMessages, sessionId]);

  // Auto-scroll only when already near the bottom — streaming never yanks the
  // viewport; a fresh session always lands on the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (forcedScrollSessionRef.current !== sessionId) {
      forcedScrollSessionRef.current = sessionId;
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }));
      return;
    }
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 160) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [agentMessages, currentAgentThinking, sessionId]);

  const handleSend = (text: string, attachment: { name: string; content: string } | null) => {
    if (!text.trim() && !attachment) return;
    const attachedContext = attachment ? `${ATTACH_MARKER}${attachment.name}]\n${attachment.content}` : null;
    sendAgentPrompt({ text, attachedContext }).catch(() => undefined);
  };

  const handleCancel = () => {
    cancelAgentStream();
    updateLastMessageContent('\n\n*(Generation stopped. All progress preserved — continue anytime.)*');
  };

  // Review overlay: jump into the full IDE with the first changed file loaded
  const handleOpenInIde = (path: string) => {
    setIsDiffOpen(false);
    setUiMode('ide');
    void useIDEStore.getState().openFilePath(path);
  };

  const handleNewConversation = () => {
    const newId = `session-${Date.now()}`;
    setSessionId(newId);
    useIDEStore.setState({ agentMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }] });
    fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId, title: 'New conversation' }),
    })
      .then(() => setRefreshKey((k) => k + 1))
      .catch(() => undefined);
  };

  const handleOpenConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        useIDEStore.setState({ agentMessages: data.messages });
        setSessionId(id);
      }
    } catch {
      // Keep current view on failure — list row simply won't switch
    }
  };

  // Reopening the app lands back in the most recent conversation instead of a
  // blank hero — the chat survives refreshes and closes.
  useEffect(() => {
    let cancelled = false;
    const restoreLastSession = async () => {
      try {
        const res = await fetch('/api/chat/sessions');
        const data = await res.json();
        const sessions: Array<{ id: string; message_count: number }> = Array.isArray(data.sessions) ? data.sessions : [];
        const latest = sessions.find((s) => s.message_count > 0);
        if (latest && !cancelled) {
          await handleOpenConversation(latest.id);
        }
      } catch {
        // Offline or fresh install — the hero stays
      }
    };
    restoreLastSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDeleteConversation = async (id: string) => {
    const confirmed = window.confirm('Delete this conversation? This cannot be undone.');
    if (!confirmed) return;
    try {
      await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
      if (useIDEStore.getState().pinnedSessionIds.includes(id)) {
        useIDEStore.getState().togglePinSession(id);
      }
      if (id === sessionId) handleNewConversation();
      else setRefreshKey((k) => k + 1);
    } catch {
      // Deletion failed server-side; list refreshes and shows the truth
      setRefreshKey((k) => k + 1);
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

  return (
    <div className="h-screen w-screen flex flex-col bg-obsidian-canvas text-obsidian-inkPrimary overflow-hidden font-sans">
      {/* Top bar */}
      <header className="h-10 shrink-0 bg-obsidian-canvas border-b border-obsidian-hairline flex items-center justify-between px-3 select-none z-30 relative">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <img src="/assets/sutra-icon.svg" alt="SUTRA" className="w-4 h-4 object-contain" />
            <span className="font-bold tracking-widest uppercase text-[11px] text-obsidian-inkPrimary">SUTRA</span>
          </div>
        </div>

        {/* Sponsor link — centered */}
        <a
          href="https://buymeacoffee.com/gauravbatule"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/[0.07] hover:bg-amber-500/[0.15] text-[10px] font-mono uppercase tracking-wider text-amber-300 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50"
          title="Support the project"
        >
          <Coffee className="w-3 h-3" aria-hidden="true" />
          <span>Buy me a coffee</span>
        </a>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setUiMode('ide')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/10 transition-colors duration-150 text-[11px] font-mono cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            title="Switch to the full IDE workspace"
          >
            <MonitorPlay className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Open IDE</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar stays visible in every state — history is always one glance away */}
        <ManagerSidebar
          activeSessionId={sessionId}
          refreshKey={refreshKey}
          onNewConversation={handleNewConversation}
          onOpenConversation={handleOpenConversation}
          onDeleteConversation={handleDeleteConversation}
        />

        {/* Hero mode: greeting + workspace + composer centered both ways */}
        {showGreeting ? (
          <main className="flex-1 min-w-0 flex flex-col items-center justify-center overflow-y-auto px-4">
            <div className="w-full max-w-2xl flex flex-col items-center text-center space-y-6 py-10">
              <div className="space-y-2.5 animate-in fade-in duration-150">
                <div className="text-sm font-mono uppercase tracking-[0.35em] text-obsidian-inkSecondary select-none">
                  Astra
                </div>
                <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-obsidian-inkPrimary">
                  What are we building today?
                </h1>
                <p className="text-xs text-obsidian-inkMuted max-w-md mx-auto leading-relaxed">
                  I read, write, and run code in your workspace — describe a feature, paste an error, or attach a file,
                  and Astra plans, builds, and verifies it.
                </p>
                {availableModels.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-obsidian-inkMuted hover:text-obsidian-inkSecondary underline underline-offset-2 decoration-white/20 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
                  >
                    Connect models in Settings
                  </button>
                )}
              </div>

              {/* Workspace selection without leaving the chat home */}
              <div className="w-full flex justify-center">
                <div className="w-full max-w-sm">
                  <WorkspaceMenu workspaceName={workspaceName} />
                </div>
              </div>

              <div className="w-full">
                <ManagerComposer
                  isGenerating={isAgentGenerating}
                  onSend={handleSend}
                  onCancel={handleCancel}
                  showQuickActions
                />
              </div>
            </div>
          </main>
        ) : (
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Transcript region */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-4 pt-3 pb-6">
            {showSettingsBanner && (
              <div role="status" className="-mx-4 mb-3 px-4 pt-2">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-obsidian-surface2 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0 text-[11px] text-obsidian-inkSecondary">
                    <KeyRound className="w-3.5 h-3.5 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
                    <span className="truncate">Add API keys or cookies in Settings to connect models.</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setSettingsOpen(true)}
                      className="px-2.5 py-1 rounded-md border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] text-[10px] font-mono uppercase tracking-wider text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                    >
                      Open Settings
                    </button>
                    <button
                      onClick={() => setIsSettingsBannerDismissed(true)}
                      aria-label="Dismiss settings banner"
                      title="Dismiss"
                      className="p-1 rounded-md text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.07] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showGreeting && (
              <div className="pt-12 pb-6 text-center space-y-2.5 animate-in fade-in duration-150">
                <div className="text-sm font-mono uppercase tracking-[0.35em] text-obsidian-inkSecondary select-none">
                  Astra
                </div>
                <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-obsidian-inkPrimary">
                  What are we building today?
                </h1>
                <p className="text-xs text-obsidian-inkMuted max-w-md mx-auto leading-relaxed">
                  I read, write, and run code in your workspace — describe a feature, paste an error, or attach a file,
                  and Astra plans, builds, and verifies it.
                </p>
                {availableModels.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-obsidian-inkMuted hover:text-obsidian-inkSecondary underline underline-offset-2 decoration-white/20 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
                  >
                    Connect models in Settings
                  </button>
                )}
              </div>
            )}

            {/* Transcript */}
            {!showGreeting && (
              <div className="space-y-4" role="log" aria-label="Conversation transcript" aria-live="polite">
                {agentMessages.map((msg) => {
                  const isEmptyAssistant =
                    msg.role === 'assistant' && !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0);
                  // Empty placeholders render nothing — the single status row below covers progress
                  if (isEmptyAssistant) {
                    return null;
                  }

                  if (msg.role === 'user') {
                    const { display, attachmentName } = splitAttachment(msg.content);
                    return (
                      <div key={msg.id} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl bg-white text-black px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words select-text">
                          {display}
                          {attachmentName && (
                            <div className="mt-1.5 pt-1.5 border-t border-black/10 text-[10px] font-mono opacity-70">
                              Attached: {attachmentName}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className="flex flex-col items-start">
                      <div className="w-full rounded-xl bg-obsidian-surface1 border border-obsidian-border p-3 text-xs leading-relaxed select-text">
                        <AssistantMessageBody message={msg} />
                      </div>
                    </div>
                  );
                })}

                {/* Thinking trace — stays as one collapsible line while streaming */}
                {isAgentGenerating && currentAgentThinking && (
                  <div className="rounded-lg border border-obsidian-hairline bg-obsidian-surface1">
                    <button
                      type="button"
                      onClick={() => setIsTraceOpen((open) => !open)}
                      aria-expanded={isTraceOpen}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer group rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                    >
                      {isTraceOpen ? (
                        <ChevronDown className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
                      )}
                      <span className="shrink-0 text-[11px] font-mono text-obsidian-inkMuted group-hover:text-obsidian-inkSecondary transition-colors duration-150">
                        Reasoning
                      </span>
                      {!isTraceOpen && (
                        <span className="truncate text-[11px] font-mono text-obsidian-inkMuted">{currentAgentThinking}</span>
                      )}
                    </button>
                    {isTraceOpen && (
                      <div className="px-3 pb-2.5 pl-[26px] text-[11px] leading-relaxed text-obsidian-inkSecondary whitespace-pre-wrap break-words select-text">
                        {currentAgentThinking}
                      </div>
                    )}
                  </div>
                )}

                {pendingApprovals.map((pa) => (
                  <ApprovalCard key={pa.id} toolCall={pa} onApprove={handleApprove} onReject={handleReject} />
                ))}

                {/* ask_user card — self-hiding; keeps the answered Q&A inline inside the transcript.
                    Hydrates from the raw toolCall params when the agent_question packet missed the store. */}
                <AskUserCard fallback={askUserFallback} />

                {/* Single quiet run-status row — the only loader label in Manager mode */}
                {showStatusRow && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 px-1 py-0.5 text-[11px] font-mono text-obsidian-inkMuted"
                  >
                    {isAgentGenerating && !isWaitingOnUser && (
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />
                    )}
                    <span>{isWaitingOnUser ? 'Astra is waiting for your answer' : 'Astra is working'}</span>
                  </div>
                )}
              </div>
            )}

            <div ref={bottomRef} aria-hidden="true" />
          </div>
          </div>

          {/* Review summary row — completed write/edit/delete calls in this session; fixed above the composer */}
          {!showGreeting && changedFiles.length > 0 && (
            <div className="shrink-0 border-t border-obsidian-hairline bg-obsidian-canvas">
              <div className="max-w-3xl mx-auto w-full px-4 py-2">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-obsidian-border bg-obsidian-surface1 px-3 py-1.5">
                  <div className="flex items-center gap-2 min-w-0 text-[11px] font-mono text-obsidian-inkSecondary">
                    <FileCode className="w-3.5 h-3.5 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
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
                  {(() => {
                    const siteFile = changedFiles.find((f) => /index\.html?$/i.test(f.path)) || changedFiles.find((f) => /\.html?$/i.test(f.path));
                    if (!siteFile) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => window.open(`/workspace/${String(siteFile.path).replace(/\\/g, '/').replace(/^\//, '')}`, '_blank', 'noopener')}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-[10px] font-mono uppercase tracking-wider text-emerald-300 transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/50"
                        title="Run the generated website in a browser tab"
                      >
                        Run site
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setIsDiffOpen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] text-[10px] font-mono uppercase tracking-wider text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                  >
                    Review
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Live task indicator (Antigravity-style) — above the composer */}
          <RunningTasksBar />

          {/* Composer — anchored to the bottom edge; never floats between sections or shifts */}
          <div className="shrink-0 border-t border-obsidian-hairline bg-obsidian-canvas">
            <div className="max-w-3xl mx-auto w-full px-4 pt-2 pb-3">
              <ManagerComposer
                isGenerating={isAgentGenerating}
                onSend={handleSend}
                onCancel={handleCancel}
                showQuickActions={false}
              />
            </div>
          </div>
        </main>
        )}

        {/* Right-side activity panel (Antigravity-style); hides in hero mode and on narrow widths */}
        {!showGreeting && <ActivityPanel />}
      </div>

      {/* Settings renders above Manager mode via its fixed z-50 overlay */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Shared QR pairing modal — the sidebar's "Pair Phone (QR)" row is its only Manager entry */}
      <QRPairingModal />

      {/* Review overlay: side-by-side diffs of every file changed this session */}
      <ManagerDiffView
        open={isDiffOpen}
        entries={changedFiles}
        onClose={() => setIsDiffOpen(false)}
        onOpenInIde={handleOpenInIde}
      />
    </div>
  );
};
