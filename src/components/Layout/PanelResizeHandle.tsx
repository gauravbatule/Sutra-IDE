import React from 'react';
import type { ResizeHandleProps } from '../../hooks/useResizablePanel.js';

interface PanelResizeHandleProps {
  handleProps: ResizeHandleProps;
  /** Highlights the strip while a drag is in flight. */
  isResizing: boolean;
  label?: string;
}

/**
 * Invisible drag strip docked to the LEFT edge of a right-side panel.
 * 6px hit area, column-resize cursor, transparent until hover (white/10),
 * hairline panel border underneath stays untouched. Monochrome only.
 */
export const PanelResizeHandle: React.FC<PanelResizeHandleProps> = ({
  handleProps,
  isResizing,
  label = 'Resize panel',
}) => (
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label={label}
    tabIndex={0}
    title="Drag to resize - double-click to reset"
    {...handleProps}
    className={`absolute inset-y-0 left-0 z-40 w-1.5 cursor-col-resize touch-none rounded-r-sm transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-obsidian-border ${
      isResizing ? 'bg-obsidian-surface3' : 'bg-transparent hover:bg-obsidian-surface3'
    }`}
  />
);
