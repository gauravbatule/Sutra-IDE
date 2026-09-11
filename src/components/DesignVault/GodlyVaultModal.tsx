import React, { useState, useEffect } from 'react';
import {
  X,
  Layers,
  Copy,
  Check,
  Wand2,
  ShieldCheck,
  Globe,
  Search,
  ExternalLink,
  DownloadCloud,
  FileCode,
  Cpu
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const GodlyVaultModal: React.FC = () => {
  const { isVaultModalOpen, setVaultModalOpen, openFile } = useIDEStore();
  const [activeTab, setActiveTab] = useState<'vault' | 'live_search'>('vault');
  const [patterns, setPatterns] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Live Research states
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [scrapedData, setScrapedData] = useState<any | null>(null);
  const [isScraping, setIsScraping] = useState(false);

  useEffect(() => {
    if (isVaultModalOpen) {
      fetch('/api/vault/patterns')
        .then((r) => r.json())
        .then((data) => setPatterns(data))
        .catch(console.error);
    }
  }, [isVaultModalOpen]);

  if (!isVaultModalOpen) return null;

  const handleLiveSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch('/api/research/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, limit: 6 }),
      });
      const data = await res.json();
      setSearchResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleScrapeUrl = async (url: string) => {
    setIsScraping(true);
    try {
      const res = await fetch('/api/research/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxContextLength: 3000 }),
      });
      const data = await res.json();
      setScrapedData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsScraping(false);
    }
  };

  const handleInjectInspiration = (title: string, code: string) => {
    const cleanName = title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
    openFile({
      path: `src/components/injected/${cleanName}.tsx`,
      name: `${cleanName}.tsx`,
      content: `// Injected via Live Web Scraper & Research Engine\n// Source: ${title}\nimport React from 'react';\n\nexport const ${cleanName}: React.FC = () => {\n  return (\n    <div className="p-6 bg-obsidian-surface1 text-obsidian-inkPrimary rounded-xl border border-obsidian-border">\n      <h2 className="text-xl font-bold mb-3">${title}</h2>\n      <pre className="text-xs font-mono text-obsidian-inkSecondary overflow-x-auto p-4 bg-obsidian-surface3 rounded">\n{\`${code.replace(/`/g, '\\`')}\`}\n      </pre>\n    </div>\n  );\n};\n`,
    });
    setVaultModalOpen(false);
  };

  const filtered = selectedCategory === 'all' 
    ? patterns 
    : patterns.filter((p) => p.category === selectedCategory);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
      <div className="w-full max-w-5xl h-[85vh] bg-obsidian-surface1 border border-obsidian-border rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-obsidian-hairline flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-obsidian-surface1 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-obsidian-inkPrimary flex items-center gap-2">
                UI Archetypes & Web Research
                <span className="text-[10px] font-mono text-obsidian-inkSecondary bg-obsidian-surface2 border border-obsidian-hairline px-2 py-0.5 rounded">
                  Design Vault
                </span>
              </h2>
              <p className="text-xs text-obsidian-inkSecondary">
                Browse curated component archetypes or search the web for design references.
              </p>
            </div>
          </div>

          <button
            onClick={() => setVaultModalOpen(false)}
            className="p-1.5 rounded-lg hover:bg-obsidian-surface4 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Navigation Mode Tabs */}
        <div className="flex items-center gap-2 px-4 pt-3 border-b border-obsidian-hairline text-xs font-medium">
          <button
            onClick={() => setActiveTab('vault')}
            className={`pb-2.5 px-2 border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'vault' ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold' : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Curated Archetypes ({patterns.length})
          </button>
          <button
            onClick={() => setActiveTab('live_search')}
            className={`pb-2.5 px-2 border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'live_search' ? 'border-obsidian-inkPrimary text-obsidian-inkPrimary font-bold' : 'border-transparent text-obsidian-inkSecondary hover:text-obsidian-inkPrimary'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Web Reference Search
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {activeTab === 'vault' && (
            <>
              {/* Left Categories */}
              <div className="w-48 border-r border-obsidian-hairline p-3 space-y-1 text-xs select-none">
                {['all', 'hero', 'bento', 'dock', 'pricing'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`w-full text-left px-3 py-2 rounded-lg font-medium uppercase text-[11px] tracking-wider transition-colors ${
                      selectedCategory === cat
                        ? 'bg-obsidian-surface1 text-obsidian-inkPrimary border border-obsidian-border'
                        : 'text-obsidian-inkSecondary hover:bg-obsidian-surface4/50 hover:text-obsidian-inkPrimary'
                    }`}
                  >
                    {cat}
                  </button>
                ))}

                <div className="pt-4 mt-4 border-t border-obsidian-hairline">
                  <div className="px-3 text-[10px] font-mono text-obsidian-inkMuted uppercase tracking-wider mb-2">
                    Visual Quality
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline text-[11px] text-obsidian-inkSecondary">
                    <div className="flex items-center gap-1 text-obsidian-inkPrimary font-bold mb-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Anti-Slop V2.0
                    </div>
                    <span>Paper + Ink + Accent model enforced.</span>
                  </div>
                </div>
              </div>

              {/* Right Patterns Grid */}
              <div className="flex-1 p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                {filtered.map((pat) => (
                  <div
                    key={pat.id}
                    className="p-4 rounded-xl bg-obsidian-surface3/60 border border-obsidian-hairline hover:border-obsidian-border transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-mono text-obsidian-inkPrimary uppercase tracking-wider">
                          {pat.category} • {pat.tier}
                        </span>
                        <div className="flex gap-1">
                          {pat.tags.map((t: string) => (
                            <span key={t} className="text-[9px] font-mono bg-obsidian-surface4 text-obsidian-inkSecondary px-1.5 py-0.5 rounded">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>

                      <h3 className="text-sm font-bold text-obsidian-inkPrimary mb-2">{pat.name}</h3>
                      <p className="text-xs text-obsidian-inkSecondary leading-relaxed mb-4">{pat.previewDescription}</p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-obsidian-hairline">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(pat.codeTemplate);
                          setCopiedId(pat.id);
                          setTimeout(() => setCopiedId(null), 2000);
                        }}
                        className="flex items-center gap-1 text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors"
                      >
                        {copiedId === pat.id ? <Check className="w-3.5 h-3.5 text-obsidian-inkPrimary" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedId === pat.id ? 'Copied' : 'Copy Code'}</span>
                      </button>

                      <button
                        onClick={() => {
                          openFile({
                            path: `src/components/injected/${pat.name.replace(/\s+/g, '')}.tsx`,
                            name: `${pat.name.replace(/\s+/g, '')}.tsx`,
                            content: `// Injected from Godly UI/UX Inspiration Vault\nimport React from 'react';\n\nexport const ${pat.name.replace(/\s+/g, '')}: React.FC = () => {\n  return (\n    ${pat.codeTemplate}\n  );\n};\n`,
                          });
                          setVaultModalOpen(false);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-obsidian-surface4 hover:bg-obsidian-surface4 text-obsidian-inkPrimary font-medium text-xs shadow-md shadow-black/40 transition-all active:scale-95"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        Inject into Project
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'live_search' && (
            <div className="flex-1 p-6 overflow-y-auto flex flex-col space-y-6">
              {/* Search Bar */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="w-4 h-4 text-obsidian-inkMuted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLiveSearch()}
                    placeholder="Search Google, Godly, or documentation for live design patterns (e.g. 'Linear dark hero component', 'Stripe pricing table CSS')..."
                    className="w-full bg-obsidian-surface3 border border-obsidian-border rounded-xl pl-9 pr-4 py-2.5 text-xs text-obsidian-inkPrimary placeholder-obsidian-inkMuted focus:outline-none focus:border-obsidian-accent"
                  />
                </div>
                <button
                  onClick={handleLiveSearch}
                  disabled={isSearching || !searchQuery.trim()}
                  className="px-5 py-2.5 rounded-xl bg-obsidian-surface4 hover:bg-obsidian-surface4 text-obsidian-inkPrimary font-medium text-xs flex items-center gap-1.5 transition-all shadow-md shadow-black/40 active:scale-95"
                >
                  <Globe className="w-3.5 h-3.5" />
                  {isSearching ? 'Searching...' : 'Search Web'}
                </button>
              </div>

              {/* Search Results */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {searchResults.map((res, i) => (
                  <div key={i} className="p-4 rounded-xl bg-obsidian-surface3/60 border border-obsidian-hairline flex flex-col justify-between hover:border-obsidian-border transition-all">
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-obsidian-inkPrimary mb-1">
                        <span>{res.source}</span>
                        <a href={res.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline text-obsidian-inkMuted">
                          Visit <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                      <h4 className="text-xs font-bold text-obsidian-inkPrimary mb-1.5">{res.title}</h4>
                      <p className="text-[11px] text-obsidian-inkSecondary leading-relaxed mb-3 line-clamp-3">{res.snippet}</p>
                    </div>

                    <button
                      onClick={() => handleScrapeUrl(res.url)}
                      disabled={isScraping}
                      className="w-full py-2 rounded-lg bg-obsidian-surface4 hover:bg-obsidian-surface4 text-obsidian-inkPrimary font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <DownloadCloud className="w-3.5 h-3.5 text-obsidian-inkPrimary" />
                      Scrape, Extract & Compress Context
                    </button>
                  </div>
                ))}
              </div>

              {/* Scraped & Compressed Knowledge Inspector */}
              {scrapedData && (
                <div className="p-4 rounded-xl bg-obsidian-surface1 border border-obsidian-border space-y-3">
                  <div className="flex items-center justify-between border-b border-obsidian-border pb-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-obsidian-inkPrimary" />
                      <span className="font-bold text-xs text-obsidian-inkPrimary">Compressed Knowledge & Extracted Code</span>
                    </div>
                    <div className="text-[10px] font-mono text-obsidian-inkPrimary bg-obsidian-surface1 px-2 py-0.5 rounded">
                      Saved ~{scrapedData.tokensSavedEstimate} Tokens
                    </div>
                  </div>

                  <div className="text-xs text-obsidian-inkSecondary whitespace-pre-wrap max-h-40 overflow-y-auto p-3 bg-obsidian-surface3/60 rounded-lg font-mono">
                    {scrapedData.compressedContext}
                  </div>

                  {scrapedData.codeBlocks.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-obsidian-inkPrimary">Extracted Code Blocks:</span>
                      {scrapedData.codeBlocks.map((code: string, idx: number) => (
                        <div key={idx} className="p-3 rounded-lg bg-obsidian-surface3 border border-obsidian-hairline space-y-2">
                          <pre className="text-[11px] font-mono text-obsidian-inkPrimary max-h-32 overflow-y-auto">
                            {code}
                          </pre>
                          <button
                            onClick={() => handleInjectInspiration(`ExtractedPattern${idx + 1}`, code)}
                            className="px-3 py-1.5 rounded bg-obsidian-surface4 hover:bg-obsidian-surface4 text-obsidian-inkPrimary font-medium text-xs flex items-center gap-1 transition-all"
                          >
                            <FileCode className="w-3 h-3" />
                            Inject Extracted Code
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
