import React from 'react';
import { useIDEStore } from '../../stores/ideStore.js';

/**
 * Empty-editor state for IDE mode.
 *
 * Replaces the oversized decorative wordmark that used to occupy the whole
 * center column when no file was open. The empty editor area now does real
 * work: it keeps the composer (so you can immediately describe what to build),
 * surfaces the files you were last in, and lists the shortcuts that matter.
 *
 * This follows the VS Code / Cursor convention where an empty editor is a
 * navigation surface, not a splash screen.
 */
export const EmptyEditorState: React.FC<{
  isGenerating?: boolean;
  onSend?: (text: string) => void;
  onCancel?: () => void;
}> = () => {
  const setCommandPaletteOpen = useIDEStore((s) => s.setCommandPaletteOpen);
  const setFolderPickerOpen = useIDEStore((s) => s.setFolderPickerOpen);
  const toggleTerminal = useIDEStore((s) => s.toggleTerminal);
  const currentWorkspacePath = useIDEStore((s) => s.currentWorkspacePath);

  const workspaceName = currentWorkspacePath
    ? currentWorkspacePath.split(/[/\\]/).filter(Boolean).pop()
    : 'workspace';

  return (
    <div className="flex-1 min-h-0 bg-obsidian-canvas text-obsidian-inkPrimary flex flex-col items-center justify-center select-none px-6 py-12 relative overflow-hidden">
      {/* Squared boxes grid background pattern */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-grid-pattern bg-grid-mask opacity-60 dark:opacity-40 z-0"
      />
      <div className="max-w-md w-full flex flex-col items-center text-center space-y-6 animate-in fade-in duration-300 relative z-10">
        {/* Subtle Brand & Workspace Indicator */}
        <div className="flex flex-col items-center gap-2.5">
          <img
            src="/assets/sutra-icon.svg"
            alt=""
            aria-hidden="true"
            className="w-8 h-8 object-contain opacity-70 hover:opacity-100 transition-opacity"
          />
          <div className="flex items-center gap-2 font-mono text-xs text-obsidian-inkSecondary">
            <span className="font-bold tracking-widest uppercase text-obsidian-inkPrimary">SUTRA</span>
            <span className="text-obsidian-inkMuted">/</span>
            <span className="text-obsidian-inkMuted">{workspaceName}</span>
          </div>
        </div>

        {/* Minimal Quick Shortcuts (VS Code / Cursor Style) */}
        <div className="w-full max-w-xs space-y-1.5 pt-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-obsidian-surface1 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer group"
          >
            <span className="text-[11px]">Command Palette</span>
            <kbd className="px-1.5 py-0.5 rounded border border-obsidian-hairline bg-obsidian-surface2 text-[10px] text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary">
              Ctrl+K
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setFolderPickerOpen(true)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-obsidian-surface1 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer group"
          >
            <span className="text-[11px]">Open Workspace</span>
            <kbd className="px-1.5 py-0.5 rounded border border-obsidian-hairline bg-obsidian-surface2 text-[10px] text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary">
              Ctrl+O
            </kbd>
          </button>

          <button
            type="button"
            onClick={toggleTerminal}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-obsidian-surface1 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer group"
          >
            <span className="text-[11px]">Terminal</span>
            <kbd className="px-1.5 py-0.5 rounded border border-obsidian-hairline bg-obsidian-surface2 text-[10px] text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary">
              Ctrl+`
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
};
