import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Key,
  Server,
  CheckCircle2,
  AlertCircle,
  Zap,
  Cpu,
  Plus,
  Check,
  Loader2,
  Sliders,
  Radio,
  ExternalLink,
  Eye,
  EyeOff,
  Search,
  Cookie as CookieIcon,
  Trash2,
  Film,
  Volume2,
  Info,
  RefreshCw,
  Image as ImageIcon
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface ProviderCatalogItem {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  authTypes: Array<'api-key' | 'cookie' | 'oauth' | 'local' | 'none'>;
  badge: string;
  description: string;
  website: string;
  docUrl?: string;
  cookieHint?: string;
  cookieFields?: string[];
  placeholder?: string;
  defaultBaseUrl?: string;
  supportsTools?: boolean;
  supportsVision?: boolean;
  isConfigured?: boolean;
  savedAuthType?: string;
  hasApiKey?: boolean;
  hasCookie?: boolean;
  savedApiKeyPreview?: string | null;
  savedCookiePreview?: string | null;
  savedBaseUrl?: string;
  status?: string;
}

/** Connected-model priority list with drag reordering (persisted to localStorage). */
const RoutingPriorityList: React.FC = () => {
  const availableModels = useIDEStore((s) => s.availableModels);
  const [connected, setConnected] = useState<Record<string, boolean> | null>(null);
  const [priorityIds, setPriorityIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('sutra-model-priority');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((v: unknown) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  });
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    fetch('/api/providers/catalog')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.providers)) {
          const map: Record<string, boolean> = {};
          for (const p of d.providers) map[p.id] = Boolean(p.isConfigured);
          setConnected(map);
        }
      })
      .catch(() => undefined);
  }, []);

  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ key: string; id: string; name: string; provider: string }> = [];
    for (const m of availableModels) {
      if (m.id === 'auto' || m.provider === 'sutra') continue;
      const key = `${m.provider}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, id: m.id, name: m.name, provider: m.provider });
    }
    // Priority-ordered first, then the rest in catalog order
    const rank = new Map(priorityIds.map((id, i) => [id, i]));
    out.sort((a, b) => (rank.get(a.key) ?? 9999) - (rank.get(b.key) ?? 9999));
    const connectedOnly = out.filter((m) => connected === null || connected[m.provider]);
    return connectedOnly;
  }, [availableModels, priorityIds, connected]);

  const persist = (next: string[]) => {
    setPriorityIds(next);
    try {
      localStorage.setItem('sutra-model-priority', JSON.stringify(next));
    } catch {
      // In-memory only when storage is unavailable
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= candidates.length) return;
    const ids = candidates.map((c) => c.key);
    const ordered = [...ids];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    persist(ordered);
  };

  if (candidates.length === 0) {
    return <p className="text-[11px] text-obsidian-inkMuted">Connect a provider first — your models will appear here for prioritization.</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-[11px] text-obsidian-inkMuted">
        Drag to set the order the auto chain tries your models. Top = tried first.
      </p>
      {candidates.map((model, index) => (
        <div
          key={model.key}
          draggable
          onDragStart={() => {
            dragIndex.current = index;
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIndex.current !== null) move(dragIndex.current, index);
            dragIndex.current = null;
          }}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline cursor-grab active:cursor-grabbing select-none"
        >
          <span className="text-[10px] font-mono text-obsidian-inkMuted w-5 text-center">{index + 1}</span>
          <span className="flex-1 min-w-0 truncate text-xs text-obsidian-inkPrimary">{model.name}</span>
          <span className="text-[9px] font-mono uppercase tracking-wider text-obsidian-inkMuted">{model.provider}</span>
        </div>
      ))}
    </div>
  );
};

/** Update channel: compares the running version against <origin>/version.json. */
const UpdateCheckRow: React.FC = () => {
  const [state, setState] = useState<{ current: string; latest: string | null; updateAvailable: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    fetch('/api/update/check')
      .then((r) => r.json())
      .then((d) => setState(d))
      .catch(() => setState(null))
      .finally(() => setChecking(false));
  };

  return (
    <div className="flex items-center justify-between p-3 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg">
      <div>
        <div className="font-semibold text-obsidian-inkPrimary text-xs">Updates</div>
        <div className="text-[11px] text-obsidian-inkMuted">
          {state
            ? state.updateAvailable
              ? `Update available — download it from the project website.`
              : 'You are on the latest version.'
            : 'Check against the published version manifest.'}
        </div>
        <a
          href="https://buymeacoffee.com/gauravbatule"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-300/90 hover:text-amber-200 underline underline-offset-2 decoration-amber-400/30 transition-colors"
        >
          Support the project — Buy me a coffee
        </a>
      </div>
      <button
        type="button"
        onClick={check}
        disabled={checking}
        className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-[11px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer disabled:opacity-50"
      >
        {checking ? 'Checking…' : 'Check for updates'}
      </button>
    </div>
  );
};

export const SettingsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { isSettingsOpen, setSettingsOpen, setAvailableModels } = useIDEStore();
  const [activeTab, setActiveTab] = useState<'providers' | 'routing' | 'local' | 'custom' | 'media' | 'mcp' | 'about'>('providers');
  const [providers, setProviders] = useState<ProviderCatalogItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Per-provider form state
  const [activeAuthMode, setActiveAuthMode] = useState<Record<string, 'api-key' | 'cookie' | 'oauth'>>({});
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [providerCookies, setProviderCookies] = useState<Record<string, string>>({});
  const [providerBaseUrls, setProviderBaseUrls] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; latencyMs?: number; error?: string }>>({});

  // Local Scanner State
  const [isScanningLocal, setIsScanningLocal] = useState(false);
  const [detectedLocalModels, setDetectedLocalModels] = useState<{ ollama: string[]; lmstudio: string[] }>({
    ollama: [],
    lmstudio: [],
  });

  // Custom Modality Models Form State
  const [customModelId, setCustomModelId] = useState('');
  const [customModelName, setCustomModelName] = useState('');
  const [customModelCategory, setCustomModelCategory] = useState<'image' | 'video' | 'audio' | 'llm'>('image');
  const [customModelProvider, setCustomModelProvider] = useState('replicate');
  const [customModelDescription, setCustomModelDescription] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customSupportsVision] = useState(false);
  const [customSupportsTools] = useState(true);
  const [addingCustom, setAddingCustom] = useState(false);
  const [customModelError, setCustomModelError] = useState('');
  const [savedCustomModels, setSavedCustomModels] = useState<any[]>([]);

  // About tab: app version + update check (plain text result, never auto-downloads)
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'up-to-date' | 'available' | 'error'>('idle');
  const [updateMessage, setUpdateMessage] = useState('');

  // Custom MCP Form State
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'stdio' | 'sse' | 'http'>('stdio');
  const [newMcpCommand, setNewMcpCommand] = useState('');
  const [newMcpArgs, setNewMcpArgs] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpDescription, setNewMcpDescription] = useState('');
  const [addingMcp, setAddingMcp] = useState(false);

  // Fallback & Routing Config (persisted locally; server reads its own defaults)
  interface RoutingConfig {
    retryAttempts: number;
    autoCompactEnabled: boolean;
    autoCompactThreshold: number;
    tpmBudget: number;
  }
  const [routingConfig, setRoutingConfig] = useState<RoutingConfig>(() => {
    try {
      const saved = localStorage.getItem('sutra-routing-config');
      if (saved) {
        return { retryAttempts: 8, autoCompactEnabled: true, autoCompactThreshold: 80, tpmBudget: 4800, ...JSON.parse(saved) };
      }
    } catch {
      // Fall through to defaults
    }
    return { retryAttempts: 8, autoCompactEnabled: true, autoCompactThreshold: 80, tpmBudget: 4800 };
  });

  const shouldShow = isOpen || isSettingsOpen;

  const updateRoutingConfig = (patch: Partial<typeof routingConfig>) => {
    setRoutingConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('sutra-routing-config', JSON.stringify(next));
      } catch {
        // Storage may be unavailable; in-session state still applies
      }
      return next;
    });
  };

  const fetchCustomModelsAndMcp = async () => {
    try {
      const [modRes, mcpRes] = await Promise.all([
        fetch('/api/custom-models').then((r) => r.json()).catch(() => ({ models: [] })),
        fetch('/api/mcp/servers').then((r) => r.json()).catch(() => ({ servers: [] })),
      ]);
      if (modRes.models) setSavedCustomModels(modRes.models);
      if (mcpRes.servers) setMcpServers(mcpRes.servers);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCatalog = async () => {
    try {
      const res = await fetch('/api/providers/catalog');
      const data = await res.json();
      if (data.providers) {
        setProviders(data.providers);

        // Secrets are never prefilled — the server only returns masked previews.
        // Only the base URL (not a secret) hydrates the form.
        const newUrls: Record<string, string> = {};
        const newAuthModes: Record<string, 'api-key' | 'cookie' | 'oauth'> = {};

        for (const p of data.providers) {
          if (p.savedBaseUrl) newUrls[p.id] = p.savedBaseUrl;
          newAuthModes[p.id] = (p.savedAuthType as any) || (p.authTypes.includes('cookie') && !p.authTypes.includes('api-key') ? 'cookie' : 'api-key');
        }

        setProviderBaseUrls((prev) => ({ ...newUrls, ...prev }));
        setActiveAuthMode((prev) => ({ ...newAuthModes, ...prev }));
      }
    } catch (e) {
      console.error('Failed to load provider catalog:', e);
    }
  };

  const fetchAppVersion = async () => {
    try {
      const res = await fetch('/api/version');
      const data = await res.json();
      if (data.version) setAppVersion(String(data.version));
    } catch {
      // Version display stays blank on failure — never blocks the modal
    }
  };

  const handleCheckForUpdates = async () => {
    setUpdateState('checking');
    setUpdateMessage('');
    try {
      const res = await fetch('/api/update/check');
      if (!res.ok) throw new Error(`Update check failed (${res.status})`);
      const data = await res.json();
      const latest = data.latest ?? data.latestVersion ?? data.currentVersion ?? data.version;
      if (data.updateAvailable) {
        setUpdateState('available');
        setUpdateMessage(`Update available: ${latest || 'newer version'} — download from the website.`);
      } else {
        setUpdateState('up-to-date');
        setUpdateMessage('Up to date.');
      }
    } catch (err: any) {
      setUpdateState('error');
      setUpdateMessage(err?.message ? `Could not check for updates: ${err.message}` : 'Could not check for updates.');
    }
  };

  useEffect(() => {
    if (shouldShow) {
      // Always land on Providers & Keys when the modal opens (e.g. from the setup gate)
      setActiveTab('providers');
      fetchCatalog();
      fetchCustomModelsAndMcp();
      fetchAppVersion();
    }
  }, [shouldShow]);

  if (!shouldShow) return null;

  const handleClose = () => {
    setSettingsOpen(false);
    onClose();
  };

  const handleSaveProvider = async (providerId: string) => {
    setSyncing(true);
    const authType = activeAuthMode[providerId] || 'api-key';
    // Only send fields the user actually entered — empty/absent fields preserve
    // what is already stored server-side (the form never sees raw secrets).
    const apiKey = (providerKeys[providerId] || '').trim();
    const cookieData = (providerCookies[providerId] || '').trim();
    const baseUrl = (providerBaseUrls[providerId] || '').trim();

    try {
      const res = await fetch('/api/providers/save-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          authType,
          ...(apiKey ? { apiKey } : {}),
          ...(cookieData ? { cookieData } : {}),
          ...(baseUrl ? { baseUrl } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Drop typed secrets from local state immediately — previews come from the catalog
        setProviderKeys((prev) => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
        setProviderCookies((prev) => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
        setStatusMessage({ text: `Saved credentials for ${providerId}`, type: 'success' });
        fetchCatalog();
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (e: any) {
      setStatusMessage({ text: `Error: ${e.message}`, type: 'error' });
    } finally {
      setSyncing(false);
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    try {
      // First save current inputs
      await handleSaveProvider(providerId);

      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [providerId]: { ok: data.ok, latencyMs: data.latencyMs, error: data.error },
      }));
    } catch (e: any) {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: { ok: false, error: e.message },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  const handleScanLocal = async () => {
    setIsScanningLocal(true);
    try {
      const res = await fetch('/api/models/scan-local', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.results) {
        setDetectedLocalModels({
          ollama: data.results.ollama?.models || [],
          lmstudio: data.results.lmstudio?.models || [],
        });
        if (data.allModels) setAvailableModels(data.allModels);
        const total = (data.results.ollama?.models?.length || 0) + (data.results.lmstudio?.models?.length || 0);
        setStatusMessage({
          text: `Local scan completed: Found ${total} active models.`,
          type: 'success',
        });
      }
    } catch (err: any) {
      setStatusMessage({ text: `Scan error: ${err.message}`, type: 'error' });
    } finally {
      setIsScanningLocal(false);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const categories = [
    { id: 'all', label: `All Providers (${providers.length || '—'})` },
    { id: 'frontier', label: 'Frontier Labs' },
    { id: 'web-cookie', label: 'Web Session Cookies' },
    { id: 'inference-hosts', label: 'Inference Hosts' },
    { id: 'regional', label: 'Regional AI' },
    { id: 'enterprise-cloud', label: 'Enterprise Cloud' },
    { id: 'media-audio', label: 'Media & Voice' },
    { id: 'local-free', label: 'Local & Free' },
  ];

  const filteredProviders = providers.filter((p) => {
    const matchesCat = selectedCategory === 'all' || p.category === selectedCategory;
    const matchesSearch = 
      !searchQuery.trim() || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.badge.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-in fade-in select-none">
      <div className="w-full max-w-6xl h-[92vh] bg-obsidian-surface1 border border-obsidian-hairline rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="h-14 bg-obsidian-surface1 border-b border-obsidian-hairline flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkPrimary">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-obsidian-inkPrimary flex items-center gap-2">
                Providers & Authentication
                <span className="text-[10px] font-mono text-obsidian-inkMuted bg-obsidian-surface2 border border-obsidian-hairline px-2 py-0.5 rounded-full font-normal">
                  {providers.length ? `${providers.length} Providers` : 'Providers'}
                </span>
              </h2>
              <p className="text-[11px] text-obsidian-inkMuted">
                Configure API keys, web session cookies, OAuth, and local endpoints.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {statusMessage && (
              <span className={`text-xs font-mono px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${
                statusMessage.type === 'success'
                  ? 'bg-obsidian-surface2 text-obsidian-inkSecondary border-obsidian-hairline'
                  : 'bg-red-950/40 text-red-300 border-red-800/60'
              }`}>
                {statusMessage.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-obsidian-inkSecondary" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {statusMessage.text}
              </span>
            )}
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 pt-2 border-b border-obsidian-hairline bg-obsidian-surface2/40 text-xs font-medium shrink-0 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('providers')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'providers'
                ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold'
                : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            Providers & Keys
          </button>

          <button
            onClick={() => setActiveTab('routing')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'routing'
                ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold'
                : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Routing & Failovers
          </button>

          <button
            onClick={() => setActiveTab('local')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'local'
                ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold'
                : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Local Model Discovery
          </button>

          <button
            onClick={() => setActiveTab('custom')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'custom'
                ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold'
                : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            Custom Endpoints
          </button>

          <button
            onClick={() => setActiveTab('mcp')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'mcp'
                ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold'
                : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
          <Server className="w-3.5 h-3.5" />
            MCP Client
          </button>

          <button
            onClick={() => setActiveTab('about')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'about'
                ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold'
                : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            About
          </button>
        </div>

        {/* Main Panel Content */}
        <div className="flex-1 p-6 overflow-y-auto bg-obsidian-canvas text-xs space-y-6">
          {/* TAB 1: 159+ PROVIDERS WITH COOKIE + API KEY + OAUTH */}
          {activeTab === 'providers' && (
            <div className="space-y-4 max-w-5xl mx-auto">
              {/* Category Filter & Search Bar */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-3 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        selectedCategory === cat.id
                          ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-bold'
                          : 'bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline hover:bg-obsidian-surface2'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[240px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-obsidian-inkMuted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search providers, models..."
                    className="w-full pl-8 pr-3 py-1.5 bg-obsidian-surface1 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
                  />
                </div>
              </div>

              {/* Provider Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredProviders.map((prov) => {
                  const currentMode = activeAuthMode[prov.id] || (prov.authTypes.includes('cookie') && !prov.authTypes.includes('api-key') ? 'cookie' : 'api-key');
                  const currentKey = providerKeys[prov.id] || '';
                  const currentCookie = providerCookies[prov.id] || '';
                  const currentUrl = providerBaseUrls[prov.id] || '';
                  const isRevealed = revealedKeys[prov.id];
                  const testRes = testResults[prov.id];
                  const isTesting = testingProvider === prov.id;

                  return (
                    <div
                      key={prov.id}
                      className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl flex flex-col justify-between space-y-3 hover:border-obsidian-border transition-colors shadow-sm"
                    >
                      <div>
                        {/* Header: Title & Badges */}
                        <div className="flex items-start justify-between mb-1.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-obsidian-inkPrimary text-sm">{prov.name}</span>
                              <span className="text-[9px] font-mono text-obsidian-inkMuted bg-obsidian-surface2 px-2 py-0.5 rounded-full border border-obsidian-hairline">
                                {prov.badge}
                              </span>
                            </div>
                            <span className="text-[10px] text-obsidian-inkMuted font-mono">{prov.categoryLabel}</span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {prov.docUrl && (
                              <a
                                href={prov.docUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-obsidian-inkMuted hover:text-obsidian-inkPrimary flex items-center gap-1 transition-colors"
                              >
                                Docs <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                        </div>

                        <p className="text-[11px] text-obsidian-inkMuted leading-relaxed">{prov.description}</p>
                      </div>

                      {/* Multi-Auth Mode Switcher (API Key vs Cookie vs OAuth) */}
                      <div className="space-y-2.5 pt-2 border-t border-obsidian-hairline/60">
                        {prov.authTypes.length > 1 && (
                          <div className="flex items-center gap-1 bg-obsidian-surface2 p-0.5 rounded-lg border border-obsidian-hairline w-fit">
                            {prov.authTypes.includes('api-key') && (
                              <button
                                onClick={() => setActiveAuthMode({ ...activeAuthMode, [prov.id]: 'api-key' })}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer ${
                                  currentMode === 'api-key'
                                    ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-bold shadow-xs'
                                    : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                                }`}
                              >
                                <Key className="w-3 h-3" /> API Key
                              </button>
                            )}

                            {prov.authTypes.includes('cookie') && (
                              <button
                                onClick={() => setActiveAuthMode({ ...activeAuthMode, [prov.id]: 'cookie' })}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer ${
                                  currentMode === 'cookie'
                                    ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-bold shadow-xs'
                                    : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                                }`}
                              >
                                <CookieIcon className="w-3 h-3" /> Cookie Session
                              </button>
                            )}

                            {prov.authTypes.includes('oauth') && (
                              <button
                                onClick={() => setActiveAuthMode({ ...activeAuthMode, [prov.id]: 'oauth' })}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer ${
                                  currentMode === 'oauth'
                                    ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-bold shadow-xs'
                                    : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                                }`}
                              >
                                <Zap className="w-3 h-3" /> OAuth Login
                              </button>
                            )}
                          </div>
                        )}

                        {/* MODE 1: API KEY INPUT */}
                        {currentMode === 'api-key' && (
                          <div className="space-y-1">
                            <div className="relative flex items-center">
                              <input
                                type={isRevealed ? 'text' : 'password'}
                                value={currentKey}
                                onChange={(e) => setProviderKeys({ ...providerKeys, [prov.id]: e.target.value })}
                                placeholder={
                                  prov.hasApiKey
                                    ? `Saved ${prov.savedApiKeyPreview || ''} — paste to replace`
                                    : prov.placeholder || 'Paste API Key (sk-...)'
                                }
                                className="w-full pl-3 pr-10 py-1.5 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
                              />
                              <button
                                type="button"
                                onClick={() => setRevealedKeys({ ...revealedKeys, [prov.id]: !isRevealed })}
                                className="absolute right-2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary p-1"
                              >
                                {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                            {currentKey.trim() !== '' && (
                              <p className="text-[9px] font-mono text-obsidian-inkMuted px-0.5">
                                New key replaces the saved one on Save.
                              </p>
                            )}
                          </div>
                        )}

                        {/* MODE 2: COOKIE SESSION INPUT */}
                        {currentMode === 'cookie' && (
                          <div className="space-y-1.5">
                            <div className="p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-[10px] text-obsidian-inkSecondary">
                              <p className="font-semibold flex items-center gap-1 text-obsidian-inkPrimary">
                                <CookieIcon className="w-3 h-3" /> Cookie Authentication
                              </p>
                              <p className="text-obsidian-inkMuted mt-0.5">
                                {prov.cookieHint || 'Paste your web session cookies or __Secure-next-auth.session-token from DevTools.'}
                              </p>
                            </div>
                            <textarea
                              value={currentCookie}
                              onChange={(e) => setProviderCookies({ ...providerCookies, [prov.id]: e.target.value })}
                              placeholder={
                                prov.hasCookie
                                  ? `Saved ${prov.savedCookiePreview || ''} — paste to replace`
                                  : 'Paste cookie line (e.g. __Secure-next-auth.session-token=eyJ...; cf_clearance=...)'
                              }
                              rows={2}
                              className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent resize-none"
                            />
                            {currentCookie.trim() !== '' && (
                              <p className="text-[9px] font-mono text-obsidian-inkMuted px-0.5">
                                New cookies replace the saved session on Save.
                              </p>
                            )}
                          </div>
                        )}

                        {/* MODE 3: OAUTH LOGIN */}
                        {currentMode === 'oauth' && (
                          <div className="p-3 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg space-y-2">
                            <div>
                              <div className="font-semibold text-obsidian-inkPrimary text-xs">Sign-in via Browser</div>
                              <p className="text-[10px] text-obsidian-inkMuted">
                                Opens {prov.name} in your browser. Sign in there, then copy your session cookie and paste it below —
                                this studio connects through the session, not a popup handshake.
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <a
                                href={prov.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 bg-obsidian-inkPrimary hover:bg-obsidian-accentHover text-obsidian-canvas font-bold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer text-xs"
                              >
                                <ExternalLink className="w-3 h-3" /> Open {prov.name}
                              </a>
                              {prov.authTypes.includes('cookie') && (
                                <button
                                  type="button"
                                  onClick={() => setActiveAuthMode({ ...activeAuthMode, [prov.id]: 'cookie' })}
                                  className="px-3 py-1.5 border border-obsidian-hairline bg-obsidian-surface1 hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer text-xs"
                                >
                                  <CookieIcon className="w-3 h-3" /> Paste session cookie instead
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* MODE 4: LOCAL RUNTIME */}
                        {prov.authTypes.includes('local') && currentMode !== 'api-key' && currentMode !== 'cookie' && (
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              value={currentUrl || prov.defaultBaseUrl || ''}
                              onChange={(e) => setProviderBaseUrls({ ...providerBaseUrls, [prov.id]: e.target.value })}
                              placeholder={prov.defaultBaseUrl}
                              className="w-full pl-3 pr-3 py-1.5 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
                            />
                          </div>
                        )}

                        {/* Action Footer: Save & Test Connection */}
                        <div className="flex items-center justify-between pt-1 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleSaveProvider(prov.id)}
                              disabled={syncing}
                              className="px-2.5 py-1 bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkPrimary rounded-lg border border-obsidian-hairline font-mono flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              <span>Save</span>
                            </button>

                            <button
                              onClick={() => handleTestConnection(prov.id)}
                              disabled={isTesting}
                              className="px-2.5 py-1 bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary rounded-lg border border-obsidian-hairline font-mono flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                              <span>Test Ping</span>
                            </button>
                          </div>

                          {testRes && (
                            <span className={`font-mono text-[10px] flex items-center gap-1 ${
                              testRes.ok ? 'text-obsidian-inkPrimary' : 'text-red-400'
                            }`}>
                              {testRes.ok ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3 text-obsidian-inkSecondary" />
                                  <span>{testRes.latencyMs}ms</span>
                                </>
                              ) : (
                                <>
                                  <AlertCircle className="w-3 h-3" />
                                  <span className="truncate max-w-[130px]">{testRes.error || 'Failed'}</span>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: ROUTING & AUTONOMOUS FAILOVER */}
          {activeTab === 'routing' && (
            <div className="max-w-2xl mx-auto space-y-5">
              <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-4">
                <h3 className="font-bold text-obsidian-inkPrimary text-sm flex items-center gap-2">
                  <Radio className="w-4 h-4 text-obsidian-inkPrimary" />
                  Routing & Fallback Policies
                </h3>

                <div className="space-y-3 pt-2">
                  <div className="p-3 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg">
                    <div className="font-semibold text-obsidian-inkPrimary">Automatic Failover</div>
                    <div className="text-[11px] text-obsidian-inkMuted">
                      Always active. When a provider fails or rate-limits, the request retries (up to 8 attempts)
                      and hands off across your connected providers — announced live in the thinking trace and the
                      Activity network log.
                    </div>
                  </div>

                  <div className="space-y-1.5 p-3 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-obsidian-inkPrimary">Retry attempts per request</span>
                      <span className="font-mono text-obsidian-inkSecondary">{routingConfig.retryAttempts}</span>
                    </div>
                    <p className="text-[11px] text-obsidian-inkMuted">
                      Total attempts across your available models before an honest failure (4-10).
                    </p>
                    <input
                      type="range"
                      min="4"
                      max="10"
                      step="1"
                      value={routingConfig.retryAttempts}
                      onChange={(e) => updateRoutingConfig({ retryAttempts: Number(e.target.value) })}
                      className="w-full accent-obsidian-accentHover cursor-pointer mt-2"
                    />
                  </div>

                  <div className="space-y-1.5 p-3 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-obsidian-inkPrimary">Auto-compact context</span>
                      <label className="flex items-center gap-2 text-[11px] font-mono text-obsidian-inkSecondary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={routingConfig.autoCompactEnabled}
                          onChange={(e) => updateRoutingConfig({ autoCompactEnabled: e.target.checked })}
                          className="w-4 h-4 accent-obsidian-accentHover cursor-pointer"
                        />
                        {routingConfig.autoCompactEnabled ? 'On' : 'Off'}
                      </label>
                    </div>
                    <p className="text-[11px] text-obsidian-inkMuted">
                      When a conversation reaches this share of the model's context window, older messages are
                      compacted automatically so long sessions keep working.
                    </p>
                    {routingConfig.autoCompactEnabled && (
                      <div className="flex items-center gap-3 mt-1">
                        <input
                          type="range"
                          min="60"
                          max="95"
                          step="5"
                          value={routingConfig.autoCompactThreshold}
                          onChange={(e) => updateRoutingConfig({ autoCompactThreshold: Number(e.target.value) })}
                          className="flex-1 accent-obsidian-accentHover cursor-pointer"
                        />
                        <span className="font-mono text-obsidian-inkSecondary text-xs w-10 text-right">
                          {routingConfig.autoCompactThreshold}%
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 p-3 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-obsidian-inkPrimary">TPM Compactor Safeguard Threshold</span>
                      <span className="font-mono text-obsidian-inkSecondary">{routingConfig.tpmBudget} tokens</span>
                    </div>
                    <p className="text-[11px] text-obsidian-inkMuted">
                      Compacts historical tool outputs when payload reaches this budget to eliminate HTTP 413 errors.
                    </p>
                    <input
                      type="range"
                      min="2000"
                      max="16000"
                      step="500"
                      value={routingConfig.tpmBudget}
                      onChange={(e) => updateRoutingConfig({ tpmBudget: Number(e.target.value) })}
                      className="w-full accent-obsidian-accentHover cursor-pointer mt-2"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-3">
                <h3 className="font-bold text-obsidian-inkPrimary text-sm">Model Priority</h3>
                <RoutingPriorityList />
              </div>

              <UpdateCheckRow />
            </div>
          )}

          {/* TAB 3: LOCAL RUNTIMES & MODEL DISCOVERY */}
          {activeTab === 'local' && (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-obsidian-inkPrimary text-sm flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-obsidian-inkPrimary" />
                    Local Runtime Scanner
                  </h3>
                  <p className="text-obsidian-inkMuted text-xs mt-0.5">
                    Scan <code className="text-obsidian-inkSecondary">localhost:11434</code> (Ollama) and <code className="text-obsidian-inkSecondary">localhost:1234</code> (LM Studio).
                  </p>
                </div>

                <button
                  onClick={handleScanLocal}
                  disabled={isScanningLocal}
                  className="px-3.5 py-1.5 bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkPrimary border border-obsidian-hairline font-mono rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {isScanningLocal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Scan Local</span>
                </button>
              </div>

              {/* Detected Models List */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-3">
                  <div className="flex items-center justify-between font-bold text-obsidian-inkPrimary">
                    <span>Ollama ({detectedLocalModels.ollama.length})</span>
                    <span className="text-[10px] font-mono text-obsidian-inkMuted">11434</span>
                  </div>
                  {detectedLocalModels.ollama.length === 0 ? (
                    <p className="text-[11px] text-obsidian-inkMuted">No Ollama models detected. Start Ollama on port 11434.</p>
                  ) : (
                    <div className="space-y-1 font-mono text-[11px]">
                      {detectedLocalModels.ollama.map((m) => (
                        <div key={m} className="p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg flex items-center justify-between">
                          <span className="text-obsidian-inkPrimary">{m}</span>
                          <span className="text-[9px] text-obsidian-inkSecondary bg-obsidian-surface3 px-1.5 py-0.5 rounded-full border border-obsidian-hairline font-mono">READY</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-3">
                  <div className="flex items-center justify-between font-bold text-obsidian-inkPrimary">
                    <span>LM Studio ({detectedLocalModels.lmstudio.length})</span>
                    <span className="text-[10px] font-mono text-obsidian-inkMuted">1234</span>
                  </div>
                  {detectedLocalModels.lmstudio.length === 0 ? (
                    <p className="text-[11px] text-obsidian-inkMuted">No LM Studio models detected. Start local server on port 1234.</p>
                  ) : (
                    <div className="space-y-1 font-mono text-[11px]">
                      {detectedLocalModels.lmstudio.map((m) => (
                        <div key={m} className="p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg flex items-center justify-between">
                          <span className="text-obsidian-inkPrimary">{m}</span>
                          <span className="text-[9px] text-obsidian-inkSecondary bg-obsidian-surface3 px-1.5 py-0.5 rounded-full border border-obsidian-hairline font-mono">READY</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CUSTOM MODALITY MODELS (IMAGE, VIDEO, AUDIO, LLM) */}
          {activeTab === 'custom' && (
            <div className="max-w-3xl mx-auto space-y-5">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!customModelId.trim() || !customModelName.trim()) return;
                  setAddingCustom(true);
                  setCustomModelError('');
                  // Stable id keeps re-adds idempotent and makes delete target unambiguous
                  const stableId = `custom-${customModelCategory}-${customModelProvider.trim().toLowerCase()}-${customModelId.trim()}`.replace(/\s+/g, '-');
                  try {
                    const res = await fetch('/api/custom-models', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: stableId,
                        category: customModelCategory,
                        name: customModelName.trim(),
                        providerId: customModelProvider.trim(),
                        modelId: customModelId.trim(),
                        description: customModelDescription.trim() || `Custom ${customModelCategory} generation model.`,
                        config: {
                          baseUrl: customBaseUrl.trim() || undefined,
                          apiKey: customApiKey.trim() || undefined,
                          supportsVision: customSupportsVision,
                          supportsTools: customSupportsTools,
                        },
                      }),
                    });
                    const data = await res.json();
                    if (!data.success) {
                      throw new Error(data.error || 'Could not save the custom model — check the details and try again.');
                    }

                    // Register with the live model router so the model shows up in the
                    // dropdown under its provider on the next /api/models poll — no restart.
                    const regRes = await fetch('/api/models/custom', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: customModelId.trim(),
                        name: customModelName.trim(),
                        provider: customModelProvider.trim(),
                        baseUrl: customBaseUrl.trim() || undefined,
                        apiKey: customApiKey.trim() || undefined,
                        supportsVision: customSupportsVision,
                        supportsTools: customSupportsTools,
                      }),
                    });
                    const regData = await regRes.json().catch(() => ({}));
                    if (!regData.success) {
                      throw new Error(regData.error || 'Saved, but routing registration failed — the model may not appear in the picker until it succeeds.');
                    }

                    setStatusMessage({ text: `Custom ${customModelCategory.toUpperCase()} model "${customModelName}" configured for AI routing.`, type: 'success' });
                    setCustomModelId('');
                    setCustomModelName('');
                    setCustomModelDescription('');
                    setCustomBaseUrl('');
                    setCustomApiKey('');
                    fetchCustomModelsAndMcp();
                  } catch (err: any) {
                    const msg = err?.message || 'Error configuring custom model';
                    setCustomModelError(msg);
                    setStatusMessage({ text: msg, type: 'error' });
                  } finally {
                    setAddingCustom(false);
                    setTimeout(() => setStatusMessage(null), 4000);
                  }
                }}
                className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-obsidian-inkPrimary text-sm flex items-center gap-2">
                      <Plus className="w-4 h-4 text-obsidian-inkSecondary" />
                      Add Custom Model with AI Use Case Guidance
                    </h3>
                    <p className="text-obsidian-inkMuted text-xs mt-0.5">
                      Configure specialized models for Image, Video, Audio, or LLM and describe their exact purpose for autonomous AI tool routing.
                    </p>
                  </div>
                </div>

                {/* Modality Category Selector */}
                <div className="flex items-center gap-2 p-1 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg">
                  {[
                    { id: 'image' as const, label: 'Image Generation', icon: ImageIcon },
                    { id: 'video' as const, label: 'Video Diffusion', icon: Film },
                    { id: 'audio' as const, label: 'Voice & Audio', icon: Volume2 },
                    { id: 'llm' as const, label: 'LLM & Reasoning', icon: Cpu },
                  ].map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCustomModelCategory(cat.id)}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-mono transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                          customModelCategory === cat.id
                            ? 'bg-white text-black font-semibold shadow-sm'
                            : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">Display Name</label>
                    <input
                      type="text"
                      value={customModelName}
                      onChange={(e) => setCustomModelName(e.target.value)}
                      placeholder={
                        customModelCategory === 'image' ? 'e.g. FLUX.1 Pro Ultra' :
                        customModelCategory === 'video' ? 'e.g. Minimax Video-01 HD' :
                        customModelCategory === 'audio' ? 'e.g. ElevenLabs Turbo v2.5' :
                        'e.g. Qwen 2.5 Coder 32B Local'
                      }
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    />
                  </div>
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">Model ID / Hub Path</label>
                    <input
                      type="text"
                      value={customModelId}
                      onChange={(e) => setCustomModelId(e.target.value)}
                      placeholder={
                        customModelCategory === 'image' ? 'black-forest-labs/flux-1.1-pro' :
                        customModelCategory === 'video' ? 'minimax/video-01' :
                        customModelCategory === 'audio' ? 'eleven_multilingual_v2' :
                        'qwen2.5-coder:32b'
                      }
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    />
                  </div>
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">Provider / Gateway</label>
                    <input
                      type="text"
                      value={customModelProvider}
                      onChange={(e) => setCustomModelProvider(e.target.value)}
                      placeholder="replicate / fal-ai / openai / local"
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    />
                  </div>
                </div>

                {/* AI Prompt Usage Guidance */}
                <div>
                  <label className="block text-obsidian-inkSecondary text-[11px] mb-1 font-mono flex items-center justify-between">
                    <span>Describe Its Use to the AI (Autonomous Tool Instruction)</span>
                    <span className="text-obsidian-inkMuted text-[10px]">Injected into AI system prompt</span>
                  </label>
                  <textarea
                    value={customModelDescription}
                    onChange={(e) => setCustomModelDescription(e.target.value)}
                    placeholder={
                      customModelCategory === 'image'
                        ? 'e.g. Use for 8K hyper-detailed photorealistic UI mockups and dark cyber-aesthetic hero banners with crisp embedded text.'
                        : customModelCategory === 'video'
                        ? 'e.g. Use for cinematic 1080p feature walkthrough animations and high dynamic range 60fps UI motion previews.'
                        : customModelCategory === 'audio'
                        ? 'e.g. Use for energetic, natural voiceover narration for product launch demos and UI click sound synthesis.'
                        : 'e.g. Use for complex multi-file TypeScript refactoring, abstract syntax tree transformations, and deep logic bugs.'
                    }
                    rows={2}
                    className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">Custom Base URL (Optional)</label>
                    <input
                      type="text"
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder="e.g. http://localhost:8000/v1"
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    />
                  </div>
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">API Key / Token (Optional)</label>
                    <input
                      type="password"
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      placeholder="Bearer token if required"
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    />
                  </div>
                </div>

                {customModelError && (
                  <p className="flex items-start gap-1.5 text-[11px] text-red-400 bg-red-950/40 border border-red-800/60 rounded-lg px-2.5 py-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{customModelError}</span>
                  </p>
                )}

                <button
                  type="submit"
                  disabled={addingCustom || !customModelId.trim() || !customModelName.trim()}
                  className="w-full py-2 bg-white text-black hover:bg-obsidian-accentHover font-semibold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  {addingCustom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Save Custom {customModelCategory.toUpperCase()} Model for AI Routing</span>
                </button>
              </form>

              {/* Saved Custom Models Catalog */}
              {savedCustomModels.length > 0 && (
                <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-3">
                  <h4 className="text-xs font-bold text-obsidian-inkPrimary uppercase tracking-wider font-mono">
                    Configured Custom Models ({savedCustomModels.length})
                  </h4>
                  <div className="space-y-2">
                    {savedCustomModels.map((m) => (
                      <div key={m.id} className="p-2.5 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white font-mono">{m.name}</span>
                            <span className="text-[9px] uppercase px-1.5 py-0.2 rounded-full bg-white/[0.08] text-obsidian-inkSecondary font-mono">
                              {m.category}
                            </span>
                            <span className="text-[10px] text-obsidian-inkMuted font-mono">ID: {m.modelId}</span>
                          </div>
                          <p className="text-[11px] text-obsidian-inkSecondary font-sans">{m.description}</p>
                        </div>
                        <button
                          onClick={async () => {
                            await fetch(`/api/custom-models/${m.id}`, { method: 'DELETE' });
                            fetchCustomModelsAndMcp();
                          }}
                          className="p-1 text-obsidian-inkMuted hover:text-red-400 transition-colors cursor-pointer shrink-0"
                          title="Delete custom model"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: MODEL CONTEXT PROTOCOL (MCP) SERVERS */}
          {activeTab === 'mcp' && (
            <div className="max-w-3xl mx-auto space-y-5">
              {/* Add Custom MCP Server Form */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newMcpName.trim()) return;
                  setAddingMcp(true);
                  try {
                    const res = await fetch('/api/mcp/servers', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        name: newMcpName.trim(),
                        transport: newMcpTransport,
                        command: newMcpCommand.trim() || undefined,
                        args: newMcpArgs.trim() ? newMcpArgs.split(' ') : [],
                        url: newMcpUrl.trim() || undefined,
                        description: newMcpDescription.trim() || undefined,
                      }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      setStatusMessage({ text: `Custom MCP Server "${newMcpName}" connected.`, type: 'success' });
                      setNewMcpName('');
                      setNewMcpCommand('');
                      setNewMcpArgs('');
                      setNewMcpUrl('');
                      setNewMcpDescription('');
                      fetchCustomModelsAndMcp();
                    } else {
                      setStatusMessage({ text: data.error || 'Could not connect the MCP server — verify the command or URL.', type: 'error' });
                    }
                  } catch (err: any) {
                    setStatusMessage({ text: err.message || 'Error adding MCP server', type: 'error' });
                  } finally {
                    setAddingMcp(false);
                    setTimeout(() => setStatusMessage(null), 4000);
                  }
                }}
                className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-obsidian-inkPrimary text-sm flex items-center gap-2">
                      <Server className="w-4 h-4 text-obsidian-inkSecondary" />
                      Connect Custom Model Context Protocol (MCP) Server
                    </h3>
                    <p className="text-obsidian-inkMuted text-xs mt-0.5">
                      Integrate standard MCP tool servers (PostgreSQL databases, GitHub PRs, Docker sandboxes, Figma designs, Firebase).
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-obsidian-inkMuted bg-obsidian-surface2 px-2 py-0.5 rounded-full border border-obsidian-hairline">
                    JSON-RPC 2.0
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">Server Name</label>
                    <input
                      type="text"
                      value={newMcpName}
                      onChange={(e) => setNewMcpName(e.target.value)}
                      placeholder="e.g. postgres-db"
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    />
                  </div>
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">Transport Type</label>
                    <select
                      value={newMcpTransport}
                      onChange={(e) => setNewMcpTransport(e.target.value as any)}
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    >
                      <option value="stdio">stdio (Local CLI Process)</option>
                      <option value="sse">sse (Server-Sent Events)</option>
                      <option value="http">http (HTTP Streaming)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">
                      {newMcpTransport === 'stdio' ? 'Command' : 'Endpoint URL'}
                    </label>
                    <input
                      type="text"
                      value={newMcpTransport === 'stdio' ? newMcpCommand : newMcpUrl}
                      onChange={(e) => newMcpTransport === 'stdio' ? setNewMcpCommand(e.target.value) : setNewMcpUrl(e.target.value)}
                      placeholder={newMcpTransport === 'stdio' ? 'npx -y @modelcontextprotocol/server-postgres' : 'http://localhost:3005/sse'}
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    />
                  </div>
                </div>

                {newMcpTransport === 'stdio' && (
                  <div>
                    <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">Command Arguments (Space separated)</label>
                    <input
                      type="text"
                      value={newMcpArgs}
                      onChange={(e) => setNewMcpArgs(e.target.value)}
                      placeholder="postgresql://user:pass@localhost:5432/mydb"
                      className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-obsidian-inkMuted text-[11px] mb-1 font-mono">Description of Tools Provided (Optional)</label>
                  <input
                    type="text"
                    value={newMcpDescription}
                    onChange={(e) => setNewMcpDescription(e.target.value)}
                    placeholder="e.g. Query and migrate PostgreSQL relational databases with schema introspection"
                    className="w-full p-2 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg text-xs font-mono text-obsidian-inkPrimary"
                  />
                </div>

                <button
                  type="submit"
                  disabled={addingMcp || !newMcpName.trim()}
                  className="w-full py-2 bg-white text-black hover:bg-obsidian-accentHover font-semibold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  {addingMcp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Register & Connect MCP Server</span>
                </button>
              </form>

              {/* Connected MCP Servers List */}
              <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-obsidian-inkPrimary uppercase tracking-wider font-mono">
                  Active MCP Servers ({mcpServers.length})
                </h4>
                {mcpServers.length === 0 ? (
                  <p className="text-xs text-obsidian-inkMuted">No external MCP servers configured. Add an MCP server above.</p>
                ) : (
                  <div className="space-y-2">
                    {mcpServers.map((srv) => (
                      <div key={srv.id} className="p-2.5 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white font-mono">{srv.name}</span>
                            <span className="text-[9px] uppercase px-1.5 py-0.2 rounded-full bg-white/[0.08] text-obsidian-inkSecondary font-mono">
                              {srv.transport}
                            </span>
                            <span className="text-[9px] text-obsidian-inkMuted bg-white/[0.04] px-1.5 py-0.2 rounded-full font-mono">ACTIVE</span>
                          </div>
                          <p className="text-[11px] text-obsidian-inkMuted font-mono truncate max-w-lg">
                            {srv.command || srv.url || 'Internal MCP'}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            await fetch(`/api/mcp/servers/${srv.id}`, { method: 'DELETE' });
                            fetchCustomModelsAndMcp();
                          }}
                          className="p-1 text-obsidian-inkMuted hover:text-red-400 transition-colors cursor-pointer shrink-0"
                          title="Disconnect MCP server"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 6: ABOUT — VERSION + UPDATE CHECK */}
          {activeTab === 'about' && (
            <div className="max-w-2xl mx-auto space-y-5">
              <div className="p-4 bg-obsidian-surface1 border border-obsidian-hairline rounded-xl space-y-4">
                <h3 className="font-bold text-obsidian-inkPrimary text-sm flex items-center gap-2">
                  <Info className="w-4 h-4 text-obsidian-inkSecondary" />
                  About SUTRA
                </h3>

                <div className="flex items-center justify-between p-3 bg-obsidian-surface2 border border-obsidian-hairline rounded-lg">
                  <div>
                    <div className="font-semibold text-obsidian-inkPrimary">Version</div>
                    <div className="text-[11px] text-obsidian-inkMuted font-mono">
                      {appVersion ? `SUTRA Studio ${appVersion}` : 'Checking installed version…'}
                    </div>
                  </div>
                  <button
                    onClick={handleCheckForUpdates}
                    disabled={updateState === 'checking'}
                    className="px-3 py-1.5 bg-obsidian-surface3 hover:bg-obsidian-surface2 text-obsidian-inkPrimary border border-obsidian-hairline rounded-lg font-mono text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {updateState === 'checking' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    <span>Check for updates</span>
                  </button>
                </div>

                {updateMessage && (
                  <p
                    role="status"
                    className={`text-[11px] font-mono rounded-lg px-2.5 py-1.5 border ${
                      updateState === 'available'
                        ? 'bg-obsidian-surface2 text-obsidian-inkPrimary border-obsidian-border'
                        : updateState === 'error'
                          ? 'bg-red-950/40 text-red-300 border-red-800/60'
                          : 'bg-obsidian-surface2 text-obsidian-inkSecondary border-obsidian-hairline'
                    }`}
                  >
                    {updateMessage}
                  </p>
                )}

                <p className="text-[10px] text-obsidian-inkMuted">
                  Updates are never downloaded automatically. When one is available, grab it from the project website and reinstall.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
