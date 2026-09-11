import React from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { AntiSlopLinter } from '../../utils/antiSlopLinter.js';
import { useIDEStore } from '../../stores/ideStore.js';

export const AntiSlopAuditor: React.FC = () => {
  const { openTabs, activeTabPath } = useIDEStore();
  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  const result = AntiSlopLinter.evaluateCode(activeTab?.content || '');

  return (
    <div className="p-4 bg-obsidian-surface3/90 border border-obsidian-border rounded-xl text-xs space-y-3 shadow-xl">
      <div className="flex items-center justify-between border-b border-obsidian-hairline pb-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-obsidian-inkPrimary" />
          <span className="font-bold text-obsidian-inkPrimary">Anti-Slop Visual QA Scorecard</span>
        </div>
        <div className="flex items-center gap-1 font-mono text-sm">
          <span className="text-obsidian-inkMuted">Score:</span>
          <span className={`font-bold ${result.passed ? 'text-obsidian-inkPrimary' : 'text-red-400'}`}>
            {result.score}/10
          </span>
        </div>
      </div>

      {result.violations.length > 0 ? (
        <div className="space-y-1.5">
          <span className="text-obsidian-inkSecondary font-medium text-[11px]">Identified Anti-Patterns:</span>
          {result.violations.map((v, i) => (
            <div key={i} className="p-2 rounded bg-obsidian-surface1 border border-red-500/20 text-red-300 text-[11px] flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-red-200">{v.rule}</div>
                <div className="text-obsidian-inkSecondary">{v.detail}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-obsidian-inkPrimary text-[11px] p-2 bg-obsidian-surface1 rounded border border-obsidian-border">
          <CheckCircle2 className="w-4 h-4" />
          <span>Zero AI slop detected. High-craft typography & hairline standards verified.</span>
        </div>
      )}
    </div>
  );
};
