import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeCookieCredential, isValidCookieFormat } from '../../server/providers/authHandler.js';
import { ModelRouter } from '../../server/modelRouter.js';

describe('ChatGPT Web Cookie Routing & Auth Isolation', () => {
  let router: ModelRouter;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    router = new ModelRouter();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('normalizes raw session tokens into cookie strings', () => {
    const rawToken = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..sample';
    const normalized = normalizeCookieCredential('chatgpt-web', rawToken);
    expect(normalized).toContain('__Secure-next-auth.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..sample');
  });

  it('preserves full cookie header strings', () => {
    const header = '__Secure-next-auth.session-token=abc123xyz; cf_clearance=def456';
    const normalized = normalizeCookieCredential('chatgpt-web', header);
    expect(normalized).toBe(header);
  });

  it('validates recognized cookie formats correctly', () => {
    expect(isValidCookieFormat('chatgpt-web', '__Secure-next-auth.session-token=123')).toBe(true);
    expect(isValidCookieFormat('chatgpt-web', 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..long_token_string')).toBe(true);
    expect(isValidCookieFormat('chatgpt-web', 'short')).toBe(false);
  });

  it('resolves built-in chatgpt-web models by compound and short identifiers', () => {
    const autoDef = router.resolveModelDefinition('chatgpt-web/auto');
    expect(autoDef).toBeDefined();
    expect(autoDef?.provider).toBe('chatgpt-web');

    const gpt4oDef = router.resolveModelDefinition('chatgpt-web/gpt-4o');
    expect(gpt4oDef).toBeDefined();
    expect(gpt4oDef?.provider).toBe('chatgpt-web');

    const lunaDef = router.resolveModelDefinition('luna', 'chatgpt-web');
    expect(lunaDef).toBeDefined();
    expect(lunaDef?.provider).toBe('chatgpt-web');
  });

  it('strictly attempts ONLY ChatGPT Web and yields error without fallback when cookie is expired', async () => {
    // Mock fetch to simulate 401 session expiration from chatgpt.com
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('chatgpt.com')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const chatgptModel = router.resolveModelDefinition('chatgpt-web/gpt-4o')!;
    expect(chatgptModel).toBeDefined();

    const stream = router.streamChat({
      messages: [{ role: 'user', content: 'hello chatgpt' }],
      model: chatgptModel,
    });

    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error).toMatch(/ChatGPT Web/i);
    expect(errorChunk.error).toMatch(/cookie|session|Settings/i);
  }, 15000);
});

