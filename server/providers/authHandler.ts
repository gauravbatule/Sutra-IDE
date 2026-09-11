import db from '../db.js';
import { SUTRA_ALL_PROVIDERS } from './catalog.js';
import { describeHttpFailure, truncateExcerpt, ProviderError, type ProviderErrorCode } from './providerError.js';
import { normalizeCookieBlob } from './cookieUtils.js';

/** Friendly display name for any catalog provider id (falls back to the raw id). */
function friendlyProviderName(providerId: string): string {
  return SUTRA_ALL_PROVIDERS.find((p) => p.id === providerId)?.name || providerId;
}

/**
 * Human message for a fetch() that threw (timeout, DNS, refused, reset...).
 * Always one short actionable sentence naming the provider — never a raw stack trace.
 */
function describeFetchFailure(err: unknown, providerName: string, endpoint?: string): string {
  const e = err as any;
  const name = String(e?.name || '');
  const code = String(e?.cause?.code || e?.code || '');
  const target = endpoint ? ` (${endpoint})` : '';
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return `${providerName} did not respond in time${target}. Check your internet connection or proxy settings and test again.`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Could not resolve ${providerName}'s API host${target}. Check your internet connection or DNS, then retry.`;
  }
  if (code === 'ECONNREFUSED') {
    return `${providerName}'s endpoint refused the connection${target}. For local runtimes, start the server first; otherwise check the Base URL.`;
  }
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') {
    return `The connection to ${providerName} was reset${target}. A proxy or firewall may be blocking it — retry in a moment.`;
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return `${providerName}'s endpoint is unreachable from this network${target}. Check your connection and retry.`;
  }
  return `Could not reach ${providerName}${target}. ${truncateExcerpt(e?.message || 'Network error', 120)}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface ProviderCredentialRecord {
  id: string;
  name: string;
  api_key?: string;
  cookie_data?: string;
  auth_type: string;
  base_url?: string;
  headers?: string;
  status: string;
  updated_at: string;
}

// OpenAI-compatible base URLs used for GET /models connection tests.
// A user-configured creds.base_url always wins over this table; providers
// whose endpoint is ambiguous are intentionally omitted so they fall back
// to a friendly "set Base URL" prompt instead of a wrong hardcoded URL.
const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  hyperbolic: 'https://api.hyperbolic.xyz/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  novita: 'https://api.novita.ai/v3/openai',
  lepton: 'https://api.lepton.run/api/v1',
  nebius: 'https://api.studio.nebius.ai/v1',
  scaleway: 'https://api.scaleway.ai/v1',
  ovhcloud: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
  baseten: 'https://inference.baseten.co/v1',
  featherless: 'https://api.featherless.ai/v1',
  siliconflow: 'https://api.siliconflow.com/v1',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  'yi-01ai': 'https://api.lingyiwanwu.com/v1',
  xai: 'https://api.x.ai/v1',
  perplexity: 'https://api.perplexity.ai',
  github: 'https://models.github.ai/inference',
  cohere: 'https://api.cohere.ai/compatibility/v1',
  ai21: 'https://api.ai21.com/studio/v1',
  'meta-llama': 'https://api.llama.com/compat/v1',
  portkey: 'https://api.portkey.ai/v1',
  helicone: 'https://oai.helicone.ai/v1',
  vllm: 'http://localhost:8000/v1',
  localai: 'http://localhost:8080/v1',
  'jan-ai': 'http://localhost:1337/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  sarvam: 'https://api.sarvam.ai/v1',
  upstage: 'https://api.upstage.ai/v1/solar',
  'nvidia-nim': 'https://integrate.api.nvidia.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  minimax: 'https://api.minimax.chat/v1',
  baichuan: 'https://api.baichuan-ai.com/v1',
  lambda: 'https://api.lambda.ai/v1',
  friendliai: 'https://inference.friendli.ai/v1',
  reka: 'https://api.reka.ai/v1',
  writer: 'https://api.writer.com/v1',
  stepfun: 'https://api.stepfun.com/v1',
  kluster: 'https://api.kluster.ai/v1',
  nscale: 'https://api.nscale.com/v1',
  'gmi-cloud': 'https://api.gmi-serving.com/v1',
  'vercel-ai-gateway': 'https://ai-gateway.vercel.sh/v1',
  requesty: 'https://router.requesty.ai/v1',
  dashscope: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'baidu-qianfan': 'https://qianfan.baidubce.com/v2',
  'bytedance-volcengine': 'https://ark.ap-southeast.bytepluses.com/api/v3',
};

// Per-provider cookie requirements for web-session providers (first matching rule wins).
// `tokens` are accepted cookie-name fragments matched case-insensitively against the
// pasted raw text and parsed keys; `allowLongRaw` accepts any paste of >= 25 chars so
// single-token JWT-style sessions still validate.
const WEB_COOKIE_CHECKS: Array<{
  test: (providerId: string) => boolean;
  tokens: string[];
  allowLongRaw?: boolean;
  error: string;
}> = [
  {
    test: (id) => id.includes('chatgpt') || id === 'openai',
    tokens: ['session-token', '__secure'],
    allowLongRaw: true,
    error: 'ChatGPT session not recognized. Open chatgpt.com, press F12 → Application → Cookies, copy all cookies and paste here.',
  },
  {
    test: (id) => id.includes('claude') || id === 'anthropic',
    tokens: ['sessionkey', 'sk-ant'],
    allowLongRaw: true,
    error: 'Claude session not recognized. Open claude.ai, press F12 → Application → Cookies, copy the sessionKey cookie (it starts with sk-ant-sid01-) and paste here.',
  },
  {
    test: (id) => id.includes('gemini') || id === 'google',
    tokens: ['1psid', '__secure-1psidts'],
    allowLongRaw: true,
    error: 'Google session not recognized. Sign in at gemini.google.com, press F12 → Application → Cookies, copy __Secure-1PSID and __Secure-1PSIDTS and paste here.',
  },
  {
    test: (id) => id.includes('deepseek'),
    tokens: ['usertoken'],
    allowLongRaw: true,
    error: 'DeepSeek session not recognized. Open chat.deepseek.com, press F12 → Application → Local Storage / Cookies, copy the userToken value and paste here.',
  },
  {
    test: (id) => id === 'glm-web',
    tokens: ['chatglm', 'session'],
    error: 'GLM web cookie should include the chatglm session value. Copy all cookies from chatglm.cn.',
  },
  {
    test: (id) => id.includes('grok'),
    tokens: ['sso'],
    allowLongRaw: true,
    error: 'Grok session not recognized. Open grok.com signed in with X Premium, press F12 → Application → Cookies, copy the sso and sso-rw values and paste here.',
  },
  {
    test: (id) => id.includes('perplexity'),
    tokens: ['session-token', '__secure'],
    allowLongRaw: true,
    error: 'Perplexity session not recognized. Open perplexity.ai signed in with Pro, press F12 → Application → Cookies, copy __Secure-next-auth.session-token and paste here.',
  },
  {
    test: (id) => id === 'poe-web' || id === 'poe',
    tokens: ['p-b'],
    allowLongRaw: true,
    error: 'Poe session not recognized. Open poe.com, press F12 → Application → Cookies, copy the p-b cookie value and paste here.',
  },
  {
    test: (id) => id.includes('phind'),
    tokens: ['phindid', 'session'],
    allowLongRaw: true,
    error: 'Phind session not recognized. Open phind.com signed in, press F12 → Application → Cookies, copy the phindId / session cookie and paste here.',
  },
  {
    test: (id) => id.includes('blackbox'),
    tokens: ['authjs.session-token', 'session-token'],
    allowLongRaw: true,
    error: 'Blackbox AI session not recognized. Open app.blackbox.ai, press F12 → Application → Cookies, copy __Secure-authjs.session-token and paste here.',
  },
  {
    test: (id) => id === 'v0-web' || id === 'v0',
    tokens: ['_vercel_jwt', 'vercel', 'session'],
    allowLongRaw: true,
    error: 'v0 session not recognized. Open v0.dev signed in, press F12 → Application → Cookies, copy the _vercel_jwt / session cookie and paste here.',
  },
  {
    test: (id) => id === 'bolt-web' || id === 'bolt',
    tokens: ['auth-token', 'sb-'],
    allowLongRaw: true,
    error: 'Bolt.new session not recognized. Open bolt.new signed in, press F12 → Application → Cookies, copy the sb-*-auth-token session cookie and paste here.',
  },
  {
    test: (id) => id === 'lovable-web' || id === 'lovable',
    tokens: ['session'],
    allowLongRaw: true,
    error: 'Lovable session not recognized. Open lovable.dev signed in, press F12 → Application → Cookies, copy all cookies and paste here.',
  },
  {
    test: (id) => id.includes('cursor'),
    tokens: ['workos'],
    allowLongRaw: true,
    error: 'Cursor session not recognized. Open cursor.com signed in, press F12 → Application → Cookies, copy WorkosCursorSessionToken and paste here.',
  },
  {
    test: (id) => id === 'qoder-web' || id === 'qoder',
    tokens: ['qoder_session_token', 'qoder', 'session'],
    allowLongRaw: true,
    error: 'Qoder session not recognized. Open qoder.ai signed in, press F12 → Application → Cookies, copy qoder_session_token and paste here.',
  },
  {
    test: (id) => id === 'antigravity' || id === 'antigravity-web',
    tokens: ['__secure-auth-token', 'auth-token', 'oauth'],
    allowLongRaw: true,
    error: 'Antigravity session not recognized. Open antigravity.google signed in, press F12 → Application → Cookies, copy __Secure-auth-token (or your OAuth token) and paste here.',
  },
  {
    test: (id) => id === 'qwen-web',
    tokens: ['token', 'tongyi'],
    allowLongRaw: true,
    error: 'Qwen web session not recognized. Sign in at chat.qwen.ai, press F12 → Application → Cookies / Local Storage, copy the token value and paste here.',
  },
  {
    test: (id) => id === 'kimi-web',
    tokens: ['access_token', 'refresh_token'],
    allowLongRaw: true,
    error: 'Kimi session not recognized. Sign in at kimi.com, press F12 → Application → Local Storage / Cookies, copy access_token or refresh_token and paste here.',
  },
  {
    test: (id) => id === 'meta-ai',
    tokens: ['xs', 'datr', 'fb_dtsg'],
    allowLongRaw: true,
    error: 'Meta AI session not recognized. Sign in at meta.ai with Facebook, press F12 → Application → Cookies, copy the xs and datr cookies and paste here.',
  },
  {
    test: (id) => id === 'duckduckgo-chat',
    tokens: ['duckai_token', 'vqd'],
    allowLongRaw: true,
    error: 'DuckDuckGo Chat session not recognized. Open duck.ai signed in, press F12 → Application → Cookies, copy the duckai_token cookie and paste here.',
  },
  {
    test: (id) => id === 'copilot-web',
    tokens: ['_u', 'wlidc', 'muid'],
    allowLongRaw: true,
    error: 'Microsoft Copilot session not recognized. Sign in at copilot.microsoft.com with your Microsoft account, press F12 → Application → Cookies, copy the _U cookie and paste here.',
  },
  {
    test: (id) => id === 'huggingchat-web',
    tokens: ['token', 'hf_'],
    allowLongRaw: true,
    error: 'HuggingChat session not recognized. Sign in at huggingface.co/chat, press F12 → Application → Cookies, copy the token cookie and paste here.',
  },
  {
    test: (id) => id === 'coze-web',
    tokens: ['sessionid', 'web_id'],
    allowLongRaw: true,
    error: 'Coze session not recognized. Sign in at www.coze.com, press F12 → Application → Cookies, copy the sessionid cookie and paste here.',
  },
  {
    test: (id) => id === 'mistral-web',
    tokens: ['session', 'authjs'],
    allowLongRaw: true,
    error: 'Le Chat (Mistral) session not recognized. Sign in at chat.mistral.ai, press F12 → Application → Cookies, copy all cookies and paste here.',
  },
];

// Enterprise clouds: no cheap fake live test — validate credential shape and require routing config.
const ENTERPRISE_KEY_CHECKS: Record<
  string,
  { label: string; looksValid: (key: string) => boolean; formatHint: string; routingHint: string }
> = {
  'aws-bedrock': {
    label: 'AWS Bedrock',
    looksValid: (key) => /^(AKIA|ASIA)[A-Z0-9]{16}$/i.test(key) || key.includes(':') || key.length >= 20,
    formatHint: 'AWS access key IDs look like AKIA... (20 chars) and are often pasted as ACCESS_KEY_ID:SECRET_ACCESS_KEY.',
    routingHint: 'Set the Base URL to your Bedrock / OpenAI-compatible endpoint or configure the AWS region (e.g. us-east-1) so requests route correctly.',
  },
  'azure-openai': {
    label: 'Azure OpenAI',
    looksValid: (key) => /^[a-f0-9]{32}$/i.test(key) || key.length >= 30,
    formatHint: 'Azure OpenAI keys are 32-character hexadecimal strings from portal.azure.com.',
    routingHint: 'Set the Base URL to your deployment endpoint, e.g. https://<resource>.openai.azure.com/openai/deployments/<deployment>/v1.',
  },
  'google-vertex': {
    label: 'Google Vertex AI',
    looksValid: (key) => key.includes('private_key') || key.length >= 100,
    formatHint: 'Vertex expects a GCP service-account JSON (contains "private_key") or a long-lived OAuth token.',
    routingHint: 'Set the Base URL to your Vertex AI endpoint including project and region, e.g. https://<region>-aiplatform.googleapis.com/v1/projects/<project>/locations/<region>.',
  },
};

// Media & audio providers have no reliable cheap read-only endpoint, so validate key format instead.
const MEDIA_KEY_CHECKS: Record<string, { label: string; prefixes: string[]; minLen: number; site: string }> = {
  runway: { label: 'RunwayML', prefixes: ['key_'], minLen: 20, site: 'app.runwayml.com/account/keys' },
  luma: { label: 'Luma Dream Machine', prefixes: ['luma-'], minLen: 20, site: 'lumalabs.ai/dream-machine/api' },
  kling: { label: 'Kling AI', prefixes: ['kling-'], minLen: 16, site: 'klingai.com' },
  pika: { label: 'Pika Labs', prefixes: ['pika_'], minLen: 16, site: 'pika.art' },
  elevenlabs: { label: 'ElevenLabs', prefixes: ['xi_', 'sk_'], minLen: 20, site: 'elevenlabs.io/app/api-keys' },
  cartesia: { label: 'Cartesia', prefixes: ['car_'], minLen: 16, site: 'play.cartesia.ai/keys' },
  playht: { label: 'PlayHT', prefixes: ['play_'], minLen: 16, site: 'play.ht' },
  deepgram: { label: 'Deepgram', prefixes: ['dg_'], minLen: 20, site: 'console.deepgram.com' },
  'stability-ai': { label: 'Stability AI', prefixes: ['sk-'], minLen: 20, site: 'platform.stability.ai/account/keys' },
  'midjourney-api': { label: 'Midjourney API Relay', prefixes: ['mj_'], minLen: 12, site: 'midjourney.com' },
  'suno-ai': { label: 'Suno AI', prefixes: [], minLen: 16, site: 'suno.com' },
  'udio-ai': { label: 'Udio', prefixes: [], minLen: 12, site: 'udio.com' },
};

export class ProviderAuthHandler {
  /**
   * Normalizes arbitrary cookie formats (raw string, Netscape file lines, JSON) into a standard Cookie header
   */
  /** Parses any known cookie paste format into a flat header string (no cleanup). */
  private parseCookieFormats(rawCookies?: string): string {
    if (!rawCookies || typeof rawCookies !== 'string') return '';
    const trimmed = rawCookies.trim();
    if (!trimmed) return '';

    // Format 1: JSON array of cookies [{ "name": "...", "value": "..." }] from Cookie-Editor / EditThisCookie
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const pairs = parsed
            .filter((c: any) => c && c.name && c.value !== undefined)
            .map((c: any) => `${c.name}=${c.value}`);
          if (pairs.length > 0) return pairs.join('; ');
        }
      } catch {
        // Not valid JSON — fall through to the next cookie format.
      }
    }

    // Format 2: JSON object { "name": "value" }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          const pairs = Object.entries(parsed)
            .filter(([k, v]) => k && v !== undefined)
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
          if (pairs.length > 0) return pairs.join('; ');
        }
      } catch {
        // Not a JSON object — fall through to the next cookie format.
      }
    }

    // Format 3: Netscape HTTP Cookie File format (.domain TRUE / FALSE 12345 name value)
    if (trimmed.includes('\t') || trimmed.split('\n').some((l) => l.split(/\s+/).length >= 7)) {
      const pairs: string[] = [];
      const lines = trimmed.split('\n');
      for (const line of lines) {
        const cleanLine = line.trim();
        if (!cleanLine || cleanLine.startsWith('#')) continue;
        const parts = cleanLine.split(/\t+|\s+/);
        if (parts.length >= 7) {
          const name = parts[5];
          const value = parts[6];
          if (name && value !== undefined) {
            pairs.push(`${name}=${value}`);
          }
        }
      }
      if (pairs.length > 0) {
        return pairs.join('; ');
      }
    }

    // Format 4: Raw Cookie header format (name=value; name2=value2 or single token)
    return trimmed.replace(/^Cookie:\s*/i, '').replace(/\r?\n/g, '; ').replace(/;\s*;/g, ';').trim();
  }

  /**
   * Full cookie normalization: format parsing (JSON / Netscape / header / bare
   * token) followed by split-token reassembly and junk-cookie removal, so any
   * paste — including full DevTools jars with `.0`/`.1` split session tokens —
   * becomes the minimal working cookie for its provider.
   */
  public normalizeCookies(rawCookies?: string): string {
    const parsed = this.parseCookieFormats(rawCookies);
    if (!parsed) return '';
    return normalizeCookieBlob(parsed).cookie;
  }

  /**
   * Parse arbitrary cookie header strings or JSON session tokens into clean key-value maps
   */
  public parseCookieString(raw: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!raw || typeof raw !== 'string') return cookies;

    const normalized = this.normalizeCookies(raw);
    if (!normalized) return cookies;

    // Parse semicolon-separated cookie header: "name=val; name2=val2"
    const pairs = normalized.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (key && value) {
          cookies[key] = value;
        }
      } else if (pair.trim()) {
        // Handle single-token format (e.g. sk-ant-... or user token)
        cookies['session'] = pair.trim();
      }
    }

    return cookies;
  }

  /**
   * Save credential (API key, Cookie, OAuth token) in SQLite database
   */
  public saveCredential(params: {
    providerId: string;
    authType: 'api-key' | 'cookie' | 'oauth' | 'local';
    apiKey?: string;
    cookieData?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
  }): boolean {
    const providerMeta = SUTRA_ALL_PROVIDERS.find((p) => p.id === params.providerId);
    const providerName = providerMeta ? providerMeta.name : params.providerId.toUpperCase();
    const normalizedCookie = params.cookieData ? this.normalizeCookies(params.cookieData) : null;

    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO providers (id, name, api_key, cookie_data, auth_type, base_url, headers, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Connected', CURRENT_TIMESTAMP)
      `);

      stmt.run(
        params.providerId,
        providerName,
        params.apiKey?.trim() || null,
        normalizedCookie || null,
        params.authType || 'api-key',
        params.baseUrl?.trim() || null,
        params.headers ? JSON.stringify(params.headers) : null
      );

      return true;
    } catch (err) {
      console.error('[ProviderAuthHandler] Failed to save credential:', err);
      return false;
    }
  }

  /**
   * Get all saved provider credentials
   */
  public getAllCredentials(): Record<string, ProviderCredentialRecord> {
    const results: Record<string, ProviderCredentialRecord> = {};
    try {
      const rows = db.prepare('SELECT * FROM providers').all() as any[];
      for (const r of rows) {
        results[r.id] = {
          id: r.id,
          name: r.name,
          api_key: r.api_key || undefined,
          cookie_data: r.cookie_data || undefined,
          auth_type: r.auth_type || 'api-key',
          base_url: r.base_url || undefined,
          headers: r.headers || undefined,
          status: r.status || 'Not connected',
          updated_at: r.updated_at,
        };
      }
    } catch (e) {
      console.error('[ProviderAuthHandler] Error fetching credentials:', e);
    }
    return results;
  }

  /**
   * Test a provider connection using either its configured API Key, Cookie, or Local runtime.
   * Every outcome states exactly WHAT was verified on success, and the exact next step on failure.
   * `code` (when failing) classifies the cause as 'auth' | 'network' | 'upstream'.
   */
  public async testProviderAuth(providerId: string): Promise<{ ok: boolean; latencyMs: number; error?: string; note?: string; code?: ProviderErrorCode }> {
    const start = Date.now();
    const creds = this.getAllCredentials()[providerId];
    const providerName = friendlyProviderName(providerId);

    if (!creds && !['ollama', 'lmstudio', 'pollinations', 'antigravity-ide'].includes(providerId)) {
      return { ok: false, latencyMs: 0, code: 'auth', error: `${providerName} has no credentials saved yet. Open Settings > Providers and enter an API key or paste your session cookie first.` };
    }

    try {
      // 1. Local Free Runtimes
      if (providerId === 'ollama') {
        const url = creds?.base_url || 'http://localhost:11434';
        let res: Response | null = null;
        try {
          res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
        } catch (netErr) {
          return { ok: false, latencyMs: Date.now() - start, code: 'network', error: `${describeFetchFailure(netErr, 'Ollama', `${url}/api/tags`)} Start Ollama ("ollama serve" or the desktop app) and test again.` };
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const fail = describeHttpFailure('Ollama', res.status, body);
          return { ok: false, latencyMs: Date.now() - start, code: fail.code, error: fail.error };
        }
        return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `Verified live: Ollama answered at ${safeHost(url)} and reported its local model catalog.` };
      }

      if (providerId === 'lmstudio') {
        const url = creds?.base_url || 'http://localhost:1234/v1';
        let res: Response | null = null;
        try {
          res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(4000) });
        } catch (netErr) {
          return { ok: false, latencyMs: Date.now() - start, code: 'network', error: describeFetchFailure(netErr, 'LM Studio', `${url}/models`) + ' Open LM Studio, go to the Developer tab and start the local server, then test again.' };
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const fail = describeHttpFailure('LM Studio', res.status, body);
          return { ok: false, latencyMs: Date.now() - start, code: fail.code, error: fail.error };
        }
        return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `Verified live: LM Studio's server is up at ${safeHost(url)} and returned its loaded model list.` };
      }

      if (providerId === 'pollinations') {
        try {
          const res = await fetch('https://text.pollinations.ai/feed', { signal: AbortSignal.timeout(4000) });
          if (!res.ok) {
            const fail = describeHttpFailure('Pollinations AI', res.status);
            return { ok: false, latencyMs: Date.now() - start, code: fail.code, error: fail.error };
          }
          return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: 'Verified live: the free Pollinations public endpoint responded — no key is required for this provider.' };
        } catch (netErr) {
          return { ok: false, latencyMs: Date.now() - start, code: 'network', error: describeFetchFailure(netErr, 'Pollinations AI', 'text.pollinations.ai') };
        }
      }

      // 1b. Antigravity IDE Bridge — pings a locally running OpenAI-compatible bridge URL
      if (providerId === 'antigravity-ide') {
        const baseUrl = creds?.base_url?.trim().replace(/\/$/, '');
        if (!baseUrl) {
          return {
            ok: false,
            latencyMs: 0,
            code: 'auth',
            error: 'The Antigravity IDE bridge needs a Base URL. Start your local Antigravity IDE runtime bridge, then paste its URL (e.g. http://localhost:PORT/v1) in Settings > Providers.',
          };
        }
        const bridgeHeaders: Record<string, string> = {};
        if (creds?.api_key?.trim()) bridgeHeaders['Authorization'] = `Bearer ${creds.api_key.trim()}`;
        if (creds?.cookie_data?.trim()) bridgeHeaders['Cookie'] = this.normalizeCookies(creds.cookie_data);
        let res: Response | null = null;
        try {
          res = await fetch(`${baseUrl}/models`, { headers: bridgeHeaders, signal: AbortSignal.timeout(6000) });
        } catch (netErr) {
          return { ok: false, latencyMs: Date.now() - start, code: 'network', error: describeFetchFailure(netErr, 'Antigravity IDE bridge', `${baseUrl}/models`) + ' Make sure the locally running Antigravity runtime bridge is up.' };
        }
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            return { ok: false, latencyMs: Date.now() - start, code: 'auth', error: 'The bridge rejected the attached credential (HTTP ' + res.status + '). Re-paste your Antigravity session cookie or API key in Settings > Providers.' };
          }
          const body = await res.text().catch(() => '');
          const fail = describeHttpFailure('Antigravity IDE bridge', res.status, body);
          return { ok: false, latencyMs: Date.now() - start, code: fail.code, error: fail.error };
        }
        return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `Verified live: the Antigravity IDE bridge at ${safeHost(baseUrl)} authenticated and returned its model list.` };
      }

      // 2. Web Cookie Authentication Check
      if (creds?.auth_type === 'cookie' || (creds?.cookie_data && !creds?.api_key)) {
        if (!creds?.cookie_data || !creds.cookie_data.trim()) {
          return { ok: false, latencyMs: 0, code: 'auth', error: `The ${providerName} cookie field is empty. Copy your browser session cookie and paste it in Settings > Providers.` };
        }
        const cookies = this.parseCookieString(creds.cookie_data);
        const cookieKeys = Object.keys(cookies);
        if (cookieKeys.length === 0) {
          return { ok: false, latencyMs: 0, code: 'auth', error: `${providerName}: the pasted text contained no recognizable cookie pairs. Paste either a name=value cookie line, a JSON cookie export, or a Netscape cookies.txt block.` };
        }

        // Validate provider-specific cookie requirements (data-driven rules)
        const raw = creds.cookie_data;
        const rule = WEB_COOKIE_CHECKS.find((r) => r.test(providerId));
        let verifiedWhat = `${cookieKeys.length} cookie field(s) parsed`;
        if (rule) {
          const rawLower = raw.toLowerCase();
          const keysLower = cookieKeys.map((k) => k.toLowerCase());
          const hitToken = rule.tokens.find((t) => rawLower.includes(t)) || rule.tokens.find((t) => keysLower.some((k) => k.includes(t)));
          const longRawOk = Boolean(rule.allowLongRaw && raw.trim().length >= 25);
          if (!hitToken && !longRawOk) {
            throw new ProviderError(rule.error, 'auth', { retryable: false, provider: providerName });
          }
          verifiedWhat = hitToken ? `the required "${hitToken}" session field was found` : `a single-token session value (${raw.trim().length} chars) was accepted`;
        }

        // If a custom base_url is set, perform a live authenticated ping against it
        if (creds.base_url) {
          const testUrl = `${creds.base_url.replace(/\/$/, '')}/models`;
          let res: Response | null = null;
          try {
            res = await fetch(testUrl, {
              headers: {
                Cookie: this.normalizeCookies(creds.cookie_data),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
              signal: AbortSignal.timeout(6000),
            });
          } catch (netErr) {
            return { ok: false, latencyMs: Date.now() - start, code: 'network', error: `${describeFetchFailure(netErr, providerName, testUrl)} The Base URL you set must be reachable.` };
          }
          if (res.status === 401 || res.status === 403) {
            return { ok: false, latencyMs: Date.now() - start, code: 'auth', error: `Your ${providerName} session expired — open Settings > Providers and paste a fresh cookie. The live endpoint rejected it with HTTP ${res.status}.` };
          }
          if (res.ok) {
            return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `Verified live: ${providerName} accepted the cookie (${verifiedWhat}) and ${safeHost(testUrl)} returned an authenticated response.` };
          }
          // Reachable but no usable /models route — cookie shape itself passed, so say exactly that.
          return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `${providerName} cookie format verified (${verifiedWhat}). The Base URL answered HTTP ${res.status} without a /models listing, so live connectivity will be confirmed on first use.` };
        }

        return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `${providerName} cookie format verified (${verifiedWhat}). No Base URL is set, so live reachability will be confirmed on first use.` };
      }

      // 3. API Key Authentication Check
      if (creds?.auth_type === 'api-key' || creds?.api_key) {
        const key = creds?.api_key?.trim();
        if (!key) {
          return { ok: false, latencyMs: 0, code: 'auth', error: `The ${providerName} API key field is empty. Create a key at the provider's console and paste it in Settings > Providers.` };
        }

        // Replicate: dedicated lightweight account endpoint
        if (providerId === 'replicate') {
          let res: Response | null = null;
          try {
            res = await fetch('https://api.replicate.com/v1/account', {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(6000),
            });
          } catch (netErr) {
            return { ok: false, latencyMs: Date.now() - start, code: 'network', error: describeFetchFailure(netErr, 'Replicate', 'api.replicate.com') };
          }
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            const fail = describeHttpFailure('Replicate', res.status, body || 'Replicate rejected this API token. Get a fresh one at replicate.com/account/api-tokens.');
            return { ok: false, latencyMs: Date.now() - start, code: fail.code, error: fail.code === 'auth' ? `${fail.error} Get a fresh token at replicate.com/account/api-tokens.` : fail.error };
          }
          return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: 'Verified live: Replicate authenticated this API token against your account endpoint.' };
        }

        // Zhipu GLM family: honor custom base_url, otherwise try Z.ai first and fall back to open.bigmodel.cn on 404
        if (providerId === 'glm' || providerId === 'zhipu') {
          const endpoints = creds?.base_url?.trim()
            ? [`${creds.base_url.trim().replace(/\/$/, '')}/models`]
            : ['https://api.z.ai/api/paas/v4/models', 'https://open.bigmodel.cn/api/paas/v4/models'];
          let lastError = '';
          for (const endpoint of endpoints) {
            let res: Response | null = null;
            try {
              res = await fetch(endpoint, {
                headers: { Authorization: `Bearer ${key}` },
                signal: AbortSignal.timeout(6000),
              });
            } catch (netErr) {
              lastError = describeFetchFailure(netErr, providerName, endpoint);
              continue;
            }
            if (res.ok) {
              return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `Verified live: the GLM key authenticated against ${safeHost(endpoint)} and returned its model catalog.` };
            }
            const errText = await res.text().catch(() => '');
            const fail = describeHttpFailure(providerName, res.status, errText || res.statusText);
            lastError = fail.code === 'auth' ? `the key was rejected by ${safeHost(endpoint)}` : truncateExcerpt(fail.error, 160);
            if (res.status !== 404) break;
          }
          return {
            ok: false,
            latencyMs: Date.now() - start,
            code: 'auth',
            error: `${providerName} did not accept this key (${lastError}). Coding-plan keys work on both api.z.ai and open.bigmodel.cn — re-copy the key from z.ai/manage-apikey or open.bigmodel.cn/usercenter/apikeys.`,
          };
        }

        // NVIDIA NIM: fully OpenAI-compatible build.nvidia.com endpoint (GET /models, Bearer key)
        if (providerId === 'nvidia-nim') {
          const baseUrl = (creds?.base_url?.trim() || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
          let res: Response | null = null;
          try {
            res = await fetch(`${baseUrl}/models`, {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(6000),
            });
          } catch (netErr) {
            return { ok: false, latencyMs: Date.now() - start, code: 'network', error: describeFetchFailure(netErr, 'NVIDIA NIM', `${baseUrl}/models`) };
          }
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            const fail = describeHttpFailure('NVIDIA NIM', res.status, body);
            return {
              ok: false,
              latencyMs: Date.now() - start,
              code: fail.code,
              error: fail.code === 'auth' ? `${fail.error} Get a free key at build.nvidia.com.` : fail.error,
            };
          }
          return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `Verified live: NVIDIA NIM authenticated against ${safeHost(baseUrl)} and returned its model catalog.` };
        }

        // Enterprise clouds: validate credential shape and routing config without a fake live call
        const enterprise = ENTERPRISE_KEY_CHECKS[providerId];
        if (enterprise) {
          if (!enterprise.looksValid(key)) {
            return { ok: false, latencyMs: Math.max(1, Date.now() - start), code: 'auth', error: `That does not look like a valid ${enterprise.label} credential. ${enterprise.formatHint}` };
          }
          if (!creds?.base_url?.trim()) {
            return {
              ok: false,
              latencyMs: Math.max(1, Date.now() - start),
              code: 'auth',
              error: `${enterprise.label}: the credential format looks valid, but routing is not configured yet. ${enterprise.routingHint}`,
            };
          }
          return {
            ok: true,
            latencyMs: Math.max(1, Date.now() - start),
            note: `${enterprise.label}: verified the credential format and that a Base URL for live model calls is configured (${safeHost(creds.base_url)}).`,
          };
        }

        // Media & audio providers: validate key format (no reliable cheap test endpoint exists)
        const media = MEDIA_KEY_CHECKS[providerId];
        if (media) {
          const formatOk = media.prefixes.some((p) => key.startsWith(p)) || key.length >= media.minLen;
          if (!formatOk) {
            const prefixHint = media.prefixes.length ? ` Keys usually start with "${media.prefixes[0]}".` : '';
            return { ok: false, latencyMs: Math.max(1, Date.now() - start), code: 'auth', error: `That does not look like a valid ${media.label} API key.${prefixHint} Get one at ${media.site} and paste it in Settings > Providers.` };
          }
          return {
            ok: true,
            latencyMs: Math.max(1, Date.now() - start),
            note: `${media.label}: verified the API key format. Live connectivity testing is not available for this provider — requests will be sent to the configured endpoint.`,
          };
        }

        let testUrl = '';
        const headers: Record<string, string> = {};

        switch (providerId) {
          case 'groq':
            testUrl = 'https://api.groq.com/openai/v1/models';
            headers['Authorization'] = `Bearer ${key}`;
            break;
          case 'google':
            testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
            break;
          case 'openai':
            testUrl = 'https://api.openai.com/v1/models';
            headers['Authorization'] = `Bearer ${key}`;
            break;
          case 'deepseek':
            testUrl = 'https://api.deepseek.com/v1/models';
            headers['Authorization'] = `Bearer ${key}`;
            break;
          case 'anthropic':
            testUrl = 'https://api.anthropic.com/v1/models';
            headers['x-api-key'] = key;
            headers['anthropic-version'] = '2023-06-01';
            break;
          case 'openrouter':
            testUrl = 'https://openrouter.ai/api/v1/models';
            headers['Authorization'] = `Bearer ${key}`;
            break;
          case 'together':
            testUrl = 'https://api.together.xyz/v1/models';
            headers['Authorization'] = `Bearer ${key}`;
            break;
          case 'fireworks':
            testUrl = 'https://api.fireworks.ai/inference/v1/models';
            headers['Authorization'] = `Bearer ${key}`;
            break;
          case 'mistral':
            testUrl = 'https://api.mistral.ai/v1/models';
            headers['Authorization'] = `Bearer ${key}`;
            break;
          default: {
            // A user-configured base_url always wins over the built-in table
            const customBase = creds?.base_url?.trim().replace(/\/$/, '');
            if (customBase) {
              testUrl = `${customBase}/models`;
            } else {
              const knownBase = OPENAI_COMPATIBLE_BASE_URLS[providerId];
              if (!knownBase) {
                return {
                  ok: false,
                  latencyMs: 0,
                  code: 'auth',
                  error: `${providerName} has no built-in test endpoint. Paste its OpenAI-compatible Base URL (e.g. https://host/v1) next to the key in Settings > Providers to enable connection testing.`,
                };
              }
              testUrl = `${knownBase.replace(/\/$/, '')}/models`;
            }
            headers['Authorization'] = `Bearer ${key}`;
          }
        }

        if (testUrl) {
          let res: Response;
          try {
            res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(6000) });
          } catch (netErr) {
            return { ok: false, latencyMs: Date.now() - start, code: 'network', error: describeFetchFailure(netErr, providerName, testUrl) };
          }
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            const fail = describeHttpFailure(providerName, res.status, errText || res.statusText);
            return { ok: false, latencyMs: Date.now() - start, code: fail.code, error: fail.error };
          }
          return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `Verified live: ${providerName} authenticated against ${safeHost(testUrl)} and returned its model catalog.` };
        }

        return { ok: true, latencyMs: Math.max(1, Date.now() - start), note: `${providerName}: verified the credential is present and well-formed; no live endpoint was available to confirm it.` };
      }

      return { ok: false, latencyMs: 0, code: 'auth', error: `${providerName}: no usable API key or cookie was found for this test. Re-enter the credential in Settings > Providers.` };
    } catch (err: any) {
      if (err instanceof ProviderError) {
        return { ok: false, latencyMs: Date.now() - start, code: err.code, error: err.message };
      }
      if (err instanceof Error && err.name === 'TimeoutError') {
        return { ok: false, latencyMs: Date.now() - start, code: 'network', error: `${providerName} did not respond in time (timed out). Check your connection or proxy settings and retry.` };
      }
      return { ok: false, latencyMs: Date.now() - start, code: 'upstream', error: truncateExcerpt(err?.message || 'Connection test failed — please retry.') };
    }
  }
}

export const providerAuthHandler = new ProviderAuthHandler();
