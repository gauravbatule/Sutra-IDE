import http from 'http';
import https from 'https';

export interface WebPageInspectionResult {
  url: string;
  live: boolean;
  httpStatus?: number;
  contentType?: string;
  latencyMs: number;
  title?: string;
  doctypeValid: boolean;
  metaTags: Record<string, string>;
  scriptsCount: number;
  stylesheetsCount: number;
  brokenAssets: string[];
  canvasCount: number;
  interactiveElements: {
    buttons: number;
    links: number;
    inputs: number;
    forms: number;
  };
  a11yIssues: string[];
  consoleErrors: string[];
  domSummary: string;
  previewText: string;
  error?: string;
}

export async function inspectWebPage(
  url: string,
  options: { timeoutMs?: number; checkAssets?: boolean } = {}
): Promise<WebPageInspectionResult> {
  const timeoutMsVal = Math.min(15000, Math.max(1000, options.timeoutMs|| 5000));
  const startedAt = Date.now();

  try {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpLib = isHttps ? https : http;

    const res = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        let resolved = false;
        const done = (statusCode: number, headers: http.IncomingHttpHeaders, body: string) => {
          if (resolved) return;
          resolved = true;
          resolve({ statusCode, headers, body });
        };
        const fail = (err: Error) => {
          if (resolved) return;
          resolved = true;
          reject(err);
        };

        const req = httpLib.get(
          url,
          {
            headers: {
              'User-Agent': 'SUTRA-VisualInspector/1.0',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: timeoutMsVal,
          },
          (response) => {
            let data = '';
            response.on('data', (chunk) => {
              data += chunk;
              if (data.length > 2 * 1024 * 1024) {
                done(response.statusCode || 200, response.headers, data);
                req.destroy();
              }
            });
            response.on('end', () => {
              done(response.statusCode || 200, response.headers, data);
            });
            response.on('error', (err) => {
              fail(err);
            });
          }
        );

        req.on('error', (err) => {
          fail(err);
        });
        req.on('timeout', () => {
          req.destroy();
          fail(new Error('Connection timed out'));
        });
      }
    );

    const latencyMs = Date.now() - startedAt;
    const body = res.body;
    const isHtml = (res.headers['content-type'] || '').includes('text/html') || /<html/i.test(body);

    if (!isHtml) {
      return {
        url,
        live: res.statusCode >= 200 && res.statusCode < 400,
        httpStatus: res.statusCode,
        contentType: res.headers['content-type'] || 'text/plain',
        latencyMs,
        doctypeValid: false,
        metaTags: {},
        scriptsCount: 0,
        stylesheetsCount: 0,
        brokenAssets: [],
        canvasCount: 0,
        interactiveElements: { buttons: 0, links: 0, inputs: 0, forms: 0 },
        a11yIssues: [],
        consoleErrors: [],
        domSummary: 'Non-HTML endpoint',
        previewText: body.slice(0, 500),
      };
    }

    const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;
    const doctypeValid = /<!DOCTYPE\s+html/i.test(body);

    const scripts = Array.from(body.matchAll(/<script\s*[^>]*>/gi));
    const stylesheets = Array.from(body.matchAll(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi));
    const canvases = Array.from(body.matchAll(/<canvas[^>]*>/gi));
    const buttons = Array.from(body.matchAll(/<button[^>]*>/gi));
    const links = Array.from(body.matchAll(/<a\s+[^>]*href=/gi));
    const inputs = Array.from(body.matchAll(/<input[^>]*>/gi));
    const forms = Array.from(body.matchAll(/<form[^>]*>/gi));

    const a11yIssues: string[] = [];
    if (!title) a11yIssues.push('Missing <title> tag in document');
    if (!body.includes('viewport')) a11yIssues.push('Missing viewport meta tag');

    const cleanText = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      url,
      live: res.statusCode >= 200 && res.statusCode < 400,
      httpStatus: res.statusCode,
      contentType: res.headers['content-type'] || 'text/html',
      latencyMs,
      title,
      doctypeValid,
      metaTags: {},
      scriptsCount: scripts.length,
      stylesheetsCount: stylesheets.length,
      brokenAssets: [],
      canvasCount: canvases.length,
      interactiveElements: {
        buttons: buttons.length,
        links: links.length,
        inputs: inputs.length,
        forms: forms.length,
      },
      a11yIssues,
      consoleErrors: [],
      domSummary: 'HTML Document Inspected',
      previewText: cleanText.slice(0, 400),
    };
  } catch (err: any) {
    return {
      url,
      live: false,
      latencyMs: Date.now() - startedAt,
      doctypeValid: false,
      metaTags: {},
      scriptsCount: 0,
      stylesheetsCount: 0,
      brokenAssets: [],
      canvasCount: 0,
      interactiveElements: { buttons: 0, links: 0, inputs: 0, forms: 0 },
      a11yIssues: [],
      consoleErrors: [],
      domSummary: 'Connection Failed',
      previewText: '',
      error: 'Could not reach ' + url + ': ' + err.message,
    };
  }
}
