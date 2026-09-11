/**
 * Offline procedural audio synthesis for SUTRA media generation.
 *
 * Everything in this module is synthesized locally in pure TypeScript:
 * no external AI models, no network calls, no npm dependencies.
 * Sound effects, instrumental music beds, and mixing utilities are
 * deterministic DSP constructions (oscillators, noise, RBJ biquad
 * filters, envelopes) rendered to 44.1 kHz float buffers and encoded
 * as 16-bit PCM WAV.
 *
 * Honesty note: these are algorithmic approximations, not neural audio
 * generation. Vocal layers for songs are produced separately by
 * MediaEngine via text-to-speech providers; this module never fakes a
 * singing voice.
 */

export const SAMPLE_RATE = 44100;

export type WaveShape = 'sine' | 'square' | 'saw' | 'triangle' | 'noise';

/** Deterministic PRNG (mulberry32) so identical prompts reproduce identically. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash used to seed the PRNG from a prompt. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TWO_PI = Math.PI * 2;

/** Encodes mono float samples (-1..1) as a 16-bit PCM RIFF/WAVE buffer. */
export function encodeWav(samples: Float32Array, sampleRate: number = SAMPLE_RATE): Buffer {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

/**
 * Parses a 16-bit PCM WAV buffer into mono float samples at its native rate.
 * Handles arbitrary chunk layouts by walking the RIFF chunk list rather than
 * assuming a fixed 44-byte header. Returns null for non-WAV or non-PCM data.
 */
export function decodeWavPcm(buf: Buffer): { samples: Float32Array; sampleRate: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let sampleRate = SAMPLE_RATE;
  let channels = 1;
  let bitsPerSample = 16;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ' && offset + 8 + 16 <= buf.length) {
      channels = Math.max(1, buf.readUInt16LE(offset + 10));
      sampleRate = buf.readUInt32LE(offset + 12) || SAMPLE_RATE;
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      const bytesPerSample = bitsPerSample / 8;
      const frameCount = Math.floor(chunkSize / (bytesPerSample * channels));
      const out = new Float32Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) {
          const pos = offset + 8 + (i * channels + c) * bytesPerSample;
          if (pos + bytesPerSample > buf.length) break;
          acc += bitsPerSample === 16 ? buf.readInt16LE(pos) / 32768 : buf.readUInt8(pos) / 128 - 1;
        }
        out[i] = acc / channels;
      }
      return { samples: out, sampleRate };
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

/** Linear-interpolation resampler (adequate for speech over a music bed). */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.min(samples.length - 1, Math.floor(src));
    const frac = src - i0;
    const a = samples[i0];
    const b = samples[Math.min(samples.length - 1, i0 + 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function rbjLowpass(sampleRate: number, cutoffHz: number, q = 0.707): BiquadCoefs {
  const w0 = (TWO_PI * Math.min(cutoffHz, sampleRate / 2 - 100)) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cosW0) / 2) / a0,
    b1: (1 - cosW0) / a0,
    b2: ((1 - cosW0) / 2) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function rbjHighpass(sampleRate: number, cutoffHz: number, q = 0.707): BiquadCoefs {
  const w0 = (TWO_PI * Math.min(cutoffHz, sampleRate / 2 - 100)) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cosW0) / 2) / a0,
    b1: (-(1 + cosW0)) / a0,
    b2: ((1 + cosW0) / 2) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function rbjBandpass(sampleRate: number, centerHz: number, q = 1.5): BiquadCoefs {
  const w0 = (TWO_PI * Math.min(centerHz, sampleRate / 2 - 100)) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: (-alpha) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** In-place direct-form-1 biquad filter pass. */
export function applyBiquad(samples: Float32Array, c: BiquadCoefs): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    samples[i] = y0;
  }
}

export interface ToneSpec {
  freq: number;
  startSec: number;
  durSec: number;
  amp?: number;
  wave?: WaveShape;
  attackSec?: number;
  releaseSec?: number;
  /** Exponential pitch glide target frequency across the tone duration. */
  glideEndFreq?: number;
  vibratoHz?: number;
  vibratoCents?: number;
  /** Deterministic noise source for the 'noise' wave shape. */
  rng?: () => number;
}

