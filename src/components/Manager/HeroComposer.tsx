import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square, ChevronDown, Cpu, Wrench, FlaskConical, X, FileText } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { ModelSelectorDropdown } from '../Common/ModelSelectorDropdown.js';
import { MentionAutocomplete, MentionItem } from '../Agent/MentionAutocomplete.js';

export type AgentMode = 'build' | 'plan' | 'edit' | 'chat';
export type HarnessPreset = 'standard' | 'avo';

const MODE_OPTIONS: { id: AgentMode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: 'build', label: 'Build', icon: Wrench, hint: 'Read, write, run — full tool loop' },
  { id: 'plan', label: 'Plan', icon: FlaskConical, hint: 'Plan the change before mutating files' },
  { id: 'edit', label: 'Edit', icon: Wrench, hint: 'Targeted file edits only' },
  { id: 'chat', label: 'Chat', icon: Cpu, hint: 'Read-only Q&A, no tool calls' },
];

const HARNESS_OPTIONS: { id: HarnessPreset; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard', hint: 'Focused tool loop, fastest' },
  { id: 'avo', label: 'AVO Pro', hint: 'Multi-candidate evolutionary variation with fitness gating' },
];

const PLACEHOLDER = 'Ask anything, / for commands, @ for context…';

export interface AttachedFile {
  name: string;
  content: string;
}

export interface HeroComposerProps {
  isGenerating: boolean;
  onSend: (text: string, images: string[], attachment?: AttachedFile | null, mode?: AgentMode) => void;
  onCancel: () => void;
  /** Initial text (e.g. when a suggestion chip is clicked). */
  initialText?: string;
  /** Hide the per-line growing behaviour; keep it a single line. */
  lockSingleLine?: boolean;
  /** Auto-focus the textarea on mount. */
  autoFocus?: boolean;
}

