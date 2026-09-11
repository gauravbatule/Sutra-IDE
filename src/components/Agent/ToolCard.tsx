import React, { useEffect, useState } from 'react';
import {
  FileCode,
  Terminal,
  Image as ImageIcon,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Zap,
  ExternalLink,
  Volume2,
  Film,
  GitBranch,
  GitCommit,
  Database,
  ShieldCheck,
  Globe,
  Layers,
  Cpu,
  BookOpen,
  Loader2
} from 'lucide-react';
import { ToolCallPayload } from '../../types/ide.js';
import { useIDEStore } from '../../stores/ideStore.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { humanToolLabel } from '../Common/toolLabels.js';

import { TaskPlanCard } from './TaskPlanCard.js';
import { ArtifactCard } from './ArtifactCard.js';

const formatSafeParams = (tool: string, params: Record<string, any> = {}): Record<string, any> => {
  const safe: Record<string, any> = {};
  for (const [k, v] of Object.entries(params || {})) {
    if ((k === 'content' || k === 'replacement' || k === 'patch') && typeof v === 'string' && v.length > 100) {
      safe[k] = `[${v.length.toLocaleString()} characters written to disk]`;
    } else if (typeof v === 'string' && v.length > 250) {
      safe[k] = `${v.slice(0, 250)}… [${v.length.toLocaleString()} chars total]`;
    } else {
      safe[k] = v;
    }
  }
  return safe;
};

