import React, { useState } from 'react';
import {
  FileCode,
  ListChecks,
  Palette,
  CheckCircle2,
  BookOpen,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { ToolCallPayload } from '../../types/ide.js';
import { useIDEStore } from '../../stores/ideStore.js';

interface ArtifactCardProps {
  toolCall: ToolCallPayload;
}

const TYPE_ICONS: Record<string, typeof FileCode> = {
  plan: ListChecks,
  findings: ShieldAlert,
  audit: ShieldAlert,
  implementation: FileCode,
  design: Palette,
  verification: CheckCircle2,
  doc: BookOpen,
};

export const ArtifactCard: React.FC<ArtifactCardProps> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { setActiveSidebar } = useIDEStore();

  const name = toolCall.params?.name || toolCall.result?.artifact?.name || 'Project Artifact';
  const type = toolCall.params?.type || toolCall.result?.artifact?.type || 'doc';
  const status = toolCall.params?.status || toolCall.result?.artifact?.status || 'done';
  const content = toolCall.params?.content || '';

  const Icon = TYPE_ICONS[type] || BookOpen;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!content) return;
    // Postel's law: accept either modern Clipboard API or the legacy
    // execCommand fallback so copy always works regardless of the host.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to copy artifact', err);
    }
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((v) => !v);
  };

  const handleOpenCenterModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    useIDEStore.getState().setActiveArtifactModal({
      id: toolCall.id || `art-${Date.now()}`,
      name,
      type: type as any,
      status: status as any,
      content,
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="my-2.5 rounded-xl bg-obsidian-surface2 border border-obsidian-border overflow-hidden shadow-lg select-none font-mono">
      {/* Header Banner */}
      <div
        onClick={handleOpenCenterModal}
        className="p-3 flex items-center justify-between cursor-pointer hover:bg-obsidian-surface3/60 transition-colors bg-obsidian-surface2"
        title="Click to open artifact in Center-Stage Viewer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary shrink-0">
            <Icon className="w-4 h-4" />
          </div>
          <div className="truncate min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-obsidian-inkPrimary truncate">{name}</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-mono bg-obsidian-surface2 text-obsidian-inkSecondary shrink-0">
                {type}
              </span>
            </div>
            <p className="text-[10px] text-obsidian-inkMuted truncate">
              Artifact generated · {status} · Click to open Center-Stage
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {content && (
            <button
              onClick={handleToggleExpand}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse artifact body' : 'Expand artifact body'}
              className="p-1.5 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
              title={isExpanded ? 'Collapse inline preview' : 'Expand inline preview'}
            >
              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Copy Markdown"
            aria-label="Copy artifact Markdown to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
          <button
            onClick={handleOpenCenterModal}
            className="p-1.5 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Open in Center-Stage Viewer"
            aria-label="Open artifact in Center-Stage Viewer"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Expandable Markdown Body */}
      {isExpanded && content && (
        <div className="p-4 border-t border-obsidian-hairline bg-obsidian-canvas text-xs font-sans max-h-96 overflow-y-auto leading-relaxed">
          <MarkdownRenderer content={content} />
        </div>
      )}
    </div>
  );
};