/** Renders one oscillator tone with an attack/release envelope into the buffer (additive). */
export function addTone(buf: Float32Array, sampleRate: number, spec: ToneSpec, rng?: () => number): void {
  const wave = spec.wave || 'sine';
  const noiseSource = spec.rng || rng;
  const amp = spec.amp ?? 0.5;
  const total = Math.max(1, Math.floor(spec.durSec * sampleRate));
  const startIdx = Math.floor(spec.startSec * sampleRate);
  const attackN = Math.min(total, Math.floor(Math.max(0, spec.attackSec ?? 0.008) * sampleRate));
  const releaseN = Math.min(total, Math.floor(Math.max(0, spec.releaseSec ?? 0.04) * sampleRate));
  const vibOmega = spec.vibratoHz ? (TWO_PI * spec.vibratoHz) / sampleRate : 0;
  const vibDepth = spec.vibratoCents || 0;
  let phase = 0;

  for (let i = 0; i < total; i++) {
    const idx = startIdx + i;
    if (idx >= buf.length) break;
    const t = i / total;
    const freq = spec.glideEndFreq
      ? spec.freq * Math.pow(spec.glideEndFreq / spec.freq, t)
      : spec.freq;
    const vib = vibOmega > 0 && vibDepth > 0 ? Math.pow(2, (Math.sin(vibOmega * i) * vibDepth) / 1200) : 1;
    phase += (TWO_PI * freq * vib) / sampleRate;
    const cyclePos = (phase / TWO_PI) % 1;
    let s: number;
    switch (wave) {
      case 'square':
        s = Math.sin(phase) >= 0 ? 1 : -1;
        break;
      case 'saw':
        s = 2 * cyclePos - 1;
        break;
      case 'triangle':
        s = 2 * Math.abs(2 * cyclePos - 1) - 1;
        break;
      case 'noise':
        s = (noiseSource ? noiseSource() : Math.random()) * 2 - 1;
        break;
      default:
        s = Math.sin(phase);
    }
    let env = 1;
    if (i < attackN) env = i / attackN;
    else if (i >= total - releaseN) env = Math.max(0, (total - i) / releaseN);
    buf[idx] += s * amp * env;
  }
}

/** Scales the buffer so its peak absolute value reaches the target (max 1). */
export function normalizePeak(samples: Float32Array, target = 0.85): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-6) return;
  const gain = Math.min(4, target / peak);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

/** Gentle tanh soft clip to keep summed material free of hard digital clipping. */
export function softClip(samples: Float32Array): void {
  const knee = Math.tanh(1.2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.tanh(samples[i] * 1.2) / knee;
  }
}

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------

export type SfxCategory =
  | 'explosion'
  | 'laser'
  | 'whoosh'
  | 'rain'
  | 'thunder'
  | 'footsteps'
  | 'heartbeat'
  | 'alarm'
  | 'coin'
  | 'shatter'
  | 'water'
  | 'wind'
  | 'glitch'
  | 'bird'
  | 'engine'
  | 'pop';

const SFX_KEYWORDS: Array<[RegExp, SfxCategory]> = [
  [/explo(sion|de)|boom\b|blast|impact|crash|punch|hit|gunshot/i, 'explosion'],
  [/laser|zap\b|blaster|beam|photon|ray gun/i, 'laser'],
  [/whoosh|swish|swoosh|fly.?by|transition|air.?dash/i, 'whoosh'],
  [/rain|drizzle|downpour|rainfall/i, 'rain'],
  [/thunder|rumble\b/i, 'thunder'],
  [/footstep|\bsteps\b|walking|boot step|pacing/i, 'footsteps'],
  [/heart\s?beat|heartbeat|pulse\b/i, 'heartbeat'],
  [/alarm|siren|beep(ing)?|alert|warning|emergency|timer/i, 'alarm'],
  [/coin|pickup|collect|points?|reward|level.?up|achievement|power.?up/i, 'coin'],
  [/glass|shatter|breaking|smash|crystal|porcelain/i, 'shatter'],
  [/water|drip|droplet|bubble|splash|liquid|stream/i, 'water'],
  [/wind|breeze|gust|blowing air|desert air/i, 'wind'],
  [/glitch|static|corrupt|digital noise|interference/i, 'glitch'],
  [/\bbird|chirp|tweet|sparrow|songbird/i, 'bird'],
  [/engine|motor|machine hum|drone\b|vehicle|idling/i, 'engine'],
  [/pop|click|tap\b|\bui\b|button|toggle|notification|switch/i, 'pop'],
];

