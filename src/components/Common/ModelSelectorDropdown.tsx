import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Check,
  Cpu,
  ChevronDown,
  Settings,
  Sparkles
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { OmniModel } from '../../types/ide.js';

interface ModelSelectorDropdownProps {
  className?: string;
  buttonVariant?: 'pill' | 'compact' | 'header';
}

/** Offline fallback shape — provider is widened beyond AIProviderId to cover every upstream vendor */
interface FallbackModel {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  description?: string;
}

// Only used when /api/models is unreachable; the live catalog takes precedence at runtime.
// Ids mirror the server's BUILTIN_MODELS so a selection made offline still resolves after reconnect.
const DEFAULT_MODELS: FallbackModel[] = [
  {
    id: 'auto',
    name: 'SUTRA Auto',
    provider: 'sutra',
    description: 'Routes each request to the best available model with automatic fallback.',
    contextWindow: 1000000,
  },
  { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai', description: 'OpenAI flagship for agentic coding.', contextWindow: 400000 },
  { id: 'claude-opus-5', name: 'Claude Opus 5', provider: 'anthropic', description: 'Most capable Anthropic model for full-repo engineering.', contextWindow: 200000 },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', description: 'Balanced Anthropic model for production coding.', contextWindow: 200000 },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'google', description: 'Google multimodal flagship with very large context.', contextWindow: 1048576 },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'google', description: 'High-speed Google model built for interactive coding.', contextWindow: 1048576 },
  { id: 'glm-4.6', name: 'GLM-4.6', provider: 'zhipu', description: 'Zhipu frontier coding model with strong agentic tool use.', contextWindow: 200000 },
  { id: 'grok-4', name: 'Grok 4', provider: 'xai', description: 'Advanced reasoning with real-time knowledge access.', contextWindow: 256000 },
  { id: 'deepseek-chat', name: 'DeepSeek-V3', provider: 'deepseek', description: 'Cost-effective open coding intelligence.', contextWindow: 128000 },
  { id: 'luna', name: 'Luna', provider: 'chatgpt-web', description: 'Conversational assistant via ChatGPT Web.', contextWindow: 128000 },
];

/** Canonical display order of provider groups inside the dropdown */
const PROVIDER_ORDER: string[] = [
  'sutra', 'openai', 'anthropic', 'google', 'xai', 'zhipu', 'deepseek', 'qwen',
  'groq', 'chatgpt-web', 'antigravity', 'openrouter', 'nvidia-nim', 'omniroute', 'ollama',
];

/** Human-readable provider names shown as group headers and badges */
const PROVIDER_LABELS: Record<string, string> = {
  sutra: 'SUTRA',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
  zhipu: 'Zhipu',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  groq: 'Groq',
  'chatgpt-web': 'ChatGPT Web',
  antigravity: 'Antigravity Bridge',
  openrouter: 'OpenRouter',
  'nvidia-nim': 'NVIDIA NIM',
  omniroute: 'Local Gateway',
  ollama: 'Ollama (Local)',
};

/** Compact names used inside the auto chain summary ("via Gemini, Claude, GPT") */
const CHAIN_SHORT_NAMES: Record<string, string> = {
  openai: 'GPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  zhipu: 'GLM',
  glm: 'GLM',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  groq: 'Groq',
  'chatgpt-web': 'ChatGPT Web',
  antigravity: 'Antigravity',
  openrouter: 'OpenRouter',
  'nvidia-nim': 'NVIDIA NIM',
  ollama: 'Ollama',
};

/** Providers that never require a user-configured credential */
const NO_KEY_REQUIRED_PROVIDERS = new Set(['sutra', 'ollama', 'nvidia-nim']);

/** Providers that carry their own endpoint and credentials at registration time */
const SELF_CONFIGURED_PROVIDERS = new Set(['custom']);

type CategoryFilter = 'all' | 'groq' | 'reasoning' | 'vision' | 'local';

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  className = '',
  buttonVariant = 'pill'
}) => {
  const { activeModel, setActiveModel, availableModels, setSettingsOpen } = useIDEStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');
  // Live credential map from /api/models; null until first load so hints never fire on stale data
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, boolean> | null>(null);
  // Cookie/OAuth-aware status from the provider catalog (/api/providers/catalog); merged with keys
  const [catalogConfigured, setCatalogConfigured] = useState<Record<string, boolean> | null>(null);
  // Local view toggle: default keeps unconnected providers collapsed under "Not connected"
  const [showAll, setShowAll] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const allModels = useMemo<FallbackModel[]>(() => {
    const list: FallbackModel[] = availableModels && availableModels.length > 0 ? [...availableModels] : DEFAULT_MODELS;
    return Array.from(
      new Map(
        list
          .filter((m) => m.provider !== 'omniroute' && !m.id.includes('omniroute'))
          .map((m) => [`${m.provider}:${m.id}`, m])
      ).values()
    );
  }, [availableModels]);

  // Focus search input when dropdown opens; refresh both credential sources quietly
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      fetch('/api/models')
        .then((r) => r.json())
        .then((d) => setConfiguredKeys(d.configuredKeys && typeof d.configuredKeys === 'object' ? d.configuredKeys : {}))
        .catch(() => undefined);
      fetch('/api/providers/catalog')
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.providers)) {
            const map: Record<string, boolean> = {};
            for (const p of d.providers) map[p.id] = Boolean(p.isConfigured);
            setCatalogConfigured(map);
          }
        })
        .catch(() => undefined);
    } else {
      setSearchQuery('');
      setSelectedCategory('all');
    }
  }, [isOpen]);

  const filteredModels = useMemo(() => {
    return allModels.filter((model) => {
      // Category filter
      const searchable = `${model.name} ${model.id}`.toLowerCase();
      if (selectedCategory === 'groq' && model.provider !== 'groq') return false;
      if (selectedCategory === 'local' && model.provider !== 'ollama') return false;
      if (selectedCategory === 'vision' && !/vision|4o|flash|gpt-5|gpt-oss|gemini/.test(searchable) && model.id !== 'auto') return false;
      if (selectedCategory === 'reasoning' && !/reason|sonnet|opus|pro|120b|o4|glm|grok/.test(searchable) && model.id !== 'auto') return false;

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        model.name.toLowerCase().includes(q) ||
        model.id.toLowerCase().includes(q) ||
        model.provider.toLowerCase().includes(q) ||
        (model.description && model.description.toLowerCase().includes(q))
      );
    });
  }, [allModels, selectedCategory, searchQuery]);

  const getProviderLabel = (provider: string) => PROVIDER_LABELS[provider] || provider;

  /**
   * A provider counts as connected when the catalog reports it configured (API key,
   * cookie, or OAuth) OR the router has a key for it. Unknown/unloaded status never
   * mutes a model — hints only appear once live data confirms the gap.
   */
  const isProviderConnected = (provider: string): boolean => {
    if (NO_KEY_REQUIRED_PROVIDERS.has(provider)) return true;
    if (SELF_CONFIGURED_PROVIDERS.has(provider)) return true;
    if (catalogConfigured && provider in catalogConfigured) return catalogConfigured[provider] === true;
    if (configuredKeys) return configuredKeys[provider] === true;
    return true;
  };

  // Models whose provider has no configured credential stay visible but muted with a hint
  const needsCredential = (model: FallbackModel) => !isProviderConnected(model.provider);

  // Resolved auto chain: short labels of connected providers in canonical order
  const chainSummary = useMemo(() => {
    const present = new Set(allModels.map((m) => m.provider));
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const p of [...PROVIDER_ORDER, ...Array.from(present)]) {
      if (seen.has(p) || p === 'sutra' || !present.has(p)) continue;
      seen.add(p);
      if (isProviderConnected(p)) labels.push(CHAIN_SHORT_NAMES[p] || getProviderLabel(p));
    }
    if (labels.length === 0) return '';
    return `via ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? '…' : ''}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allModels, configuredKeys, catalogConfigured]);

  const connectedCount = useMemo(
    () => allModels.filter((m) => m.id !== 'auto' && !needsCredential(m)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allModels, configuredKeys, catalogConfigured]
  );

  const getModelCapabilityTag = (model: FallbackModel) => {
    const id = model.id.toLowerCase();
    if (id === 'auto') return 'Auto routing';
    if (model.provider === 'groq') return '500+ tok/s';
    if (/reasoner|sonnet|opus|haiku|^o4|glm|pro/.test(id)) return 'Deep Reasoning';
    if (/flash|vision|gpt-5|gpt-oss|gemini/.test(id)) return 'Vision & Tools';
    if (model.provider === 'ollama') return '100% Offline';
    if (model.provider === 'nvidia-nim') return 'Free Tier';
    return 'High Speed';
  };

  // Provider-grouped sections in canonical order; the auto entry stays pinned above all groups.
  // Groups whose provider lacks a credential collapse into the single muted "Not connected"
  // section unless "Show all" flattens the view back into one continuous list.
  const groupedModels = useMemo(() => {
    const rank = (provider: string) => {
      const idx = PROVIDER_ORDER.indexOf(provider);
      return idx === -1 ? PROVIDER_ORDER.length : idx;
    };
    const auto = filteredModels.filter((m) => m.id === 'auto');
    const rest = filteredModels.filter((m) => m.id !== 'auto');
    const groups = new Map<string, FallbackModel[]>();
    for (const m of rest) {
      const key = m.provider || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    const ordered = Array.from(groups.entries()).sort(
      (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])
    );
    const connected = ordered.filter(([provider]) => isProviderConnected(provider));
    const notConnected = ordered.filter(([provider]) => !isProviderConnected(provider));
    return { auto, connected, notConnected, all: ordered };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredModels, configuredKeys, catalogConfigured]);

  const selectedModelDisplayName = activeModel?.name?.startsWith('SUTRA Auto')
    ? activeModel.name.replace('SUTRA Auto', 'Astra Auto')
    : activeModel?.name || 'Astra Auto';

  // Open upward when the trigger sits in the bottom viewport band (composer pills)
  const [openUpward, setOpenUpward] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const handleToggle = () => {
    if (!isOpen) {
      const rect = triggerRef.current?.getBoundingClientRect();
      setOpenUpward(Boolean(rect) && window.innerHeight - (rect as DOMRect).bottom < 440);
    }
    setIsOpen((open) => !open);
  };

  /** One muted row renderer shared by every section */
  const renderModelRow = (model: FallbackModel, opts: { inGroup: boolean }) => {
    const isSelected = (activeModel?.id === model.id && activeModel?.provider === model.provider) || (!activeModel && model.id === 'auto');
    const capabilityTag = getModelCapabilityTag(model);
    const missingKey = needsCredential(model);
    const isSessionModel = model.provider === 'chatgpt-web';

    return (
      <button
        key={`${model.provider}:${model.id}`}
        onClick={() => {
          if (missingKey) {
            // Never attempt an unconfigured provider — route the user to Settings instead
            setIsOpen(false);
            setSettingsOpen(true);
            return;
          }
          setActiveModel(model as OmniModel);
          setIsOpen(false);
        }}
        title={missingKey ? `Add your ${getProviderLabel(model.provider)} API key or cookie in Settings to use this model` : undefined}
        className={`w-full text-left p-2 rounded-lg transition-colors flex items-start justify-between gap-2 cursor-pointer group ${
          isSelected
            ? 'bg-white/15 border border-white/25 text-white'
            : missingKey
              ? 'hover:bg-white/[0.04] text-obsidian-inkMuted border border-transparent'
              : 'hover:bg-white/[0.05] text-obsidian-inkPrimary hover:text-white border border-transparent'
        }`}
      >
        <div className={`min-w-0 flex-1 space-y-0.5 ${missingKey ? 'opacity-70' : ''}`}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[12px] font-medium truncate ${isSelected ? 'text-white font-semibold' : missingKey ? 'text-obsidian-inkSecondary' : 'text-obsidian-inkPrimary'}`}>
              {model.name}
            </span>
            {!opts.inGroup && (
              <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded-full border bg-white/[0.06] text-obsidian-inkSecondary border-white/10">
                {getProviderLabel(model.provider)}
              </span>
            )}
            {isSessionModel && (
              <span
                className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded-full border bg-white/[0.06] text-obsidian-inkSecondary border-white/10"
                title="Runs through your live browser session"
              >
                session
              </span>
            )}
          </div>
          {model.id === 'auto' && chainSummary ? (
            <p className="text-[10px] leading-relaxed line-clamp-1 text-obsidian-inkSecondary">{chainSummary}</p>
          ) : model.description ? (
            <p className={`text-[10px] leading-relaxed line-clamp-1 ${isSelected ? 'text-obsidian-inkPrimary' : 'text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary'}`}>
              {model.description}
            </p>
          ) : null}
          <div className="flex items-center gap-2 pt-0.5">
            {missingKey ? (
              <span className="text-[9px] font-mono text-obsidian-inkMuted">key needed</span>
            ) : !isSessionModel ? (
              <span className="text-[9px] font-mono text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary">
                {capabilityTag}
              </span>
            ) : null}
          </div>
        </div>

        {/* Selection Check Indicator */}
        <div className="pt-1 shrink-0">
          {isSelected ? (
            <div className="w-4 h-4 rounded-full bg-white text-black flex items-center justify-center">
              <Check className="w-2.5 h-2.5 stroke-[3]" />
            </div>
          ) : (
            <div className={`w-4 h-4 rounded-full border transition-colors ${missingKey ? 'border-white/5' : 'border-white/10 group-hover:border-white/30'}`} />
          )}
        </div>
      </button>
    );
  };

  /** A titled provider group */
  const renderGroup = ([provider, models]: [string, FallbackModel[]], mutedHeader = false) => (
    <div key={provider} className="pt-1.5">
      <div className={`px-2 py-1 text-[9px] font-mono uppercase tracking-wider select-none ${mutedHeader ? 'text-obsidian-inkMuted/70' : 'text-obsidian-inkMuted'}`}>
        {getProviderLabel(provider)}
      </div>
      <div className="space-y-1">{models.map((m) => renderModelRow(m, { inGroup: true }))}</div>
    </div>
  );

  return (
    <div ref={triggerRef} className={`relative inline-block ${className}`}>
      {/* Dropdown Trigger Button */}
      {buttonVariant === 'pill' ? (
        <button
          onClick={handleToggle}
          className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-obsidian-inkPrimary hover:text-white font-mono text-[11px] border border-white/10 transition-colors cursor-pointer group"
          title="Switch Active AI Engine & Model"
        >
          <Cpu className="w-3.5 h-3.5 text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary transition-colors" />
          <span className="font-medium max-w-[190px] truncate text-left">
            {selectedModelDisplayName}
          </span>
          <ChevronDown className={`w-3 h-3 text-obsidian-inkSecondary opacity-70 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      ) : buttonVariant === 'compact' ? (
        <button
          onClick={handleToggle}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-obsidian-inkPrimary hover:text-white font-mono text-[10px] border border-white/10 transition-all cursor-pointer truncate max-w-[170px]"
          title="Switch Model"
        >
          <Cpu className="w-3 h-3 text-obsidian-inkSecondary shrink-0" />
          <span className="truncate">{selectedModelDisplayName}</span>
          <ChevronDown className="w-2.5 h-2.5 opacity-60 shrink-0" />
        </button>
      ) : (
        <button
          onClick={handleToggle}
          className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-obsidian-inkPrimary border border-white/10 text-xs font-mono transition-all cursor-pointer"
          title={selectedModelDisplayName}
        >
          <div className="flex items-center gap-2 truncate">
            <Cpu className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
            <span className="truncate max-w-[140px]">
              {selectedModelDisplayName.length > 22
                ? `${selectedModelDisplayName.slice(0, 22).trimEnd()}…`
                : selectedModelDisplayName}
            </span>
          </div>
          <ChevronDown className="w-3 h-3 opacity-60 shrink-0 ml-2" />
        </button>
      )}

      {/* Dropdown Floating Modal */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px]"
            onClick={() => setIsOpen(false)}
          />
          <div
            className={`absolute left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0 w-[340px] sm:w-[380px] bg-obsidian-surface2 border border-obsidian-border rounded-xl shadow-elevation z-50 overflow-hidden font-sans text-xs flex flex-col animate-in fade-in zoom-in-95 duration-150 ${
              openUpward ? 'bottom-full mb-2' : 'top-full mt-2'
            }`}
          >

            {/* Header with Search Bar */}
            <div className="p-2.5 border-b border-white/10 bg-white/[0.02] space-y-2">
              <div className="flex items-center justify-between px-1 text-[11px] font-mono text-obsidian-inkSecondary">
                <span className="font-semibold text-obsidian-inkPrimary flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-obsidian-inkSecondary" />
                  Select AI Engine
                </span>
                <span className="text-[10px] text-obsidian-inkMuted">{connectedCount} of {Math.max(allModels.length - 1, 0)} connected</span>
              </div>

              {/* Live Search Input */}
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-obsidian-inkMuted absolute left-2.5 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models by name, provider, or capability..."
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-all font-mono"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-obsidian-inkSecondary hover:text-white p-0.5 rounded-lg cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Category Quick Filter Pills + Show All toggle */}
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none text-[10px] font-mono">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'groq', label: 'Groq LPU' },
                  { id: 'reasoning', label: 'Reasoning' },
                  { id: 'vision', label: 'Vision' },
                  { id: 'local', label: 'Local' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedCategory(tab.id as CategoryFilter)}
                    className={`px-2 py-0.5 rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                      selectedCategory === tab.id
                        ? 'bg-white text-black font-semibold'
                        : 'bg-white/[0.04] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.08]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                <button
                  onClick={() => setShowAll((v) => !v)}
                  aria-pressed={showAll}
                  className={`ml-auto px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap cursor-pointer ${
                    showAll
                      ? 'bg-white text-black font-semibold border-white'
                      : 'bg-transparent text-obsidian-inkSecondary border-white/10 hover:text-obsidian-inkPrimary hover:border-white/30'
                  }`}
                  title="Flatten the list to show every provider, including ones without credentials"
                >
                  Show all
                </button>
              </div>
            </div>

            {/* Model List Scroll Area — auto pinned first, then availability-grouped sections */}
            <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-1">
              {filteredModels.length === 0 ? (
                <div className="py-8 text-center px-4 space-y-2">
                  <Cpu className="w-6 h-6 text-obsidian-inkMuted mx-auto" />
                  <p className="text-obsidian-inkSecondary text-xs font-mono">No models match "{searchQuery}"</p>
                  <button
                    onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-obsidian-inkPrimary text-[11px] font-mono transition-colors cursor-pointer"
                  >
                    Clear Filter
                  </button>
                </div>
              ) : showAll ? (
                <>
                  {groupedModels.auto.map((m) => renderModelRow(m, { inGroup: false }))}
                  {groupedModels.all.map(([provider, models]) => renderGroup([provider, models], !isProviderConnected(provider)))}
                </>
              ) : (
                <>
                  {groupedModels.auto.map((m) => renderModelRow(m, { inGroup: false }))}

                  {groupedModels.connected.map(([provider, models]) => renderGroup([provider, models]))}

                  {groupedModels.notConnected.length > 0 && (
                    <div className="pt-2 mt-1 border-t border-white/5">
                      <div className="px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-obsidian-inkMuted/80 select-none flex items-center gap-1.5">
                        Not connected
                        <span className="normal-case tracking-normal text-[9px] text-obsidian-inkMuted/70">
                          add a key or cookie in Settings
                        </span>
                      </div>
                      <div className="space-y-1">
                        {groupedModels.notConnected.flatMap(([, models]) => models).map((m) => renderModelRow(m, { inGroup: false }))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer with Settings link */}
            <div className="p-2 border-t border-white/10 bg-white/[0.02] flex items-center justify-between text-[11px] font-mono text-obsidian-inkSecondary">
              <span>Need custom models or keys?</span>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setSettingsOpen(true);
                }}
                className="flex items-center gap-1 text-obsidian-inkPrimary hover:text-white px-2 py-0.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Settings className="w-3 h-3" />
                <span>Settings</span>
              </button>
            </div>

          </div>
        </>
      )}
    </div>
  );
};
