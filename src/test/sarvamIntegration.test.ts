import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelRouter, BUILTIN_MODELS } from '../../server/modelRouter.js';
import { SUTRA_ALL_PROVIDERS } from '../../server/providers/catalog.js';
import type { SutraModel } from '../../server/types.js';

describe('SUTRA IDE — Sarvam AI Integration & Streaming Hardening', () => {
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

  it('registers Sarvam AI in provider catalog and built-in models', () => {
    const sarvamCatalog = SUTRA_ALL_PROVIDERS.find((p) => p.id === 'sarvam');
    expect(sarvamCatalog).toBeDefined();
    expect(sarvamCatalog?.name).toBe('Sarvam AI');
    expect(sarvamCatalog?.defaultBaseUrl).toBe('https://api.sarvam.ai/v1');
    expect(sarvamCatalog?.models).toContain('sarvam-105b');

    const sarvamModels = BUILTIN_MODELS.filter((m) => m.provider === 'sarvam');
    expect(sarvamModels.length).toBeGreaterThanOrEqual(3);
    expect(sarvamModels.some((m) => m.id === 'sarvam-105b')).toBe(true);
    expect(sarvamModels.some((m) => m.id === 'sarvam-m')).toBe(true);
    expect(sarvamModels.some((m) => m.id === 'sarvam-2b')).toBe(true);
  });

  it('transmits api-subscription-key and sanitized Authorization headers on chat completion requests', async () => {
    router.setApiKey('sarvam', '  "test-sarvam-key-123"  ');

    let interceptedHeaders: Record<string, string> = {};
    let interceptedBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      if (url.includes('sarvam') || url.includes('chat/completions')) {
        interceptedHeaders = init.headers || {};
        interceptedBody = JSON.parse(init.body || '{}');

        // Return simulated SSE stream
        const ssePayload = [
          'data: {"id":"chat-1","choices":[{"delta":{"content":"Namaste, "}}]}\n\n',
          'data: {"id":"chat-1","choices":[{"delta":{"content":"world!"}}]}\n\n',
          'data: [DONE]\n\n',
        ].join('');

        return new Response(ssePayload, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const sarvamModel: SutraModel = {
      id: 'sarvam-105b',
      name: 'Sarvam 105B',
      provider: 'sarvam',
      contextWindow: 32768,
      supportsVision: false,
      supportsTools: true,
      description: 'Sarvam 105B model',
    };

    const stream = router.streamChat({
      messages: [{ role: 'user', content: 'Say hello in Indic style' }],
      model: sarvamModel,
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.delta) fullText += chunk.delta;
    }

    expect(interceptedHeaders['Authorization']).toBe('Bearer test-sarvam-key-123');
    expect(interceptedHeaders['api-subscription-key']).toBe('test-sarvam-key-123');
    expect(interceptedBody.model).toBe('sarvam-105b');
    expect(fullText).toBe('Namaste, world!');
  });

  it('seamlessly consumes non-streaming JSON responses without SSE transport errors', async () => {
    router.setApiKey('sarvam', 'test-sarvam-key-456');

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('sarvam') || url.includes('chat/completions')) {
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-non-stream',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Response delivered via non-streaming JSON payload.',
                },
                finish_reason: 'stop',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const sarvamModel: SutraModel = {
      id: 'sarvam-m',
      name: 'Sarvam-M',
      provider: 'sarvam',
      contextWindow: 32768,
      supportsVision: false,
      supportsTools: true,
      description: 'Sarvam-M model',
    };

    const stream = router.streamChat({
      messages: [{ role: 'user', content: 'Calculate Fibonacci' }],
      model: sarvamModel,
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.delta) fullText += chunk.delta;
    }

    expect(fullText).toContain('Response delivered via non-streaming JSON payload.');
  });

  it('includes api-subscription-key when validating credentials in testProviderConnection', async () => {
    router.setApiKey('sarvam', 'sarvam-secret-token');
    let checkedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      if (url.includes('sarvam')) {
        checkedHeaders = init.headers || {};
        return new Response(JSON.stringify({ data: [{ id: 'sarvam-105b' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await router.testProviderConnection('sarvam');

    expect(checkedHeaders['api-subscription-key']).toBe('sarvam-secret-token');
    expect(checkedHeaders['Authorization']).toBe('Bearer sarvam-secret-token');
    expect(result.ok).toBe(true);
  });
});
