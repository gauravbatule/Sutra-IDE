import React from 'react';
import { ShieldAlert, Check, X } from 'lucide-react';

export const RemoteApprovals: React.FC<{ approvals: any[] }> = ({ approvals }) => {
  const handleApprove = async (id: string) => {
    await fetch('/api/swarm/approve-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolCallId: id }),
    });
  };

  const handleReject = async (id: string) => {
    await fetch('/api/swarm/reject-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolCallId: id }),
    });
  };

  if (approvals.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-obsidian-inkMuted">
        <div className="w-12 h-12 rounded-full bg-obsidian-surface3 border border-obsidian-hairline flex items-center justify-center mb-3 text-obsidian-inkPrimary">
          <Check className="w-6 h-6" />
        </div>
        <div className="text-sm font-bold text-obsidian-inkPrimary mb-1">No Pending Approvals</div>
        <p className="text-xs text-obsidian-inkMuted max-w-xs">
          Your desktop IDE is operating smoothly. Destructive actions requiring your confirmation will appear here in real-time.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div className="text-xs font-mono text-obsidian-inkMuted uppercase tracking-wider mb-2">
        {approvals.length} Action(s) Awaiting Decision
      </div>

      {approvals.map((appr) => (
        <div key={appr.id} className="p-4 rounded-xl bg-obsidian-surface3 border border-obsidian-border space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-obsidian-inkPrimary" />
            <span className="font-bold text-xs text-obsidian-inkPrimary">{appr.tool}</span>
          </div>

          <div className="p-3 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline font-mono text-[11px] text-obsidian-inkPrimary">
            {appr.params.command && <div className="text-obsidian-inkPrimary">&gt; {appr.params.command}</div>}
            {appr.params.path && <div>File: {appr.params.path}</div>}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => handleReject(appr.id)}
              className="py-3 rounded-lg bg-obsidian-surface4 text-obsidian-inkPrimary font-bold text-xs flex items-center justify-center gap-1 active:scale-95"
            >
              <X className="w-4 h-4" /> Reject
            </button>
            <button
              onClick={() => handleApprove(appr.id)}
              className="py-3 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas font-bold text-xs flex items-center justify-center gap-1 active:scale-95"
            >
              <Check className="w-4 h-4" /> Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
