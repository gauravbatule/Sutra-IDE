/**
 * Cookie normalization for every paste format users actually produce:
 * - A bare token (session-token value only)
 * - A single Cookie header string ("a=1; b=2")
 * - DevTools "Cookie" request header copy (possibly with a "cookie:" prefix)
 * - Multi-line header dumps ("cookie: ...\nuser-agent: ...")
 * - JSON cookie exports ({ name: value } or [{name,value}])
 * - Split next-auth tokens (__Secure-next-auth.session-token.0/.1) reassembled
 *
 * Output is the minimal working cookie for the target provider plus metadata.
 */

export interface NormalizedCookie {
  cookie: string;
  providerHint: 'chatgpt' | 'claude' | 'gemini' | 'qwen' | 'generic';
  reassembledSplitToken: boolean;
  droppedCount: number;
  notes: string[];
}

/** Cookie names that never affect auth — analytics, ads, A/B, CDN tracking. */
const JUNK_PATTERNS = [
  /^_ga/i, /^_gid/i, /^_gat/i, /^_utm/i,
  /^__stripe/i, /^_fbp/i, /^_gcl/i,
  /^amplitude/i, /^ajs_/i, /^intercom/i,
  /^__hstc|^hubspot/i, /^li_sugr|^li_mc/i,
  /^_pin/i, /^_scid/i, /^MP_/i,
  /^oai-log/, /^oai-allow-ne/, /^oai_lt/i, /^oai-did$/i, /^oai-nav/i,
  /^__Host-next-auth.csrf-token$/, /^__Secure-next-auth.callback-url$/,
  /^__cflb$/, /^_cfuvid$/, /^__cf_bm$/,
];

/** Values that are obviously not cookie content (labels pasted alongside). */
const looksLikeLabel = (value: string): boolean =>
  /^(cookie|cookies|header|headers|request|response)$/i.test(value.trim());

function parsePairs(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  // JSON export shapes
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const entries: Array<[string, string]> = Array.isArray(parsed)
        ? parsed.map((c: any) => [String(c.name ?? c.key ?? ''), String(c.value ?? '')])
        : Object.entries(parsed).map(([k, v]) => [k, String(v)]);
      for (const [name, value] of entries) {
        if (name && value && !looksLikeLabel(value)) map.set(name.trim(), value.trim());
      }
      if (map.size > 0) return map;
    } catch {
      // Fall through to text parsing
    }
  }

  // Text: strip "cookie:" line prefixes, then split on ; and newlines
  const flattened = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(set-)?cookie\s*:\s*/i, '').trim())
    .filter((line) => line.length > 0 && !looksLikeLabel(line))
    .join('; ');

  for (const part of flattened.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || !value) continue;
    if (/^(cookie|domain|path|secure|httponly|samesite)$/i.test(name)) continue;
    map.set(name, value);
  }
  return map;
}

/**
 * Reassembles next-auth split tokens: `name.0` + `name.1` (+ .2 …) concatenate
 * in numeric order into a single `name` cookie. Without this, sessions copied
 * from DevTools silently fail — the token lives split across parts.
 */
function reassembleSplitTokens(map: Map<string, string>): { map: Map<string, string>; reassembled: boolean } {
  const groups = new Map<string, string[]>();
  for (const [name, value] of map) {
    const match = name.match(/^(.+)\.(\d+)$/);
    if (match) {
      const base = match[1];
      const index = Number(match[2]);
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base)![Number(index)] = value;
    }
  }
  let reassembled = false;
  for (const [base, parts] of groups) {
    if (parts.every((p) => typeof p === 'string') && parts.length > 0) {
      map.set(base, parts.join(''));
      for (let i = 0; i < parts.length; i++) map.delete(`${base}.${i}`);
      reassembled = true;
    }
  }
  return { map, reassembled };
}

function detectProvider(names: string[]): NormalizedCookie['providerHint'] {
  const joined = names.join(' ');
  if (/next-auth\.session-token|__oailb|oai-sc/i.test(joined)) return 'chatgpt';
  if (/sessionKey|claude/i.test(joined)) return 'claude';
  if (/__Secure-1PSID|__Secure-1PSIDTS|SID/i.test(joined)) return 'gemini';
  if (/token_tweak|dasheng|qwen/i.test(joined)) return 'qwen';
  return 'generic';
}

/** Per-provider allowlists: when known, keep ONLY what the provider needs. */
const PROVIDER_REQUIRED: Record<string, RegExp[]> = {
  chatgpt: [/^__Secure-next-auth\.session-token$/, /^cf_clearance$/],
  claude: [/^sessionKey$/, /^cf_clearance$/],
  gemini: [/^__Secure-1PSID$/, /^__Secure-1PSIDTS$/, /^__Secure-1PSIDCC$/, /^SID$/, /^HSID$/, /^SSID$/, /^APISID$/, /^SAPISID$/],
  qwen: [/^token_tweak$/, /^tongyi_login_token$/, /^cna$/],
};

export function normalizeCookieBlob(raw: string): NormalizedCookie {
  const notes: string[] = [];
  const input = String(raw || '').trim();

  // Bare token paste: a single value with no '=' at all
  if (!input.includes('=') && input.length > 20) {
    return {
      cookie: input,
      providerHint: 'chatgpt',
      reassembledSplitToken: false,
      droppedCount: 0,
      notes: ['Treated as a bare session token.'],
    };
  }

  let map = parsePairs(input);
  const originalCount = map.size;

  const splitResult = reassembleSplitTokens(map);
  map = splitResult.map;
  if (splitResult.reassembled) notes.push('Reassembled split session-token parts into one token.');

  const providerHint = detectProvider(Array.from(map.keys()));
  const required = PROVIDER_REQUIRED[providerHint];

  // Drop junk; then, when the provider has a known allowlist and the essential
  // cookie is present, keep only that allowlist.
  for (const name of Array.from(map.keys())) {
    if (JUNK_PATTERNS.some((pattern) => pattern.test(name))) map.delete(name);
  }
  if (required) {
    const essentialPresent = required.some((pattern) => Array.from(map.keys()).some((n) => pattern.test(n)));
    if (essentialPresent) {
      for (const name of Array.from(map.keys())) {
        if (!required.some((pattern) => pattern.test(name))) map.delete(name);
      }
    }
  }

  const droppedCount = originalCount - map.size;
  if (droppedCount > 0) notes.push(`Dropped ${droppedCount} irrelevant cookie(s) (analytics, ads, CDN).`);

  const cookie = Array.from(map.entries()).map(([n, v]) => `${n}=${v}`).join('; ');
  return { cookie, providerHint, reassembledSplitToken: splitResult.reassembled, droppedCount, notes };
}

/**
 * Extracts a bearer-grade token from a normalized blob when the provider
 * needs one (e.g. ChatGPT's accessToken comes from the session endpoint, but
 * some users paste an accessToken directly).
 */
export function extractBearerToken(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (/^sk-/.test(trimmed)) return trimmed;
  const accessMatch = trimmed.match(/"accessToken"\s*:\s*"([^"]+)"/);
  if (accessMatch) return accessMatch[1];
  const eyMatch = trimmed.match(/\b(ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/);
  return eyMatch ? eyMatch[1] : null;
}
