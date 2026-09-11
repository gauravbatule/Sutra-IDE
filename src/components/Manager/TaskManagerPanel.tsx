import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, Pause, Play, Plus, Trash2, Zap } from 'lucide-react';

interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  schedule: 'once' | 'hourly' | 'daily' | 'weekly';
  runAt: string | null;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  lastResult: string | null;
}

const SCHEDULE_LABELS: Record<ScheduledTask['schedule'], string> = {
  once: 'One-time',
  hourly: 'Every hour',
  daily: 'Every day',
  weekly: 'Every week',
};

const fmtWhen = (ms: number | null): string => {
  if (!ms) return 'Never';
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const TaskManagerPanel: React.FC = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState<ScheduledTask['schedule']>('daily');
  const [runAt, setRunAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduler/tasks');
      const data = await res.json();
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setLoadError(null);
    } catch {
      setLoadError('Could not reach the scheduler.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTask = async () => {
    if (!prompt.trim()) {
      setFormError('Describe what Astra should do.');
      return;
    }
    setFormError(null);
    try {
      const res = await fetch('/api/scheduler/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || undefined,
          prompt: prompt.trim(),
          schedule,
          runAt: schedule === 'once' && runAt ? new Date(runAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFormError(data.error || 'Could not create the task.');
        return;
      }
      setTitle('');
      setPrompt('');
      setRunAt('');
      setIsCreating(false);
      refresh();
    } catch {
      setFormError('Could not reach the scheduler.');
    }
  };

  const mutate = async (id: string, action: 'toggle' | 'delete' | 'run') => {
    setBusyId(id);
    try {
      if (action === 'delete') {
        await fetch(`/api/scheduler/tasks/${id}`, { method: 'DELETE' });
      } else if (action === 'toggle') {
        const task = tasks.find((t) => t.id === id);
        await fetch(`/api/scheduler/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !(task?.enabled ?? true) }),
        });
      } else {
        await fetch(`/api/scheduler/tasks/${id}/run`, { method: 'POST' });
      }
      setTimeout(refresh, action === 'run' ? 1500 : 300);
    } catch {
      // Refresh will reflect reality
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="px-2 pt-1">
        <div className="rounded-lg bg-obsidian-surface2 border border-obsidian-hairline p-4 text-center text-[11px] font-mono text-obsidian-inkMuted">
          Loading tasks…
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 pt-1 space-y-2">
      {loadError && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
          {loadError}
        </div>
      )}

      {tasks.length === 0 && !isCreating && (
        <div
          className="rounded-lg bg-obsidian-surface2 border border-obsidian-hairline p-4 flex flex-col items-center gap-2 text-center"
          role="status"
        >
          <CalendarClock className="w-5 h-5 text-obsidian-inkMuted" aria-hidden="true" />
          <div className="text-xs font-medium text-obsidian-inkPrimary">No scheduled tasks yet</div>
          <p className="text-[11px] text-obsidian-inkMuted leading-relaxed max-w-[200px]">
            Astra can run a prompt for you every hour, day, or week — or once at a set time.
          </p>
        </div>
      )}

      {tasks.map((task) => (
        <div key={task.id} className="rounded-xl border border-obsidian-hairline bg-obsidian-surface2">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
              aria-expanded={expandedId === task.id}
              className="p-0.5 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
              aria-label={expandedId === task.id ? 'Collapse task' : 'Expand task'}
            >
              {expandedId === task.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-obsidian-inkPrimary truncate">{task.title}</div>
              <div className="text-[10px] font-mono text-obsidian-inkMuted">
                {SCHEDULE_LABELS[task.schedule]}
                {task.schedule === 'once' && task.runAt ? ` · ${new Date(task.runAt).toLocaleString()}` : ''}
                {' · '}
                last run {fmtWhen(task.lastRunAt)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => mutate(task.id, 'run')}
              disabled={busyId === task.id}
              title="Run now"
              aria-label="Run now"
              className="p-1.5 rounded-lg text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => mutate(task.id, 'toggle')}
              disabled={busyId === task.id}
              title={task.enabled ? 'Pause' : 'Resume'}
              aria-label={task.enabled ? 'Pause task' : 'Resume task'}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                task.enabled
                  ? 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.08]'
                  : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/[0.08]'
              }`}
            >
              {task.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => mutate(task.id, 'delete')}
              disabled={busyId === task.id}
              title="Delete"
              aria-label="Delete task"
              className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-red-400 hover:bg-red-950/30 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {!task.enabled && (
            <div className="px-2.5 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted">Paused</div>
          )}

          {expandedId === task.id && (
            <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-obsidian-hairline pt-2">
              <div className="text-[11px] text-obsidian-inkSecondary leading-relaxed whitespace-pre-wrap">{task.prompt}</div>
              {task.lastResult && (
                <div className="rounded-lg bg-obsidian-surface1 border border-obsidian-hairline p-2 text-[10px] font-mono text-obsidian-inkSecondary max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {task.lastResult}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {isCreating ? (
        <div className="rounded-xl border border-obsidian-hairline bg-obsidian-surface2 p-3 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task name (optional)"
            aria-label="Task name"
            className="w-full px-2.5 py-1.5 rounded-lg bg-transparent border border-white/10 focus:border-white/25 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none transition-colors"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={'What should Astra do? e.g. "Run the test suite and fix any failures"'}
            aria-label="Task prompt"
            rows={3}
            className="w-full px-2.5 py-1.5 rounded-lg bg-transparent border border-white/10 focus:border-white/25 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none transition-colors resize-none"
          />
          <div className="flex items-center gap-1.5">
            {(['once', 'hourly', 'daily', 'weekly'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSchedule(option)}
                className={`px-2 py-1 rounded-full text-[10px] font-mono transition-colors cursor-pointer ${
                  schedule === option
                    ? 'bg-white text-black font-semibold'
                    : 'bg-white/[0.05] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
                }`}
              >
                {SCHEDULE_LABELS[option]}
              </button>
            ))}
          </div>
          {schedule === 'once' && (
            <input
              type="datetime-local"
              value={runAt}
              onChange={(e) => setRunAt(e.target.value)}
              aria-label="Run at"
              className="w-full px-2.5 py-1.5 rounded-lg bg-transparent border border-white/10 focus:border-white/25 text-xs text-obsidian-inkPrimary focus:outline-none transition-colors [color-scheme:dark]"
            />
          )}
          {formError && <div className="text-[11px] text-red-400">{formError}</div>}
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setFormError(null);
              }}
              className="px-3 py-1.5 rounded-lg text-[11px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createTask}
              className="px-3 py-1.5 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas hover:bg-zinc-200 text-[11px] font-semibold transition-colors cursor-pointer"
            >
              Schedule task
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="w-full px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-xs font-medium transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Schedule a task</span>
        </button>
      )}
    </div>
  );
};
