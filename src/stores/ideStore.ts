import { create } from 'zustand';
import { OpenFileTab, SutraModel, SubagentState, PermissionLevel, HarnessMode, ToolCallPayload, SutraAgentMessage, ProjectAsset, PendingAgentQuestion, ReviewDiffEntry, VerificationReport, ArtifactItem } from '../types/ide.js';
import { audioSynth, MusicTrackId } from '../utils/audioSynth.js';

interface IDEState {
  // Tabs & File Editor
  openTabs: OpenFileTab[];
  activeTabPath: string | null;
  activeSidebar: 'explorer' | 'search' | 'swarm' | 'vault' | 'media' | 'git' | 'mobile' | 'settings' | 'artifacts' | 'outline';
  isTerminalOpen: boolean;
  isPreviewOpen: boolean;
  isSidebarOpen: boolean;
  /** IDE assistant panel visibility, kept across restarts. */
  isAgentPanelOpen: boolean;
  /** Manager-mode conversation sidebar visibility (persisted to localStorage). */
  isManagerSidebarOpen: boolean;
  agentPanelWidth: 'compact' | 'normal' | 'wide' | 'expanded';
  previewViewport: 'desktop' | 'tablet' | 'mobile';
  previewLayout: 'full' | 'split';
  activeCenterView: 'editor' | 'preview';
  previewUrl: string;
  sessionPreviewUrls: Record<string, string>;
  setPreviewLayout: (layout: 'full' | 'split') => void;
  togglePreviewLayout: () => void;
  setActiveCenterView: (view: 'editor' | 'preview') => void;

  // Workspace Path & Storage
  currentWorkspacePath: string;
  currentWorkspaceName: string;
  setCurrentWorkspacePath: (path: string) => void;
  fetchCurrentWorkspace: () => Promise<string>;
  switchWorkspace: (newPath: string) => Promise<{ success: boolean; error?: string }>;

  // Manager Mode & Session Pins
  uiMode: 'manager' | 'ide';
  pinnedSessionIds: string[];

  // AI & Models
  activeModel: SutraModel | null;
  availableModels: SutraModel[];
  permissionLevel: PermissionLevel;
  harnessMode: HarnessMode;
  agentMessages: SutraAgentMessage[];
  isAgentGenerating: boolean;
  currentAgentThinking: string;
  /** True when the live thinking trace is included in the next provider call.
   *  Toggling off saves context budget at the cost of a noisier run; the
   *  user can flip it mid-stream and the change applies on the next round. */
  sendThinkingToModel: boolean;
  /** Most recent streaming error (if any) so the UI can surface it next to
   *  the reasoning trace instead of dropping it on the floor. */
  lastThinkingError: string | null;

  // Subagents Swarm
  subagents: SubagentState[];
  /**
   * One-shot guard for the subagent auto-open: flips true the first time a run's
   * subagents appear (empty -> non-empty while generating), resets when the list
   * clears so the next run can open the tab again exactly once.
   */
  subagentsAutoOpened: boolean;
  pendingApprovals: ToolCallPayload[];

  // Run telemetry (provider retries + context usage)
  retryLog: Array<{ attempt: number; totalAttempts: number; provider: string; model: string; status: string; latencyMs: number; reason: string; at: number }>;
  lastRunUsage: { contextUsed: number; contextWindow: number; contextRemaining: number; outputTokens: number } | null;
  /** Evidence from the end-of-run verification stage of the most recent mutating run. */
  lastVerification: VerificationReport | null;
  setLastVerification: (report: VerificationReport | null) => void;
  addRetryEvent: (event: { attempt: number; totalAttempts: number; provider: string; model: string; status: string; latencyMs: number; reason: string }) => void;
  clearRetryLog: () => void;
  setLastRunUsage: (usage: { contextUsed: number; contextWindow: number; contextRemaining: number; outputTokens: number } | null) => void;

  // ask_user (agent parks its run and waits for the user's answer)
  pendingAgentQuestion: PendingAgentQuestion | null;

  // Manager Review flow: per-file before/after snapshots keyed by path,
  // captured from inline_diff packets during agent runs
  reviewDiffs: Record<string, ReviewDiffEntry>;

  // Media Assets
  assets: ProjectAsset[];

  // File Tree Refresh Signal
  fileTreeVersion: number;
  triggerFileTreeRefresh: () => void;

