import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Sparkles,
  RotateCw,
  X
} from 'lucide-react';

interface DiagnosticsFixerBarProps {
  activeFilePath: string;
  diagnostics: Array<{ message: string; severity: number; startLineNumber: number; endLineNumber: number }>;
  onFixInline: (instruction: string) => void;
}

export const DiagnosticsFixerBar: React.FC<DiagnosticsFixerBarProps> = ({
  activeFilePath,
  diagnostics,
  onFixInline,
}) => {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isFixing, setIsFixing] = useState(false);

  // Reset dismissal when the user switches to a different file
  useEffect(() => {
    setIsDismissed(false);
  }, [activeFilePath]);

  // severity: 8 = Error in Monaco, 4 = Warning
  const errors = diagnostics.filter((d) => d.severity === 8);
  const warnings = diagnostics.filter((d) => d.severity === 4);

  if (diagnostics.length === 0 || isDismissed) return null;

  const handleFixWithAI = () => {
    setIsFixing(true);
    const issuesSummary = diagnostics
      .slice(0, 5)
      .map((d) => `- Line ${d.startLineNumber}: ${d.message}`)
      .join('\n');

    const prompt = `Fix the following ${errors.length} error(s) and ${warnings.length} warning(s) in "${activeFilePath}":\n${issuesSummary}\n\nMake sure the code is strictly type-safe, error-free, and adheres to modern best practices.`;

    onFixInline(prompt);
    setTimeout(() => setIsFixing(false), 800);
  };

  return (
    <div className="absolute bottom-4 right-4 z-20 animate-in fade-in slide-in-from-bottom-2 duration-150 font-mono select-none">
      <div className="flex items-center gap-2 bg-obsidian-surface1/95 border border-obsidian-border rounded-xl px-3 py-1.5 shadow-2xl backdrop-blur-md text-xs">
        {errors.length > 0 ? (
          <div className="flex items-center gap-1.5 text-red-400">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="font-semibold">{errors.length} Error{errors.length > 1 ? 's' : ''}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-semibold">{warnings.length} Warning{warnings.length > 1 ? 's' : ''}</span>
          </div>
        )}

        <div className="h-3 w-px bg-obsidian-surface3" />

        <button
          onClick={handleFixWithAI}
          disabled={isFixing}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-obsidian-inkPrimary text-obsidian-canvas text-[11px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
        >
          {isFixing ? (
            <RotateCw className="w-3 h-3 animate-spin" />
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
              <span>Fix with SUTRA</span>
            </>
          )}
        </button>

        <button
          onClick={() => setIsDismissed(true)}
          className="p-1 rounded text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors cursor-pointer"
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
