import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileCode, Loader2, X } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

/**
 * Review overlay for the Manager conversation surface: side-by-side,
 * monospace before/after rendering of every file the active session changed
 * through write_file / edit_file / delete_file tool calls.
 *
 * Diff source priority per file:
 *  1. inline_diff snapshots captured into the store's reviewDiffs slice
 *  2. the tool call's recorded stagedDiff (oldContent/newContent)
 *  3. current workspace content fetched via GET /api/fs/read — shown against
 *     no original, surfaced with a "new file" badge
 *
 * Semantic colors are intentional: added lines emerald, removed lines rose.
 */

const FILE_TOOLS = ['write_file', 'edit_file', 'delete_file'];
const MAX_DIFF_CELLS = 1_000_000; // LCS table guard — beyond this, pair positionally
const MAX_RENDER_ROWS = 2000;

export interface ManagerDiffEntry {
  path: string;
  tool: string;
}

const basename = (path: string): string => path.split(/[/\\]/).pop() || path;

const splitLines = (content: string): string[] => {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

type DiffOpType = 'same' | 'add' | 'del';

interface DiffOp {
  type: DiffOpType;
  text: string;
  leftNum?: number;
  rightNum?: number;
}

interface DiffRow {
  left: { num: number | null; text: string; kind: 'same' | 'del' } | null;
  right: { num: number | null; text: string; kind: 'same' | 'add' } | null;
}

/** Classic LCS-backed op list; falls back to positional pairing past the size cap. */
export const buildDiffOps = (a: string[], b: string[]): DiffOp[] => {
  const n = a.length;
  const m = b.length;
  const ops: DiffOp[] = [];

  if (n * m > MAX_DIFF_CELLS) {
    const max = Math.max(n, m);
    for (let i = 0; i < max; i++) {
      if (i < n && i < m && a[i] === b[i]) {
        ops.push({ type: 'same', text: a[i], leftNum: i + 1, rightNum: i + 1 });
      } else {
        if (i < n) ops.push({ type: 'del', text: a[i], leftNum: i + 1 });
        if (i < m) ops.push({ type: 'add', text: b[i], rightNum: i + 1 });
      }
    }
    return ops;
  }

  // dp[i][j] = LCS length of a[i..], b[j..]
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i], leftNum: i + 1, rightNum: j + 1 });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ type: 'del', text: a[i], leftNum: i + 1 });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j], rightNum: j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i], leftNum: i + 1 });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j], rightNum: j + 1 });
    j++;
  }
  return ops;
};

/** Zips consecutive del/add runs into aligned side-by-side rows. */
export const buildDiffRows = (ops: DiffOp[]): DiffRow[] => {
  const rows: DiffRow[] = [];
  let dels: DiffOp[] = [];
  let adds: DiffOp[] = [];

  const flush = () => {
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      rows.push({
        left: { num: dels[k].leftNum ?? null, text: dels[k].text, kind: 'del' },
        right: { num: adds[k].rightNum ?? null, text: adds[k].text, kind: 'add' },
      });
    }
    for (let k = pairs; k < dels.length; k++) {
      rows.push({ left: { num: dels[k].leftNum ?? null, text: dels[k].text, kind: 'del' }, right: null });
    }
    for (let k = pairs; k < adds.length; k++) {
      rows.push({ left: null, right: { num: adds[k].rightNum ?? null, text: adds[k].text, kind: 'add' } });
    }
    dels = [];
    adds = [];
  };

  for (const op of ops) {
    if (op.type === 'del') dels.push(op);
    else if (op.type === 'add') adds.push(op);
    else {
      flush();
      rows.push({
        left: { num: op.leftNum ?? null, text: op.text, kind: 'same' },
        right: { num: op.rightNum ?? null, text: op.text, kind: 'same' },
      });
    }
  }
  flush();
  return rows;
};

interface ResolvedFile {
  status: 'loading' | 'ready' | 'deleted' | 'error';
  original: string[] | null;
  proposed: string[] | null;
  isNewFile: boolean;
}

const LOADING_FILE: ResolvedFile = { status: 'loading', original: null, proposed: null, isNewFile: false };

