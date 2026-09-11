import React from 'react';
import { Key, Cookie, Cpu, RefreshCw, ArrowRight, Sparkles } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface SetupGateProps {
  onRefresh: () => void;
  onSkip: () => void;
}

const SETUP_OPTIONS = [
  {
    id: 'google',
    icon: Sparkles,
    title: 'Google Gemini',
    description: 'Free key from Google AI Studio — aistudio.google.com/apikey.',
  },
  {
    id: 'api-key',
    icon: Key,
    title: 'API key',
    description: 'Paste a key from any frontier lab or inference host.',
  },
  {
    id: 'cookie',
    icon: Cookie,
    title: 'Session cookie',
    description: 'Reuse your browser web session for supported providers.',
  },
  {
    id: 'nim',
    icon: Cpu,
    title: 'NVIDIA NIM free key',
    description: 'Get a free hosted key at build.nvidia.com in minutes.',
  },
] as const;

export const SetupGate: React.FC<SetupGateProps> = ({ onRefresh, onSkip }) => {
  const { setSettingsOpen } = useIDEStore();

  return (
    <div className="fixed inset-0 z-40 bg-obsidian-canvas flex items-center justify-center p-6 select-none">
      <div className="w-full max-w-xl flex flex-col items-center text-center">
        {/* Wordmark */}
        <div className="text-obsidian-inkPrimary font-mono uppercase tracking-[0.4em] text-sm">
          SUTRA
        </div>

        <h1 className="mt-8 text-2xl font-bold text-obsidian-inkPrimary tracking-tight">
          Connect a model to start
        </h1>
        <p className="mt-3 text-xs text-obsidian-inkMuted leading-relaxed max-w-md">
          SUTRA needs at least one model connection before it can build with you.
          Add one now — it takes under a minute.
        </p>

        {/* Quiet option cards */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
          {SETUP_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                onClick={() => setSettingsOpen(true)}
                className="p-4 bg-obsidian-surface1 hover:bg-obsidian-surface2 border border-obsidian-hairline hover:border-obsidian-surface4 rounded-xl flex items-center gap-3 text-left transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkSecondary shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-obsidian-inkPrimary">{option.title}</div>
                  <p className="mt-1 text-[11px] text-obsidian-inkMuted leading-relaxed">{option.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="mt-10 flex items-center gap-3">
          <button
            onClick={() => setSettingsOpen(true)}
            className="px-5 py-2 bg-white hover:bg-obsidian-accentHover text-black text-xs font-bold rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
          >
            Open Providers &amp; Keys
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-transparent hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary text-xs font-mono rounded-lg border border-obsidian-hairline flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>

          <button
            onClick={onSkip}
            className="px-4 py-2 bg-transparent hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary text-xs font-mono rounded-lg transition-colors cursor-pointer"
          >
            Skip for now
          </button>
        </div>

        <p className="mt-6 text-[10px] text-obsidian-inkMuted font-mono">
          Saved locally. Nothing is shared.
        </p>
      </div>
    </div>
  );
};
