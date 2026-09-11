import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Maximize, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import type { OpenFileTab } from '../../types/ide.js';

/** Extensions that open in the image viewer instead of the Monaco editor. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'ico', 'bmp'] as const;

/** Formats whose pixels can be transparent — they get the checkerboard backdrop. */
const TRANSPARENT_EXTENSIONS = ['png', 'svg', 'webp', 'gif', 'ico'];

export const isImagePath = (path: string): boolean => {
  const match = /\.([a-z0-9]+)$/i.exec(path.trim());
  return !!match && (IMAGE_EXTENSIONS as readonly string[]).includes(match[1].toLowerCase());
};

const ZOOM_STEP = 1.25;
const MIN_ZOOM_PCT = 25;
const MAX_ZOOM_PCT = 800;

const clampPct = (pct: number) => Math.min(MAX_ZOOM_PCT, Math.max(MIN_ZOOM_PCT, Math.round(pct)));

/**
 * Subtle dark checkerboard (inline SVG data-uri) shown only behind
 * transparent-capable images so alpha regions are visible.
 */
const CHECKERBOARD_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='%230a0a0c'/%3E%3Crect width='8' height='8' fill='%2318181b'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%2318181b'/%3E%3C/svg%3E\")";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

type ZoomState = { mode: 'fit' } | { mode: 'pct'; value: number };

interface ImageViewerProps {
  tab: OpenFileTab;
}

/**
 * Full-pane viewer for image files. Replaces the Monaco editor for image tabs
 * (routing happens in MonacoEditor.tsx). Images are fetched from the server's
 * workspace static mount (`GET /workspace/<relative-path>`, see
 * server/index.ts) because `/api/fs/read` decodes UTF-8 and truncates at 25KB,
 * which corrupts binary data. SVGs always render through a plain <img> tag.
 */
