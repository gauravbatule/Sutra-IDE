import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { inspectWebPage } from '../../server/tools/webPageInspector.js';

describe('webPageInspector', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Test Website</title>
            <link rel="stylesheet" href="style.css" />
          </head>
          <body>
            <h1>Hello World</h1>
            <button>World Button</button>
            <canvas id="game"></canvas>
            <script src="main.js"></script>
          </body>
          </html>
        `);
      } else if (req.url === '/api/data') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: [1, 2, 3] }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 8888;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('inspects a live HTML page correctly', async () => {
    const result = await inspectWebPage(`http://127.0.0.1:${port}/`);
    expect(result.live).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.title).toBe('Test Website');
    expect(result.doctypeValid).toBe(true);
    expect(result.scriptsCount).toBeGreaterThanOrEqual(1);
    expect(result.stylesheetsCount).toBeGreaterThanOrEqual(1);
    expect(result.canvasCount).toBe(1);
    expect(result.interactiveElements.buttons).toBe(1);
    expect(result.a11yIssues).toHaveLength(0);
  });

  it('analyzes non-HTML json endpoints', async () => {
    const result = await inspectWebPage(`http://127.0.0.1:${port}/api/data`);
    expect(result.live).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.contentType).toContain('application/json');
  });

  it('reports connection failures gracefully', async () => {
    const result = await inspectWebPage('http://127.0.0.1:59999/', { timeoutMs: 500 });
    expect(result.live).toBe(false);
    expect(result.error).toBeDefined();
  });
});
