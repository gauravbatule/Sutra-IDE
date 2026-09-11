import React from 'react';
import { ChevronRight, FileCode, Folder, Home } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const Breadcrumbs: React.FC = () => {
  const { activeTabPath, openTabs } = useIDEStore();

  if (!activeTabPath) return null;

  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const segments = activeTabPath.split(/[/\\]/).filter(Boolean);

  return (
    <div className="h-6 bg-obsidian-surface1/90 border-b border-obsidian-hairline flex items-center px-3 text-[11px] font-mono text-obsidian-inkMuted select-none overflow-x-auto no-scrollbar gap-1 shrink-0">
      <Home className="w-3 h-3 text-obsidian-inkMuted shrink-0" />
      <span className="text-obsidian-inkMuted">workspace</span>
      
      {segments.map((seg, index) => {
        const isLast = index === segments.length - 1;
        return (
          <React.Fragment key={index}>
            <ChevronRight className="w-3 h-3 text-obsidian-hairline shrink-0" />
            <span
              className={`flex items-center gap-1 shrink-0 ${
                isLast
                  ? 'text-obsidian-inkPrimary font-semibold'
                  : 'text-obsidian-inkSecondary hover:text-obsidian-inkPrimary cursor-default'
              }`}
            >
              {isLast ? (
                <FileCode className="w-3 h-3 text-obsidian-accent" />
              ) : (
                <Folder className="w-3 h-3 text-obsidian-inkMuted" />
              )}
              {seg}
            </span>
          </React.Fragment>
        );
      })}

      {activeTab?.isDirty && (
        <span className="text-obsidian-inkSecondary font-sans text-[10px] ml-1 font-medium">• modified</span>
      )}
    </div>
  );
};
