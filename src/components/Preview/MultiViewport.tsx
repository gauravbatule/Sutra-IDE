import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Monitor,
  Smartphone,
  RefreshCw,
  ExternalLink,
  X,
  Globe,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  FileCode,
  Play,
  Loader2,
  Columns,
  Maximize2,
  Sparkles,
  Zap,
  Terminal,
  Eye,
  EyeOff,
  CheckCircle2,
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { ElementInspector, type SelectedElement } from './ElementInspector.js';
import type { ToolCallPayload } from '../../types/ide.js';

interface PreviewPage {
  title: string;
  path: string;
  type: 'html' | 'nextjs' | 'route';
}

interface DetectedProject {
  id: string;
  name: string;
  framework: string;
  type: 'nextjs' | 'vite' | 'astro' | 'nuxt' | 'remix' | 'svelte' | 'cra' | 'python' | 'static' | 'custom';
  cwd: string;
  relCwd: string;
  command: string;
  port: number | null;
  isRunning: boolean;
  previewUrl: string;
  badge: string;
}

// Resolve target URL for any framework (Next.js, Vite, static HTML)
export const resolveTargetUrl = (input: string): string => {
  const trimmed = (input || '').trim();
  if (!trimmed || trimmed === '/') return '/preview';

  // Prevent self-referential embedding of the SUTRA IDE host application shell
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`);
    if (
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      (parsed.port === '5173' || parsed.port === '3001')
    ) {
      if (parsed.pathname === '/' || parsed.pathname === '' || parsed.pathname === '/index.html') {
        return '/preview';
      }
      if (parsed.pathname.startsWith('/workspace') || parsed.pathname.startsWith('/preview') || parsed.pathname.startsWith('/api/preview/proxy')) {
        return parsed.pathname + parsed.search;
      }
      return '/preview';
    }
  } catch {}

  // Port shortcut e.g. "3000" -> proxy to Next.js on port 3000
  if (/^\d{4,5}$/.test(trimmed)) {
    return `/api/preview/proxy?url=http://localhost:${trimmed}`;
  }

  // Localhost dev servers (e.g. Next.js on localhost:3000) -> use frame-safe proxy
  if (trimmed.includes('localhost:') || trimmed.includes('127.0.0.1:')) {
    const full = trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
    return `/api/preview/proxy?url=${encodeURIComponent(full)}`;
  }

  // External URLs (e.g. https://example.com) -> use frame-safe proxy
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return `/api/preview/proxy?url=${encodeURIComponent(trimmed)}`;
  }

  // Guard against bare /api/preview/proxy without a target URL
  if (trimmed === '/api/preview/proxy' || trimmed === '/api/preview/proxy?') {
    return '/preview';
  }

  // If starts with /workspace or /preview, use directly
  if (trimmed.startsWith('/workspace') || trimmed.startsWith('/preview')) {
    return trimmed;
  }

  // If already a valid proxy URL, use directly
  if (trimmed.startsWith('/api/preview/proxy?url=')) {
    return trimmed;
  }

  // Relative page name (e.g. "about.html", "/about", "contact")
  const clean = trimmed.replace(/^\/+/, '');
  if (!clean) return '/preview';
  const withExt = clean.includes('.') ? clean : `${clean}.html`;
  return `/workspace/${withExt}`;
};

export const getDisplayUrl = (url: string): string => {
  if (!url) return '/preview';
  if (url.startsWith('/api/preview/proxy?url=')) {
    try {
      const parsed = new URL(url, 'http://localhost');
      return parsed.searchParams.get('url') || url;
    } catch {
      return url;
    }
  }
  return url;
};

