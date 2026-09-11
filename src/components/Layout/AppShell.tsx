import React, { useEffect } from 'react';
import { TitleBar } from './TitleBar.js';
import { ActivityBar } from './ActivityBar.js';
import { StatusBar } from './StatusBar.js';
import { FileTree } from '../Explorer/FileTree.js';
import { SearchPanel } from '../Search/SearchPanel.js';
import { GitPanel } from '../Git/GitPanel.js';
import { TabBar } from '../Editor/TabBar.js';
import { MonacoEditor } from '../Editor/MonacoEditor.js';
import { AgentChat } from '../Agent/AgentChat.js';
import { VisualSwarmGraph } from '../Swarm/VisualSwarmGraph.js';
import { ConPTYTerminal } from '../Terminal/ConPTYTerminal.js';
import { MultiViewport } from '../Preview/MultiViewport.js';
import { CommandPalette } from '../CommandPalette/CommandPalette.js';
import { SettingsModal } from '../Settings/SettingsModal.js';
import { GodlyVaultModal } from '../DesignVault/GodlyVaultModal.js';
import { AssetStudioModal } from '../MediaStudio/AssetStudioModal.js';
import { QRPairingModal } from '../MobileConnect/QRPairingModal.js';
import { UserGuideModal } from '../Guide/UserGuideModal.js';
import { useIDEStore } from '../../stores/ideStore.js';
import {
  FolderPlus,
  Settings,
  TerminalSquare
} from 'lucide-react';

