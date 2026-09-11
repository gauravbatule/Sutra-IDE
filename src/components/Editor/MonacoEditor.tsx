import React, { useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import Editor, { DiffEditor, OnMount, loader } from '@monaco-editor/react';
import { useIDEStore } from '../../stores/ideStore.js';
import {
  Save,
  Check,
  FileCode,
  Sparkles,
  X,
  AlignLeft,
  WrapText,
  Maximize2,
  Minimize2,
  Columns
} from 'lucide-react';
import { Breadcrumbs } from './Breadcrumbs.js';
import { ImageViewer, isImagePath } from './ImageViewer.js';
import { InlineFastEdit } from './InlineFastEdit.js';
import { DiagnosticsFixerBar } from './DiagnosticsFixerBar.js';
import { useTheme } from '../../hooks/useTheme.js';

loader.config({ monaco });

export const MonacoEditor: React.FC = () => {
  const { 
    openTabs, 
    activeTabPath, 
    updateTabContent, 
    saveActiveFile,
    inlineDiffState,
    setInlineDiff,
    acceptInlineDiff,
    rejectInlineDiff,
    activeFileDiagnostics,
    cursorPosition,
  } = useIDEStore();

  const { theme } = useTheme();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const inlineProviderRef = useRef<any>(null);
  const markersDisposableRef = useRef<any>(null);
  const contentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const telemetryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightDecorationsRef = useRef<any[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isFastEditOpen, setIsFastEditOpen] = useState(false);
  const [fastEditInstruction, setFastEditInstruction] = useState<string>('');
  const [fastEditSelection, setFastEditSelection] = useState<{
    text: string;
    range: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
  }>({ text: '', range: null });
  const [isZenMode, setIsZenMode] = useState(false);
  const [isWordWrap, setIsWordWrap] = useState(true);
  const [isMinimap, setIsMinimap] = useState(true);

  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  // Synchronize editor cursor and viewport when cursorPosition is set externally (e.g. from Search, Problems, or File Links)
  React.useEffect(() => {
    if (!editorRef.current || !cursorPosition?.line) return;
    const line = cursorPosition.line;
    const col = cursorPosition.column || 1;
    const currentPos = editorRef.current.getPosition();
    if (currentPos?.lineNumber === line && currentPos?.column === col) return;

    editorRef.current.setPosition({ lineNumber: line, column: col });
    editorRef.current.revealLineInCenter(line);

    // Apply temporary line highlight
    if (monacoRef.current) {
      const range = new monacoRef.current.Range(line, 1, line, 1);
      highlightDecorationsRef.current = editorRef.current.deltaDecorations(
        highlightDecorationsRef.current,
        [
          {
            range,
            options: {
              isWholeLine: true,
              className: 'bg-cyan-500/15 border-l-2 border-cyan-400',
            },
          },
        ]
      );
      const timer = setTimeout(() => {
        if (editorRef.current) {
          highlightDecorationsRef.current = editorRef.current.deltaDecorations(
            highlightDecorationsRef.current,
            []
          );
        }
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [cursorPosition, activeTabPath]);

  // Clean up content & telemetry debouncers on unmount or tab switch
  React.useEffect(() => {
    return () => {
      if (contentDebounceRef.current) {
        clearTimeout(contentDebounceRef.current);
        if (editorRef.current && activeTabPath) {
          const liveVal = editorRef.current.getModel()?.getValue();
          if (liveVal !== undefined) {
            updateTabContent(activeTabPath, liveVal);
          }
        }
      }
      if (telemetryDebounceRef.current) clearTimeout(telemetryDebounceRef.current);
    };
  }, [activeTabPath]);

  const handleSave = async () => {
    if (editorRef.current && activeTabPath) {
      const liveVal = editorRef.current.getModel()?.getValue();
      if (liveVal !== undefined) {
        updateTabContent(activeTabPath, liveVal);
      }
    }
    setSaveStatus('saving');
    const ok = await saveActiveFile();
    if (ok) {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } else {
      setSaveStatus('idle');
    }
  };

  const handleFormatDocument = () => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
    }
  };

  const openFastEdit = (initialPrompt?: string) => {
    setFastEditInstruction(initialPrompt || '');
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      const selection = editorRef.current.getSelection();
      if (model && selection && !selection.isEmpty()) {
        const selectedTextVal = model.getValueInRange(selection);
        setFastEditSelection({
          text: selectedTextVal,
          range: {
            startLine: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLine: selection.endLineNumber,
            endColumn: selection.endColumn,
          },
        });
      } else {
        setFastEditSelection({ text: '', range: null });
      }
    }
    setIsFastEditOpen(true);
  };

  const handleApplyFastEditDiff = (replacement: string) => {
    if (!activeTab || !editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;

    let proposedContent = replacement;
    if (fastEditSelection.range && fastEditSelection.text && fastEditSelection.text.trim().length > 0) {
      // Replace only the selected range
      const originalValue = model.getValue();
      const offsetStart = model.getOffsetAt({ lineNumber: fastEditSelection.range.startLine, column: fastEditSelection.range.startColumn });
      const offsetEnd = model.getOffsetAt({ lineNumber: fastEditSelection.range.endLine, column: fastEditSelection.range.endColumn });
      proposedContent = originalValue.slice(0, offsetStart) + replacement + originalValue.slice(offsetEnd);
    }

    setInlineDiff({
      path: activeTab.path,
      originalContent: activeTab.content,
      proposedContent,
    });
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Define Developer-First Obsidian Dark Theme with vibrant syntax & diff tokens
    monaco.editor.defineTheme('obsidian-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c678dd', fontStyle: 'bold' },
        { token: 'keyword.control', foreground: 'c678dd', fontStyle: 'bold' },
        { token: 'operator', foreground: '56b6c2' },
        { token: 'string', foreground: '98c379' },
        { token: 'number', foreground: 'd19a66' },
        { token: 'type', foreground: 'e5c07b' },
        { token: 'function', foreground: '61afef' },
        { token: 'variable', foreground: 'e06c75' },
        { token: 'tag', foreground: 'e06c75' },
        { token: 'attribute.name', foreground: 'd19a66' },
        { token: 'attribute.value', foreground: '98c379' },
      ],
      colors: {
        'editor.background': '#09090b',
        'editor.foreground': '#f4f4f5',
        'editor.lineHighlightBackground': '#18181b80',
        'editor.selectionBackground': '#3f3f4650',
        'editorCursor.foreground': '#ffffff',
        'editorLineNumber.foreground': '#52525b',
        'editorLineNumber.activeForeground': '#fafafa',
        'editorGutter.background': '#09090b',
        'editorBracketMatch.background': '#ffffff14',
        'editorBracketMatch.border': '#71717a',
        'diffEditor.insertedTextBackground': '#10b98125',
        'diffEditor.removedTextBackground': '#ef444425',
        'diffEditor.insertedLineBackground': '#10b98118',
        'diffEditor.removedLineBackground': '#ef444418',
        'diffEditorGutter.insertedLineBackground': '#10b98140',
        'diffEditorGutter.removedLineBackground': '#ef444440',
      },
    });

    // Define Obsidian light theme with readable diff & syntax tokens
    monaco.editor.defineTheme('obsidian-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'd73a49', fontStyle: 'bold' },
        { token: 'operator', foreground: '005cc5' },
        { token: 'string', foreground: '22863a' },
        { token: 'number', foreground: '005cc5' },
        { token: 'type', foreground: '6f42c1' },
        { token: 'function', foreground: '6f42c1' },
        { token: 'variable', foreground: '24292e' },
      ],
      colors: {
        'editor.background': '#fbfaf7',
        'editor.foreground': '#1a1a1a',
        'editor.lineHighlightBackground': '#ebe8e155',
        'editor.selectionBackground': '#1a1a1a1a',
        'editorCursor.foreground': '#1a1a1a',
        'editorLineNumber.foreground': '#b8b8be',
        'editorLineNumber.activeForeground': '#1a1a1a',
        'editorGutter.background': '#fbfaf7',
        'editorBracketMatch.background': '#1a1a1a10',
        'editorBracketMatch.border': '#7a7a82',
        'diffEditor.insertedTextBackground': '#10b98120',
        'diffEditor.removedTextBackground': '#ef444420',
        'diffEditor.insertedLineBackground': '#10b98112',
        'diffEditor.removedLineBackground': '#ef444412',
        'diffEditorGutter.insertedLineBackground': '#10b98135',
        'diffEditorGutter.removedLineBackground': '#ef444435',
      },
    });

    monaco.editor.setTheme(theme === 'light' ? 'obsidian-light' : 'obsidian-dark');

    // Add Save Shortcut: Ctrl+S / Cmd+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    // Add Fast Edit Shortcut: Ctrl+K / Cmd+K
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      openFastEdit();
    });

    // Add Format Document Shortcut: Shift+Alt+F
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      handleFormatDocument();
    });

    // Add Diff Shortcuts: Accept (Ctrl+Y / Cmd+Y) & Reject (Ctrl+N / Cmd+N)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      acceptInlineDiff();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => {
      rejectInlineDiff();
    });

    // 1. Telemetry: Track Live Cursor Position & Visible Range (Debounced to keep typing silky smooth)
    editor.onDidChangeCursorPosition((e) => {
      const pos = e.position;
      const visibleRanges = editor.getVisibleRanges();
      const visibleRange = visibleRanges.length > 0
        ? { startLine: visibleRanges[0].startLineNumber, endLine: visibleRanges[0].endLineNumber }
        : null;

      if (telemetryDebounceRef.current) clearTimeout(telemetryDebounceRef.current);
      telemetryDebounceRef.current = setTimeout(() => {
        useIDEStore.getState().setEditorTelemetry({
          cursorPosition: { line: pos.lineNumber, column: pos.column },
          visibleRange,
        });
      }, 100);
    });

    // 2. Telemetry: Track Live Code Selection Range & Highlighted Text (Debounced)
    editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel();
      if (!model) return;
      const selection = e.selection;
      const selectedTextVal = model.getValueInRange(selection);

      if (telemetryDebounceRef.current) clearTimeout(telemetryDebounceRef.current);
      telemetryDebounceRef.current = setTimeout(() => {
        useIDEStore.getState().setEditorTelemetry({
          selectedText: selectedTextVal,
          selectionRange: {
            startLine: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLine: selection.endLineNumber,
            endColumn: selection.endColumn,
          },
        });
      }, 100);
    });

    // 3. Telemetry: Track Real-Time Language Diagnostics & Linter Errors
    if (markersDisposableRef.current) {
      try { markersDisposableRef.current.dispose(); } catch {}
    }
    markersDisposableRef.current = monaco.editor.onDidChangeMarkers(() => {
      const model = editor.getModel();
      if (!model) return;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      const diagnostics = markers.map((m) => ({
        message: m.message,
        severity: m.severity,
        startLineNumber: m.startLineNumber,
        endLineNumber: m.endLineNumber,
      }));
      useIDEStore.getState().setEditorTelemetry({ activeFileDiagnostics: diagnostics });
    });

    // Register Explicit Ghost Text Inline Completion Provider (Alt+\ or Ctrl+Space)
    if (inlineProviderRef.current) {
      try { inlineProviderRef.current.dispose(); } catch {}
    }
    inlineProviderRef.current = monaco.languages.registerInlineCompletionsProvider(
      ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'html', 'css', 'json', 'python', 'rust', 'markdown'],
      {
        provideInlineCompletions: async (model: any, position: any, context: any, token: any) => {
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

  // Cleanup inline completions provider and markers listener on unmount
  React.useEffect(() => {
    return () => {
      if (inlineProviderRef.current) {
        try { inlineProviderRef.current.dispose(); } catch {}
      }
      if (markersDisposableRef.current) {
        try { markersDisposableRef.current.dispose(); } catch {}
      }
    };
  }, []);

  React.useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(theme === 'light' ? 'obsidian-light' : 'obsidian-dark');
    }
  }, [theme]);

  if (!activeTab) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-obsidian-canvas text-obsidian-inkMuted select-none p-6">
        <div className="text-center max-w-sm">
          <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-obsidian-surface1 border border-obsidian-border flex items-center justify-center text-obsidian-inkSecondary">
            <FileCode className="w-5 h-5" />
          </div>
          <div className="text-sm font-medium text-obsidian-inkPrimary mb-1.5">No Active File</div>
          <p className="text-xs text-obsidian-inkMuted mb-4">
            Select a file from the explorer on the left or press <span className="font-mono text-obsidian-inkSecondary bg-obsidian-surface4 px-1.5 py-0.5 rounded">⌘K</span> for AI fast edits.
          </p>
        </div>
      </div>
    );
  }

  if (isImagePath(activeTab.path)) {
    return <ImageViewer tab={activeTab} />;
  }

  return (
    <div className={`flex-1 w-full h-full relative overflow-hidden bg-obsidian-canvas flex flex-col ${isZenMode ? 'fixed inset-0 z-40 bg-obsidian-canvas' : ''}`}>
      {/* Editor Top Bar Info & Power Controls */}
      <div className="h-7 bg-obsidian-surface1 border-b border-obsidian-hairline flex items-center justify-between px-3 text-[11px] text-obsidian-inkSecondary select-none">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-obsidian-inkMuted">{activeTab.path}</span>
          {activeTab.isDirty && (
            <span className="text-obsidian-inkSecondary text-[10px] font-medium">• Unsaved changes</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Fast Edit Trigger Button */}
          <button
            onClick={() => openFastEdit()}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-obsidian-surface1 hover:bg-obsidian-surface3 text-obsidian-inkPrimary text-[10px] font-mono transition-colors cursor-pointer border border-obsidian-border"
            title="SUTRA Fast Edit (Ctrl+K / ⌘K)"
          >
            <Sparkles className="w-3 h-3 text-obsidian-inkPrimary" />
            <span>Fast Edit</span>
            <span className="text-[9px] text-obsidian-inkMuted font-mono">⌘K</span>
          </button>

          {/* Format Document */}
          <button
            onClick={handleFormatDocument}
            className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Format Document (Shift+Alt+F)"
          >
            <AlignLeft className="w-3 h-3" />
          </button>

          {/* Word Wrap Toggle */}
          <button
            onClick={() => setIsWordWrap(!isWordWrap)}
            className={`p-1 rounded transition-colors cursor-pointer ${isWordWrap ? 'text-obsidian-inkPrimary bg-obsidian-surface3' : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'}`}
            title="Toggle Word Wrap"
          >
            <WrapText className="w-3 h-3" />
          </button>

          {/* Minimap Toggle */}
          <button
            onClick={() => setIsMinimap(!isMinimap)}
            className={`p-1 rounded transition-colors cursor-pointer ${isMinimap ? 'text-obsidian-inkPrimary bg-obsidian-surface3' : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'}`}
            title="Toggle Minimap"
          >
            <Columns className="w-3 h-3" />
          </button>

          {/* Zen Mode Toggle */}
          <button
            onClick={() => setIsZenMode(!isZenMode)}
            className={`p-1 rounded transition-colors cursor-pointer ${isZenMode ? 'text-obsidian-inkPrimary bg-obsidian-surface3' : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'}`}
            title="Toggle Zen Focus Mode (Alt+Z)"
          >
            {isZenMode ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>

          <div className="h-3 w-px bg-obsidian-surface3 mx-0.5" />

          {/* Save Status & Button */}
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
                // Was `bg-zinc-100`: a fixed near-white chip. In dark theme
                // --ink-inverse is also near-white (#fafafa), so the label
                // rendered white-on-white. Token pair stays legible in both.
                ? 'bg-obsidian-accent hover:bg-obsidian-accentHover text-obsidian-inkInverse font-bold shadow-sm'
                : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
            }`}
            title="Save File (Ctrl+S)"
          >
            <Save className="w-3 h-3" />
            <span>Save</span>
          </button>
        </div>
      </div>

      {!isZenMode && <Breadcrumbs />}

      {/* Floating Inline Fast Edit Composer (⌘K) */}
      <InlineFastEdit
        isOpen={isFastEditOpen}
        onClose={() => setIsFastEditOpen(false)}
        selectedText={fastEditSelection.text}
        selectionRange={fastEditSelection.range}
        activeFilePath={activeTab.path}
        fileContent={activeTab.content}
        languageId={activeTab.language}
        onApplyDiff={handleApplyFastEditDiff}
        initialInstruction={fastEditInstruction}
      />

      {/* Floating Diagnostics Fixer Indicator */}
      <DiagnosticsFixerBar
        activeFilePath={activeTab.path}
        diagnostics={activeFileDiagnostics}
        onFixInline={(instruction) => {
          openFastEdit(instruction);
        }}
      />

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
              className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
              title="Accept Changes (⌘Y / Ctrl+Y)"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Accept (⌘Y)</span>
            </button>
            <button
              onClick={rejectInlineDiff}
              className="px-3 py-1 rounded-md bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40 font-mono text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
              title="Reject Changes (⌘N / Ctrl+N)"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reject (⌘N)</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        {inlineDiffState && inlineDiffState.path === activeTab.path ? (
          <DiffEditor
            height="100%"
            original={inlineDiffState.originalContent}
            modified={inlineDiffState.proposedContent}
            language={activeTab.language}
            theme={theme === 'light' ? 'obsidian-light' : 'obsidian-dark'}
            options={{
              renderSideBySide: false,
              readOnly: true,
              fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
              fontSize: 13,
              lineHeight: 20,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              minimap: { enabled: false },
              diffCodeLens: true,
            }}
          />
        ) : (
          <Editor
            height="100%"
            path={activeTab.path}
            language={activeTab.language}
            value={activeTab.content}
            theme={theme === 'light' ? 'obsidian-light' : 'obsidian-dark'}
            onMount={handleEditorDidMount}
            onChange={(val) => {
              if (val !== undefined && activeTabPath) {
                if (contentDebounceRef.current) clearTimeout(contentDebounceRef.current);
                contentDebounceRef.current = setTimeout(() => {
                  updateTabContent(activeTabPath, val);
                }, 120);
              }
            }}
            options={{
              fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
              fontSize: 13,
              lineHeight: 20,
              fontLigatures: true,
              minimap: { enabled: isMinimap, maxColumn: 80 },
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
              wordWrap: isWordWrap ? 'on' : 'off',
            }}
          />
        )}
      </div>
    </div>
  );
};
