import { create } from 'zustand';
import { OpenFileTab, OmniModel, SubagentState, PermissionLevel, ToolCallPayload, OmniAgentMessage, ProjectAsset, PendingAgentQuestion, ReviewDiffEntry, VerificationReport } from '../types/ide.js';

interface IDEState {
  // Tabs & File Editor
  openTabs: OpenFileTab[];
  activeTabPath: string | null;
  activeSidebar: 'explorer' | 'search' | 'swarm' | 'vault' | 'media' | 'git' | 'mobile' | 'settings';
  isTerminalOpen: boolean;
  isPreviewOpen: boolean;
  isSidebarOpen: boolean;
  isAgentPanelOpen: boolean;
  agentPanelWidth: 'compact' | 'normal' | 'wide' | 'expanded';
  previewViewport: 'desktop' | 'tablet' | 'mobile';
  previewUrl: string;

  // Manager Mode & Session Pins
  uiMode: 'manager' | 'ide';
  pinnedSessionIds: string[];

  // AI & Models
  activeModel: OmniModel | null;
  availableModels: OmniModel[];
  permissionLevel: PermissionLevel;
  agentMessages: OmniAgentMessage[];
  isAgentGenerating: boolean;
  currentAgentThinking: string;

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

  // Editor Telemetry & Diagnostics (Cursor Parity)
  cursorPosition: { line: number; column: number } | null;
  selectedText: string;
  selectionRange: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
  visibleRange: { startLine: number; endLine: number } | null;
  activeFileDiagnostics: Array<{ message: string; severity: number; startLineNumber: number; endLineNumber: number }>;
  inlineDiffState: { path: string; originalContent: string; proposedContent: string; startLine?: number; endLine?: number } | null;

  // Modals & Panels
  isCommandPaletteOpen: boolean;
  isQRPairingOpen: boolean;
  isVaultModalOpen: boolean;
  isAssetStudioOpen: boolean;
  isSettingsOpen: boolean;
  isGuideOpen: boolean;

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
  setAgentPanelWidth: (width: 'compact' | 'normal' | 'wide' | 'expanded') => void;
  setPreviewViewport: (vp: 'desktop' | 'tablet' | 'mobile') => void;
  setPreviewUrl: (url: string) => void;

  setUiMode: (mode: 'manager' | 'ide') => void;
  togglePinSession: (id: string) => void;

  setActiveModel: (model: OmniModel) => void;
  setAvailableModels: (models: OmniModel[]) => void;
  setPermissionLevel: (level: PermissionLevel) => void;
  addAgentMessage: (msg: OmniAgentMessage) => void;
  updateLastMessageContent: (delta: string) => void;
  resetLastMessageContent: () => void;
  addToolCallsToLastMessage: (toolCalls: ToolCallPayload[]) => void;
  updateToolCallResult: (id: string, tool: string, result: any) => void;
  updateToolCallError: (id: string, tool: string, error: string) => void;
  updateAgentThinking: (thinking: string) => void;
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
  setQRPairingOpen: (open: boolean) => void;
  setVaultModalOpen: (open: boolean) => void;
  setAssetStudioOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setGuideOpen: (open: boolean) => void;
}

export const useIDEStore = create<IDEState>((set, get) => ({
  openTabs: [],
  activeTabPath: null,
  activeSidebar: 'explorer',
  isTerminalOpen: false,
  isPreviewOpen: false,
  isSidebarOpen: true,
  isAgentPanelOpen: true,
  agentPanelWidth: 'normal',
  previewViewport: 'desktop',
  previewUrl: '/preview',

  uiMode: hydrateUiMode(),
  pinnedSessionIds: hydrateStoredStringArray('sutra-pinned-sessions'),

  activeModel: {
    id: 'auto',
    name: 'SUTRA Auto',
    provider: 'sutra',
    contextWindow: 128000,
    supportsVision: true,
    supportsTools: true,
    costPer1kTokens: { input: 0, output: 0 },
    description: 'SUTRA automatic multi-provider routing gateway.',
  },
  availableModels: [],
  permissionLevel: hydratePermissionMode(),
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
      };
    }),

  openFilePath: async (filePath: string) => {
    const state = useIDEStore.getState();
    const existing = state.openTabs.find((t) => t.path === filePath);
    if (existing) {
      set({ activeTabPath: filePath });
      return;
    }
    try {
      const res = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      state.openFile({
        path: filePath,
        name: fileName,
        content: data.content || '',
      });
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

  setActiveTab: (path) => set({ activeTabPath: path }),

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
  togglePreview: () => set((state) => ({ isPreviewOpen: !state.isPreviewOpen })),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleAgentPanel: () => set((state) => ({ isAgentPanelOpen: !state.isAgentPanelOpen })),
  setAgentPanelWidth: (agentPanelWidth) => set({ agentPanelWidth }),
  setPreviewViewport: (previewViewport) => set({ previewViewport }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),

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

  setActiveModel: (activeModel) => set({ activeModel }),
  setAvailableModels: (availableModels) => set({ availableModels }),
  setPermissionLevel: (permissionLevel) => {
    try {
      localStorage.setItem('sutra-permission-mode', permissionLevel);
    } catch {
      // Storage unavailable — the mode still applies for this session
    }
    set({ permissionLevel });
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
  updateAgentThinking: (thinking) => set({ currentAgentThinking: thinking }),
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
  setQRPairingOpen: (isQRPairingOpen) => set({ isQRPairingOpen }),
  setVaultModalOpen: (isVaultModalOpen) => set({ isVaultModalOpen }),
  setAssetStudioOpen: (isAssetStudioOpen) => set({ isAssetStudioOpen }),
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  setGuideOpen: (isGuideOpen) => set({ isGuideOpen }),
}));

function hydrateUiMode(): 'manager' | 'ide' {
  try {
    const stored = localStorage.getItem('sutra-ui-mode');
    return stored === 'ide' || stored === 'manager' ? stored : 'manager';
  } catch {
    return 'manager';
  }
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
export function modelCatalogSignature(models: OmniModel[]): string {
  return JSON.stringify(models.map((m) => m.id).sort());
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