export const HeroComposer: React.FC<HeroComposerProps> = ({
  isGenerating,
  onSend,
  onCancel,
  initialText = '',
  lockSingleLine = false,
  autoFocus = true,
}) => {
  const harness = useIDEStore((state) => state.harnessMode);
  const setHarness = useIDEStore((state) => state.setHarnessMode);
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<AgentMode>('build');
  const [modeMenu, setModeMenu] = useState(false);
  const [harnessMenu, setHarnessMenu] = useState(false);
  
  // Attachments state
  const [attachment, setAttachment] = useState<AttachedFile | null>(null);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const harnessRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync initialText -> internal state when caller changes it (e.g. chip click)
  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  // Jitter-free auto-grow: keep one line by default, expand up to ~4 lines for long input
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 22;
    const minHeight = 26;
    const max = lockSingleLine ? 1 : 4;
    const maxHeight = lineHeight * max + 4;
    const target = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${target}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [text, lockSingleLine]);

  // Click-outside dismissal for popovers
  useEffect(() => {
    if (!modeMenu && !harnessMenu) return;
    const onDown = (e: MouseEvent) => {
      if (modeMenu && modeRef.current && !modeRef.current.contains(e.target as Node)) setModeMenu(false);
      if (harnessMenu && harnessRef.current && !harnessRef.current.contains(e.target as Node)) setHarnessMenu(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModeMenu(false);
        setHarnessMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [modeMenu, harnessMenu]);

  const readImageAsDataUrl = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (url) {
        setAttachedImages((prev) => (prev.includes(url) ? prev : [...prev, url].slice(0, 4)));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const images = files.filter((f) => f.type.startsWith('image/'));
    const textFiles = files.filter((f) => !f.type.startsWith('image/'));

    if (images.length > 0) {
      images.slice(0, 4).forEach(readImageAsDataUrl);
    }

    if (textFiles.length > 0) {
      const f = textFiles[0];
      setIsReadingFile(true);
      const reader = new FileReader();
      reader.onload = () => {
        setIsReadingFile(false);
        const content = typeof reader.result === 'string' ? reader.result : '';
        setAttachment({ name: f.name, content });
      };
      reader.onerror = () => setIsReadingFile(false);
      reader.readAsText(f);
    }

    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          readImageAsDataUrl(file);
        }
      }
    }
  };

  const handleTextChange = (value: string) => {
    setText(value);
    const cursor = taRef.current?.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);
    const mention = beforeCursor.match(/@([^\s@]*)$/);
    setMentionFilter(mention ? mention[1] : null);
  };

  const insertMention = (item: MentionItem) => {
    const cursor = taRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor).replace(/@([^\s@]*)$/, item.value);
    setText(`${before}${text.slice(cursor)}`);
    setMentionFilter(null);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && !attachment && attachedImages.length === 0) || isGenerating) return;
    onSend(trimmed, attachedImages, attachment, mode);
    setText('');
    setAttachment(null);
    setAttachedImages([]);
    requestAnimationFrame(() => taRef.current?.focus());
  }, [text, attachment, attachedImages, isGenerating, onSend, mode]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (mentionFilter !== null) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape' && isGenerating) {
        e.preventDefault();
        onCancel();
      }
    },
    [submit, isGenerating, onCancel, mentionFilter]
  );

  const canSend = Boolean(text.trim() || attachment || attachedImages.length > 0) && !isGenerating;
  const currentMode = MODE_OPTIONS.find((m) => m.id === mode)!;
  const currentHarness = HARNESS_OPTIONS.find((h) => h.id === harness)!;

  return (
    <div className="composer w-full overflow-visible shadow-sm relative">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        multiple
        accept="image/*,text/*,.ts,.tsx,.js,.jsx,.json,.md,.py,.rs,.go,.css,.html,.txt"
        className="hidden"
      />

      {/* Attachment Preview Chips */}
      {(attachedImages.length > 0 || attachment) && (
        <div className="px-3 pt-2.5 flex items-center gap-2 flex-wrap border-b border-obsidian-hairline pb-2">
          {attachedImages.map((url, i) => (
            <div key={i} className="relative group flex items-center gap-1.5 px-2 py-1 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline text-xs">
              <img src={url} alt="Attached" className="w-5 h-5 rounded object-cover" />
              <span className="text-[11px] font-mono text-obsidian-inkSecondary">Image {i + 1}</span>
              <button
                type="button"
                onClick={() => setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-obsidian-inkMuted hover:text-red-400 p-0.5"
                title="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {attachment && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline text-xs font-mono">
              <FileText className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
              <span className="text-[11px] text-obsidian-inkPrimary truncate max-w-[180px]">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-obsidian-inkMuted hover:text-red-400 p-0.5 ml-1"
                title="Remove file attachment"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {mentionFilter !== null && (
        <MentionAutocomplete filter={mentionFilter} onSelect={insertMention} onClose={() => setMentionFilter(null)} />
      )}

      {text.startsWith('/') && !text.slice(1).includes(' ') && (
        <div className="absolute bottom-full left-2 right-2 mb-2 z-40 glass-dropdown p-1">
          {[
            ['/goal', 'Autonomous verified execution'],
            ['/plan', 'Create a plan before edits'],
            ['/fix', 'Audit and fix issues'],
            ['/test', 'Run focused tests'],
            ['/explain', 'Explain the current codebase'],
          ].filter(([command]) => command.startsWith(text.trim().toLowerCase())).map(([command, label]) => (
            <button key={command} type="button" onClick={() => { setText(`${command} `); taRef.current?.focus(); }} className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left hover:bg-obsidian-surface2">
              <span className="font-mono text-[11px] text-obsidian-inkPrimary">{command}</span>
              <span className="text-[10px] text-obsidian-inkMuted">{label}</span>
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        rows={1}
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        placeholder={PLACEHOLDER}
        aria-label="Message ASTRA"
        autoFocus={autoFocus}
        className="w-full bg-transparent px-4 pt-3.5 pb-1.5 text-[13.5px] text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none resize-none leading-[1.65] tracking-[-0.01em] rounded-t-2xl"
        style={{ minHeight: 26 }}
      />

      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isReadingFile}
            title="Attach a file or image"
            aria-label="Attach"
            className="w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg flex items-center justify-center text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer border border-transparent hover:border-obsidian-hairline"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>

          {/* Mode pill — Build / Plan / Edit / Chat */}
          <div ref={modeRef} className="relative">
            <button
              type="button"
              onClick={() => setModeMenu((v) => !v)}
              aria-expanded={modeMenu}
              aria-haspopup="menu"
              title={currentMode.hint}
              className="flex items-center gap-1.5 px-2.5 h-7 sm:h-7.5 rounded-lg text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border border-obsidian-hairline hover:border-obsidian-border transition-colors cursor-pointer select-none"
            >
              <currentMode.icon className="w-3.5 h-3.5" />
              <span className="text-[12px] font-medium">{currentMode.label}</span>
              <ChevronDown className={`w-3 h-3 opacity-60 transition-transform duration-200 ${modeMenu ? 'rotate-180' : ''}`} />
            </button>
            {modeMenu && (
              <div
                role="menu"
                className="absolute left-0 bottom-full mb-1.5 z-40 min-w-[220px] bg-obsidian-surface1 glass-dropdown p-1 anim-appear shadow-2xl border border-obsidian-border rounded-xl"
              >
                {MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    role="menuitem"
                    type="button"
                    onClick={() => { setMode(opt.id); setModeMenu(false); }}
                    className={`w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      mode === opt.id
                        ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-medium shadow-xs'
                        : 'text-obsidian-inkSecondary hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary'
                    }`}
                  >
                    <opt.icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium">{opt.label}</span>
                      <span className="block text-[10.5px] text-obsidian-inkMuted leading-snug">{opt.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Harness preset — Default / AVO Pro / Plan-only */}
          <div ref={harnessRef} className="relative">
            <button
              type="button"
              onClick={() => setHarnessMenu((v) => !v)}
              aria-expanded={harnessMenu}
              aria-haspopup="menu"
              title={currentHarness.hint}
              className="flex items-center gap-1.5 px-2.5 h-7 sm:h-7.5 rounded-lg text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 border border-obsidian-hairline hover:border-obsidian-border transition-colors cursor-pointer select-none"
            >
              <span className="text-[12px] font-medium">{currentHarness.label}</span>
              <ChevronDown className={`w-3 h-3 opacity-60 transition-transform duration-200 ${harnessMenu ? 'rotate-180' : ''}`} />
            </button>
            {harnessMenu && (
              <div
                role="menu"
                className="absolute left-0 bottom-full mb-1.5 z-40 min-w-[240px] bg-obsidian-surface1 glass-dropdown p-1 anim-appear shadow-2xl border border-obsidian-border rounded-xl"
              >
                {HARNESS_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    role="menuitem"
                    type="button"
                    onClick={() => { setHarness(opt.id); setHarnessMenu(false); }}
                    className={`w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      harness === opt.id
                        ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-medium shadow-xs'
                        : 'text-obsidian-inkSecondary hover:bg-obsidian-surface2 hover:text-obsidian-inkPrimary'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium">{opt.label}</span>
                      <span className="block text-[10.5px] text-obsidian-inkMuted leading-snug">{opt.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model picker */}
          <ModelSelectorDropdown className="!h-7 sm:!h-7.5" buttonVariant="compact" />
          <span className="hidden sm:inline text-[10px] font-mono text-obsidian-inkMuted">/ commands · @ context</span>
        </div>

        {/* Send / stop button */}
        <button
          type="button"
          onClick={isGenerating ? onCancel : submit}
          disabled={!isGenerating && !canSend}
          aria-label={isGenerating ? 'Stop generating' : 'Send'}
          title={isGenerating ? 'Stop generating (Esc)' : 'Send message (Enter)'}
          className={`w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all shrink-0 select-none ${
            isGenerating
              ? 'bg-obsidian-surface3 text-obsidian-inkPrimary hover:bg-obsidian-surface4 cursor-pointer border border-obsidian-hairline animate-pulse'
              : canSend
                ? 'bg-obsidian-inkPrimary text-obsidian-canvas hover:opacity-90 cursor-pointer shadow-sm hover:-translate-y-0.5 hover:scale-105 active:scale-95'
                : 'bg-obsidian-surface2 text-obsidian-inkFaint cursor-not-allowed opacity-50 border border-obsidian-hairline'
          }`}
        >
          {isGenerating ? (
            <Square className="w-3 h-3 fill-current" />
          ) : (
            <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
          )}
        </button>
      </div>
    </div>
  );
};
