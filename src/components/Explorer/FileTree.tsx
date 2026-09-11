import React, { useEffect, useState } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FolderCode,
  FolderGit2,
  FolderArchive,
  FolderTree,
  FolderSync,
  FileCode, 
  FileText, 
  Image as ImageIcon, 
  RefreshCw, 
  FilePlus, 
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Search,
  Code2,
  FileJson,
  FileType,
  Trash2,
  Copy,
  Check,
  Database,
  Settings,
  GitBranch,
  Wind,
  Package,
  Layers,
  ShieldCheck,
  Braces,
  Zap,
  BookOpen,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  children?: FileNode[];
}

const getFileIcon = (file: FileNode, isExpanded: boolean) => {
  const name = file.name.toLowerCase();

  if (file.isDir) {
    if (name === '.git' || name === '.github') {
      return <FolderGit2 className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
    }
    if (name === 'src' || name === 'app' || name === 'pages' || name === 'components' || name === 'server') {
      return <FolderCode className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
    }
    if (name === 'public' || name === 'assets' || name === 'static') {
      return <FolderArchive className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
    }
    if (name === 'node_modules') {
      return <FolderTree className="w-3.5 h-3.5 text-obsidian-inkMuted opacity-70 shrink-0" />;
    }
    if (name === '.next' || name === '.sutra' || name === 'dist' || name === 'build') {
      return <FolderSync className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" />;
    }
    if (name === 'prisma' || name === 'db' || name === 'database') {
      return <Database className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
    }
    return isExpanded ? (
      <FolderOpen className="w-3.5 h-3.5 text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary transition-colors shrink-0" />
    ) : (
      <Folder className="w-3.5 h-3.5 text-obsidian-inkMuted group-hover:text-obsidian-inkSecondary transition-colors shrink-0" />
    );
  }

  // Specific file names
  if (name.startsWith('.env')) {
    return <Settings className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" />;
  }
  if (name === '.gitignore' || name === '.gitattributes') {
    return <GitBranch className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name === 'package.json' || name === 'package-lock.json') {
    return <Package className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.startsWith('tsconfig') || name === 'jsconfig.json') {
    return <FileJson className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.startsWith('tailwind.config')) {
    return <Wind className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.startsWith('eslint.config') || name.startsWith('.eslintrc') || name.startsWith('prettier')) {
    return <ShieldCheck className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.startsWith('next.config') || name.startsWith('vite.config')) {
    return <Zap className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
  }
  if (name.startsWith('postcss.config')) {
    return <Layers className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name === 'readme.md') {
    return <BookOpen className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
  }
  if (name.endsWith('.db') || name.endsWith('.sqlite') || name.endsWith('.sql')) {
    return <Database className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }

  // Extensions
  if (name.endsWith('.tsx') || name.endsWith('.jsx')) {
    return <Code2 className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
  }
  if (name.endsWith('.ts') || name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) {
    return <FileCode className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
  }
  if (name.endsWith('.json')) {
    return <Braces className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.toml')) {
    return <FileJson className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.endsWith('.png') || name.endsWith('.svg') || name.endsWith('.jpg') || name.endsWith('.ico') || name.endsWith('.webp')) {
    return <ImageIcon className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" />;
  }
  if (name.endsWith('.md') || name.endsWith('.mdx')) {
    return <FileText className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.endsWith('.txt') || name.endsWith('.log')) {
    return <FileText className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" />;
  }
  if (name.endsWith('.css') || name.endsWith('.scss') || name.endsWith('.less')) {
    return <FileType className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.endsWith('.py') || name.endsWith('.rs')) {
    return <FileCode className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
  }
  return <FileCode className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" />;
};

interface FileTreeNodeItemProps {
  node: FileNode;
  depth: number;
  expandedFolders: Record<string, boolean>;
  onToggleFolder: (path: string) => void;
  onFileClick: (node: FileNode) => void;
  onDelete: (e: React.MouseEvent, path: string) => void;
  copiedPath: string | null;
  onCopyPath: (path: string) => void;
  searchFilter: string;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
}

