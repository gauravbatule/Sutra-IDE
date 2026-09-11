import React, { useState } from 'react';
import {
  Monitor,
  Tablet,
  Smartphone,
  RefreshCw,
  ExternalLink,
  X,
  ShieldCheck,
  Globe,
  Zap
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { AntiSlopAuditor } from '../DesignVault/AntiSlopAuditor.js';

export const MultiViewport: React.FC = () => {
  const { isPreviewOpen, togglePreview, previewViewport, setPreviewViewport, previewUrl, setPreviewUrl } = useIDEStore();
  const [iframeKey, setIframeKey] = useState(Date.now());
  const [showAuditor, setShowAuditor] = useState(false);
  const [urlInput, setUrlInput] = useState(previewUrl || '/preview');

  if (!isPreviewOpen) return null;

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

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim()) {
      setPreviewUrl(urlInput.trim());
      setIframeKey(Date.now());
    }
  };

  return (
    <div className="w-[450px] lg:w-[540px] xl:w-[620px] flex flex-col h-full bg-obsidian-canvas border-l border-obsidian-hairline select-none overflow-hidden z-20">
      {/* Viewport Control Bar */}
      <div className="h-10 bg-obsidian-surface1 border-b border-obsidian-hairline flex items-center justify-between px-3 text-xs">
        {/* Device Switcher */}
        <div className="flex items-center gap-1 bg-obsidian-surface2 border border-obsidian-hairline rounded p-0.5">
          <button
            onClick={() => setPreviewViewport('desktop')}
            className={`p-1.5 rounded flex items-center gap-1 text-xs transition-colors ${
              previewViewport === 'desktop' ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-medium' : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
            }`}
            title="Desktop Viewport"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span className="text-[10px] hidden sm:inline">Desktop</span>
          </button>
          <button
            onClick={() => setPreviewViewport('tablet')}
            className={`p-1.5 rounded flex items-center gap-1 text-xs transition-colors ${
              previewViewport === 'tablet' ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-medium' : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
            }`}
            title="Tablet Viewport"
          >
            <Tablet className="w-3.5 h-3.5" />
            <span className="text-[10px] hidden sm:inline">Tablet</span>
          </button>
          <button
            onClick={() => setPreviewViewport('mobile')}
            className={`p-1.5 rounded flex items-center gap-1 text-xs transition-colors ${
              previewViewport === 'mobile' ? 'bg-obsidian-inkPrimary text-obsidian-canvas font-medium' : 'text-obsidian-inkMuted hover:text-obsidian-inkPrimary'
            }`}
            title="Mobile Viewport"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="text-[10px] hidden sm:inline">Mobile</span>
          </button>
        </div>

        {/* Viewport Label & Auditor */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAuditor(!showAuditor)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border transition-all ${
              showAuditor
                ? 'bg-obsidian-inkPrimary text-obsidian-canvas border-transparent font-medium'
                : 'bg-obsidian-surface2 text-obsidian-inkSecondary border-obsidian-hairline hover:text-obsidian-inkPrimary'
            }`}
          >
            <ShieldCheck className="w-3 h-3" />
            Visual QA
          </button>
        </div>

        {/* Actions: Refresh & Close */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIframeKey(Date.now())}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Hard Reload Viewport"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <a
            href={previewUrl || '/preview'}
            target="_blank"
            rel="noreferrer"
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Open in Full Browser Window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={togglePreview}
            className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
            title="Close Preview Panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* URL Address Bar & Purpose Banner */}
      <form onSubmit={handleNavigate} className="px-3 py-1.5 bg-obsidian-surface1 border-b border-obsidian-hairline flex items-center gap-2">
        <Globe className="w-3.5 h-3.5 text-obsidian-inkMuted" />
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="/preview or http://localhost:5173"
          className="flex-1 bg-obsidian-surface2 border border-obsidian-hairline rounded px-2 py-0.5 text-[11px] font-mono text-obsidian-inkPrimary focus:outline-none focus:border-obsidian-border"
        />
        <span className="text-[10px] font-mono text-obsidian-inkMuted">{dim.label.split(' ')[0]}</span>
      </form>

      {/* Purpose Banner */}
      <div className="px-3 py-1 bg-obsidian-surface2 border-b border-obsidian-hairline flex items-center justify-between text-[10px] text-obsidian-inkMuted">
        <span className="flex items-center gap-1.5"><Zap className="w-3 h-3" /> Live responsive sandbox for testing UI components across devices without switching windows.</span>
      </div>

      {/* Screen Frame Display */}
      <div className="flex-1 bg-obsidian-surface1 p-4 flex flex-col items-center justify-center overflow-auto relative">
        {showAuditor && (
          <div className="absolute top-4 right-4 z-40 w-80">
            <AntiSlopAuditor />
          </div>
        )}

        <div
          style={{ width: dim.width, height: dim.height }}
          className={`bg-obsidian-surface3 rounded-xl overflow-hidden border border-white/10 shadow-2xl transition-all flex flex-col ${
            previewViewport !== 'desktop' ? 'my-auto ring-8 ring-obsidian-border' : 'w-full h-full'
          }`}
        >
          {previewViewport !== 'desktop' && (
            <div className="h-7 bg-obsidian-surface3 border-b border-white/5 flex items-center justify-center px-4">
              <div className="w-36 h-3.5 rounded-full bg-obsidian-surface4 text-[9px] font-mono text-obsidian-inkMuted flex items-center justify-center">
                {urlInput}
              </div>
            </div>
          )}

          <iframe
            key={iframeKey}
            src={previewUrl || '/preview'}
            title="SUTRA Live Responsive Preview Sandbox"
            className="flex-1 w-full h-full border-none bg-obsidian-canvas"
          />
        </div>
      </div>
    </div>
  );
};