/** Picks an SFX family from free-text prompt keywords; defaults to a UI pop. */
export function classifySfx(prompt: string): SfxCategory {
  for (const [re, cat] of SFX_KEYWORDS) {
    if (re.test(prompt)) return cat;
  }
  return 'pop';
}

export interface SfxRenderResult {
  samples: Float32Array;
  sampleRate: number;
  category: SfxCategory;
}

/** Type guard allowing callers to force an explicit SFX family. */
export function isSfxCategory(value: unknown): value is SfxCategory {
  return typeof value === 'string' && SFX_KEYWORDS.some(([, cat]) => cat === value);
}

function brownNoise(len: number, rng: () => number): Float32Array {
  const out = new Float32Array(len);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = rng() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/** Renders a short non-musical sound effect matched to the prompt keywords. */
export function renderSfx(prompt: string, opts?: { durationSec?: number; seed?: number; category?: SfxCategory }): SfxRenderResult {
  const sampleRate = SAMPLE_RATE;
  const category = opts?.category && isSfxCategory(opts.category) ? opts.category : classifySfx(prompt);
  const seed = opts?.seed ?? hashSeed(`${category}:${prompt}`);
  const rng = createRng(seed);
  const dur = Math.max(0.05, Math.min(10, opts?.durationSec ?? defaultSfxDuration(category)));
  const n = Math.floor(dur * sampleRate);
  const buf = new Float32Array(n);
  renderSfxBody(buf, sampleRate, category, dur, rng);
  normalizePeak(buf, 0.85);
  return { samples: buf, sampleRate, category };
}

function defaultSfxDuration(category: SfxCategory): number {
  switch (category) {
    case 'explosion': return 1.2;
    case 'laser': return 0.35;
    case 'whoosh': return 0.9;
    case 'rain': return 3;
    case 'thunder': return 2.5;
    case 'footsteps': return 1.4;
    case 'heartbeat': return 1.1;
    case 'alarm': return 1.2;
    case 'coin': return 0.45;
    case 'shatter': return 0.9;
    case 'water': return 0.7;
    case 'wind': return 3;
    case 'glitch': return 0.8;
    case 'bird': return 1;
    case 'engine': return 2;
    default: return 0.18;
  }
}

function renderSfxBody(
  buf: Float32Array,
  sampleRate: number,
  category: SfxCategory,
  dur: number,
  rng: () => number,
): void {
  switch (category) {
    case 'explosion': {
      const noise = brownNoise(buf.length, rng);
      buf.set(noise.subarray(0, buf.length));
      applyBiquad(buf, rbjLowpass(sampleRate, 500, 0.6));
      applyBiquad(buf, rbjHighpass(sampleRate, 35, 0.5));
      for (let i = 0; i < buf.length; i++) {
        const t = i / sampleRate;
        buf[i] *= Math.exp(-3.2 * t);
      }
      addTone(buf, sampleRate, { freq: 90, glideEndFreq: 38, startSec: 0, durSec: 0.35, amp: 0.8, wave: 'sine', releaseSec: 0.3 });
      break;
    }
    case 'laser': {
      addTone(buf, sampleRate, {
        freq: 2400, glideEndFreq: 160, startSec: 0, durSec: dur * 0.9, amp: 0.55,
        wave: 'square', attackSec: 0.002, releaseSec: dur * 0.25,
      });
      addTone(buf, sampleRate, {
        freq: 3600, glideEndFreq: 220, startSec: 0, durSec: dur * 0.7, amp: 0.2,
        wave: 'saw', releaseSec: dur * 0.3,
      });
      break;
    }
    case 'whoosh': {
      for (let i = 0; i < buf.length; i++) buf[i] = rng() * 2 - 1;
      applyBiquad(buf, rbjBandpass(sampleRate, 700, 0.8));
      for (let i = 0; i < buf.length; i++) {
        const t = i / buf.length;
        buf[i] *= Math.pow(Math.sin(Math.PI * t), 2); // swell in, swell out
      }
      break;
    }
    case 'rain': {
      for (let i = 0; i < buf.length; i++) buf[i] = rng() * 2 - 1;
      applyBiquad(buf, rbjLowpass(sampleRate, 4200, 0.5));
      applyBiquad(buf, rbjHighpass(sampleRate, 350, 0.5));
      for (let i = 0; i < buf.length; i++) buf[i] *= 0.35;
      // Sparse droplet pings on top of the steady bed.
      const drops = Math.floor(dur * 14);
      for (let d = 0; d < drops; d++) {
        addTone(buf, sampleRate, {
          freq: 1800 + rng() * 2600, startSec: rng() * dur, durSec: 0.03,
          amp: 0.12, wave: 'sine', releaseSec: 0.025,
        });
      }
      break;
    }
    case 'thunder': {
      const noise = brownNoise(buf.length, rng);
      buf.set(noise.subarray(0, buf.length));
      applyBiquad(buf, rbjLowpass(sampleRate, 260, 0.5));
      for (let i = 0; i < buf.length; i++) {
        const t = i / sampleRate;
        const attack = Math.min(1, t / 0.12);
        buf[i] *= attack * Math.exp(-1.4 * t);
      }
      addTone(buf, sampleRate, { freq: 48, startSec: 0, durSec: 0.6, amp: 0.5, wave: 'sine', attackSec: 0.05, releaseSec: 0.5 });
      break;
    }
    case 'footsteps': {
      const stepCount = Math.max(2, Math.floor(dur / 0.33));
      for (let sIdx = 0; sIdx < stepCount; sIdx++) {
        const at = sIdx * 0.33 + (rng() - 0.5) * 0.03;
        const burst = new Float32Array(Math.floor(0.09 * sampleRate));
        for (let i = 0; i < burst.length; i++) burst[i] = rng() * 2 - 1;
        applyBiquad(burst, rbjLowpass(sampleRate, 320, 0.7));
        const offset = Math.floor(at * sampleRate);
        for (let i = 0; i < burst.length && offset + i < buf.length; i++) {
          buf[offset + i] += burst[i] * Math.exp(-40 * (i / sampleRate)) * 0.9;
        }
        addTone(buf, sampleRate, { freq: 120, startSec: at, durSec: 0.08, amp: 0.4, wave: 'sine', releaseSec: 0.06 });
      }
      break;
    }
    case 'heartbeat': {
      const beat = (at: number, strength: number) => {
        addTone(buf, sampleRate, { freq: 68, glideEndFreq: 42, startSec: at, durSec: 0.14, amp: 0.9 * strength, wave: 'sine', attackSec: 0.008, releaseSec: 0.1 });
      };
      beat(0.02, 1);
      beat(0.24, 0.65);
      if (dur > 0.8) {
        beat(0.58, 1);
        beat(0.8, 0.65);
      }
      break;
    }
    case 'alarm': {
      for (let i = 0; i < 4; i++) {
        const freq = i % 2 === 0 ? 880 : 660;
        addTone(buf, sampleRate, {
          freq, startSec: (i * dur) / 4, durSec: dur / 4, amp: 0.3,
          wave: 'square', attackSec: 0.004, releaseSec: 0.02,
        });
      }
      applyBiquad(buf, rbjLowpass(sampleRate, 3000, 0.7));
      break;
    }
    case 'coin': {
      addTone(buf, sampleRate, { freq: 987.77, startSec: 0, durSec: 0.09, amp: 0.5, wave: 'square', releaseSec: 0.03 });
      addTone(buf, sampleRate, { freq: 1318.51, startSec: 0.085, durSec: dur - 0.085, amp: 0.5, wave: 'square', attackSec: 0.004, releaseSec: dur * 0.6 });
      break;
    }
    case 'shatter': {
      for (let i = 0; i < buf.length; i++) buf[i] = rng() * 2 - 1;
      applyBiquad(buf, rbjHighpass(sampleRate, 2500, 0.6));
      for (let i = 0; i < buf.length; i++) {
        const t = i / sampleRate;
        buf[i] *= Math.exp(-6 * t);
      }
      for (let p = 0; p < 7; p++) {
        addTone(buf, sampleRate, {
          freq: 2000 + rng() * 4500, startSec: rng() * dur * 0.5, durSec: 0.05 + rng() * 0.12,
          amp: 0.25, wave: 'sine', releaseSec: 0.1,
        });
      }
      break;
    }
    case 'water': {
      const bubbles = 3;
      for (let b = 0; b < bubbles; b++) {
        const at = (b * dur) / (bubbles + 1) + 0.05;
        addTone(buf, sampleRate, {
          freq: 280 + rng() * 160, glideEndFreq: 700 + rng() * 700, startSec: at,
          durSec: Math.min(0.14, dur / 4), amp: 0.5, wave: 'sine',
          attackSec: 0.004, releaseSec: 0.06, vibratoHz: 30, vibratoCents: 80,
        });
      }
      break;
    }
    case 'wind': {
      for (let i = 0; i < buf.length; i++) buf[i] = rng() * 2 - 1;
      applyBiquad(buf, rbjLowpass(sampleRate, 550, 0.4));
      for (let i = 0; i < buf.length; i++) {
        const lfo = 0.55 + 0.45 * Math.sin((TWO_PI * 0.35 * i) / sampleRate + rng() * 0.001);
        buf[i] *= 0.5 * lfo;
      }
      break;
    }
    case 'glitch': {
      const bursts = 10;
      for (let g = 0; g < bursts; g++) {
        const at = (g / bursts) * dur + rng() * 0.02;
        addTone(buf, sampleRate, {
          freq: 100 + rng() * 2800, startSec: at, durSec: 0.02 + rng() * 0.05,
          amp: 0.45, wave: rng() > 0.5 ? 'square' : 'noise', rng,
          releaseSec: 0.01,
        });
      }
      break;
    }
    case 'bird': {
      const chirps = 3;
      for (let c = 0; c < chirps; c++) {
        const at = c * (dur / chirps) + 0.05;
        addTone(buf, sampleRate, {
          freq: 2400 + rng() * 600, glideEndFreq: 3800 + rng() * 900, startSec: at,
          durSec: 0.07, amp: 0.4, wave: 'sine', attackSec: 0.006, releaseSec: 0.03,
          vibratoHz: 60, vibratoCents: 120,
        });
      }
      break;
    }
    case 'engine': {
      addTone(buf, sampleRate, { freq: 84, startSec: 0, durSec: dur, amp: 0.35, wave: 'saw', attackSec: 0.15, releaseSec: 0.3 });
      addTone(buf, sampleRate, { freq: 42, startSec: 0, durSec: dur, amp: 0.3, wave: 'sine', attackSec: 0.15, releaseSec: 0.3 });
      applyBiquad(buf, rbjLowpass(sampleRate, 900, 0.6));
      // Mechanical amplitude modulation gives it a chugging character.
      for (let i = 0; i < buf.length; i++) {
        buf[i] *= 0.75 + 0.25 * Math.sin((TWO_PI * 27 * i) / sampleRate);
      }
      break;
    }
    case 'pop':
    default: {
      addTone(buf, sampleRate, {
        freq: 900, glideEndFreq: 240, startSec: 0, durSec: dur, amp: 0.6,
        wave: 'sine', attackSec: 0.002, releaseSec: dur * 0.5,
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Instrumental music
// ---------------------------------------------------------------------------

export type MusicMood = 'calm' | 'upbeat' | 'epic' | 'tense' | 'lofi';

/** Maps free-text mood/prompt keywords onto one of five production moods. */
export function classifyMood(explicitMood: string | undefined, prompt: string | undefined): MusicMood {
  const hay = `${explicitMood || ''} ${prompt || ''}`.toLowerCase();
  if (/epic|cinematic|trailer|heroic|battle|orchestral|grand/.test(hay)) return 'epic';
  if (/tense|dark|horror|suspense|mystery|thriller|ominous|scary/.test(hay)) return 'tense';
  if (/happy|upbeat|energetic|party|dance|bright|joyful|driving|workout/.test(hay)) return 'upbeat';
  if (/lofi|lo-fi|chill|study|relax|mellow|cozy|sleep/.test(hay)) return 'lofi';
  if (/calm|ambient|peaceful|serene|meditat|spa|gentle/.test(hay)) return 'calm';
  if (!explicitMood && !prompt) return 'calm';
  // Explicit but unrecognized mood strings fall back by first letter heuristic; calm otherwise.
  if (explicitMood) {
    const m = explicitMood.toLowerCase();
    if (m.startsWith('up') || m.startsWith('hap')) return 'upbeat';
    if (m.startsWith('ep')) return 'epic';
    if (m.startsWith('ten') || m.startsWith('dar')) return 'tense';
    if (m.startsWith('lo')) return 'lofi';
  }
  return 'calm';
}

interface MoodPreset {
  scaleName: string;
  scale: number[];
  rootMidi: number;
  bpm: number;
  drums: boolean;
  arp: boolean;
  melody: boolean;
  seventhChords: boolean;
  padAmp: number;
  bassAmp: number;
  progression: number[]; // scale-degree indices of each bar's chord root
}

const MOOD_PRESETS: Record<MusicMood, MoodPreset> = {
  calm: {
    scaleName: 'major', scale: [0, 2, 4, 5, 7, 9, 11], rootMidi: 53, bpm: 72,
    drums: false, arp: false, melody: true, seventhChords: true,
    padAmp: 0.16, bassAmp: 0.22, progression: [0, 4, 5, 3],
  },
  upbeat: {
    scaleName: 'major', scale: [0, 2, 4, 5, 7, 9, 11], rootMidi: 48, bpm: 116,
    drums: true, arp: true, melody: true, seventhChords: false,
    padAmp: 0.13, bassAmp: 0.3, progression: [0, 4, 5, 3],
  },
  epic: {
    scaleName: 'naturalMinor', scale: [0, 2, 3, 5, 7, 8, 10], rootMidi: 50, bpm: 88,
    drums: true, arp: false, melody: true, seventhChords: false,
    padAmp: 0.18, bassAmp: 0.32, progression: [0, 5, 3, 4],
  },
  tense: {
    scaleName: 'phrygian', scale: [0, 1, 3, 5, 7, 8, 10], rootMidi: 52, bpm: 84,
    drums: true, arp: false, melody: false, seventhChords: false,
    padAmp: 0.17, bassAmp: 0.3, progression: [0, 1, 0, 5],
  },
  lofi: {
    scaleName: 'major', scale: [0, 2, 4, 5, 7, 9, 11], rootMidi: 53, bpm: 76,
    drums: true, arp: false, melody: true, seventhChords: true,
    padAmp: 0.15, bassAmp: 0.26, progression: [1, 4, 0, 5],
  },
};

const NOTE_NAMES: Record<string, number> = {
  C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6,
  G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11,
};

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Extracts an explicit key like "C minor" / "F#" from prompt text; returns midi or null. */
function detectRoot(prompt: string | undefined): number | null {
  if (!prompt) return null;
  const match = prompt.match(/\b([A-G])(#|b)?\s?(major|minor|maj|min)?\b/i);
  if (!match) return null;
  const base = NOTE_NAMES[`${match[1].toUpperCase()}${match[2] ? (match[2].toLowerCase() === '#' ? '#' : 'B') : ''}`];
  if (base === undefined) return null;
  return 48 + base; // place roots around C3
}

export interface MusicRenderResult {
  samples: Float32Array;
  sampleRate: number;
  meta: {
    bpm: number;
    mood: MusicMood;
    scale: string;
    bars: number;
    loopSafe: boolean;
  };
}

/**
 * Renders an instrumental track: chord pads, bass, arpeggios, sparse lead
 * melody, and optional percussion, all scheduled on a bar grid. When
 * opts.loop is true the length snaps to whole bars and every note finishes
 * inside the grid so the WAV loops seamlessly.
 */
export function renderMusic(opts: {
  prompt?: string;
  durationSec?: number;
  bpm?: number;
  mood?: string;
  loop?: boolean;
  seed?: number;
}): MusicRenderResult {
  const sampleRate = SAMPLE_RATE;
  const mood = classifyMood(opts.mood, opts.prompt);
  const preset = MOOD_PRESETS[mood];
  const bpm = Math.round(Math.max(40, Math.min(200, opts.bpm ?? preset.bpm)));
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;

  const requestedDur = Math.max(2, Math.min(180, opts.durationSec ?? 30));
  // Length always snaps to whole bars: when opts.loop is set this makes the
  // WAV seamless (every scheduled note finishes inside the grid); otherwise
  // it keeps the output within half a bar of the requested duration.
  const bars = Math.max(1, Math.round(requestedDur / barSec));
  const totalSec = bars * barSec;
  const n = Math.floor(totalSec * sampleRate);
  const buf = new Float32Array(n);
  const rng = createRng(opts.seed ?? hashSeed(`music:${mood}:${opts.prompt || ''}:${bpm}`));

  const scale = preset.scale;
  const rootMidi = detectRoot(opts.prompt) ?? preset.rootMidi;
  const seventh = preset.seventhChords;

  const chordMidis = (degree: number): number[] => {
    const tones: number[] = [];
    for (const step of [0, 2, 4]) {
      const idx = degree + step;
      const octave = Math.floor(idx / scale.length);
      tones.push(rootMidi + scale[idx % scale.length] + octave * 12);
    }
    if (seventh) {
      const idx = degree + 6;
      const octave = Math.floor(idx / scale.length);
      tones.push(rootMidi + scale[idx % scale.length] + octave * 12);
    }
    return tones;
  };

  const scaleNoteNear = (base: number): number => {
    const idx = Math.floor(rng() * scale.length);
    return base + scale[idx];
  };

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * barSec;
    const degree = preset.progression[bar % preset.progression.length];
    const chord = chordMidis(degree);

    // Pad: sustained detuned triangles across the whole bar.
    for (const midi of chord) {
      const freq = midiToFreq(midi);
      addTone(buf, sampleRate, {
        freq: freq * 1.003, startSec: barStart, durSec: barSec,
        amp: preset.padAmp, wave: 'triangle', attackSec: Math.min(0.6, barSec * 0.25),
        releaseSec: Math.min(0.7, barSec * 0.25),
      });
      addTone(buf, sampleRate, {
        freq: freq * 0.997, startSec: barStart, durSec: barSec,
        amp: preset.padAmp * 0.7, wave: 'triangle', attackSec: Math.min(0.6, barSec * 0.25),
        releaseSec: Math.min(0.7, barSec * 0.25),
      });
    }

    // Bass: quarters on rhythmic moods, half notes otherwise.
    const bassNote = chord[0] - 12;
    const bassSteps = preset.drums ? 4 : 2;
    for (let s = 0; s < bassSteps; s++) {
      addTone(buf, sampleRate, {
        freq: midiToFreq(bassNote), startSec: barStart + (s * barSec) / bassSteps,
        durSec: barSec / bassSteps, amp: preset.bassAmp, wave: 'triangle',
        attackSec: 0.01, releaseSec: 0.08,
      });
    }

    // Arpeggio: eighth-note plucks cycling the chord an octave up.
    if (preset.arp) {
      for (let e = 0; e < 8; e++) {
        const midi = chord[e % chord.length] + 12;
        addTone(buf, sampleRate, {
          freq: midiToFreq(midi), startSec: barStart + e * (barSec / 8),
          durSec: barSec / 8, amp: 0.14, wave: 'sine', attackSec: 0.003, releaseSec: 0.1,
        });
      }
    }

    // Lead melody: sparse scale notes on alternating bars.
    if (preset.melody && bar % 2 === 1) {
      const notesInBar = 2 + Math.floor(rng() * 2);
      for (let mIdx = 0; mIdx < notesInBar; mIdx++) {
        const midi = scaleNoteNear(chord[0]);
        addTone(buf, sampleRate, {
          freq: midiToFreq(midi + 12), startSec: barStart + mIdx * (barSec / notesInBar) + rng() * 0.15,
          durSec: barSec / notesInBar, amp: 0.11, wave: 'sine',
          attackSec: 0.03, releaseSec: 0.2, vibratoHz: 5.2, vibratoCents: 18,
        });
      }
    }

    // Percussion: kick on 1 and 3, snare on 2 and 4, hats on eighths.
    if (preset.drums) {
      for (const beat of [0, 2]) {
        addTone(buf, sampleRate, {
          freq: 150, glideEndFreq: 46, startSec: barStart + beat * beatSec,
          durSec: 0.14, amp: 0.5, wave: 'sine', attackSec: 0.002, releaseSec: 0.12,
        });
      }
      for (const beat of [1, 3]) {
        const snareStart = Math.floor((barStart + beat * beatSec) * sampleRate);
        const snareLen = Math.floor(0.11 * sampleRate);
        for (let i = 0; i < snareLen && snareStart + i < n; i++) {
          buf[snareStart + i] += (rng() * 2 - 1) * 0.16 * Math.exp(-30 * (i / sampleRate));
        }
        addTone(buf, sampleRate, { freq: 190, startSec: barStart + beat * beatSec, durSec: 0.07, amp: 0.12, wave: 'sine', releaseSec: 0.06 });
      }
      for (let e = 0; e < 8; e++) {
        const hatStart = Math.floor((barStart + e * (barSec / 8)) * sampleRate);
        const hatLen = Math.floor(0.035 * sampleRate);
        const hatAmp = e % 2 === 1 ? 0.1 : 0.06;
        for (let i = 0; i < hatLen && hatStart + i < n; i++) {
          buf[hatStart + i] += (rng() * 2 - 1) * hatAmp * Math.exp(-90 * (i / sampleRate));
        }
      }
    }
  }

  // Tame harsh high end, then level and soft clip.
  applyBiquad(buf, rbjLowpass(sampleRate, 7500, 0.6));
  normalizePeak(buf, 0.82);
  softClip(buf);

  return {
    samples: buf,
    sampleRate,
    meta: {
      bpm,
      mood,
      scale: preset.scaleName,
      bars,
      loopSafe: Boolean(opts.loop),
    },
  };
}

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

/**
 * Adds a vocal overlay into a music bed with automatic bed ducking:
 * the bed gain ramps down at the vocal's start and back up after its end
 * so the voice sits clearly on top without clicks.
 */
export function overlayVocalWithDucking(
  bed: Float32Array,
  vocal: Float32Array,
  opts: { sampleRate: number; startSample?: number; vocalGain?: number; duckedBedGain?: number; rampSec?: number },
): void {
  const rate = opts.sampleRate;
  const start = Math.max(0, Math.min(bed.length - 1, opts.startSample ?? 0));
  const end = Math.min(bed.length, start + vocal.length);
  const vocalGain = opts.vocalGain ?? 0.95;
  const ducked = opts.duckedBedGain ?? 0.45;
  const rampN = Math.max(1, Math.floor((opts.rampSec ?? 0.12) * rate));

  for (let i = 0; i < vocal.length; i++) {
    const bedIdx = start + i;
    if (bedIdx >= bed.length) break;
    // Bed gain: ducked inside the vocal span, eased at both edges.
    let bedGain = 1;
    if (bedIdx >= start && bedIdx < end) {
      const edgeIn = Math.min(1, (bedIdx - start) / rampN);
      const edgeOut = Math.min(1, (end - bedIdx) / rampN);
      bedGain = 1 - (1 - ducked) * Math.min(edgeIn, edgeOut);
    }
    bed[bedIdx] = bed[bedIdx] * bedGain + vocal[i] * vocalGain;
  }
}
