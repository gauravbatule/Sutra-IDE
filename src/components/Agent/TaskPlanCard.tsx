import React, { useState, useMemo } from 'react';
import { ListChecks, CheckCircle2, Clock, Circle, ChevronDown, ChevronRight } from 'lucide-react';
import { ToolCallPayload } from '../../types/ide.js';
import { useIDEStore } from '../../stores/ideStore.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

function stripEmojis(str: string): string {
  return str
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '')
    .trim();
}

export const TaskPlanCard: React.FC<{ toolCall: ToolCallPayload }> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const agentMessages = useIDEStore((s) => s.agentMessages);

  const allToolCalls = useMemo(
    () => agentMessages.flatMap((m) => (Array.isArray(m.toolCalls) ? m.toolCalls : [])),
    [agentMessages]
  );
  const completedFiles = useMemo(() => {
    return new Set(
      allToolCalls
        .filter((tc) => (tc.tool === 'write_file' || tc.tool === 'edit_file') && tc.params?.path)
        .map((tc) => String(tc.params.path).toLowerCase().replace(/\\/g, '/'))
    );
  }, [allToolCalls]);
  const completedCommands = useMemo(() => {
    return allToolCalls
      .filter((tc) => tc.tool === 'run_command' && (tc.status === 'completed' || tc.result))
      .map((tc) => String(tc.params?.command || '').toLowerCase());
  }, [allToolCalls]);

  const rawTodos = (
    Array.isArray(toolCall.params?.todos) ? toolCall.params.todos :
    Array.isArray(toolCall.result?.todos) ? toolCall.result.todos : []
  );
  const baseTodos: TodoItem[] = rawTodos
    .filter((t: any) => t && typeof t.content === 'string')
    .map((t: any) => ({
      status: t.status || 'pending',
      content: stripEmojis(t.content),
    }));

  const todos = useMemo(() => {
    return baseTodos.map((t) => {
      if (t.status === 'completed') return t;
      const lower = t.content.toLowerCase().replace(/\\/g, '/');
      for (const f of completedFiles) {
        const bname = f.split('/').pop();
        if (lower.includes(f) || (bname && bname.length > 3 && lower.includes(bname))) {
          return { ...t, status: 'completed' as const };
        }
      }
      if (lower.includes('test') || lower.includes('verify') || lower.includes('run')) {
        const hasMatchingRun = completedCommands.some(
          (cmd) => cmd.includes('test') || cmd.includes('jest') || cmd.includes('vitest') || cmd.includes('build') || cmd.includes('check')
        );
        if (hasMatchingRun) {
          return { ...t, status: 'completed' as const };
        }
      }
      return t;
    });
  }, [baseTodos, completedFiles, completedCommands]);

  if (todos.length === 0) return null;

  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
  const totalCount = todos.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="my-2 rounded-lg border border-obsidian-hairline bg-obsidian-surface2 overflow-hidden text-xs font-sans shadow-sm transition-all duration-200">
      {/* Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-2 bg-obsidian-surface3 hover:bg-obsidian-surface4 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ListChecks className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" aria-hidden="true" />
          <span className="font-medium text-obsidian-inkPrimary truncate text-[11px]">Task Execution Plan</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-obsidian-surface2 text-obsidian-inkSecondary border border-obsidian-border">
            {completedCount}/{totalCount} Done ({progressPct}%)
          </span>
          {inProgressCount > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-obsidian-inkPrimary bg-obsidian-surface2 border border-obsidian-border">
              <Clock className="w-2.5 h-2.5 animate-spin" />
              <span>In Progress</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Progress bar pill */}
          <div className="w-16 sm:w-20 h-1 bg-obsidian-canvas rounded-full overflow-hidden border border-obsidian-hairline">
            <div
              className="h-full bg-obsidian-inkPrimary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <button
            type="button"
            aria-label={isExpanded ? 'Collapse task plan' : 'Expand task plan'}
            className="p-1 text-obsidian-inkMuted hover:text-obsidian-inkPrimary rounded transition-colors"
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Todo Items Checklist */}
      {isExpanded && (
        <div className="p-2 space-y-1 border-t border-obsidian-hairline bg-obsidian-surface1/80">
          {todos.map((todo, idx) => {
            const isDone = todo.status === 'completed';
            const isInProgress = todo.status === 'in_progress';
            return (
              <div
                key={todo.content + idx}
                className={`flex items-start gap-2 px-2 py-1.5 rounded transition-colors ${
                  isInProgress
                    ? 'bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkPrimary'
                    : isDone
                    ? 'bg-transparent text-obsidian-inkMuted'
                    : 'bg-transparent text-obsidian-inkSecondary'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-obsidian-inkSecondary" aria-hidden="true" />
                  ) : isInProgress ? (
                    <Clock className="w-3.5 h-3.5 text-obsidian-inkPrimary animate-spin" aria-hidden="true" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-obsidian-inkMuted opacity-50" aria-hidden="true" />
                  )}
                </div>
                <span
                  className={`flex-1 text-[11px] leading-relaxed break-words ${
                    isDone ? 'line-through opacity-60 text-obsidian-inkMuted' : 'text-obsidian-inkPrimary'
                  }`}
                >
                  {todo.content}
                </span>
                <span className="shrink-0 text-[9px] font-mono uppercase tracking-wider opacity-50">
                  {isDone ? 'done' : isInProgress ? 'active' : 'pending'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
