import React from 'react';
import { RotateCcw, WifiOff, X } from 'lucide-react';

/**
 * Transient banner shown when the prompt socket closed before the run
 * finished. Rendered at most once per run; retry re-sends the last user
 * message, dismiss just clears it.
 */
export const ConnectionLostBanner: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;

  return (
    <div
      className="mx-1 my-1.5 flex items-center gap-2.5 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2.5"
      role="alert"
      aria-label="Connection lost"
    >
      <WifiOff className="w-4 h-4 shrink-0 text-red-400" aria-hidden="true" />
      <p className="flex-1 min-w-0 text-xs text-red-300 leading-snug">
        Connection lost — your message may not have completed.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-lg border border-red-800/60 bg-red-900/30 hover:bg-red-900/50 text-[11px] font-medium text-red-200 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/50"
      >
        <RotateCcw className="w-3 h-3" aria-hidden="true" />
        Retry
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
        className="w-6 h-6 shrink-0 rounded-lg flex items-center justify-center text-red-400/70 hover:text-red-200 hover:bg-red-900/40 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/50"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
