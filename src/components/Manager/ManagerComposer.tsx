import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Mic, Paperclip, ShieldCheck, Square, X } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { ModelSelectorDropdown } from '../Common/ModelSelectorDropdown.js';
import { useVoiceInput } from '../../hooks/useVoiceInput.js';

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
  onSend: (text: string, attachment: AttachedFile | null) => void;
  onCancel: () => void;
  /** Shows the "or simply:" suggestion chips above the composer (empty/conversation-start state). */
  showQuickActions?: boolean;
}

const MAX_ATTACHMENT_CHARS = 20000;

const QUICK_ACTIONS = [
  'Fix all errors in this project',
  'Explain this codebase',
  'Add a new feature',
  'Write tests',
];

/**
 * MCP status pill per the /api/mcp/status contract: dot + server count when
 * connected, red dot + "MCP error" when any server errors, hidden entirely
 * when zero servers are configured. Click opens Settings. Fetches on mount,
 * on Settings close, every 30s while visible, and on visibilitychange.
 */
const McpStatusPill: React.FC = () => {
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);
  const isSettingsOpen = useIDEStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useIDEStore((s) => s.setSettingsOpen);
  const prevSettingsOpenRef = useRef(false);

  const loadStatus = useCallback(() => {
    fetch('/api/mcp/status')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data) => setServers(Array.isArray(data?.servers) ? data.servers : []))
      .catch(() => setServers([]));
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

  if (!servers || servers.length === 0) return null;

  const hasError = servers.some((s) => s.status === 'error');
  const connectedCount = servers.filter((s) => s.status === 'connected').length;

  return (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      title={hasError ? 'An MCP server is reporting an error' : `${connectedCount} MCP server${connectedCount === 1 ? '' : 's'} connected`}
      className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full border border-white/10 bg-white/[0.05] hover:bg-white/[0.1] text-[10px] font-mono uppercase tracking-wider text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
    >
      <span
        aria-hidden="true"
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasError ? 'bg-red-400' : 'bg-obsidian-inkMuted'}`}
      />
      <span>{hasError ? 'MCP error' : `MCP · ${connectedCount}`}</span>
    </button>
  );
};

/** Slash commands: typing "/" opens a selectable menu; Enter/Tab picks, Esc closes. */
const SLASH_COMMANDS: Array<{ cmd: string; desc: string; template: string }> = [
  { cmd: '/goal', desc: 'Autonomous loop — keep working until the objective is done', template: '/goal ' },
  { cmd: '/plan', desc: 'Plan the approach first, then wait for confirmation', template: 'Plan this step by step before changing anything: ' },
  { cmd: '/fix', desc: 'Find and fix every error in the project', template: 'Find and fix all errors in this project. Verify with a build when done.' },
  { cmd: '/test', desc: 'Write and run tests', template: 'Write tests for ' },
  { cmd: '/explain', desc: 'Explain how this codebase works', template: 'Explain this codebase: structure, entry points, and data flow.' },
];

export const ManagerComposer: React.FC<ManagerComposerProps> = ({ isGenerating, onSend, onCancel, showQuickActions = false }) => {
  const permissionLevel = useIDEStore((s) => s.permissionLevel);
  const setPermissionLevel = useIDEStore((s) => s.setPermissionLevel);
  const [value, setValue] = useState('');
  const [attachment, setAttachment] = useState<AttachedFile | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationBaseRef = useRef('');

  // Slash menu is live while the first token is still being typed
  const slashQuery = !slashDismissed && value.startsWith('/') && !value.includes(' ') ? value.slice(1).toLowerCase() : null;
  const slashMatches = slashQuery === null ? [] : SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(slashQuery));
  const slashOpen = slashMatches.length > 0;

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, []);

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

  const canSend = Boolean(value.trim() || attachment) && !isGenerating;

  const handleSend = () => {
    if (!canSend) return;
    if (voice.isListening) voice.stop();
    onSend(value, attachment);
    setValue('');
    setAttachment(null);
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
    setValue(template);
    setSlashDismissed(true);
    requestAnimationFrame(() => {
      autosize();
      textareaRef.current?.focus();
    });
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!e.nativeEvent.isComposing) handleSend();
      return;
    }
    if (e.key === 'Escape' && isGenerating) {
      e.preventDefault();
      onCancel();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsReadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      const truncated =
        raw.length > MAX_ATTACHMENT_CHARS ? `${raw.slice(0, MAX_ATTACHMENT_CHARS)}\n...(truncated)` : raw;
      setAttachment({ name: file.name, content: truncated });
      setIsReadingFile(false);
      textareaRef.current?.focus();
    };
    reader.onerror = () => setIsReadingFile(false);
    reader.readAsText(file);
  };

  return (
    <div>
      {/* Quick-action suggestions — empty/conversation-start state only */}
      {showQuickActions && (
        <div className="mb-2 px-1 flex items-center gap-1.5 flex-wrap" aria-label="Suggested prompts">
          <span className="text-[11px] font-mono text-obsidian-inkMuted mr-0.5">or simply:</span>
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => fillFromQuickAction(action)}
              className="px-3 py-1 rounded-full border border-white/10 bg-transparent text-[11px] text-obsidian-inkSecondary hover:text-white hover:border-white/30 hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            >
              {action}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-obsidian-surface2 border border-obsidian-border focus-within:border-white/20 transition-colors duration-150">
        {/* Hidden input drives the attach action */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

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
              className="p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-white/10 transition-colors duration-150 cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {slashOpen && (
          <div
            role="listbox"
            aria-label="Slash commands"
            className="mx-2.5 mt-2 rounded-lg border border-white/10 bg-[#141419] shadow-elevation overflow-hidden"
          >
            {slashMatches.map((command, index) => (
              <button
                key={command.cmd}
                type="button"
                role="option"
                aria-selected={index === Math.min(slashIndex, slashMatches.length - 1)}
                onClick={() => applySlashCommand(command.template)}
                onMouseEnter={() => setSlashIndex(index)}
                className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 transition-colors cursor-pointer ${
                  index === Math.min(slashIndex, slashMatches.length - 1)
                    ? 'bg-white/[0.08] text-obsidian-inkPrimary'
                    : 'text-obsidian-inkSecondary hover:bg-white/[0.05]'
                }`}
              >
                <span className="text-xs font-mono font-semibold">{command.cmd}</span>
                <span className="text-[10px] text-obsidian-inkMuted truncate">{command.desc}</span>
              </button>
            ))}
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
          rows={2}
          aria-label="Message Astra"
          placeholder="Ask anything..."
          className="w-full bg-transparent px-4 pt-3.5 pb-1 text-sm text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none resize-none font-sans leading-relaxed max-h-48"
        />

        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isReadingFile}
              aria-label="Attach image"
              title="Attach image"
              className="p-2 rounded-full text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.07] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-50"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <McpStatusPill />

            <ModelSelectorDropdown buttonVariant="pill" />

            {/* Permission mode — icon-only; click flips between Strict and Full Access */}
            <button
              type="button"
              onClick={() => setPermissionLevel(permissionLevel === 'strict' ? 'full' : 'strict')}
              aria-label={permissionLevel === 'strict' ? 'Permission: Strict — click for Full Access' : 'Permission: Full Access — click for Strict'}
              className={`hidden sm:flex items-center justify-center w-7 h-7 rounded-full border transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                permissionLevel === 'strict'
                  ? 'border-white/40 text-obsidian-inkPrimary bg-white/[0.08] hover:bg-white/[0.14]'
                  : 'border-obsidian-hairline text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:border-white/25'
              }`}
              title={
                permissionLevel === 'strict'
                  ? 'Strict — asks before every change. Click for Full Access.'
                  : 'Full Access — works autonomously. Click for Strict.'
              }
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {voice.isSupported && (
              <button
                type="button"
                onClick={voice.isListening ? voice.stop : handleStartVoice}
                aria-label={voice.isListening ? 'Stop voice input' : 'Start voice input'}
                title={voice.isListening ? 'Stop dictation (Esc)' : 'Dictate a message'}
                className={`p-2 rounded-full transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                  voice.isListening
                    ? 'text-white bg-white/[0.1]'
                    : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-white/[0.07]'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            )}

            {isGenerating ? (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Stop generating"
                title="Stop generating"
                className="w-9 h-9 rounded-full bg-white text-black hover:bg-zinc-200 flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send message"
                title="Send (Enter)"
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                  canSend
                    ? 'bg-white text-black hover:bg-zinc-200 cursor-pointer'
                    : 'bg-obsidian-surface4 text-obsidian-inkMuted cursor-not-allowed opacity-60'
                }`}
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Single compact hint line — kept out of the placeholder to avoid duplication */}
      <div className="mt-1.5 px-1 text-[10px] font-mono text-obsidian-inkMuted select-none">
        @ mention · Shift+Enter for newline
      </div>
    </div>
  );
};
