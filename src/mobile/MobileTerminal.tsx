import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';

export const MobileTerminal: React.FC = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      fontSize: 11,
      lineHeight: 1.2,
      fontFamily: 'JetBrains Mono, monospace',
      cursorBlink: true,
      theme: {
        background: '#0a0a0c',
        foreground: '#fafafa',
        cursor: '#fafafa',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new CanvasAddon());

    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?client=mobile`);
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          channel: 0x01,
          type: 'init',
          payload: { sessionId: 'mobile' },
          timestamp: Date.now(),
        })
      );
    };

    ws.onmessage = (e) => {
      try {
        const p = JSON.parse(e.data);
        if (p.channel === 0x02 && p.type === 'data') {
          term.write(p.payload);
        }
      } catch {
        term.write(e.data);
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            channel: 0x01,
            type: 'data',
            payload: { sessionId: 'mobile', data },
            timestamp: Date.now(),
          })
        );
      }
    });

    return () => {
      ws.close();
      term.dispose();
    };
  }, []);

  const sendKey = (seq: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          channel: 0x01,
          type: 'data',
          payload: { sessionId: 'mobile', data: seq },
          timestamp: Date.now(),
        })
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1">
      {/* Terminal Viewport */}
      <div ref={terminalRef} className="flex-1 p-2 overflow-hidden" />

      {/* Mobile Soft Modifier Bar */}
      <div className="h-10 bg-obsidian-surface2 border-t border-obsidian-hairline flex items-center gap-1.5 px-2 overflow-x-auto text-xs font-mono select-none">
        <button onClick={() => sendKey('\x1b')} className="px-2.5 py-1 bg-obsidian-surface4 rounded-lg text-obsidian-inkPrimary active:bg-obsidian-surface4">
          ESC
        </button>
        <button onClick={() => sendKey('\t')} className="px-2.5 py-1 bg-obsidian-surface4 rounded-lg text-obsidian-inkPrimary active:bg-obsidian-surface4">
          TAB
        </button>
        <button onClick={() => sendKey('\x03')} className="px-2.5 py-1 bg-obsidian-surface4 rounded-lg text-obsidian-inkSecondary active:bg-obsidian-surface4">
          CTRL+C
        </button>
        <button onClick={() => sendKey('\x1b[A')} className="px-2.5 py-1 bg-obsidian-surface4 rounded-lg text-obsidian-inkPrimary active:bg-obsidian-surface4">
          ↑
        </button>
        <button onClick={() => sendKey('\x1b[B')} className="px-2.5 py-1 bg-obsidian-surface4 rounded-lg text-obsidian-inkPrimary active:bg-obsidian-surface4">
          ↓
        </button>
        <button onClick={() => sendKey('clear\r')} className="px-2.5 py-1 bg-obsidian-surface4 rounded-lg text-obsidian-inkPrimary active:bg-obsidian-surface4">
          CLEAR
        </button>
      </div>
    </div>
  );
};
