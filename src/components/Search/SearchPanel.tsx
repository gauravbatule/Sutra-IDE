import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, FileCode, Loader2, X } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

interface SearchResult {
  file: string;
  line: number;
  content: string;
}

export const SearchPanel: React.FC = () => {
  const { openFilePath } = useIDEStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const debounceTimer = useRef<any>(null);

  const performSearch = useCallback(async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch('/api/fs/grep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchTerm,
          caseInsensitive: !caseSensitive,
        }),
      });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [caseSensitive]);

  useEffect(() => {
    clearTimeout(debounceTimer.current);
    if (query.trim()) {
      setIsSearching(true);
      debounceTimer.current = setTimeout(() => {
        performSearch(query);
      }, 250);
    } else {
      setResults([]);
      setIsSearching(false);
    }
    return () => clearTimeout(debounceTimer.current);
  }, [query, caseSensitive, performSearch]);

  // Group results by file
  const groupedResults = results.reduce<Record<string, SearchResult[]>>((acc, item) => {
    if (!acc[item.file]) acc[item.file] = [];
    acc[item.file].push(item);
    return acc;
  }, {});

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1 select-none overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-obsidian-hairline flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-obsidian-inkPrimary flex items-center gap-1.5">
          <Search className="w-3.5 h-3.5 text-obsidian-accent" />
          Workspace Search
        </span>
        {results.length > 0 && (
          <span className="text-[10px] font-mono text-obsidian-inkMuted bg-white/[0.04] px-1.5 py-0.5 rounded">
            {results.length} matches
          </span>
        )}
      </div>

      {/* Search Input Box */}
      <div className="p-3 border-b border-obsidian-hairline bg-obsidian-surface2/40 space-y-2">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-obsidian-inkMuted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code across all files..."
            className="w-full pl-8 pr-7 py-1.5 bg-obsidian-surface1 border border-obsidian-hairline rounded-md text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent focus:ring-1 focus:ring-obsidian-accent/30 font-mono transition-all"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-[10px] text-obsidian-inkSecondary font-mono">
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-obsidian-inkPrimary">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="rounded bg-obsidian-surface1 border-obsidian-hairline text-obsidian-accent focus:ring-0 w-3 h-3"
            />
            <span>Match Case (Aa)</span>
          </label>

          {isSearching && (
            <div className="flex items-center gap-1 text-obsidian-accent">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Scanning...</span>
            </div>
          )}
        </div>
      </div>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3 font-mono text-xs">
        {query && !isSearching && results.length === 0 && (
          <div className="p-6 text-center text-obsidian-inkMuted text-xs space-y-1">
            <p>No matches found for "{query}"</p>
            <p className="text-[10px] text-obsidian-inkMuted">Try searching for a different term or keyword</p>
          </div>
        )}

        {!query && (
          <div className="p-6 text-center text-obsidian-inkMuted text-xs space-y-2">
            <Search className="w-6 h-6 mx-auto text-obsidian-inkMuted/40" />
            <p className="text-[11px]">Type to search symbols, functions, or text across the entire codebase</p>
          </div>
        )}

        {Object.entries(groupedResults).map(([file, items]) => (
          <div key={file} className="border border-white/[0.05] rounded-md overflow-hidden bg-obsidian-surface2/30">
            {/* File Group Header */}
            <button
              onClick={() => openFilePath(file)}
              className="w-full px-2.5 py-1.5 bg-obsidian-surface2/80 hover:bg-white/[0.08] flex items-center justify-between text-left transition-colors border-b border-white/[0.04]"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <FileCode className="w-3.5 h-3.5 text-obsidian-accent shrink-0" />
                <span className="text-[11px] font-semibold text-obsidian-inkPrimary truncate">{file}</span>
              </div>
              <span className="text-[9px] text-obsidian-inkMuted shrink-0 bg-black/30 px-1.5 py-0.5 rounded">
                {items.length}
              </span>
            </button>

            {/* Matching Lines */}
            <div className="divide-y divide-white/[0.02]">
              {items.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => openFilePath(item.file)}
                  className="w-full px-3 py-1.5 hover:bg-white/[0.06] flex items-start gap-2 text-left transition-colors group"
                >
                  <span className="text-[10px] text-obsidian-inkMuted shrink-0 w-6 text-right">
                    {item.line}
                  </span>
                  <span className="text-[11px] text-obsidian-inkSecondary group-hover:text-obsidian-inkPrimary truncate">
                    {item.content}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
