import React, { useEffect } from 'react';
import { TitleBar } from './TitleBar.js';
import { ActivityBar } from './ActivityBar.js';
import { SidebarPanelHeader } from './SidebarPanelHeader.js';
import { StatusBar } from './StatusBar.js';
import { FileTree } from '../Explorer/FileTree.js';
import { SearchPanel } from '../Search/SearchPanel.js';
import { ArtifactsPanel } from '../Artifacts/ArtifactsPanel.js';
import { GitPanel } from '../Git/GitPanel.js';
import { OutlinePanel } from '../Editor/OutlinePanel.js';
import { OpenFolderModal } from '../Explorer/OpenFolderModal.js';
import { TabBar } from '../Editor/TabBar.js';
import { MonacoEditor } from '../Editor/MonacoEditor.js';
import { EmptyEditorState } from '../Editor/EmptyEditorState.js';
import { AgentChat } from '../Agent/AgentChat.js';
import { HeroComposer } from '../Manager/HeroComposer.js';
import { VisualSwarmGraph } from '../Swarm/VisualSwarmGraph.js';
import { ConPTYTerminal } from '../Terminal/ConPTYTerminal.js';
import { MultiViewport } from '../Preview/MultiViewport.js';
import { CommandPalette } from '../CommandPalette/CommandPalette.js';
import { SettingsModal } from '../Settings/SettingsModal.js';
import { GodlyVaultModal } from '../DesignVault/GodlyVaultModal.js';
import { AssetStudioModal } from '../MediaStudio/AssetStudioModal.js';
import { QRPairingModal } from '../MobileConnect/QRPairingModal.js';
import { UserGuideModal } from '../Guide/UserGuideModal.js';
import { CoffeeModal } from '../Coffee/CoffeeModal.js';
import { SkillsModal } from '../Skills/SkillsModal.js';
import { ArtifactViewerModal } from '../Artifacts/ArtifactViewerModal.js';
import { useIDEStore } from '../../stores/ideStore.js';
import { useResizablePanel } from '../../hooks/useResizablePanel.js';
import { PanelResizeHandle } from './PanelResizeHandle.js';
import { sendAgentPrompt, cancelAgentStream } from '../../utils/agentSocket.js';

/** Pixel width each legacy store preset maps to when nothing is persisted yet. */
const AGENT_PANEL_PRESET_WIDTHS: Record<'compact' | 'normal' | 'wide' | 'expanded', number> = {
  compact: 320,
  normal: 420,
  wide: 600,
  expanded: 820,
};

