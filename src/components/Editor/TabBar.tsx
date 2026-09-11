import React, { useState } from 'react';
import {
  X,
  FileCode,
  Circle,
  Save,
  Image as ImageIcon,
  Code2,
  FileJson,
  FileType,
  FileText,
  Copy,
  Globe,
  Columns,
  Maximize2
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';
import { isImagePath } from './ImageViewer.js';

const getTabIcon = (filePath: string) => {
  const name = filePath.toLowerCase();
  if (name.endsWith('.tsx') || name.endsWith('.jsx')) {
    return <Code2 className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
  }
  if (name.endsWith('.ts') || name.endsWith('.js')) {
    return <FileCode className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
  }
  if (name.endsWith('.json')) {
    return <FileJson className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.endsWith('.css') || name.endsWith('.scss')) {
    return <FileType className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.endsWith('.md')) {
    return <FileText className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
  }
  if (name.endsWith('.py') || name.endsWith('.rs')) {
    return <FileCode className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />;
  }
  if (isImagePath(filePath)) {
    return <ImageIcon className="w-3.5 h-3.5 text-obsidian-inkMuted shrink-0" />;
  }
  return <FileCode className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />;
};

export const TabBar: React.FC = () => {
  const {
    openTabs,
    activeTabPath,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    saveAllFiles,
    isPreviewOpen,
    previewLayout,
    setPreviewLayout,
    activeCenterView,
    setActiveCenterView,
    setIsPreviewOpen,
  } = useIDEStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabPath: string } | null>(null);

  if (openTabs.length === 0 && !isPreviewOpen) return null;

  const hasDirtyTabs = openTabs.some((t) => t.isDirty);

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabPath: path });
  };

  const handleCloseToRight = (targetPath: string) => {
    const idx = openTabs.findIndex((t) => t.path === targetPath);
    if (idx >= 0) {
      const tabsToClose = openTabs.slice(idx + 1);
      tabsToClose.forEach((t) => closeTab(t.path));
    }
  };

  return (
    <div
      className="h-9 bg-obsidian-canvas border-b border-obsidian-hairline flex items-center justify-between overflow-x-auto select-none no-scrollbar px-1 relative"
      onClick={() => setContextMenu(null)}
    >
      <div className="flex items-center h-full overflow-x-auto no-scrollbar gap-0.5">
        {openTabs.map((tab) => {
          const isActive = activeTabPath === tab.path;
          return (
            <div
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              onContextMenu={(e) => handleContextMenu(e, tab.path)}
              onMouseDown={(e) => {
                // Middle-click to close
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.path);
                }
              }}
              className={`group h-full flex items-center gap-2 px-3 text-[11px] cursor-pointer transition-colors relative border-r border-obsidian-hairline ${
                isActive
                  ? 'text-obsidian-inkPrimary font-medium bg-obsidian-surface1'
                  : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1/60'
              }`}
            >
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-obsidian-inkPrimary rounded-b-sm" />
              )}
              {getTabIcon(tab.path)}
              <span className="truncate max-w-[140px] font-mono">{tab.name}</span>

              {/* Tab close. The glyph is small (w-3) but the *hit area* is
                  24px — Fitts's law: a 16px target is a mis-click magnet on a
                  dense tab strip. `-mr-1` keeps the tab's visual width the
                  same so growing the target doesn't reflow the strip.
                  The dirty-state dot is a real <button> now (it was a div
                  with onClick — no keyboard access, no role). */}
              {tab.isDirty ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.path);
                  }}
                  aria-label={`Close ${tab.name} (unsaved changes)`}
                  title={`Close ${tab.name} (unsaved changes)`}
                  className="w-6 h-6 -mr-1 rounded flex items-center justify-center hover:bg-obsidian-surface2 transition-all text-obsidian-inkSecondary hover:text-obsidian-inkPrimary cursor-pointer shrink-0"
                >
                  <Circle className="w-2 h-2 fill-current text-obsidian-inkPrimary group-hover:hidden" />
                  <X className="w-3 h-3 hidden group-hover:block text-obsidian-inkSecondary hover:text-obsidian-inkPrimary" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.path);
                  }}
                  aria-label={`Close ${tab.name}`}
                  title={`Close ${tab.name}`}
                  className="w-6 h-6 -mr-1 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-obsidian-surface2 transition-all text-obsidian-inkSecondary hover:text-obsidian-inkPrimary cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Live Preview Tab Pill */}
        {isPreviewOpen && (
          <div
            onClick={() => setActiveCenterView('preview')}
            className={`group h-full flex items-center gap-2 px-3 text-[11px] cursor-pointer transition-colors relative border-r border-obsidian-hairline ${
              activeCenterView === 'preview' && previewLayout === 'full'
                ? 'text-obsidian-inkPrimary font-medium bg-obsidian-surface1'
                : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1/60'
            }`}
          >
            {activeCenterView === 'preview' && previewLayout === 'full' && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-obsidian-inkPrimary rounded-b-sm" />
            )}
            <Globe className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
            <span className="truncate max-w-[140px] font-mono">Live Preview</span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsPreviewOpen(false);
              }}
              aria-label="Close Live Preview"
              title="Close Live Preview"
              className="w-6 h-6 -mr-1 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-obsidian-surface2 transition-all text-obsidian-inkSecondary hover:text-obsidian-inkPrimary cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 px-1">
        {isPreviewOpen && (
          <button
            onClick={() => setPreviewLayout(previewLayout === 'full' ? 'split' : 'full')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors cursor-pointer border ${
              previewLayout === 'full'
                ? 'bg-obsidian-surface2 text-obsidian-inkPrimary border-obsidian-border hover:bg-obsidian-surface3'
                : 'hover:bg-obsidian-surface1 text-obsidian-inkSecondary border-transparent'
            }`}
            title={previewLayout === 'full' ? 'Switch to Split View (Editor & Preview side-by-side)' : 'Switch to Full Center Preview'}
          >
            {previewLayout === 'full' ? <Columns className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span>{previewLayout === 'full' ? 'Split View' : 'Full Preview'}</span>
          </button>
        )}
        {hasDirtyTabs && (
          <button
            onClick={() => saveAllFiles()}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-obsidian-surface1 text-obsidian-inkPrimary text-[10px] font-mono transition-colors cursor-pointer"
            title="Save All Dirty Tabs (Ctrl+K S)"
          >
            <Save className="w-3 h-3" />
            <span>Save All</span>
          </button>
        )}
        {openTabs.length > 1 && (
          <button
            onClick={() => activeTabPath && closeOtherTabs(activeTabPath)}
            className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-obsidian-surface1 text-obsidian-inkMuted hover:text-obsidian-inkPrimary text-[10px] font-mono transition-colors cursor-pointer"
            title="Close Other Tabs"
          >
            <span>Close Others</span>
          </button>
        )}
      </div>

      {/* Tab Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-obsidian-surface2 border border-obsidian-border rounded-xl shadow-2xl p-1 w-44 font-mono text-xs animate-in fade-in"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              closeTab(contextMenu.tabPath);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>Close</span>
            <span className="text-[9px] text-obsidian-inkMuted">Ctrl+W</span>
          </button>
          <button
            onClick={() => {
              closeOtherTabs(contextMenu.tabPath);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors cursor-pointer"
          >
            Close Others
          </button>
          <button
            onClick={() => {
              handleCloseToRight(contextMenu.tabPath);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors cursor-pointer"
          >
            Close to the Right
          </button>
          <div className="h-px bg-obsidian-surface3 my-1" />
          <button
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.tabPath).catch(() => {});
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-obsidian-surface3 text-obsidian-inkPrimary transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Copy className="w-3 h-3" />
            <span>Copy Path</span>
          </button>
        </div>
      )}
    </div>
  );
};
