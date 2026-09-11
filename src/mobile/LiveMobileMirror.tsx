import React, { useState } from 'react';
import { RefreshCw, ExternalLink, Globe } from 'lucide-react';

export const LiveMobileMirror: React.FC = () => {
  const [key, setKey] = useState(Date.now());
  const [previewUrl] = useState('/preview');

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-surface1">
      {/* Mobile Mirror Header */}
      <div className="h-9 bg-obsidian-surface2 border-b border-obsidian-hairline flex items-center justify-between px-4 text-xs">
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-obsidian-inkSecondary">
          <Globe className="w-3 h-3 text-obsidian-inkPrimary" />
          <span className="truncate max-w-[180px]">{previewUrl}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setKey(Date.now())}
            className="p-1 rounded-lg text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors"
            title="Reload Mirror"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1 rounded-lg text-obsidian-inkSecondary hover:text-obsidian-inkPrimary transition-colors"
            title="Open in new window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <iframe
        key={key}
        src={previewUrl}
        title="Live Mobile Screen Mirror Sandbox"
        className="flex-1 w-full h-full border-none bg-obsidian-surface1"
      />
    </div>
  );
};