export const ImageViewer: React.FC<ImageViewerProps> = ({ tab }) => {
  const [srcPath, setSrcPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [zoom, setZoom] = useState<ZoomState>({ mode: 'fit' });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const panOriginRef = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);

  // Resolve the tab path to a workspace-root-relative URL path. Tabs opened via
  // the Explorer hold relative paths already; absolute paths (agent tool cards,
  // command palette) are relativized against the active workspace root.
  useEffect(() => {
    let cancelled = false;
    setSrcPath(null);
    setNatural(null);
    setBytes(null);
    setLoadError(false);
    setZoom({ mode: 'fit' });
    setOffset({ x: 0, y: 0 });

    const buildSrc = async () => {
      let rel = tab.path.replace(/\\/g, '/');
      const isDriveAbsolute = /^[a-zA-Z]:\//.test(rel);
      rel = rel.replace(/^\/+/, '');
      if (isDriveAbsolute) {
        try {
          const res = await fetch('/api/fs/workspace');
          const data = await res.json();
          const root = String(data.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
          if (!cancelled && root && rel.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
            rel = rel.slice(root.length + 1);
          }
        } catch {
          // Fall through with the path as-is; the onError state covers failures.
        }
      }
      if (!cancelled) {
        setSrcPath(rel.split('/').map(encodeURIComponent).join('/'));
      }
    };

    void buildSrc();
    return () => {
      cancelled = true;
    };
  }, [tab.path]);

  // File size via a HEAD request (the static mount answers with Content-Length).
  useEffect(() => {
    if (!srcPath) return;
    let cancelled = false;
    fetch(`/workspace/${srcPath}`, { method: 'HEAD' })
      .then((res) => {
        const len = Number(res.headers.get('content-length') || 0);
        if (!cancelled && Number.isFinite(len) && len > 0) setBytes(len);
      })
      .catch(() => {
        // Size display is optional; ignore HEAD failures.
      });
    return () => {
      cancelled = true;
    };
  }, [srcPath]);

  // Track the canvas pane size so fit-to-window can be computed on any resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    if (!natural || !containerSize || natural.width === 0 || natural.height === 0) return 1;
    return Math.min(containerSize.width / natural.width, containerSize.height / natural.height, 1);
  }, [natural, containerSize]);

  const scale = zoom.mode === 'fit' ? fitScale : zoom.value / 100;

  // Keep the live zoom percentage reachable for the non-passive wheel handler.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const displayWidth = natural ? Math.max(1, Math.round(natural.width * scale)) : null;
  const displayHeight = natural ? Math.max(1, Math.round(natural.height * scale)) : null;
  const canPan = !!displayWidth && !!displayHeight && !!containerSize &&
    (displayWidth > containerSize.width || displayHeight > containerSize.height);

  const applyZoomPct = useCallback((pct: number) => {
    setZoom({ mode: 'pct', value: clampPct(pct) });
    setOffset({ x: 0, y: 0 });
  }, []);

  const resetToFit = useCallback(() => {
    setZoom({ mode: 'fit' });
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => applyZoomPct(scaleRef.current * 100 * ZOOM_STEP), [applyZoomPct]);
  const zoomOut = useCallback(() => applyZoomPct(scaleRef.current * 100 / ZOOM_STEP), [applyZoomPct]);

  // ESC resets to fit-to-window. Ctrl+scroll zooms (native listener so
  // preventDefault wins over the browser's page-zoom gesture).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      resetToFit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetToFit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      applyZoomPct(scaleRef.current * 100 * factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoomPct]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !canPan) return;
    panOriginRef.current = { pointerX: e.clientX, pointerY: e.clientY, originX: offset.x, originY: offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPanning(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const origin = panOriginRef.current;
    if (!origin) return;
    setOffset({
      x: origin.originX + (e.clientX - origin.pointerX),
      y: origin.originY + (e.clientY - origin.pointerY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    panOriginRef.current = null;
    setIsPanning(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be gone; panning state is reset regardless.
    }
  };

  const isTransparentFormat = TRANSPARENT_EXTENSIONS.includes(tab.name.split('.').pop()?.toLowerCase() || '');

  const iconBtnClass =
    'w-6 h-6 rounded-md flex items-center justify-center text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer';

  const effectivePct = Math.round(scale * 100);

  return (
    <div className="flex-1 w-full h-full min-h-0 flex flex-col bg-obsidian-canvas overflow-hidden">
      {/* Viewer header: identity + metadata + zoom controls */}
      <div className="h-9 shrink-0 bg-obsidian-surface1 border-b border-obsidian-hairline flex items-center justify-between gap-3 px-3 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" aria-hidden="true" />
          <span className="font-mono text-[11px] text-obsidian-inkPrimary truncate">{tab.name}</span>
          {natural && (
            <span className="font-mono text-[10px] text-obsidian-inkMuted whitespace-nowrap">
              {natural.width} × {natural.height}
            </span>
          )}
          {bytes !== null && (
            <span className="font-mono text-[10px] text-obsidian-inkMuted whitespace-nowrap">
              {formatBytes(bytes)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={zoomOut}
            disabled={effectivePct <= MIN_ZOOM_PCT}
            className={iconBtnClass}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyZoomPct(100)}
            disabled={!natural}
            className="h-6 px-1.5 rounded-md font-mono text-[10px] text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface2 transition-colors cursor-pointer disabled:pointer-events-none"
            aria-label="Reset zoom to 100 percent"
            title="Actual size (100%)"
          >
            {effectivePct}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={effectivePct >= MAX_ZOOM_PCT}
            className={iconBtnClass}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={resetToFit}
            disabled={!natural}
            className={`${iconBtnClass} ml-1`}
            aria-label="Fit image to window"
            title="Fit to window (Esc)"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas pane */}
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden bg-obsidian-canvas ${canPan ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-obsidian-inkMuted">
              <TriangleAlert className="w-6 h-6" aria-hidden="true" />
              <span className="font-mono text-[11px]">Could not load image</span>
              <span className="font-mono text-[10px] text-obsidian-inkMuted/70">{tab.path}</span>
            </div>
          </div>
        )}

        {!loadError && !srcPath && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-obsidian-inkMuted select-none">
            Loading…
          </div>
        )}

        {srcPath && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Hairline frame sized to the displayed image bounds; the checkerboard
                shows through transparent pixels only for capable formats. */}
            <div
              className={`border border-obsidian-hairline rounded-md overflow-hidden transition-none ${natural ? '' : 'invisible'}`}
              style={{
                width: displayWidth ?? undefined,
                height: displayHeight ?? undefined,
                backgroundColor: '#0a0a0c',
                backgroundImage: isTransparentFormat ? CHECKERBOARD_DATA_URI : undefined,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            >
              {/* Plain img element only — SVGs are never inlined into the DOM. */}
              <img
                src={`/workspace/${srcPath}`}
                alt={tab.name}
                draggable={false}
                className="block w-full h-full"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setNatural({ width: img.naturalWidth, height: img.naturalHeight });
                    setLoadError(false);
                  }
                }}
                onError={() => setLoadError(true)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
