import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelRouter } from '../../server/modelRouter.js';
import type { SutraModel } from '../../server/types.js';

describe('Omnicraft IDE — Strict Model Pinning & Transparent Error Surfacing', () => {
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

  it('strictly invokes ONLY the pinned model and halts on 401 Unauthorized without fallback', async () => {
    router.setApiKey('anthropic', 'sk-ant-test-key');

    const calledUrls: string[] = [];
    const calledBodies: any[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      if (url.includes('anthropic.com')) {
        calledUrls.push(url);
        calledBodies.push(JSON.parse(init.body || '{}'));
        return new Response(JSON.stringify({ error: { message: 'Invalid x-api-key provided.' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const pinnedModel: SutraModel = {
      id: 'claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsTools: true,
      costPer1kTokens: { input: 0.003, output: 0.015 },
      description: 'Pinned model test',
    };

    const stream = router.streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      model: pinnedModel,
    });

    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // 1. Only Anthropic endpoint was invoked (no fallback to other providers)
    expect(calledUrls.length).toBeGreaterThanOrEqual(1);
    expect(calledUrls.every((u) => u.includes('anthropic.com'))).toBe(true);

    // 2. Exactly claude-3-5-sonnet-20241022 was requested in the body
    expect(calledBodies[0].model).toBe('claude-3-5-sonnet-20241022');

    // 3. Exact 401 error was surfaced to the user with execution stopped notice
    const errorChunk = chunks.find((c) => c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error).toContain('Anthropic');
    expect(errorChunk.error).toContain('HTTP 401');
    expect(errorChunk.error).toContain('Invalid x-api-key');
    expect(errorChunk.error).toContain('Execution stopped because this model was explicitly selected');
  }, 15000);

  it('strictly invokes ONLY the pinned model and halts on 404 Model Not Found without silent fallback', async () => {
    router.setApiKey('groq', 'gsk-test-groq-key');

    const calledModels: string[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      if (url.includes('groq.com') || url.includes('chat/completions')) {
        const parsed = JSON.parse(init.body || '{}');
        calledModels.push(parsed.model);
        return new Response(JSON.stringify({ error: { message: 'The model `custom-qwen-test` does not exist or you do not have access to it.', code: 'model_not_found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const pinnedModel: SutraModel = {
      id: 'custom-qwen-test',
      name: 'Custom Qwen Test',
      provider: 'groq',
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: true,
      costPer1kTokens: { input: 0, output: 0 },
      description: 'Pinned test',
    };

    const stream = router.streamChat({
      messages: [{ role: 'user', content: 'test code' }],
      model: pinnedModel,
    });

    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Only custom-qwen-test was called
    expect(calledModels.every((m) => m === 'custom-qwen-test')).toBe(true);

    const errorChunk = chunks.find((c) => c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error).toContain('Groq');
    expect(errorChunk.error).toContain('HTTP 404');
    expect(errorChunk.error).toContain('Execution stopped because this model was explicitly selected');
  }, 15000);

  it('surfaces HTTP 429 rate limit with exact provider details when rate limit is exceeded on pinned model', async () => {
    router.setApiKey('openai', 'sk-test-openai-key');

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('openai.com') || url.includes('chat/completions')) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached for requests (TPM limit 30000). Please try again in 45s.' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const pinnedModel: SutraModel = {
      id: 'gpt-4o',
      name: 'GPT 4o',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsTools: true,
      costPer1kTokens: { input: 0.0025, output: 0.01 },
      description: 'Flagship model',
    };

    const stream = router.streamChat({
      messages: [{ role: 'user', content: 'run query' }],
      model: pinnedModel,
    });

    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error).toContain('OpenAI');
    expect(errorChunk.error).toContain('429');
    expect(errorChunk.error).toContain('TPM limit');
    expect(errorChunk.error).toContain('Execution stopped because this model was explicitly selected');
  }, 15000);
});
