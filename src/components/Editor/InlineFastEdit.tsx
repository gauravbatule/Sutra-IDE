import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  RotateCw
} from 'lucide-react';

interface InlineFastEditProps {
  isOpen: boolean;
  onClose: () => void;
  selectedText: string;
  selectionRange: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
  activeFilePath: string;
  fileContent: string;
  languageId?: string;
  onApplyDiff: (replacement: string) => void;
  initialInstruction?: string;
}

export const InlineFastEdit: React.FC<InlineFastEditProps> = ({
  isOpen,
  onClose,
  selectedText,
  selectionRange,
  activeFilePath,
  fileContent,
  languageId,
  onApplyDiff,
  initialInstruction,
}) => {
  const [instruction, setInstruction] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInstruction(initialInstruction || '');
      setErrorMsg(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialInstruction]);

  if (!isOpen) return null;

  const handleGenerate = async (customInstruction?: string) => {
    const promptToUse = (customInstruction || instruction).trim();
    if (!promptToUse) return;

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/agent/fast-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: activeFilePath,
          instruction: promptToUse,
          selectedCode: selectedText || fileContent,
          fullContent: fileContent,
          languageId,
        }),
      });

      const data = await res.json();
      if (data.success && data.replacement !== undefined) {
        onApplyDiff(data.replacement);
        onClose();
      } else {
        setErrorMsg(data.error || 'Fast-edit generation failed');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setIsGenerating(false);
    }
  };

  const quickPrompts = [
    { label: 'Refactor / Clean', prompt: 'Refactor this code to be cleaner, more modular, and modern.' },
    { label: 'Add Types', prompt: 'Add strict TypeScript types, interfaces, and return annotations.' },
    { label: 'Error Handling', prompt: 'Add robust try/catch error handling, edge-case checks, and logging.' },
    { label: 'Optimize', prompt: 'Optimize time and memory complexity and remove unnecessary re-renders or allocations.' },
  ];

  const fileName = activeFilePath.split(/[/\\]/).pop() || 'File';

  return (
    <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-4 animate-in fade-in slide-in-from-top-2 duration-150 font-sans">
      <div className="bg-obsidian-surface1/95 border border-obsidian-border rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden p-3 space-y-2.5 select-none">
        {/* Header Bar */}
        <div className="flex items-center justify-between text-[11px] font-mono text-obsidian-inkMuted px-0.5">
          <div className="flex items-center gap-2 text-obsidian-inkPrimary font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-obsidian-inkPrimary">Fast Edit</span>
            <span className="text-[10px] text-obsidian-inkMuted px-1.5 py-0.5 rounded bg-obsidian-surface1 border border-obsidian-hairline">
              {fileName} {selectionRange ? `· L${selectionRange.startLine}–${selectionRange.endLine}` : '· Full File'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-obsidian-inkMuted">Esc to close</span>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Input Bar */}
        <div className="flex items-center gap-2 bg-obsidian-surface1 border border-obsidian-border rounded-lg px-3 py-2 focus-within:border-obsidian-borderBright focus-within:ring-1 focus-within:ring-obsidian-hairline transition-all">
          <input
            ref={inputRef}
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Edit instruction (e.g. 'Convert to async/await', 'Add strict types')..."
            className="flex-1 bg-transparent text-xs font-mono text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none"
            disabled={isGenerating}
          />
          <button
            type="button"
            onClick={() => handleGenerate()}
            disabled={isGenerating || !instruction.trim()}
            className="px-3 py-1 rounded-md bg-obsidian-accent text-obsidian-inkInverse font-mono text-xs font-medium hover:bg-obsidian-accentHover transition-colors flex items-center gap-1.5 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed shrink-0"
          >
            {isGenerating ? (
              <>
                <RotateCw className="w-3 h-3 animate-spin" />
                <span>Applying...</span>
              </>
            ) : (
              <>
                <span>Apply</span>
                <span className="text-[10px] opacity-60">↵</span>
              </>
            )}
          </button>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="text-[11px] font-mono text-red-400 px-1 py-1 rounded bg-red-950/30 border border-red-800/40">
            {errorMsg}
          </div>
        )}

        {/* Quick Action Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5 font-mono text-[10px]">
          {quickPrompts.map((chip, idx) => (
            <button
              key={idx}
              type="button"
              disabled={isGenerating}
              onClick={() => {
                setInstruction(chip.prompt);
                handleGenerate(chip.prompt);
              }}
              className="px-2 py-1 rounded-md bg-obsidian-surface1 hover:bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer shrink-0"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
