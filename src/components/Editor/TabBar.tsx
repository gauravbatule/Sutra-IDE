import React from 'react';
import { X, FileCode, Circle, Save } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const TabBar: React.FC = () => {
  const { openTabs, activeTabPath, setActiveTab, closeTab, closeOtherTabs, saveAllFiles } = useIDEStore();

  if (openTabs.length === 0) return null;

  const hasDirtyTabs = openTabs.some((t) => t.isDirty);

  return (
    <div className="h-9 bg-obsidian-canvas border-b border-obsidian-hairline flex items-center justify-between overflow-x-auto select-none no-scrollbar px-1">
      <div className="flex items-center h-full overflow-x-auto no-scrollbar gap-1">
        {openTabs.map((tab) => {
          const isActive = activeTabPath === tab.path;
          return (
            <div
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={`group h-full flex items-center gap-2 px-3 text-[11px] cursor-pointer transition-colors relative ${
                isActive
                  ? 'text-obsidian-inkPrimary font-medium'
                  : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary hover:bg-obsidian-surface1 rounded-t-md'
              }`}
            >
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-obsidian-inkPrimary rounded-b-sm" />
              )}
              <FileCode className="w-3.5 h-3.5" />
              <span className="truncate max-w-[140px]">{tab.name}</span>

              {tab.isDirty ? (
                <div
                  className="w-4 h-4 flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.path);
                  }}
                >
                  <Circle className="w-2 h-2 fill-current text-obsidian-inkPrimary group-hover:hidden" />
                  <X className="w-3 h-3 hidden group-hover:block text-obsidian-inkSecondary hover:text-obsidian-inkPrimary" />
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.path);
                  }}
                  className="w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-obsidian-surface2 transition-all text-obsidian-inkSecondary hover:text-obsidian-inkPrimary"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1 px-1">
        {hasDirtyTabs && (
          <button
            onClick={() => saveAllFiles()}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-obsidian-surface1 text-obsidian-inkPrimary text-[10px] font-mono transition-colors"
            title="Save All Dirty Tabs"
          >
            <Save className="w-3 h-3" />
            <span>Save All</span>
          </button>
        )}
        {openTabs.length > 1 && (
          <button
            onClick={() => activeTabPath && closeOtherTabs(activeTabPath)}
            className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-obsidian-surface1 text-obsidian-inkMuted hover:text-obsidian-inkPrimary text-[10px] font-mono transition-colors"
            title="Close Other Tabs"
          >
            <span>Close Others</span>
          </button>
        )}
      </div>
    </div>
  );
};
