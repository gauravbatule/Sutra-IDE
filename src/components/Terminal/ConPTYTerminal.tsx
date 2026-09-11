import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  TerminalSquare,
  Trash2,
  X,
  Plus,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface TermTab {
  id: string;
  name: string;
}

export const ConPTYTerminal: React.FC = () => {
  const {
    toggleTerminal,
    activeFileDiagnostics,
    activeTabPath,
    openFilePath,
    setUiMode,
    setAgentPanelOpen,
    setComposerDraft,
  } = useIDEStore();
  const [tabs, setTabs] = useState<TermTab[]>([{ id: 'main', name: '1: PowerShell' }]);
  const [activeTabId, setActiveTabId] = useState('main');
  const [isMaximized, setIsMaximized] = useState(false);
  const [managedProcesses, setManagedProcesses] = useState<any[]>([]);
  const [copiedDebugPrompt, setCopiedDebugPrompt] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // 1. Initialize xterm.js instance
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: true,
      scrollback: 5000,
      theme: {
        background: '#000000',
        foreground: '#fafafa',
        cursor: '#ffffff',
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
        black: '#121214',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#e4e4e7',
        magenta: '#d4d4d8',
        cyan: '#a1a1aa',
        white: '#fafafa',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#ffffff',
        brightMagenta: '#fafafa',
        brightCyan: '#d4d4d8',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new CanvasAddon());
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    // 2. Connect WebSocket to ConPTY backend
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const backendPort = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BACKEND_PORT) || '3001';
    const directHost = window.location.port === '5173' ? `${window.location.hostname}:${backendPort}` : window.location.host;
    const wsUrl = `${protocol}//${directHost}/ws`;
    
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    }
    socketRef.current = socket;

    const sendResize = () => {
      if (socket.readyState === WebSocket.OPEN && term.cols && term.rows) {
        socket.send(
          JSON.stringify({
            channel: 0x03, // PTY_RESIZE
            type: 'resize',
            payload: { sessionId: activeTabId, cols: term.cols, rows: term.rows },
            timestamp: Date.now(),
          })
        );
      }
    };

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          channel: 0x01, // PTY_INPUT
          type: 'init',
          payload: { sessionId: activeTabId, cols: term.cols || 80, rows: term.rows || 24 },
          timestamp: Date.now(),
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.channel === 0x02 && packet.type === 'data') {
          term.write(packet.payload);
        }
      } catch {
        term.write(event.data);
      }
    };

    // User keystrokes to PTY
    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            channel: 0x01, // PTY_INPUT
            type: 'data',
            payload: { sessionId: activeTabId, data },
            timestamp: Date.now(),
          })
        );
      }
    });

    // Resize listener with ResizeObserver for split panel resizing
    const handleResize = () => {
      try {
        if (terminalRef.current && terminalRef.current.clientWidth > 10 && terminalRef.current.clientHeight > 10) {
          fitAddon.fit();
          sendResize();
        }
      } catch {
        // Fitting can throw before layout dimensions exist; safe to skip.
      }
    };
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (terminalRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(terminalRef.current);
    }

    const timer = setTimeout(() => {
      handleResize();
    }, 150);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) resizeObserver.disconnect();
      socket.close();
      term.dispose();
    };
  }, [activeTabId]);

  const [copiedBuffer, setCopiedBuffer] = useState(false);

  const handleCopyBuffer = () => {
    if (!xtermInstance.current) return;
    xtermInstance.current.selectAll();
    const text = xtermInstance.current.getSelection();
    xtermInstance.current.clearSelection();
    if (text) {
      navigator.clipboard.writeText(text);
      setCopiedBuffer(true);
      setTimeout(() => setCopiedBuffer(false), 2000);
    }
  };

  const handleRestart = () => {
    if (xtermInstance.current) {
      xtermInstance.current.reset();
      xtermInstance.current.writeln('\x1b[33m[Restarting Terminal Session...]\x1b[0m');
    }
    if (socketRef.current) {
      socketRef.current.close();
    }
    const cleanId = activeTabId.split('-restart-')[0];
    setActiveTabId(`${cleanId}-restart-${Date.now()}`);
  };

  const handleAddTab = () => {
    const newId = `term-${Date.now()}`;
    const newNum = tabs.length + 1;
    const newTab = { id: newId, name: `${newNum}: Shell` };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (idToClose: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const remaining = tabs.filter((t) => t.id !== idToClose);
    setTabs(remaining);
    if (activeTabId === idToClose) {
      setActiveTabId(remaining[0].id);
    }
  };

  const [activePanelTab, setActivePanelTab] = useState<'terminal' | 'output' | 'problems'>('terminal');

  useEffect(() => {
    if (activePanelTab === 'output') {
      const fetchProcs = () => {
        fetch('/api/processes')
          .then((r) => r.json())
          .then((d) => setManagedProcesses(Array.isArray(d.processes) ? d.processes : []))
          .catch(() => setManagedProcesses([]));
      };
      fetchProcs();
      const interval = setInterval(fetchProcs, 4000);
      return () => clearInterval(interval);
    }
  }, [activePanelTab]);

  const errorCount = (activeFileDiagnostics || []).filter((d) => d.severity === 8).length;
  const warningCount = (activeFileDiagnostics || []).filter((d) => d.severity === 4).length;
  const totalDiags = errorCount + warningCount;

  const handleDebugWithAI = () => {
    let snippet = xtermInstance.current?.getSelection()?.trim();
    if (!snippet && xtermInstance.current) {
      const buffer = xtermInstance.current.buffer.active;
      const lines: string[] = [];
      const total = buffer.length;
      const start = Math.max(0, total - 40);
      for (let i = start; i < total; i++) {
        const line = buffer.getLine(i);
        if (line) {
          const str = line.translateToString(true).trimEnd();
          if (str) lines.push(str);
        }
      }
      snippet = lines.slice(-25).join('\n').trim();
    }
    if (!snippet) snippet = 'Terminal command output or build failure';

    const debugPrompt = `Debug and resolve the following terminal command output / error in this workspace:\n\n\`\`\`\n${snippet.slice(0, 8000)}\n\`\`\`\n\nPlease investigate the root cause, identify the responsible file or package, and apply the surgical fix.`;
    setComposerDraft(debugPrompt);
    setAgentPanelOpen(true);
    setCopiedDebugPrompt(true);
    setTimeout(() => setCopiedDebugPrompt(false), 2200);
  };

  const handleFixAllDiagnostics = () => {
    if (!activeFileDiagnostics || activeFileDiagnostics.length === 0) return;
    const summary = activeFileDiagnostics
      .slice(0, 10)
      .map((d) => `- Line ${d.startLineNumber}: [${d.severity === 8 ? 'Error' : 'Warning'}] ${d.message}`)
      .join('\n');
    const fixPrompt = `Fix the following ${errorCount} error(s) and ${warningCount} warning(s) in "${activeTabPath || 'the active file'}":\n${summary}\n\nPlease inspect the code, resolve type errors and syntax issues, and make sure the file compiles cleanly.`;
    setComposerDraft(fixPrompt);
    setAgentPanelOpen(true);
  };

  const runQuickCommand = (cmd: string) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          channel: 0x01,
          type: 'input',
          payload: { sessionId: activeTabId, data: `${cmd}\r` },
          timestamp: Date.now(),
        })
      );
      xtermInstance.current?.focus();
    }
  };

  return (
    <div
      className={`bg-[#090a0f] border-t border-obsidian-hairline flex flex-col z-10 select-text transition-all duration-150 ${
        isMaximized ? 'h-[75vh]' : 'h-64'
      }`}
    >
      {/* Top Header: VS Code / Ghostty Panel Tabs & Quick Actions */}
      <div className="h-8 bg-obsidian-surface1/90 border-b border-obsidian-hairline flex items-center justify-between px-3 text-xs select-none">
        {/* Left: Standard Panel Tabs */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            {(['terminal', 'output', 'problems'] as const).map((tab) => {
              const isActive = activePanelTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActivePanelTab(tab)}
                  className={`px-2 py-1 text-[11px] font-mono uppercase tracking-wider transition-colors cursor-pointer relative flex items-center gap-1.5 ${
                    isActive
                      ? 'text-obsidian-inkPrimary font-semibold'
                      : 'text-obsidian-inkMuted hover:text-obsidian-inkSecondary'
                  }`}
                >
                  <span>{tab}</span>
                  {tab === 'problems' && totalDiags > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold leading-tight ${
                        errorCount > 0
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {totalDiags}
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-obsidian-inkPrimary rounded-full" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="h-3 w-px bg-obsidian-hairline hidden sm:block" />

          {/* Subshell tabs */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`group px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1.5 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-obsidian-surface3 text-obsidian-inkPrimary font-semibold border border-obsidian-border'
                      : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2'
                  }`}
                >
                  <TerminalSquare className="w-3 h-3 opacity-70" />
                  <span>{tab.name}</span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => handleCloseTab(tab.id, e)}
                      className="w-3 h-3 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-obsidian-surface4 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              onClick={handleAddTab}
              className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
              title="New Terminal Tab (Ctrl+Shift+`)"
              aria-label="New Terminal Tab"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Center: Quick Command Pills */}
        <div className="hidden md:flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => runQuickCommand('npm test')}
            className="px-2 py-0.5 rounded text-[10px] font-mono bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline transition-colors cursor-pointer"
            title="Execute: npm test"
          >
            npm test
          </button>
          <button
            type="button"
            onClick={() => runQuickCommand('git status')}
            className="px-2 py-0.5 rounded text-[10px] font-mono bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary border border-obsidian-hairline transition-colors cursor-pointer"
            title="Execute: git status"
          >
            git status
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {/* Debug with SUTRA AI Action */}
          <button
            type="button"
            onClick={handleDebugWithAI}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition-all cursor-pointer shadow-xs active:scale-95"
            title="Debug Terminal Selection or Last Error with SUTRA AI"
          >
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span>{copiedDebugPrompt ? 'Prompt Ready!' : 'Debug with AI'}</span>
          </button>

          <button
            onClick={handleCopyBuffer}
            className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title={copiedBuffer ? 'Copied Buffer to Clipboard' : 'Copy All Terminal Output'}
            aria-label="Copy Terminal Buffer"
          >
            {copiedBuffer ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
          <button
            onClick={handleRestart}
            className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Restart Terminal Session"
            aria-label="Restart Terminal"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <button
            onClick={() => xtermInstance.current?.clear()}
            className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Clear Terminal Buffer"
            aria-label="Clear Buffer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              setIsMaximized(!isMaximized);
              setTimeout(() => fitAddonRef.current?.fit(), 100);
            }}
            className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title={isMaximized ? 'Restore Terminal Pane' : 'Maximize Terminal Pane'}
            aria-label={isMaximized ? 'Restore Terminal' : 'Maximize Terminal'}
          >
            {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button
            onClick={toggleTerminal}
            className="p-1 rounded hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Close Terminal (Ctrl+`)"
            aria-label="Close Terminal"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Terminal Screen / Output Screen / Problems Screen */}
      <div className="flex-1 p-2 overflow-hidden bg-[#090a0f]">
        {activePanelTab === 'terminal' && (
          <div ref={terminalRef} className="w-full h-full" />
        )}

        {/* Live Process & System Output */}
        {activePanelTab === 'output' && (
          <div className="w-full h-full p-3 font-mono text-xs text-obsidian-inkSecondary overflow-y-auto space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-obsidian-hairline text-[10px] text-obsidian-inkMuted uppercase tracking-wider">
              <span>Managed Processes & Services ({managedProcesses.length})</span>
              <span className="text-emerald-400">● Core API Active (3001) · Client (5173)</span>
            </div>

            {managedProcesses.length > 0 ? (
              <div className="space-y-1.5">
                {managedProcesses.map((proc) => (
                  <div
                    key={proc.id}
                    className="p-2 rounded-lg bg-obsidian-surface1 border border-obsidian-hairline flex items-center justify-between gap-3 text-[11px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          proc.status === 'running'
                            ? 'bg-emerald-400 animate-pulse'
                            : proc.status === 'failed'
                              ? 'bg-red-400'
                              : 'bg-zinc-500'
                        }`}
                      />
                      <span className="font-semibold text-obsidian-inkPrimary truncate">{proc.command}</span>
                      {proc.port && <span className="text-[10px] text-cyan-400 font-mono">:{proc.port}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] uppercase font-mono text-obsidian-inkMuted">{proc.status}</span>
                      {proc.lastError && (
                        <span className="text-[10px] text-red-400 max-w-xs truncate" title={proc.lastError}>
                          {proc.lastError}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1 text-obsidian-inkMuted text-[11px]">
                <div>[Server] Express API listening on port 3001 (PID active)</div>
                <div>[Client] Vite development server running on port 5173</div>
                <div>[ConPTY] Windows ConPTY pseudo-terminal WebSocket active at /ws</div>
                <div>[Codebase] AST Indexer & Symbol Graph active</div>
                <div>No external child background workers currently scheduled.</div>
              </div>
            )}
          </div>
        )}

        {/* Real-time Diagnostics & Problems Screen */}
        {activePanelTab === 'problems' && (
          <div className="w-full h-full flex flex-col overflow-hidden font-mono text-xs">
            {activeFileDiagnostics && activeFileDiagnostics.length > 0 ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Problems Toolbar */}
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-obsidian-hairline px-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-semibold text-obsidian-inkPrimary">
                      {activeTabPath ? activeTabPath.split(/[/\\]/).pop() : 'Active File'}:
                    </span>
                    {errorCount > 0 && (
                      <span className="flex items-center gap-1 text-red-400 font-medium">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {errorCount} {errorCount === 1 ? 'Error' : 'Errors'}
                      </span>
                    )}
                    {warningCount > 0 && (
                      <span className="flex items-center gap-1 text-amber-400 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleFixAllDiagnostics}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-obsidian-inkPrimary hover:bg-obsidian-accentHover text-obsidian-canvas text-[10px] font-bold transition-all cursor-pointer shadow-xs active:scale-95"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Fix All with SUTRA</span>
                  </button>
                </div>

                {/* Problems List */}
                <div className="flex-1 overflow-y-auto space-y-1 px-1">
                  {activeFileDiagnostics.map((diag, index) => {
                    const isError = diag.severity === 8;
                    return (
                      <div
                        key={index}
                        onClick={() => {
                          if (activeTabPath) {
                            openFilePath(`${activeTabPath}:${diag.startLineNumber}`);
                          }
                        }}
                        className="group p-2 rounded-lg bg-obsidian-surface1/60 hover:bg-obsidian-surface2 border border-obsidian-hairline hover:border-obsidian-borderBright flex items-start justify-between gap-3 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          {isError ? (
                            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <p className="text-obsidian-inkPrimary text-[11px] leading-snug break-words">
                              {diag.message}
                            </p>
                            <p className="text-[10px] text-obsidian-inkMuted mt-0.5">
                              {activeTabPath} [{diag.startLineNumber}, {diag.endLineNumber}]
                            </p>
                          </div>
                        </div>

                        <span className="text-[10px] text-obsidian-inkMuted group-hover:text-obsidian-inkPrimary shrink-0">
                          Line {diag.startLineNumber} ↗
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center p-6 select-none">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                <p className="text-sm font-sans font-medium text-obsidian-inkPrimary">
                  No problems detected in active file
                </p>
                <p className="text-xs text-obsidian-inkMuted max-w-sm">
                  TypeScript compiler and linter report zero errors. Your workspace build is healthy.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
