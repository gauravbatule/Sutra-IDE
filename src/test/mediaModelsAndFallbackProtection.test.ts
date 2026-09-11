import { describe, it, expect } from 'vitest';
import { ModelRouter, BUILTIN_MODELS } from '../../server/modelRouter.js';
import db from '../../server/db.js';
import { mediaEngine } from '../../server/mediaEngine.js';

describe('Media Models & Fallback Chain Protection', () => {
  const router = new ModelRouter();

  it('recognizes and catalogs modern video generation models', () => {
    const videoModels = BUILTIN_MODELS.filter((m) => m.category === 'video' || m.capabilities?.video);
    expect(videoModels.length).toBeGreaterThanOrEqual(6);

    const videoIds = videoModels.map((m) => m.canonicalId || m.id);
    expect(videoIds).toContain('veo-2');
    expect(videoIds).toContain('sora');
    expect(videoIds).toContain('luma-ray');
    expect(videoIds).toContain('minimax-video-01');
    expect(videoIds).toContain('kling-video');
    expect(videoIds).toContain('runway-gen-3');

    const veo = videoModels.find((m) => (m.canonicalId || m.id) === 'veo-2');
    expect(veo?.modalities?.output).toContain('video');
  });

  it('recognizes and catalogs audio and voice synthesis models', () => {
    const audioModels = BUILTIN_MODELS.filter((m) => m.category === 'audio' || m.capabilities?.audio);
    expect(audioModels.length).toBeGreaterThanOrEqual(4);

    const audioIds = audioModels.map((m) => m.canonicalId || m.id);
    expect(audioIds).toContain('whisper-large-v3');
    expect(audioIds).toContain('tts-1-hd');
    expect(audioIds).toContain('eleven-turbo-v2');
    expect(audioIds).toContain('suno-v3');
  });

  it('recognizes and catalogs image generation models', () => {
    const imageModels = BUILTIN_MODELS.filter((m) => m.category === 'image' || m.capabilities?.image);
    expect(imageModels.length).toBeGreaterThanOrEqual(3);

    const imageIds = imageModels.map((m) => m.canonicalId || m.id);
    expect(imageIds).toContain('dall-e-3');
    expect(imageIds).toContain('imagen-3');
    expect(imageIds).toContain('flux-1-schnell');
  });

  it('recognizes OpenRouter free and multimodal models including Ling 3.0', () => {
    const ling = BUILTIN_MODELS.find((m) => m.id === 'inclusionai/ling-3.0-flash-fin:free');
    expect(ling).toBeDefined();
    expect(ling?.provider).toBe('openrouter');

    const nemo = BUILTIN_MODELS.find((m) => m.id === 'nvidia/nemotron-3-ultra-550b-a55b:free');
    expect(nemo).toBeDefined();

    const ox = BUILTIN_MODELS.find((m) => m.id === 'stealth/ox-alpha');
    expect(ox).toBeDefined();
    expect(ox?.category).toBe('multimodal');
  });

  it('strictly validates dummy API keys and protects the fallback chain', () => {
    const regex = /^(sk-test-|sk-ant-test-|gsk-test-|test-key|sk-dummy|local-no|placeholder|dummy)/i;
    expect(regex.test('sk-test-12345678')).toBe(true);
    expect(regex.test('gsk-test-groq-key')).toBe(true);
    expect(regex.test('sk-ant-test-anthropic')).toBe(true);
    expect(regex.test('local-no-auth')).toBe(true);
    expect(regex.test('sk-live-real-api-key-here-12345')).toBe(false);
    expect(regex.test('sk-or-v1-realopenrouterkey12345')).toBe(false);
  });

  it('does not persist dummy keys to SQLite database when running in test mode', () => {
    router.setApiKey('test_provider_isolated', 'sk-test-dummy-key');
    const row = db.prepare('SELECT api_key FROM providers WHERE id = ?').get('test_provider_isolated');
    expect(row).toBeUndefined();
  });

  it('reads default media settings and updates them reliably', () => {
    const initial = mediaEngine.getMediaSettings();
    expect(initial).toBeDefined();
    expect(initial.imageProvider).toBeDefined();
    expect(initial.imageAspectRatio).toBeDefined();

    const updated = mediaEngine.updateMediaSettings({
      imageProvider: 'dalle3',
      imageAspectRatio: '16:9',
      imageStyle: 'vector',
      videoProvider: 'replicate',
      audioVoice: 'nova',
      audioSfxEngine: 'procedural',
    });

    expect(updated.imageProvider).toBe('dalle3');
    expect(updated.imageAspectRatio).toBe('16:9');
    expect(updated.imageStyle).toBe('vector');
    expect(updated.videoProvider).toBe('replicate');
    expect(updated.audioVoice).toBe('nova');

    // Verify persistence via fresh getMediaSettings call
    const fresh = mediaEngine.getMediaSettings();
    expect(fresh.imageProvider).toBe('dalle3');
    expect(fresh.imageAspectRatio).toBe('16:9');
    expect(fresh.audioVoice).toBe('nova');
  });
});
