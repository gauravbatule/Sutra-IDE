import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Cpu, FileText, FlaskConical, Mic, Paperclip, Sparkles, Square, Wrench, X, Navigation, Loader2 } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { ModelSelectorDropdown } from '../Common/ModelSelectorDropdown.js';
import { useVoiceInput } from '../../hooks/useVoiceInput.js';
import { steerAgentStream } from '../../utils/agentSocket.js';

interface AttachedFile {
  name: string;
  content: string;
}

interface McpServerStatus {
  name: string;
  status: 'connected' | 'error' | 'disabled';
}

interface ManagerComposerProps {
  isGenerating: boolean;
  onSend: (text: string, attachment: AttachedFile | null, images: string[], mode?: 'build' | 'plan' | 'edit' | 'chat') => void;
  onCancel: () => void;
  /** Shows the "or simply:" suggestion chips above the composer (empty/conversation-start state). */
  showQuickActions?: boolean;
}

const MAX_ATTACHMENT_CHARS = 20000;

/** The execution mode dropdown. Icons + hint copy so users can tell the four
 *  options apart at a glance instead of reading tiny text. Kept in lock-step
 *  with HeroComposer so the two composers always tell the same story. */
const MODE_OPTIONS: Array<{
  id: 'build' | 'plan' | 'edit' | 'chat';
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  hint: string;
}> = [
  { id: 'build', label: 'Build', Icon: Wrench, hint: 'Read, write, run — full tool loop' },
  { id: 'plan', label: 'Plan', Icon: FlaskConical, hint: 'Design before mutating files' },
  { id: 'edit', label: 'Edit', Icon: Wrench, hint: 'Smallest targeted change' },
  { id: 'chat', label: 'Chat', Icon: Cpu, hint: 'Read-only Q&A, no tool calls' },
];

const QUICK_ACTIONS = [
  'Fix all errors in this project',
  'Explain this codebase',
  'Audit code quality & visual QA',
  'Write tests for this project',
  'Optimize performance & bundle',
  'Add a new feature',
];

/** Local persistence key for which MCP servers the user has paused.
 *  Disabled servers stay connected on the server but their tools are not
 *  exposed to the agent on the next run — Fitts's law: a per-row toggle is
 *  the right affordance for "kill this one connection without affecting
 *  the others". */
const MCP_DISABLED_KEY = 'sutra-mcp-disabled';

const readDisabledServers = (): Set<string> => {
  try {
    const raw = localStorage.getItem(MCP_DISABLED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []);
  } catch {
    return new Set();
  }
};