const resolveFile = async (entry: ManagerDiffEntry): Promise<ResolvedFile> => {
  const store = useIDEStore.getState();

  // 1. inline_diff snapshot captured during streaming
  const captured = store.reviewDiffs[entry.path];
  if (captured && (captured.proposedContent !== null || captured.originalContent !== null)) {
    return {
      status: 'ready',
      original: captured.originalContent !== null ? splitLines(captured.originalContent) : null,
      proposed: captured.proposedContent !== null ? splitLines(captured.proposedContent) : null,
      isNewFile: captured.originalContent === null,
    };
  }

  // 2. recorded stagedDiff on the tool call itself
  for (const message of [...store.agentMessages].reverse()) {
    for (const tc of [...(message.toolCalls || [])].reverse()) {
      if (!FILE_TOOLS.includes(tc.tool)) continue;
      if (tc.params?.path !== entry.path) continue;
      if (tc.stagedDiff && typeof tc.stagedDiff.oldContent === 'string') {
        return {
          status: 'ready',
          original: splitLines(tc.stagedDiff.oldContent),
          proposed:
            typeof tc.stagedDiff.newContent === 'string'
              ? splitLines(tc.stagedDiff.newContent)
              : null,
          isNewFile: false,
        };
      }
    }
  }

  // Deletions without a recorded original have nothing to preview
  if (entry.tool === 'delete_file') {
    return { status: 'deleted', original: null, proposed: null, isNewFile: false };
  }

  // 3. current workspace content — no original, so surface it as a new file
  try {
    const res = await fetch(`/api/fs/read?path=${encodeURIComponent(entry.path)}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return {
      status: 'ready',
      original: null,
      proposed: splitLines(typeof data.content === 'string' ? data.content : ''),
      isNewFile: true,
    };
  } catch {
    return { status: 'error', original: null, proposed: null, isNewFile: false };
  }
};

const DiffPaneCell: React.FC<{
  num: number | null;
  text: string;
  kind: 'same' | 'del' | 'add';
}> = ({ num, text, kind }) => (
  <div
    className={`flex min-w-0 px-2 py-px ${
      kind === 'add' ? 'bg-emerald-500/10 text-emerald-300' : kind === 'del' ? 'bg-rose-500/10 text-rose-300' : 'text-obsidian-inkSecondary'
    }`}
  >
    <span className="w-8 shrink-0 select-none pr-2 text-right text-obsidian-inkMuted opacity-60">{num ?? ''}</span>
    <span className="whitespace-pre-wrap break-all flex-1 min-w-0">{text || ' '}</span>
  </div>
);

export const ManagerDiffView: React.FC<{
  open: boolean;
  entries: ManagerDiffEntry[];
  onClose: () => void;
  onOpenInIde: (path: string) => void;
}> = ({ open, entries, onClose, onOpenInIde }) => {
  const [activePath, setActivePath] = useState<string | null>(entries[0]?.path ?? null);
  const [, forceRender] = useState(0);
  const cacheRef = useRef<Map<string, ResolvedFile>>(new Map());

  // Select the first changed file whenever the overlay opens
  useEffect(() => {
    if (open) setActivePath(entries[0]?.path ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Drop cached resolutions once closed so re-reviews pick up fresh content
  useEffect(() => {
    if (!open) cacheRef.current.clear();
  }, [open]);

  // Resolve every entry lazily (cached per open session)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    for (const entry of entries) {
      if (cacheRef.current.has(entry.path)) continue;
      cacheRef.current.set(entry.path, LOADING_FILE);
      resolveFile(entry)
        .then((resolved) => {
          if (cancelled) return;
          cacheRef.current.set(entry.path, resolved);
          forceRender((tick) => tick + 1);
        })
        .catch(() => {
          if (cancelled) return;
          cacheRef.current.set(entry.path, { status: 'error', original: null, proposed: null, isNewFile: false });
          forceRender((tick) => tick + 1);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open, entries]);

  // Escape closes the overlay
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const activeEntry = useMemo(
    () => entries.find((e) => e.path === activePath) ?? entries[0] ?? null,
    [entries, activePath]
  );

  const rows = useMemo<DiffRow[] | null>(() => {
    if (!activeEntry) return null;
    const resolved = cacheRef.current.get(activeEntry.path);
    if (!resolved || resolved.status !== 'ready') return null;
    const original = resolved.original ?? [];
    const proposed = resolved.proposed ?? [];
    const capped =
      original.length * proposed.length > MAX_DIFF_CELLS
        ? { a: original.slice(0, 1500), b: proposed.slice(0, 1500) }
        : { a: original, b: proposed };
    return buildDiffRows(buildDiffOps(capped.a, capped.b));
  }, [activeEntry, open]); // eslint-disable-line react-hooks/exhaustive-deps -- cache updates force renders

  if (!open || entries.length === 0) return null;

  const resolvedActive = activeEntry ? cacheRef.current.get(activeEntry.path) : undefined;
  const truncated = rows !== null && rows.length > MAX_RENDER_ROWS;
  const visibleRows = rows !== null ? rows.slice(0, MAX_RENDER_ROWS) : null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8" role="dialog" aria-label="Review changes">
      <div className="fixed inset-0" aria-hidden="true" onClick={onClose} />
      <div
        className="relative w-full max-w-5xl h-[82vh] rounded-xl border border-white/15 bg-obsidian-surface1 shadow-elevation flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 h-12 border-b border-obsidian-hairline shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode className="w-4 h-4 text-obsidian-inkMuted shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold text-obsidian-inkPrimary">Review changes</span>
            <span className="text-[10px] font-mono text-obsidian-inkMuted">
              {entries.length} file{entries.length === 1 ? '' : 's'} changed
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => activeEntry && onOpenInIde(activeEntry.path)}
              disabled={!activeEntry}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-mono uppercase tracking-wider text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Open the selected file in the IDE workspace"
            >
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
              <span>Open in IDE</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close review"
              title="Close (Esc)"
              className="p-1.5 rounded-md text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.07] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Per-file tab list */}
        {entries.length > 1 && (
          <div className="flex items-stretch gap-0.5 px-2 pt-1.5 border-b border-obsidian-hairline overflow-x-auto shrink-0" role="tablist" aria-label="Changed files">
            {entries.map((entry) => {
              const isActive = activeEntry?.path === entry.path;
              const entryResolved = cacheRef.current.get(entry.path);
              return (
                <button
                  key={entry.path}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActivePath(entry.path)}
                  title={entry.path}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-md text-[11px] font-mono whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                    isActive
                      ? 'bg-obsidian-surface2 text-obsidian-inkPrimary border border-b-0 border-white/15'
                      : 'text-obsidian-inkMuted hover:text-obsidian-inkSecondary hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="max-w-[180px] truncate">{basename(entry.path)}</span>
                  {entryResolved?.isNewFile && (
                    <span className="px-1 rounded bg-emerald-500/15 text-emerald-300 text-[9px] uppercase tracking-wider">new</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Side-by-side diff body */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-obsidian-canvas">
          {!activeEntry || !resolvedActive || resolvedActive.status === 'loading' ? (
            <div className="h-full flex items-center justify-center gap-2 text-[11px] font-mono text-obsidian-inkMuted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              <span>Loading diff...</span>
            </div>
          ) : resolvedActive.status === 'error' ? (
            <div className="h-full flex items-center justify-center text-[11px] font-mono text-obsidian-inkMuted">
              Could not load this file's contents.
            </div>
          ) : resolvedActive.status === 'deleted' ? (
            <div className="h-full flex flex-col items-center justify-center gap-1 text-center px-6">
              <span className="text-xs text-obsidian-inkPrimary">Deleted</span>
              <span className="text-[11px] font-mono text-obsidian-inkMuted break-all">{activeEntry.path}</span>
              <span className="text-[11px] text-obsidian-inkMuted">No original content was recorded for this deletion.</span>
            </div>
          ) : visibleRows !== null ? (
            <div className="py-2 font-mono text-[11px] leading-[1.55]" role="table" aria-label={`Diff for ${activeEntry.path}`}>
              {visibleRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-2 divide-x divide-obsidian-hairline">
                  {row.left ? (
                    <DiffPaneCell num={row.left.num} text={row.left.text} kind={row.left.kind} />
                  ) : (
                    <div className="bg-black/20 min-h-[1.55em]" aria-hidden="true" />
                  )}
                  {row.right ? (
                    <DiffPaneCell num={row.right.num} text={row.right.text} kind={row.right.kind} />
                  ) : (
                    <div className="bg-black/20 min-h-[1.55em]" aria-hidden="true" />
                  )}
                </div>
              ))}
              {truncated && (
                <div className="px-4 py-2 text-center text-[10px] font-mono text-obsidian-inkMuted">
                  Diff truncated — showing the first {MAX_RENDER_ROWS} rows.
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 h-9 border-t border-obsidian-hairline shrink-0">
          <span className="truncate text-[10px] font-mono text-obsidian-inkMuted" title={activeEntry?.path}>
            {activeEntry?.path}
          </span>
          <span className="shrink-0 text-[10px] font-mono text-obsidian-inkMuted">
            {resolvedActive?.isNewFile ? 'new file' : `${rows?.length ?? 0} rows`}
          </span>
        </div>
      </div>
    </div>
  );
};

/** Collects distinct paths with completed write/edit/delete calls, latest call wins. */
export const collectChangedFiles = (messages: { toolCalls?: unknown }[]): ManagerDiffEntry[] => {
  const byPath = new Map<string, ManagerDiffEntry>();
  const messagesAny = messages as Array<{ toolCalls?: Array<{ tool: string; params?: Record<string, any>; status?: string }> }>;
  for (const message of messagesAny) {
    for (const tc of Array.isArray(message.toolCalls) ? message.toolCalls : []) {
      if (!FILE_TOOLS.includes(tc.tool)) continue;
      if (tc.status !== 'completed') continue;
      const path = typeof tc.params?.path === 'string' ? tc.params.path : '';
      if (!path) continue;
      byPath.set(path, { path, tool: tc.tool });
    }
  }
  return [...byPath.values()];
};
