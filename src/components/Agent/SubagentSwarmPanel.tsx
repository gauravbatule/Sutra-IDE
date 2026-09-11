import React from 'react';
import { 
  Cpu, 
  CheckCircle2, 
  Play,
  Bot,
  Sparkles
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const SubagentSwarmPanel: React.FC = () => {
  const { subagents } = useIDEStore();

  const activeCount = subagents.filter((s) => s.status === 'executing' || s.status === 'thinking').length;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none">
      {/* Header */}
      <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-obsidian-inkMuted" />
          <span className="text-[10px] font-bold text-obsidian-inkSecondary uppercase tracking-wider">Agents</span>
          {subagents.length > 0 && (
            <span className="text-[9px] font-mono text-obsidian-inkMuted bg-white/[0.04] px-1.5 py-0.5 rounded">
              {subagents.length}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <span className="text-[9px] font-mono text-obsidian-inkPrimary">
            {activeCount} active
          </span>
        )}
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {subagents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
            <Sparkles className="w-5 h-5 text-obsidian-inkMuted" />
            <div>
              <p className="text-[11px] text-obsidian-inkMuted leading-relaxed">
                No active agents.
              </p>
              <p className="text-[10px] text-obsidian-inkMuted mt-1 leading-relaxed">
                Astra will automatically spawn specialist agents when your task requires parallel work.
              </p>
            </div>
          </div>
        ) : (
          subagents.map((agent) => {
            const isBusy = agent.status === 'executing' || agent.status === 'thinking';
            return (
              <div
                key={agent.id}
                className={`p-2.5 rounded border transition-all ${
                  isBusy
                    ? 'bg-white/[0.03] border-white/[0.08]'
                    : 'bg-transparent border-white/[0.04] hover:border-white/[0.08]'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Bot className="w-3.5 h-3.5 text-obsidian-inkMuted" />
                    <span className="text-[11px] font-medium text-obsidian-inkPrimary">
                      {agent.name || agent.role}
                    </span>
                  </div>
                  <div>
                    {agent.status === 'completed' ? (
                      <span className="flex items-center gap-1 text-[9px] font-mono text-obsidian-inkSecondary">
                        <CheckCircle2 className="w-3 h-3" /> Done
                      </span>
                    ) : isBusy ? (
                      <span className="flex items-center gap-1 text-[9px] font-mono text-obsidian-inkPrimary">
                        <Play className="w-2.5 h-2.5 fill-current" /> Working
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono text-obsidian-inkMuted">Idle</span>
                    )}
                  </div>
                </div>

                <div className="text-[10px] text-obsidian-inkMuted leading-relaxed line-clamp-2">
                  {agent.currentTask}
                </div>

                {agent.lastMessage && (
                  <div className="mt-1.5 text-[9px] font-mono text-obsidian-inkMuted truncate">
                    &gt; {agent.lastMessage}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
