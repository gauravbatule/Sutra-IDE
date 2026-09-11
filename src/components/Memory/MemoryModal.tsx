import React, { useEffect, useState } from 'react';
import {
  Brain,
  X,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Clock,
  Layers,
  Target,
  Workflow,
  ListTodo,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

type MemoryTab =
  | 'working'
  | 'semantic'
  | 'episodic'
  | 'procedural'
  | 'retrieval'
  | 'parametric'
  | 'prospective';

interface MemoryData {
  types?: {
    type1_working?: any;
    type2_semantic?: any[];
    type3_episodic?: any[];
    type4_procedural?: any[];
    type5_retrieval?: any;
    type6_parametric?: any;
    type7_prospective?: any[];
  };
  counts?: {
    memories?: number;
    semanticFacts?: number;
    prospectiveTasks?: number;
  };
}

export const MemoryModal: React.FC = () => {
  const isMemoryModalOpen = useIDEStore((s) => s.isMemoryModalOpen);
  const setMemoryModalOpen = useIDEStore((s) => s.setMemoryModalOpen);
  const [activeTab, setActiveTab] = useState<MemoryTab>('working');
  const [data, setData] = useState<MemoryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchMemories = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/memory/7-types');
      if (!res.ok) throw new Error(`Failed to load memories (${res.status})`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Error fetching cognitive memory');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isMemoryModalOpen) {
      void fetchMemories();
    }
  }, [isMemoryModalOpen]);

  if (!isMemoryModalOpen) return null;

  const tabs: Array<{ id: MemoryTab; label: string; count?: number; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'working', label: '1. Working', icon: Target },
    { id: 'semantic', label: '2. Semantic Facts', count: data?.types?.type2_semantic?.length, icon: Brain },
    { id: 'episodic', label: '3. Episodic Trajectories', count: data?.types?.type3_episodic?.length, icon: Clock },
    { id: 'procedural', label: '4. Procedural SOPs', count: data?.types?.type4_procedural?.length, icon: Workflow },
    { id: 'retrieval', label: '5. Retrieval Index', icon: Layers },
    { id: 'parametric', label: '6. Parametric Bounds', icon: Cpu },
    { id: 'prospective', label: '7. Prospective Tasks', count: data?.types?.type7_prospective?.length, icon: ListTodo },
  ];

  const safeIncludes = (item: any, q: string) => {
    if (!q) return true;
    try {
      return JSON.stringify(item).toLowerCase().includes(q.toLowerCase());
    } catch {
      return String(item?.content || item?.fact || item?.task || item?.name || '').toLowerCase().includes(q.toLowerCase());
    }
  };

  const working = data?.types?.type1_working;
  const semantic = (data?.types?.type2_semantic || []).filter((item) => safeIncludes(item, searchQuery));
  const episodic = (data?.types?.type3_episodic || []).filter((item) => safeIncludes(item, searchQuery));
  const procedural = (data?.types?.type4_procedural || []).filter((item) => safeIncludes(item, searchQuery));
  const parametric = data?.types?.type6_parametric;
  const prospective = (data?.types?.type7_prospective || []).filter((item) => safeIncludes(item, searchQuery));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 font-sans"
    >
      <div className="w-full max-w-4xl h-[85vh] max-h-[780px] bg-obsidian-surface1 border border-obsidian-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-12 px-4 border-b border-obsidian-hairline flex items-center justify-between shrink-0 bg-obsidian-surface1">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkPrimary">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h2 id="memory-modal-title" className="text-xs font-semibold uppercase tracking-wider text-obsidian-inkPrimary font-mono">
                Cognitive Agent Memory Vault
              </h2>
              <p className="text-[10px] text-obsidian-inkMuted leading-tight">
                7 foundational memory subsystems powering autonomous reasoning & persistent continuity
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchMemories}
              disabled={isLoading}
              title="Refresh memories from SQLite"
              aria-label="Refresh memories"
              className="flex items-center gap-1 h-7 px-2.5 rounded-md bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline text-[10px] font-mono cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => setMemoryModalOpen(false)}
              aria-label="Close memory modal"
              className="w-7 h-7 rounded-md flex items-center justify-center text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-Header / Search & Tabs */}
        <div className="border-b border-obsidian-hairline bg-obsidian-surface1/60 px-3 pt-2.5 shrink-0 space-y-2">
          {/* Search bar */}
          <div className="relative w-full max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-obsidian-inkMuted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search active memory entries..."
              className="w-full h-7 pl-8 pr-3 text-[11px] font-mono bg-obsidian-surface2 border border-obsidian-hairline rounded-md text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-border transition-colors"
            />
          </div>

          {/* Tab strip */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono whitespace-nowrap transition-colors cursor-pointer border ${
                    isActive
                      ? 'bg-obsidian-inkPrimary text-obsidian-canvas border-obsidian-inkPrimary font-semibold shadow-xs'
                      : 'bg-obsidian-surface2 text-obsidian-inkSecondary border-obsidian-hairline hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {typeof tab.count === 'number' && (
                    <span
                      className={`text-[9px] px-1 py-0.2 rounded-full font-bold ${
                        isActive ? 'bg-obsidian-canvas/20 text-obsidian-canvas' : 'bg-obsidian-surface4 text-obsidian-inkMuted'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-xs font-mono flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: WORKING MEMORY */}
          {activeTab === 'working' && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted font-semibold">
                  Active Goal
                </span>
                <p className="text-xs text-obsidian-inkPrimary font-mono">
                  {working?.activeGoal || 'No active goal in current scratchpad — start a conversation to bind goals.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted font-semibold">
                    Subgoals
                  </span>
                  {Array.isArray(working?.subgoals) && working.subgoals.length > 0 ? (
                    <div className="space-y-1">
                      {working.subgoals.map((sg: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-1.5 text-xs text-obsidian-inkSecondary font-mono">
                          <CheckCircle2 className={`w-3.5 h-3.5 ${sg.status === 'completed' ? 'text-emerald-400' : 'text-obsidian-inkMuted'}`} />
                          <span className={sg.status === 'completed' ? 'line-through opacity-70' : ''}>{sg.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-obsidian-inkMuted italic">No active subgoals.</p>
                  )}
                </div>

                <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted font-semibold">
                    Active Invariants
                  </span>
                  {Array.isArray(working?.activeInvariants) && working.activeInvariants.length > 0 ? (
                    <ul className="list-disc pl-4 space-y-0.5 text-xs text-obsidian-inkSecondary font-mono">
                      {working.activeInvariants.map((inv: string, idx: number) => (
                        <li key={idx}>{inv}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-obsidian-inkMuted italic">Invariants locked to zero-stubbing & type safety.</p>
                  )}
                </div>
              </div>

              {working?.scratchpad && (
                <div className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted font-semibold">
                    Working Scratchpad
                  </span>
                  <pre className="text-[11px] font-mono text-obsidian-inkSecondary whitespace-pre-wrap">
                    {working.scratchpad}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SEMANTIC MEMORY */}
          {activeTab === 'semantic' && (
            <div className="space-y-2">
              {semantic.length === 0 ? (
                <div className="p-8 text-center text-obsidian-inkMuted text-xs font-mono">
                  No semantic facts recorded yet. As Astra answers and learns preferences, verified facts appear here.
                </div>
              ) : (
                semantic.map((fact: any) => (
                  <div
                    key={fact.id}
                    className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex items-start justify-between gap-3 text-xs font-mono"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-obsidian-surface3 text-obsidian-inkPrimary text-[10px] uppercase font-bold">
                          {fact.entity}
                        </span>
                        <span className="text-obsidian-inkSecondary font-semibold">{fact.attribute}</span>
                        <span className="text-[10px] text-obsidian-inkMuted">
                          (Confidence: {Math.round(fact.confidence * 100)}%)
                        </span>
                      </div>
                      <div className="text-obsidian-inkPrimary font-mono break-all">{fact.value}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: EPISODIC MEMORY */}
          {activeTab === 'episodic' && (
            <div className="space-y-2">
              {episodic.length === 0 ? (
                <div className="p-8 text-center text-obsidian-inkMuted text-xs font-mono">
                  No past episodes recorded yet. Complete any task turn to record its trajectory and outcome.
                </div>
              ) : (
                episodic.map((ep: any) => (
                  <div key={ep.id} className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-semibold text-obsidian-inkPrimary truncate max-w-md">
                        {ep.taskQuery}
                      </span>
                      <span
                        className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-bold ${
                          ep.outcome === 'success'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {ep.outcome} (Fitness: {Math.round((ep.fitnessScore || 0) * 100)}%)
                      </span>
                    </div>
                    <p className="text-[11px] text-obsidian-inkSecondary font-mono">{ep.actionSummary}</p>
                    {Array.isArray(ep.toolsUsed) && ep.toolsUsed.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[10px] text-obsidian-inkMuted uppercase">Tools:</span>
                        {ep.toolsUsed.map((t: string, idx: number) => (
                          <span key={idx} className="px-1.5 py-0.5 rounded bg-obsidian-surface3 text-[10px] font-mono text-obsidian-inkPrimary">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 4: PROCEDURAL MEMORY */}
          {activeTab === 'procedural' && (
            <div className="space-y-2">
              {procedural.length === 0 ? (
                <div className="p-8 text-center text-obsidian-inkMuted text-xs font-mono">
                  No procedural SOP recipes registered yet. Multi-step solutions with test passes save recipes automatically.
                </div>
              ) : (
                procedural.map((recipe: any) => (
                  <div key={recipe.id} className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-semibold text-obsidian-inkPrimary">{recipe.name}</span>
                      <span className="text-[10px] text-obsidian-inkMuted">
                        Success: {recipe.successCount} · Failures: {recipe.failureCount}
                      </span>
                    </div>
                    <div className="text-[11px] text-obsidian-inkSecondary font-mono">
                      Trigger: <code className="bg-obsidian-surface3 px-1 py-0.5 rounded">{recipe.triggerPattern}</code>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 5: RETRIEVAL MEMORY */}
          {activeTab === 'retrieval' && (
            <div className="p-4 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-semibold text-obsidian-inkPrimary font-mono">
                  Multi-Index Hybrid Retrieval Engine Active
                </span>
              </div>
              <p className="text-xs text-obsidian-inkSecondary leading-relaxed">
                Combines AST symbol maps, filesystem topology, full-text SQLite indexing, and long-term memory retrieval to feed high-precision slices to the model context.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                {['AST Symbols', 'Workspace Files', 'SQLite Memory', 'Vector Search'].map((idx, i) => (
                  <div key={i} className="p-2 rounded bg-obsidian-surface3 border border-obsidian-hairline text-center text-[11px] font-mono text-obsidian-inkPrimary">
                    {idx}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: PARAMETRIC MEMORY */}
          {activeTab === 'parametric' && (
            <div className="p-4 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-obsidian-inkMuted uppercase tracking-wider text-[10px]">Model Capability Tier</span>
                <span className="px-2 py-0.5 rounded bg-obsidian-surface3 text-obsidian-inkPrimary font-bold text-[10px]">
                  {parametric?.capabilityTier || 'FRONTIER'}
                </span>
              </div>
              <div>
                <span className="text-obsidian-inkMuted uppercase tracking-wider text-[10px] block mb-1">Context Window Bound</span>
                <span className="text-obsidian-inkPrimary font-semibold">
                  {(parametric?.contextWindow || 200000).toLocaleString()} tokens
                </span>
              </div>
              <div>
                <span className="text-obsidian-inkMuted uppercase tracking-wider text-[10px] block mb-1">Calibration Notes</span>
                <p className="text-obsidian-inkSecondary leading-relaxed text-[11px]">
                  {parametric?.calibrationNotes || 'Model tier calibrated for multi-file autonomous tool calling, continuous verification, and surgical diff synthesis.'}
                </p>
              </div>
            </div>
          )}

          {/* TAB 7: PROSPECTIVE MEMORY */}
          {activeTab === 'prospective' && (
            <div className="space-y-2">
              {prospective.length === 0 ? (
                <div className="p-8 text-center text-obsidian-inkMuted text-xs font-mono">
                  No prospective tasks currently scheduled. Scheduled verifications and cron tasks will surface here.
                </div>
              ) : (
                prospective.map((task: any) => (
                  <div key={task.id} className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-between gap-2 text-xs font-mono">
                    <div>
                      <div className="font-semibold text-obsidian-inkPrimary">{task.taskDescription}</div>
                      <div className="text-[10px] text-obsidian-inkMuted">
                        Trigger: {task.triggerType} · Status: {task.status}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-10 px-4 border-t border-obsidian-hairline bg-obsidian-surface1 flex items-center justify-between shrink-0 text-[10px] font-mono text-obsidian-inkMuted">
          <span>Persistent SQLite Store: ~/.sutra/memory.sqlite</span>
          <button
            type="button"
            onClick={() => setMemoryModalOpen(false)}
            className="px-3 py-1 rounded bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