export const ToolCard: React.FC<{ toolCall: ToolCallPayload }> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  // Heartbeat for "Running" — counts seconds since the call first appeared
  // so a long-running tool never reads as a static "still running" badge.
  // Recomputed on the parent re-render; cheap, no extra timers.
  const [now, setNow] = useState(() => Date.now());
  const { openFilePath } = useIDEStore();

  useEffect(() => {
    if (toolCall.status === 'completed' || toolCall.error || toolCall.result) {
      return; // no heartbeat needed for finished calls
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [toolCall.status, toolCall.error, toolCall.result]);

  const runningForSec = toolCall.timestamp
    ? Math.max(0, Math.floor((now - toolCall.timestamp) / 1000))
    : 0;

  const isFile = (toolCall.tool === 'write_file' || toolCall.tool === 'edit_file') && toolCall.params.path;
  const mdPath =
    isFile && typeof toolCall.params.path === 'string' && /\.md$/i.test(toolCall.params.path)
      ? String(toolCall.params.path)
      : null;

  // Markdown files render as a document preview instead of raw code — content
  // comes from disk so the preview reflects what was actually written.
  useEffect(() => {
    if (!isExpanded || !mdPath || markdown !== null) return;
    let cancelled = false;
    fetch(`/api/fs/read?path=${encodeURIComponent(mdPath)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('read failed'))))
      .then((d) => {
        if (!cancelled) setMarkdown(String(d?.content ?? ''));
      })
      .catch(() => {
        if (!cancelled) setMarkdown('');
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, mdPath, markdown]);

  // ask_user renders as the ASTRA ASKS question card instead — the raw call
  // (with its params JSON) must never be visible to the user.
  if (toolCall.tool === 'ask_user') return null;

  // write_todos renders as the live interactive Task Execution Plan card
  if (toolCall.tool === 'write_todos' || toolCall.tool === 'todo_write') {
    return <TaskPlanCard toolCall={toolCall} />;
  }

  // create_artifact, create_implementation_plan, etc. render as the rich interactive Artifact Card
  if (
    toolCall.tool === 'create_artifact' ||
    toolCall.tool === 'create_implementation_plan' ||
    toolCall.tool === 'create_markdown_doc' ||
    toolCall.tool === 'create_findings_report' ||
    toolCall.tool === 'record_findings' ||
    toolCall.tool === 'create_audit_report'
  ) {
    return <ArtifactCard toolCall={toolCall} />;
  }

  const getToolIcon = (tool: string) => {
    switch (tool) {
      case 'read_file':
      case 'write_file':
      case 'edit_file':
      case 'delete_file':
      case 'format_code':
      case 'lint_code':
      case 'typecheck_project':
        return <FileCode className="w-3.5 h-3.5 text-obsidian-inkSecondary" />;
      case 'run_command':
      case 'run_background_process':
      case 'kill_process':
      case 'inspect_port':
        return <Terminal className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'generate_image_asset':
      case 'generate_svg_asset':
        return <ImageIcon className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'generate_video_asset':
        return <Film className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'generate_audio_asset':
        return <Volume2 className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'git_status':
      case 'git_diff':
      case 'git_branch':
      case 'git_checkout':
      case 'git_stash':
        return <GitBranch className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'git_commit':
      case 'git_log':
      case 'git_cherry_pick':
        return <GitCommit className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'inspect_sqlite_schema':
      case 'query_sqlite':
      case 'export_sqlite_data':
      case 'run_db_migration':
        return <Database className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'audit_accessibility_wcag':
      case 'audit_performance_vitals':
      case 'audit_security_dependencies':
      case 'validate_env_variables':
      case 'run_unit_tests':
      case 'generate_test_suite':
        return <ShieldCheck className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'search_web':
      case 'scrape_url':
      case 'fetch_json_api':
      case 'ping_host':
      case 'dns_lookup':
      case 'download_file':
      case 'bench_http_endpoint':
        return <Globe className="w-3.5 h-3.5 text-obsidian-inkSecondary" />;
      case 'scaffold_component':
      case 'generate_openapi_spec':
      case 'generate_dockerfile':
        return <Layers className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'spawn_subagent':
        return <Cpu className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      default:
        return <Zap className="w-3.5 h-3.5 text-obsidian-inkMuted" />;
    }
  };

  const assetUrl = toolCall.result?.url || (toolCall.result?.path ? `/assets/images/${toolCall.params.filename || ''}` : null);
  const isImage = toolCall.tool === 'generate_image_asset' || toolCall.tool === 'generate_svg_asset';
  const isVideo = toolCall.tool === 'generate_video_asset';
  const isAudio = toolCall.tool === 'generate_audio_asset';

  return (
    <div className="rounded border border-obsidian-hairline bg-obsidian-surface2 overflow-hidden text-xs my-1.5 font-mono">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        title={toolCall.tool}
        className="h-8 flex items-center justify-between px-2.5 cursor-pointer hover:bg-obsidian-surface3 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {getToolIcon(toolCall.tool)}
          <span className="font-medium font-sans text-obsidian-inkPrimary whitespace-nowrap text-[11px]">
            {humanToolLabel(toolCall.tool)}
          </span>
          {(toolCall.params.command || toolCall.params.path || toolCall.params.prompt || toolCall.params.filename) && (
            <span className="text-obsidian-inkSecondary font-mono text-[10px] bg-obsidian-surface1 px-1.5 py-0.5 rounded border border-obsidian-hairline truncate max-w-[260px] sm:max-w-[320px]">
              {toolCall.params.command || toolCall.params.path || toolCall.params.prompt || toolCall.params.filename}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isFile && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFilePath(toolCall.params.path);
              }}
              aria-label={`Open ${String(toolCall.params.path ?? 'file')} in code editor`}
              className="min-h-[24px] px-1.5 py-0.5 rounded bg-obsidian-surface1 hover:bg-obsidian-surface4 text-[10px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline flex items-center gap-1 transition-colors cursor-pointer"
              title="Open in Code Editor"
            >
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
              <span>Open</span>
            </button>
          )}

          {mdPath && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(true);
              }}
              aria-label="Preview document below"
              className="min-h-[24px] px-1.5 py-0.5 rounded bg-obsidian-surface1 hover:bg-obsidian-surface4 text-[10px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline flex items-center gap-1 transition-colors cursor-pointer"
              title="Preview document"
            >
              <BookOpen className="w-3 h-3" aria-hidden="true" />
              <span>Preview</span>
            </button>
          )}

          {toolCall.error || (toolCall.result && (toolCall.result.error || toolCall.result.failed)) || toolCall.status === 'failed' ? (
            <span
              role="status"
              aria-label="Status: failed"
              className="px-1.5 py-0.5 rounded bg-obsidian-surface2 border border-obsidian-danger/30 text-obsidian-danger text-[10px] font-mono flex items-center gap-1"
            >
              <AlertCircle className="w-3 h-3" aria-hidden="true" />
              <span>Failed</span>
            </span>
          ) : toolCall.status === 'completed' || toolCall.result ? (
            <span
              role="status"
              aria-label="Status: completed"
              className="px-1.5 py-0.5 rounded bg-obsidian-surface1 border border-obsidian-border text-obsidian-inkSecondary text-[10px] font-mono flex items-center gap-1"
            >
              <Check className="w-3 h-3 text-obsidian-inkSecondary" aria-hidden="true" />
              <span>Completed</span>
            </span>
          ) : (
            <span
              role="status"
              aria-label="Status: running"
              className="px-1.5 py-0.5 rounded bg-obsidian-surface1 border border-obsidian-border text-obsidian-inkSecondary text-[10px] font-mono flex items-center gap-1.5 overflow-hidden"
            >
              <Loader2 className="w-3 h-3 animate-spin text-obsidian-inkSecondary shrink-0" aria-hidden="true" />
              <span>Running{runningForSec > 0 ? ` · ${runningForSec}s` : ''}</span>
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `Collapse ${humanToolLabel(toolCall.tool)} details` : `Expand ${humanToolLabel(toolCall.tool)} details`}
            className="w-7 h-7 min-h-[28px] min-w-[28px] rounded flex items-center justify-center hover:bg-obsidian-surface3 transition-colors cursor-pointer shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-obsidian-inkMuted" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-obsidian-inkMuted" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Inline Rich Output Previews — only when expanded so the collapsed row keeps a fixed height */}
      {isExpanded && toolCall.result && (
        <div className="px-2.5 pb-2 pt-0.5 border-t border-obsidian-hairline">
          {isImage && assetUrl && (
            <div className="mt-1.5 rounded border border-obsidian-hairline overflow-hidden bg-obsidian-canvas max-h-48 flex items-center justify-center">
              <img src={assetUrl} alt={toolCall.params.prompt || 'Generated Asset'} className="max-h-48 object-contain" />
            </div>
          )}

          {isVideo && assetUrl && (
            <div className="mt-1.5 rounded border border-obsidian-hairline overflow-hidden bg-obsidian-canvas">
              <video 
                src={assetUrl} 
                controls 
                autoPlay 
                loop 
                muted 
                playsInline 
                className="w-full max-h-48 bg-black object-contain" 
              />
              {toolCall.result?.notice && (
                <div className="p-2 bg-obsidian-surface1 border-t border-obsidian-hairline text-[10px] text-obsidian-inkPrimary flex items-start gap-1.5">
                  <span>{toolCall.result.notice}</span>
                </div>
              )}
            </div>
          )}

          {isAudio && assetUrl && (
            <div className="mt-1.5 rounded border border-obsidian-hairline p-2 bg-obsidian-canvas">
              <audio src={assetUrl} controls className="w-full h-8" />
            </div>
          )}

          {mdPath && (
            <div className="mt-1.5 rounded border border-obsidian-hairline bg-obsidian-surface1 p-3 max-h-64 overflow-y-auto">
              <div className="text-[9px] uppercase tracking-wider font-mono text-obsidian-inkMuted mb-1.5">
                Document preview
              </div>
              {markdown === null ? (
                <div className="text-[10px] text-obsidian-inkMuted">Loading preview…</div>
              ) : markdown === '' ? (
                <div className="text-[10px] text-obsidian-inkMuted">Preview unavailable.</div>
              ) : (
                <MarkdownRenderer content={markdown} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Expanded Technical Inspection */}
      {isExpanded && (
        <div className="p-2.5 border-t border-obsidian-hairline bg-obsidian-canvas text-[10px] text-obsidian-inkMuted space-y-2 overflow-x-auto">
          <div>
            <span className="text-obsidian-inkSecondary font-semibold">Parameters:</span>
            <pre className="mt-0.5 p-1.5 rounded bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkPrimary text-[10px]">
              {JSON.stringify(formatSafeParams(toolCall.tool, toolCall.params), null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span className="text-obsidian-inkSecondary font-semibold">Result:</span>
              <pre className="mt-0.5 p-1.5 rounded bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkPrimary text-[10px] max-h-36 overflow-y-auto">
                {typeof toolCall.result === 'object' && toolCall.result !== null && toolCall.result.bytesWritten
                  ? `✓ File written successfully (${toolCall.result.bytesWritten.toLocaleString()} bytes to ${toolCall.result.path || toolCall.params.path})`
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div className="text-red-400">
              <span>Error:</span> {toolCall.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
