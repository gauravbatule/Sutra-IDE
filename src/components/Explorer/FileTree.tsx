import React, { useEffect, useState } from 'react';
import { 
  Folder, 
  FolderOpen, 
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
  Check
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
  if (file.isDir) {
    return isExpanded ? (
      <FolderOpen className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
    ) : (
      <Folder className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
    );
  }
  if (file.name.endsWith('.tsx') || file.name.endsWith('.jsx')) {
    return <Code2 className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
  }
  if (file.name.endsWith('.ts') || file.name.endsWith('.js')) {
    return <FileCode className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
  }
  if (file.name.endsWith('.json')) {
    return <FileJson className="w-3.5 h-3.5 text-obsidian-inkSecondary" />;
  }
  if (file.name.endsWith('.png') || file.name.endsWith('.svg') || file.name.endsWith('.jpg') || file.name.endsWith('.ico') || file.name.endsWith('.webp')) {
    return <ImageIcon className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
  }
  if (file.name.endsWith('.md')) {
    return <FileText className="w-3.5 h-3.5 text-obsidian-inkSecondary" />;
  }
  if (file.name.endsWith('.css') || file.name.endsWith('.scss')) {
    return <FileType className="w-3.5 h-3.5 text-obsidian-inkSecondary" />;
  }
  return <FileCode className="w-3.5 h-3.5 text-obsidian-inkMuted" />;
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
}

const FileTreeNodeItem: React.FC<FileTreeNodeItemProps> = ({
  node,
  depth,
  expandedFolders,
  onToggleFolder,
  onFileClick,
  onDelete,
  copiedPath,
  onCopyPath,
  searchFilter,
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
        className="flex items-center justify-between px-2 py-1 cursor-pointer text-obsidian-inkPrimary hover:text-white hover:bg-white/[0.05] transition-colors group select-none rounded-sm"
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
          <div className="opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileTree: React.FC = () => {
  const { openFile } = useIDEStore();
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

  useEffect(() => {
    fetchTree();
  }, []);

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
        await fetch('/api/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cleanPath, content: '// Created in SUTRA IDE\n' }),
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

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1 border-r border-obsidian-hairline select-none overflow-hidden font-sans">
      {/* Explorer Header */}
      <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
        <span className="text-[10px] font-bold text-obsidian-inkPrimary uppercase tracking-widest font-mono">Explorer</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setIsCreatingFile(!isCreatingFile);
              setIsCreatingFolder(false);
            }}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="New File"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setIsCreatingFolder(!isCreatingFolder);
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
            title="Refresh File Tree"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-2 py-1.5 border-b border-obsidian-hairline bg-obsidian-surface1">
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

      {/* New File / Folder Input */}
      {(isCreatingFile || isCreatingFolder) && (
        <div className="p-2 border-b border-obsidian-hairline bg-obsidian-surface2">
          <div className="text-[10px] font-mono text-obsidian-inkMuted mb-1">
            {isCreatingFile ? 'Create New File:' : 'Create New Folder:'}
          </div>
          <input
            type="text"
            value={newPathName}
            onChange={(e) => setNewPathName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateNew(isCreatingFolder);
              if (e.key === 'Escape') {
                setIsCreatingFile(false);
                setIsCreatingFolder(false);
              }
            }}
            placeholder={isCreatingFile ? 'src/components/MyView.tsx' : 'src/components/widgets'}
            autoFocus
            className="w-full bg-obsidian-canvas border border-obsidian-hairline rounded p-1 text-xs text-obsidian-inkPrimary font-mono focus:outline-none"
          />
        </div>
      )}

      {/* Recursive File Tree View */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0 text-[11px] font-mono">
        {files.length === 0 ? (
          <div className="p-4 text-center text-obsidian-inkMuted text-xs font-mono">
            {isLoading ? 'Scanning workspace...' : 'Workspace is empty'}
          </div>
        ) : (
          files.map((rootNode) => (
            <FileTreeNodeItem
              key={rootNode.path}
              node={rootNode}
              depth={0}
              expandedFolders={expandedFolders}
              onToggleFolder={toggleFolder}
              onFileClick={handleFileClick}
              onDelete={handleDelete}
              copiedPath={copiedPath}
              onCopyPath={handleCopyPath}
              searchFilter={searchFilter}
            />
          ))
        )}
      </div>
    </div>
  );
};
