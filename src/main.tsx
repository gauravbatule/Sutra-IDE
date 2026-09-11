import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles/global.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('[SUTRA UI Crash Handler]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-black text-white p-8 font-mono flex flex-col justify-center items-center">
          <div className="max-w-md w-full p-6 bg-obsidian-surface3 border border-white/10 rounded-xl space-y-4 shadow-2xl">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">SUTRA Interface Recovery</h2>
            <p className="text-xs text-obsidian-inkSecondary">
              An unexpected UI error occurred: {String(this.state.error?.message || this.state.error)}
            </p>
            <button
              onClick={() => {
                localStorage.removeItem('sutra_token');
                window.location.reload();
              }}
              className="w-full py-2 bg-white text-black font-semibold rounded-lg text-xs cursor-pointer hover:bg-zinc-200 transition-colors"
            >
              Reset & Reload IDE
            </button>
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
