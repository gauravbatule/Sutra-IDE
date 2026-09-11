import React, { useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import Editor, { OnMount, loader } from '@monaco-editor/react';
import { useIDEStore } from '../../stores/ideStore.js';
import { Save, Check, FileCode, Sparkles, X } from 'lucide-react';
import { Breadcrumbs } from './Breadcrumbs.js';

loader.config({ monaco });

export const MonacoEditor: React.FC = () => {
  const { 
    openTabs, 
    activeTabPath, 
    updateTabContent, 
    saveActiveFile,
    setEditorTelemetry,
    inlineDiffState,
    acceptInlineDiff,
    rejectInlineDiff
  } = useIDEStore();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  const handleSave = async () => {
    setSaveStatus('saving');
    const ok = await saveActiveFile();
    if (ok) {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } else {
      setSaveStatus('idle');
    }
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Define Obsidian custom theme
    monaco.editor.defineTheme('obsidian-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '71717a', fontStyle: 'italic' },
        { token: 'keyword', foreground: '818cf8', fontStyle: 'bold' },
        { token: 'string', foreground: '34d399' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'type', foreground: 'a78bfa' },
        { token: 'function', foreground: '38bdf8' },
        { token: 'variable', foreground: 'f4f4f5' },
      ],
      colors: {
        'editor.background': '#09090b',
        'editor.foreground': '#f4f4f5',
        'editor.lineHighlightBackground': '#18181b55',
        'editor.selectionBackground': '#818cf833',
        'editorCursor.foreground': '#818cf8',
        'editorLineNumber.foreground': '#52525b',
        'editorLineNumber.activeForeground': '#a1a1aa',
        'editorGutter.background': '#09090b',
        'editorBracketMatch.background': '#818cf822',
        'editorBracketMatch.border': '#818cf8',
      },
    });

    monaco.editor.setTheme('obsidian-dark');

    // Add Save Shortcut: Ctrl+S / Cmd+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    // Add Diff Shortcuts: Accept (Ctrl+Y / Cmd+Y) & Reject (Ctrl+N / Cmd+N)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      acceptInlineDiff();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => {
      rejectInlineDiff();
    });

    // 1. Telemetry: Track Live Cursor Position & Visible Range
    editor.onDidChangeCursorPosition((e) => {
      const pos = e.position;
      const visibleRanges = editor.getVisibleRanges();
      const visibleRange = visibleRanges.length > 0
        ? { startLine: visibleRanges[0].startLineNumber, endLine: visibleRanges[0].endLineNumber }
        : null;
      setEditorTelemetry({
        cursorPosition: { line: pos.lineNumber, column: pos.column },
        visibleRange,
      });
    });

    // 2. Telemetry: Track Live Code Selection Range & Highlighted Text
    editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel();
      if (!model) return;
      const selection = e.selection;
      const selectedText = model.getValueInRange(selection);
      setEditorTelemetry({
        selectedText,
        selectionRange: {
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn,
        },
      });
    });

    // 3. Telemetry: Track Real-Time Language Diagnostics & Linter Errors
    monaco.editor.onDidChangeMarkers(() => {
      const model = editor.getModel();
      if (!model) return;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      const diagnostics = markers.map((m) => ({
        message: m.message,
        severity: m.severity,
        startLineNumber: m.startLineNumber,
        endLineNumber: m.endLineNumber,
      }));
      setEditorTelemetry({ activeFileDiagnostics: diagnostics });
    });

    // Register Explicit Ghost Text Inline Completion Provider (Alt+\ or Ctrl+Space)
    monaco.languages.registerInlineCompletionsProvider(
      ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'html', 'css', 'json', 'python', 'rust', 'markdown'],
      {
        provideInlineCompletions: async (model: any, position: any, context: any, token: any) => {
          // Explicit trigger only
          if (context.selectedSuggestionInfo) return { items: [] };

          const fullText = model.getValue();
          const offset = model.getOffsetAt(position);
          const prefix = fullText.slice(0, offset);
          const suffix = fullText.slice(offset);

          try {
            const res = await fetch('/api/agent/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prefix,
                suffix,
                languageId: model.getLanguageId(),
                filePath: model.uri.path,
              }),
            });

            if (res.ok) {
              const data = await res.json();
              if (data.completion && !token.isCancellationRequested) {
                return {
                  items: [
                    {
                      insertText: data.completion,
                      range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                    },
                  ],
                };
              }
            }
          } catch {
            // ignore
          }
          return { items: [] };
        },
        freeInlineCompletions: () => {},
      }
    );

    // Explicit Trigger shortcut: Alt+\ (Trigger Inline Suggestion)
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Backslash, () => {
      editor.trigger('keyboard', 'editor.action.inlineSuggest.trigger', {});
    });
  };

  if (!activeTab) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-obsidian-canvas text-obsidian-inkMuted select-none p-6">
        <div className="text-center max-w-sm">
          <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-obsidian-inkSecondary">
            <FileCode className="w-5 h-5" />
          </div>
          <div className="text-sm font-medium text-obsidian-inkPrimary mb-1.5">No Active File</div>
          <p className="text-xs text-obsidian-inkMuted mb-4">
            Select a file from the explorer on the left or press <span className="font-mono text-obsidian-inkSecondary bg-obsidian-surface4 px-1.5 py-0.5 rounded">⌘K</span> to open files.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full h-full relative overflow-hidden bg-obsidian-canvas flex flex-col">
      {/* Editor Top Bar Info & Save Button */}
      <div className="h-7 bg-obsidian-surface1 border-b border-obsidian-hairline flex items-center justify-between px-3 text-[11px] text-obsidian-inkSecondary select-none">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-obsidian-inkMuted">{activeTab.path}</span>
          {activeTab.isDirty && (
            <span className="text-obsidian-inkSecondary text-[10px] font-medium">• Unsaved changes</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-obsidian-inkPrimary text-[10px] font-mono">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!activeTab.isDirty || saveStatus === 'saving'}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
              activeTab.isDirty
                ? 'bg-zinc-100 hover:bg-white text-zinc-950 font-bold shadow-sm'
                : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
            }`}
            title="Save File (Ctrl+S)"
          >
            <Save className="w-3 h-3" />
            <span>Save</span>
          </button>
        </div>
      </div>

      <Breadcrumbs />

      {/* Floating Inline Diff Review Banner (Cursor Parity) */}
      {inlineDiffState && inlineDiffState.path === activeTab.path && (
        <div className="bg-obsidian-surface2 border-b border-obsidian-border px-3 py-1.5 flex items-center justify-between z-20 backdrop-blur text-xs font-mono select-none animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-obsidian-inkPrimary">
            <Sparkles className="w-3.5 h-3.5 text-obsidian-inkPrimary animate-pulse" />
            <span className="font-semibold">AI Proposed Code Modification</span>
            <span className="text-[10px] text-obsidian-inkMuted hidden sm:inline">Review changes below</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={acceptInlineDiff}
              className="px-2.5 py-1 rounded bg-white hover:bg-obsidian-accentHover text-black font-bold text-[10px] flex items-center gap-1 transition-colors cursor-pointer shadow"
              title="Accept Changes (⌘Y / Ctrl+Y)"
            >
              <Check className="w-3 h-3" />
              <span>Accept (⌘Y)</span>
            </button>
            <button
              onClick={rejectInlineDiff}
              className="px-2.5 py-1 rounded bg-obsidian-surface4 hover:bg-obsidian-surface4 text-obsidian-inkPrimary hover:text-white text-[10px] flex items-center gap-1 transition-colors cursor-pointer border border-white/10"
              title="Reject Changes (⌘N / Ctrl+N)"
            >
              <X className="w-3 h-3" />
              <span>Reject (⌘N)</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        <Editor
          height="100%"
          path={activeTab.path}
          language={activeTab.language}
          value={activeTab.content}
          theme="obsidian-dark"
          onMount={handleEditorDidMount}
          onChange={(val) => {
            if (val !== undefined && activeTabPath) {
              updateTabContent(activeTabPath, val);
            }
          }}
          options={{
            fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
            fontSize: 13,
            lineHeight: 20,
            fontLigatures: true,
            minimap: { enabled: true, maxColumn: 80 },
            bracketPairColorization: { enabled: true },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            inlineSuggest: { enabled: true, mode: 'subwordSmart' },
            suggest: { preview: true, showStatusBar: true },
            quickSuggestions: { other: true, comments: true, strings: true },
            padding: { top: 10, bottom: 10 },
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
};
