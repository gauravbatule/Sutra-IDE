import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ProjectAsset } from './types.js';
import db from './db.js';
import { resilientFetch } from './tlsFetch.js';
import {
  SAMPLE_RATE,
  decodeWavPcm,
  encodeWav,
  isSfxCategory,
  normalizePeak,
  overlayVocalWithDucking,
  renderMusic,
  renderSfx,
  resampleLinear,
  softClip,
} from './media/audioSynth.js';

export interface MediaSettings {
  imageProvider: string;
  imageAspectRatio: string;
  imageStyle: string;
  videoProvider: string;
  audioVoice: string;
  audioSfxEngine: string;
}

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  imageProvider: 'auto',
  imageAspectRatio: '1:1',
  imageStyle: 'photo',
  videoProvider: 'auto',
  audioVoice: 'alloy',
  audioSfxEngine: 'procedural',
};

export class MediaEngine {
  private assetsDir: string;
  private projectRoot: string;
  private assets: Map<string, ProjectAsset> = new Map();
  private gatewayApiKey = process.env.GATEWAY_API_KEY || '';

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.assetsDir = path.join(projectRoot, 'public', 'assets');
    this.ensureDirs();
  }

  public setGatewayApiKey(key: string): void {
    this.gatewayApiKey = key;
  }

  public setProjectRoot(root: string): void {
    this.projectRoot = root;
    this.assetsDir = path.join(root, 'public', 'assets');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    try {
      const dirs = [
        this.assetsDir,
        path.join(this.assetsDir, 'images'),
        path.join(this.assetsDir, 'svgs'),
        path.join(this.assetsDir, 'audio'),
        path.join(this.assetsDir, 'videos'),
      ];
      for (const d of dirs) {
        if (!fs.existsSync(d)) {
          fs.mkdirSync(d, { recursive: true });
        }
      }
    } catch {
      // ignore
    }
  }

  private getProviderCredential(providerId: string): { apiKey?: string; cookieData?: string; baseUrl?: string; authType?: string } {
    try {
      const row = db.prepare('SELECT api_key, cookie_data, base_url, auth_type FROM providers WHERE id = ?').get(providerId) as any;
      if (row) {
        return {
          apiKey: row.api_key?.trim() || undefined,
          cookieData: row.cookie_data?.trim() || undefined,
          baseUrl: row.base_url?.trim() || undefined,
          authType: row.auth_type || 'api-key',
        };
      }
    } catch {
      // DB lookup is best-effort — fall back to env-based credentials below
    }
    const envKey = process.env[`${providerId.toUpperCase()}_API_KEY`];
    return { apiKey: envKey?.trim() || undefined };
  }

  private getProviderKey(providerId: string): string | null {
    return this.getProviderCredential(providerId).apiKey || null;
  }

  public getMediaSettings(): MediaSettings {
    const settings: MediaSettings = { ...DEFAULT_MEDIA_SETTINGS };
    try {
      const rows = db.prepare("SELECT key, value FROM system_config WHERE key LIKE 'media_%'").all() as Array<{ key: string; value: string }>;
      for (const r of rows) {
        if (r.key === 'media_imageProvider' && r.value) settings.imageProvider = r.value;
        else if (r.key === 'media_imageAspectRatio' && r.value) settings.imageAspectRatio = r.value;
        else if (r.key === 'media_imageStyle' && r.value) settings.imageStyle = r.value;
        else if (r.key === 'media_videoProvider' && r.value) settings.videoProvider = r.value;
        else if (r.key === 'media_audioVoice' && r.value) settings.audioVoice = r.value;
        else if (r.key === 'media_audioSfxEngine' && r.value) settings.audioSfxEngine = r.value;
      }
    } catch {
      // DB lookup is best-effort — defaults used if query fails
    }
    return settings;
  }

  public updateMediaSettings(settings: Partial<MediaSettings>): MediaSettings {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)');
      const entries: [string, string][] = [];
      if (settings.imageProvider !== undefined) entries.push(['media_imageProvider', String(settings.imageProvider)]);
      if (settings.imageAspectRatio !== undefined) entries.push(['media_imageAspectRatio', String(settings.imageAspectRatio)]);
      if (settings.imageStyle !== undefined) entries.push(['media_imageStyle', String(settings.imageStyle)]);
      if (settings.videoProvider !== undefined) entries.push(['media_videoProvider', String(settings.videoProvider)]);
      if (settings.audioVoice !== undefined) entries.push(['media_audioVoice', String(settings.audioVoice)]);
      if (settings.audioSfxEngine !== undefined) entries.push(['media_audioSfxEngine', String(settings.audioSfxEngine)]);

      const tx = db.transaction((items: [string, string][]) => {
        for (const [k, v] of items) {
          stmt.run(k, v);
        }
      });
      if (entries.length > 0) {
        tx(entries);
      }
    } catch (err: any) {
      console.warn('[MediaEngine] updateMediaSettings failed:', err?.message || err);
    }
    return this.getMediaSettings();
  }

  /**
   * Generates visual image asset with direct OpenAI DALL-E 3, Google Imagen 3, Replicate, Pollinations, and SVG fallback
   */
  public async generateImageAsset(params: {
    prompt: string;
    filename: string;
    dimensions?: string;
    style?: string;
    model?: string;
    provider?: string;
  }): Promise<ProjectAsset> {
    this.ensureDirs();
    const defaults = this.getMediaSettings();
    const cleanFilename = path.basename(/\.(png|webp|jpg|jpeg|svg)$/i.test(params.filename) ? params.filename : `${params.filename}.png`);
    const targetPath = path.join(this.assetsDir, 'images', cleanFilename);
    let content: Buffer | null = null;
    const requestedProvider = (params.provider || defaults.imageProvider || 'auto').toLowerCase().trim();
    const effectiveStyle = params.style || defaults.imageStyle || 'photo';

    let effectiveDimensions = params.dimensions;
    if (!effectiveDimensions) {
      const ar = (defaults.imageAspectRatio || '1:1').toLowerCase();
      if (ar === '16:9') effectiveDimensions = '1792x1024';
      else if (ar === '9:16') effectiveDimensions = '1024x1792';
      else if (ar === '4:3') effectiveDimensions = '1024x768';
      else if (ar === '3:2') effectiveDimensions = '1200x800';
      else effectiveDimensions = '1024x1024';
    }

    let enrichedPrompt = params.prompt;
    if (effectiveStyle && effectiveStyle !== 'photo' && !enrichedPrompt.toLowerCase().includes(effectiveStyle)) {
      enrichedPrompt = `${params.prompt}, ${effectiveStyle} style`;
    }

    // Provider Tier 1: ChatGPT Web Session (when requested or when session cookie is active)
    const openaiCred = this.getProviderCredential('openai');
    const chatgptCookie = this.getProviderCredential('chatgpt-web').cookieData || openaiCred.cookieData;

    if ((requestedProvider === 'chatgpt' || requestedProvider === 'chatgpt-web' || requestedProvider === 'auto') && chatgptCookie) {
      try {
        const { chatgptWebProvider } = await import('./providers/chatgptWebProvider.js');
        const img = await chatgptWebProvider.generateImageViaConversation({ cookieString: chatgptCookie, prompt: enrichedPrompt });
        if (img && img.length > 0) content = img;
      } catch (err: any) {
        console.warn('[MediaEngine] ChatGPT web image attempt:', err?.message || err);
      }
    }

    // Provider Tier 2: OpenAI DALL-E 3 API (with real API key)
    const openaiApiKey = openaiCred.apiKey;
    if (!content && (requestedProvider === 'dalle3' || requestedProvider === 'openai' || requestedProvider === 'auto') && openaiApiKey) {
      try {
        const isLandscape = effectiveDimensions.includes('1792') || effectiveDimensions.includes('16:9');
        const isPortrait = effectiveDimensions.includes('1024x1792') || effectiveDimensions.includes('9:16');
        const dalleSize = isLandscape ? '1792x1024' : isPortrait ? '1024x1792' : '1024x1024';

        const res = await resilientFetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model || 'dall-e-3',
            prompt: enrichedPrompt,
            n: 1,
            size: dalleSize,
            response_format: 'b64_json',
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const data: any = await res.json();
          const b64 = data?.data?.[0]?.b64_json;
          if (b64) {
            content = Buffer.from(b64, 'base64');
          } else if (data?.data?.[0]?.url) {
            const dl = await resilientFetch(data.data[0].url);
            if (dl.ok) content = Buffer.from(await dl.arrayBuffer());
          }
        }
      } catch (err: any) {
        console.warn('[MediaEngine] OpenAI DALL-E attempt:', err.message);
      }
    }

    // Provider Tier 3: Google Imagen 3 (with Google API key)
    const googleCred = this.getProviderCredential('google');
    if (!content && (requestedProvider === 'imagen3' || requestedProvider === 'gemini' || requestedProvider === 'google' || requestedProvider === 'auto') && googleCred.apiKey) {
      try {
        let imagenAr = '1:1';
        if (effectiveDimensions.includes('1792') || defaults.imageAspectRatio === '16:9') imagenAr = '16:9';
        else if (effectiveDimensions.includes('1024x1792') || defaults.imageAspectRatio === '9:16') imagenAr = '9:16';
        else if (effectiveDimensions.includes('768') || defaults.imageAspectRatio === '4:3') imagenAr = '4:3';

        const res = await resilientFetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${googleCred.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: enrichedPrompt }],
            parameters: { sampleCount: 1, aspectRatio: imagenAr },
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
          const data: any = await res.json();
          const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
          if (b64) content = Buffer.from(b64, 'base64');
        }
      } catch {
        // Best-effort provider attempt
      }
    }

    // Provider Tier 4: Replicate API (FLUX.1 Schnell / SDXL)
    const replicateKey = this.getProviderKey('replicate');
    if (!content && (requestedProvider === 'replicate' || requestedProvider === 'flux' || requestedProvider === 'auto') && replicateKey) {
      try {
        let replicateAr = '1:1';
        if (effectiveDimensions.includes('1792') || defaults.imageAspectRatio === '16:9') replicateAr = '16:9';
        else if (effectiveDimensions.includes('1024x1792') || defaults.imageAspectRatio === '9:16') replicateAr = '9:16';
        else if (effectiveDimensions.includes('768') || defaults.imageAspectRatio === '4:3') replicateAr = '4:3';

        const res = await resilientFetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${replicateKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'wait',
          },
          body: JSON.stringify({
            input: {
              prompt: enrichedPrompt,
              num_outputs: 1,
              aspect_ratio: replicateAr,
              output_format: 'png',
            },
          }),
          signal: AbortSignal.timeout(25000),
        });
        if (res.ok) {
          const data: any = await res.json();
          const imgUrl = Array.isArray(data.output) ? data.output[0] : data.output;
          if (imgUrl) {
            const dl = await resilientFetch(imgUrl);
            if (dl.ok) content = Buffer.from(await dl.arrayBuffer());
          }
        }
      } catch {
        // Best-effort provider attempt
      }
    }

    // Provider Tier 5: High-Speed Instant AI Image Engine (Pollinations FLUX & Turbo Multi-Engine)
    if (!content) {
      let [dimW, dimH] = [1024, 1024];
      if (effectiveDimensions.includes('x')) {
        const parts = effectiveDimensions.split('x').map((p) => parseInt(p, 10));
        if (!isNaN(parts[0]) && !isNaN(parts[1])) {
          dimW = parts[0];
          dimH = parts[1];
        }
      }

      const candidateUrls = [
        `https://image.pollinations.ai/prompt/${encodeURIComponent(enrichedPrompt)}?model=flux&width=${dimW}&height=${dimH}&nologo=true&enhance=true&seed=${Math.floor(Math.random() * 100000)}`,
        `https://image.pollinations.ai/prompt/${encodeURIComponent(enrichedPrompt)}?model=turbo&width=${dimW}&height=${dimH}&nologo=true&seed=${Math.floor(Math.random() * 100000)}`,
        `https://pollinations.ai/p/${encodeURIComponent(enrichedPrompt)}?width=${dimW}&height=${dimH}`,
      ];

      for (const pollUrl of candidateUrls) {
        try {
          const res = await resilientFetch(pollUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(18000),
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 5000) {
              content = buf;
              break;
            }
          }
        } catch {
          // Try next candidate
        }
      }
    }

    // 5. Fallback to bespoke Luxury Vector SVG if network image is completely unavailable
    if (!content) {
      const svgCode = this.createLuxurySvg(params.prompt, effectiveStyle);
      content = Buffer.from(svgCode, 'utf-8');
    }

    // An SVG fallback saved with a .jpg/.png extension renders broken (content-type
    // mismatch) — swap the extension so the browser gets the right type. The same
    // applies to JPEG bytes from the ChatGPT cookie path landing on a .png name.
    let finalPath = targetPath;
    let relativeUrl = `/assets/images/${cleanFilename}`;
    if (/^<\?xml|^<svg/i.test(content.toString('utf8').slice(0, 100)) && /\.jpe?g$|\.png$/i.test(finalPath)) {
      finalPath = finalPath.replace(/\.jpe?g$|\.png$/i, '.svg');
      relativeUrl = relativeUrl.replace(/\.jpe?g$|\.png$/i, '.svg');
    } else if (content.length > 4 && content[0] === 0xff && content[1] === 0xd8 && !/\.jpe?g$/i.test(finalPath)) {
      finalPath = finalPath.replace(/\.(png|webp)$/i, '.jpg');
      relativeUrl = relativeUrl.replace(/\.(png|webp)$/i, '.jpg');
    }

    fs.writeFileSync(finalPath, content);

    const asset: ProjectAsset = {
      id: `asset-${Date.now()}`,
      name: finalPath.split(/[/\\]/).pop() || cleanFilename,
      type: 'image',
      path: finalPath,
      url: relativeUrl,
      prompt: params.prompt,
      dimensions: effectiveDimensions,
      sizeBytes: content.byteLength,
      createdAt: Date.now(),
    };

    this.assets.set(asset.id, asset);
    return asset;
  }

  /**
   * Generates bespoke Vector SVG graphic asset
   */
  public async generateSvgAsset(params: {
    prompt?: string;
    filename?: string;
    name?: string;
    category?: string;
    description?: string;
    style?: string;
  }): Promise<ProjectAsset> {
    this.ensureDirs();
    const rawName = params.filename || params.name || `asset-${Date.now()}`;
    const cleanFilename = path.basename(/\.svg$/i.test(rawName) ? rawName : `${rawName}.svg`);
    const targetPath = path.join(this.assetsDir, 'svgs', cleanFilename);
    const relativeUrl = `/assets/svgs/${cleanFilename}`;
    const promptText = params.prompt || params.description || params.name || 'Minimalist Vector';
    const svgCode = this.createLuxurySvg(promptText, params.style || 'minimal');
    const content = Buffer.from(svgCode, 'utf-8');
    fs.writeFileSync(targetPath, content);

    const asset: ProjectAsset = {
      id: `svg-${Date.now()}`,
      name: cleanFilename,
      type: 'svg',
      path: targetPath,
      url: relativeUrl,
      prompt: promptText,
      dimensions: '1024x1024',
      sizeBytes: content.byteLength,
      createdAt: Date.now(),
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  /**
   * Generates a video asset via real providers only (Replicate Minimax when configured,
   * then Pollinations). When every provider fails or none is configured, returns
   * { error: 'Video generation is unavailable with the current providers.' } — the caller
   * must ask the user for a real video file instead of inserting any placeholder or
   * sample clip. metadata.source records what actually produced the bytes.
   */
  public async generateVideoAsset(params: {
    prompt: string;
    filename: string;
    model?: string;
    durationSeconds?: number;
    aspectRatio?: string;
    motion?: string;
  }): Promise<ProjectAsset | { error: string }> {
    this.ensureDirs();
    const defaults = this.getMediaSettings();
    const cleanFilename = path.basename(/\.(mp4|webm)$/i.test(params.filename) ? params.filename : `${params.filename}.mp4`);
    const targetPath = path.join(this.assetsDir, 'videos', cleanFilename);
    const relativeUrl = `/assets/videos/${cleanFilename}`;
    let content: Buffer | null = null;
    let source: 'replicate' | 'pollinations' | null = null;
    const requestedProvider = (defaults.videoProvider || 'auto').toLowerCase().trim();
    const effectiveAspectRatio = params.aspectRatio || (defaults.imageAspectRatio === '9:16' ? '9:16' : '16:9');

    const tryReplicate = async (): Promise<Buffer | null> => {
      const replicateKey = this.getProviderKey('replicate');
      if (!replicateKey) return null;
      try {
        const replicateModel = params.model?.includes('luma') ? 'luma/ray-2' :
          params.model?.includes('kling') ? 'kuaishou/kling-v1.5' :
          params.model?.includes('runway') ? 'runway/gen-3-alpha' :
          'minimax/video-01';
        const res = await resilientFetch(`https://api.replicate.com/v1/models/${replicateModel}/predictions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${replicateKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'wait',
          },
          body: JSON.stringify({
            input: {
              prompt: params.prompt,
              prompt_optimizer: true,
            },
          }),
        });
        if (res.ok) {
          const data: any = await res.json();
          const videoUrl = data.output;
          if (videoUrl) {
            const dl = await resilientFetch(videoUrl);
            if (dl.ok) {
              const buf = Buffer.from(await dl.arrayBuffer());
              if (buf.length > 50000) {
                return buf;
              }
            }
          }
        }
      } catch {
        // Best-effort provider attempt
      }
      return null;
    };

    const tryPollinations = async (): Promise<Buffer | null> => {
      try {
        const aiVideoUrls = [
          `https://video.pollinations.ai/prompt/${encodeURIComponent(params.prompt)}`,
          `https://image.pollinations.ai/prompt/${encodeURIComponent(params.prompt)}?model=flux-video`,
        ];
        for (const url of aiVideoUrls) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const res = await resilientFetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          if (res.ok) {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('video') || ct.includes('octet-stream')) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length > 30000) {
                return buf;
              }
            }
          }
        }
      } catch {
        // Best-effort provider attempt
      }
      return null;
    };

    // Execute provider order based on user settings
    if (requestedProvider === 'pollinations') {
      const polBuf = await tryPollinations();
      if (polBuf) {
        content = polBuf;
        source = 'pollinations';
      } else {
        const repBuf = await tryReplicate();
        if (repBuf) {
          content = repBuf;
          source = 'replicate';
        }
      }
    } else {
      const repBuf = await tryReplicate();
      if (repBuf) {
        content = repBuf;
        source = 'replicate';
      } else {
        const polBuf = await tryPollinations();
        if (polBuf) {
          content = polBuf;
          source = 'pollinations';
        }
      }
    }

    // 3. Every real provider failed or none is configured — report honestly rather
    //    than writing an unrelated placeholder clip to disk.
    if (!content || !source) {
      return {
        error: 'Video generation is unavailable with the current providers.',
      };
    }

    fs.writeFileSync(targetPath, content);

    const sourceNotices: Record<string, string> = {
      replicate: 'Generated via Replicate Minimax AI Video',
      pollinations: 'Generated via Pollinations AI Video',
    };

    const asset: ProjectAsset = {
      id: `video-${Date.now()}`,
      name: cleanFilename,
      type: 'video',
      path: targetPath,
      url: relativeUrl,
      prompt: params.prompt,
      dimensions: effectiveAspectRatio,
      sizeBytes: content.byteLength,
      createdAt: Date.now(),
      metadata: {
        source,
        notice: sourceNotices[source] || 'Video generated.',
      },
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  /**
   * Generates custom tactile UI Audio cues with Multi-Tier Fallback:
   * Level 1: Google TTS / OpenAI TTS API (MP3)
   * Level 2: Procedural 44.1kHz PCM Synthesizer (Instant tactile SFX, WAV)
   * The saved filename always uses the extension matching the actual audio container.
   */
  public async generateAudioAsset(params: {
    type: 'click' | 'chime' | 'success' | 'notification' | 'ambient';
    prompt?: string;
    filename: string;
    model?: string;
    voice?: string;
  }): Promise<ProjectAsset> {
    this.ensureDirs();
    const defaults = this.getMediaSettings();
    const rawName = path.basename(params.filename);
    const hasAudioExt = /\.(mp3|wav|ogg)$/i.test(rawName);
    let cleanFilename = rawName;
    let content: Buffer | null = null;
    const effectiveVoice = params.voice || defaults.audioVoice || 'alloy';

    // 1. OpenAI TTS / Google TTS if prompt is speech text
    if (params.prompt && params.prompt.length > 2) {
      const openaiKey = this.getProviderKey('openai');
      if (openaiKey) {
        try {
          const res = await resilientFetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: params.model?.includes('tts') ? params.model : 'tts-1',
              input: params.prompt,
              voice: effectiveVoice,
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            content = Buffer.from(await res.arrayBuffer());
          }
        } catch {
          // Fall through to Google TTS
        }
      }
      if (!content) {
        try {
          const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(params.prompt)}&tl=en&client=tw-ob`;
          const res = await resilientFetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            content = Buffer.from(await res.arrayBuffer());
          }
        } catch {
          // TTS is best-effort — procedural synthesizer below always produces audio
        }
      }
    }

    // 2. Fallback: Procedural 44.1kHz PCM Synthesizer (Instant crisp tactile UI SFX)
    if (!content) {
      content = this.synthesizeProceduralAudio(params.type);
    }

    // Detect the actual container so the extension matches the encoded bytes
    // (Google TTS returns MP3 data even though a .wav name was previously assumed)
    if (!hasAudioExt && content) {
      cleanFilename = `${rawName}.${this.detectAudioContainer(content)}`;
    }

    const targetPath = path.join(this.assetsDir, 'audio', cleanFilename);
    const relativeUrl = `/assets/audio/${cleanFilename}`;

    fs.writeFileSync(targetPath, content);

    const asset: ProjectAsset = {
      id: `audio-${Date.now()}`,
      name: cleanFilename,
      type: 'audio',
      path: targetPath,
      url: relativeUrl,
      prompt: params.prompt || params.type,
      sizeBytes: content.byteLength,
      createdAt: Date.now(),
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  /**
   * Generates a distinct short non-musical SOUND EFFECT (UI cues, ambience,
   * impacts, foley). This capability is separate from music (instrumental
   * tracks) and songs (vocals over music).
   *
   * Provenance: fully procedural local DSP synthesis (server/media/audioSynth)
   * — offline-first, deterministic per prompt, no external model involved.
   */
  public async generateSfxAsset(params: {
    prompt: string;
    filename?: string;
    category?: string;
    durationSec?: number;
  }): Promise<ProjectAsset> {
    this.ensureDirs();
    const promptText = String(params.prompt || '').trim();
    if (!promptText) {
      throw new Error('generate_sound_effect requires a prompt describing the sound.');
    }
    const category = params.category && isSfxCategory(params.category) ? params.category : undefined;
    const result = renderSfx(promptText, {
      durationSec: typeof params.durationSec === 'number' ? params.durationSec : undefined,
      category,
    });

    const rawName = path.basename(params.filename || `sfx-${Date.now()}`).replace(/\.(wav|mp3|ogg)$/i, '');
    const cleanFilename = `${rawName || `sfx-${Date.now()}`}.wav`;
    const targetPath = path.join(this.assetsDir, 'audio', cleanFilename);
    const relativeUrl = `/assets/audio/${cleanFilename}`;
    const content = encodeWav(result.samples, result.sampleRate);
    fs.writeFileSync(targetPath, content);

    const asset: ProjectAsset = {
      id: `audio-sfx-${Date.now()}`,
      name: cleanFilename,
      type: 'audio',
      path: targetPath,
      url: relativeUrl,
      prompt: promptText,
      sizeBytes: content.byteLength,
      createdAt: Date.now(),
      metadata: {
        capability: 'sound-effect',
        source: 'procedural-synth',
        category: result.category,
        notice: 'Synthesized locally with the built-in DSP engine. No external model involved.',
      },
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  /**
   * Generates an instrumental MUSIC track (background score, loop, theme).
   * Distinct from sound effects (short, non-musical) and songs (vocal-led).
   *
   * Provenance: chord pads, bass, arpeggio, lead melody, and percussion are
   * scheduled on a bar grid by the local synthesizer (server/media/audioSynth)
   * — offline-first with no network dependency. When opts.loop is set, the
   * length snaps to whole bars so the WAV loops seamlessly.
   */
  public async generateMusicAsset(params: {
    prompt?: string;
    filename?: string;
    durationSec?: number;
    bpm?: number;
    mood?: string;
    loop?: boolean;
  }): Promise<ProjectAsset> {
    this.ensureDirs();
    const result = renderMusic({
      prompt: params.prompt,
      durationSec: params.durationSec,
      bpm: params.bpm,
      mood: params.mood,
      loop: params.loop,
    });

    const rawName = path.basename(params.filename || `music-${Date.now()}`).replace(/\.(wav|mp3|ogg)$/i, '');
    const cleanFilename = `${rawName || `music-${Date.now()}`}.wav`;
    const targetPath = path.join(this.assetsDir, 'audio', cleanFilename);
    const relativeUrl = `/assets/audio/${cleanFilename}`;
    const content = encodeWav(result.samples, result.sampleRate);
    fs.writeFileSync(targetPath, content);

    const asset: ProjectAsset = {
      id: `audio-music-${Date.now()}`,
      name: cleanFilename,
      type: 'audio',
      path: targetPath,
      url: relativeUrl,
      prompt: params.prompt || params.mood || 'instrumental',
      dimensions: `${Math.round(result.samples.length / result.sampleRate)}s`,
      sizeBytes: content.byteLength,
      createdAt: Date.now(),
      metadata: {
        capability: 'music-instrumental',
        source: 'procedural-synth',
        bpm: result.meta.bpm,
        mood: result.meta.mood,
        scale: result.meta.scale,
        bars: result.meta.bars,
        loopSafe: result.meta.loopSafe,
        notice: 'Instrumental track synthesized locally from a chord/bass/lead/percussion grid. No vocals, no external model.',
      },
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  /**
   * Generates a SONG: a vocal layer carrying lyrics over an instrumental bed.
   *
   * Honest provenance of every layer:
   * - Instrumental bed: procedurally synthesized locally (no model involved).
   * - Vocals: rendered by a text-to-speech service narrating the provided
   *   lyrics (OpenAI TTS when configured, otherwise the keyless Google
   *   translate_tts endpoint). There is NO singing-voice model in this build,
   *   so the vocal layer is spoken narration timed over the bed, not a
   *   trained vocal performance.
   * - Mixing: done locally in PCM. If a system ffmpeg binary exists, Google's
   *   MP3 response can be decoded and mixed into one WAV; without ffmpeg the
   *   instrumental bed and the raw vocal MP3 are saved as separate stems so
   *   nothing is silently dropped.
   */
  public async generateSongAsset(params: {
    lyrics: string;
    stylePrompt?: string;
    filename?: string;
    mood?: string;
    bpm?: number;
  }): Promise<ProjectAsset> {
    this.ensureDirs();
    const lyricsText = String(params.lyrics || '').trim();
    if (!lyricsText) {
      throw new Error('generate_song requires non-empty lyrics.');
    }
    const stylePrompt = String(params.stylePrompt || '').trim();

    // Vocal first: its real duration sizes the instrumental bed.
    const vocal = await this.acquireVocalPcm(lyricsText);

    // ~14 chars/sec is a calm narration pace; clamp to keep memory bounded.
    const charCount = lyricsText.replace(/\s+/g, ' ').length;
    const estimatedVocalSec = Math.max(10, Math.min(150, charCount / 14 + 2));
    const vocalSec = vocal && vocal.kind === 'pcm'
      ? Math.max(4, vocal.pcm.length / vocal.sampleRate)
      : estimatedVocalSec;

    const bed = renderMusic({
      prompt: `${stylePrompt} ${lyricsText}`.slice(0, 200),
      mood: params.mood || stylePrompt || undefined,
      bpm: params.bpm,
      durationSec: vocalSec + 1.5,
      loop: false,
    });

    const stemBase = path.basename(params.filename || `song-${Date.now()}`)
      .replace(/\.(wav|mp3|ogg)$/i, '')
      .replace(/[\\/:*?"<>|]/g, '_') || `song-${Date.now()}`;

    if (vocal && vocal.kind === 'pcm') {
      // Single mixed master: duck the bed under the vocal span.
      const mixed = bed.samples.slice();
      overlayVocalWithDucking(mixed, resampleLinear(vocal.pcm, vocal.sampleRate, SAMPLE_RATE), {
        sampleRate: SAMPLE_RATE,
        startSample: Math.floor(0.75 * SAMPLE_RATE),
        vocalGain: 0.95,
        duckedBedGain: 0.45,
      });
      normalizePeak(mixed, 0.9);
      softClip(mixed);
      return this.persistAudioAsset(`${stemBase}.wav`, encodeWav(mixed, SAMPLE_RATE), {
        id: `audio-song-${Date.now()}`,
        prompt: stylePrompt || lyricsText.slice(0, 80),
        metadata: {
          capability: 'song',
          source: `procedural-synth bed + ${vocal.source} vocals`,
          notice: `Instrumental bed synthesized locally; vocals are ${vocal.source} text-to-speech narration of the provided lyrics (not a singing-voice model). Mixed locally with bed ducking.`,
        },
      });
    }

    if (vocal && vocal.kind === 'mp3') {
      // TTS succeeded but its MP3 cannot be decoded locally (no system ffmpeg):
      // save both stems instead of pretending they were mixed.
      const bedAsset = this.persistAudioAsset(`${stemBase}-instrumental.wav`, encodeWav(bed.samples, bed.sampleRate), {
        id: `audio-song-bed-${Date.now()}`,
        prompt: stylePrompt || lyricsText.slice(0, 80),
        metadata: {
          capability: 'song-stem-instrumental',
          source: 'procedural-synth',
          notice: 'Instrumental stem of the song. The vocal stem was saved separately because no local MP3 decoder (ffmpeg) was available to mix them.',
        },
      });
      this.persistAudioAsset(`${stemBase}-vocals.mp3`, vocal.data, {
        id: `audio-song-vocals-${Date.now()}`,
        prompt: lyricsText.slice(0, 80),
        metadata: {
          capability: 'song-stem-vocals',
          source: vocal.source,
          notice: `Vocal stem (${vocal.source} narration of the lyrics). Play together with "${bedAsset.name}" — mixing requires a system ffmpeg binary.`,
        },
      });
      // Link the two stems explicitly for the UI.
      bedAsset.metadata = { ...bedAsset.metadata, stems: true, vocalTrackUrl: `/assets/audio/${stemBase}-vocals.mp3` };
      return bedAsset;
    }

    // No vocal source reachable at all: deliver the instrumental bed honestly.
    return this.persistAudioAsset(`${stemBase}-instrumental.wav`, encodeWav(bed.samples, bed.sampleRate), {
      id: `audio-song-bed-${Date.now()}`,
      prompt: stylePrompt || lyricsText.slice(0, 80),
      metadata: {
        capability: 'song-instrumental-only',
        source: 'procedural-synth',
        notice: 'Only the instrumental bed could be generated: no text-to-speech provider was reachable, so no vocal layer exists in this file.',
      },
    });
  }

  /** Writes an audio buffer into the assets pipeline and registers the ProjectAsset. */
  private persistAudioAsset(
    filename: string,
    content: Buffer,
    extra: { id: string; prompt: string; metadata: Record<string, any> },
  ): ProjectAsset {
    fs.mkdirSync(path.join(this.assetsDir, 'audio'), { recursive: true });
    const targetPath = path.join(this.assetsDir, 'audio', filename);
    const relativeUrl = `/assets/audio/${filename}`;
    fs.writeFileSync(targetPath, content);
    const asset: ProjectAsset = {
      id: extra.id,
      name: filename,
      type: 'audio',
      path: targetPath,
      url: relativeUrl,
      prompt: extra.prompt,
      sizeBytes: content.byteLength,
      createdAt: Date.now(),
      metadata: extra.metadata,
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  private ffmpegAvailability?: boolean;

  /** Probes once for a system ffmpeg binary and caches the verdict. */
  private async hasFfmpeg(): Promise<boolean> {
    if (this.ffmpegAvailability !== undefined) return this.ffmpegAvailability;
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' });
        proc.on('error', reject);
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
      });
      this.ffmpegAvailability = true;
    } catch {
      this.ffmpegAvailability = false;
    }
    return this.ffmpegAvailability;
  }

  /**
   * Decodes compressed audio to mono float PCM via the system ffmpeg binary
   * piped over stdin/stdout. Used only as a local transcoder for audio that
   * a TTS provider already produced. Returns null when ffmpeg is missing.
   */
  private async decodeWithFfmpeg(audio: Buffer): Promise<{ samples: Float32Array; sampleRate: number } | null> {
    if (!(await this.hasFfmpeg())) return null;
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(
          'ffmpeg',
          ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1'],
          { windowsHide: true },
        );
      } catch {
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.resume(); // drain stderr so a chatty build never deadlocks the pipe
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code !== 0 || chunks.length === 0) {
          resolve(null);
          return;
        }
        const raw = Buffer.concat(chunks);
        const frameCount = Math.floor(raw.length / 2);
        const samples = new Float32Array(frameCount);
        for (let i = 0; i < frameCount; i++) samples[i] = raw.readInt16LE(i * 2) / 32768;
        resolve({ samples, sampleRate: SAMPLE_RATE });
      });
      child.stdin.on('error', () => {
        // EPIPE if ffmpeg exits early — the close handler resolves null.
      });
      child.stdin.end(audio);
    });
  }

  /**
   * Vocal acquisition ladder for songs:
   * 1. OpenAI TTS API when an API key exists — requested as WAV so it decodes locally.
   * 2. Keyless Google translate_tts, chunked under its ~200-char request cap; MP3
   *    frames are concatenated (decoders handle sequential frames). Decoding needs
   *    system ffmpeg; when absent, the raw MP3 is returned as a stem instead.
   *
   * Both sources are speech models narrating lyrics — NOT singing voices.
   */
  private async acquireVocalPcm(lyricsText: string): Promise<
    | { kind: 'pcm'; pcm: Float32Array; sampleRate: number; source: string }
    | { kind: 'mp3'; data: Buffer; source: string }
    | null
  > {
    const openaiKey = this.getProviderCredential('openai').apiKey;
    if (openaiKey) {
      try {
        const res = await resilientFetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            voice: 'nova',
            input: lyricsText.slice(0, 4000),
            response_format: 'wav',
          }),
          signal: AbortSignal.timeout(60000),
        });
        if (res.ok) {
          const wavBuf = Buffer.from(await res.arrayBuffer());
          const decoded = decodeWavPcm(wavBuf);
          if (decoded) {
            return {
              kind: 'pcm',
              pcm: resampleLinear(decoded.samples, decoded.sampleRate, SAMPLE_RATE),
              sampleRate: SAMPLE_RATE,
              source: 'OpenAI TTS',
            };
          }
        }
      } catch {
        // Fall through to the keyless provider below
      }
    }

    try {
      const lines = lyricsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const chunks: string[] = [];
      let current = '';
      for (const line of lines) {
        const merged = current ? `${current} ${line}` : line;
        if (merged.length <= 180) {
          current = merged;
        } else {
          if (current) chunks.push(current);
          current = line.slice(0, 180);
        }
      }
      if (current) chunks.push(current);
      if (chunks.length === 0) return null;

      const parts: Buffer[] = [];
      for (const chunk of chunks) {
        try {
          const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=en&client=tw-ob`;
          const res = await resilientFetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) parts.push(Buffer.from(await res.arrayBuffer()));
        } catch {
          // Individual chunk failures tolerated — partial vocals still usable
        }
        if (chunks.length > 1) {
          await new Promise((r) => setTimeout(r, 150)); // pace requests to the free endpoint
        }
      }
      if (parts.length === 0) return null;

      const mp3 = Buffer.concat(parts); // concatenated MP3 frames play as one stream
      const decoded = await this.decodeWithFfmpeg(mp3);
      if (decoded) {
        return {
          kind: 'pcm',
          pcm: resampleLinear(decoded.samples, decoded.sampleRate, SAMPLE_RATE),
          sampleRate: SAMPLE_RATE,
          source: 'Google TTS',
        };
      }
      return { kind: 'mp3', data: mp3, source: 'Google TTS' };
    } catch {
      return null;
    }
  }

  /**
   * Detects the audio container (mp3 or wav) from magic bytes so filenames match the payload.
   * Defaults to mp3, which is what the TTS endpoint serves when headers are ambiguous.
   */
  private detectAudioContainer(buf: Buffer): 'mp3' | 'wav' {
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
      return 'wav';
    }
    if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') {
      return 'mp3';
    }
    if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
      return 'mp3';
    }
    return 'mp3';
  }

  /**
   * Synthesizes 44.1kHz 16-bit Mono WAV audio buffer procedurally
   */
  private synthesizeProceduralAudio(type: 'click' | 'chime' | 'success' | 'notification' | 'ambient'): Buffer {
    const sampleRate = 44100;
    let durationSec = 0.15;
    let freqStart = 800;
    let freqEnd = 400;

    switch (type) {
      case 'click':
        durationSec = 0.05;
        freqStart = 1200;
        freqEnd = 200;
        break;
      case 'chime':
        durationSec = 0.4;
        freqStart = 587.33; // D5
        freqEnd = 880;     // A5
        break;
      case 'success':
        durationSec = 0.5;
        freqStart = 523.25; // C5
        freqEnd = 1046.5;  // C6
        break;
      case 'notification':
        durationSec = 0.3;
        freqStart = 440;
        freqEnd = 659.25;
        break;
      case 'ambient':
        durationSec = 1.0;
        freqStart = 220;
        freqEnd = 220;
        break;
    }

    const totalSamples = Math.floor(sampleRate * durationSec);
    const dataSize = totalSamples * 2; // 16-bit = 2 bytes per sample
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF WAV Header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
    buffer.writeUInt16LE(1, 22);  // NumChannels (1 = Mono)
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
    buffer.writeUInt16LE(2, 32);  // BlockAlign
    buffer.writeUInt16LE(16, 34); // BitsPerSample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Generate Audio Samples
    let phase = 0;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / totalSamples;
      const currentFreq = freqStart + (freqEnd - freqStart) * t;
      const decay = Math.exp(-4 * t);
      phase += (2 * Math.PI * currentFreq) / sampleRate;

      const sample = Math.sin(phase) * decay * 0.7;
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      buffer.writeInt16LE(intSample, 44 + i * 2);
    }

    return buffer;
  }

  private createLuxurySvg(prompt: string, _style: string): string {
    const cleanPrompt = prompt.replace(/[<>&"]/g, '').slice(0, 40);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#09090b" />
      <stop offset="100%" stop-color="#18181b" />
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#27272a" />
      <stop offset="50%" stop-color="#52525b" />
      <stop offset="100%" stop-color="#27272a" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
  <rect x="64" y="64" width="896" height="896" rx="24" fill="none" stroke="#27272a" stroke-width="2" />
  <circle cx="512" cy="440" r="140" fill="none" stroke="url(#glow)" stroke-width="4" stroke-dasharray="12 12" />
  <text x="512" y="450" fill="#f4f4f5" font-size="22" font-family="JetBrains Mono, monospace" text-anchor="middle" font-weight="600">
    ${cleanPrompt}
  </text>
  <text x="512" y="490" fill="#71717a" font-size="14" font-family="sans-serif" text-anchor="middle">
    Generated with SUTRA Luxury Engine
  </text>
</svg>`;
  }

  public getAllAssets(): ProjectAsset[] {
    return Array.from(this.assets.values());
  }

  /** Which generation ladders have at least one ready provider, by ability. */
  public getProviderStatus(): {
    image: string[];
    video: string[];
    audio: string[];
    sfx: string[];
    music: string[];
    song: string[];
  } {
    const has = (id: string): boolean => {
      const cred = this.getProviderKey(id);
      return Boolean(cred && cred.trim().length > 0);
    };
    const image: string[] = [];
    if (has('openai')) image.push('openai-dalle');
    if (has('google')) image.push('google-imagen');
    if (has('replicate')) image.push('replicate-flux');
    image.push('pollinations (free, no key)');
    const video: string[] = [];
    if (has('replicate')) video.push('replicate-minimax');
    video.push('pollinations (free, no key)');
    const audio: string[] = [];
    if (has('openai')) audio.push('openai-tts');
    audio.push('google-tts (free, no key)');
    if (has('elevenlabs')) audio.push('elevenlabs');
    // The three distinct generation capabilities added alongside speech:
    const sfx = ['procedural-synth (offline, always available)'];
    const music = ['procedural-synth (offline, always available)'];
    const song: string[] = ['procedural-synth instrumental bed'];
    if (has('openai')) song.push('openai-tts vocals');
    song.push('google-tts vocals (free, no key)');
    return { image, video, audio, sfx, music, song };
  }
}

export const mediaEngine = new MediaEngine();
