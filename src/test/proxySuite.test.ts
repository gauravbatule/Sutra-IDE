import { describe, it, expect } from 'vitest';
import { imageProxy } from '../../server/proxy/imageProxy.js';
import { browserBridge } from '../../server/proxy/browserBridge.js';

describe('OpenAI-Compatible Universal Proxy Suite', () => {
  it('generates high-resolution images via imageProxy fallback engine', async () => {
    const res = await imageProxy.generateImage({
      prompt: 'A glowing cybernetic tree in neon purple and gold',
      size: '1024x1024',
      n: 1,
    });

    expect(res).toBeDefined();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].url).toContain('https://image.pollinations.ai/prompt/');
    expect(res.data[0].url).toContain('flux');
  });

  it('supports image edit requests through imageProxy', async () => {
    const res = await imageProxy.editImage({
      prompt: 'Add falling cherry blossom petals',
      size: '1024x1024',
      n: 1,
    });

    expect(res).toBeDefined();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].url).toBeDefined();
  });

  it('reports browser bridge availability status gracefully', async () => {
    const available = await browserBridge.isBrowserAvailable();
    expect(typeof available).toBe('boolean');
  });
});
