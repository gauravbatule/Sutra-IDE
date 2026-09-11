import React, { useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode,
  Image as ImageIcon,
  Square,
  Terminal,
  XCircle,
} from 'lucide-react';
import type { SutraAgentMessage } from '../../types/ide.js';

/** How a finished run resolved — drives the card's status-line icon and label. */
export type RunStatus = 'completed' | 'stopped' | 'cancelled' | 'failed';

export interface RunStats {
  /** write_file + edit_file tool calls present in the run */
  fileOps: number;
  /** run_command tool calls present in the run */
  commandsRun: number;
  /** generate_* tool calls present in the run */
  mediaGenerated: number;
}

export interface RunSummary {
  /** `${sessionId}@${endedAt}` — guards against capturing one run twice */
  key: string;
  status: RunStatus;
  endedAt: number;
  stats: RunStats;
  /** First ~240 chars of the run's final assistant text; null when none */
  outcome: string | null;
}

const OUTCOME_EXCERPT_CHARS = 240;

// The stop handler tacks this notice onto the tail message; it is housekeeping,
// never part of the agent's own outcome text.
const CANCEL_MARKER_RE = /\s*\*\(Generation stopped\.[^)]*\)\*/g;

const TOOL_MARKER_RE = /<!--\s*(?:TOOL_[^>]*|GOAL_COMPLETE)\s*-->/gi;

/**
 * Extracts the just-finished run's shape from the transcript. The run window
 * is every message after the most recent user prompt; stats count tool calls
 * by kind exactly as they appear in those messages. Status resolution:
 * stop requested -> Stopped when the run had already completed work,
 * otherwise Cancelled; otherwise Failed when the run produced no written
 * outcome but logged failed tool calls; else Completed.
 */
export const summarizeRun = (
  messages: SutraAgentMessage[],
  opts: { cancelled: boolean }
): Omit<RunSummary, 'key' | 'endedAt'> => {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  const runMessages = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : [];

  let fileOps = 0;
  let commandsRun = 0;
  let mediaGenerated = 0;
  let sawFailure = false;
  let sawCompletedTool = false;

  for (const msg of runMessages) {
    if (msg.role !== 'assistant') continue;
    const calls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
    for (const tc of calls) {
      if (tc.tool === 'write_file' || tc.tool === 'edit_file') fileOps += 1;
      else if (tc.tool === 'run_command') commandsRun += 1;
      else if (/^generate_/.test(tc.tool)) mediaGenerated += 1;
      if (tc.status === 'failed') sawFailure = true;
      if (tc.status === 'completed') sawCompletedTool = true;
    }
  }

  // Final assistant voice: the last assistant message in the run with real text
  let outcome: string | null = null;
  for (let i = runMessages.length - 1; i >= 0; i--) {
    const msg = runMessages[i];
    if (msg.role !== 'assistant' || !msg.content?.trim()) continue;
    const plain = msg.content
      .replace(CANCEL_MARKER_RE, '')
      .replace(TOOL_MARKER_RE, '')
      .replace(/^\|.*?\|$/gm, '') // strip raw table rows
      .replace(new RegExp('\\|[\\-\\:\\s\\|]+\\|', 'g'), '') // strip table delimiters
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!plain) continue;
    outcome =
      plain.length > OUTCOME_EXCERPT_CHARS
        ? `${plain.slice(0, OUTCOME_EXCERPT_CHARS).trimEnd()}…`
        : plain;
    break;
  }

  let status: RunStatus;
  if (opts.cancelled) status = sawCompletedTool ? 'stopped' : 'cancelled';
  else if (!outcome && sawFailure) status = 'failed';
  else status = 'completed';

  return { status, stats: { fileOps, commandsRun, mediaGenerated }, outcome };
};

interface StatusMeta {
  label: string;
  Icon: typeof CheckCircle2;
  tone: string;
}

export const STATUS_META: Record<RunStatus, StatusMeta> = {
  completed: { label: 'Completed', Icon: CheckCircle2, tone: 'text-obsidian-inkPrimary' },
  stopped: { label: 'Stopped', Icon: Square, tone: 'text-obsidian-inkSecondary' },
  cancelled: { label: 'Cancelled', Icon: Ban, tone: 'text-obsidian-inkMuted' },
  failed: { label: 'Failed', Icon: XCircle, tone: 'text-rose-400' },
};

/**
 * Compact end-of-run digest: how the run resolved, what it actually did
 * (tool-call counts by kind), and the agent's closing words. Rendered once
 * per finished run by ManagerShell — never for restored history.
 */
export const ResultSummaryCard: React.FC<{ summary: RunSummary }> = ({ summary }) => {
  const [open, setOpen] = useState(true);
  const { label, Icon, tone } = STATUS_META[summary.status];
  const stats = [
    { Icon: FileCode, label: 'file ops', value: summary.stats.fileOps },
    { Icon: Terminal, label: 'commands', value: summary.stats.commandsRun },
    { Icon: ImageIcon, label: 'media', value: summary.stats.mediaGenerated },
  ].filter((s) => s.value > 0);

  return (
    <section
      aria-label={`Run result: ${label}`}
      className="rounded-lg border border-obsidian-border bg-obsidian-surface1 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? 'Collapse run summary' : 'Expand run summary'}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-obsidian-borderBright"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
        )}
        <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} aria-hidden="true" />
        <span className="text-[11px] font-mono text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary transition-colors duration-150">
          {label}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2.5 space-y-1.5">
          {stats.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap" aria-label="Run activity">
              {stats.map(({ Icon: StatIcon, label: statLabel, value }) => (
                <span
                  key={statLabel}
                  className="inline-flex items-center gap-1 text-[10px] font-mono text-obsidian-inkMuted"
                >
                  <StatIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>{value}</span>
                  <span>{statLabel}</span>
                </span>
              ))}
            </div>
          )}
          {summary.outcome ? (
            <div className="space-y-0.5">
              <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-obsidian-inkMuted select-none">
                Outcome
              </div>
              <p className="text-[11px] leading-relaxed text-obsidian-inkSecondary whitespace-pre-wrap break-words select-text">
                {summary.outcome}
              </p>
            </div>
          ) : (
            <p className="text-[11px] italic text-obsidian-inkMuted">
              Run ended without a written summary — see activity log.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
