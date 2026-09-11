import { ModelRouter } from './modelRouter.js';
import { resilientFetch } from './tlsFetch.js';

export interface CompletionRequest {
  prefix: string;
  suffix: string;
  languageId: string;
  filePath?: string;
}

export interface StreamingCompletionHandler {
  onDelta: (delta: string) => void;
  onDone: (fullCompletion: string) => void;
  onError: (error: Error) => void;
}

export class CompletionEngine {
  private router: ModelRouter;
  private requestCache: Map<string, { completion: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 30_000;
  private readonly MAX_CACHE_ENTRIES = 50;

  constructor(router: ModelRouter) {
    this.router = router;
  }

  private buildPrompt(req: CompletionRequest, systemStyle: boolean = false): string {
    const fileHint = req.filePath || 'untitled';
    const languageHint = req.languageId || 'plaintext';

    if (systemStyle) {
      return `<｜fim▁begin｜>You are a production-grade Fill-in-the-Middle (FIM) code completion engine.
Rules:
1. Insert code that correctly continues from PREFIX and leads smoothly into SUFFIX.
2. Match the exact coding style, indentation level, and language idioms of the surrounding context.
3. NEVER output markdown fences, explanatory comments, or conversational prose.
4. Output ONLY the raw replacement text to be spliced at the cursor.
5. Prefer short, high-signal completions (1-8 lines). If a larger block is clearly needed, provide it.
6. Preserve the cursor indentation level precisely.

FILE: ${fileHint} | LANGUAGE: ${languageHint}
<PREFIX>
${req.prefix.slice(-1600)}
</PREFIX>
<SUFFIX>
${req.suffix.slice(0, 600)}
</SUFFIX>
<COMPLETION>`;
    }

    return `You are an expert real-time code completion engine specializing in Fill-in-the-Middle (FIM) insertions.

Rules:
- Complete the code at the exact cursor position between PREFIX and SUFFIX.
- Match the existing coding style, indentation, and language patterns precisely.
- Output ONLY the replacement code to insert at the cursor. Do NOT write markdown, explanations, or quotes.
- Do NOT repeat the PREFIX or SUFFIX context.

Language: ${languageHint}
File: ${fileHint}

=== PREFIX ===
${req.prefix.slice(-1400)}
=== SUFFIX ===
${req.suffix.slice(0, 500)}
=== INSERT CODE AT CURSOR ===`;
  }

  private stripCodeFences(text: string): string {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\n?/i, '');
    cleaned = cleaned.replace(/\n?```$/i, '');
    if (cleaned.startsWith('\n')) cleaned = cleaned.slice(1);
    if (cleaned.endsWith('\n')) cleaned = cleaned.slice(0, -1);
    return cleaned;
  }

  private getCacheKey(req: CompletionRequest): string {
    const prefixTail = req.prefix.slice(-400);
    const suffixHead = req.suffix.slice(0, 150);
    return `${req.languageId}:${req.filePath || ''}:${prefixTail}:${suffixHead}`;
  }

  private getCached(key: string): string | null {
    const entry = this.requestCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.CACHE_TTL_MS) {
      this.requestCache.delete(key);
      return null;
    }
    return entry.completion;
  }

  private setCache(key: string, completion: string): void {
    if (this.requestCache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.requestCache.keys().next().value;
      if (oldestKey) this.requestCache.delete(oldestKey);
    }
    this.requestCache.set(key, { completion, timestamp: Date.now() });
  }

  public async getCompletion(req: CompletionRequest): Promise<string> {
    const cacheKey = this.getCacheKey(req);
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const errors: string[] = [];
    const chatPrompt = this.buildPrompt(req, false);

    const groqKey = this.router.getApiKey('groq');
    const deepseekKey = this.router.getApiKey('deepseek');
    const googleKey = this.router.getApiKey('google');
    const openaiKey = this.router.getApiKey('openai');
    const anthropicKey = this.router.getApiKey('anthropic');
    const openrouterKey = this.router.getApiKey('openrouter');
    const githubKey = this.router.getApiKey('github');

    const candidates: Array<{ name: string; fn: () => Promise<string> }> = [];

    if (groqKey) {
      candidates.push({
        name: 'groq-gpt-oss-20b',
        fn: () => this.openAIStyleFetch(
          'https://api.groq.com/openai/v1/chat/completions',
        groqKey,
          'openai/gpt-oss-20b',
        chatPrompt,
          0.1,
          200,
        ),
      });
      candidates.push({
        name: 'groq-qwen3.6-27b',
        fn: () => this.openAIStyleFetch(
          'https://api.groq.com/openai/v1/chat/completions',
          groqKey,
          'qwen/qwen3.6-27b',
          chatPrompt,
          0.1,
          200,
        ),
      });
    }

    if (deepseekKey) {
      candidates.push({
        name: 'deepseek-chat',
        fn: () => this.openAIStyleFetch(
          'https://api.deepseek.com/v1/chat/completions',
          deepseekKey,
          'deepseek-chat',
          chatPrompt,
          0.1,
          250,
        ),
      });
    }

    if (googleKey) {
      candidates.push({
        name: 'gemini-2.0-flash-openai',
        fn: () => this.openAIStyleFetch(
          'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
          googleKey,
          'gemini-2.0-flash',
          chatPrompt,
          0.1,
          200,
        ),
      });
    }

    if (githubKey) {
      candidates.push({
        name: 'github-models',
        fn: () => this.openAIStyleFetch(
          'https://models.inference.ai.azure.com/chat/completions',
          githubKey,
          'gpt-4o-mini',
          chatPrompt,
          0.1,
          200,
        ),
      });
    }

    if (anthropicKey) {
      candidates.push({
        name: 'anthropic-sonnet',
        fn: () => this.anthropicFetch(anthropicKey, chatPrompt, 0.1, 250),
      });
    }

    if (openaiKey) {
      candidates.push({
        name: 'openai-gpt-4o-mini',
        fn: () => this.openAIStyleFetch(
          'https://api.openai.com/v1/chat/completions',
          openaiKey,
          'gpt-4o-mini',
          chatPrompt,
          0.1,
          200,
        ),
      });
    }

    if (openrouterKey) {
      candidates.push({
        name: 'openrouter-auto',
        fn: () => this.openAIStyleFetch(
          'https://openrouter.ai/api/v1/chat/completions',
          openrouterKey,
          'deepseek/deepseek-chat',
          chatPrompt,
          0.1,
          200,
        ),
      });
    }

    try {
      const baseUrl = 'http://localhost:11434/v1';
      const ollamaPing = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
      if (ollamaPing && ollamaPing.ok) {
        candidates.push({
          name: 'ollama-local',
          fn: () => this.openAIStyleFetch(
            `${baseUrl}/chat/completions`,
            '',
            'qwen2.5-coder',
            chatPrompt,
            0.2,
            250,
          ),
        });
      }
    } catch {
      // Ollama not installed or unreachable — local candidate is simply skipped.
    }

    if (candidates.length === 0) {
      return '';
    }

    for (const cand of candidates) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        const text = await Promise.race([
          cand.fn(),
          new Promise<string>((_, rej) => {
            const t = setTimeout(() => rej(new Error('timeout')), 7000);
            controller.signal.addEventListener('abort', () => clearTimeout(t));
          }),
        ]);
        clearTimeout(timeout);
        const cleaned = this.stripCodeFences(text);
        if (cleaned.length > 0) {
          this.setCache(cacheKey, cleaned);
          return cleaned;
        }
      } catch (err: any) {
        errors.push(`${cand.name}: ${err.message || 'failed'}`);
      }
    }

    return '';
  }

  public async streamCompletion(
    req: CompletionRequest,
    handlers: StreamingCompletionHandler,
  ): Promise<void> {
    try {
      const text = await this.getCompletion(req);
      if (!text) {
        handlers.onDone('');
        return;
      }
      const chunkSize = Math.max(1, Math.floor(text.length / 8));
      for (let i = 0; i < text.length; i += chunkSize) {
        const delta = text.slice(i, i + chunkSize);
        handlers.onDelta(delta);
        await new Promise(r => setTimeout(r, 6));
      }
      handlers.onDone(text);
    } catch (err: any) {
      handlers.onError(err);
    }
  }

  private async openAIStyleFetch(
    url: string,
    apiKey: string,
    model: string,
    prompt: string,
    temperature: number,
    maxTokens: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey && apiKey.trim().length > 0) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      const res = await resilientFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      return typeof content === 'string' ? content : '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private async anthropicFetch(
    apiKey: string,
    prompt: string,
    temperature: number,
    maxTokens: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await resilientFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${res.status} ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const blocks = data.content || [];
      return blocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
    } finally {
      clearTimeout(timeout);
    }
  }
}
