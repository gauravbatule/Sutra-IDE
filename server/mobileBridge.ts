import QRCode from 'qrcode';
import os from 'os';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { WSChannel, createPacket } from './wsProtocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface MobileClientState {
  id: string;
  ip: string;
  userAgent: string;
  pairedAt: number;
  lastPing: number;
}

export class MobileBridge {
  private activeTokens: Map<string, { token: string; createdAt: number }> = new Map();
  private connectedClients: Map<string, { ws: WebSocket; state: MobileClientState }> = new Map();
  private port: number = 3001;

  constructor(port: number = 3001) {
    this.port = port;
  }

  /**
   * Syncs the bridge with the actual listening port (PORT env override) so QR
   * payloads advertise a reachable address.
   */
  public setPort(port: number): void {
    this.port = port;
  }

  public getLanIp(): string {
    return this.detectLanIp() || '127.0.0.1';
  }

  /**
   * Dynamic RFC1918 and active network interface detection across all devices.
   */
  private detectLanIp(): string | null {
    try {
      const interfaces = os.networkInterfaces();
      const isVirtual = (n: string) => /vEthernet|VirtualBox|vbox|VMware|WSL|docker|tailscale|loopback/i.test(n);

      // Pass 1: Wi-Fi / Ethernet on 192.168.x or 10.x (most common home/office LANs)
      for (const name of ['Wi-Fi', 'Ethernet', 'wlan0', 'eth0', 'en0', ...Object.keys(interfaces)]) {
        if (isVirtual(name)) continue;
        for (const iface of interfaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal) {
            if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
              return iface.address;
            }
          }
        }
      }

      // Pass 2: 172.16-172.31 range on non-virtual adapters
      for (const name of Object.keys(interfaces)) {
        if (isVirtual(name)) continue;
        for (const iface of interfaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('172.')) {
            return iface.address;
          }
        }
      }

      // Pass 3: Any non-internal IPv4 on non-virtual interface
      for (const name of Object.keys(interfaces)) {
        if (isVirtual(name)) continue;
        for (const iface of interfaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
    } catch {
      // Ignore network enumeration error
    }
    return null;
  }

  /**
   * The phone must load the pairing page from a server that can actually serve
   * the built SPA. When dist/index.html exists the Express server hosts it on
   * this.port (regardless of NODE_ENV); only a true Vite dev session points at
   * 5173. Encoding the wrong port here is the classic "QR does nothing" bug.
   */
  private resolveClientPort(): number {
    try {
      const builtIndex = path.join(__dirname, '..', 'dist', 'index.html');
      if (fs.existsSync(builtIndex)) return this.port;
    } catch {
      // Stat failure — fall through to the Vite dev assumption.
    }
    return 5173;
  }

  /**
   * Generates ephemeral pairing token and high-res QR code dynamically for the active device.
   */
  public async generatePairingQr(origin?: string): Promise<{
    qrDataUrl: string;
    qrCodeDataUrl?: string;
    pairUrl: string;
    token: string;
    lanIp: string;
    lanIpDetected: boolean;
    expiresInSeconds: number;
    warning?: string;
  }> {
    let hostFromOrigin = '';
    if (origin) {
      try {
        const u = new URL(origin);
        if (u.hostname && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
          hostFromOrigin = u.hostname;
        }
      } catch {
        // Raw host header
        const clean = origin.replace(/^https?:\/\//, '').split(':')[0];
        if (clean && clean !== 'localhost' && clean !== '127.0.0.1') {
          hostFromOrigin = clean;
        }
      }
    }

    const detectedIp = this.detectLanIp();
    const lanIp = hostFromOrigin || detectedIp || '127.0.0.1';
    const token = crypto.randomBytes(16).toString('hex');
    this.activeTokens.set(token, { token, createdAt: Date.now() });

    // Auto clean expired tokens after 5 mins
    setTimeout(() => this.activeTokens.delete(token), PAIRING_TOKEN_TTL_MS);

    const targetPort = this.resolveClientPort();
    const targetBase = `http://${lanIp}:${targetPort}`;
    const pairUrl = `${targetBase}/mobile?token=${token}&host=${lanIp}:${this.port}`;

    const qrDataUrl = await QRCode.toDataURL(pairUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#09090b',
        light: '#ffffff',
      },
    });

    console.log(`[Mobile Bridge] Pairing QR issued → ${pairUrl} (valid ${PAIRING_TOKEN_TTL_MS / 1000}s)`);

    return {
      qrDataUrl,
      qrCodeDataUrl: qrDataUrl,
      pairUrl,
      token,
      lanIp,
      lanIpDetected: Boolean(detectedIp),
      expiresInSeconds: PAIRING_TOKEN_TTL_MS / 1000,
      warning: detectedIp
        ? undefined
        : 'No Wi-Fi or Ethernet IPv4 address was detected on this machine — the QR may not open from another device.',
    };
  }

  /**
   * Verifies an ephemeral pairing token in constant time. Tokens expire after 5 minutes
   * (see generatePairingQr) and stay valid for reconnects within that window.
   */
  public verifyPairingToken(token?: string): boolean {
    if (!token) return false;
    const entry = this.activeTokens.get(token);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > PAIRING_TOKEN_TTL_MS) {
      this.activeTokens.delete(token);
      return false;
    }
    const a = Buffer.from(entry.token);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Registers a paired mobile client. Returns null when the pairing token is missing,
   * expired, or unknown — the caller must then close the socket.
   */
  public registerMobileClient(ws: WebSocket, clientIp: string, userAgent: string, token?: string): string | null {
    if (!this.verifyPairingToken(token)) {
      return null;
    }

    const clientId = `mob-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const state: MobileClientState = {
      id: clientId,
      ip: clientIp,
      userAgent,
      pairedAt: Date.now(),
      lastPing: Date.now(),
    };

    this.connectedClients.set(clientId, { ws, state });

    ws.on('close', () => {
      this.connectedClients.delete(clientId);
    });

    return clientId;
  }

  public broadcastToMobile(channel: WSChannel, type: string, payload: any): void {
    const packet = createPacket(channel, type, payload);
    for (const { ws } of this.connectedClients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(packet);
      }
    }
  }

  public getConnectedCount(): number {
    return this.connectedClients.size;
  }
}

export const mobileBridge = new MobileBridge();
