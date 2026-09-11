import React, { useEffect, useState } from 'react';
import {
  FileCode,
  Terminal,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Clock,
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
  BookOpen
} from 'lucide-react';
import { ToolCallPayload } from '../../types/ide.js';
import { useIDEStore } from '../../stores/ideStore.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';

export const ToolCard: React.FC<{ toolCall: ToolCallPayload }> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const { openFilePath } = useIDEStore();

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
        className="h-8 flex items-center justify-between px-2.5 cursor-pointer hover:bg-obsidian-surface3 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {getToolIcon(toolCall.tool)}
          <span className="font-medium text-obsidian-inkPrimary">{toolCall.tool}</span>
          <span className="text-obsidian-inkMuted text-[10px] truncate max-w-[180px]">
            {toolCall.params.path || toolCall.params.command || toolCall.params.prompt || toolCall.params.filename || ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isFile && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                openFilePath(toolCall.params.path);
              }}
              className="px-1.5 py-0.5 rounded bg-obsidian-surface1 hover:bg-obsidian-surface4 text-[10px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline flex items-center gap-1 transition-colors"
              title="Open in Code Editor"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              <span>Open</span>
            </button>
          )}

          {mdPath && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(true);
              }}
              className="px-1.5 py-0.5 rounded bg-obsidian-surface1 hover:bg-obsidian-surface4 text-[10px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline flex items-center gap-1 transition-colors"
              title="Preview document"
            >
              <BookOpen className="w-2.5 h-2.5" />
              <span>Preview</span>
            </button>
          )}

          {toolCall.error || (toolCall.result && (toolCall.result.error || toolCall.result.failed)) || toolCall.status === 'failed' ? (
            <span className="px-1.5 py-0.5 rounded bg-red-950/40 border border-red-800/40 text-red-300 text-[10px] font-mono flex items-center gap-1">
              <AlertCircle className="w-2.5 h-2.5" />
              <span>Failed</span>
            </span>
          ) : toolCall.status === 'completed' || toolCall.result ? (
            <span className="px-1.5 py-0.5 rounded bg-white/[0.07] border border-white/15 text-obsidian-inkPrimary text-[10px] font-mono flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-2.5 h-2.5 text-obsidian-inkPrimary" />
              <span>Done</span>
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/10 text-obsidian-inkSecondary text-[10px] font-mono flex items-center gap-1">
              <Clock className="w-2.5 h-2.5 animate-spin text-obsidian-inkSecondary" />
              <span>Running</span>
            </span>
          )}
          {isExpanded ? <ChevronDown className="w-3 h-3 text-obsidian-inkMuted" /> : <ChevronRight className="w-3 h-3 text-obsidian-inkMuted" />}
        </div>
      </div>

      {/* Inline Rich Output Previews — only when expanded so the collapsed row keeps a fixed height */}
      {isExpanded && toolCall.result && (
        <div className="px-2.5 pb-2 pt-0.5 border-t border-obsidian-hairline/40">
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
            <span className="text-obsidian-inkSecondary">Parameters:</span>
            <pre className="mt-0.5 p-1.5 rounded bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkPrimary text-[10px]">
              {JSON.stringify(toolCall.params, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span className="text-obsidian-inkSecondary">Result:</span>
              <pre className="mt-0.5 p-1.5 rounded bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkPrimary text-[10px] max-h-36 overflow-y-auto">
                {JSON.stringify(toolCall.result, null, 2)}
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