  // Editor Telemetry & Diagnostics (Cursor Parity)
  cursorPosition: { line: number; column: number } | null;
  selectedText: string;
  selectionRange: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
  visibleRange: { startLine: number; endLine: number } | null;
  activeFileDiagnostics: Array<{ message: string; severity: number; startLineNumber: number; endLineNumber: number }>;
  inlineDiffState: { path: string; originalContent: string; proposedContent: string; startLine?: number; endLine?: number } | null;

  // Composer Draft Injection
  composerDraft: string;
  setComposerDraft: (draft: string) => void;

  // Modals & Panels
  isCommandPaletteOpen: boolean;
  isFolderPickerOpen: boolean;
  isQRPairingOpen: boolean;
  isVaultModalOpen: boolean;
  isAssetStudioOpen: boolean;
  isSettingsOpen: boolean;
  isGuideOpen: boolean;
  isCoffeeModalOpen: boolean;
  setCoffeeModalOpen: (open: boolean) => void;
  isSkillsModalOpen: boolean;
  setSkillsModalOpen: (open: boolean) => void;
  isMemoryModalOpen: boolean;
  setMemoryModalOpen: (open: boolean) => void;

  // Lo-Fi Coding Music & Ambient Player
  isMusicEnabled: boolean;
  isMusicPlaying: boolean;
  musicVolume: number;
  musicTrack: MusicTrackId;
  setMusicEnabled: (enabled: boolean) => void;
  setMusicPlaying: (playing: boolean) => void;
  setMusicVolume: (volume: number) => void;
  setMusicTrack: (track: MusicTrackId) => void;
  toggleMusicPlaying: () => void;

  // Actions
  openFile: (file: { path: string; name: string; content: string; language?: string }) => void;
  openFilePath: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  closeOtherTabs: (path: string) => void;
  closeAllTabs: () => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  setActiveTab: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  markTabSaved: (path: string) => void;
  saveActiveFile: () => Promise<boolean>;
  saveAllFiles: () => Promise<boolean>;

  setEditorTelemetry: (telemetry: Partial<{
    cursorPosition: { line: number; column: number } | null;
    selectedText: string;
    selectionRange: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
    visibleRange: { startLine: number; endLine: number } | null;
    activeFileDiagnostics: Array<{ message: string; severity: number; startLineNumber: number; endLineNumber: number }>;
  }>) => void;
  setInlineDiff: (diff: IDEState['inlineDiffState']) => void;
  acceptInlineDiff: () => void;
  rejectInlineDiff: () => void;

  setActiveSidebar: (sidebar: IDEState['activeSidebar']) => void;
  toggleTerminal: () => void;
  togglePreview: () => void;
  toggleSidebar: () => void;
  toggleAgentPanel: () => void;
  setAgentPanelOpen: (isOpen: boolean) => void;
  toggleManagerSidebar: () => void;
  setManagerSidebarOpen: (isOpen: boolean) => void;
  setAgentPanelWidth: (width: 'compact' | 'normal' | 'wide' | 'expanded') => void;
  setPreviewViewport: (vp: 'desktop' | 'tablet' | 'mobile') => void;
  setPreviewUrl: (url: string, sessionId?: string) => void;
  getPreviewUrlForSession: (sessionId?: string) => string;
  setIsPreviewOpen: (open: boolean) => void;

  setUiMode: (mode: 'manager' | 'ide') => void;
  togglePinSession: (id: string) => void;

  setActiveModel: (model: SutraModel) => void;
  setAvailableModels: (models: SutraModel[]) => void;
  refreshAvailableModels: () => Promise<void>;
  setPermissionLevel: (level: PermissionLevel) => void;
  setHarnessMode: (mode: HarnessMode) => void;
  addAgentMessage: (msg: SutraAgentMessage) => void;
  updateLastMessageContent: (delta: string) => void;
  resetLastMessageContent: () => void;
  addToolCallsToLastMessage: (toolCalls: ToolCallPayload[]) => void;
  updateToolCallResult: (id: string, tool: string, result: any) => void;
  updateToolCallError: (id: string, tool: string, error: string) => void;
  updateAgentThinking: (thinking: string, append?: boolean) => void;
  appendAgentThinking: (delta: string) => void;
  setSendThinkingToModel: (send: boolean) => void;
  setLastThinkingError: (error: string | null) => void;
  setIsAgentGenerating: (generating: boolean) => void;

