import crypto from 'crypto';
import { ProviderError, truncateExcerpt } from './providerError.js';
import { normalizeCookieBlob } from './cookieUtils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_NAME = 'ChatGPT Web';

/**
 * Fallback model ids used ONLY when live discovery fails or returns nothing.
 * When discovery succeeds, these hardcoded ids are dropped from the catalog —
 * the session's own slugs are surfaced verbatim instead.
 */
export const CHATGPT_WEB_FALLBACK_MODEL_IDS = ['luna', 'gpt-5'];

/** The exact message required when the pasted ChatGPT cookie is no longer valid. */
function sessionExpiredError(): ProviderError {
  return new ProviderError(
    `Your ${PROVIDER_NAME} session expired — open Settings > Providers and paste a fresh cookie.`,
    'auth',
    { retryable: false, provider: PROVIDER_NAME }
  );
}

function noCookieError(): ProviderError {
  return new ProviderError(
    `No ${PROVIDER_NAME} cookie is set. Open Settings > Providers, select ChatGPT Web (Plus/Pro) and paste your __Secure-next-auth.session-token.`,
    'auth',
    { retryable: false, provider: PROVIDER_NAME }
  );
}

function transientNetworkError(cause?: unknown): ProviderError {
  return new ProviderError(
    `${PROVIDER_NAME} could not be reached right now (network hiccup). Check your connection and retry — no need to change your cookie.`,
    'network',
    { retryable: true, provider: PROVIDER_NAME, cause }
  );
}

type TokenResult = { ok: true; token: string } | { ok: false; failure: ProviderError };

export class ChatGPTWebProvider {
  private cachedTokens: Map<string, { token: string; expires: number }> = new Map();
  private cachedModels: Map<string, { models: string[]; expires: number }> = new Map();

