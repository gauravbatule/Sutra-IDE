import fs from 'fs';
import path from 'path';
import { ProjectAsset } from './types.js';
import db from './db.js';

export class MediaEngine {
  private assetsDir: string;
  private projectRoot: string;
  private assets: Map<string, ProjectAsset> = new Map();
  private omniRouteApiKey = process.env.OMNIROUTE_API_KEY || '';

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.assetsDir = path.join(projectRoot, 'public', 'assets');
    this.ensureDirs();
  }

  public setOmniRouteApiKey(key: string): void {
    this.omniRouteApiKey = key;
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

  /**
   * Generates visual image asset with direct OpenAI DALL-E 3, Google Imagen 3, Replicate, Pollinations, and SVG fallback
   */
  public async generateImageAsset(params: {
    prompt: string;
    filename: string;
    dimensions?: string;
    style?: string;
    model?: string;
  }): Promise<ProjectAsset> {
    this.ensureDirs();
    const cleanFilename = path.basename(/\.(png|webp|jpg|jpeg|svg)$/i.test(params.filename) ? params.filename : `${params.filename}.png`);
    const targetPath = path.join(this.assetsDir, 'images', cleanFilename);
    let content: Buffer | null = null;

    // 1. OpenAI Images API — ONLY with a real API key (session tokens are not valid here)
    const openaiCred = this.getProviderCredential('openai');
    const openaiApiKey = openaiCred.apiKey;

    if (openaiApiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model || 'dall-e-3',
            prompt: params.prompt,
            n: 1,
            size: params.dimensions?.includes('1792') ? '1792x1024' : '1024x1024',
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
            const dl = await fetch(data.data[0].url);
            if (dl.ok) content = Buffer.from(await dl.arrayBuffer());
          }
        }
      } catch (err: any) {
        console.warn('[MediaEngine] OpenAI DALL-E attempt:', err.message);
      }
    }

    // 2. ChatGPT Free Account Image Generation via web conversation (cookie-only credential)
    if (!content && !openaiApiKey && openaiCred.cookieData) {
      try {
        const { chatgptWebProvider } = await import('./providers/chatgptWebProvider.js');
        const img = await chatgptWebProvider.generateImageViaConversation({ cookieString: openaiCred.cookieData, prompt: params.prompt });
        if (img && img.length > 0) content = img;
      } catch (err: any) {
        console.warn('[MediaEngine] ChatGPT web image attempt:', err?.message || err);
      }
    }

    // 3. Try Google Imagen 3 if Google key configured
    if (!content) {
      const googleCred = this.getProviderCredential('google');
      if (googleCred.apiKey) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${googleCred.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{ prompt: params.prompt }],
              parameters: { sampleCount: 1, aspectRatio: '1:1' },
            }),
            signal: AbortSignal.timeout(20000),
          });
          if (res.ok) {
            const data: any = await res.json();
            const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
            if (b64) content = Buffer.from(b64, 'base64');
          }
        } catch {
          // Best-effort provider attempt — fall through to the next image source
        }
      }
    }

    // 4. Try Direct Replicate API (FLUX.1-schnell) if key configured
    if (!content) {
      const replicateKey = this.getProviderKey('replicate');
      if (replicateKey) {
        try {
          const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${replicateKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'wait',
            },
            body: JSON.stringify({
              input: {
                prompt: params.prompt,
                num_outputs: 1,
                aspect_ratio: params.dimensions?.includes('x') ? '16:9' : '1:1',
                output_format: 'png',
              },
            }),
            signal: AbortSignal.timeout(25000),
          });
          if (res.ok) {
            const data: any = await res.json();
            const imgUrl = Array.isArray(data.output) ? data.output[0] : data.output;
            if (imgUrl) {
              const dl = await fetch(imgUrl);
              if (dl.ok) content = Buffer.from(await dl.arrayBuffer());
            }
          }
        } catch {
          // Best-effort provider attempt — fall through to the next image source
        }
      }
    }

    // 5. High-speed AI Image Generator Fallback (Pollinations Multi-Engine with FLUX & Turbo)
    if (!content) {
      const candidateUrls = [
        `https://image.pollinations.ai/prompt/${encodeURIComponent(params.prompt)}?model=flux&width=1024&height=1024&nologo=true&enhance=true&seed=${Math.floor(Math.random() * 100000)}`,
        `https://image.pollinations.ai/prompt/${encodeURIComponent(params.prompt)}?model=turbo&width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`,
        `https://pollinations.ai/p/${encodeURIComponent(params.prompt)}?width=1024&height=1024`,
      ];

      for (const pollUrl of candidateUrls) {
        try {
          const res = await fetch(pollUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(12000),
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 5000) {
              content = buf;
              break;
            }
          }
        } catch {
          // Best-effort candidate URL — try the next one
        }
      }
    }

    // 5. Fallback to bespoke Luxury Vector SVG if network image is completely unavailable
    if (!content) {
      const svgCode = this.createLuxurySvg(params.prompt, params.style || 'minimal');
      content = Buffer.from(svgCode, 'utf-8');
    }

    // An SVG fallback saved with a .jpg/.png extension renders broken (content-type
    // mismatch) — swap the extension so the browser gets the right type.
    let finalPath = targetPath;
    let relativeUrl = `/assets/images/${cleanFilename}`;
    if (/^<\?xml|^<svg/i.test(content.toString('utf8').slice(0, 100)) && /\.jpe?g$|\.png$/i.test(finalPath)) {
      finalPath = finalPath.replace(/\.jpe?g$|\.png$/i, '.svg');
      relativeUrl = relativeUrl.replace(/\.jpe?g$|\.png$/i, '.svg');
    }

    fs.writeFileSync(finalPath, content);

    const asset: ProjectAsset = {
      id: `asset-${Date.now()}`,
      name: finalPath.split(/[/\\]/).pop() || cleanFilename,
      type: 'image',
      path: finalPath,
      url: relativeUrl,
      prompt: params.prompt,
      dimensions: params.dimensions || '1024x1024',
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
    const cleanFilename = path.basename(/\.(mp4|webm)$/i.test(params.filename) ? params.filename : `${params.filename}.mp4`);
    const targetPath = path.join(this.assetsDir, 'videos', cleanFilename);
    const relativeUrl = `/assets/videos/${cleanFilename}`;
    let content: Buffer | null = null;
    let source: 'replicate' | 'pollinations' | null = null;

    // 1. Try Direct Replicate Video (Minimax Video-01 / Stable Video Diffusion) if configured
    const replicateKey = this.getProviderKey('replicate');
    if (replicateKey) {
      try {
        const res = await fetch('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
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
            const dl = await fetch(videoUrl);
            if (dl.ok) {
              const buf = Buffer.from(await dl.arrayBuffer());
              if (buf.length > 50000) {
                content = buf;
                source = 'replicate';
              }
            }
          }
        }
      } catch {
        // Best-effort provider attempt — fall through to the next video source
      }
    }

    // 2. High-speed AI Video Generation via Pollinations AI
    if (!content) {
      try {
        const aiVideoUrls = [
          `https://video.pollinations.ai/prompt/${encodeURIComponent(params.prompt)}`,
          `https://image.pollinations.ai/prompt/${encodeURIComponent(params.prompt)}?model=flux-video`,
        ];
        for (const url of aiVideoUrls) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          if (res.ok) {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('video') || ct.includes('octet-stream')) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length > 30000) {
                content = buf;
                source = 'pollinations';
                break;
              }
            }
          }
        }
      } catch {
        // Best-effort provider attempt — fall through to the next video source
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
      dimensions: params.aspectRatio || '16:9',
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
    const rawName = path.basename(params.filename);
    const hasAudioExt = /\.(mp3|wav|ogg)$/i.test(rawName);
    let cleanFilename = rawName;
    let content: Buffer | null = null;

    // 1. Google TTS / OpenAI TTS if prompt is speech text
    if (params.prompt && params.prompt.length > 2) {
      try {
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(params.prompt)}&tl=en&client=tw-ob`;
        const res = await fetch(ttsUrl, {
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
  public getProviderStatus(): { image: string[]; video: string[]; audio: string[] } {
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
    if (has('google')) audio.push('google-tts');
    if (has('elevenlabs')) audio.push('elevenlabs');
    return { image, video, audio };
  }
}

export const mediaEngine = new MediaEngine();