export const AppShell: React.FC = () => {
  const {
    activeSidebar,
    openTabs,
    activeTabPath,
    isTerminalOpen,
    isPreviewOpen,
    previewLayout,
    activeCenterView,
    setPreviewLayout,
    isSidebarOpen,
    isAgentPanelOpen,
    isAgentGenerating,
    agentPanelWidth,
    isSettingsOpen,
    setSettingsOpen,
    setAvailableModels,
    setSubagents,
    setAssets,
    uiMode,
    setAgentPanelOpen,
  } = useIDEStore();

  // Free drag-resize for the right agent panel (both welcome-home and editor
  // hosts share one instance — they never mount at the same time). Persisted
  // width wins over the legacy preset; the preset is only the initial default.
  const agentPanel = useResizablePanel({
    defaultWidth: AGENT_PANEL_PRESET_WIDTHS[agentPanelWidth] ?? AGENT_PANEL_PRESET_WIDTHS.normal,
  });

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => setAvailableModels(d.models || []))
      .catch(console.error);

    fetch('/api/swarm/status')
      .then((r) => r.json())
      .then((d) => setSubagents(d.subagents || []))
      .catch(console.error);

    fetch('/api/media/assets')
      .then((r) => r.json())
      .then((d) => setAssets(d || []))
      .catch(console.error);
  }, [setAvailableModels, setSubagents, setAssets]);

  return (
    <div className="h-screen w-screen flex flex-col bg-obsidian-canvas text-obsidian-inkPrimary overflow-hidden font-sans select-none">
      {/* 1. Desktop Window TitleBar */}
      <TitleBar />

      {/* 2. Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Activity Bar (Icon Strip) */}
        <ActivityBar />

        {/* Primary Left Sidebar — hidden on the welcome studio so the hero can breathe. */}
        {!isAgentPanelOpen && isSidebarOpen && activeSidebar === 'explorer' && !activeTabPath ? (
          // Welcome studio: explorer is suppressed on purpose.
          null
        ) : isSidebarOpen ? (
          <div className="w-64 flex flex-col overflow-hidden bg-obsidian-surface1 border-r border-obsidian-hairline shrink-0">
            {/* Section header owns the collapse control — it sits on the panel
                it collapses instead of in the opposite corner of the window. */}
            <SidebarPanelHeader />
            {activeSidebar === 'explorer' && <FileTree />}
            {activeSidebar === 'outline' && <OutlinePanel />}
            {activeSidebar === 'search' && <SearchPanel />}
            {activeSidebar === 'artifacts' && <ArtifactsPanel />}
            {activeSidebar === 'git' && <GitPanel />}
            {activeSidebar === 'swarm' && <VisualSwarmGraph />}
          </div>
        ) : null}

        {/* Center Workspace: Editor Tabs / Welcome Studio / Full Center Live Preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-obsidian-canvas overflow-hidden">
          {isPreviewOpen && (previewLayout === 'full' || !activeTabPath || activeCenterView === 'preview') ? (
            <div className="flex-1 flex flex-col min-w-0 w-full h-full overflow-hidden relative">
              {openTabs.length > 0 && <TabBar />}
              <div className="flex-1 flex overflow-hidden w-full h-full relative">
                <MultiViewport />
              </div>
            </div>
          ) : isPreviewOpen && previewLayout === 'split' && activeTabPath ? (
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0">
                <TabBar />
                <div className="flex-1 flex overflow-hidden">
                  <MonacoEditor />
                </div>
              </div>
              <div className="flex-1 flex overflow-hidden border-l border-obsidian-hairline">
                <MultiViewport />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {activeTabPath ? (
                <>
                  <TabBar />
                  <div className="flex-1 flex overflow-hidden">
                    <MonacoEditor />
                  </div>
                </>
              ) : (
                <div className="flex-1 flex overflow-hidden ambient-glow">
                  <EmptyEditorState
                    isGenerating={isAgentGenerating}
                    onSend={(text) => {
                      sendAgentPrompt({ text, attachedContext: null });
                    }}
                    onCancel={() => cancelAgentStream()}
                  />
                </div>
              )}
            </div>
          )}

          {/* Integrated ConPTY Terminal Drawer in IDE Mode (Always available in both editor & welcome state!) */}
          {isTerminalOpen && <ConPTYTerminal />}
        </div>

        {/* Live Assistant Panel */}
        {isAgentPanelOpen && (
          <div
            className="relative flex flex-col overflow-hidden bg-obsidian-surface1 border-l border-obsidian-hairline shrink-0 anim-fade-in"
            style={{ width: `${agentPanel.width}px` }}
          >
            <PanelResizeHandle
              handleProps={agentPanel.handleProps}
              isResizing={agentPanel.isResizing}
              label="Resize assistant panel"
            />
            <AgentChat />
          </div>
        )}

        {/* The full composer remains available even while the persisted IDE
            assistant sidebar is closed; sending reopens the transcript panel. */}
        {!isAgentPanelOpen && uiMode === 'ide' && (
          <div className="absolute bottom-10 right-5 z-30 w-[min(36rem,calc(100vw-3rem))]">
            <HeroComposer
              isGenerating={isAgentGenerating}
              autoFocus={false}
              lockSingleLine
              onSend={(text, images, attachment, mode) => {
                setAgentPanelOpen(true);
                void sendAgentPrompt({
                  text,
                  images,
                  attachedContext: attachment ? `Attached file: ${attachment.name}\n\n${attachment.content}` : null,
                  mode,
                });
              }}
              onCancel={() => cancelAgentStream()}
            />
          </div>
        )}
      </div>

      {/* 3. Status Bar */}
      <StatusBar />

      {/* Modals & Dialogs */}
      <CommandPalette />
      <OpenFolderModal />
      <SettingsModal isOpen={isSettingsOpen || activeSidebar === 'settings'} onClose={() => setSettingsOpen(false)} />
      <GodlyVaultModal />
      <AssetStudioModal />
      <QRPairingModal />
      <UserGuideModal />
      <CoffeeModal />
      <SkillsModal />
      <ArtifactViewerModal />
    </div>
  );
};