export const MultiViewport: React.FC = () => {
  const {
    isPreviewOpen,
    togglePreview,
    previewViewport,
    setPreviewViewport,
    previewLayout,
    togglePreviewLayout,
    previewUrl,
    setPreviewUrl,
    isAgentGenerating,
    currentAgentThinking,
    agentMessages,
    fileTreeVersion,
    currentWorkspacePath,
  } = useIDEStore();
  const [iframeKey, setIframeKey] = useState(Date.now());
  const [urlInput, setUrlInput] = useState(getDisplayUrl(previewUrl || '/preview'));
  const [pages, setPages] = useState<PreviewPage[]>([]);
  const [detectedProjects, setDetectedProjects] = useState<DetectedProject[]>([]);
  const [activeProject, setActiveProject] = useState<DetectedProject | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isPagesOpen, setIsPagesOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [dismissWorkInProgress, setDismissWorkInProgress] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pagesMenuRef = useRef<HTMLDivElement>(null);
  const autoLaunchedRef = useRef<Set<string>>(new Set());
  const prevIsGeneratingRef = useRef<boolean>(false);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [history, setHistory] = useState<string[]>([previewUrl || '/preview']);
  const [historyIdx, setHistoryIdx] = useState(0);

  // Derive latest tool action and clean thinking trace from Astra
  const latestMessage = agentMessages[agentMessages.length - 1];
  const latestToolCall: ToolCallPayload | null =
    latestMessage?.toolCalls && latestMessage.toolCalls.length > 0
      ? latestMessage.toolCalls[latestMessage.toolCalls.length - 1]
      : null;

  const getToolActionLabel = (tc: ToolCallPayload | null): string | null => {
    if (!tc) return null;
    const tool = tc.tool;
    const params = tc.params || {};
    if (tool === 'write_file') {
      const p = params.path ? String(params.path).replace(/\\/g, '/').split('/').pop() : 'file';
      return `Creating ${p}…`;
    }
    if (tool === 'edit_file') {
      const p = params.path ? String(params.path).replace(/\\/g, '/').split('/').pop() : 'file';
      return `Updating ${p}…`;
    }
    if (tool === 'run_command') {
      const cmd = params.command ? String(params.command).slice(0, 45) : 'command';
      return `Running: ${cmd}…`;
    }
    if (tool === 'create_directory') {
      const p = params.path ? String(params.path).replace(/\\/g, '/').split('/').pop() : 'directory';
      return `Creating folder ${p}…`;
    }
    if (tool === 'list_directory') {
      return 'Scanning workspace files…';
    }
    if (tool === 'verify_http_server') {
      return `Verifying port ${params.port || 3000}…`;
    }
    return `Executing ${tool}…`;
  };

  const activeToolAction = getToolActionLabel(latestToolCall);
  const cleanThinkingSnippet = currentAgentThinking
    ? currentAgentThinking
        .replace(/<[^>]+>/g, '')
        .trim()
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .slice(-2)
        .join(' ')
    : '';

  const startLoadingTimeout = useCallback(() => {
    setIsLoading(true);
    setIsError(false);
    setLoadTimedOut(false);
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      setLoadTimedOut(true);
      setIsLoading(false);
    }, 4000);
  }, []);

  // Cleanup timeout timer on unmount
  useEffect(() => {
    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, []);

  // Sync external previewUrl changes
  useEffect(() => {
    if (previewUrl) {
      const display = getDisplayUrl(previewUrl);
      setUrlInput((prev) => (prev !== display ? display : prev));
      if (previewUrl !== '/preview') {
        startLoadingTimeout();
      } else {
        setIsLoading(false);
        setLoadTimedOut(false);
      }
    }
  }, [previewUrl, startLoadingTimeout]);

  const navigateTo = useCallback((raw: string) => {
    const resolved = resolveTargetUrl(raw);
    const display = getDisplayUrl(raw);
    setPreviewUrl(resolved);
    setUrlInput(display);
    setIframeKey(Date.now());
    startLoadingTimeout();
    setHistory((prev) => [...prev.slice(0, historyIdx + 1), resolved]);
    setHistoryIdx((i) => i + 1);
  }, [historyIdx, setPreviewUrl, startLoadingTimeout]);

  // Discover all pages in workspace, detect package.json frameworks & active dev servers
  const fetchPages = useCallback(() => {
    fetch('/api/preview/detect')
      .then((r) => r.json())
      .then((data) => {
        if (data.projects && Array.isArray(data.projects)) {
          setDetectedProjects(data.projects);
        }
        const active = data.activeProject || (data.projects && data.projects.length > 0 ? data.projects[0] : null);
        if (active) {
          setActiveProject(active);
          if (active.isRunning && active.previewUrl) {
            setUrlInput((prev) => (prev === '/preview' || !prev ? active.previewUrl : prev));
            setPreviewUrl(active.previewUrl);
          }
        }
        if (!active || !active.isRunning) {
          setIsLoading(false);
        }
      })
      .catch(() => {
        setIsLoading(false);
      });

    fetch('/api/preview/pages')
      .then((r) => r.json())
      .then((data) => {
        if (data.pages && Array.isArray(data.pages)) {
          setPages(data.pages);
          if (data.pages.length === 0) {
            setIsLoading(false);
          }
        }
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, [setPreviewUrl]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  // Refresh pages when workspace file tree refreshes
  useEffect(() => {
    fetchPages();
  }, [fileTreeVersion, fetchPages]);

  // Reset auto-launch state when workspace folder changes
  useEffect(() => {
    autoLaunchedRef.current.clear();
    setDismissWorkInProgress(false);
    fetchPages();
  }, [currentWorkspacePath, fetchPages]);

  const handleOneClickLaunch = useCallback(async (project: DetectedProject) => {
    setActiveProject(project);
    if (project.type === 'static' || !project.command) {
      navigateTo(project.previewUrl);
      return;
    }

    setIsLaunching(true);
    try {
      const res = await fetch('/api/preview/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: project.cwd, command: project.command, port: project.port }),
      });
      const data = await res.json();
      if (data.success && (data.previewUrl || data.url)) {
        navigateTo(data.previewUrl || data.url);
      } else {
        navigateTo(project.previewUrl);
      }
    } catch {
      navigateTo(project.previewUrl);
    } finally {
      setIsLaunching(false);
      fetchPages();
    }
  }, [navigateTo, fetchPages]);

  // When agent finishes generating, re-fetch pages & allow launching relevant dev server
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isAgentGenerating) {
      setDismissWorkInProgress(false);
      fetchPages();
    }
    prevIsGeneratingRef.current = isAgentGenerating;
  }, [isAgentGenerating, fetchPages]);

  // Auto-launch relevant dev server once generation completes (or when preview is open and server is not running)
  useEffect(() => {
    if (!isPreviewOpen) return;
    if (isAgentGenerating) return;
    if (isLaunching) return;

    const candidate = (activeProject && !activeProject.isRunning && activeProject.type !== 'static')
      ? activeProject
      : detectedProjects.find((p) => !p.isRunning && p.type !== 'static' && p.command);

    if (candidate && candidate.command) {
      const candidateKey = `${candidate.cwd}:${candidate.command}:${candidate.port || ''}`;
      if (!autoLaunchedRef.current.has(candidateKey)) {
        autoLaunchedRef.current.add(candidateKey);
        handleOneClickLaunch(candidate);
      }
    }
  }, [isPreviewOpen, isAgentGenerating, isLaunching, activeProject, detectedProjects, handleOneClickLaunch]);

  // For static HTML websites: automatically route to generated index.html if current previewUrl is bare /preview
  useEffect(() => {
    if (!isAgentGenerating && !isLaunching) {
      if ((!previewUrl || previewUrl === '/preview') && pages.length > 0) {
        const firstHtml = pages.find((p) => p.type === 'html') || pages[0];
        if (firstHtml && firstHtml.path) {
          setPreviewUrl(firstHtml.path);
          setUrlInput(getDisplayUrl(firstHtml.path));
          setIframeKey(Date.now());
        }
      }
    }
  }, [isAgentGenerating, isLaunching, pages, previewUrl, setPreviewUrl]);

  // Close pages menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pagesMenuRef.current && !pagesMenuRef.current.contains(e.target as Node)) {
        setIsPagesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle element edit requests from the inspector
  const handleElementEditRequest = useCallback((elementData: SelectedElement, prompt: string) => {
    const event = new CustomEvent('sutra-element-edit', {
      detail: {
        elementData,
        selector: elementData.selector,
        outerHTML: (elementData.outerHTML || '').substring(0, 3000), // Cap at 3KB to avoid bloating context
        prompt,
        timestamp: Date.now(),
      }
    });
    window.dispatchEvent(event);
  }, []);

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim()) {
      navigateTo(urlInput.trim());
    }
  };

  const handlePageSelect = (pagePath: string) => {
    setIsPagesOpen(false);
    navigateTo(pagePath);
  };

  const handleBack = () => {
    if (historyIdx > 0) {
      const nextIdx = historyIdx - 1;
      setHistoryIdx(nextIdx);
      const target = history[nextIdx];
      setPreviewUrl(target);
      setUrlInput(getDisplayUrl(target));
      setIframeKey(Date.now());
      startLoadingTimeout();
    }
  };

  const handleForward = () => {
    if (historyIdx < history.length - 1) {
      const nextIdx = historyIdx + 1;
      setHistoryIdx(nextIdx);
      const target = history[nextIdx];
      setPreviewUrl(target);
      setUrlInput(getDisplayUrl(target));
      setIframeKey(Date.now());
      startLoadingTimeout();
    }
  };

  const handleIframeLoaded = () => {
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    setIsLoading(false);
    setIsError(false);
    setLoadTimedOut(false);
    try {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        const p = win.location.pathname;
        if (p && p !== 'blank' && p !== '/') {
          if (p.startsWith('/api/preview/proxy')) {
            const params = new URLSearchParams(win.location.search);
            const proxiedUrl = params.get('url');
            if (proxiedUrl) {
              setUrlInput(getDisplayUrl(proxiedUrl));
            }
          } else {
            setUrlInput(getDisplayUrl(p + win.location.search));
          }
        }
      }
    } catch {}
  };

  const reloadPreview = useCallback(() => {
    setIsLoading(true);
    setIsError(false);
    setLoadTimedOut(false);
    setIframeKey(Date.now());
    startLoadingTimeout();
    fetchPages();
  }, [startLoadingTimeout, fetchPages]);

  const getViewportDimensions = () => {
    switch (previewViewport) {
      case 'mobile':
        return { width: '393px', height: '852px', label: 'iPhone 15 Pro (393 × 852)' };
      case 'tablet':
        return { width: '768px', height: '1024px', label: 'iPad Pro (768 × 1024)' };
      case 'desktop':
      default:
        return { width: '100%', height: '100%', label: 'Fluid Desktop (100%)' };
    }
  };

  const dim = getViewportDimensions();

  if (!isPreviewOpen) return null;

  return (
    <div className="flex-1 min-w-[320px] flex flex-col h-full bg-obsidian-canvas select-none overflow-hidden z-20 transition-all relative">
      {/* Unified Arc/macOS Safari-Grade Browser Omnibar */}
      <div className="h-10 bg-obsidian-surface1 border-b border-obsidian-hairline flex items-center justify-between px-2.5 text-xs gap-1.5 shrink-0">
        {/* Navigation & History controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleBack}
            disabled={historyIdx === 0}
            title="Back in Preview history"
            className="w-7 h-7 rounded-md flex items-center justify-center border border-obsidian-hairline bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleForward}
            disabled={historyIdx >= history.length - 1}
            title="Forward in Preview history"
            className="w-7 h-7 rounded-md flex items-center justify-center border border-obsidian-hairline bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={reloadPreview}
            title="Reload Preview"
            className="w-7 h-7 rounded-md flex items-center justify-center border border-obsidian-hairline bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-obsidian-inkPrimary' : ''}`} />
          </button>
        </div>

        {/* Omnibar (Unified Address Bar & Page Selector) */}
        <div className="flex-1 min-w-0 relative flex items-center">
          <form onSubmit={handleNavigate} className="w-full flex items-center bg-obsidian-surface2 border border-obsidian-hairline hover:border-obsidian-border rounded-lg px-2 py-0.5 text-xs transition-colors shadow-xs">
            <Globe className="w-3 h-3 text-obsidian-inkMuted mr-1 shrink-0" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="e.g. /preview or http://localhost:3000"
              className="flex-1 bg-transparent border-none text-[11px] font-mono text-obsidian-inkPrimary placeholder:text-obsidian-inkMuted focus:outline-none min-w-0"
            />

            {/* Vercel-like One-Click Run Button or Live Framework Badge */}
            {activeProject && (
              <div className="flex items-center gap-1.5 shrink-0 mr-1.5">
                {!activeProject.isRunning && activeProject.type !== 'static' ? (
                  <button
                    type="button"
                    onClick={() => handleOneClickLaunch(activeProject)}
                    disabled={isLaunching}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono bg-obsidian-surface3 hover:bg-obsidian-surface4 text-obsidian-inkPrimary border border-obsidian-borderBright transition-all cursor-pointer shadow-xs active:scale-95 shrink-0 select-none"
                    title={isLaunching ? 'Starting dev server automatically...' : `Click to run ${activeProject.framework} dev server (${activeProject.command})`}
                  >
                    {isLaunching ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                        <span className="text-amber-400">Starting {activeProject.framework}…</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current text-obsidian-inkPrimary" />
                        <span>Run {activeProject.framework}</span>
                      </>
                    )}
                  </button>
                ) : activeProject.port && activeProject.type !== 'static' ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-obsidian-surface3 border border-obsidian-hairline text-obsidian-inkSecondary shrink-0 select-none">
                    <span>:{activeProject.port}</span>
                  </span>
                ) : null}
              </div>
            )}

            {/* Pages switch dropdown trigger inside omnibar */}
            <div className="relative shrink-0" ref={pagesMenuRef}>
              <button
                type="button"
                onClick={() => setIsPagesOpen((p) => !p)}
                title="Switch Website Pages & Dev Servers"
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors cursor-pointer"
              >
                <span>Pages ({pages.length || 1})</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {/* Pages Popover Menu */}
              {isPagesOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 p-1.5 rounded-xl bg-obsidian-surface2/95 border border-obsidian-border shadow-2xl backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-2 text-xs font-mono select-none">
                  {/* Detected Frameworks & Sites (Vercel-Grade 1-Click Launch) */}
                  {detectedProjects.length > 0 && (
                    <>
                      <div className="text-[9px] uppercase tracking-wider text-obsidian-inkMuted px-2 py-1 font-semibold border-b border-obsidian-hairline mb-1 flex items-center justify-between">
                        <span>Detected Sites ({detectedProjects.length})</span>
                        <span className="text-[8px] text-obsidian-inkMuted">1-CLICK</span>
                      </div>
                      <div className="space-y-0.5 mb-1.5">
                        {detectedProjects.map((proj) => (
                          <button
                            key={proj.id}
                            type="button"
                            onClick={() => {
                              setIsPagesOpen(false);
                              handleOneClickLaunch(proj);
                            }}
                            className="w-full flex items-center justify-between px-2 py-1 rounded-lg text-left hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer group"
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              <span className="w-1.5 h-1.5 rounded-full bg-obsidian-inkSecondary group-hover:bg-obsidian-inkPrimary shrink-0" />
                              <span className="truncate font-medium">{proj.name}</span>
                              <span className="text-[9px] font-mono text-obsidian-inkMuted">({proj.framework})</span>
                            </span>
                            <span className="text-[9px] font-mono font-semibold text-obsidian-inkPrimary uppercase shrink-0">
                              {proj.isRunning ? (proj.port ? `:${proj.port}` : 'Static') : 'Run ▶'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="text-[9px] uppercase tracking-wider text-obsidian-inkMuted px-2 py-1 font-semibold border-b border-obsidian-hairline mb-1">
                    Workspace Pages ({pages.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-0.5">
                    {pages.length > 0 ? (
                      pages.map((p) => (
                        <button
                          key={p.path}
                          type="button"
                          onClick={() => handlePageSelect(p.path)}
                          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors cursor-pointer group"
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <FileCode className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
                            <span className="truncate">{p.title}</span>
                          </span>
                          <span className="text-[9px] text-obsidian-inkMuted uppercase shrink-0">{p.type}</span>
                        </button>
                      ))
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePageSelect('/workspace/index.html')}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors cursor-pointer"
                      >
                        <FileCode className="w-3.5 h-3.5 text-obsidian-inkSecondary" />
                        <span>Home (index.html)</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Actions: Viewport device toggle, Inspect Element, Full Browser, Close */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Viewport cycle toggle icon button (Desktop <-> Mobile) */}
          <button
            type="button"
            onClick={() => setPreviewViewport(previewViewport === 'desktop' ? 'mobile' : 'desktop')}
            className="w-7 h-7 rounded-md flex items-center justify-center border border-obsidian-hairline bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title={`Current Viewport: ${previewViewport} (Click to toggle Mobile/Desktop)`}
          >
            {previewViewport === 'desktop' ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
          </button>

          {/* Center Workspace Layout Toggle (Full Center vs Split with Editor) */}
          <button
            type="button"
            onClick={togglePreviewLayout}
            className="w-7 h-7 rounded-md flex items-center justify-center border border-obsidian-hairline bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title={previewLayout === 'full' ? 'Switch to Split View (Editor alongside Preview)' : 'Switch to Full Center Preview (Occupy Entire Center)'}
          >
            {previewLayout === 'full' ? <Columns className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Inspect / Click-to-Edit Element Tool */}
          <ElementInspector iframeRef={iframeRef} onEditRequest={handleElementEditRequest} />

          {/* Popout to full browser tab */}
          <a
            href={getDisplayUrl(previewUrl || '/preview')}
            target="_blank"
            rel="noreferrer"
            className="w-7 h-7 rounded-md flex items-center justify-center border border-obsidian-hairline bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Open in Full Browser Tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          {/* Close preview */}
          <button
            type="button"
            onClick={togglePreview}
            className="w-7 h-7 rounded-md flex items-center justify-center border border-obsidian-hairline bg-obsidian-surface2 hover:bg-obsidian-surface3 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Close Preview Panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Screen Frame Display (Edge-to-edge for Desktop, Bezel Frame for Mobile/Tablet) */}
      <div
        className={`flex-1 bg-obsidian-canvas flex flex-col items-center justify-center overflow-auto relative ${
          previewViewport === 'desktop' ? 'p-0' : 'p-4'
        }`}
      >
        <div
          style={{ width: dim.width, height: dim.height }}
          className={`bg-obsidian-surface3 overflow-hidden transition-all flex flex-col relative ${
            previewViewport !== 'desktop'
              ? 'my-auto ring-8 ring-obsidian-border rounded-2xl shadow-2xl'
              : 'w-full h-full border-none rounded-none'
          }`}
        >
          {previewViewport !== 'desktop' && (
            <div className="h-7 bg-obsidian-surface3 border-b border-obsidian-hairline flex items-center justify-center px-4 shrink-0">
              <div className="w-40 h-3.5 rounded-full bg-obsidian-surface4 text-[9px] font-mono text-obsidian-inkMuted flex items-center justify-center truncate px-2">
                {urlInput}
              </div>
            </div>
          )}

          <div className="relative flex-1 w-full h-full overflow-hidden">
            {/* 1. Work In Progress Overlay (Astra is generating code) */}
            {isAgentGenerating && !dismissWorkInProgress && (
              <div className="absolute inset-0 z-35 bg-obsidian-canvas/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in">
                <div className="max-w-md w-full flex flex-col items-center gap-4">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-medium bg-amber-500/10 border border-amber-500/20 text-amber-300 shadow-sm">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse text-amber-400" />
                    <span>ASTRA WORK IN PROGRESS</span>
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-obsidian-inkPrimary">
                      Building Application Files
                    </h3>
                    <p className="text-xs text-obsidian-inkSecondary max-w-sm mx-auto leading-relaxed">
                      Work is incomplete yet. Files and styles are being generated. Preview and dev server will start automatically once ready.
                    </p>
                  </div>

                  {/* Realtime Activity Card */}
                  <div className="w-full bg-obsidian-surface1 border border-obsidian-hairline rounded-xl p-3.5 shadow-xl text-left space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] text-obsidian-inkMuted pb-2 border-b border-obsidian-hairline">
                      <span className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        <span className="font-mono text-obsidian-inkPrimary font-medium">Active Generation</span>
                      </span>
                      <span className="text-[10px] font-mono text-amber-400 font-semibold uppercase tracking-wider bg-amber-400/10 px-1.5 py-0.5 rounded">
                        In Progress
                      </span>
                    </div>

                    {activeToolAction && (
                      <div className="flex items-center gap-2 text-obsidian-inkPrimary text-xs font-mono bg-obsidian-surface2 px-2.5 py-1.5 rounded-lg border border-obsidian-hairline/80">
                        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate font-medium">{activeToolAction}</span>
                      </div>
                    )}

                    {cleanThinkingSnippet && (
                      <div className="text-[11px] font-mono text-obsidian-inkSecondary bg-obsidian-surface2/50 rounded-lg p-2.5 border border-obsidian-hairline/50 leading-relaxed line-clamp-3 italic">
                        "{cleanThinkingSnippet}"
                      </div>
                    )}

                    {/* Step-by-step progress checklist */}
                    <div className="grid grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono text-obsidian-inkMuted">
                      <div className="flex items-center gap-1 bg-obsidian-surface2/40 px-2 py-1 rounded">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="truncate">Files</span>
                      </div>
                      <div className="flex items-center gap-1 bg-obsidian-surface2/40 px-2 py-1 rounded text-amber-400">
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        <span className="truncate">Coding</span>
                      </div>
                      <div className="flex items-center gap-1 bg-obsidian-surface2/40 px-2 py-1 rounded">
                        <span className="w-2 h-2 rounded-full bg-obsidian-inkMuted/40 shrink-0 ml-0.5 mr-0.5" />
                        <span className="truncate">Server</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setDismissWorkInProgress(true)}
                      className="px-3 py-1.5 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View canvas anyway</span>
                    </button>

                    {activeProject && activeProject.type !== 'static' && activeProject.command && (
                      <button
                        type="button"
                        onClick={() => handleOneClickLaunch(activeProject)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-medium transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Run {activeProject.framework}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 2. Dev Server Starting State */}
            {isLaunching && (
              <div className="absolute inset-0 z-35 bg-obsidian-canvas/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in">
                <div className="max-w-md w-full flex flex-col items-center gap-4">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-medium bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 shadow-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    <span>STARTING DEVELOPMENT SERVER</span>
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-obsidian-inkPrimary">
                      Booting {activeProject?.framework || 'Dev'} Server…
                    </h3>
                    <p className="text-xs text-obsidian-inkSecondary max-w-sm mx-auto leading-relaxed">
                      Launching local dev server and establishing preview bridge. The preview will automatically appear once the port responds.
                    </p>
                  </div>

                  <div className="w-full bg-obsidian-surface1 border border-obsidian-hairline rounded-xl p-3.5 shadow-xl text-left space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between text-obsidian-inkMuted text-[11px] pb-1.5 border-b border-obsidian-hairline">
                      <span>Command</span>
                      <span className="text-obsidian-inkPrimary font-semibold">{activeProject?.command || 'npm run dev'}</span>
                    </div>
                    <div className="flex items-center justify-between text-obsidian-inkMuted text-[11px]">
                      <span>Target Port</span>
                      <span className="text-cyan-400 font-semibold">:{activeProject?.port || 'auto'}</span>
                    </div>
                    <div className="flex items-center gap-2 pt-2 text-[11px] text-amber-400/90">
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                      <span>Waiting for localhost port to become responsive…</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3. Clean 'Workspace is not ready' State (When server is not running and no pages are ready) */}
            {!isAgentGenerating && !isLaunching && pages.length === 0 && (
              (!activeProject || !activeProject.isRunning || activeProject.type !== 'static') &&
              (!previewUrl || previewUrl === '/preview')
            ) && (
              <div className="absolute inset-0 z-35 bg-obsidian-canvas flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in">
                <div className="max-w-sm w-full flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkSecondary">
                    <Globe className="w-5 h-5 text-obsidian-inkMuted" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-obsidian-inkPrimary">
                      Workspace is not ready
                    </h3>
                    <p className="text-xs text-obsidian-inkMuted leading-relaxed">
                      {activeProject && !activeProject.isRunning && activeProject.type !== 'static' && activeProject.command
                        ? `This workspace contains a ${activeProject.framework} project. Start the server to preview it in real-time.`
                        : 'No web pages ready yet. Ask Astra to build a web page or add HTML files to view them here.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    {activeProject && !activeProject.isRunning && activeProject.type !== 'static' && activeProject.command && (
                      <button
                        type="button"
                        onClick={() => handleOneClickLaunch(activeProject)}
                        className="px-3.5 py-1.5 rounded-lg bg-obsidian-inkPrimary hover:bg-obsidian-accentHover text-obsidian-canvas text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Start {activeProject.framework} Server</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={reloadPreview}
                      className="px-3 py-1.5 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-hairline text-xs font-mono text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
                    >
                      Refresh Preview
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Floating Restore Pill if user dismissed WIP overlay while generating */}
            {isAgentGenerating && dismissWorkInProgress && (
              <button
                type="button"
                onClick={() => setDismissWorkInProgress(false)}
                className="absolute top-3 right-3 z-40 px-2.5 py-1 rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[10px] font-mono flex items-center gap-1.5 shadow-lg backdrop-blur-md transition-all cursor-pointer select-none"
                title="Astra is still generating. Click to restore build HUD"
              >
                <Sparkles className="w-3 h-3 animate-pulse" />
                <span>Astra generating…</span>
                <EyeOff className="w-3 h-3 text-amber-400/80 ml-0.5" />
              </button>
            )}

            {isLoading && !isLaunching && !(isAgentGenerating && !dismissWorkInProgress) && (
              <div className="absolute inset-0 z-30 bg-obsidian-canvas/70 backdrop-blur-xs flex flex-col items-center justify-center gap-2 select-none animate-in fade-in">
                <Loader2 className="w-5 h-5 animate-spin text-obsidian-inkSecondary" />
                <span className="text-[11px] font-mono text-obsidian-inkMuted">Loading preview…</span>
              </div>
            )}

            {loadTimedOut && ((activeProject && activeProject.isRunning) || (pages && pages.length > 0) || (previewUrl && previewUrl !== '/preview')) && !isError && !isLaunching && !(isAgentGenerating && !dismissWorkInProgress) && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-lg bg-obsidian-surface2 border border-obsidian-border text-obsidian-inkPrimary text-xs flex items-center gap-2.5 shadow-xl backdrop-blur-md font-mono text-[11px]">
                <span className="text-amber-400">Preview took longer than usual</span>
                <button
                  type="button"
                  onClick={reloadPreview}
                  className="underline hover:text-white cursor-pointer text-amber-300"
                >
                  Retry
                </button>
                <a
                  href={getDisplayUrl(previewUrl || '/preview')}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-white text-obsidian-inkSecondary"
                >
                  Open tab
                </a>
              </div>
            )}

            {isError && !isLaunching && !(isAgentGenerating && !dismissWorkInProgress) && (
              <div className="absolute inset-0 z-30 bg-obsidian-canvas flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline flex items-center justify-center text-obsidian-inkSecondary">
                  <Globe className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-obsidian-inkPrimary">Unable to load preview</h3>
                <p className="text-xs text-obsidian-inkMuted max-w-sm">
                  The preview target could not be reached. Ensure your local server is running or check the URL address.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={reloadPreview}
                    className="px-3 py-1.5 rounded-lg bg-obsidian-surface3 hover:bg-obsidian-surface4 border border-obsidian-border text-xs text-obsidian-inkPrimary font-medium cursor-pointer"
                  >
                    Retry Preview
                  </button>
                  <a
                    href={getDisplayUrl(previewUrl || '/preview')}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-hairline text-xs text-obsidian-inkSecondary hover:text-obsidian-inkPrimary"
                  >
                    Open in New Tab
                  </a>
                </div>
              </div>
            )}

            <iframe
              ref={iframeRef}
              key={iframeKey}
              src={resolveTargetUrl(previewUrl || '/preview')}
              onLoad={handleIframeLoaded}
              onError={() => {
                if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
                setIsLoading(false);
                setIsError(true);
              }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
              title="SUTRA Live Responsive Preview Sandbox"
              className="w-full h-full border-none bg-obsidian-canvas"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
