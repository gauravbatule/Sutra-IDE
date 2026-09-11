import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  RefreshCw,
  FileEdit,
  FilePlus,
  Trash2,
  Check,
  Loader2,
  X
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitStatusData {
  branch: string;
  status: string;
  hasChanges: boolean;
  files: GitFile[];
  /** True when the workspace root is a git repository. Older servers omit it; infer then. */
  isRepo?: boolean;
}

export const GitPanel: React.FC = () => {
  const { openFilePath } = useIDEStore();
  const [statusData, setStatusData] = useState<GitStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedFileDiff, setSelectedFileDiff] = useState<{ path: string; diff: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<string | null>(null);
  const [isCommitError, setIsCommitError] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/git/status');
      const data = await res.json();
      setStatusData(data);
    } catch {
      setStatusData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleInitRepository = async () => {
    setIsInitializing(true);
    try {
      const res = await fetch('/api/git/init', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Initialization failed (${res.status})`);
      }
    } catch (err: any) {
      setCommitResult(`Could not initialize repository: ${err?.message || 'unknown error'}`);
      setIsCommitError(true);
    } finally {
      setIsInitializing(false);
      fetchStatus();
    }
  };

  const fetchDiff = async (filePath: string) => {
    setDiffLoading(true);
    try {
      const res = await fetch(`/api/git/diff?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      setSelectedFileDiff({ path: filePath, diff: data.diff || 'No diff available' });
    } catch {
      setSelectedFileDiff({ path: filePath, diff: 'Failed to fetch diff' });
    } finally {
      setDiffLoading(false);
    }
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;

    setIsCommitting(true);
    setCommitResult(null);
    setIsCommitError(false);
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setCommitMessage('');
        setCommitResult('Committed successfully');
        setSelectedFileDiff(null);
        fetchStatus();
        setTimeout(() => setCommitResult(null), 3000);
      } else {
        // Surface commit failures inline — never clear the user's message on error
        setCommitResult(`Error: ${data.error || 'Commit failed'}`);
        setIsCommitError(true);
      }
    } catch (err: any) {
      setCommitResult(`Error: ${err.message}`);
      setIsCommitError(true);
    } finally {
      setIsCommitting(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // Older servers omit isRepo — fall back to the legacy sentinel-free heuristic.
  const isRepo = statusData
    ? typeof statusData.isRepo === 'boolean'
      ? statusData.isRepo
      : !/not a git repository/i.test(statusData.status || '')
    : true;

  const files = statusData?.files || [];
  const stagedCount = files.filter((f) => f.staged).length;
  const unstagedCount = files.length - stagedCount;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'added':
      case 'untracked':
        return <FilePlus className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
      case 'deleted':
        return <Trash2 className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" />;
      default:
        return <FileEdit className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'added':
        return <span className="text-[9px] font-mono text-obsidian-inkPrimary bg-obsidian-surface2 border border-obsidian-hairline px-1.5 py-0.2 rounded-full">A</span>;
      case 'untracked':
        return <span className="text-[9px] font-mono text-obsidian-inkPrimary bg-obsidian-surface2 border border-obsidian-hairline px-1.5 py-0.2 rounded-full">U</span>;
      case 'deleted':
        return <span className="text-[9px] font-mono text-obsidian-inkMuted bg-obsidian-surface2 border border-obsidian-hairline px-1.5 py-0.2 rounded-full">D</span>;
      default:
        return <span className="text-[9px] font-mono text-obsidian-inkSecondary bg-obsidian-surface2 border border-obsidian-hairline px-1.5 py-0.2 rounded-full">M</span>;
    }
  };

  // Not a repository: friendly empty state with a one-click init path.
  if (!isRepo) {
    return (
      <div className="flex-1 flex flex-col h-full bg-obsidian-surface1 select-none overflow-hidden text-xs">
        <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-3.5 h-3.5 text-obsidian-accent shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkPrimary truncate">
              Source Control
            </span>
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1 rounded-lg hover:bg-white/[0.06] text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors"
            title="Refresh Git Status"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3">
          <div className="w-12 h-12 rounded-full bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center">
            <GitBranch className="w-5 h-5 text-obsidian-inkSecondary" />
          </div>
          <p className="text-xs font-medium text-obsidian-inkPrimary max-w-[220px]">
            This workspace isn&apos;t a git repository yet
          </p>
          <p className="text-[10px] text-obsidian-inkMuted max-w-[230px] leading-relaxed">
            Version control tracks every change Astra makes, so you can review history and roll back instantly.
          </p>
          <button
            onClick={handleInitRepository}
            disabled={isInitializing}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-obsidian-inkPrimary hover:bg-obsidian-accentHover disabled:opacity-40 disabled:pointer-events-none text-obsidian-canvas text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            {isInitializing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Initializing...</span>
              </>
            ) : (
              <>
                <GitBranch className="w-3.5 h-3.5" />
                <span>Initialize Repository</span>
              </>
            )}
          </button>
          {commitResult && (
            <p className={`text-[10px] font-mono max-w-[240px] break-words ${isCommitError ? 'text-red-400' : 'text-obsidian-accent'}`}>
              {commitResult}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1 select-none overflow-hidden text-xs">
      {/* Header */}
      <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-3.5 h-3.5 text-obsidian-accent shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkPrimary truncate">
            Source Control
          </span>
        </div>
        <div className="flex items-center gap-1">
          {statusData?.branch && (
            <span className="text-[10px] font-mono text-obsidian-inkSecondary bg-white/[0.04] px-2 py-0.5 rounded-full flex items-center gap-1">
              <GitBranch className="w-2.5 h-2.5" />
              {statusData.branch}
            </span>
          )}
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1 rounded-lg hover:bg-white/[0.06] text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors"
            title="Refresh Git Status"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Commit Box */}
      {statusData?.hasChanges && (
        <form onSubmit={handleCommit} className="p-3 border-b border-obsidian-hairline bg-obsidian-surface2/30 space-y-2">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Message (Ctrl+Enter to commit)"
            rows={2}
            className="w-full p-2 bg-obsidian-surface1 border border-obsidian-hairline rounded-lg text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent focus:ring-1 focus:ring-obsidian-accent/30 font-sans resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleCommit(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={isCommitting || !commitMessage.trim()}
            className="w-full py-1.5 bg-obsidian-inkPrimary hover:bg-obsidian-accentHover disabled:opacity-40 disabled:pointer-events-none text-obsidian-canvas text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {isCommitting ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Committing...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Commit Staged Changes</span>
              </>
            )}
          </button>
          {commitResult && (
            <p className={`text-[10px] font-mono text-center break-words ${isCommitError ? 'text-red-400' : 'text-obsidian-accent'}`}>
              {commitResult}
            </p>
          )}
        </form>
      )}

      {/* Changed Files List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono">
        <div className="px-2 py-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-obsidian-inkMuted">
          <span>Changes ({files.length})</span>
          {(stagedCount > 0 || unstagedCount > 0) && (
            <span className="font-mono normal-case tracking-normal">
              {stagedCount} staged · {unstagedCount} unstaged
            </span>
          )}
        </div>

        {files.length === 0 && (
          <div className="p-8 text-center text-obsidian-inkMuted space-y-2">
            <Check className="w-6 h-6 mx-auto text-obsidian-inkMuted" />
            <p className="text-xs font-sans text-obsidian-inkSecondary">Working tree is clean</p>
            <p className="text-[10px] text-obsidian-inkMuted font-sans">No modified or uncommitted files</p>
          </div>
        )}

        {files.map((file) => (
          <div
            key={file.path}
            className={`rounded-lg group transition-colors ${
              selectedFileDiff?.path === file.path ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
            }`}
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <button
                onClick={() => {
                  fetchDiff(file.path);
                  openFilePath(file.path);
                }}
                className="flex items-center gap-2 min-w-0 text-left flex-1"
              >
                {getStatusIcon(file.status)}
                <span className="text-[11px] text-obsidian-inkPrimary truncate">{file.path}</span>
              </button>
              {getStatusBadge(file.status)}
            </div>
          </div>
        ))}
      </div>

      {/* File Diff Drawer if selected */}
      {selectedFileDiff && (
        <div className="h-44 border-t border-obsidian-hairline bg-black/40 flex flex-col font-mono text-[10px] overflow-hidden">
          <div className="px-3 py-1.5 bg-obsidian-surface2 flex items-center justify-between border-b border-obsidian-hairline">
            <span className="text-obsidian-inkPrimary truncate max-w-[200px]">
              Diff: {selectedFileDiff.path}
            </span>
            <button
              onClick={() => setSelectedFileDiff(null)}
              className="p-0.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 leading-relaxed select-text font-mono">
            {diffLoading ? (
              <div className="flex items-center justify-center h-full text-obsidian-inkMuted">
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Loading diff...
              </div>
            ) : (
              <pre className="text-obsidian-inkPrimary whitespace-pre-wrap font-mono">
                {selectedFileDiff.diff.split('\n').map((line, i) => {
                  let color = 'text-obsidian-inkSecondary';
                  if (line.startsWith('+') && !line.startsWith('+++')) color = 'text-emerald-400 bg-emerald-500/10';
                  else if (line.startsWith('-') && !line.startsWith('---')) color = 'text-rose-400 bg-rose-500/10';
                  else if (line.startsWith('@@')) color = 'text-cyan-400';
                  return (
                    <div key={i} className={`px-1 rounded-sm ${color}`}>
                      {line || ' '}
                    </div>
                  );
                })}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
