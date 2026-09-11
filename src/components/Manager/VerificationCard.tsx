import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Clock, FileCode, ShieldCheck, X, XCircle } from 'lucide-react';
import type { VerificationCheck, VerificationReport } from '../../types/ide.js';

const STATUS_META: Record<VerificationCheck['status'], { icon: React.ReactNode; label: string }> = {
  passed: {
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />,
    label: 'Passed',
  },
  failed: {
    icon: <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" aria-hidden="true" />,
    label: 'Failed',
  },
  timeout: {
    icon: <Clock className="w-3.5 h-3.5 text-rose-300 shrink-0" aria-hidden="true" />,
    label: 'Timed out',
  },
  skipped: {
    icon: <CircleDashed className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" aria-hidden="true" />,
    label: 'Skipped',
  },
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
};

/**
 * End-of-run verification evidence. Rendered once per mutating run; dismissed
 * automatically when the next prompt is sent or manually via the close button.
 */
export const VerificationCard: React.FC<{ report: VerificationReport; onDismiss: () => void }> = ({
  report,
  onDismiss,
}) => {
  const [expanded, setExpanded] = useState(false);
  const failedCount = report.checks.filter((c) => c.status === 'failed' || c.status === 'timeout').length;
  const skippedCount = report.checks.filter((c) => c.status === 'skipped').length;

  const headline = failedCount > 0
    ? `Verification failed — ${failedCount} of ${report.checks.length} checks did not pass`
    : `${report.checks.length - skippedCount} of ${report.checks.length} checks passed`;

  return (
    <div
      role="status"
      className={`rounded-xl border bg-obsidian-surface1 ${
        failedCount > 0 ? 'border-rose-500/30' : 'border-emerald-500/25'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 group"
      >
        <ShieldCheck
          className={`w-4 h-4 shrink-0 ${failedCount > 0 ? 'text-rose-300' : 'text-emerald-300'}`}
          aria-hidden="true"
        />
        <span className="shrink-0 text-[11px] font-mono uppercase tracking-wider text-obsidian-inkSecondary">
          Verification
        </span>
        <span className={`min-w-0 flex-1 truncate text-[11px] ${failedCount > 0 ? 'text-rose-200' : 'text-obsidian-inkSecondary'}`}>
          {headline}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-[10px] font-mono text-obsidian-inkMuted">
          <FileCode className="w-3 h-3" aria-hidden="true" />
          {report.filesChanged}
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0 text-obsidian-inkMuted" aria-hidden="true" />
        )}
        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss verification results"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              onDismiss();
            }
          }}
          className="p-1 rounded-md text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.07] transition-colors duration-150 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-1">
          {report.checks.map((check) => {
            const meta = STATUS_META[check.status];
            return (
              <div
                key={check.name}
                className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-obsidian-canvas border border-obsidian-hairline"
              >
                {meta.icon}
                <span className="shrink-0 w-16 text-[11px] font-mono text-obsidian-inkPrimary pt-px">{check.name}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-obsidian-inkSecondary pt-px" title={check.summary}>
                  {check.summary}
                </span>
                <span className="shrink-0 text-[10px] font-mono text-obsidian-inkMuted pt-px">
                  {meta.label}
                  {check.durationMs > 0 ? ` · ${formatDuration(check.durationMs)}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
