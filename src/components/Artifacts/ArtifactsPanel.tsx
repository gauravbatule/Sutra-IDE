import React, { useState, useEffect, useMemo } from 'react';
import {
  FileCode,
  ListChecks,
  Palette,
  CheckCircle2,
  Check,
  BookOpen,
  ShieldAlert,
  Search,
  RefreshCw,
  Copy,
  Plus,
  ExternalLink,
  MessageSquare
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { ArtifactItem } from '../../types/ide.js';

const TYPE_ICONS: Record<string, typeof FileCode> = {
  plan: ListChecks,
  findings: ShieldAlert,
  audit: ShieldAlert,
  implementation: FileCode,
  design: Palette,
  verification: CheckCircle2,
  doc: BookOpen,
};

const TYPE_LABELS: Record<string, string> = {
  plan: 'Plan',
  findings: 'Findings',
  audit: 'Audit',
  implementation: 'Code Spec',
  design: 'Design',
  verification: 'Verification',
  doc: 'Document',
};

export const ArtifactsPanel: React.FC = () => {
  const { activeChatSessionId, setActiveArtifactModal, fileTreeVersion, isAgentGenerating } = useIDEStore();
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'current'>('all');
  const [isLoading, setIsLoading] = useState(false);
  // Per-row "copied" feedback — keeps every row independent so the user can
  // copy several artifacts in a row without waiting for a shared indicator.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchArtifacts = async () => {
    setIsLoading(true);
    try {
      const url = scopeFilter === 'current' && activeChatSessionId
        ? `/api/artifacts?chatId=${encodeURIComponent(activeChatSessionId)}`
        : '/api/artifacts';
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data?.artifacts)) {
        setArtifacts(data.artifacts);
        if (!selectedArtifactId && data.artifacts.length > 0) {
          setSelectedArtifactId(data.artifacts[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load artifacts:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchArtifacts();
  }, [scopeFilter, activeChatSessionId, fileTreeVersion, isAgentGenerating]);

  // Periodic poll while agent is generating
  useEffect(() => {
    if (!isAgentGenerating) return;
    const interval = setInterval(() => {
      fetchArtifacts();
    }, 3000);
    return () => clearInterval(interval);
  }, [isAgentGenerating, scopeFilter, activeChatSessionId]);

  const filteredArtifacts = useMemo(() => {
    return artifacts.filter((a) => {
      const matchesSearch =
        !searchQuery.trim() ||
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.content.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === 'all' || a.type === filterType;
      return matchesSearch && matchesType;
    });
  }, [artifacts, searchQuery, filterType]);

  const handleCopyContent = async (id: string, content: string) => {
    // Prefer the modern Clipboard API but fall back to a hidden textarea +
    // execCommand for browsers that gate navigator.clipboard behind an
    // active secure context (Electron's older windows, http://, etc.).
    // Postel's law: be liberal in what we accept.
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
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1500);
    } catch (err) {
      // Surface the failure to the console — the icon can't render "failed"
      // in the same affordance as "succeeded", but the dev tools trace is
      // better than a silent no-op for the user.
      // eslint-disable-next-line no-console
      console.warn('Failed to copy artifact content', err);
    }
  };

  const handleCreateNewArtifact = () => {
    setActiveArtifactModal({
      id: `art-${Date.now()}`,
      chatId: activeChatSessionId || undefined,
      name: 'New Specification',
      type: 'doc',
      status: 'draft',
      content: '# New Specification\n\nDescribe the architecture, requirements, or plan here...',
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1 border-r border-obsidian-hairline select-none overflow-hidden font-sans">
      {/* Header */}
      <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-bold text-obsidian-inkPrimary uppercase tracking-widest font-mono">
            Artifacts
          </span>
          <span className="text-[9px] font-mono text-obsidian-inkMuted">
            ({filteredArtifacts.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCreateNewArtifact}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Create New Artifact"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={fetchArtifacts}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Refresh Artifacts"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Scope Switcher (All vs Current Chat) */}
      <div className="px-2 pt-2 pb-1 border-b border-obsidian-hairline bg-obsidian-surface2/30 flex items-center gap-1 text-[10px] font-mono">
        <button
          onClick={() => setScopeFilter('all')}
          className={`flex-1 py-1 rounded text-center transition-colors cursor-pointer ${
            scopeFilter === 'all'
              ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-medium border border-obsidian-hairline'
              : 'text-obsidian-inkMuted hover:text-obsidian-inkSecondary'
          }`}
        >
          All Artifacts
        </button>
        <button
          onClick={() => setScopeFilter('current')}
          className={`flex-1 py-1 rounded text-center transition-colors cursor-pointer flex items-center justify-center gap-1 ${
            scopeFilter === 'current'
              ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-medium border border-obsidian-hairline'
              : 'text-obsidian-inkMuted hover:text-obsidian-inkSecondary'
          }`}
        >
          <MessageSquare className="w-2.5 h-2.5" />
          <span>Current Chat</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-2 border-b border-obsidian-hairline space-y-1.5 bg-obsidian-surface1">
        <div className="relative">
          <Search className="w-3 h-3 text-obsidian-inkMuted absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search artifacts..."
            className="w-full bg-obsidian-surface2 border-none rounded px-6 py-1 text-[11px] text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:ring-1 focus:ring-obsidian-hairline font-mono"
          />
        </div>

        {/* Type Filter Chips */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 text-[10px] font-mono">
          {['all', 'plan', 'findings', 'implementation', 'design', 'doc'].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2 py-0.5 rounded capitalize transition-colors cursor-pointer shrink-0 ${
                filterType === t
                  ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-medium'
                  : 'bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Artifact List */}
      <div className="flex-1 overflow-y-auto divide-y divide-obsidian-hairline bg-obsidian-canvas/50">
        {filteredArtifacts.length === 0 ? (
          <div className="p-6 text-center text-[11px] font-mono text-obsidian-inkMuted">
            {artifacts.length === 0 ? 'No artifacts generated yet' : 'No matching artifacts found'}
          </div>
        ) : (
          filteredArtifacts.map((art) => {
            const Icon = TYPE_ICONS[art.type] || FileCode;
            const isSelected = art.id === selectedArtifactId;
            return (
              <div
                key={art.id}
                onClick={() => {
                  setSelectedArtifactId(art.id);
                  setActiveArtifactModal(art);
                }}
                className={`w-full p-3 text-left transition-colors cursor-pointer font-mono group hover:bg-obsidian-surface2/60 ${
                  isSelected
                    ? 'bg-obsidian-surface2 border-l-2 border-obsidian-inkPrimary'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-6 h-6 rounded bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkSecondary shrink-0 mt-0.5 group-hover:text-obsidian-inkPrimary">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="truncate min-w-0">
                      <div className="text-[11px] font-medium text-obsidian-inkPrimary truncate group-hover:text-obsidian-inkPrimary">
                        {art.name}
                      </div>
                      <div className="text-[9px] text-obsidian-inkMuted uppercase mt-0.5 flex items-center gap-1.5">
                        <span>{TYPE_LABELS[art.type] || art.type}</span>
                        <span>·</span>
                        <span>{art.status}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyContent(art.id, art.content);
                      }}
                      className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors"
                      title="Copy Markdown"
                      aria-label={`Copy ${art.name} to clipboard`}
                    >
                      {copiedId === art.id ? (
                        <Check className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3 h-3" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveArtifactModal(art);
                      }}
                      className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary"
                      title="View / Edit in Center-Stage"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {artifacts.length === 0 && !isLoading && (
        <div className="p-6 text-center text-obsidian-inkMuted space-y-2">
          <BookOpen className="w-8 h-8 opacity-40 mx-auto" />
          <p className="text-xs font-medium text-obsidian-inkSecondary">No Artifacts Generated Yet</p>
          <p className="text-[11px] font-mono">
            Ask Astra to audit code, create an architecture spec, or click + above to write one.
          </p>
        </div>
      )}
    </div>
  );
};
