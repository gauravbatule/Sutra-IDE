import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  X,
  RotateCw,
  Sparkles,
  Cpu,
  Pencil,
  Check,
  ChevronDown
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { SutraModel } from '../../types/ide.js';

interface ModelSelectorDropdownProps {
  className?: string;
  buttonVariant?: 'pill' | 'compact' | 'header';
}

export interface FallbackModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  description?: string;
  canonicalId?: string;
  displayName?: string;
  baseUrl?: string;
  isRecommended?: boolean;
  category?: 'llm' | 'image' | 'video' | 'audio' | 'multimodal';
  capabilities?: {
    reasoning?: boolean;
    thinking?: boolean;
    tools?: boolean;
    vision?: boolean;
    audio?: boolean;
    video?: boolean;
    image?: boolean;
  };
  isFree?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

export const DEFAULT_CANONICAL_MODELS: FallbackModel[] = [
  {
    id: 'auto',
    name: 'ASTRA Auto',
    provider: 'sutra',
    description: 'Autonomous multi-model intelligence: routes seamlessly to best verified model.',
    contextWindow: 1048576,
    isRecommended: true,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    contextWindow: 1048576,
    isFree: true,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    contextWindow: 1048576,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    contextWindow: 200000,
    supportsVision: false,
    supportsTools: true,
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'deepseek',
    contextWindow: 64000,
    supportsVision: false,
    supportsTools: true,
  },
  {
    id: 'sarvam-105b',
    name: 'Sarvam 105B (Indic & Code)',
    provider: 'sarvam',
    contextWindow: 32768,
    supportsVision: false,
    supportsTools: true,
  },
  {
    id: 'sarvam-m',
    name: 'Sarvam-M (Indic Foundation)',
    provider: 'sarvam',
    contextWindow: 32768,
    supportsVision: false,
    supportsTools: true,
  },
];

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  className = '',
  buttonVariant = 'pill',
}) => {
  const { activeModel, setActiveModel, availableModels, refreshAvailableModels, setSettingsOpen } = useIDEStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [customDbModels, setCustomDbModels] = useState<FallbackModel[]>([]);

  const triggerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Auto-fetch custom models and catalog from the server
  const fetchCustomModels = useCallback(async () => {
    try {
      const r = await fetch('/api/custom-models');
      const d = await r.json();
      if (d.success && Array.isArray(d.models)) {
        const mapped: FallbackModel[] = d.models.map((m: any) => ({
          id: m.modelId || m.id,
          name: m.name || m.modelId,
          provider: m.providerId || 'custom',
          canonicalId: m.modelId || m.id,
          description: m.description || 'Custom model',
          contextWindow: m.config?.contextWindow || 128000,
          baseUrl: m.config?.baseUrl,
          supportsVision: Boolean(m.config?.supportsVision),
          supportsTools: m.config?.supportsTools !== false,
        }));
        setCustomDbModels(mapped);
      }
    } catch {
      // Ignored
    }
  }, []);

  const handleSyncAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        refreshAvailableModels(),
        fetchCustomModels(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshAvailableModels, fetchCustomModels]);

  // Initial load and periodic auto-updating sync
  useEffect(() => {
    handleSyncAll();
    // Auto-update every 10 seconds so newly added models and keys appear in real time
    const interval = setInterval(handleSyncAll, 10000);
    const onFocus = () => handleSyncAll();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [handleSyncAll]);

  // Consolidate real active, custom, and canonical models without fake modes
  const allRealModels = useMemo<FallbackModel[]>(() => {
    const list: FallbackModel[] = [];

    // 1. ASTRA Auto (Autonomous Router)
    list.push({
      id: 'auto',
      name: 'ASTRA Auto',
      provider: 'sutra',
      isRecommended: true,
      description: 'Auto routes to optimal working model',
      contextWindow: 1048576,
      supportsVision: true,
      supportsTools: true,
    });

    // 2. Custom & OpenRouter models from database (e.g. nemo, Sarvam)
    if (customDbModels.length > 0) {
      customDbModels.forEach((cm) => {
        if (!list.some((m) => m.id === cm.id)) {
          list.push(cm);
        }
      });
    }

    // 3. User's currently active model if not already present
    if (activeModel && !list.some((m) => m.id === activeModel.id)) {
      list.push({
        id: activeModel.id,
        name: activeModel.name || activeModel.id,
        provider: activeModel.provider || 'custom',
        contextWindow: activeModel.contextWindow || 128000,
        supportsVision: Boolean(activeModel.supportsVision),
        supportsTools: activeModel.supportsTools !== false,
      });
    }

    // 4. Real models from available catalog or canonical fallbacks
    const source = availableModels && availableModels.length > 0 ? availableModels : DEFAULT_CANONICAL_MODELS;
    source.forEach((m) => {
      if (m.id !== 'auto' && !list.some((x) => x.id === m.id)) {
        list.push({
          id: m.id,
          name: m.name || m.id,
          provider: m.provider || 'custom',
          contextWindow: m.contextWindow || 128000,
          description: m.description,
          isFree: (m as any).isFree,
          isRecommended: (m as any).isRecommended,
          supportsVision: (m as any).supportsVision,
          supportsTools: (m as any).supportsTools,
        });
      }
    });

    return list;
  }, [customDbModels, activeModel, availableModels]);

  // Filter models based on search query
  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return allRealModels;
    const q = searchQuery.toLowerCase().trim();
    return allRealModels.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q))
    );
  }, [allRealModels, searchQuery]);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') return null;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const width = Math.min(300, viewportWidth - 24);
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openAbove = spaceBelow < 380 && spaceAbove > spaceBelow;

    let left = rect.left;
    if (rect.right > viewportWidth / 2) {
      left = Math.max(12, rect.right - width);
    } else if (left + width > viewportWidth - 12) {
      left = Math.max(12, viewportWidth - width - 12);
    }
    if (left < 12) left = 12;

    if (openAbove) {
      return {
        bottom: viewportHeight - rect.top + 6,
        left,
        width,
        maxHeight: Math.min(480, spaceAbove - 16),
      };
    } else {
      return {
        top: rect.bottom + 6,
        left,
        width,
        maxHeight: Math.min(480, spaceBelow - 16),
      };
    }
  }, []);

  const updatePosition = useCallback(() => {
    const pos = calculatePosition();
    if (pos) setCoords(pos);
  }, [calculatePosition]);

  useEffect(() => {
    if (isOpen) {
      handleSyncAll();
      updatePosition();
      const onResize = () => updatePosition();
      const onScroll = () => updatePosition();
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setIsOpen(false);
      };
      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('keydown', onKeyDown);

      // Auto-focus search input
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);

      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('keydown', onKeyDown);
      };
    } else {
      setSearchQuery('');
    }
  }, [isOpen, updatePosition, handleSyncAll]);

  const handleToggle = () => {
    if (!isOpen) {
      const pos = calculatePosition();
      if (pos) setCoords(pos);
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  const handleOpenSearch = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen) {
      const pos = calculatePosition();
      if (pos) setCoords(pos);
      setIsOpen(true);
    }
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleSelectModel = (model: FallbackModel) => {
    const sutraModel: SutraModel = {
      id: model.id,
      name: model.name,
      provider: model.provider,
      contextWindow: model.contextWindow || 128000,
      supportsVision: model.supportsVision !== false,
      supportsTools: model.supportsTools !== false,
      description: model.description || '',
    };
    setActiveModel(sutraModel);

    // Notify backend router immediately
    fetch('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: model.id,
        provider: model.provider,
        fullId: `${model.provider}:${model.id}`,
      }),
    }).catch(() => undefined);

    setIsOpen(false);
  };

  const displayedTriggerName = activeModel?.name || (activeModel?.id === 'auto' ? 'ASTRA Auto' : 'ASTRA Auto');

  const getProviderBadge = (provider: string) => {
    if (!provider || provider === 'sutra') return 'Auto';
    if (provider === 'google') return 'Google';
    if (provider === 'openai') return 'OpenAI';
    if (provider === 'anthropic') return 'Anthropic';
    if (provider === 'deepseek') return 'DeepSeek';
    if (provider === 'openrouter') return 'OpenRouter';
    if (provider === 'custom') return 'Custom';
    return provider.split('-')[0];
  };

  const formatContextWindow = (tokens?: number) => {
    if (!tokens || tokens <= 0) return null;
    if (tokens >= 1000000) return `${Math.round(tokens / 1000000)}M`;
    return `${Math.round(tokens / 1000)}k`;
  };

  return (
    <div ref={triggerRef} className={`relative inline-flex items-center gap-1 ${className}`}>
      {/* Dropdown Trigger Button */}
      {buttonVariant === 'pill' ? (
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggle}
            aria-expanded={isOpen}
            className="flex items-center gap-1.5 px-2.5 h-7.5 rounded-lg bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary font-sans text-xs border border-obsidian-hairline hover:border-obsidian-border transition-all cursor-pointer group select-none active:scale-[0.98]"
            title="Switch AI model"
          >
            <Cpu className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
            <span className="font-medium max-w-[140px] truncate text-left text-obsidian-inkPrimary">
              {displayedTriggerName}
            </span>
            <ChevronDown
              className={`w-3 h-3 text-obsidian-inkMuted transition-transform duration-200 shrink-0 ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
          <button
            type="button"
            onClick={handleOpenSearch}
            className="flex items-center justify-center w-7.5 h-7.5 rounded-lg bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline hover:border-obsidian-border transition-all cursor-pointer select-none active:scale-95"
            title="Search AI models"
            aria-label="Search AI models"
          >
            <Search className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
          </button>
        </div>
      ) : buttonVariant === 'compact' ? (
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggle}
            aria-expanded={isOpen}
            className="flex items-center gap-1.5 px-2 h-7 rounded-md bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary font-sans text-xs border border-obsidian-hairline hover:border-obsidian-border transition-all cursor-pointer truncate max-w-[160px] select-none"
            title="Switch Model"
          >
            <Cpu className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
            <span className="truncate text-[11px] font-medium text-obsidian-inkPrimary">
              {displayedTriggerName}
            </span>
            <ChevronDown className="w-3 h-3 text-obsidian-inkMuted shrink-0" />
          </button>
          <button
            type="button"
            onClick={handleOpenSearch}
            className="flex items-center justify-center w-7 h-7 rounded-md bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline hover:border-obsidian-border transition-all cursor-pointer select-none"
            title="Search models"
            aria-label="Search models"
          >
            <Search className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={isOpen}
          className="flex items-center justify-between w-full px-3 h-8 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkPrimary border border-obsidian-hairline hover:border-obsidian-border text-xs font-sans transition-all cursor-pointer"
          title={displayedTriggerName}
        >
          <div className="flex items-center gap-2 truncate">
            <Cpu className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
            <span className="truncate max-w-[180px] font-medium">{displayedTriggerName}</span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0 ml-2" />
        </button>
      )}

      {/* Floating Dropdown Popover via createPortal */}
      {isOpen && coords && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] pointer-events-auto select-none font-sans">
          {/* Transparent click-away backdrop (no dark dimming overlay) */}
          <div
            className="fixed inset-0 bg-transparent"
            onClick={() => setIsOpen(false)}
          />

          {/* Floating Dropdown Menu */}
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: coords.top !== undefined ? `${coords.top}px` : 'auto',
              bottom: coords.bottom !== undefined ? `${coords.bottom}px` : 'auto',
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
            }}
            className="bg-obsidian-surface1 border border-obsidian-border rounded-2xl shadow-2xl p-1.5 text-xs flex flex-col anim-fade-in z-[10000] backdrop-blur-xl overflow-hidden"
          >
            {/* Search Bar & Auto-Update Indicator */}
            <div className="p-1 border-b border-obsidian-hairline mb-1 space-y-1">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-obsidian-inkMuted absolute left-2.5 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models or providers..."
                  className="w-full bg-obsidian-surface2 border border-obsidian-hairline focus:border-obsidian-borderBright rounded-xl pl-8 pr-14 py-1 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none transition-all font-mono"
                />
                <div className="absolute right-1.5 flex items-center gap-1">
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary cursor-pointer"
                      title="Clear search"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSyncAll}
                    disabled={isRefreshing}
                    className="p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary cursor-pointer"
                    title="Refresh models & status"
                  >
                    <RotateCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between px-1 text-[9.5px] font-mono text-obsidian-inkMuted">
                <span>{filteredModels.length} models available</span>
                {isRefreshing && <span className="text-cyan-400">updating…</span>}
              </div>
            </div>

            {/* Models List Scroll Area */}
            <div className="overflow-y-auto space-y-0.5 max-h-[380px] scrollbar-none">
              {filteredModels.length === 0 ? (
                <div className="py-6 text-center text-obsidian-inkMuted font-mono text-[11px]">
                  No models matching "{searchQuery}"
                </div>
              ) : (
                filteredModels.map((model) => {
                  const isSelected =
                    activeModel?.id === model.id ||
                    (!activeModel && model.id === 'auto');
                  const contextStr = formatContextWindow(model.contextWindow);

                  return (
                    <button
                      key={`${model.provider}-${model.id}`}
                      type="button"
                      onClick={() => handleSelectModel(model)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-colors cursor-pointer select-none text-left ${
                        isSelected
                          ? 'bg-obsidian-surface2 text-obsidian-inkPrimary font-medium'
                          : 'hover:bg-obsidian-surface2/70 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-1">
                        {model.id === 'auto' ? (
                          <Sparkles className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />
                        ) : (
                          <Cpu className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
                        )}
                        <span className="truncate text-[12px] font-medium">{model.name}</span>
                        {model.isRecommended && (
                          <span className="px-1.5 py-0.2 rounded-full text-[8.5px] font-mono bg-obsidian-surface3 text-obsidian-inkSecondary border border-obsidian-border shrink-0">
                            Auto
                          </span>
                        )}
                        {contextStr && (
                          <span className="px-1 py-0.2 rounded text-[8.5px] font-mono bg-obsidian-surface2 text-obsidian-inkMuted border border-obsidian-hairline shrink-0">
                            {contextStr}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] text-obsidian-inkMuted uppercase">
                        <span>{getProviderBadge(model.provider)}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-obsidian-inkPrimary stroke-[2.5] ml-0.5" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Bottom divider and Configure custom models button */}
            <div className="border-t border-obsidian-hairline my-1 shrink-0" />
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setSettingsOpen(true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-xs transition-colors cursor-pointer select-none text-left group"
            >
              <Pencil className="w-3.5 h-3.5 text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary shrink-0" />
              <span className="text-[11.5px] font-medium">Configure custom models</span>
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
