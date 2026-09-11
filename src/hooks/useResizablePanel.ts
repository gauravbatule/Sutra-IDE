import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * Shared drag-to-resize logic for edge-docked panels (right agent panel in
 * both the IDE workspace layout and any future host).
 *
 * Behavior contract:
 *  - Width persists to localStorage under `storageKey` and is restored
 *    (re-clamped) on mount.
 *  - Dragging uses pointer events with setPointerCapture, so the gesture keeps
 *    tracking even when the cursor leaves the thin handle strip.
 *  - Clamps: `minWidth` (default 320px) up to `maxWidthRatio` of the live
 *    window width (default 60%), evaluated per-move so window resizes during a
 *    drag stay honest.
 *  - Double-click resets to `defaultWidth`; ArrowLeft/ArrowRight nudge by
 *    `keyboardStep` when the handle is focused.
 */

export const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'sutra-right-panel-width';

export interface UseResizablePanelOptions {
  /** localStorage key holding the last committed width in px. */
  storageKey?: string;
  /** Width used when nothing is persisted, and restored on double-click. */
  defaultWidth?: number;
  /** Hard lower clamp in px. */
  minWidth?: number;
  /** Upper clamp as a fraction of the current window inner width. */
  maxWidthRatio?: number;
  /** Pixel nudge applied per ArrowLeft/ArrowRight keypress. */
  keyboardStep?: number;
}

/** Event handlers meant to be spread onto the resize-handle element. */
export interface ResizeHandleProps {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export interface ResizablePanelApi {
  width: number;
  isResizing: boolean;
  handleProps: ResizeHandleProps;
  resetWidth: () => void;
}

interface DragState {
  startX: number;
  startWidth: number;
}

const DEFAULTS = {
  storageKey: RIGHT_PANEL_WIDTH_STORAGE_KEY,
  defaultWidth: 420,
  minWidth: 320,
  maxWidthRatio: 0.6,
  keyboardStep: 24,
} as const;

export function useResizablePanel(options: UseResizablePanelOptions = {}): ResizablePanelApi {
  const { storageKey, defaultWidth, minWidth, maxWidthRatio, keyboardStep } = {
    ...DEFAULTS,
    ...options,
  };

  const clampWidth = useCallback(
    (value: number): number => {
      const viewportMax = Math.max(minWidth, Math.floor(window.innerWidth * maxWidthRatio));
      return Math.min(viewportMax, Math.max(minWidth, Math.round(value)));
    },
    [minWidth, maxWidthRatio]
  );

  // Restore the persisted width on mount, re-clamped against the live viewport.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultWidth;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaultWidth;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? clampWidth(parsed) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });

  // Mirror for event handlers so drags never read a stale closure.
  const widthRef = useRef(width);
  widthRef.current = width;

  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const persist = useCallback(
    (value: number) => {
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // Storage unavailable (private mode, quota) — resizing still works this session.
      }
    },
    [storageKey]
  );

  const resetWidth = useCallback(() => {
    setWidth(defaultWidth);
    persist(defaultWidth);
  }, [defaultWidth, persist]);

  const stopDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsResizing(false);
    persist(widthRef.current);
  }, [persist]);

  const handleProps: ResizeHandleProps = useMemo(
    () => ({
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        // No preventDefault here: canceling pointerdown suppresses the
        // compatibility mouse events that dblclick relies on for reset.
        // Text selection is already blocked by the shell's select-none.
        dragRef.current = { startX: event.clientX, startWidth: widthRef.current };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture unsupported — document-level fallback not needed for modern targets.
        }
        setIsResizing(true);
      },
      onPointerMove: (event) => {
        const drag = dragRef.current;
        if (!drag) return;
        // Right-edge panel: dragging left grows it, dragging right shrinks it.
        const delta = drag.startX - event.clientX;
        setWidth(clampWidth(drag.startWidth + delta));
      },
      onPointerUp: stopDrag,
      onPointerCancel: stopDrag,
      onLostPointerCapture: stopDrag,
      onDoubleClick: resetWidth,
      onKeyDown: (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -keyboardStep : keyboardStep;
        const next = clampWidth(widthRef.current + delta);
        setWidth(next);
        persist(next);
      },
    }),
    [clampWidth, keyboardStep, persist, resetWidth, stopDrag]
  );

  // While an active drag tracks outside the strip, keep the column cursor and
  // suppress text selection page-wide.
  useEffect(() => {
    if (!isResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  return { width, isResizing, handleProps, resetWidth };
}
