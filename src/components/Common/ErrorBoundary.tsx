import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[SUTRA ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 w-full h-full min-h-[300px] flex items-center justify-center p-6 bg-obsidian-canvas text-obsidian-inkPrimary select-none">
          <div className="max-w-md w-full p-6 rounded-xl bg-obsidian-surface1 border border-red-500/20 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-obsidian-inkPrimary">
                  {this.props.fallbackTitle || 'Something went wrong in this view'}
                </h3>
                <p className="text-xs text-obsidian-inkMuted">
                  The component encountered an unexpected runtime error.
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline text-xs font-mono text-red-300/90 overflow-x-auto max-h-32 select-text">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={this.handleRetry}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-xs font-semibold text-obsidian-inkPrimary transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-obsidian-accent hover:bg-obsidian-accentHover text-obsidian-inkInverse text-xs font-bold transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