  setSubagents: (subagents: SubagentState[]) => void;
  setPendingApprovals: (
    approvals: ToolCallPayload[] | ((prev: ToolCallPayload[]) => ToolCallPayload[])
  ) => void;
  setAssets: (assets: ProjectAsset[]) => void;
  setPendingAgentQuestion: (question: PendingAgentQuestion | null) => void;
  recordReviewDiff: (entry: ReviewDiffEntry) => void;
  clearReviewDiffs: () => void;

  setCommandPaletteOpen: (open: boolean) => void;
  setFolderPickerOpen: (open: boolean) => void;
  setQRPairingOpen: (open: boolean) => void;
  setVaultModalOpen: (open: boolean) => void;
  setAssetStudioOpen: (open: boolean) => void;
  settingsTarget: { tab?: string; providerId?: string; category?: string; authMode?: 'api-key' | 'cookie' | 'oauth' } | null;
  setSettingsOpen: (open: boolean) => void;
  openSettingsWithTarget: (target: { tab?: string; providerId?: string; category?: string; authMode?: 'api-key' | 'cookie' | 'oauth' }) => void;
  setSettingsTarget: (target: { tab?: string; providerId?: string; category?: string; authMode?: 'api-key' | 'cookie' | 'oauth' } | null) => void;
  setGuideOpen: (open: boolean) => void;
  activeChatSessionId: string;
  setActiveChatSessionId: (id: string) => void;
  activeArtifactModal: ArtifactItem | null;
  setActiveArtifactModal: (artifact: ArtifactItem | null) => void;
}

