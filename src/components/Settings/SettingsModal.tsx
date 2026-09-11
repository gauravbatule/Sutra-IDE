import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  CheckCircle2,
  AlertCircle,
  Plus,
  Loader2,
  Eye,
  EyeOff,
  Trash2,
  ShieldCheck,
  Globe,
  Terminal,
  Palette,
  Brain,
  SlidersHorizontal,
  Sparkles,
  Film,
  Image as ImageIcon,
  Volume2,
  Pencil,
  Check,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { useTheme } from '../../hooks/useTheme.js';

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
  placeholder?: string;
  defaultBaseUrl?: string;
  models?: string[];
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

interface CustomModelEntry {
  id: string;
  name: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number;
  category?: string;
  supportsVision?: boolean;
  supportsTools?: boolean;
  createdAt?: number;
}

type SettingsCategory =
  | 'general'
  | 'application'
  | 'appearance'
  | 'models'
  | 'media'
  | 'customizations'
  | 'browser';

interface CategoryConfig {
  id: SettingsCategory;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CATEGORIES: CategoryConfig[] = [
  {
    id: 'general',
    label: 'General',
    subtitle: 'Configure agent execution, queued message delivery, and permissions.',
    icon: SlidersHorizontal,
  },
  {
    id: 'application',
    label: 'Application',
    subtitle: 'Manage workspace directories, terminal shell defaults, and audio preferences.',
    icon: Terminal,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    subtitle: 'Customize editor theme, typography, and watermark branding.',
    icon: Palette,
  },
  {
    id: 'models',
    label: 'Models',
    subtitle: 'Configure cloud provider API keys and custom OpenAI-compatible models.',
    icon: Key,
  },
  {
    id: 'media',
    label: 'Media Studio',
    subtitle: 'Configure image/video providers, aspect ratios, generation styles, and audio synthesis.',
    icon: Film,
  },
  {
    id: 'customizations',
    label: 'Customizations',
    subtitle: 'Configure system prompt rules, MCP tool integrations, and memory sync.',
    icon: Sparkles,
  },
  {
    id: 'browser',
    label: 'Browser',
    subtitle: 'Manage live web preview simulation, viewports, and visual element inspection.',
    icon: Globe,
  },
];

interface SettingsModalProps {
  isOpen?: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const isSettingsOpen = useIDEStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useIDEStore((s) => s.setSettingsOpen);
  const currentWorkspacePath = useIDEStore((s) => s.currentWorkspacePath);
  const currentWorkspaceName = useIDEStore((s) => s.currentWorkspaceName);
  const setMemoryModalOpen = useIDEStore((s) => s.setMemoryModalOpen);
  const permissionLevel = useIDEStore((s) => s.permissionLevel);
  const setPermissionLevel = useIDEStore((s) => s.setPermissionLevel);
  const { theme, toggleTheme } = useTheme();

  const shouldShow = isOpen !== undefined ? isOpen : isSettingsOpen;

