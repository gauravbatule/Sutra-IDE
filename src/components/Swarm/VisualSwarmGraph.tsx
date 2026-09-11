import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Send,
  XCircle,
  Bot
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import type { SubagentState, ToolCallPayload } from '../../types/ide.js';

/** Running statuses render a live spinner; terminal states get a fixed icon. */
const isTerminalStatus = (status: SubagentState['status']): boolean =>
  status === 'completed' || status === 'failed';

const StatusIcon: React.FC<{ status: SubagentState['status'] }> = ({ status }) => {
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />;
  if (status === 'failed') return <XCircle className="w-3.5 h-3.5 shrink-0" />;
  return <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />;
};

// Accepts both SubagentState and ToolCallPayload status values; unknown
// statuses fall through to the neutral chip.
const statusChipClass = (status: string): string => {
  if (status === 'completed') return 'bg-obsidian-surface2 text-obsidian-inkPrimary border-obsidian-border';
  if (status === 'failed') return 'bg-red-950/40 text-red-400 border-red-800/60';
  return 'bg-obsidian-surface1 text-obsidian-inkSecondary border-obsidian-hairline';
};

const prettyRole = (role: string): string =>
  role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** One-line truncated preview of a tool call result for the activity tail. */
const summarizeResult = (result: unknown): string => {
  if (result === undefined || result === null) return '';
  try {
    const raw = typeof result === 'string' ? result : JSON.stringify(result);
    return raw.replace(/\s+/g, ' ').slice(0, 160);
  } catch {
    return '';
  }
};

const ToolCallRow: React.FC<{ call: ToolCallPayload }> = ({ call }) => {
  const failed = call.status === 'failed' || Boolean(call.error);
  return (
    <div className="p-2 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline space-y-1">
      <div className="flex items-center gap-1.5 min-w-0">
        {call.status === 'completed' && !failed ? (
          <CheckCircle2 className="w-3 h-3 text-obsidian-inkPrimary shrink-0" />
        ) : failed ? (
          <XCircle className="w-3 h-3 text-red-400 shrink-0" />
        ) : (
          <Loader2 className="w-3 h-3 text-obsidian-inkSecondary shrink-0 animate-spin" />
        )}
        <span className="text-[11px] font-mono font-semibold text-obsidian-inkPrimary truncate">{call.tool}</span>
        <span className={`ml-auto text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusChipClass(failed ? 'failed' : call.status)}`}>
          {failed ? 'Failed' : call.status}
        </span>
      </div>
      {(summarizeResult(call.result) || call.error) && (
        <p className={`text-[10px] font-mono leading-relaxed break-words ${failed && call.error ? 'text-red-400' : 'text-obsidian-inkMuted'}`}>
          {failed && call.error ? call.error : summarizeResult(call.result)}
        </p>
      )}
    </div>
  );
};

