import React, { useEffect, useState } from 'react';
import { Pause, Play, ShieldAlert, HelpCircle, Zap, Loader2 } from 'lucide-react';
import { AgentStatus, pickRotatingLabel } from '../../utils/agentStatus.js';

interface AgentStatusBannerProps {
  status: AgentStatus;
  isGenerating: boolean;
  isPaused: boolean;
  thinking?: string;
  elapsedSeconds?: number;
  onPause?: () => void;
  onResume?: () => void;
  onVerify?: () => void;
}

/** How often the working label cycles. Slow enough to read, fast enough to
 *  reassure the user that the run is alive even between model chunks. */
const ROTATION_INTERVAL_MS = 3200;

export const AgentStatusBanner: React.FC<AgentStatusBannerProps> = ({
  status,
  isGenerating: _isGenerating,
  isPaused,
  thinking: _thinking = '',
  elapsedSeconds = 0,
  onPause,
  onResume,
  onVerify,
}) => {
  const [rotationIndex, setRotationIndex] = useState(0);

  useEffect(() => {
    setRotationIndex(0);
    if (status.key !== 'working' && status.key !== 'avo_working') return;
    const id = window.setInterval(() => {
      setRotationIndex((i) => (i + 1) % 1000);
    }, ROTATION_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status.key]);

  if (status.key === 'idle') return null;

  // Running State (Standard or AVO Pro) — with rotating brand-voice labels so
  // a long run never appears to be stuck on a single phrase. The rotation
  // ticker is keyed on the run id (encoded in `detail`) so a fresh run resets
  // the cycle instead of inheriting an arbitrary position from the previous
  // session.
  if (status.key === 'working' || status.key === 'avo_working') {
    const isAvo = status.key === 'avo_working';

    const liveLabel = pickRotatingLabel(status.key, rotationIndex);

    return (
      <div
        role="status"
        aria-live="polite"
        className="py-1 px-1 my-0.5 flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-obsidian-inkSecondary shrink-0" aria-hidden="true" />
          <span
            key={liveLabel}
            className="text-obsidian-inkSecondary font-mono text-[11px] truncate"
            title={status.detail}
          >
            {liveLabel}
          </span>
          {elapsedSeconds > 0 && (
            <span className="text-[10px] font-mono text-obsidian-inkMuted tabular-nums shrink-0">
              {elapsedSeconds.toFixed(1)}s
            </span>
          )}
        </div>

        {onPause && (
          <button
            type="button"
            onClick={onPause}
            className="p-1 rounded-md text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer shrink-0"
            title="Pause task (Esc)"
            aria-label="Pause task"
          >
            <Pause className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  // Paused State
  if (status.key === 'paused' || isPaused) {
    return (
      <div
        role="status"
        className="rounded-lg border border-obsidian-border bg-obsidian-surface2 px-3 py-1.5 my-1.5 flex items-center justify-between gap-3 text-xs animate-in fade-in duration-150"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Pause className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
          <span className="font-medium text-obsidian-inkPrimary text-[11px]">
            Task Paused
          </span>
          {elapsedSeconds > 0 && (
            <span className="text-[10px] font-mono text-obsidian-inkMuted tabular-nums">
              {elapsedSeconds.toFixed(1)}s
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onVerify && (
            <button
              type="button"
              onClick={onVerify}
              className="p-1 rounded-md text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer"
              title="Run verification"
              aria-label="Run verification"
            >
              <Zap className="w-3.5 h-3.5" />
            </button>
          )}
          {onResume && (
            <button
              type="button"
              onClick={onResume}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-obsidian-accent hover:bg-obsidian-accentHover text-obsidian-inkInverse text-[11px] font-medium transition-colors cursor-pointer shadow-sm"
              title="Resume task"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Resume</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Action Approval Required State
  if (status.key === 'approval_required') {
    return (
      <div
        role="status"
        className="rounded-lg border border-obsidian-border bg-obsidian-surface2 px-3 py-1.5 my-1.5 flex items-center gap-2 text-xs animate-in fade-in duration-150"
      >
        <ShieldAlert className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
        <span className="text-[11px] text-obsidian-inkPrimary font-medium">
          Action Approval Required Below
        </span>
      </div>
    );
  }

  // Waiting for User Answer State
  if (status.key === 'waiting') {
    return (
      <div
        role="status"
        className="rounded-lg border border-obsidian-border bg-obsidian-surface2 px-3 py-1.5 my-1.5 flex items-center gap-2 text-xs animate-in fade-in duration-150"
      >
        <HelpCircle className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
        <span className="text-[11px] text-obsidian-inkPrimary font-medium">
          Response Needed Below
        </span>
      </div>
    );
  }

  return null;
};


