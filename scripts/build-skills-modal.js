const fs = require('fs');
const path = require('path');

const targetDir = 'src/components/Skills';
if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

const content = `import React, { useState, useEffect } from 'react';
import { X, Search, Plus, Check, Layers, Sliders } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export interface SkillItem {
  name: string;
  description: string;
  category?: string;
  triggers: string[];
  isCustom?: boolean;
}

const DEFAULT_GLOBAL_SKILLS: SkillItem[] = [
  { name: 'anti-slop-web-design', description: 'Strictly enforces anti-slop premium design rules, bans generic AI SaaS card grids, and ensures high-craft editorial layouts.', category: 'Design', triggers: ['ui', 'frontend', 'design', 'layout', 'styling'] },
  { name: 'premium-design-intelligence', description: 'Enforces Paper + Ink + Accent model (80-90% neutral canvas, deep ink typography, scarce accent).', category: 'Design', triggers: ['typography', 'palette', 'theme', 'color', 'contrast'] },
  { name: 'accessible-design-systems', description: 'Enforces WCAG 2.2 AA/AAA accessibility, ARIA patterns, keyboard navigation loops, and focus visible states.', category: 'Design', triggers: ['a11y', 'accessibility', 'aria', 'wcag', 'keyboard'] },
  { name: 'high-craft-ui-styling', description: 'Architects bespoke vanilla CSS and modern CSS token systems with high aesthetic standards.', category: 'Design', triggers: ['css', 'styling', 'tailwind', 'components', 'tokens'] },
  { name: 'responsive-fluid-layouts', description: 'Builds container queries, clamp-based fluid layouts, and zero-layout-shift responsive systems.', category: 'Design', triggers: ['responsive', 'mobile', 'fluid', 'grid', 'flexbox'] },
  { name: 'principal-swe-agent', description: 'Production-quality engineering, strict modular architecture, scoped diffs, and verification.', category: 'Engineering', triggers: ['refactor', 'architect', 'feature', 'build', 'production'] },
  { name: 'typescript-strict-patterns', description: 'Enforces strict TypeScript generics, branded types, and exhaustive pattern matching.', category: 'Engineering', triggers: ['typescript', 'types', 'ts', 'generics', 'interface'] },
  { name: 'safe-build', description: 'Read-before-edit, scoped diffs, search-before-rename, and bounded self-critique verification loop.', category: 'Engineering', triggers: ['edit', 'safe', 'verify', 'build', 'mutation'] },
  { name: 'nextjs-app-router-mastery', description: 'Server Components, streaming Suspense, Server Actions, and optimal caching strategies.', category: 'Engineering', triggers: ['nextjs', 'next', 'app router', 'rsc', 'server actions'] },
  { name: 'nodejs-backend-architecture', description: 'Layered controller-service-repository patterns, Zod validation, and robust middleware.', category: 'Engineering', triggers: ['nodejs', 'express', 'backend', 'api', 'server'] },
  { name: 'root-cause-debugging', description: 'Executes systematic 5-Whys hypothesis testing, binary search isolation, and root-cause repair.', category: 'Debugging', triggers: ['debug', 'fix', 'error', 'crash', 'bug'] },
  { name: 'bug-exterminator', description: 'Surgical error isolation, regression test creation, and edge-case validation.', category: 'Debugging', triggers: ['test failure', 'exception', 'stack trace', 'failing'] },
  { name: 'performance-bottleneck-profiling', description: 'Profiles CPU flame graphs, event loop lag, synchronous blocking operations, and long tasks.', category: 'Debugging', triggers: ['performance', 'slow', 'profiling', 'lag', 'optimize'] },
  { name: 'powershell-windows-dev-debugging', description: 'Troubleshoots Windows PowerShell environment issues, port collisions, and process termination.', category: 'Debugging', triggers: ['powershell', 'windows', 'port', 'eaddrinuse', 'cmd'] },
  { name: 'godmode', description: 'Continuous highest-rigor autonomous execution mode with zero placeholders and complete verification.', category: 'AI & Agents', triggers: ['godmode', 'autonomous', 'unattended', 'mission'] },
  { name: 'gemini-api-and-function-calling', description: 'Integrates Google Gemini APIs, structured function calling, multimodal inputs, and tool orchestration.', category: 'AI & Agents', triggers: ['gemini', 'function calling', 'tools', 'multimodal'] },
  { name: 'multi-agent-orchestration', description: 'Architects supervisor-worker agent swarms, message bus protocols, and collaborative decomposition.', category: 'AI & Agents', triggers: ['multi-agent', 'subagent', 'swarm', 'orchestration'] },
  { name: 'rag-pipeline-engineering', description: 'Architects end-to-end RAG pipelines with semantic chunking and cross-encoder reranking.', category: 'AI & Agents', triggers: ['rag', 'embeddings', 'vector search', 'retrieval'] },
  { name: 'rest-api-design-best-practices', description: 'Designs standardized RESTful APIs with RFC 7807 problem details, idempotency, and cursor pagination.', category: 'Data & APIs', triggers: ['rest', 'api', 'endpoints', 'json', 'http'] },
  { name: 'database-schema-modeling', description: 'Normalized relational schemas, ACID transactions, foreign keys, and indexing strategies.', category: 'Data & APIs', triggers: ['database', 'sql', 'schema', 'postgres', 'sqlite'] },
  { name: 'redis-caching-and-queues', description: 'High-throughput caching, Pub/Sub channels, distributed locks, and BullMQ worker queues.', category: 'Data & APIs', triggers: ['redis', 'cache', 'queue', 'pubsub', 'locking'] },
];

export const SkillsModal: React.FC = () => {
  const { isSkillsModalOpen, setSkillsModalOpen } = useIDEStore();
  const [activeTab, setActiveTab] = useState<'browse' | 'add'>('browse');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [skills, setSkills] = useState<SkillItem[]>(DEFAULT_GLOBAL_SKILLS);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState('Engineering');
  const [newSkillTriggers, setNewSkillTriggers] = useState('');
  const [newSkillPrompt, setNewSkillPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isSkillsModalOpen) {
      fetch('/api/skills')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.skills) && data.skills.length > 0) {
            setSkills(data.skills);
          }
        })
        .catch(() => {});
    }
  }, [isSkillsModalOpen]);

  if (!isSkillsModalOpen) return null;

  const categories = ['All', 'Design', 'Engineering', 'Debugging', 'AI & Agents', 'Data & APIs'];

  const filteredSkills = skills.filter((s) => {
    const matchesCat = selectedCategory === 'All' || s.category === selectedCategory;
    const matchesSearch =
      !searchQuery.trim() ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.triggers.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const handleSaveCustomSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkillName.trim() || !newSkillPrompt.trim()) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSkillName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
          description: newSkillDesc.trim() || newSkillName.trim(),
          category: newSkillCategory,
          triggers: newSkillTriggers.split(',').map((t) => t.trim()).filter(Boolean),
          content: newSkillPrompt.trim(),
        }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        const newSkill: SkillItem = {
          name: newSkillName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
          description: newSkillDesc.trim() || newSkillName.trim(),
          category: newSkillCategory,
          triggers: newSkillTriggers.split(',').map((t) => t.trim()).filter(Boolean),
          isCustom: true,
        };
        setSkills((prev) => [newSkill, ...prev]);
        setTimeout(() => {
          setActiveTab('browse');
          setNewSkillName('');
          setNewSkillDesc('');
          setNewSkillTriggers('');
          setNewSkillPrompt('');
          setSaveSuccess(false);
        }, 800);
      }
    } catch {} finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in select-none font-sans"
      onClick={() => setSkillsModalOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl bg-obsidian-surface1 border border-obsidian-hairline rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-obsidian-hairline bg-obsidian-surface2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-obsidian-inkPrimary">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-obsidian-inkPrimary font-mono">Agent Skills Hub</h2>
                <span className="text-[10px] font-mono bg-white/[0.06] text-obsidian-inkSecondary px-2 py-0.5 rounded border border-white/[0.08]">{skills.length} Loaded</span>
              </div>
              <p className="text-[11px] text-obsidian-inkMuted font-mono">Auto-activated skill intelligence and custom capability catalog</p>
            </div>
          </div>
          <button onClick={() => setSkillsModalOpen(false)} className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/10 transition-colors cursor-pointer" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center px-4 border-b border-obsidian-hairline bg-obsidian-surface2/50 text-xs font-mono">
          <button type="button" onClick={() => setActiveTab('browse')} className={'flex items-center gap-1.5 px-3 py-2.5 border-b-2 font-medium transition-colors cursor-pointer ' + (activeTab === 'browse' ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary bg-white/[0.04]' : 'border-transparent text-obsidian-inkMuted hover:text-obsidian-inkSecondary')}>
            <Layers className="w-3.5 h-3.5" />
            <span>Browse Skills</span>
          </button>
          <button type="button" onClick={() => setActiveTab('add')} className={'flex items-center gap-1.5 px-3 py-2.5 border-b-2 font-medium transition-colors cursor-pointer ' + (activeTab === 'add' ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary bg-white/[0.04]' : 'border-transparent text-obsidian-inkMuted hover:text-obsidian-inkSecondary')}>
            <Plus className="w-3.5 h-3.5" />
            <span>Add Custom Skill</span>
          </button>
        </div>
        {activeTab === 'browse' ? (
          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-obsidian-inkMuted absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search skills by name, trigger keyword, or description..." className="w-full bg-obsidian-canvas border border-obsidian-border rounded-lg pl-8 pr-3 py-2 text-xs font-mono text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20" />
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar font-mono text-[11px]">
                {categories.map((cat) => (
                  <button key={cat} type="button" onClick={() => setSelectedCategory(cat)} className={'px-2.5 py-1 rounded-md border transition-colors cursor-pointer shrink-0 ' + (selectedCategory === cat ? 'border-obsidian-inkPrimary bg-white text-black font-semibold' : 'border-white/[0.08] bg-obsidian-surface2 hover:bg-white/[0.06] text-obsidian-inkSecondary')}>{cat}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {filteredSkills.map((skill) => (
                <div key={skill.name} className="p-3 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline hover:border-white/20 transition-all text-left space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold font-mono text-obsidian-inkPrimary">{skill.name}</span>
                      {skill.category && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-obsidian-inkMuted">{skill.category}</span>}
                      {skill.isCustom && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">Custom</span>}
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400/90 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Auto-Active</span>
                  </div>
                  <p className="text-xs text-obsidian-inkSecondary leading-relaxed font-sans">{skill.description}</p>
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5 font-mono text-[9px] text-obsidian-inkMuted">
                    <span className="uppercase text-[8px] tracking-wider text-obsidian-inkMuted/70">Triggers:</span>
                    {skill.triggers.map((t, idx) => (<span key={idx} className="px-1.5 py-0.2 rounded bg-white/[0.04] border border-white/[0.06]">{t}</span>))}
                  </div>
                </div>
              ))}
              {filteredSkills.length === 0 && <div className="py-8 text-center text-xs font-mono text-obsidian-inkMuted">No skills matching "{searchQuery}"</div>}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveCustomSkill} className="p-5 flex-1 overflow-y-auto space-y-4 font-mono text-xs">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">Skill Identifier Name</label>
              <input type="text" required value={newSkillName} onChange={(e) => setNewSkillName(e.target.value)} placeholder="e.g. sveltekit-routing-expert" className="w-full bg-obsidian-canvas border border-obsidian-border rounded-lg px-3 py-2 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">Category</label>
                <select value={newSkillCategory} onChange={(e) => setNewSkillCategory(e.target.value)} className="w-full bg-obsidian-canvas border border-obsidian-border rounded-lg px-3 py-2 text-xs text-obsidian-inkPrimary focus:outline-none">
                  <option value="Engineering">Engineering</option>
                  <option value="Design">Design</option>
                  <option value="Debugging">Debugging</option>
                  <option value="AI & Agents">AI & Agents</option>
                  <option value="Data & APIs">Data & APIs</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">Trigger Keywords</label>
                <input type="text" value={newSkillTriggers} onChange={(e) => setNewSkillTriggers(e.target.value)} placeholder="e.g. svelte, sveltekit, runes" className="w-full bg-obsidian-canvas border border-obsidian-border rounded-lg px-3 py-2 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">Short Description</label>
              <input type="text" value={newSkillDesc} onChange={(e) => setNewSkillDesc(e.target.value)} placeholder="e.g. Enforces Svelte 5 runes patterns and reactive store architecture." className="w-full bg-obsidian-canvas border border-obsidian-border rounded-lg px-3 py-2 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">System Prompt Instructions & Rules (Markdown)</label>
              <textarea rows={5} required value={newSkillPrompt} onChange={(e) => setNewSkillPrompt(e.target.value)} placeholder="Write specific engineering invariants, banned anti-patterns, and mandatory architectural rules for Astra when this skill is active..." className="w-full bg-obsidian-canvas border border-obsidian-border rounded-lg p-3 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none resize-none leading-relaxed" />
            </div>
            <div className="pt-2 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setActiveTab('browse')} className="px-3 py-1.5 rounded-lg border border-obsidian-border text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors cursor-pointer">Cancel</button>
              <button type="submit" disabled={isSaving || !newSkillName.trim() || !newSkillPrompt.trim()} className="px-4 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40">
                {saveSuccess ? (<><Check className="w-3.5 h-3.5 text-emerald-600" /><span>Skill Saved!</span></>) : isSaving ? (<span>Saving...</span>) : (<><Plus className="w-3.5 h-3.5" /><span>Register Skill</span></>)}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
`;

fs.writeFileSync('src/components/Skills/SkillsModal.tsx', content, 'utf-8');
console.log('✅ Created src/components/Skills/SkillsModal.tsx');