export const useIDEStore = create<IDEState>((set, get) => ({
  openTabs: [],
  activeTabPath: null,
  activeSidebar: 'explorer',
  isTerminalOpen: false,
  isPreviewOpen: false,
  isSidebarOpen: true,
  isAgentPanelOpen: (() => {
    try {
      return localStorage.getItem('sutra-ide-agent-panel') !== '0';
    } catch {
      return true;
    }
  })(),
  // Manager-mode conversation sidebar. Kept in the store (not component state)
  // so the header slot and the panel read one source of truth; persisted the
  // same way as the IDE sidebar preference.
  isManagerSidebarOpen: (() => {
    try {
      return localStorage.getItem('sutra-manager-sidebar') !== '0';
    } catch {
      return true;
    }
  })(),
  agentPanelWidth: 'normal',
  previewViewport: 'desktop',
  previewLayout: 'full',
  activeCenterView: 'preview',
  previewUrl: '/preview',
  sessionPreviewUrls: {},

  // Workspace Path & Storage
  currentWorkspacePath: '',
  currentWorkspaceName: '',
  setCurrentWorkspacePath: (currentWorkspacePath) => {
    const currentWorkspaceName = extractWorkspaceName(currentWorkspacePath);
    set({ currentWorkspacePath, currentWorkspaceName });
  },
  fetchCurrentWorkspace: async () => {
    try {
      const res = await fetch('/api/fs/workspace');
      if (res.ok) {
        const data = await res.json();
        const wsPath = typeof data.workspaceRoot === 'string' ? data.workspaceRoot : typeof data.path === 'string' ? data.path : '';
        const wsName = (typeof data.name === 'string' && data.name) ? data.name : extractWorkspaceName(wsPath);
        if (wsPath) {
          set({ currentWorkspacePath: wsPath, currentWorkspaceName: wsName || extractWorkspaceName(wsPath) });
          return wsPath;
        }
      }
    } catch {
      // Fallback gracefully
    }
    return get().currentWorkspacePath;
  },
  switchWorkspace: async (newPath: string) => {
    try {
      const res = await fetch('/api/fs/set-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      const data = await res.json();
      if (data.success) {
        const targetPath = data.workspacePath || newPath;
        const targetName = extractWorkspaceName(targetPath);
        set((state) => ({
          currentWorkspacePath: targetPath,
          currentWorkspaceName: targetName,
          fileTreeVersion: state.fileTreeVersion + 1,
          openTabs: [],
          activeTabPath: null,
        }));
        return { success: true };
      }
      return { success: false, error: data.error || 'Failed to switch workspace' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error switching workspace' };
    }
  },

  isFolderPickerOpen: false,

  uiMode: hydrateUiMode(),
  pinnedSessionIds: hydrateStoredStringArray('sutra-pinned-sessions'),

  activeModel: hydrateActiveModel(),
  availableModels: [],
  permissionLevel: hydratePermissionMode(),
  harnessMode: hydrateHarnessMode(),
  agentMessages: [
    {
      id: 'msg-welcome',
      role: 'assistant',
      content: `I'm Astra — I read, write, and run code in your workspace. What are we building?`,
      timestamp: Date.now(),
    },
  ],
  isAgentGenerating: false,
  currentAgentThinking: '',
  // Default ON — most providers want the trace for reasoning quality. The
  // user can flip it off from the reasoning panel when context is tight.
  sendThinkingToModel: true,
  lastThinkingError: null,

  subagents: [],
  subagentsAutoOpened: false,
  pendingApprovals: [],
  assets: [],

  retryLog: [],
  lastRunUsage: null,
  lastVerification: null,
  addRetryEvent: (event) =>
    set((state) => ({
      retryLog: [...state.retryLog, { ...event, at: Date.now() }].slice(-50),
    })),
  clearRetryLog: () => set({ retryLog: [] }),
  setLastRunUsage: (lastRunUsage) => set({ lastRunUsage }),
  setLastVerification: (lastVerification) => set({ lastVerification }),
  pendingAgentQuestion: null,
  reviewDiffs: {},

  // Editor Telemetry & Diagnostics (Cursor Parity)
  cursorPosition: null,
  selectedText: '',
  selectionRange: null,
  visibleRange: null,
  activeFileDiagnostics: [],
  inlineDiffState: null,
  composerDraft: '',
  setComposerDraft: (composerDraft) => set({ composerDraft }),

  setEditorTelemetry: (telemetry) => set((state) => ({ ...state, ...telemetry })),
  setInlineDiff: (inlineDiffState) => set({ inlineDiffState }),
  acceptInlineDiff: () => {
    const state = get();
    if (!state.inlineDiffState) return;
    const { path, proposedContent } = state.inlineDiffState;
    state.updateTabContent(path, proposedContent);
    state.saveActiveFile();
    set({ inlineDiffState: null });
  },
  rejectInlineDiff: () => set({ inlineDiffState: null }),

  isCommandPaletteOpen: false,
  isQRPairingOpen: false,
  isVaultModalOpen: false,
  isAssetStudioOpen: false,
  isSettingsOpen: false,
  isGuideOpen: false,
  isCoffeeModalOpen: false,
  isSkillsModalOpen: false,
  setSkillsModalOpen: (open) => set({ isSkillsModalOpen: open }),
  isMemoryModalOpen: false,
  setMemoryModalOpen: (open) => set({ isMemoryModalOpen: open }),
  activeChatSessionId: '',
  setActiveChatSessionId: (id) => {
    const sessionUrl = get().sessionPreviewUrls[id];
    set({
      activeChatSessionId: id,
      ...(sessionUrl ? { previewUrl: sessionUrl } : {}),
    });
  },
  activeArtifactModal: null,
  isMusicEnabled: true,
  isMusicPlaying: false,
  musicVolume: 0.55,
  musicTrack: 'binaural_alpha',

  fileTreeVersion: 0,
  triggerFileTreeRefresh: () => set((state) => ({ fileTreeVersion: state.fileTreeVersion + 1 })),

  openFile: (file) =>
    set((state) => {
      const existing = state.openTabs.find((t) => t.path === file.path);
      if (existing) {
        return { activeTabPath: file.path };
      }
      const newTab: OpenFileTab = {
        path: file.path,
        name: file.name,
        content: file.content,
        isDirty: false,
        language: file.language || getLanguageFromPath(file.path),
      };
      return {
        openTabs: [...state.openTabs, newTab],
        activeTabPath: file.path,
        activeCenterView: 'editor',
      };
    }),

  openFilePath: async (rawPath: string) => {
    if (!rawPath || typeof rawPath !== 'string') return;
    let cleanPath = rawPath.trim().replace(/^file:\/\/\/?/i, '');
    let targetLine: number | null = null;
    const lineMatch = cleanPath.match(/(?::(\d+)(?::\d+)?|#L(\d+))$/);
    if (lineMatch) {
      targetLine = parseInt(lineMatch[1] || lineMatch[2], 10);
      cleanPath = cleanPath.replace(/(?::\d+(?::\d+)?|#L\d+)$/, '');
    }
    cleanPath = cleanPath.replace(/\\/g, '/');

    const state = useIDEStore.getState();
    const existing = state.openTabs.find((t) => t.path.replace(/\\/g, '/') === cleanPath);
    if (existing) {
      set({ activeTabPath: existing.path, activeCenterView: 'editor' });
      if (targetLine && targetLine > 0) {
        state.setEditorTelemetry({ cursorPosition: { line: targetLine, column: 1 } });
      }
      return;
    }
    try {
      const res = await fetch(`/api/fs/read?path=${encodeURIComponent(cleanPath)}`);
      if (!res.ok) {
        console.warn(`File does not exist or cannot be read: ${cleanPath} (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      if (typeof data.content !== 'string') return;
      const fileName = cleanPath.split('/').pop() || cleanPath;
      state.openFile({
        path: cleanPath,
        name: fileName,
        content: data.content,
      });
      set({ activeCenterView: 'editor' });
      if (targetLine && targetLine > 0) {
        state.setEditorTelemetry({ cursorPosition: { line: targetLine, column: 1 } });
      }
    } catch (err) {
      console.error('Failed to open file path:', err);
    }
  },

  closeTab: (path) =>
    set((state) => {
      const filtered = state.openTabs.filter((t) => t.path !== path);
      const nextActive =
        state.activeTabPath === path
          ? filtered.length > 0
            ? filtered[filtered.length - 1].path
            : null
          : state.activeTabPath;
      return {
        openTabs: filtered,
        activeTabPath: nextActive,
      };
    }),

  closeOtherTabs: (path) =>
    set((state) => ({
      openTabs: state.openTabs.filter((t) => t.path === path),
      activeTabPath: path,
    })),

  closeAllTabs: () => set({ openTabs: [], activeTabPath: null }),

  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.openTabs];
      if (fromIndex < 0 || fromIndex >= tabs.length || toIndex < 0 || toIndex >= tabs.length) {
        return state;
      }
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { openTabs: tabs };
    }),

  setActiveTab: (path) => set({ activeTabPath: path, activeCenterView: 'editor' }),

  updateTabContent: (path, content) =>
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.path === path ? { ...t, content, isDirty: true } : t
      ),
    })),

  markTabSaved: (path) =>
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.path === path ? { ...t, isDirty: false } : t
      ),
    })),

  saveActiveFile: async () => {
    const state = get();
    const active = state.openTabs.find((t) => t.path === state.activeTabPath);
    if (!active) return false;

    try {
      const res = await fetch('/api/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: active.path, content: active.content }),
      });
      if (res.ok) {
        state.markTabSaved(active.path);
        return true;
      }
    } catch (e) {
      console.error('Failed to save file:', e);
    }
    return false;
  },

  saveAllFiles: async () => {
    const state = get();
    const dirtyTabs = state.openTabs.filter((t) => t.isDirty);
    let allOk = true;

    for (const tab of dirtyTabs) {
      try {
        const res = await fetch('/api/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: tab.path, content: tab.content }),
        });
        if (res.ok) {
          state.markTabSaved(tab.path);
        } else {
          allOk = false;
        }
      } catch {
        allOk = false;
      }
    }
    return allOk;
  },

  setActiveSidebar: (sidebar) => set({ activeSidebar: sidebar }),
  toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen })),
  togglePreview: () =>
    set((state) => {
      const nextOpen = !state.isPreviewOpen;
      return {
        isPreviewOpen: nextOpen,
        previewLayout: 'full',
        ...(nextOpen ? { activeCenterView: 'preview' } : { activeCenterView: 'editor' }),
      };
    }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleAgentPanel: () =>
    set((state) => {
      const isAgentPanelOpen = !state.isAgentPanelOpen;
      try {
        localStorage.setItem('sutra-ide-agent-panel', isAgentPanelOpen ? '1' : '0');
      } catch {
        // Storage may be unavailable; preserve the session choice regardless.
      }
      return { isAgentPanelOpen };
    }),
  setAgentPanelOpen: (isAgentPanelOpen) => {
    try {
      localStorage.setItem('sutra-ide-agent-panel', isAgentPanelOpen ? '1' : '0');
    } catch {
      // Storage may be unavailable; preserve the session choice regardless.
    }
    set({ isAgentPanelOpen });
  },
  toggleManagerSidebar: () =>
    set((state) => {
      const next = !state.isManagerSidebarOpen;
      try {
        localStorage.setItem('sutra-manager-sidebar', next ? '1' : '0');
      } catch {
        // Storage unavailable — the choice still applies for this session
      }
      return { isManagerSidebarOpen: next };
    }),
  setManagerSidebarOpen: (isManagerSidebarOpen) => {
    try {
      localStorage.setItem('sutra-manager-sidebar', isManagerSidebarOpen ? '1' : '0');
    } catch {
      // Storage unavailable
    }
    set({ isManagerSidebarOpen });
  },
  setAgentPanelWidth: (agentPanelWidth) => set({ agentPanelWidth }),
  setPreviewViewport: (previewViewport) => set({ previewViewport }),
  setPreviewLayout: (previewLayout) => set({ previewLayout }),
  togglePreviewLayout: () => set((state) => ({ previewLayout: state.previewLayout === 'full' ? 'split' : 'full' })),
  setActiveCenterView: (activeCenterView) => set({ activeCenterView }),
  setPreviewUrl: (previewUrl, sessionId) => {
    // Sanitize any foreign port 8081 (Antigravity proxy) back to /workspace/index.html
    const cleanUrl = previewUrl && previewUrl.includes(':8081') ? '/workspace/index.html' : previewUrl;
    const targetSession = sessionId || get().activeChatSessionId;
    if (targetSession) {
      set((state) => ({
        sessionPreviewUrls: { ...state.sessionPreviewUrls, [targetSession]: cleanUrl },
        ...(sessionId && sessionId !== state.activeChatSessionId ? {} : { previewUrl: cleanUrl }),
      }));
    } else {
      set({ previewUrl: cleanUrl });
    }
  },
  getPreviewUrlForSession: (sessionId) => {
    const state = get();
    if (sessionId && state.sessionPreviewUrls[sessionId]) {
      const url = state.sessionPreviewUrls[sessionId];
      return url.includes(':8081') ? '/workspace/index.html' : url;
    }
    const current = state.previewUrl || '/preview';
    return current.includes(':8081') ? '/workspace/index.html' : current;
  },
  setIsPreviewOpen: (isPreviewOpen) =>
    set({
      isPreviewOpen,
      previewLayout: 'full',
      ...(isPreviewOpen ? { activeCenterView: 'preview' } : { activeCenterView: 'editor' }),
    }),

  setUiMode: (uiMode) => {
    try {
      localStorage.setItem('sutra-ui-mode', uiMode);
    } catch {
      // Storage unavailable (private mode / quota) — mode still applies for this session
    }
    set({ uiMode });
  },
  togglePinSession: (id) =>
    set((state) => {
      const pinnedSessionIds = state.pinnedSessionIds.includes(id)
        ? state.pinnedSessionIds.filter((p) => p !== id)
        : [...state.pinnedSessionIds, id];
      try {
        localStorage.setItem('sutra-pinned-sessions', JSON.stringify(pinnedSessionIds));
      } catch {
        // Storage unavailable — pin state stays in-memory only
      }
      return { pinnedSessionIds };
    }),

  setActiveModel: (activeModel) => {
    try {
      localStorage.setItem('sutra-active-model', JSON.stringify(activeModel));
    } catch {
      // Best-effort persistence
    }
    fetch('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: activeModel.id,
        provider: activeModel.provider,
        fullId: `${activeModel.provider}:${activeModel.id}`,
      }),
    }).catch(() => undefined);
    set({ activeModel });
  },
  setAvailableModels: (availableModels) => set({ availableModels }),
  refreshAvailableModels: async () => {
    try {
      const res = await fetch('/api/models');
      if (!res.ok) return;
      const data = await res.json();
      const models = data?.models || [];
      if (Array.isArray(models) && models.length > 0) {
        set({ availableModels: models });
      }
    } catch {
      // Storage/network unavailable
    }
  },
  setPermissionLevel: (permissionLevel) => {
    try {
      localStorage.setItem('sutra-permission-mode', permissionLevel);
    } catch {
      // Storage unavailable — the mode still applies for this session
    }
    set({ permissionLevel });
  },
  setHarnessMode: (harnessMode) => {
    try {
      localStorage.setItem('sutra-harness-mode', harnessMode);
    } catch {
      // Storage unavailable
    }
    set({ harnessMode });
  },
  addAgentMessage: (msg) => set((state) => ({ agentMessages: [...state.agentMessages, msg] })),
  updateLastMessageContent: (delta) =>
    set((state) => {
      const last = state.agentMessages[state.agentMessages.length - 1];
      if (!last || last.role !== 'assistant') return state;
      const updated = { ...last, content: last.content + delta };
      return {
        agentMessages: [...state.agentMessages.slice(0, -1), updated],
      };
    }),
  resetLastMessageContent: () =>
    set((state) => {
      const last = state.agentMessages[state.agentMessages.length - 1];
      if (!last || last.role !== 'assistant' || !last.content) return state;
      return {
        agentMessages: [...state.agentMessages.slice(0, -1), { ...last, content: '' }],
      };
    }),
  addToolCallsToLastMessage: (toolCalls: ToolCallPayload[]) =>
    set((state) => {
      const last = state.agentMessages[state.agentMessages.length - 1];
      if (!last || last.role !== 'assistant') return state;
      const existing = last.toolCalls || [];
      const updatedCalls = [...existing];
      for (const tc of toolCalls) {
        if (!updatedCalls.some(c => c.id === tc.id)) {
          updatedCalls.push(tc);
        }
      }
      const updated = { ...last, toolCalls: updatedCalls };
      return {
        agentMessages: [...state.agentMessages.slice(0, -1), updated],
      };
    }),
  updateToolCallResult: (id: string, tool: string, result: any) =>
    set((state) => {
      const last = state.agentMessages[state.agentMessages.length - 1];
      if (!last || last.role !== 'assistant' || !last.toolCalls) return state;
      const updatedCalls = last.toolCalls.map(tc => {
        // Match by id only — sibling calls of the same tool must not be marked complete
        if (tc.id === id) {
          return { ...tc, status: 'completed' as const, result };
        }
        return tc;
      });
      return {
        agentMessages: [...state.agentMessages.slice(0, -1), { ...last, toolCalls: updatedCalls }],
      };
    }),
  updateToolCallError: (id: string, tool: string, error: string) =>
    set((state) => {
      const last = state.agentMessages[state.agentMessages.length - 1];
      if (!last || last.role !== 'assistant' || !last.toolCalls) return state;
      const updatedCalls = last.toolCalls.map(tc => {
        // Match by id only — sibling calls of the same tool must not be marked failed
        if (tc.id === id) {
          return { ...tc, status: 'failed' as const, error };
        }
        return tc;
      });
      return {
        agentMessages: [...state.agentMessages.slice(0, -1), { ...last, toolCalls: updatedCalls }],
      };
    }),
  appendAgentThinking: (delta) =>
    set((state) => ({ currentAgentThinking: (state.currentAgentThinking || '') + delta })),
  updateAgentThinking: (thinking, append = false) =>
    set((state) => ({
      currentAgentThinking: append ? (state.currentAgentThinking || '') + thinking : thinking,
    })),
  setSendThinkingToModel: (send) => set({ sendThinkingToModel: send }),
  setLastThinkingError: (error) => set({ lastThinkingError: error }),
  setIsAgentGenerating: (isAgentGenerating) => set({ isAgentGenerating }),

  setSubagents: (subagents) => {
    const state = get();
    const prevCount = state.subagents.length;
    const nextCount = subagents.length;
    // Auto-open the subagents tab once per run: first event of a run is the
    // empty -> non-empty transition while Astra is actively generating. The
    // guard resets when the list clears so a later run can open it again.
    if (prevCount === 0 && nextCount > 0 && !state.subagentsAutoOpened && state.isAgentGenerating) {
      set({ subagents, subagentsAutoOpened: true, activeSidebar: 'swarm' });
      return;
    }
    if (nextCount === 0 && state.subagentsAutoOpened) {
      set({ subagents, subagentsAutoOpened: false });
      return;
    }
    set({ subagents });
  },
  setPendingApprovals: (approvals) =>
    set((state) => ({
      pendingApprovals: typeof approvals === 'function' ? approvals(state.pendingApprovals) : approvals,
    })),
  setAssets: (assets) => set({ assets }),
  setPendingAgentQuestion: (pendingAgentQuestion) => set({ pendingAgentQuestion }),
  recordReviewDiff: (entry) =>
    set((state) => ({
      reviewDiffs: { ...state.reviewDiffs, [entry.path]: entry },
    })),
  clearReviewDiffs: () => set({ reviewDiffs: {} }),

  setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),
  setFolderPickerOpen: (isFolderPickerOpen) => set({ isFolderPickerOpen }),
  setQRPairingOpen: (isQRPairingOpen) => set({ isQRPairingOpen }),
  setVaultModalOpen: (isVaultModalOpen) => set({ isVaultModalOpen }),
  setAssetStudioOpen: (isAssetStudioOpen) => set({ isAssetStudioOpen }),
  settingsTarget: null,
  setSettingsTarget: (settingsTarget) => set({ settingsTarget }),
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen, settingsTarget: isSettingsOpen ? get().settingsTarget : null }),
  openSettingsWithTarget: (settingsTarget) => set({ isSettingsOpen: true, settingsTarget }),
  setGuideOpen: (isGuideOpen) => set({ isGuideOpen }),
  setCoffeeModalOpen: (isCoffeeModalOpen) => set({ isCoffeeModalOpen }),
  setActiveArtifactModal: (activeArtifactModal) => set({ activeArtifactModal }),

  setMusicEnabled: (isMusicEnabled) => {
    set({ isMusicEnabled });
    if (!isMusicEnabled) audioSynth.stop();
  },
  setMusicPlaying: (isMusicPlaying) => {
    set({ isMusicPlaying });
    if (isMusicPlaying) {
      audioSynth.play(get().musicTrack);
    } else {
      audioSynth.stop();
    }
  },
  setMusicVolume: (musicVolume) => {
    set({ musicVolume });
    audioSynth.setVolume(musicVolume);
  },
  setMusicTrack: (musicTrack) => {
    set({ musicTrack });
    if (get().isMusicPlaying) {
      audioSynth.play(musicTrack);
    }
  },
  toggleMusicPlaying: () => {
    const next = !get().isMusicPlaying;
    set({ isMusicPlaying: next });
    if (next) {
      audioSynth.play(get().musicTrack);
    } else {
      audioSynth.stop();
    }
  },
}));

function hydrateUiMode(): 'manager' | 'ide' {
  try {
    const stored = localStorage.getItem('sutra-ui-mode');
    return stored === 'ide' || stored === 'manager' ? stored : 'manager';
  } catch {
    return 'manager';
  }
}

function hydrateActiveModel(): SutraModel {
  try {
    const raw = localStorage.getItem('sutra-active-model');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
        return parsed as SutraModel;
      }
    }
  } catch {
    // Fall back to default
  }
  return {
    id: 'auto',
    name: 'SUTRA Auto',
    provider: 'sutra',
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'SUTRA automatic multi-provider routing gateway.',
  };
}

/** Restores the permission mode, migrating legacy values ('allow_all' -> 'full'); defaults to 'full' */
function hydratePermissionMode(): PermissionLevel {
  try {
    const stored = localStorage.getItem('sutra-permission-mode');
    if (stored === 'strict') return 'strict';
    if (stored === 'full' || stored === 'allow_all') return 'full';
    return 'full';
  } catch {
    return 'full';
  }
}

function hydrateHarnessMode(): HarnessMode {
  try {
    const stored = localStorage.getItem('sutra-harness-mode');
    return stored === 'avo' ? 'avo' : 'standard';
  } catch {
    return 'standard';
  }
}

function hydrateStoredStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v: unknown) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Stable fingerprint of a model catalog (sorted ids). Pollers compare this
 * before calling setAvailableModels so an unchanged catalog never triggers a
 * store write — the fix for the model dropdown re-render/flicker loop.
 */
export function modelCatalogSignature(models: SutraModel[]): string {
  return JSON.stringify(
    models
      .map((m) => `${m.provider}:${m.id}:${m.name}:${m.contextWindow || 0}:${m.baseUrl || ''}`)
      .sort()
  );
}

function getLanguageFromPath(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
  if (filePath.endsWith('.html')) return 'html';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.md')) return 'markdown';
  if (filePath.endsWith('.rs')) return 'rust';
  if (filePath.endsWith('.go')) return 'go';
  if (filePath.endsWith('.sh') || filePath.endsWith('.bat') || filePath.endsWith('.ps1')) return 'shell';
  return 'plaintext';
}

export function extractWorkspaceName(wsPath: string): string {
  if (!wsPath) return '';
  const clean = wsPath.trim().replace(/[/\\]+$/, '');
  const parts = clean.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || 'omnicraft-ide';
}
