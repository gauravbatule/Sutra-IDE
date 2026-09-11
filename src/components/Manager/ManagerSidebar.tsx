import React, { useState, useEffect } from 'react';
import { ChevronDown, FolderOpen, History, ListChecks, Plus, QrCode, Settings, Puzzle } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useChatSessionsStore } from '../../stores/sessionsStore.js';
import { ConversationList } from './ConversationList.js';
import { TaskManagerPanel } from './TaskManagerPanel.js';

interface ManagerSidebarProps {
  activeSessionId: string | null;
  refreshKey: number;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  /** Triggered by the in-sidebar chevron; parent decides what "hidden" means. */
  onCollapse?: () => void;
}

type SidebarSection = 'history' | 'tasks';

/**
 * Tiny uppercase section header — the single visual device that separates the
 * sidebar's groups (Pinned / Recent / Automations / Projects / Tools).
 * inkMuted is intentional here: headers are decoration, not content.
 */
const SECTION_LABEL_CLASSES =
  'text-[9px] font-semibold uppercase tracking-[0.12em] text-obsidian-inkMuted';

const RECENT_WORKSPACES_KEY = 'sutra-recent-workspaces';

const readRecentWorkspaces = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_WORKSPACES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((v: unknown) => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const rememberWorkspace = (workspacePath: string): void => {
  try {
    const next = [workspacePath, ...readRecentWorkspaces().filter((p) => p !== workspacePath)].slice(0, 5);
    localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — recents stay session-less
  }
};

/** Workspace switcher: current folder, browse, create, and recent workspaces. */
export const WorkspaceMenu: React.FC<{ workspaceName: string }> = ({ workspaceName }) => {
  const { switchWorkspace, currentWorkspacePath, setFolderPickerOpen } = useIDEStore();
  const [isOpen, setIsOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [recent, setRecent] = useState<string[]>(() => readRecentWorkspaces());
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [menuError, setMenuError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen && currentWorkspacePath) {
      setCurrentPath(currentWorkspacePath);
      return;
    }
    fetch('/api/fs/workspace')
      .then((r) => r.json())
      .then((d) => {
        const p = typeof d.workspaceRoot === 'string' ? d.workspaceRoot : typeof d.path === 'string' ? d.path : '';
        if (p) setCurrentPath(p);
      })
      .catch(() => undefined);
  }, [isOpen, currentWorkspacePath]);

  const switchTo = async (workspacePath: string) => {
    setBusy(true);
    setMenuError(null);
    try {
      const result = await switchWorkspace(workspacePath);
      if (result.success) {
        rememberWorkspace(workspacePath);
        setRecent(readRecentWorkspaces());
        setCurrentPath(workspacePath);
        setIsOpen(false);
      } else {
        setMenuError(result.error || 'Could not switch workspace.');
      }
    } catch {
      setMenuError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const browseFolder = async () => {
    setBusy(true);
    setMenuError(null);
    try {
      const res = await fetch('/api/fs/browse-folder', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.path) {
        await switchWorkspace(data.path);
        rememberWorkspace(data.path);
        setRecent(readRecentWorkspaces());
        setCurrentPath(data.path);
        setIsOpen(false);
      } else if (data.message) {
        setMenuError(data.message);
      }
    } catch {
      setMenuError('Folder selection failed.');
    } finally {
      setBusy(false);
    }
  };

  const createWorkspace = async () => {
    if (!newPath.trim()) return;
    setBusy(true);
    setMenuError(null);
    try {
      const res = await fetch('/api/fs/create-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        const createdPath = data.workspacePath || newPath.trim();
        await switchWorkspace(createdPath);
        rememberWorkspace(createdPath);
        setRecent(readRecentWorkspaces());
        setCurrentPath(createdPath);
        setNewPath('');
        setCreating(false);
        setIsOpen(false);
      } else {
        setMenuError(data.error || 'Could not create the workspace.');
      }
    } catch {
      setMenuError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline hover:border-obsidian-border text-left transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border"
        title={`${workspaceName} — switch workspace`}
      >
        <FolderOpen className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" aria-hidden="true" />
        <span className="truncate text-xs text-obsidian-inkSecondary flex-1">{workspaceName}</span>
        <ChevronDown className={`w-3 h-3 text-obsidian-inkMuted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <>
          {/* z-20 keeps this below the z-30 header, so the backdrop no
              longer swallows clicks on the header's workspace controls. */}
          <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            aria-label="Workspace options"
            className="absolute bottom-full mb-1 left-0 right-0 z-50 rounded-lg bg-obsidian-surface1 border border-obsidian-border shadow-elevation p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150"
          >
            {currentPath && (
              <div className="px-2 py-1 text-[10px] font-mono text-obsidian-inkSecondary truncate" title={currentPath}>
                {currentPath}
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setFolderPickerOpen(true);
                setIsOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer flex items-center justify-between"
            >
              <span>Project Hub & Starters…</span>
              <span className="text-[10px] text-obsidian-inkMuted font-mono">Hub</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={browseFolder}
              disabled={busy}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer disabled:opacity-50"
            >
              Open Folder…
            </button>
            {!creating ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => setCreating(true)}
                disabled={busy}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer disabled:opacity-50"
              >
                Create Workspace…
              </button>
            ) : (
              <div className="px-1 py-1 space-y-1.5">
                <input
                  type="text"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createWorkspace();
                    if (e.key === 'Escape') setCreating(false);
                  }}
                  placeholder="C:\projects\my-app"
                  aria-label="New workspace folder path"
                  autoFocus
                  className="w-full px-2 py-1.5 rounded-lg bg-transparent border border-obsidian-border focus:border-obsidian-borderBright text-xs text-obsidian-inkPrimary placeholder-obsidian-inkSecondary focus:outline-none transition-colors"
                />
                <div className="flex gap-1.5 justify-end">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="px-2 py-1 rounded-lg text-[10px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createWorkspace}
                    disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-obsidian-accentHover text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
            {recent.length > 0 && (
              <>
                <div className={`px-2 pt-1.5 pb-1 ${SECTION_LABEL_CLASSES}`}>Recent</div>
                {recent.map((recentPath) => (
                  <button
                    key={recentPath}
                    type="button"
                    role="menuitem"
                    onClick={() => switchTo(recentPath)}
                    disabled={busy}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-mono text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer disabled:opacity-50 truncate"
                    title={recentPath}
                  >
                    {recentPath}
                  </button>
                ))}
              </>
            )}
            {menuError && <div className="px-2 py-1 text-[10px] text-red-400">{menuError}</div>}
          </div>
        </>
      )}
    </div>
  );
};

export const ManagerSidebar: React.FC<ManagerSidebarProps> = ({
  activeSessionId,
  refreshKey,
  onNewConversation,
  onOpenConversation,
  onDeleteConversation,
  onCollapse: _onCollapse,
}) => {
  const pinnedSessionIds = useIDEStore((s) => s.pinnedSessionIds);
  const togglePinSession = useIDEStore((s) => s.togglePinSession);
  const setSettingsOpen = useIDEStore((s) => s.setSettingsOpen);
  const setSkillsModalOpen = useIDEStore((s) => s.setSkillsModalOpen);
  const setQRPairingOpen = useIDEStore((s) => s.setQRPairingOpen);
  const isAgentGenerating = useIDEStore((s) => s.isAgentGenerating);
  const authWorkspaces = useAuthStore((s) => s.workspaces);
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const [section, setSection] = useState<SidebarSection>('history');
  // Shared no-flash session store: background refreshes keep previous rows
  // rendered instead of swapping to skeletons (see stores/sessionsStore.ts).
  const { sessions, isLoading, error, refresh } = useChatSessionsStore();

  // Parent bumps refreshKey after creating/syncing/deleting sessions
  useEffect(() => {
    if (refreshKey > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const pinnedSessions = sessions.filter((s) => pinnedSessionIds.includes(s.id));
  const unpinnedSessions = sessions.filter((s) => !pinnedSessionIds.includes(s.id));
  const currentWorkspaceName = useIDEStore((s) => s.currentWorkspaceName);
  const currentWorkspacePath = useIDEStore((s) => s.currentWorkspacePath);
  const workspaceName =
    currentWorkspaceName ||
    (currentWorkspacePath ? currentWorkspacePath.split(/[/\\]/).filter(Boolean).pop() : '') ||
    authWorkspaces.find((w) => w.id === activeWorkspaceId)?.name ||
    'This workspace';

  const renderHistoryList = (list: typeof sessions, emptyMessage: string) => (
    <ConversationList
      sessions={list}
      isLoading={isLoading}
      error={error}
      activeSessionId={activeSessionId}
      pinnedSessionIds={pinnedSessionIds}
      emptyMessage={emptyMessage}
      workingSessionId={isAgentGenerating ? activeSessionId : null}
      onRetry={refresh}
      onOpen={onOpenConversation}
      onDelete={onDeleteConversation}
      onTogglePin={togglePinSession}
    />
  );

  return (
    <aside className="w-[280px] min-w-[280px] h-full flex flex-col bg-obsidian-surface1 border-r border-obsidian-hairline shrink-0 select-none">
      {/* Primary action (brand mark and permanent sidebar toggle live in the top bar) */}
      <div className="px-3 pt-3 shrink-0">
        <button
          onClick={onNewConversation}
          title="Start a new conversation"
          className="w-full h-8 rounded-md bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-obsidian-accentHover text-xs font-medium transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-obsidian-borderBright"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>New Conversation</span>
        </button>
      </div>

      {/* Section nav */}
      <nav className="px-1.5 pt-3 space-y-0.5 shrink-0" aria-label="Manager sections">
        <button
          onClick={() => setSection('history')}
          aria-current={section === 'history' ? 'page' : undefined}
          title="Conversation history"
          className={`w-full px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border ${
            section === 'history'
              ? 'bg-obsidian-surface2 text-obsidian-inkPrimary'
              : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1'
          }`}
        >
          <History className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          <span>Conversation History</span>
        </button>
        <button
          onClick={() => setSection('tasks')}
          aria-current={section === 'tasks' ? 'page' : undefined}
          title="Scheduled tasks"
          className={`w-full px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border ${
            section === 'tasks'
              ? 'bg-obsidian-surface2 text-obsidian-inkPrimary'
              : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1'
          }`}
        >
          <ListChecks className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          <span>Scheduled Tasks</span>
        </button>
      </nav>

      {/* Scrollable labeled groups */}
      <div className="flex-1 overflow-y-auto min-h-0 pt-4 pb-3">
        {section === 'tasks' ? (
          <section aria-label="Automations">
            <div className={`${SECTION_LABEL_CLASSES} px-3 pb-1.5`}>Automations</div>
            <TaskManagerPanel />
          </section>
        ) : (
          <div className="space-y-4">
            {(pinnedSessions.length > 0 || isLoading) && (
              <section aria-label="Pinned conversations">
                <div className={`${SECTION_LABEL_CLASSES} px-3 pb-1.5`}>Pinned</div>
                {renderHistoryList(pinnedSessions, 'Pin a conversation to keep it here')}
              </section>
            )}
            <section aria-label="Recent conversations">
              <div className={`${SECTION_LABEL_CLASSES} px-3 pb-1.5`}>Recent</div>
              {renderHistoryList(unpinnedSessions, 'No conversations yet — start one below')}
            </section>
          </div>
        )}
      </div>

      {/* Footer groups: project + tools */}
      <div className="border-t border-obsidian-hairline px-2 pt-3 pb-2 shrink-0">
        <section aria-label="Project workspace">
          <div className={`${SECTION_LABEL_CLASSES} px-2 pb-1.5`}>Projects</div>
          <WorkspaceMenu workspaceName={workspaceName} />
        </section>

        <section aria-label="Tools" className="mt-3">
          <div className={`${SECTION_LABEL_CLASSES} px-2 pb-1.5`}>Tools & Capabilities</div>
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => setSkillsModalOpen(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors duration-150 cursor-pointer focus-visible:outline-none"
            >
              <Puzzle className="w-3.5 h-3.5 text-obsidian-inkSecondary" aria-hidden="true" />
              <span>Skills & Plugins</span>
            </button>
            <button
              type="button"
              onClick={() => setQRPairingOpen(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors duration-150 cursor-pointer focus-visible:outline-none"
            >
              <QrCode className="w-3.5 h-3.5 text-obsidian-inkSecondary" aria-hidden="true" />
              <span>Mobile QR Connect</span>
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors duration-150 cursor-pointer focus-visible:outline-none"
            >
              <Settings className="w-3.5 h-3.5 text-obsidian-inkSecondary" aria-hidden="true" />
              <span>Settings</span>
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
};
