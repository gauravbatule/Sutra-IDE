import React, { useState } from 'react';
import {
  X,
  Coffee,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const CoffeeModal: React.FC = () => {
  const { isCoffeeModalOpen, setCoffeeModalOpen } = useIDEStore();
  const [copiedLink, setCopiedLink] = useState(false);

  const copyDonationLink = () => {
    navigator.clipboard.writeText('https://buymeacoffee.com/gauravbatule');
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (!isCoffeeModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in select-none"
      onClick={() => setCoffeeModalOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg bg-obsidian-surface1 border border-obsidian-hairline rounded-xl overflow-hidden shadow-2xl flex flex-col font-sans animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-obsidian-hairline bg-obsidian-surface2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary">
              <Coffee className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-obsidian-inkPrimary font-mono">
                  Support SUTRA
                </h2>
                <span className="text-[10px] font-mono bg-obsidian-surface2 text-obsidian-inkSecondary px-2 py-0.5 rounded border border-obsidian-border">
                  SUTRA
                </span>
              </div>
              <p className="text-[11px] text-obsidian-inkMuted font-mono">
                Creator & Developer Support
              </p>
            </div>
          </div>

          <button
            onClick={() => setCoffeeModalOpen(false)}
            className="p-1.5 rounded-lg text-obsidian-inkMuted hover:text-obsidian-inkPrimary hover:bg-obsidian-surface3 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          <div className="p-4 rounded-xl bg-obsidian-surface2 border border-obsidian-hairline space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-obsidian-surface2 border border-obsidian-border flex items-center justify-center text-obsidian-inkPrimary font-mono font-bold text-sm shrink-0">
                GB
              </div>
              <div>
                <h3 className="text-xs font-semibold text-obsidian-inkPrimary font-mono">
                  Gaurav Batule
                </h3>
                <p className="text-[11px] text-obsidian-inkMuted font-mono">
                  Creator & Maintainer of SUTRA Autonomous AI IDE
                </p>
              </div>
            </div>

            <p className="text-xs text-obsidian-inkSecondary leading-relaxed font-sans">
              SUTRA is crafted to deliver a sovereign, ultra-fast developer experience that outclasses closed proprietary tools. If SUTRA is helping you build faster, solve tough bugs, and ship software, your coffee support directly fuels ongoing development.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <a
              href="https://buymeacoffee.com/gauravbatule"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:flex-1 py-2.5 px-4 rounded-lg bg-obsidian-accent text-obsidian-inkInverse hover:bg-obsidian-accentHover font-mono font-medium text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
            >
              <Coffee className="w-4 h-4" />
              <span>buymeacoffee.com/gauravbatule</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>

            <button
              onClick={copyDonationLink}
              className="w-full sm:w-auto py-2.5 px-4 rounded-lg bg-obsidian-surface2 hover:bg-obsidian-surface3 border border-obsidian-hairline text-obsidian-inkSecondary hover:text-obsidian-inkPrimary text-xs font-mono flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-obsidian-inkPrimary" />
                  <span className="text-obsidian-inkPrimary">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Link</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
