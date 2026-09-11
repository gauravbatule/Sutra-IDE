import React from 'react';
import { PanelLeftClose } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

/** Human-readable title for each primary sidebar panel. */
const PANEL_TITLES: Record<string, string> = {
  explorer: 'Explorer',
  outline: 'Outline',
  search: 'Search',
  artifacts: 'Artifacts',
  swarm: 'Agents',
  git: 'Source Control',
};

export const SidebarPanelHeader: React.FC = () => {
  const activeSidebar = useIDEStore((s) => s.activeSidebar);
  const toggleSidebar = useIDEStore((s) => s.toggleSidebar);

  const title = PANEL_TITLES[activeSidebar] || 'Panel';

  return (
    <div className="panel-section-header flex items-center justify-between px-3 py-1.5 border-b border-obsidian-hairline bg-obsidian-surface1" role="toolbar" aria-label={`${title} panel`}>
      <span className="panel-section-title text-[10px] font-mono uppercase tracking-wider text-obsidian-inkMuted font-semibold">{title}</span>
      <button
        type="button"
        onClick={toggleSidebar}
        title="Close sidebar (Ctrl+B)"
        className="p-1 rounded hover:bg-obsidian-surface2 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
      >
        <PanelLeftClose className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
