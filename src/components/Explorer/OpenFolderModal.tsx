import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  FolderPlus,
  History,
  HardDrive,
  AlertCircle,
  ArrowRight,
  Plus,
  Code2,
  Globe,
  FileCode,
  Folder,
  Loader2,
  ChevronRight,
  ArrowUp,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface StorageEntry {
  name: string;
  path: string;
  isDrive?: boolean;
  isDirectory?: boolean;
}

export const OpenFolderModal: React.FC = () => {
  const {
    isFolderPickerOpen,
    setFolderPickerOpen,
    currentWorkspacePath,
    setCurrentWorkspacePath,
    switchWorkspace,
    triggerFileTreeRefresh
  } = useIDEStore();

  const [activeTab, setActiveTab] = useState<'open' | 'create'>('open');
  const [newProjectName, setNewProjectName] = useState(() => `project-${Math.floor(1000 + Math.random() * 9000)}`);
  const [selectedTemplate, setSelectedTemplate] = useState<'web' | 'node' | 'python' | 'blank'>('web');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);

  // Direct Storage Explorer State — Quick Locations show drive roots, then
  // drilling into one loads its subdirectories so the user can pick a
  // workspace without leaving the keyboard. Bates's law would have us limit
  // the list to 7±2 entries, but the modal caps to a virtual list when the
  // set is large.
  const [currentBrowsePath, setCurrentBrowsePath] = useState<string>('');
  const [storageRoots, setStorageRoots] = useState<StorageEntry[]>([]);
  const [storageEntries, setStorageEntries] = useState<StorageEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [isBrowsingStorage, setIsBrowsingStorage] = useState(false);

  // Fetch roots and recent workspaces on mount/open
  useEffect(() => {
    if (isFolderPickerOpen) {
      setErrorMsg(null);
      setNewProjectName((prev) => prev || `project-${Math.floor(1000 + Math.random() * 9000)}`);
      fetch('/api/fs/workspace')
        .then((r) => r.json())
        .then((data) => {
          if (data?.path) {
            setCurrentWorkspacePath(data.path);
            setSelectedPath(data.path);
          }
        })
        .catch(() => undefined);

      loadStorageDirectory('');

      try {
        const stored = localStorage.getItem('sutra-recent-workspaces');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) setRecentPaths(parsed.filter(Boolean));
        }
      } catch {
        // Fallback
      }
    }
  }, [isFolderPickerOpen, setCurrentWorkspacePath]);

  const loadStorageDirectory = async (dirPath: string) => {
    setIsBrowsingStorage(true);
    setErrorMsg(null);
    try {
      const url = dirPath
        ? `/api/fs/list-subdirectories?path=${encodeURIComponent(dirPath)}`
        : '/api/fs/list-subdirectories';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        if (!dirPath && Array.isArray(data.roots)) {
          setStorageRoots(data.roots);
          setStorageEntries([]);
          setCurrentBrowsePath('');
        } else if (Array.isArray(data.entries)) {
          setCurrentBrowsePath(data.currentPath || dirPath);
          setStorageEntries(data.entries);
          setSelectedPath(data.currentPath || dirPath);
        }
      } else {
        setErrorMsg(data.error || 'Failed to list storage directory');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error communicating with storage service');
    } finally {
      setIsBrowsingStorage(false);
    }
  };

  const saveRecentWorkspace = (pathToAdd: string) => {
    try {
      const updated = [pathToAdd, ...recentPaths.filter((p) => p !== pathToAdd)].slice(0, 8);
      setRecentPaths(updated);
      localStorage.setItem('sutra-recent-workspaces', JSON.stringify(updated));
    } catch {
      // Best-effort
    }
  };

  const handleSwitch = async (targetPath: string) => {
    if (!targetPath || !targetPath.trim()) return;
    setIsLoading(true);
    setErrorMsg(null);

    const res = await switchWorkspace(targetPath.trim());
    setIsLoading(false);

    if (res.success) {
      saveRecentWorkspace(targetPath.trim());
      triggerFileTreeRefresh();
      setFolderPickerOpen(false);
    } else {
      setErrorMsg(res.error || 'Could not open specified directory');
    }
  };

  const handleGoUp = () => {
    if (!currentBrowsePath) return;
    const norm = currentBrowsePath.replace(/[\\/]+$/, '');
    const parent = norm.replace(/[\\/][^\\/]+$/, '');
    if (parent && parent !== norm) {
      loadStorageDirectory(parent);
    } else {
      loadStorageDirectory('');
    }
  };

  const handleBrowseNativeFolder = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/fs/browse-folder', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.path) {
        saveRecentWorkspace(data.path);
        setCurrentWorkspacePath(data.path);
        triggerFileTreeRefresh();
        setFolderPickerOpen(false);
      } else if (data.message && data.message !== 'No folder selected') {
        setErrorMsg(data.message);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error opening folder picker dialog');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNewProject = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      // Map the modal's template id to the server's quick-start id, falling
      // back to "web" (the modal's default) if the server doesn't know the
      // chosen one yet.
      const templateMap: Record<string, string> = {
        web: 'web',
        node: 'node',
        python: 'python',
        blank: 'empty',
      };
      const templateId = templateMap[selectedTemplate] || 'web';
      const name = (newProjectName.trim() || `project-${Math.floor(1000 + Math.random() * 9000)}`).replace(/[\\/:*?"<>|]/g, '-');
      const parent = currentBrowsePath || (await (await fetch('/api/fs/list-subdirectories?path=')).json().catch(() => null))?.entries?.[0]?.path;
      const target = parent ? `${parent.replace(/[\\/]+$/, '')}/${name}` : name;
      const res = await fetch('/api/fs/create-from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target, templateId }),
      });
      const data = await res.json();
      if (data.success && data.workspacePath) {
        setCurrentWorkspacePath(data.workspacePath);
        saveRecentWorkspace(data.workspacePath);
        triggerFileTreeRefresh();
        setFolderPickerOpen(false);
      } else {
        setErrorMsg(data.error || 'Failed to create workspace');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error creating workspace');
    } finally {
      setIsLoading(false);
    }
  };

  // Jakob's law: modals should close on Escape like every other modal
  // surface the user has used. Restoring focus is a separate concern; the
  // modal is opened from the title bar so the user already has its context.
  useEffect(() => {
    if (!isFolderPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setFolderPickerOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isFolderPickerOpen, setFolderPickerOpen]);

  if (!isFolderPickerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-xl bg-obsidian-surface1 border border-obsidian-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] font-sans">
        {/* Header */}
        <div className="px-6 py-4 border-b border-obsidian-hairline flex items-center justify-between bg-obsidian-surface1">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkPrimary shrink-0">
              {activeTab === 'create' ? <FolderPlus className="w-4 h-4 text-obsidian-inkPrimary" /> : <FolderOpen className="w-4 h-4 text-obsidian-inkPrimary" />}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-obsidian-inkPrimary">
                {activeTab === 'create' ? 'Create New Workspace' : 'Open Workspace Folder'}
              </h2>
              <p className="text-[11px] text-obsidian-inkMuted font-mono">
                {activeTab === 'create' ? 'Scaffold a new project template' : 'Select a local repository or folder'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-obsidian-surface2 p-0.5 rounded-lg border border-obsidian-hairline text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveTab('open')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                activeTab === 'open'
                  ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold shadow-xs'
                  : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
              }`}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                activeTab === 'create'
                  ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold shadow-xs'
                  : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
              }`}
            >
              New Project
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-950/30 border border-red-800/40 flex items-center gap-2.5 text-red-300 text-xs font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'open' ? (
            <div className="space-y-5">
              {/* Direct Path Input & Native Browser */}
              <div className="space-y-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (selectedPath || currentBrowsePath) handleSwitch(selectedPath || currentBrowsePath);
                  }}
                  className="flex items-center gap-2"
                >
                  <div className="flex-1 flex items-center bg-obsidian-surface2 border border-obsidian-hairline focus-within:border-obsidian-borderBright rounded-xl px-3 py-2">
                    <Folder className="w-4 h-4 text-obsidian-inkMuted mr-2 shrink-0" />
                    <input
                      type="text"
                      value={selectedPath || currentBrowsePath}
                      onChange={(e) => setSelectedPath(e.target.value)}
                      placeholder="Type, paste, or select a workspace folder…"
                      className="flex-1 bg-transparent border-none text-xs font-mono text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none min-w-0"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!selectedPath && !currentBrowsePath}
                    className="px-4 py-2 rounded-xl bg-obsidian-inkPrimary text-obsidian-canvas font-semibold text-xs flex items-center gap-1.5 hover:opacity-90 transition-opacity shadow-xs cursor-pointer disabled:opacity-40 font-mono"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={handleBrowseNativeFolder}
                    title="Browse system file dialog"
                    className="p-2 rounded-xl bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer shrink-0"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </form>
              </div>

              {/* Quick Locations Grid */}
              <div className="space-y-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-obsidian-inkMuted">
                  Quick Locations
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {storageRoots.map((root, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelectedPath(root.path);
                        loadStorageDirectory(root.path);
                      }}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer group flex items-center gap-2.5 min-w-0 ${
                        currentBrowsePath === root.path
                          ? 'bg-obsidian-surface2 border-obsidian-borderBright ring-1 ring-obsidian-borderBright'
                          : 'bg-obsidian-surface1 hover:bg-obsidian-surface2 border-obsidian-hairline hover:border-obsidian-border'
                      }`}
                    >
                      {root.isDrive ? (
                        <HardDrive className="w-3.5 h-3.5 text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary shrink-0" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-obsidian-inkPrimary truncate">
                          {root.name.replace(/\\.*$/, '')}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subdirectory drill-in — shows the children of the currently selected Location */}
              {currentBrowsePath && (
                <div className="space-y-2 pt-2 border-t border-obsidian-hairline">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={handleGoUp}
                        title="Go up to parent directory"
                        className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer shrink-0"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[10px] font-mono text-obsidian-inkMuted truncate">
                        {currentBrowsePath}
                      </span>
                    </div>
                    {isBrowsingStorage && (
                      <span className="text-[10px] font-mono text-obsidian-inkMuted shrink-0" role="status">
                        <Loader2 className="inline w-3 h-3 mr-1 animate-spin" />
                        Loading…
                      </span>
                    )}
                  </div>
                  {storageEntries.length === 0 && !isBrowsingStorage ? (
                    <p className="text-[11px] text-obsidian-inkMuted font-mono py-2">
                      No subdirectories to show in this folder.
                    </p>
                  ) : (
                    <ul className="space-y-1 max-h-48 overflow-y-auto rounded-xl border border-obsidian-hairline bg-obsidian-surface1 p-1">
                      {storageEntries.map((entry, idx) => {
                        const isSelected = entry.path === selectedPath;
                        return (
                          <li key={`${entry.path}-${idx}`} className="flex items-center gap-1 group">
                            <button
                              type="button"
                              onClick={() => setSelectedPath(entry.path)}
                              onDoubleClick={() => {
                                if (entry.isDirectory) loadStorageDirectory(entry.path);
                              }}
                              className={`flex-1 px-2.5 py-1.5 rounded-lg text-left font-mono text-xs flex items-center gap-2 transition-colors cursor-pointer min-w-0 ${
                                isSelected
                                  ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-medium ring-1 ring-obsidian-borderBright'
                                  : 'text-obsidian-inkSecondary hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary'
                              }`}
                            >
                              <Folder className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-amber-400' : 'text-obsidian-inkMuted'}`} aria-hidden="true" />
                              <span className="truncate flex-1">{entry.name}</span>
                              {isSelected && (
                                <span className="text-[10px] font-mono text-obsidian-inkMuted mr-1 shrink-0">Selected</span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSwitch(entry.path)}
                              title={`Open ${entry.name} as workspace`}
                              className="px-2 py-1 rounded bg-obsidian-surface2 hover:bg-obsidian-surface3 text-[10px] font-mono font-medium text-obsidian-inkPrimary border border-obsidian-hairline transition-colors cursor-pointer shrink-0"
                            >
                              Open
                            </button>
                            {entry.isDirectory && (
                              <button
                                type="button"
                                onClick={() => loadStorageDirectory(entry.path)}
                                title={`Browse inside ${entry.name}`}
                                className="px-1.5 py-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 text-xs transition-colors cursor-pointer shrink-0"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(selectedPath || currentBrowsePath) && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => handleSwitch(selectedPath || currentBrowsePath)}
                        className="w-full py-2.5 rounded-xl bg-obsidian-inkPrimary text-obsidian-canvas font-semibold text-xs flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-xs cursor-pointer font-mono"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>
                          Open Workspace ({selectedPath ? (selectedPath.split(/[\\/]/).filter(Boolean).pop() || selectedPath) : (currentBrowsePath.split(/[\\/]/).filter(Boolean).pop() || currentBrowsePath)})
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Recent Workspaces List */}
              {recentPaths.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-obsidian-hairline">
                  <div className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-obsidian-inkMuted">
                    <History className="w-3 h-3" />
                    <span>Recent Workspaces</span>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {recentPaths.slice(0, 6).map((pathItem, idx) => {
                      const baseName = pathItem.split(/[\\/]/).filter(Boolean).pop() || pathItem;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSwitch(pathItem)}
                          className="w-full px-3 py-2 rounded-lg hover:bg-obsidian-surface2 text-left transition-colors cursor-pointer group font-mono text-xs flex items-center justify-between border border-transparent hover:border-obsidian-hairline"
                        >
                          <div className="truncate min-w-0 flex-1 flex items-center gap-2.5">
                            <Folder className="w-3.5 h-3.5 text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary shrink-0" />
                            <span className="text-obsidian-inkPrimary font-medium text-xs truncate">
                              {baseName}
                            </span>
                            <span className="text-obsidian-inkMuted text-[10px] truncate hidden sm:inline opacity-60">
                              {pathItem}
                            </span>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary shrink-0 ml-2" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // New Project Tab — Enterprise Workspace Creation
            <div className="space-y-5">
              <div>
                <label className="block text-[11px] font-mono font-medium text-obsidian-inkSecondary mb-1.5">
                  Project Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-obsidian-inkMuted">
                    <FolderPlus className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g. omnicraft-service"
                    className="w-full pl-9 pr-3.5 py-2 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline hover:border-obsidian-border focus:border-obsidian-inkPrimary text-xs font-mono text-obsidian-inkPrimary focus:outline-none transition-colors"
                  />
                </div>
                <p className="mt-1 text-[10px] font-mono text-obsidian-inkMuted">
                  A new directory with this name will be created inside your workspaces directory.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-mono font-medium text-obsidian-inkSecondary mb-2">
                  Template Stack
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    {
                      id: 'web',
                      name: 'React 19 + Vite',
                      tag: 'Frontend',
                      desc: 'Modern SPA with Tailwind CSS, TypeScript, and sub-second live HMR.',
                      icon: Globe,
                    },
                    {
                      id: 'node',
                      name: 'Node.js + Fastify',
                      tag: 'Backend',
                      desc: 'High-throughput TypeScript API service with structured routing.',
                      icon: Code2,
                    },
                    {
                      id: 'python',
                      name: 'Python Environment',
                      tag: 'Fullstack / Script',
                      desc: 'Python workspace with virtualenv support and script execution.',
                      icon: FileCode,
                    },
                    {
                      id: 'blank',
                      name: 'Blank Canvas',
                      tag: 'Clean Slate',
                      desc: 'Empty workspace ready for autonomous agent scaffolding.',
                      icon: FolderPlus,
                    },
                  ].map((tpl) => {
                    const Icon = tpl.icon;
                    const isSelected = selectedTemplate === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => setSelectedTemplate(tpl.id as any)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 select-none ${
                          isSelected
                            ? 'bg-obsidian-surface2 border-obsidian-inkPrimary text-obsidian-inkPrimary shadow-xs ring-1 ring-obsidian-inkPrimary/30'
                            : 'bg-obsidian-surface1 border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 hover:border-obsidian-border'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-obsidian-inkPrimary' : 'text-obsidian-inkSecondary'}`} />
                            <span className="text-xs font-semibold text-obsidian-inkPrimary">{tpl.name}</span>
                          </div>
                          <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-obsidian-surface3 text-obsidian-inkMuted">
                            {tpl.tag}
                          </span>
                        </div>
                        <p className="text-[11px] text-obsidian-inkMuted leading-relaxed">
                          {tpl.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                disabled={isLoading}
                onClick={handleCreateNewProject}
                className="w-full h-10 rounded-xl bg-obsidian-inkPrimary text-obsidian-canvas font-semibold text-xs font-mono flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-sm cursor-pointer disabled:opacity-50 mt-1 active:scale-[0.99]"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span>{isLoading ? 'Creating Project...' : 'Create & Open Workspace'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-obsidian-hairline bg-obsidian-surface1 flex items-center justify-between text-xs font-mono">
          <span className="text-[11px] text-obsidian-inkMuted truncate max-w-[340px]">
            {currentWorkspacePath ? `Active: ${currentWorkspacePath}` : 'No workspace open'}
          </span>
          <button
            type="button"
            onClick={() => setFolderPickerOpen(false)}
            className="px-3 py-1 rounded-md bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-xs transition-colors cursor-pointer border border-obsidian-hairline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