export const VisualSwarmGraph: React.FC = () => {
  const subagents = useIDEStore((s) => s.subagents);
  const setSubagents = useIDEStore((s) => s.setSubagents);
  const addAgentMessage = useIDEStore((s) => s.addAgentMessage);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steerInput, setSteerInput] = useState('');
  // Client-side start stamps — the server payload carries no startedAt field.
  const startTimesRef = useRef<Map<string, number>>(new Map());

  for (const agent of subagents) {
    if (!startTimesRef.current.has(agent.id)) {
      startTimesRef.current.set(agent.id, Date.now());
    }
  }

  // Live activity feed: poll while mounted and commit only on a real change so
  // unchanged payloads never re-render the list (same dedupe as model polls).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/swarm/status');
        const data = await res.json();
        if (cancelled) return;
        const next: SubagentState[] = data.subagents || [];
        if (JSON.stringify(next) !== JSON.stringify(useIDEStore.getState().subagents)) {
          setSubagents(next);
        }
      } catch {
        // Keep last known state on transient errors
      }
    };
    const interval = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setSubagents]);

  const selectedAgent = selectedId ? subagents.find((a) => a.id === selectedId) : null;

  const handleSteerSubagent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!steerInput.trim() || !selectedAgent) return;

    addAgentMessage({
      id: `steer-${Date.now()}`,
      role: 'user',
      content: `[STEER SUBAGENT: ${selectedAgent.role}] ${steerInput.trim()}`,
      timestamp: Date.now(),
    });
    setSteerInput('');
  };

  const startTime = selectedAgent ? startTimesRef.current.get(selectedAgent.id) : undefined;

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1 border-r border-obsidian-hairline select-none overflow-hidden font-sans">
      {/* Header */}
      <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {selectedAgent ? (
            <button
              onClick={() => setSelectedId(null)}
              className="p-1 rounded-lg hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors"
              title="Back to all subagents"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <Bot className="w-4 h-4 text-obsidian-inkPrimary shrink-0" />
          )}
          <span className="text-[11px] font-bold uppercase tracking-widest text-obsidian-inkPrimary truncate">
            {selectedAgent ? prettyRole(selectedAgent.role) : 'Subagents'}
          </span>
        </div>
        {!selectedAgent && (
          <span className="text-[10px] font-mono text-obsidian-inkMuted bg-obsidian-surface2 px-1.5 py-0.5 rounded-full border border-obsidian-hairline">
            {subagents.length} Active
          </span>
        )}
      </div>

      {/* List view */}
      {!selectedAgent && (
        <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2">
          {subagents.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-obsidian-hairline rounded-xl">
              <Bot className="w-8 h-8 text-obsidian-inkMuted mb-2 opacity-50" />
              <p className="text-xs text-obsidian-inkPrimary font-medium">No subagents yet — Astra spawns them for parallel work.</p>
            </div>
          ) : (
            subagents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setSelectedId(agent.id)}
                className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                  'bg-obsidian-surface2 border-obsidian-hairline hover:border-obsidian-border hover:bg-obsidian-surface3'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={agent.status === 'failed' ? 'text-red-400' : agent.status === 'completed' ? 'text-obsidian-inkPrimary' : 'text-obsidian-inkSecondary'}>
                      <StatusIcon status={agent.status} />
                    </span>
                    <span className="text-xs font-semibold text-obsidian-inkPrimary truncate">{prettyRole(agent.role)}</span>
                  </div>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 flex items-center gap-1 ${statusChipClass(agent.status)} ${
                    !isTerminalStatus(agent.status) ? 'animate-pulse' : ''
                  }`}>
                    {agent.status}
                  </span>
                </div>

                <p className="text-[11px] text-obsidian-inkSecondary line-clamp-2">{agent.currentTask || agent.name}</p>

                {agent.lastMessage && (
                  <div className="mt-2 pt-2 border-t border-obsidian-hairline text-[10px] text-obsidian-inkMuted font-mono p-1.5 rounded-lg bg-obsidian-surface1/60">
                    <span>{summarizeResult(agent.lastMessage)}</span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* Detail view */}
      {selectedAgent && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${statusChipClass(selectedAgent.status)} ${
              !isTerminalStatus(selectedAgent.status) ? 'animate-pulse' : ''
            }`}>
              <StatusIcon status={selectedAgent.status} />
              {selectedAgent.status}
            </span>
            {startTime && (
              <span className="text-[10px] font-mono text-obsidian-inkMuted">
                Started {new Date(startTime).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Current task */}
          <div className="p-3 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-obsidian-inkMuted">Current Task</div>
            <p className="text-[11px] text-obsidian-inkPrimary leading-relaxed">{selectedAgent.currentTask || '—'}</p>
            {selectedAgent.tokensUsed > 0 && (
              <div className="text-[10px] font-mono text-obsidian-inkSecondary pt-1">
                Tokens used: {selectedAgent.tokensUsed.toLocaleString()}
              </div>
            )}
          </div>

          {/* Live tool call tail */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-obsidian-inkMuted">
              Activity{selectedAgent.toolCalls.length > 0 ? ` (${selectedAgent.toolCalls.length})` : ''}
            </div>
            {selectedAgent.toolCalls.length === 0 ? (
              <p className="text-[11px] text-obsidian-inkMuted">No tool calls yet.</p>
            ) : (
              selectedAgent.toolCalls.slice(-8).map((call) => <ToolCallRow key={call.id} call={call} />)
            )}
          </div>

          {selectedAgent.lastMessage && isTerminalStatus(selectedAgent.status) && (
            <div className="p-3 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-obsidian-inkMuted">Result</div>
              <p className="text-[11px] text-obsidian-inkSecondary leading-relaxed whitespace-pre-wrap">{selectedAgent.lastMessage}</p>
            </div>
          )}
        </div>
      )}

      {/* Selected Subagent Steer Drawer */}
      {selectedAgent && (
        <div className="p-3 border-t border-obsidian-hairline bg-obsidian-surface2">
          <div className="text-[10px] font-mono text-obsidian-inkMuted mb-2">
            <span>Guide this specialist mid-run</span>
          </div>
          <form onSubmit={handleSteerSubagent} className="flex items-center gap-1.5">
            <input
              type="text"
              value={steerInput}
              onChange={(e) => setSteerInput(e.target.value)}
              placeholder="Send guidance to this subagent..."
              className="flex-1 bg-obsidian-surface1 border border-obsidian-hairline rounded-lg px-2.5 py-1 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
            />
            <button
              type="submit"
              disabled={!steerInput.trim()}
              className="px-2.5 py-1 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas text-xs font-semibold hover:bg-obsidian-accentHover disabled:opacity-40 cursor-pointer disabled:pointer-events-none flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
