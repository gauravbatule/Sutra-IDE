import React from 'react';
import {
  FolderOpen,
  MessageSquare,
  PanelLeftClose,
  PanelRightClose,
  BookOpen,
  Shield,
  Zap
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const TitleBar: React.FC = () => {
  const {
    permissionLevel,
    setPermissionLevel,
    setCommandPaletteOpen,
    isSidebarOpen,
    isAgentPanelOpen,
    toggleSidebar,
    toggleAgentPanel,
    setGuideOpen,
    uiMode,
    setUiMode
  } = useIDEStore();

  return (
    <header className="h-10 bg-obsidian-canvas border-b border-obsidian-hairline flex items-center justify-between px-3 text-xs select-none z-30 relative font-sans">
      {/* Left: Brand Identity & Breadcrumb */}
      <div className="flex items-center gap-2.5">
        <div 
          className="flex items-center gap-2 group cursor-pointer" 
          onClick={() => setCommandPaletteOpen(true)}
          title="Open Command Palette (⌘K)"
        >
          <div className="w-4 h-4 flex items-center justify-center overflow-hidden">
            <img src="/assets/sutra-icon.svg" alt="SUTRA" className="w-3.5 h-3.5 object-contain" />
          </div>
          <div className="flex items-center gap-1 leading-none">
            <span className="font-bold tracking-widest text-obsidian-inkPrimary uppercase text-[11px]">SUTRA</span>
          </div>
        </div>

        <div className="h-3 w-px bg-obsidian-hairline" />

        {/* Project Breadcrumb */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-1.5 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary px-1.5 py-0.5 transition-colors rounded hover:bg-obsidian-surface1 font-mono text-[11px]"
        >
          <FolderOpen className="w-3 h-3 text-obsidian-inkMuted" />
          <span>workspace</span>
        </button>
      </div>

      {/* Center: Quick Actions (single model selector lives in the Astra composer) */}
      <div className="flex items-center gap-2">
        {/* Top-Level Quick Guide Button */}
        <button
          onClick={() => setGuideOpen(true)}
          className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-obsidian-inkPrimary hover:text-white border border-white/10 transition-colors text-[11px] font-mono cursor-pointer"
          title="Open User Guide & Documentation"
        >
          <BookOpen className="w-3 h-3" />
          <span>Guide</span>
        </button>
      </div>

      {/* Right Controls: Autopilot, Live Preview, Panels */}
      <div className="flex items-center gap-2">
        {/* Jump back to the Astra chat surface */}
        {uiMode === 'ide' && (
          <button
            onClick={() => setUiMode('manager')}
            title="Back to Astra chat"
            aria-label="Back to Astra chat"
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-obsidian-hairline bg-white/[0.04] text-obsidian-inkSecondary hover:border-obsidian-accentHover hover:text-obsidian-accentHover transition-colors duration-150 text-[11px] font-mono cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
          </button>
        )}

        {/* Permission mode switcher: Strict asks before every change; Full Access runs autonomously */}
        <div
          className="flex items-center bg-obsidian-surface1 border border-obsidian-hairline rounded p-0.5"
          title="Strict asks before every change. Full Access lets Astra work autonomously."
        >
          <button
            onClick={() => setPermissionLevel('strict')}
            aria-pressed={permissionLevel === 'strict'}
            className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              permissionLevel === 'strict'
                ? 'bg-obsidian-accent text-obsidian-canvas font-semibold'
                : 'text-obsidian-inkMuted hover:text-obsidian-inkSecondary'
            }`}
          >
            <Shield className="w-3 h-3" />
            <span>Strict</span>
          </button>
          <button
            onClick={() => setPermissionLevel('full')}
            aria-pressed={permissionLevel === 'full'}
            className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              permissionLevel === 'full'
                ? 'bg-obsidian-accent text-obsidian-canvas font-semibold'
                : 'text-obsidian-inkMuted hover:text-obsidian-inkSecondary'
            }`}
          >
            <Zap className="w-3 h-3" />
            <span>Full Access</span>
          </button>
        </div>

        {/* Panel Toggles */}
        <div className="flex items-center gap-0.5 ml-1">
          <button 
            onClick={toggleSidebar} 
            title="Toggle Left Sidebar"
            className="p-1 rounded text-obsidian-inkSecondary hover:bg-obsidian-surface1 hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
          >
            <PanelLeftClose className={`w-3.5 h-3.5 ${isSidebarOpen ? '' : 'rotate-180'}`} />
          </button>
          <button 
            onClick={toggleAgentPanel} 
            title="Toggle Astra Agent Panel"
            className="p-1 rounded text-obsidian-inkSecondary hover:bg-obsidian-surface1 hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
          >
            <PanelRightClose className={`w-3.5 h-3.5 ${isAgentPanelOpen ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </div>
    </header>
  );
};