const writeDisabledServers = (set: Set<string>) => {
  try {
    localStorage.setItem(MCP_DISABLED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Best-effort
  }
};

/**
 * MCP status pill per the /api/mcp/status contract: dot + server count when
 * connected, red dot + "MCP error" when any server errors, hidden entirely
 * when zero servers are configured. Click opens Settings. Fetches on mount,
 * on Settings close, every 30s while visible, and on visibilitychange.
 *
 * The dropdown now exposes a per-server enable toggle (Pareto: 20% of the
 * tools handle 80% of the work — letting the user silence the rest is
 * what keeps the model's tool list from getting noisy).
 */
export const McpStatusPill: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [disabled, setDisabled] = useState<Set<string>>(() => readDisabledServers());
  const isSettingsOpen = useIDEStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useIDEStore((s) => s.setSettingsOpen);
  const prevSettingsOpenRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(() => {
    let active = true;
    fetch('/api/mcp/status')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data) => {
        if (active) setServers(Array.isArray(data?.servers) ? data.servers : []);
      })
      .catch(() => {
        if (active) setServers([]);
      });
    return () => { active = false; };
  }, []);

  // Initial fetch + 30s poll while the tab is visible; visibility-aware
  useEffect(() => {
    if (document.visibilityState === 'visible') loadStatus();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadStatus();
    }, 30000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadStatus();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadStatus]);

  // Refetch right after Settings closes (server config may have changed)
  useEffect(() => {
    if (prevSettingsOpenRef.current && !isSettingsOpen) loadStatus();
    prevSettingsOpenRef.current = isSettingsOpen;
  }, [isSettingsOpen, loadStatus]);

  // Listen for any other tab/window mutating the disabled list (Settings
  // reuses the same storage key) so the pill stays in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MCP_DISABLED_KEY) setDisabled(readDisabledServers());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Click outside and Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggleServer = (name: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      writeDisabledServers(next);
      return next;
    });
  };

  if (!servers || servers.length === 0) return null;

  const hasError = servers.some((s) => s.status === 'error');
  const connectedCount = servers.filter((s) => s.status === 'connected' && !disabled.has(s.name)).length;
  const disabledCount = servers.filter((s) => disabled.has(s.name)).length;
  const totalCount = servers.length;

  return (
    <div className={`hidden sm:block relative ${className}`} ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={hasError ? 'MCP connection status has an error' : `${connectedCount} MCP server available`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={hasError ? 'Review MCP connection status' : `${connectedCount} MCP server${connectedCount === 1 ? '' : 's'} available`}
        className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-obsidian-hairline hover:border-obsidian-borderBright bg-obsidian-surface1 hover:bg-obsidian-surface2 text-[11px] font-mono text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border select-none shadow-xs active:scale-[0.98]"
      >
        <Wrench className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
        <span>{hasError ? 'Connections' : disabledCount > 0 ? `Tools · ${connectedCount}/${totalCount}` : `Tools · ${connectedCount}`}</span>
        <ChevronDown className={`w-3 h-3 text-obsidian-inkMuted transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div role="menu" className="absolute bottom-full left-0 mb-2 z-50 min-w-72 glass-dropdown p-2 anim-appear border border-obsidian-border shadow-2xl rounded-xl backdrop-blur-xl">
          <div className="px-2 py-1.5 border-b border-obsidian-hairline text-[9px] font-mono uppercase tracking-[0.14em] text-obsidian-inkMuted flex items-center justify-between mb-1">
            <span className="font-semibold text-obsidian-inkPrimary flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-cyan-400" />
              <span>Connected Tools</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-obsidian-inkFaint normal-case tracking-normal">{disabledCount > 0 ? `${disabledCount} paused` : 'click to pause'}</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
                title="Close Tools Menu (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {servers.map((server) => {
              const isPaused = disabled.has(server.name);
              return (
                <div
                  key={server.name}
                  className="px-2.5 py-1.5 flex items-center justify-between gap-3 text-[11px] font-mono hover:bg-obsidian-surface3 rounded-lg transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className={`truncate font-medium ${isPaused ? 'text-obsidian-inkFaint line-through' : 'text-obsidian-inkPrimary'}`}>
                      {server.name}
                    </div>
                    <div className="text-[9px] uppercase text-obsidian-inkMuted tracking-wider">
                      {server.status}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!isPaused}
                    aria-label={`${isPaused ? 'Enable' : 'Disable'} ${server.name} for the next agent run`}
                    title={isPaused ? 'Enable this tool for the next run' : 'Disable this tool for the next run'}
                    onClick={() => toggleServer(server.name)}
                    className={`relative w-7 h-4 rounded-full transition-colors cursor-pointer shrink-0 ${
                      isPaused ? 'bg-obsidian-surface1 border border-obsidian-hairline' : 'bg-cyan-500'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 ${isPaused ? 'left-0.5 bg-obsidian-inkMuted' : 'left-3.5 bg-white'} w-3 h-3 rounded-full shadow-xs transition-all`}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="border-t border-obsidian-hairline mt-1.5 pt-1.5 flex items-center justify-between px-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => { setIsOpen(false); setSettingsOpen(true); }}
              className="text-[10px] text-cyan-400 hover:underline cursor-pointer font-medium"
            >
              Manage connections…
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-2 py-0.5 rounded text-[10px] bg-obsidian-surface1 hover:bg-obsidian-surface3 text-obsidian-inkSecondary border border-obsidian-hairline transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Context @ Mentions: typing "@" opens interactive workspace context selector */
interface ContextMentionItem {
  id: string;
  token: string;
  name: string;
  desc: string;
  badge: string;
}

const BASE_MENTIONS: ContextMentionItem[] = [
  { id: 'git-diff', token: '@git:diff', name: 'Git Diff', desc: 'Uncommitted working tree changes', badge: 'GIT' },
  { id: 'git-status', token: '@git:status', name: 'Git Status', desc: 'Modified, staged & untracked files', badge: 'GIT' },
  { id: 'problems', token: '@problems', name: 'Diagnostics', desc: 'Active TypeScript / LSP syntax and type errors', badge: 'LSP' },
  { id: 'terminal', token: '@terminal', name: 'Terminal', desc: 'Recent shell command execution output & stderr', badge: 'CLI' },
  { id: 'codebase', token: '@codebase:symbols', name: 'Codebase Symbols', desc: 'AST index map of all symbols & classes', badge: 'AST' },
  { id: 'file', token: '@file:', name: 'Attach File', desc: 'Attach exact file contents into context', badge: 'FILE' },
  { id: 'folder', token: '@folder:', name: 'Attach Folder', desc: 'Attach directory structure into context', badge: 'DIR' },
  { id: 'web', token: '@web:', name: 'Live Web Query', desc: 'Search documentation or live web data directly', badge: 'SEARCH' },
  { id: 'docs', token: '@docs:', name: 'Framework Docs', desc: 'Look up React, Node, Tailwind, or Python docs', badge: 'DOCS' },
];

/** Slash commands: typing "/" opens a selectable menu; Enter/Tab picks, Esc closes. */
const SLASH_COMMANDS: Array<{ cmd: string; desc: string; template: string; badge?: string }> = [
  { cmd: '/godmode', desc: 'Continuous highest-rigor autonomous engineering mode', template: '/godmode ', badge: 'RIGOR' },
  { cmd: '/goal', desc: 'Autonomous loop — keep working until objective is verified', template: '/goal ', badge: 'LOOP' },
  { cmd: '/plan', desc: 'Plan the approach first, then wait for confirmation', template: '/plan ', badge: 'PLAN' },
  { cmd: '/skills', desc: 'Open workspace skills & custom guidelines manager', template: '/skills ', badge: 'SKILLS' },
  { cmd: '/fix', desc: 'Find and fix every error in the project', template: '/fix ', badge: 'HEAL' },
  { cmd: '/test', desc: 'Write and run comprehensive test suites', template: '/test ', badge: 'VERIFY' },
  { cmd: '/browser', desc: 'Live web search, doc lookup, and web research', template: '/browser ', badge: 'WEB' },
  { cmd: '/explain', desc: 'Explain how this codebase works, structure & entry points', template: '/explain ', badge: 'DOCS' },
  { cmd: '/refactor', desc: 'Clean up code architecture and eliminate technical debt', template: '/refactor ', badge: 'SWE' },
  { cmd: '/schedule', desc: 'Schedule recurring background cron or one-shot timer', template: '/schedule ', badge: 'TIMER' },
  { cmd: '/grill-me', desc: 'Interactive interview to align on design decisions', template: '/grill-me ', badge: 'DESIGN' },
  { cmd: '/learn', desc: 'Persist custom preferences & agent behavior rules', template: '/learn ', badge: 'MEMORY' },
];

export const ManagerComposer: React.FC<ManagerComposerProps> = ({ isGenerating, onSend, onCancel, showQuickActions = false }) => {
  const permissionLevel = useIDEStore((s) => s.permissionLevel);
  const harnessMode = useIDEStore((s) => s.harnessMode);
  const setHarnessMode = useIDEStore((s) => s.setHarnessMode);
  const setSkillsModalOpen = useIDEStore((s) => s.setSkillsModalOpen);
  const composerDraft = useIDEStore((s) => s.composerDraft);
  const setComposerDraft = useIDEStore((s) => s.setComposerDraft);
  const openTabs = useIDEStore((s) => s.openTabs);
  const [dynamicSymbols, setDynamicSymbols] = useState<ContextMentionItem[]>([]);
  const [showAvoModal, setShowAvoModal] = useState(false);
  const [value, setValue] = useState('');
  const [agentMode, setAgentMode] = useState<'build' | 'plan' | 'edit' | 'chat'>('build');
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [attachment, setAttachment] = useState<AttachedFile | null>(null);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [atIndex, setAtIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationBaseRef = useRef('');

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const minHeight = 42;
    const maxHeight = 192;
    const target = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${target}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    if (composerDraft) {
      setValue(composerDraft);
      setComposerDraft('');
      requestAnimationFrame(() => {
        autosize();
        textareaRef.current?.focus();
      });
    }
  }, [composerDraft, setComposerDraft, autosize]);

  // Slash menu is live while the first token is still being typed
  const slashQuery = !slashDismissed && value.startsWith('/') && !value.includes(' ') ? value.slice(1).toLowerCase() : null;
  const slashMatches = slashQuery === null ? [] : SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(slashQuery));
  const slashOpen = slashMatches.length > 0;

  // @ Context Mentions autocomplete is live when cursor follows an @ token
  const atMatch = !slashOpen && value.match(/(?:^|\s)@([a-z0-9_:/.-]*)$/i);
  const atQuery = atMatch ? atMatch[1].toLowerCase() : null;

  // Dynamically fetch matching symbols from AST indexer when user searches @query
  useEffect(() => {
    if (!atQuery || atQuery.length < 2) {
      setDynamicSymbols([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/codebase/symbols?query=${encodeURIComponent(atQuery)}&limit=10`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          if (cancelled || !Array.isArray(data?.symbols)) return;
          const mapped: ContextMentionItem[] = data.symbols.map((sym: any) => ({
            id: `sym-${sym.name}-${sym.line}`,
            token: `@symbol:${sym.name}`,
            name: sym.name,
            desc: `${sym.kind} · ${sym.filePath}:${sym.line}`,
            badge: 'SYM',
          }));
          setDynamicSymbols(mapped);
        })
        .catch(() => {
          if (!cancelled) setDynamicSymbols([]);
        });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [atQuery]);

  const openTabMentions: ContextMentionItem[] = openTabs.map((t) => ({
    id: `tab-${t.path}`,
    token: `@file:${t.path}`,
    name: t.name,
    desc: t.path,
    badge: 'TAB',
  }));

  const combinedMentions: ContextMentionItem[] = [
    ...openTabMentions,
    ...BASE_MENTIONS,
    ...dynamicSymbols,
  ];

  const atMatches =
    atQuery === null
      ? []
      : combinedMentions.filter(
          (m) =>
            m.token.toLowerCase().includes(atQuery) ||
            m.name.toLowerCase().includes(atQuery) ||
            m.desc.toLowerCase().includes(atQuery) ||
            m.id.toLowerCase().includes(atQuery)
        ).slice(0, 15);
  const atOpen = atMatches.length > 0;

  const voice = useVoiceInput({
    onInterim: (text) => {
      setValue(`${dictationBaseRef.current}${dictationBaseRef.current && text ? ' ' : ''}${text}`);
      requestAnimationFrame(autosize);
    },
    onFinalChunk: (text) => {
      dictationBaseRef.current = `${dictationBaseRef.current}${dictationBaseRef.current ? ' ' : ''}${text}`;
      setValue(dictationBaseRef.current);
      requestAnimationFrame(autosize);
    },
  });

  const handleStartVoice = () => {
    dictationBaseRef.current = value;
    voice.start();
    textareaRef.current?.focus();
  };

  const canSend = Boolean(value.trim() || attachment || attachedImages.length > 0) && !isGenerating;

  const handleSend = () => {
    if (!canSend) return;
    if (voice.isListening) voice.stop();
    onSend(value, attachment, attachedImages, agentMode);
    setValue('');
    setAttachment(null);
    setAttachedImages([]);
    requestAnimationFrame(autosize);
  };

  const fillFromQuickAction = (text: string) => {
    setValue(text);
    requestAnimationFrame(() => {
      autosize();
      textareaRef.current?.focus();
    });
  };

  const applySlashCommand = (template: string) => {
    if (template.startsWith('/skills') || template.startsWith('/add-skill')) {
      setSkillsModalOpen(true);
      setValue('');
      setSlashDismissed(true);
      return;
    }
    setValue(template);
    setSlashDismissed(true);
    requestAnimationFrame(() => {
      autosize();
      textareaRef.current?.focus();
    });
  };

  const applyAtMention = (token: string) => {
    setValue((prev) => {
      return prev.replace(/(?:^|\s)@([a-z0-9_:/.-]*)$/i, (match) => {
        const leading = match.startsWith(' ') ? ' ' : '';
        return `${leading}${token} `;
      });
    });
    setAtIndex(0);
    requestAnimationFrame(() => {
      autosize();
      textareaRef.current?.focus();
    });
  };

  const handleSteer = () => {
    const text = value.trim();
    if (!text) return;
    steerAgentStream(text);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySlashCommand(slashMatches[Math.min(slashIndex, slashMatches.length - 1)].template);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    if (atOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAtIndex((i) => (i + 1) % atMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAtIndex((i) => (i - 1 + atMatches.length) % atMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyAtMention(atMatches[Math.min(atIndex, atMatches.length - 1)].token);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAtIndex(0);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!e.nativeEvent.isComposing) {
        if (isGenerating && value.trim()) {
          handleSteer();
        } else {
          handleSend();
        }
      }
      return;
    }
    if (e.key === 'Escape' && isGenerating) {
      e.preventDefault();
      onCancel();
    }
  };

  const readImageAsDataUrl = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (url.startsWith('data:image/')) {
        setAttachedImages((prev) => (prev.includes(url) ? prev : [...prev, url].slice(0, 4)));
      }
      setIsReadingFile(false);
      textareaRef.current?.focus();
    };
    reader.onerror = () => setIsReadingFile(false);
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    const docs = files.filter((f) => !f.type.startsWith('image/'));
    if (images.length > 0) {
      setIsReadingFile(true);
      images.slice(0, 4).forEach(readImageAsDataUrl);
    }
    const doc = docs[0];
    if (!doc) return;
    setIsReadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      const truncated =
        raw.length > MAX_ATTACHMENT_CHARS ? `${raw.slice(0, MAX_ATTACHMENT_CHARS)}\n...(truncated)` : raw;
      setAttachment({ name: doc.name, content: truncated });
      setIsReadingFile(false);
      textareaRef.current?.focus();
    };
    reader.onerror = () => setIsReadingFile(false);
    reader.readAsText(doc);
  };

  // Clipboard paste of screenshots/images attaches them like the file picker
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    setIsReadingFile(true);
    readImageAsDataUrl(file);
  };

  useEffect(() => {
    if (!isModeMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(event.target as Node)) setIsModeMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isModeMenuOpen]);

  return (
    <div>
      {/* Quick-action suggestions — empty/conversation-start state only */}
      {showQuickActions && (
        <div className="mb-2.5 px-1 flex items-center gap-1.5 flex-wrap" aria-label="Suggested prompts">
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-obsidian-inkMuted mr-0.5 select-none">or simply</span>
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => fillFromQuickAction(action)}
              className="chip chip-ghost hover:bg-obsidian-surface2 hover:border-obsidian-hairline border border-transparent transition-all active:scale-[0.98] cursor-pointer text-xs select-none"
            >
              {action}
            </button>
          ))}
        </div>
      )}

      <div className="composer rounded-2xl !bg-obsidian-surface2 relative">
        {/* Hidden input drives the attach action */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.js,.jsx,.ts,.tsx,.py,.css,.html"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        {attachedImages.length > 0 && (
          <div className="mx-3 mt-3 flex items-center gap-2 flex-wrap">
            {attachedImages.map((url) => (
              <div key={url.slice(-24)} className="relative group">
                <img src={url} alt="Attached image" className="w-14 h-14 rounded-lg object-cover border border-obsidian-hairline" />
                <button
                  type="button"
                  onClick={() => setAttachedImages((prev) => prev.filter((u) => u !== url))}
                  aria-label="Remove image"
                  title="Remove image"
                  className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-obsidian-surface1 border border-obsidian-border text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 hidden group-hover:flex items-center justify-center transition-colors cursor-pointer shadow-sm"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {attachment && (
          <div className="mx-3 mt-3 px-2.5 py-1.5 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline flex items-center justify-between gap-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" aria-hidden="true" />
              <span className="truncate text-[11px] font-mono text-obsidian-inkSecondary">{attachment.name}</span>
              <span className="text-[10px] font-mono text-obsidian-inkMuted shrink-0">attached as context</span>
            </div>
            <button
              onClick={() => setAttachment(null)}
              aria-label={`Remove attachment ${attachment.name}`}
              title="Remove attachment"
              className="p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors duration-150 cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {slashOpen && (
          <div
            role="listbox"
            aria-label="Slash commands"
            className="mx-2.5 mt-2 rounded-xl glass-dropdown overflow-hidden p-1 space-y-0.5 anim-appear z-40 border border-obsidian-border"
          >
            <div className="px-2.5 py-1 text-[9px] font-mono text-obsidian-inkMuted uppercase tracking-[0.15em] font-semibold border-b border-obsidian-hairline mb-1 flex items-center justify-between">
              <span>Agent Commands</span>
              <span className="text-obsidian-inkFaint">↑↓ navigate · ⏎ apply</span>
            </div>
            {slashMatches.map((command, index) => {
              const isSelected = index === Math.min(slashIndex, slashMatches.length - 1);
              return (
                <button
                  key={command.cmd}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => applySlashCommand(command.template)}
                  onMouseEnter={() => setSlashIndex(index)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-obsidian-surface2 border border-obsidian-border'
                      : 'hover:bg-obsidian-surface1 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-2 py-0.5 rounded-md bg-obsidian-surface2 text-obsidian-inkPrimary border border-obsidian-border font-mono text-xs font-bold tracking-tight">
                      {command.cmd}
                    </span>
                    <span className="text-xs text-obsidian-inkSecondary truncate font-sans">
                      {command.desc}
                    </span>
                  </div>
                  {command.badge && (
                    <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-obsidian-surface1 text-obsidian-inkMuted shrink-0">
                      {command.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {atOpen && (
          <div
            role="listbox"
            aria-label="Context Mentions"
            className="mx-2.5 mt-2 rounded-xl glass-dropdown overflow-hidden p-1 space-y-0.5 anim-appear z-40 border border-obsidian-border"
          >
            <div className="px-2.5 py-1 text-[9px] font-mono text-obsidian-inkMuted uppercase tracking-[0.15em] font-semibold border-b border-obsidian-hairline mb-1 flex items-center justify-between">
              <span>Context Mentions (@)</span>
              <span className="text-obsidian-inkFaint">↑↓ navigate · ⏎ attach</span>
            </div>
            {atMatches.map((mention, index) => {
              const isSelected = index === Math.min(atIndex, atMatches.length - 1);
              return (
                <button
                  key={mention.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => applyAtMention(mention.token)}
                  onMouseEnter={() => setAtIndex(index)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-obsidian-surface2 border border-obsidian-border'
                      : 'hover:bg-obsidian-surface1 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-2 py-0.5 rounded-md bg-obsidian-surface2 text-obsidian-inkPrimary border border-obsidian-border font-mono text-xs font-bold tracking-tight">
                      {mention.token}
                    </span>
                    <span className="text-xs text-obsidian-inkSecondary truncate font-sans">
                      {mention.name} — <span className="text-obsidian-inkMuted">{mention.desc}</span>
                    </span>
                  </div>
                  <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-obsidian-surface1 text-obsidian-inkMuted shrink-0">
                    {mention.badge}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {!slashOpen && !atOpen && value.startsWith('/') && value.trim().length > 1 && (
          <div className="flex items-center gap-2 mx-3 mt-2 px-2.5 py-1 rounded-md bg-obsidian-surface2 border border-obsidian-border w-fit text-xs font-mono text-obsidian-inkPrimary shadow-sm">
            <span className="font-semibold text-obsidian-inkPrimary">{value.split(' ')[0]}</span>
            <span className="text-obsidian-inkMuted text-[10px] uppercase tracking-wider font-sans">Command</span>
          </div>
        )}
        {voice.isListening && (
          <div className="flex items-center justify-between gap-2 mx-3 mt-2 px-3 py-1 rounded-md bg-obsidian-surface3 border border-obsidian-border text-obsidian-inkPrimary text-xs animate-in fade-in">
            <div className="flex items-center gap-2">
              <Mic className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />
              <span className="text-[11px] font-medium">Listening... speak prompt</span>
            </div>
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-obsidian-inkSecondary" />
              <button
                type="button"
                onClick={voice.stop}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors"
                title="Stop listening (Esc)"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSlashDismissed(false);
            setSlashIndex(0);
            autosize();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={2}
          aria-label="Message Astra"
          placeholder={voice.isListening ? 'Listening… speak now' : 'Ask anything… (type / for commands, @ for context)'}
          className="w-full bg-transparent px-4 pt-3.5 pb-1 text-[13.5px] text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none resize-none leading-[1.65] max-h-48 tracking-[-0.01em]"
          style={{ fontFamily: 'var(--font-sans)', minHeight: 42 }}
        />

        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-obsidian-surface1/40 border-t border-obsidian-hairline/50 rounded-b-2xl">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isReadingFile}
              aria-label="Attach file or image"
              title="Attach file or image"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-obsidian-inkSecondary hover:text-obsidian-inkPrimary bg-obsidian-surface1 hover:bg-obsidian-surface2 border border-obsidian-hairline hover:border-obsidian-borderBright transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border disabled:opacity-50 select-none shrink-0 shadow-xs active:scale-95"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>

            <McpStatusPill />

            <ModelSelectorDropdown buttonVariant="pill" />

            {/* Harmonized Execution Mode dropdown */}
            {(() => {
              const current = MODE_OPTIONS.find((m) => m.id === agentMode) || MODE_OPTIONS[0];
              return (
                <div ref={modeMenuRef} className="relative">
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setIsModeMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={isModeMenuOpen}
                    title={`${current.label} — ${current.hint}`}
                    className={`h-8 px-2.5 rounded-lg border text-[11px] font-mono flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 select-none shadow-xs active:scale-[0.98] ${
                      isModeMenuOpen
                        ? 'border-obsidian-borderBright bg-obsidian-surface2 text-obsidian-inkPrimary'
                        : 'border-obsidian-hairline bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 hover:border-obsidian-borderBright'
                    }`}
                  >
                    <current.Icon className="w-3.5 h-3.5 shrink-0 text-obsidian-inkSecondary" />
                    <span className="capitalize font-medium text-obsidian-inkPrimary">{current.label}</span>
                    <ChevronDown className={`w-3 h-3 text-obsidian-inkMuted transition-transform duration-200 ${isModeMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isModeMenuOpen && (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 mb-2 z-50 min-w-60 glass-dropdown p-1 anim-appear border border-obsidian-border shadow-2xl rounded-xl"
                    >
                      <div className="px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-obsidian-inkMuted border-b border-obsidian-hairline mb-1 flex items-center justify-between">
                        <span>Execution mode</span>
                        <span className="text-obsidian-inkFaint">⏎ apply</span>
                      </div>
                      {MODE_OPTIONS.map((opt) => {
                        const isActive = opt.id === agentMode;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="menuitem"
                            onClick={() => { setAgentMode(opt.id); setIsModeMenuOpen(false); }}
                            className={`w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-obsidian-surface3 text-obsidian-inkPrimary shadow-xs anim-chip-glow'
                                : 'text-obsidian-inkSecondary hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary'
                            }`}
                          >
                            <span className="w-5 h-5 rounded-md bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center shrink-0 mt-0.5">
                              <opt.Icon className="w-3 h-3" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12px] font-medium leading-tight">{opt.label}</span>
                              <span className="block text-[10.5px] text-obsidian-inkMuted leading-snug mt-0.5">{opt.hint}</span>
                            </span>
                            {isActive && (
                              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-obsidian-inkPrimary text-obsidian-canvas shrink-0 mt-0.5">
                                Active
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Accessible permission mode indicator */}
            <span className="sr-only" aria-label={`Permission: ${permissionLevel === 'full' ? 'Full Access' : 'Strict'}`} />

            {/* Harmonized PRO Engine Mode toggle */}
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => {
                if (harnessMode === 'standard') {
                  setShowAvoModal(true);
                } else {
                  setHarnessMode('standard');
                }
              }}
              aria-label={harnessMode === 'avo' ? 'Harness: PRO Engine Mode Active' : 'Harness: Standard Mode — click to activate PRO Engine'}
              className={`hidden sm:flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-[11px] font-mono transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border select-none shadow-xs active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
                harnessMode === 'avo'
                  ? 'border-cyan-500/30 text-cyan-300 bg-cyan-500/10 shadow-xs cursor-pointer font-semibold'
                  : 'border-obsidian-hairline bg-obsidian-surface1 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:border-obsidian-borderBright hover:bg-obsidian-surface2 cursor-pointer font-medium'
              }`}
              title={
                isGenerating
                  ? 'Engine mode locked during active generation.'
                  : harnessMode === 'avo'
                  ? 'PRO ENGINE Active: Deep AST index context, continuous self-healing verification, and multi-pass deductive reasoning.'
                  : 'Standard Mode. Click to activate PRO Engine Mode.'
              }
            >
              <Sparkles className={`w-3.5 h-3.5 ${harnessMode === 'avo' ? 'text-cyan-400' : 'text-obsidian-inkMuted'}`} />
              <span>{harnessMode === 'avo' ? 'PRO' : 'Standard'}</span>
            </button>

          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {voice.isSupported && (
              <button
                type="button"
                onClick={voice.isListening ? voice.stop : handleStartVoice}
                aria-label={voice.isListening ? 'Stop voice input' : 'Start voice input'}
                title={voice.error || (voice.isListening ? 'Stop dictation (Esc)' : 'Dictate a message')}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-border select-none shrink-0 border shadow-xs active:scale-95 ${
                  voice.isListening
                    ? 'text-cyan-300 bg-cyan-500/20 border-cyan-500/40 animate-pulse'
                    : 'bg-obsidian-surface1 hover:bg-obsidian-surface2 border-obsidian-hairline hover:border-obsidian-borderBright text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>
            )}

            {isGenerating ? (
              <div className="flex items-center gap-1.5">
                {value.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={handleSteer}
                    aria-label="Steer active run"
                    title="Steer active run with this instruction (Enter)"
                    className="px-3 h-8 rounded-lg bg-obsidian-inkPrimary text-obsidian-canvas hover:opacity-90 flex items-center gap-1.5 text-[11px] font-mono font-semibold shadow-xs transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-borderBright active:scale-95 select-none"
                  >
                    <Navigation className="w-3 h-3 fill-current" />
                    <span>Steer</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onCancel}
                  aria-label="Stop generating"
                  title="Stop generating (Esc)"
                  className="w-8 h-8 rounded-lg bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-all duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-400 active:scale-95 select-none shadow-xs"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send message"
                title="Send (Enter)"
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-obsidian-borderBright select-none ${
                  canSend
                    ? 'bg-obsidian-inkPrimary text-obsidian-canvas hover:opacity-90 cursor-pointer shadow-md active:scale-95'
                    : 'bg-obsidian-surface3 text-obsidian-inkMuted cursor-not-allowed opacity-40'
                }`}
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Single compact hint line — kept out of the placeholder to avoid duplication */}
      <div className="mt-1.5 px-1 text-[10px] font-mono text-obsidian-inkMuted select-none">
        @ mention · Shift+Enter for newline
      </div>

      {/* AVO Pro Mode Activation Confirmation Modal */}
      {showAvoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-obsidian-hairline bg-obsidian-surface2 p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-obsidian-inkPrimary font-medium">
              <Sparkles className="w-4 h-4 text-obsidian-inkPrimary" />
              <span>Activate AVO Pro Mode</span>
            </div>
            <p className="text-xs text-obsidian-inkSecondary leading-relaxed">
              AVO Pro Mode activated: Autonomous variation search, closed-loop verifiers, and multi-candidate rollouts enabled. <span className="text-obsidian-inkPrimary font-medium">Note: This mode performs deep exploration and might consume more token usage.</span>
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-obsidian-hairline">
              <button
                type="button"
                onClick={() => setShowAvoModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setHarnessMode('avo');
                  setShowAvoModal(false);
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-obsidian-accent text-obsidian-inkInverse hover:bg-obsidian-accentHover transition-colors shadow-sm cursor-pointer"
              >
                Activate AVO Pro
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
