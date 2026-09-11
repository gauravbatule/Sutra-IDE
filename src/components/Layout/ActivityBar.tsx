import React from 'react';
import {
  Files,
  Search,
  Bot,
  GitBranch,
  Settings,
  TerminalSquare,
  BookOpen,
  QrCode
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
    setSettingsOpen,
    setQRPairingOpen,
    setGuideOpen,
    subagents,
    pendingApprovals
  } = useIDEStore();

  const sidebarItems = [
    { id: 'explorer', icon: Files, label: 'File Explorer (Ctrl+Shift+E)' },
    { id: 'search', icon: Search, label: 'Workspace Search (Ctrl+Shift+F)' },
    { id: 'swarm', icon: Bot, label: 'Swarm Arena & Parallel Subagents' },
    { id: 'git', icon: GitBranch, label: 'Source Control & Git' },
  ];

  return (
    <aside className="w-12 bg-obsidian-surface1 border-r border-obsidian-hairline flex flex-col items-center justify-between py-2.5 z-20 select-none shrink-0">
      {/* Top Brand Logo & Navigation Icons */}
      <div className="flex flex-col items-center gap-2 w-full">
        {/* Black & White SUTRA Geometric Monogram Logo */}
        <div 
          onClick={toggleSidebar}
          className="w-8 h-8 mb-1 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors cursor-pointer"
          title="SUTRA Studio — Toggle Sidebar"
        >
          <svg className="w-4 h-4 text-obsidian-inkPrimary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </div>

        <div className="w-6 h-px bg-obsidian-hairline mb-1" />

        {/* Core Sidebar Panels */}
        {sidebarItems.map((item) => {
          const Icon = item.icon;
          const isActive = isSidebarOpen && activeSidebar === item.id;
          const showSwarmBadge = item.id === 'swarm' && (subagents.length > 0 || pendingApprovals.length > 0);
          return (
            <button
              key={item.id}
              onClick={() => {
                if (activeSidebar === item.id && isSidebarOpen) {
                  toggleSidebar();
                } else {
                  setActiveSidebar(item.id as any);
                  if (!isSidebarOpen) toggleSidebar();
                }
              }}
              title={item.label}
              className="w-full flex justify-center relative cursor-pointer group py-1"
            >
              <div className={`p-2 rounded-lg transition-colors relative ${
                isActive
                  ? 'text-obsidian-inkPrimary bg-obsidian-surface2 shadow-sm'
                  : 'text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary group-hover:bg-obsidian-surface2'
              }`}>
                <Icon className="w-4 h-4" />
                {showSwarmBadge && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white ring-2 ring-obsidian-surface1 animate-pulse" />
                )}
              </div>
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-obsidian-inkPrimary rounded-r" />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Icons: Mobile QR, Guide, Terminal, Settings */}
      <div className="flex flex-col items-center gap-2 w-full">
        {/* Phone Connect QR */}
        <button
          onClick={() => setQRPairingOpen(true)}
          title="Mobile Phone Companion (QR Connect)"
          className="w-full flex justify-center cursor-pointer py-1 group"
        >
          <div className="p-2 rounded-lg text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary group-hover:bg-obsidian-surface2 transition-colors">
            <QrCode className="w-4 h-4" />
          </div>
        </button>

        {/* User Guide & Architecture Tour */}
        <button
          onClick={() => setGuideOpen(true)}
          title="SUTRA User Guide & Documentation"
          className="w-full flex justify-center cursor-pointer py-1 group"
        >
          <div className="p-2 rounded-lg text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary group-hover:bg-obsidian-surface2 transition-colors">
            <BookOpen className="w-4 h-4" />
          </div>
        </button>

        {/* Terminal Toggle */}
        <button
          onClick={toggleTerminal}
          title="Toggle PowerShell Terminal (Ctrl+`)"
          className="w-full flex justify-center cursor-pointer py-1 group"
        >
          <div className={`p-2 rounded-lg transition-colors ${
            isTerminalOpen 
              ? 'text-obsidian-inkPrimary bg-obsidian-surface2' 
              : 'text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary group-hover:bg-obsidian-surface2'
          }`}>
            <TerminalSquare className="w-4 h-4" />
          </div>
        </button>

        {/* Settings */}
        <button
          onClick={() => setSettingsOpen(true)}
          title="Settings (AI Providers & Configuration)"
          className="w-full flex justify-center cursor-pointer py-1 group"
        >
          <div className="p-2 rounded-lg text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary group-hover:bg-obsidian-surface2 transition-colors">
            <Settings className="w-4 h-4" />
          </div>
        </button>
      </div>
    </aside>
  );
};

