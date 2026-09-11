import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  ShieldAlert,
  Play,
  Terminal,
  Wifi
} from 'lucide-react';
import { PocketVoiceAgent } from './PocketVoiceAgent.js';
import { RemoteApprovals } from './RemoteApprovals.js';
import { LiveMobileMirror } from './LiveMobileMirror.js';
import { MobileTerminal } from './MobileTerminal.js';

export const MobileApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'agent' | 'approvals' | 'mirror' | 'terminal'>('agent');
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [, setIsConnected] = useState(true);
  // Dedupe guard: only commit when the payload actually changed, otherwise
  // every 2s tick re-renders the shell and makes badges flicker.
  const lastApprovalsSignature = useRef<string>('');

  useEffect(() => {
    // Poll for pending approvals
    const interval = setInterval(() => {
      fetch('/api/swarm/status')
        .then((r) => r.json())
        .then((d) => {
          const next = d.pendingApprovals || [];
          const signature = JSON.stringify(next);
          if (signature !== lastApprovalsSignature.current) {
            lastApprovalsSignature.current = signature;
            setPendingApprovals(next);
          }
        })
        .catch(() => setIsConnected(false));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-[100dvh] w-full bg-obsidian-surface1 text-obsidian-inkPrimary flex flex-col font-sans overflow-hidden select-none">
      {/* Mobile Top Bar */}
      <header className="h-12 bg-obsidian-surface2 border-b border-obsidian-hairline flex items-center justify-between px-4 z-30 pt-safe">
        <div className="flex items-center gap-2">
          <img src="/assets/sutra-icon.svg" alt="" className="w-5 h-5 rounded-lg" />
          <span className="font-bold text-xs tracking-tight">SUTRA Mobile</span>
        </div>

        <div className="flex items-center gap-2">
          {pendingApprovals.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-white/[0.08] text-obsidian-inkPrimary text-[10px] font-mono animate-pulse">
              {pendingApprovals.length} Approval
            </span>
          )}
          <div className="flex items-center gap-1 text-[10px] font-mono text-obsidian-inkPrimary">
            <Wifi className="w-3 h-3" />
            <span>Paired</span>
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'agent' && <PocketVoiceAgent />}
        {activeTab === 'approvals' && <RemoteApprovals approvals={pendingApprovals} />}
        {activeTab === 'mirror' && <LiveMobileMirror />}
        {activeTab === 'terminal' && <MobileTerminal />}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="h-16 bg-obsidian-surface2 border-t border-obsidian-hairline grid grid-cols-4 items-center px-2 pb-safe z-30">
        <button
          onClick={() => setActiveTab('agent')}
          className={`flex flex-col items-center gap-1 text-[10px] transition-colors rounded-lg py-1 ${
            activeTab === 'agent' ? 'text-obsidian-inkPrimary font-bold' : 'text-obsidian-inkMuted'
          }`}
        >
          <Bot className="w-5 h-5" />
          <span>Pocket Agent</span>
        </button>

        <button
          onClick={() => setActiveTab('approvals')}
          className={`flex flex-col items-center gap-1 text-[10px] transition-colors relative rounded-lg py-1 ${
            activeTab === 'approvals' ? 'text-obsidian-inkPrimary font-bold' : 'text-obsidian-inkMuted'
          }`}
        >
          <ShieldAlert className="w-5 h-5" />
          <span>Approvals</span>
          {pendingApprovals.length > 0 && (
            <span className="absolute top-0 right-4 w-2 h-2 rounded-full bg-white/70" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('mirror')}
          className={`flex flex-col items-center gap-1 text-[10px] transition-colors rounded-lg py-1 ${
            activeTab === 'mirror' ? 'text-obsidian-inkPrimary font-bold' : 'text-obsidian-inkMuted'
          }`}
        >
          <Play className="w-5 h-5" />
          <span>Live Mirror</span>
        </button>

        <button
          onClick={() => setActiveTab('terminal')}
          className={`flex flex-col items-center gap-1 text-[10px] transition-colors rounded-lg py-1 ${
            activeTab === 'terminal' ? 'text-obsidian-inkPrimary font-bold' : 'text-obsidian-inkMuted'
          }`}
        >
          <Terminal className="w-5 h-5" />
          <span>Terminal</span>
        </button>
      </nav>
    </div>
  );
};
