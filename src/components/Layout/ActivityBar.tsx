import React from 'react';
import {
  Folders,
  Search,
  Bot,
  GitBranch,
  Settings,
  TerminalSquare,
  BookOpen,
  CircleHelp,
  QrCode,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  Eye,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const ActivityBar: React.FC = () => {
  const {
    activeSidebar,
    setActiveSidebar,
    toggleSidebar,
    isSidebarOpen,
    toggleTerminal,
    isTerminalOpen,
    isPreviewOpen,
    togglePreview,
    setSettingsOpen,
    setQRPairingOpen,
    setGuideOpen,
    subagents,
    pendingApprovals
  } = useIDEStore();

  const sidebarItems = [
    { id: 'explorer', icon: Folders, label: 'File Explorer (Ctrl+Shift+E)' },
    { id: 'outline', icon: ListTree, label: 'AST Symbol Outline (Ctrl+Shift+O)' },
    { id: 'search', icon: Search, label: 'Workspace Search (Ctrl+Shift+F)' },
    { id: 'artifacts', icon: BookOpen, label: 'Artifacts, Reports & Plans' },
    { id: 'swarm', icon: Bot, label: 'Agents & Parallel Subagent Matrix' },
    { id: 'git', icon: GitBranch, label: 'Source Control & Git Diffs (Ctrl+Shift+G)' },
  ];

  return (
    <aside className="w-12 bg-obsidian-surface1 border-r border-obsidian-hairline flex flex-col items-center justify-between py-2.5 z-20 select-none shrink-0">
      {/* Premium Sidebar Collapse/Open Control at top of Activity Bar */}
      <div className="flex flex-col items-center gap-1.5 w-full">
        <button
          type="button"
          onClick={toggleSidebar}
          title={isSidebarOpen ? 'Collapse Primary Sidebar (Ctrl+B)' : 'Expand Primary Sidebar (Ctrl+B)'}
          aria-label={isSidebarOpen ? 'Collapse Primary Sidebar' : 'Expand Primary Sidebar'}
          aria-pressed={isSidebarOpen}
          className="w-full flex justify-center items-center cursor-pointer group py-0.5"
        >
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all active:scale-95 border shadow-xs ${
              isSidebarOpen
                ? 'bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkPrimary border-obsidian-border'
                : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary bg-obsidian-surface1 hover:bg-obsidian-surface2 border-obsidian-hairline'
            }`}
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </div>
        </button>

        <div className="w-6 h-px bg-obsidian-hairline my-0.5" />

        {/* Core Sidebar Panels */}
        {sidebarItems.map((item) => {
          const Icon = item.icon;
          const isActive = isSidebarOpen && activeSidebar === item.id;
          const swarmCount = item.id === 'swarm' ? (subagents.filter(s => s.status === 'executing' || s.status === 'thinking').length + pendingApprovals.length) : 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (activeSidebar === item.id && isSidebarOpen) {
                  toggleSidebar();
                } else {
                  setActiveSidebar(item.id as any);
                  if (!isSidebarOpen) toggleSidebar();
                }
              }}
              title={item.label}
              aria-label={item.label}
              aria-pressed={isActive}
              className="w-full flex justify-center items-center relative cursor-pointer group py-0.5"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all relative active:scale-95 ${
                isActive
                  ? 'text-obsidian-inkPrimary bg-obsidian-surface2 border border-obsidian-hairline shadow-xs'
                  : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border border-transparent'
              }`}>
                <Icon className="w-4 h-4" />
                {swarmCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 px-1 min-w-[14px] h-3.5 rounded bg-obsidian-surface3 border border-obsidian-hairline text-[9px] font-mono text-obsidian-inkPrimary flex items-center justify-center font-medium leading-none shadow-xs">
                    {swarmCount}
                  </span>
                )}
              </div>
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-obsidian-inkPrimary rounded-r-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Icons: Mobile QR, Guide, Terminal, Settings */}
      <div className="flex flex-col items-center gap-1 w-full">
        {/* Phone Connect QR */}
        <button
          type="button"
          onClick={() => setQRPairingOpen(true)}
          title="Mobile Phone Companion (QR Connect)"
          aria-label="Mobile Phone Companion (QR Connect)"
          className="w-full flex justify-center items-center cursor-pointer py-0.5 group"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border border-transparent hover:border-obsidian-hairline transition-all active:scale-95">
            <QrCode className="w-4 h-4" />
          </div>
        </button>

        {/* User Guide & Architecture Tour — CircleHelp (not BookOpen) so it
            does not collide with the Artifacts panel icon above. */}
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          title="SUTRA User Guide & Documentation (Help)"
          aria-label="SUTRA User Guide & Documentation"
          className="w-full flex justify-center items-center cursor-pointer py-0.5 group"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border border-transparent hover:border-obsidian-hairline transition-all active:scale-95">
            <CircleHelp className="w-4 h-4" aria-hidden="true" />
          </div>
        </button>

        {/* Live Preview Toggle */}
        <button
          type="button"
          onClick={togglePreview}
          title={isPreviewOpen ? 'Close Live Preview (Ctrl+Shift+V)' : 'Open Live Preview (Ctrl+Shift+V)'}
          aria-label={isPreviewOpen ? 'Close Live Preview' : 'Open Live Preview'}
          aria-pressed={isPreviewOpen}
          className="w-full flex justify-center items-center cursor-pointer py-0.5 group"
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all active:scale-95 border ${
            isPreviewOpen
              ? 'text-obsidian-inkPrimary bg-obsidian-surface2 border-obsidian-hairline shadow-xs font-semibold'
              : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border-transparent hover:border-obsidian-hairline'
          }`}>
            <Eye className="w-4 h-4" />
          </div>
        </button>

        {/* Terminal Toggle */}
        <button
          type="button"
          onClick={toggleTerminal}
          title="Toggle PowerShell Terminal (Ctrl+`)"
          aria-label="Toggle Terminal"
          aria-pressed={isTerminalOpen}
          className="w-full flex justify-center items-center cursor-pointer py-0.5 group"
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all active:scale-95 ${
            isTerminalOpen
              ? 'text-obsidian-inkPrimary bg-obsidian-surface2 border border-obsidian-hairline shadow-xs'
              : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border border-transparent hover:border-obsidian-hairline'
          }`}>
            <TerminalSquare className="w-4 h-4" />
          </div>
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="Settings (AI Providers, Models & MCP Configuration)"
          aria-label="Open Settings"
          className="w-full flex justify-center items-center cursor-pointer py-0.5 group"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border border-transparent hover:border-obsidian-hairline transition-all active:scale-95">
            <Settings className="w-4 h-4" />
          </div>
        </button>
      </div>
    </aside>
  );
};


