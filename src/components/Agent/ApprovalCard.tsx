import React, { useState } from 'react';
import { ShieldAlert, Check, X, Terminal, FileCode, FilePlus, Trash2, GitCommit, Cpu } from 'lucide-react';
import { ToolCallPayload } from '../../types/ide.js';

interface ApprovalCardProps {
  toolCall: ToolCallPayload;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ toolCall, onApprove, onReject }) => {
  const [isProcessing, setIsProcessing] = useState(false);

  // Safely unpack params whether they arrive as an object or a JSON string
  let params: Record<string, any> = {};
  try {
    if (typeof toolCall.params === 'string') {
      params = JSON.parse(toolCall.params);
    } else if (toolCall.params && typeof toolCall.params === 'object') {
      params = toolCall.params;
    }
  } catch {
    params = {};
  }

  const handleAction = async (action: 'approve' | 'reject') => {
    setIsProcessing(true);
    try {
      if (action === 'approve') {
        await onApprove(toolCall.id);
      } else {
        await onReject(toolCall.id);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const getToolIcon = () => {
    switch (toolCall.tool) {
      case 'run_command':
      case 'run_managed_process':
        return <Terminal className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'write_file':
        return <FilePlus className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'edit_file':
        return <FileCode className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      case 'delete_file':
      case 'delete_artifact':
        return <Trash2 className="w-3.5 h-3.5 text-obsidian-inkSecondary" />;
      case 'git_commit':
      case 'git_branch':
      case 'git_checkout':
        return <GitCommit className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
      default:
        return <Cpu className="w-3.5 h-3.5 text-obsidian-inkPrimary" />;
    }
  };

  return (
    <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-border shadow-lg my-1.5 text-xs font-sans animate-in fade-in duration-150">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-obsidian-inkSecondary shrink-0" />
          <div className="font-semibold text-obsidian-inkPrimary text-[11px]">
            Action Approval Required
          </div>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-obsidian-surface2 border border-obsidian-border font-mono text-[10px] text-obsidian-inkSecondary">
          {getToolIcon()}
          <span>{toolCall.tool}</span>
        </div>
      </div>

      {/* Target Details Box */}
      <div className="p-2.5 rounded bg-obsidian-surface1 border border-obsidian-hairline font-mono text-[11px] mb-2.5 text-obsidian-inkPrimary space-y-1.5 overflow-hidden">
        {params.command && (
          <div className="space-y-0.5">
            <span className="text-[10px] text-obsidian-inkMuted uppercase tracking-wider">Command</span>
            <div className="p-1.5 rounded bg-obsidian-surface2 border border-obsidian-hairline text-obsidian-inkPrimary break-all select-text font-mono text-[11px]">
              $ {params.command}
            </div>
          </div>
        )}

        {params.path && (
          <div className="space-y-0.5">
            <span className="text-[10px] text-obsidian-inkMuted uppercase tracking-wider">Target File</span>
            <div className="text-obsidian-inkPrimary break-all select-text font-mono text-[11px]">
              {params.path}
            </div>
          </div>
        )}

        {params.replacement && (
          <div className="space-y-0.5">
            <span className="text-[10px] text-obsidian-inkMuted uppercase tracking-wider">Replacement</span>
            <pre className="p-2 rounded bg-obsidian-surface2 border border-obsidian-hairline text-obsidian-inkSecondary text-[10px] max-h-32 overflow-y-auto whitespace-pre-wrap font-mono select-text">
              {params.replacement.slice(0, 500)}{params.replacement.length > 500 ? '...' : ''}
            </pre>
          </div>
        )}

        {params.content && !params.replacement && (
          <div className="space-y-0.5">
            <span className="text-[10px] text-obsidian-inkMuted uppercase tracking-wider">Content</span>
            <pre className="p-2 rounded bg-obsidian-surface2 border border-obsidian-hairline text-obsidian-inkSecondary text-[10px] max-h-32 overflow-y-auto whitespace-pre-wrap font-mono select-text">
              {params.content.slice(0, 500)}{params.content.length > 500 ? '...' : ''}
            </pre>
          </div>
        )}
      </div>

      {/* Decision Buttons */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => handleAction('reject')}
          disabled={isProcessing}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
          <span>Deny</span>
        </button>
        <button
          type="button"
          onClick={() => handleAction('approve')}
          disabled={isProcessing}
          className="flex items-center gap-1 px-3.5 py-1.5 rounded-md bg-obsidian-accent hover:bg-obsidian-accentHover text-obsidian-inkInverse text-[11px] font-semibold transition-colors cursor-pointer shadow-sm disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Approve</span>
        </button>
      </div>
    </div>
  );
};