const FileTreeNodeItem: React.FC<FileTreeNodeItemProps> = React.memo(({
  node,
  depth,
  expandedFolders,
  onToggleFolder,
  onFileClick,
  onDelete,
  copiedPath,
  onCopyPath,
  searchFilter,
  onContextMenu,
}) => {
  const isExpanded = Boolean(expandedFolders[node.path]);
  const isMatch = !searchFilter.trim() || node.name.toLowerCase().includes(searchFilter.toLowerCase()) || node.path.toLowerCase().includes(searchFilter.toLowerCase());

  const hasMatchingDescendant = (n: FileNode): boolean => {
    if (!n.children) return false;
    return n.children.some((child) => 
      child.name.toLowerCase().includes(searchFilter.toLowerCase()) || 
      child.path.toLowerCase().includes(searchFilter.toLowerCase()) || 
      hasMatchingDescendant(child)
    );
  };

  if (searchFilter.trim() && !isMatch && !hasMatchingDescendant(node)) {
    return null;
  }

  return (
    <div>
      <div
        onClick={() => {
          if (node.isDir) {
            onToggleFolder(node.path);
          } else {
            onFileClick(node);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, node)}
        className="flex items-center justify-between px-2 py-1 cursor-pointer text-obsidian-inkPrimary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1 transition-colors group select-none rounded-sm"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {node.isDir ? (
            <span className="text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary transition-colors shrink-0">
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <div className="shrink-0">
            {getFileIcon(node, isExpanded)}
          </div>
          <span className="truncate text-[11px] font-mono">{node.name}</span>
        </div>

        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-opacity shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopyPath(node.path);
            }}
            title="Copy Path"
            className="p-0.5 hover:text-obsidian-inkPrimary cursor-pointer"
          >
            {copiedPath === node.path ? (
              <Check className="w-3 h-3 text-obsidian-inkSecondary" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={(e) => onDelete(e, node.path)}
            title="Delete"
            className="p-0.5 hover:text-red-400 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {node.isDir && (isExpanded || searchFilter.trim().length > 0) && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <FileTreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onFileClick={onFileClick}
              onDelete={onDelete}
              copiedPath={copiedPath}
              onCopyPath={onCopyPath}
              searchFilter={searchFilter}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export const FileTree: React.FC = () => {
  const { openFile, closeTab, setFolderPickerOpen, currentWorkspacePath } = useIDEStore();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    src: true,
    server: true,
    public: true,
    'src/components': true,
  });
  const [searchFilter, setSearchFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newPathName, setNewPathName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);

  const fetchTree = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/fs/tree');
      const data = await res.json();
      if (Array.isArray(data)) {
        setFiles(data);
      }
    } catch (e) {
      console.error('Failed to fetch tree:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fileTreeVersion = useIDEStore((s) => s.fileTreeVersion);

  useEffect(() => {
    fetchTree();
  }, [fileTreeVersion]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  const handleFileClick = async (file: FileNode) => {
    if (file.isDir) {
      toggleFolder(file.path);
      return;
    }

    try {
      const res = await fetch(`/api/fs/read?path=${encodeURIComponent(file.path)}`);
      const data = await res.json();
      openFile({
        path: file.path,
        name: file.name,
        content: data.content || '',
      });
    } catch (e) {
      console.error('Failed to read file:', e);
    }
  };

  const handleCreateNew = async (isFolder: boolean) => {
    if (!newPathName.trim()) return;
    const cleanPath = newPathName.trim();
    try {
      if (isFolder) {
        await fetch('/api/fs/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cleanPath }),
        });
      } else {
        const initialContent = '// Created in SUTRA IDE\n';
        await fetch('/api/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cleanPath, content: initialContent }),
        });
        const fileName = cleanPath.split(/[/\\]/).pop() || cleanPath;
        openFile({
          path: cleanPath,
          name: fileName,
          content: initialContent,
        });
      }
      setNewPathName('');
      setIsCreatingFile(false);
      setIsCreatingFolder(false);
      await fetchTree();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${filePath}"?`)) return;
    try {
      await fetch('/api/fs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      closeTab(filePath);
      fetchTree();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  return (
    <div 
      className="flex-1 flex flex-col h-full bg-obsidian-surface1 border-r border-obsidian-hairline select-none overflow-hidden font-sans relative"
      onClick={() => setContextMenu(null)}
    >
      {/* Header with Title & Action Icons */}
      <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-bold text-obsidian-inkPrimary uppercase tracking-widest font-mono">
            Explorer
          </span>
          {currentWorkspacePath && (
            <span className="text-[10px] font-mono text-obsidian-inkMuted truncate max-w-[100px]">
              {currentWorkspacePath.split(/[/\\]/).pop()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setFolderPickerOpen(true)}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Open Folder from Storage / Switch Workspace"
          >
            <FolderTree className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setIsCreatingFile(true);
              setIsCreatingFolder(false);
            }}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="New File"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setIsCreatingFolder(true);
              setIsCreatingFile(false);
            }}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="New Folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={fetchTree}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Refresh Files"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-2 border-b border-obsidian-hairline bg-obsidian-surface1">
        <div className="relative">
          <Search className="w-3 h-3 text-obsidian-inkMuted absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter files..."
            className="w-full bg-obsidian-surface2 border-none rounded px-6 py-1 text-[11px] text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:ring-1 focus:ring-obsidian-hairline font-mono"
          />
        </div>
      </div>

      {/* Create New File/Folder Input */}
      {(isCreatingFile || isCreatingFolder) && (
        <div className="p-2 border-b border-obsidian-hairline bg-obsidian-surface2 animate-in fade-in">
          <div className="text-[10px] font-mono text-obsidian-inkSecondary mb-1">
            {isCreatingFile ? 'Create New File' : 'Create New Folder'} (e.g. src/utils/helpers.ts)
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newPathName}
              onChange={(e) => setNewPathName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateNew(isCreatingFolder);
                if (e.key === 'Escape') {
                  setIsCreatingFile(false);
                  setIsCreatingFolder(false);
                  setNewPathName('');
                }
              }}
              placeholder={isCreatingFile ? 'path/to/file.ts' : 'path/to/folder'}
              autoFocus
              className="flex-1 bg-obsidian-surface3 border border-obsidian-border rounded px-2 py-1 text-xs text-obsidian-inkPrimary font-mono focus:outline-none focus:border-obsidian-hairline"
            />
            <button
              onClick={() => handleCreateNew(isCreatingFolder)}
              className="px-2 py-1 rounded bg-obsidian-inkPrimary text-obsidian-canvas font-mono text-xs font-semibold cursor-pointer"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Tree Node List */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5 font-mono text-xs">
        {files.map((node) => (
          <FileTreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onFileClick={handleFileClick}
            onDelete={handleDelete}
            copiedPath={copiedPath}
            onCopyPath={handleCopyPath}
            searchFilter={searchFilter}
            onContextMenu={handleContextMenu}
          />
        ))}

        {files.length === 0 && !isLoading && (
          <div className="p-6 text-center text-obsidian-inkMuted space-y-2">
            <p className="text-xs">No files in current workspace.</p>
            <button
              onClick={() => setFolderPickerOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-obsidian-border text-[11px] font-mono hover:bg-obsidian-surface1 text-obsidian-inkPrimary transition-colors cursor-pointer"
            >
              Open Workspace Folder
            </button>
          </div>
        )}
      </div>

      {/* Right Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-obsidian-surface2 border border-obsidian-border rounded-xl shadow-2xl p-1 w-48 font-mono text-xs animate-in fade-in"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {!contextMenu.node.isDir ? (
            <button
              onClick={() => {
                handleFileClick(contextMenu.node);
                setContextMenu(null);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <FileCode className="w-3.5 h-3.5 text-sky-400" />
              <span>Open File</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  setIsCreatingFile(true);
                  setNewPathName(`${contextMenu.node.path}/`);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <FilePlus className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
                <span>New File Here</span>
              </button>
              <button
                onClick={() => {
                  setIsCreatingFolder(true);
                  setNewPathName(`${contextMenu.node.path}/`);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
                <span>New Folder Here</span>
              </button>
            </>
          )}

          <div className="h-px bg-obsidian-surface3 my-1" />

          <button
            onClick={() => {
              handleCopyPath(contextMenu.node.path);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Path</span>
          </button>

          <button
            onClick={(e) => {
              handleDelete(e, contextMenu.node.path);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-danger transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
};
