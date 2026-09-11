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
const FALLBACK_LAN_IP = '192.168.1.10';

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
    return this.detectLanIp() || FALLBACK_LAN_IP;
  }

  /**
   * Best-effort RFC1918 address detection. Returns null when no Wi-Fi/Ethernet
   * IPv4 interface is found so callers can warn instead of silently advertising
   * a made-up address the phone can never reach.
   */
  private detectLanIp(): string | null {
    const interfaces = os.networkInterfaces();
    // Prioritize Wi-Fi and Ethernet interfaces
    for (const name of ['Wi-Fi', 'Ethernet', ...Object.keys(interfaces)]) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal && !name.includes('vEthernet') && !name.includes('Loopback')) {
          if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.') || iface.address.startsWith('172.')) {
            return iface.address;
          }
        }
      }
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
   * Generates ephemeral pairing token and high-res QR code.
   * `warning` is set when no real LAN address could be detected — the QR may
   * not be reachable from another device and the UI should say so plainly.
   */
  public async generatePairingQr(_origin?: string): Promise<{
    qrDataUrl: string;
    qrCodeDataUrl?: string;
    pairUrl: string;
    token: string;
    lanIp: string;
    lanIpDetected: boolean;
    expiresInSeconds: number;
    warning?: string;
  }> {
    const detectedIp = this.detectLanIp();
    const lanIp = detectedIp || FALLBACK_LAN_IP;
    const token = crypto.randomBytes(16).toString('hex');
    this.activeTokens.set(token, { token, createdAt: Date.now() });

    // Auto clean expired tokens after 5 mins
    setTimeout(() => this.activeTokens.delete(token), PAIRING_TOKEN_TTL_MS);

    // CRITICAL: Always use actual LAN IP (e.g. http://192.168.1.10:3001) for mobile pairing so phone connects to host machine on Wi-Fi
    const targetBase = `http://${lanIp}:${this.resolveClientPort()}`;
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
