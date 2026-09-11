import React, { useEffect, useState } from 'react';
import { ChevronDown, FolderOpen, History, ListChecks, Plus, QrCode, Settings } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useChatSessions } from './useChatSessions.js';
import { ConversationList } from './ConversationList.js';
import { TaskManagerPanel } from './TaskManagerPanel.js';

interface ManagerSidebarProps {
  activeSessionId: string | null;
  refreshKey: number;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

type SidebarSection = 'history' | 'tasks';

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
  const [isOpen, setIsOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [recent, setRecent] = useState<string[]>(() => readRecentWorkspaces());
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [menuError, setMenuError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/fs/workspace')
      .then((r) => r.json())
      .then((d) => setCurrentPath(typeof d.path === 'string' ? d.path : ''))
      .catch(() => undefined);
  }, [isOpen]);

  const switchTo = async (workspacePath: string) => {
    setBusy(true);
    setMenuError(null);
    try {
      const res = await fetch('/api/fs/set-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workspacePath }),
      });
      const data = await res.json();
      if (data.success) {
        rememberWorkspace(workspacePath);
        setRecent(readRecentWorkspaces());
        setCurrentPath(workspacePath);
        setIsOpen(false);
      } else {
        setMenuError(data.error || 'Could not switch workspace.');
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
        rememberWorkspace(data.workspacePath);
        setRecent(readRecentWorkspaces());
        setCurrentPath(data.workspacePath);
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
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline hover:border-white/20 text-left transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        title={`${workspaceName} — switch workspace`}
      >
        <FolderOpen className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" aria-hidden="true" />
        <span className="truncate text-xs text-obsidian-inkSecondary flex-1">{workspaceName}</span>
        <ChevronDown className={`w-3 h-3 text-obsidian-inkMuted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            aria-label="Workspace options"
            className="absolute bottom-full mb-1 left-0 right-0 z-50 rounded-xl bg-[#141419] border border-white/15 shadow-elevation p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150"
          >
            {currentPath && (
              <div className="px-2 py-1 text-[10px] font-mono text-obsidian-inkMuted truncate" title={currentPath}>
                {currentPath}
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={browseFolder}
              disabled={busy}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50"
            >
              Open Folder…
            </button>
            {!creating ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => setCreating(true)}
                disabled={busy}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50"
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
                  className="w-full px-2 py-1.5 rounded-lg bg-transparent border border-white/10 focus:border-white/25 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none transition-colors"
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
                    className="px-2.5 py-1 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-zinc-200 text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
            {recent.length > 0 && (
              <>
                <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Recent</div>
                {recent.map((recentPath) => (
                  <button
                    key={recentPath}
                    type="button"
                    role="menuitem"
                    onClick={() => switchTo(recentPath)}
                    disabled={busy}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-mono text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50 truncate"
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
}) => {
  const pinnedSessionIds = useIDEStore((s) => s.pinnedSessionIds);
  const togglePinSession = useIDEStore((s) => s.togglePinSession);
  const setSettingsOpen = useIDEStore((s) => s.setSettingsOpen);
  const setQRPairingOpen = useIDEStore((s) => s.setQRPairingOpen);
  const isAgentGenerating = useIDEStore((s) => s.isAgentGenerating);
  const authWorkspaces = useAuthStore((s) => s.workspaces);
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const [section, setSection] = useState<SidebarSection>('history');
  const { sessions, isLoading, error, refresh } = useChatSessions();

  // Parent bumps refreshKey after creating/syncing/deleting sessions
  useEffect(() => {
    if (refreshKey > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const pinnedSessions = sessions.filter((s) => pinnedSessionIds.includes(s.id));
  const unpinnedSessions = sessions.filter((s) => !pinnedSessionIds.includes(s.id));
  const workspaceName =
    authWorkspaces.find((w) => w.id === activeWorkspaceId)?.name || authWorkspaces[0]?.name || 'This workspace';

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
      {/* Primary action (brand mark lives in the single top bar) */}
      <div className="p-3 pb-2 shrink-0">
        <button
          onClick={onNewConversation}
          className="w-full px-3 py-2 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-zinc-200 text-xs font-semibold transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>New Conversation</span>
        </button>
      </div>

      {/* Section nav */}
      <nav className="px-2 space-y-0.5 shrink-0" aria-label="Manager sections">
        <button
          onClick={() => setSection('history')}
          aria-current={section === 'history' ? 'page' : undefined}
          className={`w-full px-2 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
            section === 'history'
              ? 'bg-white/[0.08] text-obsidian-inkPrimary'
              : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.04]'
          }`}
        >
          <History className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          <span>Conversation History</span>
        </button>
        <button
          onClick={() => setSection('tasks')}
          aria-current={section === 'tasks' ? 'page' : undefined}
          className={`w-full px-2 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
            section === 'tasks'
              ? 'bg-white/[0.08] text-obsidian-inkPrimary'
              : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.04]'
          }`}
        >
          <ListChecks className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          <span>Scheduled Tasks</span>
        </button>
      </nav>

      {/* Scrollable lower section */}
      <div className="flex-1 overflow-y-auto py-2 min-h-0">
        {section === 'tasks' ? (
          <TaskManagerPanel />
        ) : (
          <div className="space-y-3">
            {(pinnedSessions.length > 0 || isLoading) && (
              <section aria-label="Pinned conversations">
                <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
                  Pinned Conversations
                </div>
                {renderHistoryList(pinnedSessions, 'Pin a conversation to keep it here')}
              </section>
            )}
            <section aria-label="Conversations">
              <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
                Conversations
              </div>
              {renderHistoryList(unpinnedSessions, 'No conversations yet — start one below')}
            </section>
          </div>
        )}
      </div>

      {/* Projects footer */}
      <div className="border-t border-obsidian-hairline p-3 pb-2 shrink-0">
        <div className="px-0 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">
          Projects
        </div>
        <WorkspaceMenu workspaceName={workspaceName} />

        {/* Settings entry point */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="mt-1 w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        >
          <Settings className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          <span>Settings</span>
        </button>

        {/* Sole QR-pairing entry in Manager mode — opens the shared pairing modal */}
        <button
          onClick={() => setQRPairingOpen(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          title="Pair the mobile companion over LAN"
        >
          <QrCode className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          <span>Pair Phone (QR)</span>
        </button>
      </div>
    </aside>
  );
};
