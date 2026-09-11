import React, { useState, useEffect } from 'react';
import { FileCode, Code, Terminal, GitBranch, Globe } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export interface MentionItem {
  id: string;
  type: 'file' | 'symbol' | 'terminal' | 'git' | 'docs';
  label: string;
  detail?: string;
  icon: any;
  value: string;
}

interface MentionAutocompleteProps {
  filter: string;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
}

export const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({
  filter,
  onSelect,
  onClose,
}) => {
  const { openTabs } = useIDEStore();
  const [items, setItems] = useState<MentionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    let isCancelled = false;
    const cleanFilter = filter.toLowerCase().replace(/^@/, '');
    const results: MentionItem[] = [];

    // 1. Open Tabs First
    openTabs.forEach((tab) => {
      if (!cleanFilter || tab.name.toLowerCase().includes(cleanFilter) || tab.path.toLowerCase().includes(cleanFilter)) {
        results.push({
          id: `file-${tab.path}`,
          type: 'file',
          label: tab.name,
          detail: tab.path,
          icon: FileCode,
          value: `@file:${tab.path}`,
        });
      }
    });

    // 2. Global Mention Tokens
    const defaultActions: MentionItem[] = [
      {
        id: 'ctx-git-diff',
        type: 'git',
        label: 'Git Diffs & Changes',
        detail: 'Inject uncommitted working tree diff',
        icon: GitBranch,
        value: '@git:diff',
      },
      {
        id: 'ctx-git-status',
        type: 'git',
        label: 'Git Status',
        detail: 'Modified, staged & untracked files',
        icon: GitBranch,
        value: '@git:status',
      },
      {
        id: 'ctx-problems',
        type: 'symbol',
        label: 'Compiler Diagnostics',
        detail: 'Inject active TypeScript & lint errors',
        icon: Code,
        value: '@problems',
      },
      {
        id: 'ctx-terminal',
        type: 'terminal',
        label: 'Active Terminal Buffer',
        detail: 'Inject latest shell output & errors',
        icon: Terminal,
        value: '@terminal',
      },
      {
        id: 'ctx-codebase',
        type: 'symbol',
        label: 'Codebase Symbol Map',
        detail: 'AST index of all functions & classes',
        icon: Code,
        value: '@codebase:symbols',
      },
      {
        id: 'ctx-web',
        type: 'docs',
        label: 'Web Live Research',
        detail: 'Live web scraping & doc lookup',
        icon: Globe,
        value: '@web:search',
      },
    ];

    defaultActions.forEach((act) => {
      if (
        !cleanFilter ||
        act.label.toLowerCase().includes(cleanFilter) ||
        act.detail?.toLowerCase().includes(cleanFilter) ||
        act.value.toLowerCase().includes(cleanFilter)
      ) {
        results.push(act);
      }
    });

    setItems([...results]);
    setSelectedIndex(0);

    // 3. Dynamic Codebase Symbols Fetch from AST Indexer
    if (cleanFilter.length >= 2) {
      fetch(`/api/codebase/symbols?query=${encodeURIComponent(cleanFilter)}&limit=12`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          if (isCancelled || !Array.isArray(data.symbols)) return;
          const symbolItems: MentionItem[] = data.symbols.map((sym: any) => ({
            id: `sym-${sym.name}-${sym.line}`,
            type: 'symbol' as const,
            label: sym.name,
            detail: `${sym.kind} · ${sym.filePath}:${sym.line}`,
            icon: Code,
            value: `@symbol:${sym.name}`,
          }));
          setItems((prev) => {
            const existingIds = new Set(prev.map((i) => i.id));
            const fresh = symbolItems.filter((s) => !existingIds.has(s.id));
            return [...prev, ...fresh];
          });
        })
        .catch(() => undefined);
    }

    return () => {
      isCancelled = true;
    };
  }, [filter, openTabs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (items.length > 0 && items[selectedIndex]) {
          e.preventDefault();
          onSelect(items[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items, selectedIndex, onSelect, onClose]);

  if (items.length === 0) return null;

  return (
    <div className="absolute bottom-full left-2 right-2 mb-2 bg-obsidian-surface1 border border-obsidian-border rounded-xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl font-mono text-xs max-h-64 flex flex-col">
      <div className="px-3 py-1.5 bg-obsidian-surface2 border-b border-obsidian-hairline flex items-center justify-between text-[10px] text-obsidian-inkMuted uppercase tracking-wider font-semibold">
        <span>Insert Context Mention (@)</span>
        <span>↑↓ Navigate • Enter Select</span>
      </div>
      <div className="overflow-y-auto p-1 space-y-0.5">
        {items.map((item, idx) => {
          const Icon = item.icon;
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-semibold'
                  : 'hover:bg-obsidian-surface2 text-obsidian-inkPrimary'
              }`}
            >
              <div className={`p-1 rounded ${isSelected ? 'bg-[color:var(--overlay-muted)] text-obsidian-inkPrimary' : 'bg-obsidian-surface2 text-obsidian-inkSecondary'}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] truncate">{item.label}</div>
                {item.detail && (
                  <div className={`text-[9px] truncate opacity-70 ${isSelected ? 'text-obsidian-canvas' : 'text-obsidian-inkMuted'}`}>
                    {item.detail}
                  </div>
                )}
              </div>
              <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                isSelected ? 'bg-[color:var(--overlay-muted)] text-obsidian-inkPrimary' : 'bg-obsidian-surface2 text-obsidian-inkMuted'
              }`}>
                {item.type}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
