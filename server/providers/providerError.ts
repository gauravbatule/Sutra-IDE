// Shared normalized error contract for every server/providers/* provider.
// Goal: user-facing failures are ALWAYS a single crisp human sentence with a
// machine-readable code and retryability flag — never raw fetch errors, stack
// traces, or JSON dumps bubbling up to the UI.

export type ProviderErrorCode = 'auth' | 'network' | 'upstream';

export interface NormalizedProviderError {
  /** Single human-readable sentence, safe to render directly in the UI. */
  error: string;
  /** 'auth' = credential missing/invalid/expired; 'network' = local connectivity; 'upstream' = provider-side problem or rejection. */
  code: ProviderErrorCode;
  /** true when the same request may succeed on retry (network blips, 429/5xx). */
  retryable: boolean;
  /** Friendly provider display name, e.g. "ChatGPT Web (Plus/Pro)". */
  provider?: string;
}

/** Hard cap for any upstream body excerpt embedded in a message. */
export const UPSTREAM_EXCERPT_LIMIT = 200;

/** Collapse whitespace and clamp an upstream body excerpt to <=200 chars. */
export function truncateExcerpt(text: unknown, max: number = UPSTREAM_EXCERPT_LIMIT): string {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

/**
 * Rich error carrying the normalized shape alongside a human message.
 * Extends Error so existing catch-and-fallback call chains keep working.
 */
export class ProviderError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly retryable: boolean;
  public readonly provider?: string;

  constructor(message: string, code: ProviderErrorCode, options?: { retryable?: boolean; provider?: string; cause?: unknown }) {
    super(truncateExcerpt(message, 500));
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options?.retryable ?? code === 'network';
    this.provider = options?.provider;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  public toJSON(): NormalizedProviderError {
    return { error: this.message, code: this.code, retryable: this.retryable, ...(this.provider ? { provider: this.provider } : {}) };
  }
}

const NETWORK_CAUSE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);

function looksLikeNetworkFailure(err: any): boolean {
  const name = String(err?.name || '');
  const code = String(err?.cause?.code || err?.code || '');
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  return NETWORK_CAUSE_CODES.has(code);
}

/**
 * Normalize ANY thrown value into the standard { error, code, retryable } shape.
 * Never throws. Raw messages are clamped so no stack traces / huge JSON leak through.
 */
export function normalizeProviderError(err: unknown, providerName?: string): NormalizedProviderError {
  if (err instanceof ProviderError) {
    const shaped = err.toJSON();
    return providerName && !shaped.provider ? { ...shaped, provider: providerName } : shaped;
  }
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown failure');
  if (looksLikeNetworkFailure(err)) {
    return { error: `${providerName ? `${providerName} ` : ''}could not be reached. Check your internet connection (or proxy/firewall) and try again.`, code: 'network', retryable: true, ...(providerName ? { provider: providerName } : {}) };
  }
  return { error: truncateExcerpt(raw), code: 'upstream', retryable: false, ...(providerName ? { provider: providerName } : {}) };
}

/**
 * Human message + classification for a non-OK HTTP response from an upstream API.
 * `status` drives the wording; `bodyExcerpt` is clamped to <=200 chars automatically.
 */
export function describeHttpFailure(providerName: string, status: number, bodyExcerpt?: string): NormalizedProviderError {
  const excerpt = truncateExcerpt(bodyExcerpt);
  if (status === 401 || status === 403) {
    return {
      error: `${providerName} rejected this credential (HTTP ${status}). Open Settings > Providers, paste a fresh key or cookie, then test again.`,
      code: 'auth',
      retryable: false,
      provider: providerName,
    };
  }
  if (status === 404) {
    return {
      error: `${providerName} returned 404 at the test endpoint. Verify the Base URL points at the API root (e.g. https://host/v1).${excerpt ? ` Upstream said: "${excerpt}"` : ''}`,
      code: 'upstream',
      retryable: false,
      provider: providerName,
    };
  }
  if (status === 429) {
    return {
      error: `${providerName} rate limit hit (HTTP 429). Wait a minute and try again.`,
      code: 'upstream',
      retryable: true,
      provider: providerName,
    };
  }
  if (status >= 500) {
    return {
      error: `${providerName} is having a temporary outage (HTTP ${status}). This is on their side — retry in a few minutes.${excerpt ? ` Upstream said: "${excerpt}"` : ''}`,
      code: 'upstream',
      retryable: true,
      provider: providerName,
    };
  }
  return {
    error: `${providerName} test failed (HTTP ${status}).${excerpt ? ` Upstream said: "${excerpt}"` : ''}`,
    code: 'upstream',
    retryable: false,
    provider: providerName,
  };
}
