import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles/global.css';
import { AlertTriangle } from 'lucide-react';

interface CrashState {
  hasError: boolean;
  error: any;
  info: string;
  fingerprint: string;
}

/**
 * Top-level UI crash handler.
 *
 * - Logs the crash to console with stack and component stack.
 * - Tries a soft recovery first by clearing corrupted UI state from localStorage,
 *   which is the most common cause of "blank screen on boot" tickets.
 * - Falls back to a manual reload prompt only if soft recovery fails.
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, CrashState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null, info: '', fingerprint: '' };
  }

  static getDerivedStateFromError(error: any) {
    return {
      hasError: true,
      error,
      info: '',
      // Lightweight fingerprint so similar crashes don't pile up identical reports.
      fingerprint: String(error?.message ?? error).slice(0, 64),
    };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('[SUTRA UI Crash Handler]', error, errorInfo?.componentStack);
    this.setState({ info: String(errorInfo?.componentStack || '') });
    // Best-effort, lightweight crash beacon; the backend captures nothing
    // sensitive — just confirmation that an event occurred.
    try {
      const key = 'sutra_crash_events';
      const prior = Number(localStorage.getItem(key) || '0');
      localStorage.setItem(key, String(prior + 1));
    } catch {
      // Ignore — beacon is best-effort
    }
  }

  private softRecover = () => {
    try {
      // Drop transient UI flags that frequently cause boot loops
      const drop = ['sutra_token', 'sutra_setup_skipped'];
      for (const key of drop) localStorage.removeItem(key);
    } catch {
      // Ignore — recovery is best-effort
    }
    window.location.reload();
  };

  private copyDetails = async () => {
    const text =
      `SUTRA crash report\n` +
      `When: ${new Date().toISOString()}\n` +
      `URL: ${window.location.href}\n` +
      `Fingerprint: ${this.state.fingerprint}\n\n` +
      `Message:\n${String(this.state.error?.message || this.state.error)}\n\n` +
      `Stack:\n${String(this.state.error?.stack || '')}\n\n` +
      `Component stack:\n${this.state.info}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard might be denied — non-fatal
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-obsidian-canvas text-obsidian-inkPrimary p-8 font-sans flex flex-col items-center justify-center select-none anim-fade-in">
          <div className="max-w-md w-full p-6 bg-obsidian-surface1 border border-obsidian-border rounded-xl space-y-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-obsidian-danger/15 border border-obsidian-danger/40 text-obsidian-danger">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <h2 className="text-sm font-semibold text-obsidian-inkPrimary uppercase tracking-wider">
                SUTRA interface recovery
              </h2>
            </div>
            <p className="text-xs text-obsidian-inkSecondary leading-relaxed">
              The UI hit an unexpected error. We can usually recover by clearing transient UI
              state (your files, sessions, and settings are preserved on disk).
            </p>
            <div className="rounded-md bg-obsidian-surface2 border border-obsidian-hairline p-3 font-mono text-[11px] text-obsidian-danger max-h-32 overflow-auto">
              {String(this.state.error?.message || this.state.error)}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={this.softRecover}
                className="w-full py-2 bg-obsidian-inkPrimary text-obsidian-inkInverse font-semibold rounded-lg text-xs cursor-pointer hover:opacity-90 transition-colors"
              >
                Clear UI state &amp; reload
              </button>
              <div className="flex gap-2">
                <button
                  onClick={this.copyDetails}
                  className="flex-1 py-1.5 bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkPrimary font-medium rounded-lg text-xs cursor-pointer hover:bg-obsidian-surface1 transition-colors"
                >
                  Copy crash details
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 py-1.5 bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkPrimary font-medium rounded-lg text-xs cursor-pointer hover:bg-obsidian-surface1 transition-colors"
                >
                  Reload only
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
