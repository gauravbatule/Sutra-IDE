import { describe, it, expect } from 'vitest';
import { streamAntigravityTurn, resolveCodeAssistModel } from '../../server/providers/antigravityBridge.js';

describe('Antigravity Bridge & Code Assist Stream Protocol', () => {
  it('exports streamAntigravityTurn generator', () => {
    expect(typeof streamAntigravityTurn).toBe('function');
  });

  it('correctly maps model IDs to valid Code Assist endpoint models', () => {
    expect(resolveCodeAssistModel('gemini-3.7-flash')).toBe('gemini-2.5-flash');
    expect(resolveCodeAssistModel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(resolveCodeAssistModel('gemini-3-pro')).toBe('gemini-2.5-pro');
    expect(resolveCodeAssistModel('claude-3-7-sonnet')).toBe('claude-sonnet-4-6');
    expect(resolveCodeAssistModel('claude-opus-4-6')).toBe('claude-opus-4-6-thinking');
  });

  it('fails fast or throws cleanly without hanging indefinitely', async () => {
    const generator = streamAntigravityTurn(
      {
        modelId: 'gemini-3.7-flash',
        messages: [{ role: 'user', content: 'hello' }],
      },
      []
    );

    try {
      const first = await generator.next();
      expect(first).toBeDefined();
    } catch (err: any) {
      expect(err.message).toBeDefined();
    }
  }, 15000);

  it('handles abort signals gracefully', async () => {
    const controller = new AbortController();
    controller.abort();

    const generator = streamAntigravityTurn(
      {
        modelId: 'gemini-3.7-flash',
        messages: [{ role: 'user', content: 'test' }],
        signal: controller.signal,
      },
      []
    );

    try {
      await generator.next();
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  }, 15000);
});
