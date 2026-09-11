import React from 'react';
import { ShieldAlert, Check, X } from 'lucide-react';
import { ToolCallPayload } from '../../types/ide.js';

interface ApprovalCardProps {
  toolCall: ToolCallPayload;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ toolCall, onApprove, onReject }) => {
  return (
    <div className="p-3.5 rounded-lg bg-obsidian-surface3 border border-white/15 shadow-lg my-2 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded bg-white/[0.07] text-obsidian-inkPrimary flex items-center justify-center">
          <ShieldAlert className="w-3.5 h-3.5" />
        </div>
        <span className="font-bold text-obsidian-inkPrimary uppercase tracking-wider text-[11px]">Action Approval Required</span>
      </div>

      <p className="text-obsidian-inkSecondary mb-3 leading-relaxed">
        The agent wants to execute a potentially destructive operation:
      </p>

      <div className="p-2.5 rounded bg-obsidian-surface1 border border-white/5 font-mono text-[11px] mb-3 text-obsidian-inkPrimary">
        <div className="text-obsidian-inkPrimary font-bold mb-1">{toolCall.tool}</div>
        {toolCall.params.command && (
          <div className="text-obsidian-inkPrimary">&gt; {toolCall.params.command}</div>
        )}
        {toolCall.params.path && (
          <div className="text-obsidian-inkSecondary">File: {toolCall.params.path}</div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => onReject(toolCall.id)}
          className="px-3 py-1.5 rounded bg-obsidian-surface4 hover:bg-obsidian-surface4 text-obsidian-inkPrimary font-medium flex items-center gap-1 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Reject
        </button>
        <button
          onClick={() => onApprove(toolCall.id)}
          className="px-3 py-1.5 rounded bg-white hover:bg-obsidian-accentHover text-black font-medium flex items-center gap-1 transition-all active:scale-95"
        >
          <Check className="w-3.5 h-3.5" />
          Approve & Run
        </button>
      </div>
    </div>
  );
};
