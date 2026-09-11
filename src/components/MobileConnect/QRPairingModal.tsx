import React, { useState, useEffect } from 'react';
import {
  X,
  Smartphone,
  Wifi,
  ShieldCheck,
  Mic,
  Play,
  Copy,
  Check,
  Lightbulb
} from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

export const QRPairingModal: React.FC = () => {
  const { isQRPairingOpen, setQRPairingOpen } = useIDEStore();
  const [qrData, setQrData] = useState<{ qrDataUrl: string; pairUrl: string; lanIp: string; connectedDevices: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchQR = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/mobile/pairing-qr');
      const data = await res.json();
      setQrData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isQRPairingOpen) {
      fetchQR();
    }
  }, [isQRPairingOpen]);

  if (!isQRPairingOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
      <div className="w-full max-w-md bg-obsidian-surface1 border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-obsidian-hairline flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.09] flex items-center justify-center text-obsidian-inkSecondary">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-obsidian-inkPrimary">SUTRA Mobile Connect</h3>
              <p className="text-[10px] text-obsidian-inkSecondary">Pair Phone over Wi-Fi / Local Area Network</p>
            </div>
          </div>

          <button
            onClick={() => setQRPairingOpen(false)}
            className="p-1.5 rounded-lg hover:bg-obsidian-surface4 text-obsidian-inkSecondary hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code Body */}
        <div className="p-6 flex flex-col items-center text-center space-y-4">
          <div className="p-3 bg-white rounded-2xl shadow-xl border border-white/10 relative">
            {qrData?.qrDataUrl ? (
              <img src={qrData.qrDataUrl} alt="Pairing QR Code" className="w-56 h-56 rounded-lg" />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-zinc-800 font-mono text-xs">
                {isLoading ? 'Generating QR Token...' : 'Error loading QR'}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-center gap-1.5 text-xs text-obsidian-inkPrimary font-mono mb-1">
              <Wifi className="w-3.5 h-3.5" />
              <span>LAN Gateway: {qrData?.lanIp || '192.168.1.10'}:3001</span>
            </div>
            <p className="text-xs text-obsidian-inkSecondary max-w-xs mx-auto">
              Scan with your iPhone or Android camera to unlock Pocket Agent, Live Viewport Mirror & Remote Approvals.
            </p>
          </div>

          {/* Quick Direct Link / Copy */}
          {qrData?.pairUrl && (
            <div className="w-full flex items-center gap-2 p-2 rounded-lg bg-obsidian-surface3 border border-white/5 text-[11px] font-mono text-obsidian-inkSecondary">
              <span className="truncate flex-1 text-left">{qrData.pairUrl}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(qrData.pairUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="px-2 py-1 rounded bg-obsidian-surface4 hover:bg-obsidian-surface4 text-obsidian-inkPrimary flex items-center gap-1 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-obsidian-inkPrimary" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}

          {/* Firewall & Network Guide */}
          <div className="w-full p-2.5 rounded-lg bg-obsidian-surface2 border border-obsidian-hairline text-[11px] text-obsidian-inkSecondary text-left space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-obsidian-inkPrimary">
              <Lightbulb className="w-3.5 h-3.5" />
              <span>Infinite Loading on Phone?</span>
            </div>
            <p className="text-[10px] text-obsidian-inkSecondary leading-relaxed">
              Windows Firewall or Wi-Fi AP Isolation is dropping packets. To connect instantly:
            </p>
            <ul className="text-[10px] text-obsidian-inkSecondary space-y-0.5 list-disc pl-4">
              <li>Open Windows <strong>Settings → Wi-Fi → [Your Network]</strong> → Switch from <em>Public</em> to <strong>Private network</strong>.</li>
              <li>Or allow <strong>Node.js</strong> through Windows Defender Firewall.</li>
            </ul>
          </div>

          {/* Mobile Super-powers bullet points */}
          <div className="w-full grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-[10px] text-obsidian-inkSecondary text-left">
            <div className="p-2 rounded bg-obsidian-surface3/60 border border-white/5">
              <Mic className="w-3.5 h-3.5 text-obsidian-inkSecondary mb-1" />
              <div className="font-bold text-obsidian-inkPrimary">Pocket Voice</div>
              <div>Prompt on the go</div>
            </div>
            <div className="p-2 rounded bg-obsidian-surface3/60 border border-white/5">
              <ShieldCheck className="w-3.5 h-3.5 text-obsidian-inkSecondary mb-1" />
              <div className="font-bold text-obsidian-inkPrimary">Remote Diffs</div>
              <div>1-Tap approval</div>
            </div>
            <div className="p-2 rounded bg-obsidian-surface3/60 border border-white/5">
              <Play className="w-3.5 h-3.5 text-obsidian-inkPrimary mb-1" />
              <div className="font-bold text-obsidian-inkPrimary">Live Mirror</div>
              <div>Physical testing</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
