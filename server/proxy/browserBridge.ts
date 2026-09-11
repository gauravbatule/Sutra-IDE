import WebSocket from 'ws';
import http from 'http';

export interface BrowserTabInfo {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
  type: string;
}

export class BrowserContextBridge {
  private debugPort = 9222;

  /** Check if Chrome/Edge is running with remote debugging port 9222 */
  public async isBrowserAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.debugPort}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** List available open browser tabs */
  public async listTabs(): Promise<BrowserTabInfo[]> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.debugPort}/json`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return [];
      const tabs = await res.json() as BrowserTabInfo[];
      return tabs.filter((t) => t.type === 'page');
    } catch {
      return [];
    }
  }

  /** Find the active ChatGPT or AI tab */
  public async findAITab(domainFragment: string = 'chatgpt.com'): Promise<BrowserTabInfo | null> {
    const tabs = await this.listTabs();
    return tabs.find((t) => t.url.includes(domainFragment)) || null;
  }

  /**
   * Execute JavaScript inside the real authenticated browser tab via Chrome DevTools Protocol
   */
  public async evaluateInTab(tabWsUrl: string, script: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(tabWsUrl);
      const id = 1;
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('CDP evaluation timed out after 30s'));
      }, 30000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: {
            expression: script,
            awaitPromise: true,
            returnByValue: true,
          },
        }));
      });

      ws.on('message', (data: string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.id === id) {
            clearTimeout(timeout);
            ws.close();
            if (parsed.result?.exceptionDetails) {
              reject(new Error(parsed.result.exceptionDetails.text || 'JavaScript execution failed in browser tab'));
            } else {
              resolve(parsed.result?.result?.value);
            }
          }
        } catch (e) {
          // ignore stream messages
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}

export const browserBridge = new BrowserContextBridge();
