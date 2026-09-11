import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { TerminalSquare, Trash2, X, Plus, Maximize2, Minimize2 } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface TermTab {
  id: string;
  name: string;
}

export const ConPTYTerminal: React.FC = () => {
  const { toggleTerminal } = useIDEStore();
  const [tabs, setTabs] = useState<TermTab[]>([{ id: 'main', name: '1: PowerShell' }]);
  const [activeTabId, setActiveTabId] = useState('main');
  const [isMaximized, setIsMaximized] = useState(false);

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
    const directHost = `${window.location.hostname}:3001`;
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

    // Resize listener
    const handleResize = () => {
      try {
        fitAddon.fit();
        sendResize();
      } catch {
        // Fitting can throw before layout dimensions exist; safe to skip.
      }
    };
    window.addEventListener('resize', handleResize);

    const timer = setTimeout(() => {
      try {
        fitAddon.fit();
        sendResize();
      } catch {
        // Same as above: the terminal may not be measurable yet.
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      socket.close();
      term.dispose();
    };
  }, [activeTabId]);

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

  return (
    <div
      className={`bg-obsidian-canvas border-t border-obsidian-hairline flex flex-col z-10 select-text transition-all duration-150 ${
        isMaximized ? 'h-[75vh]' : 'h-60'
      }`}
    >
      {/* Terminal Tab Bar & Controls */}
      <div className="h-7 bg-obsidian-surface1 border-b border-obsidian-hairline flex items-center justify-between px-2 text-xs text-obsidian-inkSecondary select-none">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <TerminalSquare className="w-3.5 h-3.5 text-obsidian-inkPrimary ml-1 mr-1.5 shrink-0" />
          
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`group px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1.5 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-obsidian-surface2 text-obsidian-inkPrimary font-semibold border border-obsidian-hairline'
                    : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2/50'
                }`}
              >
                <span>{tab.name}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    className="w-3 h-3 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-obsidian-surface4 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}

          <button
            onClick={handleAddTab}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors ml-0.5"
            title="New Terminal"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => xtermInstance.current?.clear()}
            className="p-1 rounded hover:bg-obsidian-surface4 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors"
            title="Clear Terminal"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              setIsMaximized(!isMaximized);
              setTimeout(() => fitAddonRef.current?.fit(), 100);
            }}
            className="p-1 rounded hover:bg-obsidian-surface4 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors"
            title={isMaximized ? 'Restore Terminal' : 'Maximize Terminal'}
          >
            {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button
            onClick={toggleTerminal}
            className="p-1 rounded hover:bg-obsidian-surface4 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors"
            title="Close Terminal"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Terminal Screen */}
      <div ref={terminalRef} className="flex-1 p-2 overflow-hidden" />
    </div>
  );
};
