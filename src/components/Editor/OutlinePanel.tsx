import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  FileCode,
  Hash
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface SymbolItem {
  name: string;
  kind: 'class' | 'interface' | 'type' | 'function' | 'hook' | 'component' | 'enum';
  line: number;
  detail?: string;
}

const KIND_LABELS: Record<string, { label: string; style: string }> = {
  function: { label: 'fn', style: 'text-obsidian-inkPrimary bg-obsidian-surface2 border-obsidian-border' },
  hook: { label: 'hook', style: 'text-obsidian-inkSecondary bg-obsidian-surface2 border-obsidian-border' },
  interface: { label: 'interface', style: 'text-obsidian-inkSecondary bg-obsidian-surface2 border-obsidian-border' },
  type: { label: 'type', style: 'text-obsidian-inkSecondary bg-obsidian-surface2 border-obsidian-border' },
  class: { label: 'class', style: 'text-obsidian-inkPrimary bg-obsidian-surface2 border-obsidian-border' },
  component: { label: 'comp', style: 'text-obsidian-inkPrimary bg-obsidian-surface2 border-obsidian-border' },
  enum: { label: 'enum', style: 'text-obsidian-inkSecondary bg-obsidian-surface2 border-obsidian-border' },
};

export const OutlinePanel: React.FC = () => {
  const { openTabs, activeTabPath, setEditorTelemetry } = useIDEStore();
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  const extractSymbols = useCallback(async () => {
    if (!activeTab || !activeTab.content) {
      setSymbols([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/agent/extract-symbols', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: activeTab.content,
          filePath: activeTab.path,
        }),
      });
      const data = await res.json();
      if (Array.isArray(data?.symbols)) {
        setSymbols(data.symbols);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    extractSymbols();
  }, [extractSymbols]);

  const filteredSymbols = symbols.filter((s) =>
    !searchQuery.trim() || s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.kind.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleJumpToLine = (line: number) => {
    setEditorTelemetry({
      cursorPosition: { line, column: 1 },
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1 border-r border-obsidian-hairline select-none overflow-hidden font-sans">
      {/* Header */}
      <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] font-semibold text-obsidian-inkPrimary">
              Code Structure
            </span>
            <span className="text-[10px] font-mono text-obsidian-inkMuted">
              ({symbols.length})
            </span>
          </div>
          <span className="text-[10px] text-obsidian-inkMuted truncate">
            Functions & types in file
          </span>
        </div>
        <button
          onClick={extractSymbols}
          className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
          title="Refresh Code Outline"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-2 border-b border-obsidian-hairline bg-obsidian-surface1">
        <div className="relative">
          <Search className="w-3 h-3 text-obsidian-inkMuted absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search functions & classes..."
            className="w-full bg-obsidian-surface2 border-none rounded px-6 py-1 text-[11px] text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:ring-1 focus:ring-obsidian-hairline font-mono"
          />
        </div>
      </div>

      {/* Symbols List */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5 font-mono text-xs">
        {filteredSymbols.map((s, idx) => {
          const badge = KIND_LABELS[s.kind] || { label: s.kind, style: 'text-obsidian-inkMuted bg-obsidian-surface1 border-obsidian-border' };
          return (
            <button
              key={idx}
              onClick={() => handleJumpToLine(s.line)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-obsidian-surface2 text-left transition-colors cursor-pointer group"
              title={`Jump to line ${s.line} (${s.kind}: ${s.name})`}
            >
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <span className={`px-1.5 py-0.5 rounded text-[9px] lowercase border font-mono font-medium shrink-0 ${badge.style}`}>
                  {badge.label}
                </span>
                <span className="text-obsidian-inkPrimary font-medium truncate text-[11px] group-hover:text-obsidian-inkPrimary">
                  {s.name}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-obsidian-inkMuted shrink-0">
                <Hash className="w-2.5 h-2.5" />
                <span>{s.line}</span>
              </div>
            </button>
          );
        })}

        {filteredSymbols.length === 0 && !isLoading && (
          <div className="p-6 text-center text-obsidian-inkMuted space-y-2">
            <FileCode className="w-8 h-8 opacity-30 mx-auto" />
            <p className="text-[11px] font-mono">
              {activeTab ? 'No functions or types found in this file' : 'Open a file to view functions and structure'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
