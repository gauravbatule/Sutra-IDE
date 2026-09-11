import React from 'react';
import {
  FolderOpen,
  MessageSquare,
  BookOpen,
  Shield,
  Zap,
  Coffee,
  Music,
  Sparkles,
  Moon,
  Sun,
  TerminalSquare,
  Settings,
  Eye,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { useTheme } from '../../hooks/useTheme.js';

/** Premium icon-only button used in the title bar. */
const IconBtn: React.FC<{
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, pressed, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    className={`inline-flex items-center justify-center w-7 h-7 rounded-md border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-accent/50 cursor-pointer select-none active:scale-95 ${
      pressed
        ? 'bg-obsidian-inkPrimary text-obsidian-canvas border-obsidian-inkPrimary shadow-xs'
        : 'bg-obsidian-surface1 text-obsidian-inkSecondary border-obsidian-hairline hover:text-obsidian-inkPrimary hover:border-obsidian-border hover:bg-obsidian-surface2'
    }`}
  >
    {children}
  </button>
);

export const TitleBar: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const {
    permissionLevel,
    setPermissionLevel,
    setCommandPaletteOpen,
    setFolderPickerOpen,
    currentWorkspacePath,
    currentWorkspaceName,
    setGuideOpen,
    setCoffeeModalOpen,
    isMusicPlaying,
    isMusicEnabled,
    toggleMusicPlaying,
    uiMode,
    setUiMode,
    isTerminalOpen,
    toggleTerminal,
    isPreviewOpen,
    togglePreview,
    setSettingsOpen,
  } = useIDEStore();

  const isDesktop = typeof window !== 'undefined' && /electron/i.test(navigator.userAgent);

  return (
    <header className={`h-10 bg-obsidian-canvas border-b border-obsidian-hairline flex items-center justify-between px-3 text-xs select-none z-30 relative font-sans app-region-drag ${isDesktop ? 'pr-[140px]' : ''}`}>
      {/* Left: Brand Identity & Breadcrumb */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          title="Open Command Palette (Ctrl+P / ⌘K)"
          aria-label="Open Command Palette"
          className="flex items-center gap-2 group cursor-pointer h-7 px-2 rounded-md hover:bg-obsidian-surface1 transition-colors border border-transparent hover:border-obsidian-hairline select-none"
        >
          <span className="w-4 h-4 flex items-center justify-center overflow-hidden">
            <img src="/assets/sutra-icon.svg" alt="SUTRA" className="w-3.5 h-3.5 object-contain" />
          </span>
          <span className="font-display font-semibold tracking-tight text-obsidian-inkPrimary uppercase text-[11px]" style={{ letterSpacing: '0.04em' }}>
            SUTRA
          </span>
        </button>

        <div className="h-3.5 w-px bg-obsidian-hairline" />

        {/* Project Breadcrumb / Open Folder Button */}
        <button
          type="button"
          onClick={() => setFolderPickerOpen(true)}
          title="Open Folder from Storage / Switch Workspace"
          aria-label="Switch Workspace"
          className="flex items-center gap-1.5 h-7 px-2.5 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors rounded-md bg-obsidian-surface1 hover:bg-obsidian-surface2 border border-obsidian-hairline font-mono text-[10px] cursor-pointer select-none"
        >
          <FolderOpen className="w-3.5 h-3.5 text-obsidian-inkMuted" />
          <span className="truncate max-w-[180px]">
            {currentWorkspaceName || (currentWorkspacePath ? currentWorkspacePath.split(/[/\\]/).pop() : 'workspace')}
          </span>
        </button>
      </div>

      {/* Center: Quick Actions (Theme, Guide, Buy Me a Coffee, Lo-Fi Beats) */}
      <div className="flex items-center gap-1.5">
        {/* Theme toggle with a visible label so users can find it without guesswork */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-pressed={theme === 'light'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[10px] font-mono uppercase tracking-wider transition-all duration-150 cursor-pointer select-none active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-accent/50 ${
            theme === 'light'
              ? 'bg-obsidian-inkPrimary text-obsidian-canvas border-obsidian-inkPrimary shadow-xs font-semibold'
              : 'bg-obsidian-surface1 text-obsidian-inkSecondary border-obsidian-hairline hover:text-obsidian-inkPrimary hover:border-obsidian-border hover:bg-obsidian-surface2'
          }`}
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Dark</span>
            </>
          )}
        </button>
        <IconBtn label="User guide & documentation" onClick={() => setGuideOpen(true)}>
          <BookOpen className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn label="Sponsor & support SUTRA" onClick={() => setCoffeeModalOpen(true)}>
          <Coffee className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn
          label={isTerminalOpen ? 'Hide PowerShell Terminal (Ctrl+`)' : 'Toggle PowerShell Terminal (Ctrl+`)'}
          onClick={toggleTerminal}
          pressed={isTerminalOpen}
        >
          <TerminalSquare className="w-3.5 h-3.5" />
        </IconBtn>
        {/* UX-Friendly Prominent Live Preview Toggle */}
        <button
          type="button"
          onClick={togglePreview}
          aria-pressed={isPreviewOpen}
          aria-label={isPreviewOpen ? 'Close Live Preview (Ctrl+Shift+V)' : 'Open Live Preview (Ctrl+Shift+V)'}
          title={isPreviewOpen ? 'Close Live Preview (Ctrl+Shift+V)' : 'Open Live Preview alongside Editor (Ctrl+Shift+V)'}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[10px] font-mono uppercase tracking-wider transition-all duration-150 cursor-pointer select-none active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-accent/50 ${
            isPreviewOpen
              ? 'bg-obsidian-surface3 text-obsidian-inkPrimary border-obsidian-borderBright shadow-xs font-semibold'
              : 'bg-obsidian-surface1 text-obsidian-inkSecondary border-obsidian-hairline hover:text-obsidian-inkPrimary hover:border-obsidian-border hover:bg-obsidian-surface2'
          }`}
        >
          <Eye className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
          <span className="font-semibold">Preview</span>
        </button>
        <IconBtn label="Settings & Provider API Keys" onClick={() => setSettingsOpen(true)}>
          <Settings className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn
          label={isMusicPlaying && isMusicEnabled ? 'Pause lo-fi beats' : 'Play lo-fi beats'}
          onClick={toggleMusicPlaying}
          pressed={Boolean(isMusicPlaying && isMusicEnabled)}
        >
          <Music className={`w-3.5 h-3.5 ${isMusicPlaying && isMusicEnabled ? 'animate-pulse' : ''}`} />
        </IconBtn>
      </div>

      {/* Right Controls: Astra panel, mode toggle, panels */}
      <div className="flex items-center gap-2">
        {/* Jump to chat-first Manager surface */}
        {uiMode === 'ide' && (
          <IconBtn label="Back to Astra chat" onClick={() => setUiMode('manager')}>
            <MessageSquare className="w-3.5 h-3.5" />
          </IconBtn>
        )}
        {uiMode === 'manager' && (
          <IconBtn label="Open Pro IDE" onClick={() => setUiMode('ide')}>
            <Sparkles className="w-3.5 h-3.5" />
          </IconBtn>
        )}

        {/* Permission mode switcher — premium two-pill toggle */}
        <div
          className="flex items-center bg-obsidian-surface1 border border-obsidian-hairline rounded-lg p-0.5"
          title="Strict asks before every change. Full Access lets Astra work autonomously."
        >
          <button
            type="button"
            onClick={() => setPermissionLevel('strict')}
            aria-pressed={permissionLevel === 'strict'}
            title="Strict — ask before every change"
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-all cursor-pointer select-none ${
              permissionLevel === 'strict'
                ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold shadow-xs'
                : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPermissionLevel('full')}
            aria-pressed={permissionLevel === 'full'}
            title="Full Access — Astra works autonomously"
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-all cursor-pointer select-none ${
              permissionLevel === 'full'
                ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold shadow-xs'
                : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};