  /**
   * Extracts or refreshes the access token using the user's browser session cookie,
   * classifying the outcome as auth-expired vs transient-network vs upstream so callers
   * can show one crisp message instead of a raw fetch error.
   */
  private async acquireToken(rawCookie: string): Promise<TokenResult> {
    if (!rawCookie || !rawCookie.trim()) {
      return { ok: false, failure: noCookieError() };
    }
    // Accept any paste format (full DevTools jar, split next-auth tokens, bare
    // token) and reduce it to the minimal working cookie before use.
    const normalized = normalizeCookieBlob(rawCookie);
    const cookieString = normalized.cookie;

    const cached = this.cachedTokens.get(cookieString);
    if (cached && cached.expires > Date.now()) {
      return { ok: true, token: cached.token };
    }

    const maxAttempts = 3; // 1 initial attempt + 2 retries (transient failures only)
    let lastNetworkCause: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch('https://chatgpt.com/api/auth/session', {
          headers: {
            'Cookie': cookieString,
            'User-Agent': BROWSER_UA,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });

        // Definitive cookie lifecycle signal: the session is gone, retrying will not help.
        if (res.status === 401 || res.status === 403) {
          console.warn(`[ChatGPTWebProvider] Cookie rejected (HTTP ${res.status}) — session expired or invalid.`);
          return { ok: false, failure: sessionExpiredError() };
        }

        if (!res.ok) {
          // 5xx / unusual statuses are upstream-side: worth retrying, then reporting as transient.
          if (res.status >= 500 && attempt < maxAttempts) continue;
          console.warn(`[ChatGPTWebProvider] Session endpoint returned HTTP ${res.status}.`);
          return {
            ok: false,
            failure: new ProviderError(
              `${PROVIDER_NAME} session service returned HTTP ${res.status}. This is usually temporary — retry in a moment.`,
              'upstream',
              { retryable: res.status >= 500 || res.status === 429, provider: PROVIDER_NAME }
            ),
          };
        }

        const data = await res.json() as any;
        if (data?.accessToken) {
          const parsedExpiry = data.expires ? new Date(data.expires).getTime() : NaN;
          const expires = Number.isFinite(parsedExpiry) && parsedExpiry > Date.now() ? parsedExpiry - 60000 : Date.now() + 3600000;
          this.cachedTokens.set(cookieString, { token: data.accessToken, expires });
          return { ok: true, token: data.accessToken };
        }
        // 200 OK but anonymous payload => cookie no longer carries a valid session.
        console.warn('[ChatGPTWebProvider] Session response contained no accessToken — treating cookie as expired.');
        return { ok: false, failure: sessionExpiredError() };
      } catch (err) {
        lastNetworkCause = err;
        if (attempt < maxAttempts) continue;
        console.warn('[ChatGPTWebProvider] Transient network failure reaching chatgpt.com session endpoint.');
        return { ok: false, failure: transientNetworkError(lastNetworkCause) };
      }
    }
    return { ok: false, failure: transientNetworkError(lastNetworkCause) };
  }

  /**
   * Legacy-friendly wrapper: resolves the access token or null on failure.
   * New code should prefer acquireToken()/streamConversation() to get the classified reason.
   */
  public async getAccessToken(cookieString: string): Promise<string | null> {
    const result = await this.acquireToken(cookieString);
    return result.ok ? result.token : null;
  }

  /**
   * Discovers the chat models available to this account via the backend models endpoint.
   * Results are cached for 10 minutes keyed by a hash of the cookie string.
   * Returns null on any failure (never throws).
   */
  public async listModels(cookieString: string): Promise<string[] | null> {
    try {
      const cacheKey = crypto.createHash('sha256').update(cookieString).digest('hex');
      const cached = this.cachedModels.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return cached.models;
      }

      const tokenResult = await this.acquireToken(cookieString);
      if (!tokenResult.ok) return null;

      const res = await fetch('https://chatgpt.com/backend-api/models', {
        headers: {
          'Authorization': `Bearer ${tokenResult.token}`,
          'Cookie': cookieString,
          'User-Agent': BROWSER_UA,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;

      const data = await res.json() as any;
      // Response shape varies: { models: [{ slug }] }, { items: [...] }, or a plain array
      const entries: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.models)
          ? data.models
          : Array.isArray(data?.items)
            ? data.items
            : [];

      const slugs: string[] = [];
      for (const entry of entries) {
        const slug = typeof entry === 'string' ? entry : entry?.slug;
        if (typeof slug === 'string' && this.isPlausibleChatModelSlug(slug)) {
          slugs.push(slug);
        }
      }

      const unique = [...new Set(slugs)];
      if (unique.length === 0) return null;

      this.cachedModels.set(cacheKey, { models: unique, expires: Date.now() + MODEL_CACHE_TTL_MS });
      return unique;
    } catch {
      return null;
    }
  }

  private isPlausibleChatModelSlug(slug: string): boolean {
    if (!slug || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return false;
    const lower = slug.toLowerCase();
    const excluded = ['embedding', 'whisper', 'tts', 'transcri', 'moderation', 'dall-e', 'sora', 'voice'];
    return !excluded.some((fragment) => lower.includes(fragment));
  }

  /**
   * Streams chat completions from ChatGPT Web using the session access token.
   * Yields text deltas, generated image URLs, thinking/status hints, errors, and done.
   * Failures before streaming starts are thrown as ProviderError carrying the normalized
   * { code: 'auth'|'network'|'upstream', retryable } shape; in-stream problems arrive as
   * { error } chunks with a single human-readable sentence.
   */
  public async *streamConversation(params: {
    cookieString: string;
    messages: any[];
    systemPrompt?: string;
    model?: string;
    signal?: AbortSignal;
  }): AsyncGenerator<{ delta?: string; done?: boolean; error?: string; thinking?: string; imageUrl?: string }> {
    const tokenResult = await this.acquireToken(params.cookieString);
    if (!tokenResult.ok) {
      throw tokenResult.failure;
    }
    const accessToken = tokenResult.token;

    const lastMsg = params.messages[params.messages.length - 1];
    const promptText = typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content || '');

    // Format full prompt context
    let fullPrompt = '';
    if (params.systemPrompt) {
      fullPrompt += `[System Instructions]\n${params.systemPrompt}\n\n`;
    }
    if (params.messages.length > 1) {
      const history = params.messages.slice(-16, -1).map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
      if (history) {
        fullPrompt += `[Conversation History]\n${history}\n\n`;
      }
    }
    fullPrompt += `USER: ${promptText}`;

    // Model passthrough: only fall back to 'auto' when no explicit model was requested
    const modelSlug = params.model && params.model.trim().length > 0 ? params.model.trim() : 'auto';

    let res: Response;
    try {
      res = await fetch('https://chatgpt.com/backend-api/conversation', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Cookie': params.cookieString,
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_UA,
          'Accept': 'text/event-stream',
          'Referer': 'https://chatgpt.com/',
          'Origin': 'https://chatgpt.com',
        },
        body: JSON.stringify({
          action: 'next',
          messages: [
            {
              id: crypto.randomUUID(),
              author: { role: 'user' },
              content: { content_type: 'text', parts: [fullPrompt] },
              metadata: {},
            },
          ],
          model: modelSlug,
          parent_message_id: crypto.randomUUID(),
          timezone_offset_min: -330,
          history_and_training_disabled: true,
        }),
        signal: params.signal,
      });
    } catch (err: any) {
      if (params.signal?.aborted) throw err;
      throw transientNetworkError(err);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw this.classifyConversationFailure(res.status, errText, modelSlug);
    }

    if (!res.body) {
      throw new ProviderError(`${PROVIDER_NAME} closed the connection without sending a response stream. Retry the request.`, 'upstream', { retryable: true, provider: PROVIDER_NAME });
    }

    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastSentText = '';
    const seenImagePointers = new Set<string>();
    let sentImageThinking = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') {
          yield { done: true };
          return;
        }
        if (!trimmed.startsWith('data: ')) continue;

        let data: any;
        try {
          data = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }

        // Top-level error payload — sanitize to one human sentence, never raw JSON.
        if (data?.error?.message) {
          const rawMessage = String(data.error.message);
          yield { error: this.humanizeUpstreamMessage(rawMessage, modelSlug) };
          continue;
        }

        const metadata = data?.message?.metadata;

        // DALL-E generation status hint
        if (metadata?.dalle?.status === 'generating' && !sentImageThinking) {
          sentImageThinking = true;
          yield { thinking: 'Generating image...' };
        }

        // Moderation-blocked responses
        if (metadata?.finish_details?.type === 'blocked') {
          yield { error: 'ChatGPT blocked this response due to its content policy. Rephrase the request and try again.' };
          continue;
        }

        const parts = data?.message?.content?.parts;
        if (!Array.isArray(parts)) continue;

        // Text lives in string parts; generated images appear as image_asset_pointer objects
        let currentFullText = '';
        for (const part of parts) {
          if (typeof part === 'string') {
            currentFullText += part;
          } else if (part && typeof part === 'object' && part.content_type === 'image_asset_pointer') {
            const pointer = part.asset_pointer;
            if (typeof pointer === 'string' && pointer.startsWith('http') && !seenImagePointers.has(pointer)) {
              seenImagePointers.add(pointer);
              yield { imageUrl: pointer };
            }
          }
        }
        if (currentFullText.length > lastSentText.length) {
          const newDelta = currentFullText.slice(lastSentText.length);
          lastSentText = currentFullText;
          yield { delta: newDelta };
        }
      }
    }

    yield { done: true };
  }

  /**
   * Maps a non-OK /backend-api/conversation status to exactly one actionable message:
   * expired cookie vs rate limit vs wrong model vs upstream outage.
   */
  private classifyConversationFailure(status: number, bodyText: string, modelSlug: string): ProviderError {
    const excerpt = truncateExcerpt(bodyText);

    if (status === 401 || status === 403) {
      return sessionExpiredError();
    }
    if (status === 429) {
      return new ProviderError(
        `${PROVIDER_NAME} hit its rate limit (HTTP 429). Wait about a minute and send again.`,
        'upstream',
        { retryable: true, provider: PROVIDER_NAME }
      );
    }
    // Wrong-model guard: surface the model id with the fix, never a silent fallback.
    const lowerBody = bodyText.toLowerCase();
    const modelRejected =
      status === 404 ||
      ((status === 400 || status === 422) && (lowerBody.includes('model') && (lowerBody.includes('not') || lowerBody.includes('invalid') || lowerBody.includes('unavailable'))));
    if (modelRejected && modelSlug !== 'auto') {
      return new ProviderError(
        `Model ${modelSlug} is not available on ${PROVIDER_NAME} — pick another or use Auto.`,
        'upstream',
        { retryable: false, provider: PROVIDER_NAME }
      );
    }
    if (status >= 500) {
      return new ProviderError(
        `${PROVIDER_NAME} is having a temporary outage (HTTP ${status}). Retry in a few minutes.${excerpt ? ` Upstream said: "${excerpt}"` : ''}`,
        'upstream',
        { retryable: true, provider: PROVIDER_NAME }
      );
    }
    return new ProviderError(
      `${PROVIDER_NAME} request failed (HTTP ${status}).${excerpt ? ` Upstream said: "${excerpt}"` : ''}`,
      'upstream',
      { retryable: false, provider: PROVIDER_NAME }
    );
  }

  /** Clamp upstream chatter into one short sentence, keeping model-rejection wording crisp. */
  private humanizeUpstreamMessage(rawMessage: string, modelSlug: string): string {
    const lower = rawMessage.toLowerCase();
    if ((lower.includes('model') && (lower.includes('not found') || lower.includes('unavailable') || lower.includes('does not exist'))) && modelSlug !== 'auto') {
      return `Model ${modelSlug} is not available on ${PROVIDER_NAME} — pick another or use Auto.`;
    }
    if (lower.includes('too many requests') || lower.includes('rate limit')) {
      return `${PROVIDER_NAME} hit its rate limit. Wait about a minute and send again.`;
    }
    return `${PROVIDER_NAME}: ${truncateExcerpt(rawMessage)}`;
  }

  /**
   * Generates an image through the free ChatGPT web account by asking the assistant
   * to produce one in a conversation, waiting for the resulting image_asset_pointer,
   * and downloading the bytes. Returns null on ANY failure (never throws).
   */
  public async generateImageViaConversation(params: {
    cookieString: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<Buffer | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 150000);
    const forwardAbort = () => controller.abort();
    if (params.signal) {
      if (params.signal.aborted) controller.abort();
      else params.signal.addEventListener('abort', forwardAbort);
    }

    try {
      const tokenResult = await this.acquireToken(params.cookieString);
      if (!tokenResult.ok) {
        console.warn(`[ChatGPTWebProvider] Image generation skipped: ${tokenResult.failure.message}`);
        return null;
      }

      const fullPrompt = `Please generate an image based on the following description. Respond only with the generated image.\n\n${params.prompt}`;

      const res = await fetch('https://chatgpt.com/backend-api/conversation', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenResult.token}`,
          'Cookie': params.cookieString,
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_UA,
          'Accept': 'text/event-stream',
          'Referer': 'https://chatgpt.com/',
          'Origin': 'https://chatgpt.com',
        },
        body: JSON.stringify({
          action: 'next',
          messages: [
            {
              id: crypto.randomUUID(),
              author: { role: 'user' },
              content: { content_type: 'text', parts: [fullPrompt] },
              metadata: {},
            },
          ],
          model: 'auto',
          parent_message_id: crypto.randomUUID(),
          timezone_offset_min: -330,
          history_and_training_disabled: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) return null;

      // Consume the SSE stream until an image asset pointer shows up
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let imageUrl: string | null = null;

      while (!imageUrl) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
          let data: any;
          try {
            data = JSON.parse(trimmed.slice(6));
          } catch {
            continue;
          }
          const parts = data?.message?.content?.parts;
          if (!Array.isArray(parts)) continue;
          for (const part of parts) {
            if (part && typeof part === 'object' && part.content_type === 'image_asset_pointer') {
              const pointer = part.asset_pointer;
              if (typeof pointer === 'string' && pointer.startsWith('http')) {
                imageUrl = pointer;
                break;
              }
            }
          }
          if (imageUrl) break;
        }
      }

      if (!imageUrl) return null;

      const dl = await fetch(imageUrl, {
        headers: {
          'Cookie': params.cookieString,
          'User-Agent': BROWSER_UA,
        },
        signal: controller.signal,
      });
      if (!dl.ok) return null;

      const buf = Buffer.from(await dl.arrayBuffer());
      return buf.length > 0 ? buf : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      if (params.signal) params.signal.removeEventListener('abort', forwardAbort);
    }
  }
}

export const chatgptWebProvider = new ChatGPTWebProvider();
