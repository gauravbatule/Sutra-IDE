import React, { useState, useEffect } from 'react';
import { GitBranch, Wifi, Cpu, CheckCircle2, Shield, Zap } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const StatusBar: React.FC = () => {
  const { permissionLevel, subagents, pendingApprovals, isAgentGenerating } = useIDEStore();
  const [lanIp, setLanIp] = useState('127.0.0.1');
  const [branch, setBranch] = useState('main');

  useEffect(() => {
    fetch('/api/mobile/pairing-qr')
      .then((r) => r.json())
      .then((d) => {
        if (d.lanIp) setLanIp(d.lanIp);
      })
      .catch(() => undefined);

    fetch('/api/git/status')
      .then((r) => r.json())
      .then((d) => {
        if (d?.branch) setBranch(d.branch);
      })
      .catch(() => undefined);
  }, []);

  const executingCount = subagents.filter((s) => s.status === 'executing' || s.status === 'thinking').length;

  return (
    <footer className="h-6 bg-obsidian-canvas border-t border-obsidian-hairline flex items-center justify-between px-3 text-[10px] text-obsidian-inkMuted select-none z-20">
      {/* Left: Git Branch & Execution Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 hover:text-obsidian-inkPrimary cursor-pointer transition-colors">
          <GitBranch className="w-3 h-3 text-obsidian-accent" />
          <span className="font-mono text-obsidian-inkPrimary">{branch}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span>•</span>
          {isAgentGenerating || executingCount > 0 ? (
            <span className="text-obsidian-inkPrimary flex items-center gap-1 font-medium">
              <Cpu className="w-3 h-3 animate-spin" />
              {executingCount > 0 ? `${executingCount} Subagents Active` : 'Astra Autonomous Execution'}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-obsidian-inkSecondary">
              <CheckCircle2 className="w-3 h-3" />
              Astra Ready
            </span>
          )}
        </div>

        {pendingApprovals.length > 0 && (
          <span className="text-obsidian-inkPrimary font-medium animate-pulse">
            {pendingApprovals.length} Action(s) Awaiting Approval
          </span>
        )}
      </div>

      {/* Right: Telemetry, Autopilot, Phone Sync */}
      <div className="flex items-center gap-4">
        {/* Permission Mode Pill */}
        <div className="flex items-center gap-1 font-mono uppercase" title="Strict asks before every change. Full Access lets Astra work autonomously.">
          <Shield className="w-3 h-3" />
          <span>PERM:</span>
          <span className={permissionLevel === 'full' ? 'text-obsidian-inkPrimary font-bold' : 'text-obsidian-inkSecondary'}>
            {permissionLevel === 'full' ? 'FULL ACCESS' : 'STRICT'}
          </span>
        </div>

        {/* Model ID */}
        <div className="flex items-center gap-1 font-mono uppercase">
          <Zap className="w-3 h-3" />
          <span>SUTRA</span>
        </div>

        {/* Phone LAN Sync readout — pairing entry lives only in the ActivityBar sidebar */}
        <span
          className="flex items-center gap-1"
          title="LAN address for mobile companion pairing (pair via the QR button in the Activity Bar)"
        >
          <Wifi className="w-3 h-3" />
          <span className="font-mono">LAN: {lanIp}</span>
        </span>

        <span className="font-mono">UTF-8</span>
      </div>
    </footer>
  );
};
