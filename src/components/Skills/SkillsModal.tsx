import React, { useState, useEffect } from 'react';
import { X, Search, Plus, Check, Trash2, FileText, Sparkles, Code2, AlertCircle, ArrowLeft, Loader2, Puzzle } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export interface SkillItem {
  name: string;
  description: string;
  category?: string;
  triggers: string[];
  isCustom?: boolean;
}

export const SkillsModal: React.FC = () => {
  const { isSkillsModalOpen, setSkillsModalOpen } = useIDEStore();
  const [activeTab, setActiveTab] = useState<'browse' | 'add'>('browse');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<{ name: string; content: string } | null>(null);
  const [isLoadingSkillContent, setIsLoadingSkillContent] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<string | null>(null);

  // Form states
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState('Engineering');
  const [newSkillTriggers, setNewSkillTriggers] = useState('');
  const [newSkillPrompt, setNewSkillPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.skills)) {
          setSkills(data.skills);
        }
      }
    } catch {
      setSkills([]);
    }
  };

  useEffect(() => {
    if (isSkillsModalOpen) {
      fetchSkills();
      setSelectedSkill(null);
    }
  }, [isSkillsModalOpen]);

  if (!isSkillsModalOpen) return null;

  const categories = ['All', 'Engineering', 'Design', 'Debugging', 'AI & Agents', 'Data & APIs', 'Custom'];

  const filteredSkills = skills.filter((s) => {
    const matchesCat = selectedCategory === 'All' || (s.category || 'Custom') === selectedCategory;
    const matchesSearch =
      !searchQuery.trim() ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.triggers.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const handleInspectSkill = async (skillName: string) => {
    setIsLoadingSkillContent(true);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedSkill({ name: skillName, content: data.content || '' });
      }
    } catch {
      setSelectedSkill({ name: skillName, content: 'Unable to load skill instructions file.' });
    } finally {
      setIsLoadingSkillContent(false);
    }
  };

  const handleDeleteSkill = async (skillName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete custom skill "${skillName}" from workspace?`)) return;
    setDeletingSkill(skillName);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}`, { method: 'DELETE' });
      if (res.ok) {
        setSkills((prev) => prev.filter((s) => s.name !== skillName));
        if (selectedSkill?.name === skillName) setSelectedSkill(null);
      }
    } catch {
    } finally {
      setDeletingSkill(null);
    }
  };

  const handleSaveCustomSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleanName = newSkillName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!cleanName || !newSkillPrompt.trim()) {
      setFormError('Skill name and instructions are required.');
      return;
    }

    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          description: newSkillDesc.trim() || cleanName,
          category: newSkillCategory,
          triggers: newSkillTriggers.split(',').map((t) => t.trim()).filter(Boolean),
          content: newSkillPrompt.trim(),
        }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        await fetchSkills();
        setTimeout(() => {
          setActiveTab('browse');
          setNewSkillName('');
          setNewSkillDesc('');
          setNewSkillTriggers('');
          setNewSkillPrompt('');
          setSaveSuccess(false);
        }, 600);
      } else {
        const data = await res.json();
        setFormError(data.error || 'Failed to save skill.');
      }
    } catch {
      setFormError('Network error while saving skill.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in select-none font-sans"
      onClick={() => setSkillsModalOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl bg-obsidian-surface1 border border-obsidian-border rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-obsidian-border bg-obsidian-surface1 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary">
              <Puzzle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-obsidian-inkPrimary font-mono">Workspace Skills</h2>
                <span className="text-[10px] font-mono bg-obsidian-surface2 text-obsidian-inkSecondary px-2 py-0.5 rounded-full border border-obsidian-border">
                  {skills.length} Installed
                </span>
              </div>
              <p className="text-[11px] text-obsidian-inkMuted font-mono">
                Create and manage custom AI agent guidelines and prompt architectures
              </p>
            </div>
          </div>
          <button
            onClick={() => setSkillsModalOpen(false)}
            className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        {!selectedSkill && (
          <div className="flex items-center px-4 border-b border-obsidian-border bg-obsidian-surface1 text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveTab('browse')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 font-medium transition-colors cursor-pointer ${
                activeTab === 'browse'
                  ? 'border-white text-obsidian-inkPrimary bg-obsidian-surface1'
                  : 'border-transparent text-obsidian-inkMuted hover:text-obsidian-inkSecondary'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Installed Skills ({skills.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('add')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 font-medium transition-colors cursor-pointer ${
                activeTab === 'add'
                  ? 'border-white text-obsidian-inkPrimary bg-obsidian-surface1'
                  : 'border-transparent text-obsidian-inkMuted hover:text-obsidian-inkSecondary'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Custom Skill</span>
            </button>
          </div>
        )}

        {/* Content View */}
        {selectedSkill ? (
          <div className="flex-1 overflow-y-auto flex flex-col p-5 space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-obsidian-border">
              <button
                type="button"
                onClick={() => setSelectedSkill(null)}
                className="flex items-center gap-1.5 text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Installed Skills</span>
              </button>
              <span className="text-[10px] text-obsidian-inkMuted">
                .agentskills/{selectedSkill.name}.md
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Code2 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-obsidian-inkPrimary font-mono">{selectedSkill.name}</h3>
              </div>
              {isLoadingSkillContent ? (
                <div className="p-4 rounded-xl bg-black/60 border border-obsidian-border text-obsidian-inkMuted text-[11px] font-mono flex items-center gap-2" role="status">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Loading skill instructions…
                </div>
              ) : (
                <pre className="p-4 rounded-xl bg-black/60 border border-obsidian-border text-obsidian-inkSecondary text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono select-text">
                  {selectedSkill.content}
                </pre>
              )}
            </div>
          </div>
        ) : activeTab === 'browse' ? (
          <div className="p-5 flex-1 overflow-y-auto space-y-4">
            {skills.length > 0 && (
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-obsidian-inkMuted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search installed skills by name, trigger keyword, or description..."
                    className="w-full bg-obsidian-surface1 border border-obsidian-border rounded-xl pl-8 pr-3 py-2 text-xs font-mono text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none focus:border-obsidian-borderBright"
                  />
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar font-mono text-[11px]">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                        selectedCategory === cat
                          ? 'border-obsidian-accent bg-obsidian-accent text-obsidian-inkInverse font-semibold'
                          : 'border-obsidian-border bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* List or Enterprise Empty State */}
            {skills.length === 0 ? (
              <div className="py-12 px-4 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-obsidian-surface1 border border-obsidian-border flex items-center justify-center text-obsidian-inkSecondary shadow-inner">
                  <Sparkles className="w-6 h-6 text-obsidian-inkPrimary" />
                </div>
                <div className="space-y-1 max-w-md">
                  <h3 className="text-sm font-semibold text-obsidian-inkPrimary font-mono">No Custom Skills Installed</h3>
                  <p className="text-xs text-obsidian-inkMuted leading-relaxed font-sans">
                    Skills allow you to create workspace-specific architectural standards, invariant rules, and auto-activated prompts stored in <code className="text-[11px] text-obsidian-inkPrimary">.agentskills/</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('add')}
                  className="px-4 py-2 rounded-xl bg-obsidian-accent text-obsidian-inkInverse font-semibold text-xs hover:bg-obsidian-accentHover transition-all flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create First Custom Skill</span>
                </button>
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono text-obsidian-inkMuted">
                No custom skills matching "{searchQuery}"
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {filteredSkills.map((skill) => (
                  <div
                    key={skill.name}
                    onClick={() => handleInspectSkill(skill.name)}
                    className="p-3.5 rounded-xl bg-obsidian-surface1 border border-obsidian-border hover:border-obsidian-border transition-all text-left space-y-2 cursor-pointer group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold font-mono text-obsidian-inkPrimary group-hover:text-obsidian-inkPrimary transition-colors">
                          {skill.name}
                        </span>
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkMuted">
                          {skill.category || 'Custom'}
                        </span>
                        <span className="text-[9px] font-mono text-obsidian-inkMuted">
                          .agentskills/{skill.name}.md
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSkill(skill.name, e)}
                          disabled={deletingSkill === skill.name}
                          className="p-1 rounded text-obsidian-inkMuted hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                          title="Delete skill"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-obsidian-inkSecondary leading-relaxed font-sans">
                      {skill.description}
                    </p>
                    {skill.triggers && skill.triggers.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5 font-mono text-[9px] text-obsidian-inkMuted">
                        <span className="uppercase text-[8px] tracking-wider text-obsidian-inkMuted/70">
                          Auto-Triggers:
                        </span>
                        {skill.triggers.map((t, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.2 rounded bg-obsidian-surface1 border border-obsidian-border text-obsidian-inkSecondary"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSaveCustomSkill} className="p-5 flex-1 overflow-y-auto space-y-4 font-mono text-xs">
            {formError && (
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">
                Skill Identifier Name
              </label>
              <input
                type="text"
                required
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                placeholder="e.g. sveltekit-routing-expert"
                className="w-full bg-obsidian-surface1 border border-obsidian-border rounded-xl px-3 py-2 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none focus:border-obsidian-borderBright"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">
                  Category
                </label>
                <select
                  value={newSkillCategory}
                  onChange={(e) => setNewSkillCategory(e.target.value)}
                  className="w-full bg-obsidian-surface1 border border-obsidian-border rounded-xl px-3 py-2 text-xs text-obsidian-inkPrimary focus:outline-none"
                >
                  <option value="Engineering">Engineering</option>
                  <option value="Design">Design</option>
                  <option value="Debugging">Debugging</option>
                  <option value="AI & Agents">AI & Agents</option>
                  <option value="Data & APIs">Data & APIs</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">
                  Trigger Keywords (Comma Separated)
                </label>
                <input
                  type="text"
                  value={newSkillTriggers}
                  onChange={(e) => setNewSkillTriggers(e.target.value)}
                  placeholder="e.g. svelte, sveltekit, runes"
                  className="w-full bg-obsidian-surface1 border border-obsidian-border rounded-xl px-3 py-2 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">
                Short Description
              </label>
              <input
                type="text"
                value={newSkillDesc}
                onChange={(e) => setNewSkillDesc(e.target.value)}
                placeholder="e.g. Enforces Svelte 5 runes patterns and reactive store architecture."
                className="w-full bg-obsidian-surface1 border border-obsidian-border rounded-xl px-3 py-2 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-obsidian-inkSecondary uppercase tracking-wider">
                System Prompt Instructions & Rules (Markdown)
              </label>
              <textarea
                rows={6}
                required
                value={newSkillPrompt}
                onChange={(e) => setNewSkillPrompt(e.target.value)}
                placeholder="Write specific engineering invariants, banned anti-patterns, and mandatory architectural rules for Astra when this skill is active..."
                className="w-full bg-obsidian-surface1 border border-obsidian-border rounded-xl p-3 text-xs text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none resize-none leading-relaxed"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('browse')}
                className="px-3.5 py-1.5 rounded-xl border border-obsidian-border text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || !newSkillName.trim() || !newSkillPrompt.trim()}
                className="px-4 py-1.5 rounded-xl bg-obsidian-accent text-obsidian-inkInverse font-semibold text-xs hover:bg-obsidian-accentHover transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Skill Saved!</span>
                  </>
                ) : isSaving ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Register Skill</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

