import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  Wifi,
  Shield,
  Zap,
  Sparkles,
  FileCode2,
  Music,
  Loader2,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const StatusBar: React.FC = () => {
  const {
    permissionLevel,
    subagents,
    pendingApprovals,
    isAgentGenerating,
    cursorPosition,
    openTabs,
    activeTabPath,
    activeModel,
    setSettingsOpen,
    isMusicPlaying,
    isMusicEnabled,
    musicTrack,
    setCoffeeModalOpen
  } = useIDEStore();
  const [lanIp, setLanIp] = useState('127.0.0.1');
  const [branch, setBranch] = useState('main');

  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  useEffect(() => {
    fetch('/api/mobile/pairing-qr')
      .then((r) => r.json())
      .then((d) => {
        if (d.lanIp) setLanIp(d.lanIp);
      })
      .catch(() => undefined);

    fetch('/api/git/status')
      .then((r) => r.json())
      .then((d) => {
        if (d?.branch) setBranch(d.branch);
      })
      .catch(() => undefined);
  }, []);

  const executingCount = subagents.filter((s) => s.status === 'executing' || s.status === 'thinking').length;

  // Pill helper — every inline pill in the bar uses the same surface, padding, hover behaviour.
  const Pill: React.FC<{
    tone?: 'default' | 'active' | 'warning' | 'thinking' | 'success';
    title?: string;
    onClick?: () => void;
    children: React.ReactNode;
    className?: string;
  }> = ({ tone = 'default', title, onClick, children, className = '' }) => {
    const toneClass =
      tone === 'active'
        ? 'text-[color:var(--ink-primary)] bg-[color:var(--bg-surface-3)] border-[color:var(--hairline-light)] hover:bg-[color:var(--bg-surface-4)]'
        : tone === 'success'
        ? 'text-[color:var(--ink-primary)] bg-[color:var(--bg-surface-2)] border-[color:var(--hairline-light)]'
        : tone === 'warning'
        ? 'text-[color:var(--ink-primary)] bg-[color:var(--bg-surface-2)] border-[color:var(--hairline-light)]'
        : tone === 'thinking'
        ? 'text-[color:var(--ink-primary)] bg-[color:var(--bg-surface-3)] border-[color:var(--hairline-light)]'
        : 'text-[color:var(--ink-muted)] bg-[color:var(--bg-surface-1)] border-[color:var(--hairline)] hover:text-[color:var(--ink-secondary)] hover:border-[color:var(--hairline-light)]';
    if (onClick) {
      return (
        <button
          type="button"
          title={title}
          onClick={onClick}
          className={`inline-flex items-center gap-1.5 h-5.5 sm:h-6 px-2 rounded-md border text-[10px] font-mono uppercase tracking-wide transition-all cursor-pointer select-none active:scale-95 ${toneClass} ${className}`}
        >
          {children}
        </button>
      );
    }
    return (
      <span
        title={title}
        className={`inline-flex items-center gap-1.5 h-5.5 sm:h-6 px-2 rounded-md border text-[10px] font-mono uppercase tracking-wide select-none ${toneClass} ${className}`}
      >
        {children}
      </span>
    );
  };

  return (
    <footer className="h-7 bg-obsidian-canvas border-t border-obsidian-hairline flex items-center justify-between px-3 text-[10px] select-none z-20 font-mono">
      {/* Left: Git Branch & Execution Status */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Pill tone="active" title="Current git branch">
          <GitBranch className="w-3 h-3 text-obsidian-inkSecondary" />
          <span className="lowercase tracking-normal text-obsidian-inkPrimary">{branch}</span>
        </Pill>

        <Pill
          tone={isAgentGenerating || executingCount > 0 ? 'thinking' : 'default'}
          title={
            isAgentGenerating || executingCount > 0
              ? 'Agent is executing autonomous loop'
              : 'Agent is ready for instructions'
          }
        >
          {isAgentGenerating || executingCount > 0 ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-obsidian-inkSecondary" />
              <span className="lowercase tracking-normal font-medium text-obsidian-inkPrimary">
                {executingCount > 0
                  ? `${executingCount} subagent${executingCount > 1 ? 's' : ''} running`
                  : 'executing'}
              </span>
            </>
          ) : (
            <span className="lowercase tracking-normal font-medium text-obsidian-inkSecondary">idle</span>
          )}
        </Pill>

        {pendingApprovals.length > 0 && (
          <Pill tone="warning" title="Action approval pending">
            <Shield className="w-3 h-3 text-obsidian-inkSecondary" />
            <span className="lowercase tracking-normal font-medium text-obsidian-inkPrimary">
              {pendingApprovals.length} approval{pendingApprovals.length > 1 ? 's' : ''}
            </span>
          </Pill>
        )}
      </div>

      {/* Right: Line/Col, Indent, Encoding, Language, Model, Perms */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Cursor Position */}
        {activeTab && (
          <Pill title="Cursor position (Line, Column)">
            <span className="text-[color:var(--ink-secondary)]">
              Ln {cursorPosition?.line || 1}, Col {cursorPosition?.column || 1}
            </span>
          </Pill>
        )}

        {/* Indentation & Encoding */}
        <Pill className="hidden md:inline-flex" title="Spaces indentation">
          <span className="lowercase tracking-normal">sp: 2</span>
        </Pill>
        <Pill className="hidden md:inline-flex" title="Character encoding">
          <span className="lowercase tracking-normal">utf-8</span>
        </Pill>

        {/* Language */}
        {activeTab && (
          <Pill title="Language mode">
            <FileCode2 className="w-3 h-3 text-obsidian-inkMuted" />
            <span className="lowercase tracking-normal">{activeTab.language || 'plaintext'}</span>
          </Pill>
        )}

        {/* Lo-Fi Music Active Indicator */}
        {isMusicPlaying && isMusicEnabled && (
          <Pill tone="active" title="Lo-Fi coding beats active (Click to manage)" onClick={() => setCoffeeModalOpen(true)}>
            <Music className="w-3 h-3 animate-pulse text-[color:var(--ink-primary)]" />
            <span className="lowercase tracking-normal">{musicTrack.replace('_', ' ')}</span>
          </Pill>
        )}

        {/* LAN connection */}
        {lanIp && lanIp !== '127.0.0.1' && (
          <Pill title="LAN companion address">
            <Wifi className="w-3 h-3 text-obsidian-inkSecondary" />
            <span className="lowercase tracking-normal">{lanIp}</span>
          </Pill>
        )}

        {/* Active AI Model Pill */}
        <Pill tone="active" title="Active AI model (Click to configure)" onClick={() => setSettingsOpen(true)}>
          <Sparkles className="w-3 h-3 text-obsidian-inkSecondary" />
          <span className="lowercase tracking-normal truncate max-w-[140px]">
            {activeModel?.name || 'ASTRA auto'}
          </span>
        </Pill>

        {/* Permission Mode Pill */}
        <Pill
          tone={permissionLevel === 'full' ? 'active' : 'default'}
          title="Strict asks before every change. Full Access lets Astra work autonomously."
        >
          {permissionLevel === 'full' ? (
            <Zap className="w-3 h-3 text-obsidian-inkPrimary" />
          ) : (
            <Shield className="w-3 h-3 text-obsidian-inkMuted" />
          )}
          <span className="tracking-normal font-semibold">{permissionLevel === 'full' ? 'full' : 'strict'}</span>
        </Pill>
      </div>
    </footer>
  );
};

