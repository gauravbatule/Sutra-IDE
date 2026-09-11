import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Terminal, 
  FileCode, 
  Sparkles, 
  Play, 
  FolderPlus,
  Zap,
  GitBranch,
  Settings,
  Bot,
  X
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface PaletteItem {
  id: string;
  title: string;
  category: string;
  icon: any;
  action: () => void;
  filePath?: string;
}

export const CommandPalette: React.FC = () => {
  const {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    toggleTerminal,
    togglePreview,
    setPermissionLevel,
    permissionLevel,
    setActiveSidebar,
    toggleSidebar,
    toggleAgentPanel,
    setSettingsOpen,
    setVaultModalOpen,
    setAssetStudioOpen,
    setQRPairingOpen,
    setGuideOpen,
    openFilePath,
  } = useIDEStore();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);

  // Fetch workspace files for quick navigation (recursive)
  useEffect(() => {
    if (isCommandPaletteOpen) {
      fetch('/api/fs/tree')
        .then((r) => r.json())
        .then((data) => {
          const flattenNodes = (nodes: any[]): string[] => {
            const list: string[] = [];
            for (const node of nodes) {
              if (!node.isDir && node.path) {
                list.push(node.path);
              }
              if (node.children && Array.isArray(node.children)) {
                list.push(...flattenNodes(node.children));
              }
            }
            return list;
          };
          if (Array.isArray(data)) {
            setWorkspaceFiles(flattenNodes(data));
          }
        })
        .catch(() => setWorkspaceFiles([]));
    }
  }, [isCommandPaletteOpen]);

  const baseCommands: PaletteItem[] = [
    {
      id: 'cmd-guide',
      title: 'Help: Open User Guide, Architecture Tour & Cheatsheets',
      category: 'Help & Docs',
      icon: Sparkles,
      action: () => setGuideOpen(true),
    },
    {
      id: 'cmd-vault',
      title: 'Design Vault: Browse Curated UI Archetypes & Web Scraper',
      category: 'Design & UI',
      icon: Sparkles,
      action: () => setVaultModalOpen(true),
    },
    {
      id: 'cmd-media',
      title: 'Media Studio: Generate AI Images, Videos, UI Audio & SVGs',
      category: 'Media Studio',
      icon: Sparkles,
      action: () => setAssetStudioOpen(true),
    },
    {
      id: 'cmd-mobile-qr',
      title: 'Mobile: Show Smartphone Pairing QR Code over LAN Wi-Fi',
      category: 'Mobile Bridge',
      icon: Sparkles,
      action: () => setQRPairingOpen(true),
    },
    {
      id: 'cmd-search',
      title: 'Search: Search Code Across Entire Workspace',
      category: 'Search',
      icon: Search,
      action: () => setActiveSidebar('search'),
    },
    {
      id: 'cmd-git',
      title: 'Git: Source Control & Verified Diffs',
      category: 'Source Control',
      icon: GitBranch,
      action: () => setActiveSidebar('git'),
    },
    {
      id: 'cmd-swarm',
      title: 'Agents: Subagent Matrix & Parallel Execution',
      category: 'AI Agent',
      icon: Bot,
      action: () => setActiveSidebar('swarm'),
    },
    {
      id: 'cmd-toggle-terminal',
      title: 'Terminal: Toggle PowerShell ConPTY Terminal',
      category: 'Terminal',
      icon: Terminal,
      action: () => toggleTerminal(),
    },
    {
      id: 'cmd-toggle-preview',
      title: 'Preview: Toggle Multi-Device Live Viewport',
      category: 'Preview',
      icon: Play,
      action: () => togglePreview(),
    },
    {
      id: 'cmd-settings',
      title: 'Settings: Configure AI Providers & Environment Keys',
      category: 'Settings',
      icon: Settings,
      action: () => setSettingsOpen(true),
    },
    {
      id: 'cmd-toggle-workspace-panel',
      title: 'Layout: Toggle Left Sidebar Panel',
      category: 'Layout',
      icon: FolderPlus,
      action: () => toggleSidebar(),
    },
    {
      id: 'cmd-toggle-agent-panel',
      title: 'Layout: Toggle SUTRA Assistant Panel',
      category: 'Layout',
      icon: Sparkles,
      action: () => toggleAgentPanel(),
    },
    {
      id: 'cmd-toggle-permission-mode',
      title: `Permissions: Switch to ${permissionLevel === 'full' ? 'Strict' : 'Full Access'} Mode`,
      category: 'Security',
      icon: Zap,
      action: () => setPermissionLevel(permissionLevel === 'full' ? 'strict' : 'full'),
    },
  ];

  // Map workspace files to palette items
  const fileItems: PaletteItem[] = workspaceFiles.map((filePath) => ({
    id: `file-${filePath}`,
    title: filePath,
    category: 'File',
    icon: FileCode,
    filePath,
    action: () => openFilePath(filePath),
  }));

  const allItems = [...fileItems, ...baseCommands];

  const filtered = query.trim()
    ? allItems.filter(
        (c) =>
          c.title.toLowerCase().includes(query.toLowerCase()) ||
          c.category.toLowerCase().includes(query.toLowerCase())
      )
    : [...baseCommands, ...fileItems.slice(0, 20)];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      }
      if (e.key === 'Escape' && isCommandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) setCommandPaletteOpen(false);
      }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-20 p-4 sm:p-6 anim-fade-in select-none"
    >
      <div className="w-full max-w-xl bg-obsidian-surface1 border border-obsidian-border rounded-xl overflow-hidden shadow-2xl flex flex-col anim-appear">
        {/* Search Input */}
        <div className="p-3 border-b border-obsidian-hairline flex items-center gap-2.5">
          <Search className="w-4 h-4 text-obsidian-inkSecondary shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((index) => Math.max(index - 1, 0));
              }
              if (e.key === 'Enter' && filtered[selectedIndex]) {
                e.preventDefault();
                filtered[selectedIndex].action();
                setCommandPaletteOpen(false);
              }
            }}
            placeholder="Type a file name or command (e.g. 'App.tsx', 'git', 'terminal')..."
            autoFocus
            className="flex-1 bg-transparent text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none font-mono"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-mono text-obsidian-inkMuted bg-obsidian-surface2 px-1.5 py-0.5 rounded border border-obsidian-hairline select-none">
              ESC
            </span>
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border border-transparent hover:border-obsidian-hairline transition-all active:scale-95 cursor-pointer"
              title="Close Command Palette (Esc)"
              aria-label="Close Command Palette"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Items List */}
        <div className="max-h-80 overflow-y-auto p-1.5 space-y-0.5 text-xs font-mono">
          {filtered.map((item, idx) => {
            const Icon = item.icon;
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  item.action();
                  setCommandPaletteOpen(false);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold shadow-xs'
                    : 'text-obsidian-inkSecondary hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-obsidian-canvas' : 'text-obsidian-inkMuted'}`} />
                  <span className="truncate">{item.title}</span>
                </div>
                <span
                  className={`text-[9px] font-mono shrink-0 ml-2 px-1.5 py-0.5 rounded ${
                    isSelected ? 'bg-[color:var(--overlay-muted)] text-obsidian-inkPrimary font-medium' : 'bg-obsidian-surface2 text-obsidian-inkMuted border border-obsidian-hairline'
                  }`}
                >
                  {item.category}
                </span>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-6 text-obsidian-inkMuted text-xs font-mono">
              No matching files or commands found for "{query}".
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