  const [activeTab, setActiveTab] = useState<SettingsCategory>('general');
  const [catalog, setCatalog] = useState<ProviderCatalogItem[]>([]);
  const [customModels, setCustomModels] = useState<CustomModelEntry[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // General Settings State
  const [queuedMessages, setQueuedMessages] = useState<'queue' | 'immediate'>(() => {
    return (localStorage.getItem('sutra-queued-messages') as 'queue' | 'immediate') || 'immediate';
  });
  const [securityPreset, setSecurityPreset] = useState<'turbo' | 'balanced' | 'strict'>(() => {
    return (localStorage.getItem('sutra-security-preset') as any) || 'turbo';
  });
  const [artifactReviewPolicy, setArtifactReviewPolicy] = useState<'always_proceed' | 'ask_user' | 'auto_safe'>(() => {
    return (localStorage.getItem('sutra-artifact-review-policy') as any) || 'always_proceed';
  });
  const [taskTerminationSignal, setTaskTerminationSignal] = useState<boolean>(() => {
    return localStorage.getItem('sutra-termination-signal') !== '0';
  });
  const [inlineDiffsEnabled, setInlineDiffsEnabled] = useState<boolean>(() => {
    return localStorage.getItem('sutra-inline-diffs') !== '0';
  });

  // Application Settings State
  const [terminalShell, setTerminalShell] = useState<string>(() => {
    return localStorage.getItem('sutra-terminal-shell') || 'powershell';
  });
  const musicVolume = useIDEStore((s) => s.musicVolume);
  const setMusicVolume = useIDEStore((s) => s.setMusicVolume);
  const isMusicEnabled = useIDEStore((s) => s.isMusicEnabled);
  const setMusicEnabled = useIDEStore((s) => s.setMusicEnabled);

  // Appearance State
  const [watermarkStyle, setWatermarkStyle] = useState<string>(() => {
    return localStorage.getItem('sutra-watermark-style') || 'embossed';
  });
  const [editorFont, setEditorFont] = useState<string>(() => {
    return localStorage.getItem('sutra-editor-font') || 'JetBrains Mono';
  });

  // Browser State
  const previewViewport = useIDEStore((s) => s.previewViewport);
  const setPreviewViewport = useIDEStore((s) => s.setPreviewViewport);
  const [elementInspectorEnabled, setElementInspectorEnabled] = useState<boolean>(() => {
    return localStorage.getItem('sutra-element-inspector') !== '0';
  });
  const [petEnabled, setPetEnabled] = useState<boolean>(() => {
    return localStorage.getItem('sutra-pet-visible') !== 'false';
  });

  // Media Studio State
  const [imageProvider, setImageProvider] = useState<string>('auto');
  const [imageAspectRatio, setImageAspectRatio] = useState<string>('1:1');
  const [imageStyle, setImageStyle] = useState<string>('photo');
  const [videoProvider, setVideoProvider] = useState<string>('auto');
  const [audioVoice, setAudioVoice] = useState<string>('alloy');
  const [audioSfxEngine, setAudioSfxEngine] = useState<string>('procedural');
  const [isSavingMedia, setIsSavingMedia] = useState<boolean>(false);

  useEffect(() => {
    const cached = localStorage.getItem('sutra-media-settings');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.imageProvider) setImageProvider(parsed.imageProvider);
        if (parsed.imageAspectRatio) setImageAspectRatio(parsed.imageAspectRatio);
        if (parsed.imageStyle) setImageStyle(parsed.imageStyle);
        if (parsed.videoProvider) setVideoProvider(parsed.videoProvider);
        if (parsed.audioVoice) setAudioVoice(parsed.audioVoice);
        if (parsed.audioSfxEngine) setAudioSfxEngine(parsed.audioSfxEngine);
      } catch {}
    }
    fetch('/api/media/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          if (data.imageProvider) setImageProvider(data.imageProvider);
          if (data.imageAspectRatio) setImageAspectRatio(data.imageAspectRatio);
          if (data.imageStyle) setImageStyle(data.imageStyle);
          if (data.videoProvider) setVideoProvider(data.videoProvider);
          if (data.audioVoice) setAudioVoice(data.audioVoice);
          if (data.audioSfxEngine) setAudioSfxEngine(data.audioSfxEngine);
          localStorage.setItem('sutra-media-settings', JSON.stringify(data));
        }
      })
      .catch(() => undefined);
  }, []);

  const updateMediaSetting = async (key: string, value: string) => {
    const nextSettings = {
      imageProvider: key === 'imageProvider' ? value : imageProvider,
      imageAspectRatio: key === 'imageAspectRatio' ? value : imageAspectRatio,
      imageStyle: key === 'imageStyle' ? value : imageStyle,
      videoProvider: key === 'videoProvider' ? value : videoProvider,
      audioVoice: key === 'audioVoice' ? value : audioVoice,
      audioSfxEngine: key === 'audioSfxEngine' ? value : audioSfxEngine,
    };
    if (key === 'imageProvider') setImageProvider(value);
    if (key === 'imageAspectRatio') setImageAspectRatio(value);
    if (key === 'imageStyle') setImageStyle(value);
    if (key === 'videoProvider') setVideoProvider(value);
    if (key === 'audioVoice') setAudioVoice(value);
    if (key === 'audioSfxEngine') setAudioSfxEngine(value);

    localStorage.setItem('sutra-media-settings', JSON.stringify(nextSettings));
    setIsSavingMedia(true);
    try {
      await fetch('/api/media/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      setStatusMessage({ text: 'Media settings updated', type: 'success' });
      setTimeout(() => setStatusMessage(null), 2000);
    } catch {
      setStatusMessage({ text: 'Saved locally', type: 'success' });
      setTimeout(() => setStatusMessage(null), 2000);
    } finally {
      setIsSavingMedia(false);
    }
  };

  // Custom Rules State
  const [customRules, setCustomRules] = useState<string>(() => {
    return localStorage.getItem('sutra-custom-rules') || '';
  });

  // User Profile State (configurable, defaults to Guest Architect)
  const [profileName, setProfileName] = useState<string>(() => {
    try {
      return localStorage.getItem('sutra_profile_name') || 'Guest Architect';
    } catch {
      return 'Guest Architect';
    }
  });
  const [profileHandle, setProfileHandle] = useState<string>(() => {
    try {
      return localStorage.getItem('sutra_profile_email') || 'creator@sutra.studio';
    } catch {
      return 'creator@sutra.studio';
    }
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(profileName);
  const [editHandle, setEditHandle] = useState(profileHandle);

  const handleSaveProfile = () => {
    const cleanName = editName.trim() || 'Guest Architect';
    const cleanHandle = editHandle.trim() || 'creator@sutra.studio';
    setProfileName(cleanName);
    setProfileHandle(cleanHandle);
    try {
      localStorage.setItem('sutra_profile_name', cleanName);
      localStorage.setItem('sutra_profile_email', cleanHandle);
    } catch {}
    setIsEditingProfile(false);
  };

  // Provider Keys State
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);

  // Add Custom Model Form State
  const [newCustomName, setNewCustomName] = useState('');
  const [newCustomId, setNewCustomId] = useState('');
  const [newCustomBaseUrl, setNewCustomBaseUrl] = useState('');
  const [newCustomApiKey, setNewCustomApiKey] = useState('');
  const [newCustomContext, setNewCustomContext] = useState('128000');
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customFormError, setCustomFormError] = useState<string | null>(null);

  // Fetch providers catalog & custom models
  const fetchCatalog = async () => {
    try {
      const [catRes, custRes] = await Promise.all([
        fetch('/api/providers/catalog'),
        fetch('/api/custom-models'),
      ]);
      if (catRes.ok) {
        const catData = await catRes.json();
        if (Array.isArray(catData.providers)) {
          // Filter out antigravity and local providers per user requirement
          const filtered = catData.providers.filter(
            (p: ProviderCatalogItem) => p.id !== 'antigravity' && p.category !== 'local'
          );
          setCatalog(filtered);
        }
      }
      if (custRes.ok) {
        const custData = await custRes.json();
        if (Array.isArray(custData.models)) {
          setCustomModels(custData.models);
        }
      }
    } catch {
      // Best-effort
    }
  };

  useEffect(() => {
    if (shouldShow) {
      void fetchCatalog();
    }
  }, [shouldShow]);

  // Handle escape to close
  useEffect(() => {
    if (!shouldShow) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldShow, onClose, setSettingsOpen]);

  if (!shouldShow) return null;

  const handleClose = () => {
    setSettingsOpen(false);
    onClose();
  };

  const handleSaveProviderKey = async (providerId: string) => {
    const apiKey = (providerKeys[providerId] || '').trim();
    if (!apiKey) return;
    setSyncingProvider(providerId);
    try {
      const res = await fetch('/api/providers/save-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          authType: 'api-key',
          apiKey,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProviderKeys((prev) => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
        setStatusMessage({ text: `Saved key for ${providerId}`, type: 'success' });
        void fetchCatalog();
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (e: any) {
      setStatusMessage({ text: e.message || 'Error saving key', type: 'error' });
    } finally {
      setSyncingProvider(null);
      setTimeout(() => setStatusMessage(null), 3500);
    }
  };

  const handleAddCustomModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomName.trim() || !newCustomId.trim()) {
      setCustomFormError('Model display name and Model ID are required.');
      return;
    }
    setCustomFormError(null);
    setIsAddingCustom(true);
    try {
      const res = await fetch('/api/custom-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCustomName.trim(),
          id: newCustomId.trim(),
          baseUrl: newCustomBaseUrl.trim() || undefined,
          apiKey: newCustomApiKey.trim() || undefined,
          contextWindow: parseInt(newCustomContext, 10) || 128000,
          category: 'llm',
          supportsTools: true,
          supportsVision: false,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewCustomName('');
        setNewCustomId('');
        setNewCustomBaseUrl('');
        setNewCustomApiKey('');
        setNewCustomContext('128000');
        setStatusMessage({ text: `Added custom model ${newCustomName}`, type: 'success' });
        void fetchCatalog();
      } else {
        throw new Error(data.error || 'Could not register custom model');
      }
    } catch (err: any) {
      setCustomFormError(err.message || 'Error adding custom model');
    } finally {
      setIsAddingCustom(false);
      setTimeout(() => setStatusMessage(null), 3500);
    }
  };

  const handleDeleteCustomModel = async (id: string) => {
    try {
      const res = await fetch(`/api/custom-models/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMessage({ text: 'Deleted custom model', type: 'success' });
        void fetchCatalog();
      }
    } catch {
      // Best-effort
    }
  };

  const currentCategory = CATEGORIES.find((c) => c.id === activeTab) || CATEGORIES[0];
  const workspaceName = currentWorkspaceName || (currentWorkspacePath ? currentWorkspacePath.split(/[/\\]/).filter(Boolean).pop() : '') || 'omnicraft-ide';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-150 font-sans"
    >
      <div className="w-full max-w-5xl h-[88vh] max-h-[820px] bg-obsidian-surface1 border border-obsidian-border rounded-2xl shadow-2xl flex overflow-hidden">
        {/* LEFT NAVIGATION SIDEBAR */}
        <div className="w-60 sm:w-64 border-r border-obsidian-hairline bg-obsidian-surface1/80 flex flex-col justify-between shrink-0 p-3 select-none">
          <div className="space-y-4">
            <div className="px-3 pt-1.5 flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                Settings
              </h3>
            </div>

            {/* Navigation Tabs */}
            <nav className="space-y-1">
              {CATEGORIES.map((cat) => {
                const isActive = activeTab === cat.id;
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActiveTab(cat.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-semibold shadow-xs border border-obsidian-border'
                        : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2'
                    }`}
                  >
                    <Icon className="w-4 h-4 text-obsidian-inkMuted shrink-0" />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Projects section */}
            <div className="pt-3 px-3 space-y-1 border-t border-obsidian-hairline">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-obsidian-inkMuted font-mono block mb-1">
                Projects
              </span>
              <div className="text-xs font-mono text-obsidian-inkSecondary py-1 truncate flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="truncate">{workspaceName}</span>
              </div>
            </div>
          </div>

          {/* User Profile Footer */}
          <div className="pt-3 border-t border-obsidian-hairline space-y-2 px-2">
            {isEditingProfile ? (
              <div className="p-2 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline space-y-2 anim-appear">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Display Name"
                  className="w-full px-2 py-1 text-xs rounded bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkPrimary font-medium focus:border-obsidian-accent outline-none"
                />
                <input
                  type="text"
                  value={editHandle}
                  onChange={(e) => setEditHandle(e.target.value)}
                  placeholder="Handle or Email"
                  className="w-full px-2 py-1 text-[10px] font-mono rounded bg-obsidian-surface1 border border-obsidian-hairline text-obsidian-inkSecondary focus:border-obsidian-accent outline-none"
                />
                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditName(profileName);
                      setEditHandle(profileHandle);
                      setIsEditingProfile(false);
                    }}
                    className="p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 text-[10px] cursor-pointer"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    className="p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 text-[10px] cursor-pointer flex items-center gap-1"
                    title="Save profile"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 py-1 group/profile">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-cyan-500/20 border border-obsidian-border text-obsidian-inkPrimary font-semibold text-xs flex items-center justify-center shrink-0 shadow-xs">
                  {profileName.trim().charAt(0).toUpperCase() || 'G'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-obsidian-inkPrimary truncate flex items-center justify-between">
                    <span className="truncate">{profileName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditName(profileName);
                        setEditHandle(profileHandle);
                        setIsEditingProfile(true);
                      }}
                      className="opacity-0 group-hover/profile:opacity-100 p-0.5 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-opacity cursor-pointer"
                      title="Edit Profile"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[10px] text-obsidian-inkMuted font-mono truncate">{profileHandle}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT CONTENT PANE */}
        <div className="flex-1 flex flex-col min-w-0 bg-obsidian-surface1 overflow-hidden">
          {/* Header */}
          <div className="h-16 px-6 border-b border-obsidian-hairline flex items-center justify-between shrink-0 bg-obsidian-surface1">
            <div className="space-y-0.5">
              <h2 id="settings-modal-title" className="text-base font-semibold text-obsidian-inkPrimary font-sans">
                {currentCategory.label}
              </h2>
              <p className="text-xs text-obsidian-inkMuted">{currentCategory.subtitle}</p>
            </div>

            <div className="flex items-center gap-3">
              {statusMessage && (
                <span
                  className={`text-xs font-mono px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${
                    statusMessage.type === 'success'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-red-500/15 text-red-300 border-red-500/30'
                  }`}
                >
                  {statusMessage.type === 'success' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                  )}
                  {statusMessage.text}
                </span>
              )}
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close settings (Esc)"
                title="Close settings (Esc)"
                className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary border border-transparent hover:border-obsidian-hairline transition-all active:scale-95 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* TAB: GENERAL */}
            {activeTab === 'general' && (
              <div className="space-y-6 max-w-2xl">
                {/* Execution Section */}
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Execution
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Queued Messages</div>
                        <div className="text-[11px] text-obsidian-inkMuted">Configure when follow-up messages are sent.</div>
                      </div>
                      <div className="flex items-center p-0.5 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline">
                        <button
                          type="button"
                          onClick={() => {
                            setQueuedMessages('queue');
                            localStorage.setItem('sutra-queued-messages', 'queue');
                          }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                            queuedMessages === 'queue'
                              ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold shadow-xs'
                              : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                          }`}
                        >
                          Queue
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setQueuedMessages('immediate');
                            localStorage.setItem('sutra-queued-messages', 'immediate');
                          }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                            queuedMessages === 'immediate'
                              ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold shadow-xs'
                              : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                          }`}
                        >
                          Send Immediately
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Agent Permissions & Mutation Safety</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Strict Mode requires approval before file mutations or command execution. Full Access operates autonomously.
                        </div>
                      </div>
                      <div className="flex items-center p-0.5 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline">
                        <button
                          type="button"
                          onClick={() => setPermissionLevel('strict')}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                            permissionLevel === 'strict'
                              ? 'bg-amber-500 text-white font-semibold shadow-xs'
                              : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Strict</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPermissionLevel('full')}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                            permissionLevel === 'full'
                              ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                              : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Full Access</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Task Termination Contract</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Mandates an Executive Delivery Receipt and halts tool calls upon goal completion.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={taskTerminationSignal}
                        onChange={(e) => {
                          setTaskTerminationSignal(e.target.checked);
                          localStorage.setItem('sutra-termination-signal', e.target.checked ? '1' : '0');
                        }}
                        className="w-4 h-4 accent-obsidian-inkPrimary cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Agent Settings Section */}
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Agent Settings
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Security Preset</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Controls terminal auto execution and file access permissions.
                        </div>
                      </div>
                      <select
                        value={securityPreset}
                        onChange={(e) => {
                          const val = e.target.value as any;
                          setSecurityPreset(val);
                          localStorage.setItem('sutra-security-preset', val);
                        }}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="turbo">Turbo Mode</option>
                        <option value="balanced">Balanced Mode</option>
                        <option value="strict">Strict Confirmation</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Agent Behavior Section */}
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Agent Behavior
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Artifact Review Policy</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Specifies behavior when asking for review on generated documents.
                        </div>
                      </div>
                      <select
                        value={artifactReviewPolicy}
                        onChange={(e) => {
                          const val = e.target.value as any;
                          setArtifactReviewPolicy(val);
                          localStorage.setItem('sutra-artifact-review-policy', val);
                        }}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="always_proceed">Always Proceed</option>
                        <option value="ask_user">Ask User</option>
                        <option value="auto_safe">Auto Approve Safe</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Inline Diff Synthesis</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Enforces surgical search-and-replace edits over destructive file overwrites.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={inlineDiffsEnabled}
                        onChange={(e) => {
                          setInlineDiffsEnabled(e.target.checked);
                          localStorage.setItem('sutra-inline-diffs', e.target.checked ? '1' : '0');
                        }}
                        className="w-4 h-4 accent-obsidian-inkPrimary cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: MODELS */}
            {activeTab === 'models' && (
              <div className="space-y-6 max-w-3xl">
                {/* Custom Models Manager */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                      Custom OpenAI-Compatible Models
                    </h4>
                    <span className="text-[10px] text-obsidian-inkMuted font-mono">
                      Connect any external endpoint, vLLM, RunPod, or Open-Source LLM
                    </span>
                  </div>

                  {/* Add Custom Model Form */}
                  <form onSubmit={handleAddCustomModel} className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-mono text-obsidian-inkMuted mb-1">Model Display Name</label>
                        <input
                          type="text"
                          value={newCustomName}
                          onChange={(e) => setNewCustomName(e.target.value)}
                          placeholder="e.g. Llama 3.3 70B (Together)"
                          className="w-full h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-obsidian-inkMuted mb-1">Model ID</label>
                        <input
                          type="text"
                          value={newCustomId}
                          onChange={(e) => setNewCustomId(e.target.value)}
                          placeholder="e.g. meta-llama/Llama-3.3-70B-Instruct"
                          className="w-full h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-mono text-obsidian-inkMuted mb-1">Base URL (Endpoint)</label>
                        <input
                          type="text"
                          value={newCustomBaseUrl}
                          onChange={(e) => setNewCustomBaseUrl(e.target.value)}
                          placeholder="https://api.together.xyz/v1 or http://localhost:8000/v1"
                          className="w-full h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-obsidian-inkMuted mb-1">Context Window</label>
                        <input
                          type="number"
                          value={newCustomContext}
                          onChange={(e) => setNewCustomContext(e.target.value)}
                          placeholder="128000"
                          className="w-full h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono text-obsidian-inkMuted mb-1">API Key (Optional if local)</label>
                      <input
                        type="password"
                        value={newCustomApiKey}
                        onChange={(e) => setNewCustomApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none"
                      />
                    </div>

                    {customFormError && (
                      <div className="text-[11px] text-red-400 font-mono">{customFormError}</div>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={isAddingCustom}
                        className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Custom Model</span>
                      </button>
                    </div>
                  </form>

                  {/* Configured Custom Models List */}
                  {customModels.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted font-semibold">
                        Registered Custom Endpoints ({customModels.length})
                      </div>
                      {customModels.map((m) => (
                        <div
                          key={m.id}
                          className="p-3 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-obsidian-inkPrimary truncate">{m.name}</div>
                            <div className="text-[10px] text-obsidian-inkMuted font-mono truncate">
                              ID: {m.id} {m.baseUrl ? `· ${m.baseUrl}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomModel(m.id)}
                            className="p-1.5 rounded-lg hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-red-400 transition-colors cursor-pointer"
                            title="Delete custom model"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Cloud Providers & API Keys */}
                <div className="space-y-3 pt-4 border-t border-obsidian-hairline">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Cloud Providers & API Keys
                  </h4>
                  <div className="space-y-2">
                    {catalog.map((prov) => {
                      const isConfigured = prov.isConfigured || prov.hasApiKey;
                      const isRevealed = revealedKeys[prov.id] || false;
                      const isSyncing = syncingProvider === prov.id;
                      return (
                        <div
                          key={prov.id}
                          className="p-3.5 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-obsidian-inkPrimary">{prov.name}</span>
                              <span
                                className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full font-semibold ${
                                  isConfigured
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-obsidian-surface4 text-obsidian-inkMuted'
                                }`}
                              >
                                {isConfigured ? 'Configured' : 'Not Connected'}
                              </span>
                            </div>
                            <p className="text-[11px] text-obsidian-inkMuted leading-relaxed">{prov.description}</p>
                          </div>

                          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                            <div className="relative flex-1 sm:w-56">
                              <input
                                type={isRevealed ? 'text' : 'password'}
                                value={providerKeys[prov.id] ?? ''}
                                onChange={(e) =>
                                  setProviderKeys((prev) => ({ ...prev, [prov.id]: e.target.value }))
                                }
                                placeholder={isConfigured ? '••••••••••••••••' : 'Enter API Key...'}
                                className="w-full h-8 pl-3 pr-8 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedKeys((prev) => ({ ...prev, [prov.id]: !isRevealed }))
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary cursor-pointer"
                              >
                                {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            <button
                              type="button"
                              disabled={isSyncing || !(providerKeys[prov.id] || '').trim()}
                              onClick={() => handleSaveProviderKey(prov.id)}
                              className="h-8 px-3 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 shrink-0"
                            >
                              {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: MEDIA & GENERATION STUDIO */}
            {activeTab === 'media' && (
              <div className="space-y-6 max-w-2xl">
                {/* Image Generation Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-obsidian-inkPrimary" />
                      <span>Image Asset Studio</span>
                    </h4>
                    {isSavingMedia && (
                      <span className="text-[11px] text-obsidian-inkMuted flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                      </span>
                    )}
                  </div>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Default Image Provider</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Engine used when generating logos, mockups, banners, and icons.
                        </div>
                      </div>
                      <select
                        value={imageProvider}
                        onChange={(e) => updateMediaSetting('imageProvider', e.target.value)}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="auto">Auto (Smart Provider Fallback)</option>
                        <option value="dalle3">OpenAI DALL-E 3 (High Fidelity)</option>
                        <option value="imagen3">Google Imagen 3 (Photorealistic)</option>
                        <option value="flux">FLUX.1 Schnell / Replicate</option>
                        <option value="chatgpt-web">ChatGPT Web Session (Cookie)</option>
                        <option value="pollinations">Pollinations (Instant Multi-Engine)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Default Aspect Ratio</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Canvas dimensions for generated visual assets.
                        </div>
                      </div>
                      <select
                        value={imageAspectRatio}
                        onChange={(e) => updateMediaSetting('imageAspectRatio', e.target.value)}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="1:1">1:1 Square (1024 x 1024)</option>
                        <option value="16:9">16:9 Landscape (1792 x 1024)</option>
                        <option value="9:16">9:16 Portrait / Story (1024 x 1792)</option>
                        <option value="4:3">4:3 Standard (1024 x 768)</option>
                        <option value="3:2">3:2 Classic Photo (1200 x 800)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Aesthetic Style Preset</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Style bias injected into visual generation prompts.
                        </div>
                      </div>
                      <select
                        value={imageStyle}
                        onChange={(e) => updateMediaSetting('imageStyle', e.target.value)}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="photo">Photorealistic & Cinematic</option>
                        <option value="digital-art">Digital Art & Illustration</option>
                        <option value="vector">Vector Graphic & Iconography</option>
                        <option value="3d-render">3D Isometric & Octane Render</option>
                        <option value="anime">Anime & Manga Style</option>
                        <option value="minimal">Minimalist & Monochrome</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Video Generation Section */}
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-obsidian-inkPrimary" />
                    <span>Motion & Video Studio</span>
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Video Model Provider</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          AI video generation pipeline for UI animations, teasers, and heroes.
                        </div>
                      </div>
                      <select
                        value={videoProvider}
                        onChange={(e) => updateMediaSetting('videoProvider', e.target.value)}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="auto">Auto (Replicate Minimax with Pollinations fallback)</option>
                        <option value="replicate">Replicate Minimax Video-01 / Luma</option>
                        <option value="pollinations">Pollinations Video Engine</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Audio & Speech Section */}
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-obsidian-inkPrimary" />
                    <span>Audio & Speech Synthesis</span>
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">TTS Speech Voice</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Voice persona used when generating spoken voiceovers and TTS audio.
                        </div>
                      </div>
                      <select
                        value={audioVoice}
                        onChange={(e) => updateMediaSetting('audioVoice', e.target.value)}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="alloy">Alloy (Neutral & Balanced)</option>
                        <option value="echo">Echo (Warm & Conversational)</option>
                        <option value="fable">Fable (Expressive & British accent)</option>
                        <option value="onyx">Onyx (Deep & Authoritative)</option>
                        <option value="nova">Nova (Energetic & Dynamic)</option>
                        <option value="shimmer">Shimmer (Clear & Pleasant)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Sound Effects & Foley Engine</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Engine for tactile button clicks, chimes, alarms, and UI cues.
                        </div>
                      </div>
                      <select
                        value={audioSfxEngine}
                        onChange={(e) => updateMediaSetting('audioSfxEngine', e.target.value)}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="procedural">Procedural DSP Synthesizer (Instant 44.1kHz, Zero Latency)</option>
                        <option value="hybrid">Hybrid (Procedural Audio + TTS Vocal Cues)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: APPLICATION */}
            {activeTab === 'application' && (
              <div className="space-y-6 max-w-2xl">
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Terminal & Shell Defaults
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Default Shell</div>
                        <div className="text-[11px] text-obsidian-inkMuted">Select terminal profile spawned by ConPTY.</div>
                      </div>
                      <select
                        value={terminalShell}
                        onChange={(e) => {
                          setTerminalShell(e.target.value);
                          localStorage.setItem('sutra-terminal-shell', e.target.value);
                        }}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="powershell">PowerShell</option>
                        <option value="cmd">Command Prompt</option>
                        <option value="bash">Git Bash</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Ambient Audio & Focus Player
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Lo-Fi Coding Soundscapes</div>
                        <div className="text-[11px] text-obsidian-inkMuted">Synthesized ambient binaural alpha focus audio.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isMusicEnabled}
                        onChange={(e) => setMusicEnabled(e.target.checked)}
                        className="w-4 h-4 accent-obsidian-inkPrimary cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Master Volume</div>
                        <div className="text-[11px] text-obsidian-inkMuted">Adjust sound volume level.</div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={musicVolume}
                        onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                        className="w-32 accent-obsidian-inkPrimary cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: APPEARANCE */}
            {activeTab === 'appearance' && (
              <div className="space-y-6 max-w-2xl">
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Visual Styling & Themes
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Color Theme</div>
                        <div className="text-[11px] text-obsidian-inkMuted">Switch between dark obsidian and paper light mode.</div>
                      </div>
                      <button
                        type="button"
                        onClick={toggleTheme}
                        className="h-8 px-4 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary hover:bg-obsidian-surface4 transition-colors cursor-pointer"
                      >
                        Current: <span className="font-semibold uppercase">{theme}</span> (Click to toggle)
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Watermark Backdrop</div>
                        <div className="text-[11px] text-obsidian-inkMuted">Embossed hero wordmark on conversation canvas.</div>
                      </div>
                      <select
                        value={watermarkStyle}
                        onChange={(e) => {
                          setWatermarkStyle(e.target.value);
                          localStorage.setItem('sutra-watermark-style', e.target.value);
                        }}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="embossed">Embossed Sutra (OpenCode)</option>
                        <option value="minimal">Minimal Emblem</option>
                        <option value="hidden">Hidden</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Code Font Family</div>
                        <div className="text-[11px] text-obsidian-inkMuted">Editor and terminal monospace typeface.</div>
                      </div>
                      <select
                        value={editorFont}
                        onChange={(e) => {
                          setEditorFont(e.target.value);
                          localStorage.setItem('sutra-editor-font', e.target.value);
                        }}
                        className="h-8 px-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary focus:outline-none cursor-pointer"
                      >
                        <option value="JetBrains Mono">JetBrains Mono</option>
                        <option value="Fira Code">Fira Code</option>
                        <option value="Menlo">Menlo / Monaco</option>
                        <option value="Consolas">Consolas</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: CUSTOMIZATIONS */}
            {activeTab === 'customizations' && (
              <div className="space-y-6 max-w-2xl">
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Custom Behavioral Instructions (.sutrarules)
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-3">
                    <p className="text-xs text-obsidian-inkSecondary leading-relaxed">
                      Custom rules written here are injected into every agent prompt, guiding coding style, library choices, and architecture rules.
                    </p>
                    <textarea
                      rows={5}
                      value={customRules}
                      onChange={(e) => {
                        setCustomRules(e.target.value);
                        localStorage.setItem('sutra-custom-rules', e.target.value);
                      }}
                      placeholder="e.g. Always write strict TypeScript types. Use Tailwind for styling. Run tests after editing files."
                      className="w-full p-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Cognitive Memory Vault
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold text-obsidian-inkPrimary">7 Cognitive Memory Subsystems</div>
                      <div className="text-[11px] text-obsidian-inkMuted">
                        Inspect working, semantic, episodic, procedural, retrieval, parametric, and prospective memories.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleClose();
                        setMemoryModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface4 text-obsidian-inkPrimary border border-obsidian-hairline text-xs font-mono transition-colors cursor-pointer"
                    >
                      <Brain className="w-3.5 h-3.5" />
                      <span>Open Vault</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: BROWSER */}
            {activeTab === 'browser' && (
              <div className="space-y-6 max-w-2xl">
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkMuted font-mono">
                    Live Web Preview & Simulation
                  </h4>
                  <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Default Viewport Simulation</div>
                        <div className="text-[11px] text-obsidian-inkMuted">Device dimensions used when launching preview.</div>
                      </div>
                      <div className="flex items-center p-0.5 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline">
                        {(['desktop', 'tablet', 'mobile'] as const).map((vp) => (
                          <button
                            key={vp}
                            type="button"
                            onClick={() => setPreviewViewport(vp)}
                            className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors cursor-pointer ${
                              previewViewport === vp
                                ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold shadow-xs'
                                : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
                            }`}
                          >
                            {vp}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-obsidian-hairline/60">
                      <div>
                        <div className="text-xs font-semibold text-obsidian-inkPrimary">Visual Element Inspector</div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Allow clicking elements in the live preview to dispatch targeted modification prompts.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={elementInspectorEnabled}
                        onChange={(e) => {
                          setElementInspectorEnabled(e.target.checked);
                          localStorage.setItem('sutra-element-inspector', e.target.checked ? '1' : '0');
                        }}
                        className="w-4 h-4 accent-obsidian-inkPrimary cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border border-obsidian-hairline bg-obsidian-surface1">
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-obsidian-inkPrimary flex items-center gap-2">
                          <img src="/assets/sutra-pet.jpg" alt="Pet" className="w-4 h-4 rounded-full object-cover" />
                          <span>SUTRA Cyber-Cat AI Pet Mascot</span>
                        </div>
                        <div className="text-[11px] text-obsidian-inkMuted">
                          Display the animated companion pet with live status, developer insights, and video animations.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={petEnabled}
                        onChange={(e) => {
                          setPetEnabled(e.target.checked);
                          localStorage.setItem('sutra-pet-visible', String(e.target.checked));
                          window.dispatchEvent(new CustomEvent('sutra-pet-toggle', { detail: e.target.checked }));
                        }}
                        className="w-4 h-4 accent-obsidian-inkPrimary cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