export const AppShell: React.FC = () => {
  const {
    activeSidebar,
    activeTabPath,
    isTerminalOpen,
    isPreviewOpen,
    isSidebarOpen,
    isAgentPanelOpen,
    agentPanelWidth,
    isSettingsOpen,
    setSettingsOpen,
    setAvailableModels,
    setSubagents,
    setAssets,
    setCommandPaletteOpen,
  } = useIDEStore();

  useEffect(() => {
    // 1. Fetch available models
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => setAvailableModels(d.models || []))
      .catch(console.error);

    // 2. Fetch subagents
    fetch('/api/swarm/status')
      .then((r) => r.json())
      .then((d) => setSubagents(d.subagents || []))
      .catch(console.error);

    // 3. Fetch assets
    fetch('/api/media/assets')
      .then((r) => r.json())
      .then((d) => setAssets(d || []))
      .catch(console.error);
  }, [setAvailableModels, setSubagents, setAssets]);

  const handleBrowseFolder = async () => {
    try {
      const res = await fetch('/api/fs/browse-folder', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.path) {
        window.location.reload();
      }
    } catch {
      const p = prompt('Enter absolute path to workspace folder:');
      if (p) {
        fetch('/api/fs/set-workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p })
        }).then(() => window.location.reload());
      }
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-obsidian-canvas text-obsidian-inkPrimary overflow-hidden font-sans select-none">
      {/* 1. Desktop Window TitleBar */}
      <TitleBar />

      {/* 2. Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar (Icon Strip) */}
        <ActivityBar />

        {/* Primary Left Sidebar (File Explorer / Search / Git / Swarm) */}
        {isSidebarOpen && (
          <div className="w-64 flex flex-col overflow-hidden bg-obsidian-surface1 border-r border-obsidian-hairline shrink-0">
            {activeSidebar === 'explorer' && <FileTree />}
            {activeSidebar === 'search' && <SearchPanel />}
            {activeSidebar === 'git' && <GitPanel />}
            {activeSidebar === 'swarm' && <VisualSwarmGraph />}
          </div>
        )}

        {/* Center Workspace: Editor Tabs / Welcome Studio */}
        <div className="flex-1 flex flex-col min-w-0 bg-obsidian-canvas overflow-hidden">
          {activeTabPath ? (
            <>
              <TabBar />
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col min-w-0">
                  <MonacoEditor />
                  {isTerminalOpen && <ConPTYTerminal />}
                </div>
                {isPreviewOpen && <MultiViewport />}
              </div>
            </>
          ) : (
            <div className="flex-1 flex overflow-hidden">
              {/* Studio Welcome & Developer Workspace Dashboard */}
              <div className="flex-1 flex flex-col overflow-y-auto bg-obsidian-canvas text-obsidian-inkPrimary p-6 sm:p-10">
                <div className="max-w-2xl mx-auto w-full space-y-8 my-auto font-sans">
                  {/* Brand: icon + heading, nothing else */}
                  <div className="space-y-3">
                    <img src="/assets/sutra-icon.svg" alt="SUTRA" className="w-12 h-12 object-contain" />
                    <h1 className="text-xl sm:text-2xl font-light tracking-tight text-obsidian-inkPrimary">
                      Build at the speed of thought
                    </h1>
                  </div>

                  {/* Primary Workspace Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleBrowseFolder}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-obsidian-accentHover rounded transition-all cursor-pointer text-xs font-medium"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>Open Workspace</span>
                    </button>

                    <button
                      onClick={() => setCommandPaletteOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-obsidian-hairline bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkPrimary rounded transition-all cursor-pointer text-xs font-medium"
                    >
                      <span>Command Palette</span>
                      <span className="text-[10px] font-mono text-obsidian-inkMuted bg-obsidian-surface2 px-1 py-0.5 rounded">⌘K</span>
                    </button>

                    <button
                      onClick={() => setSettingsOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-obsidian-hairline bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary rounded transition-all cursor-pointer text-xs"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      <span>Configure Keys</span>
                    </button>
                  </div>

                  {/* Keyboard Shortcuts & Quick Telemetry */}
                  <div className="grid grid-cols-1 gap-4 pt-2 max-w-md">
                    {/* Shortcuts Section */}
                    <div className="p-4 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline space-y-2.5">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-obsidian-inkMuted flex items-center gap-1.5">
                        <TerminalSquare className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
                        <span>Keybindings</span>
                      </div>
                      <div className="space-y-1.5 text-xs text-obsidian-inkSecondary font-mono">
                        <div className="flex items-center justify-between">
                          <span>Command Palette</span>
                          <kbd className="px-1.5 py-0.5 rounded bg-obsidian-surface2 border border-obsidian-hairline text-[10px] text-obsidian-inkPrimary">⌘K</kbd>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Toggle Terminal</span>
                          <kbd className="px-1.5 py-0.5 rounded bg-obsidian-surface2 border border-obsidian-hairline text-[10px] text-obsidian-inkPrimary">⌘J</kbd>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Live Multi-Preview</span>
                          <kbd className="px-1.5 py-0.5 rounded bg-obsidian-surface2 border border-obsidian-hairline text-[10px] text-obsidian-inkPrimary">⌘\</kbd>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Toggle Sidebar</span>
                          <kbd className="px-1.5 py-0.5 rounded bg-obsidian-surface2 border border-obsidian-hairline text-[10px] text-obsidian-inkPrimary">⌘B</kbd>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {isTerminalOpen && <div className="border-t border-obsidian-hairline h-64 shrink-0 mt-6"><ConPTYTerminal /></div>}
              </div>

              {/* Live Assistant Panel on Welcome Home */}
              {isAgentPanelOpen && (
                <div className={`${
                  agentPanelWidth === 'compact' ? 'w-[320px] min-w-[320px] max-w-[320px]' :
                  agentPanelWidth === 'wide' ? 'w-[600px] min-w-[600px] max-w-[600px]' :
                  agentPanelWidth === 'expanded' ? 'w-[820px] min-w-[820px] max-w-[820px]' :
                  'w-[420px] min-w-[420px] max-w-[420px]'
                } flex flex-col overflow-hidden bg-obsidian-surface1 border-l border-obsidian-hairline shrink-0 transition-[width] duration-150`}>
                  <AgentChat />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Agent Panel when Editor Tab is Active */}
        {activeTabPath && isAgentPanelOpen && (
          <div className={`${
            agentPanelWidth === 'compact' ? 'w-[320px] min-w-[320px] max-w-[320px]' :
            agentPanelWidth === 'wide' ? 'w-[600px] min-w-[600px] max-w-[600px]' :
            agentPanelWidth === 'expanded' ? 'w-[820px] min-w-[820px] max-w-[820px]' :
            'w-[420px] min-w-[420px] max-w-[420px]'
          } flex flex-col overflow-hidden bg-obsidian-surface1 border-l border-obsidian-hairline shrink-0 transition-[width] duration-150`}>
            <AgentChat />
          </div>
        )}
      </div>

      {/* 3. Status Bar */}
      <StatusBar />

      {/* Modals & Dialogs */}
      <CommandPalette />
      <SettingsModal isOpen={isSettingsOpen || activeSidebar === 'settings'} onClose={() => setSettingsOpen(false)} />
      <GodlyVaultModal />
      <AssetStudioModal />
      <QRPairingModal />
      <UserGuideModal />
    </div>
  );
};

