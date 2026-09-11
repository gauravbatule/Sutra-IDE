export type MusicTrackId =
  | 'binaural_alpha'
  | 'binaural_theta'
  | 'binaural_gamma'
  | 'ting_ting_chimes'
  | 'zen_kalimba'
  | 'lofi_chill'
  | 'rain_cafe'
  | 'binaural_focus'
  | 'synth_flow';

export interface TrackMetadata {
  id: MusicTrackId;
  title: string;
  category: 'Binaural Beats' | 'Acoustic' | 'Lo-Fi & Ambient';
  description: string;
}

export const TRACK_METADATA: TrackMetadata[] = [
  {
    id: 'binaural_alpha',
    title: 'Alpha Flow (10Hz Deep Focus)',
    category: 'Binaural Beats',
    description: '10Hz Alpha brainwave entrainment for sustained coding concentration and calm alertness.',
  },
  {
    id: 'binaural_theta',
    title: 'Theta Dream (6Hz Creative State)',
    category: 'Binaural Beats',
    description: '6Hz Theta wave resonance for deep architectural problem solving and creative flow.',
  },
  {
    id: 'binaural_gamma',
    title: 'Gamma Peak (40Hz Hyper-Focus)',
    category: 'Binaural Beats',
    description: '40Hz Gamma wave synchronization for high-speed debugging and peak cognitive synthesis.',
  },
  {
    id: 'binaural_focus',
    title: 'Binaural Focus (14Hz Beta Flow)',
    category: 'Binaural Beats',
    description: '14Hz Beta brainwave entrainment for active task execution and intense problem solving.',
  },
  {
    id: 'ting_ting_chimes',
    title: 'Ting Ting Chimes (Crystal Bells)',
    category: 'Acoustic',
    description: 'Pentatonic music box chimes with crystalline harmonic overtones.',
  },
  {
    id: 'zen_kalimba',
    title: 'Zen Kalimba (Wooden Thumb Piano)',
    category: 'Acoustic',
    description: 'Warm acoustic wooden tines over a subtle binaural background drone.',
  },
  {
    id: 'lofi_chill',
    title: 'Midnight Lo-Fi Chords',
    category: 'Lo-Fi & Ambient',
    description: 'Warm analog electric piano with lush seventh chords and vintage vinyl warmth.',
  },
  {
    id: 'rain_cafe',
    title: 'Rainy Day Café',
    category: 'Lo-Fi & Ambient',
    description: 'Organic filtered rain textures and soothing low-frequency atmosphere.',
  },
  {
    id: 'synth_flow',
    title: 'Ambient Synth Pad Matrix',
    category: 'Lo-Fi & Ambient',
    description: 'Evolving multi-oscillator sawtooth pads with resonant lowpass sweeps.',
  },
];

class AudioSynthEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private activeOscillators: OscillatorNode[] = [];
  private chordInterval: any = null;
  private currentTrack: MusicTrackId = 'binaural_alpha';
  private isPlaying: boolean = false;
  private volume: number = 0.75;

  private async ensureContextReady(): Promise<AudioContext> {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume || 0.85, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {}
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume || 0.85, this.ctx.currentTime);
    }
    return this.ctx;
  }

  // Synchronous context getter for non-async callers (backward compat)
  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume || 0.85, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume || 0.85, this.ctx.currentTime);
    }
    return this.ctx;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public async play(track: MusicTrackId = 'binaural_alpha') {
    this.stopOscillators();
    this.currentTrack = track;
    this.isPlaying = true;
    const ctx = await this.ensureContextReady();
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.volume || 0.85, ctx.currentTime);
    }

    if (track === 'binaural_alpha') {
      this.startBinauralAlpha(ctx);
    } else if (track === 'binaural_theta') {
      this.startBinauralTheta(ctx);
    } else if (track === 'binaural_gamma') {
      this.startBinauralGamma(ctx);
    } else if (track === 'ting_ting_chimes') {
      this.startTingTingChimes(ctx);
    } else if (track === 'zen_kalimba') {
      this.startZenKalimba(ctx);
    } else if (track === 'lofi_chill') {
      this.startLofiChill(ctx);
    } else if (track === 'rain_cafe') {
      this.startRainCafe(ctx);
    } else if (track === 'binaural_focus') {
      this.startBinauralAlpha(ctx);
    } else if (track === 'synth_flow') {
      this.startSynthFlow(ctx);
    }
  }

  /** Stop all active oscillators and noise without suspending the context */
  private stopOscillators() {
    if (this.chordInterval) {
      clearInterval(this.chordInterval);
      this.chordInterval = null;
    }
    for (const osc of this.activeOscillators) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    }
    this.activeOscillators = [];
    if (this.noiseNode) {
      try { this.noiseNode.stop(); } catch {}
      this.noiseNode.disconnect();
      this.noiseNode = null;
    }
  }

  public stop() {
    this.isPlaying = false;
    this.stopOscillators();
    // Don't suspend the AudioContext here — suspending then immediately
    // resuming in play() creates a race condition that silences audio.
    // The context is lightweight when idle (no active sources).
  }

  // 1. Scientific Binaural Beats: Alpha 10Hz Deep Flow (Carrier: 216Hz, Difference: 10Hz + Soothing Ambient Bed)
  private startBinauralAlpha(ctx: AudioContext) {
    if (!this.masterGain) return;
    const now = ctx.currentTime;
    this.playPinkNoise(ctx, 300, 0.05); // Warm tape atmosphere

    // Left Ear: 216 Hz Fundamental
    const oscL = ctx.createOscillator();
    const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gainL = ctx.createGain();
    oscL.type = 'sine';
    oscL.frequency.setValueAtTime(216, now);
    gainL.gain.setValueAtTime(0.30, now);

    if (panL) {
      panL.pan.setValueAtTime(-0.85, now);
      oscL.connect(panL);
      panL.connect(gainL);
    } else {
      oscL.connect(gainL);
    }
    gainL.connect(this.masterGain);
    oscL.start();
    this.activeOscillators.push(oscL);

    // Right Ear: 226 Hz (10Hz Alpha Beat Difference)
    const oscR = ctx.createOscillator();
    const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gainR = ctx.createGain();
    oscR.type = 'sine';
    oscR.frequency.setValueAtTime(226, now);
    gainR.gain.setValueAtTime(0.30, now);

    if (panR) {
      panR.pan.setValueAtTime(0.85, now);
      oscR.connect(panR);
      panR.connect(gainR);
    } else {
      oscR.connect(gainR);
    }
    gainR.connect(this.masterGain);
    oscR.start();
    this.activeOscillators.push(oscR);

    // 432Hz Pure Harmonic Layer with Gentle 10Hz Alpha LFO Modulation (Works for speakers & headphones)
    const harmOsc = ctx.createOscillator();
    const harmGain = ctx.createGain();
    const harmLfo = ctx.createOscillator();
    const harmLfoGain = ctx.createGain();

    harmOsc.type = 'sine';
    harmOsc.frequency.setValueAtTime(432, now); // Sacred 432Hz tuning harmonic
    harmGain.gain.setValueAtTime(0.12, now);

    harmLfo.type = 'sine';
    harmLfo.frequency.setValueAtTime(10, now); // 10Hz Alpha wave pulse
    harmLfoGain.gain.setValueAtTime(0.06, now);

    harmLfo.connect(harmLfoGain);
    harmLfoGain.connect(harmGain.gain);
    harmOsc.connect(harmGain);
    harmGain.connect(this.masterGain);

    harmOsc.start();
    harmLfo.start();
    this.activeOscillators.push(harmOsc, harmLfo);

    // Soothing Ambient Chord Pad Matrix (D min9 -> F maj7 -> C add9 -> G sus4)
    const padChords = [
      [146.83, 220.00, 261.63, 329.63], // Dm9
      [174.61, 220.00, 261.63, 349.23], // Fmaj7
      [130.81, 196.00, 261.63, 329.63], // Cadd9
      [98.00, 146.83, 196.00, 261.63],  // Gsus4
    ];
    let chordIdx = 0;

    const playPadCycle = () => {
      if (!this.isPlaying || !this.masterGain) return;
      const notes = padChords[chordIdx];
      chordIdx = (chordIdx + 1) % padChords.length;
      const t = ctx.currentTime;

      notes.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(450, t);
        filter.frequency.exponentialRampToValueAtTime(800, t + 2.0);
        filter.frequency.exponentialRampToValueAtTime(450, t + 4.8);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 5.0);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain!);

        osc.start(t);
        osc.stop(t + 5.2);
      });
    };

    playPadCycle();
    this.chordInterval = setInterval(playPadCycle, 5000);
  }

  // 2. Scientific Binaural Beats: Theta 6Hz Creative State (Carrier: 144Hz, Difference: 6Hz)
  private startBinauralTheta(ctx: AudioContext) {
    if (!this.masterGain) return;
    const now = ctx.currentTime;
    this.playPinkNoise(ctx, 220, 0.05);

    // Left Ear: 144 Hz
    const oscL = ctx.createOscillator();
    const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gainL = ctx.createGain();
    oscL.type = 'sine';
    oscL.frequency.setValueAtTime(144, now);
    gainL.gain.setValueAtTime(0.32, now);

    if (panL) {
      panL.pan.setValueAtTime(-0.85, now);
      oscL.connect(panL);
      panL.connect(gainL);
    } else {
      oscL.connect(gainL);
    }
    gainL.connect(this.masterGain);
    oscL.start();
    this.activeOscillators.push(oscL);

    // Right Ear: 150 Hz (6Hz Theta Beat Difference)
    const oscR = ctx.createOscillator();
    const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gainR = ctx.createGain();
    oscR.type = 'sine';
    oscR.frequency.setValueAtTime(150, now);
    gainR.gain.setValueAtTime(0.32, now);

    if (panR) {
      panR.pan.setValueAtTime(0.85, now);
      oscR.connect(panR);
      panR.connect(gainR);
    } else {
      oscR.connect(gainR);
    }
    gainR.connect(this.masterGain);
    oscR.start();
    this.activeOscillators.push(oscR);

    // Warm Singing Bowl Resonance (216Hz + 288Hz harmonic with 6Hz LFO)
    const bowlOsc = ctx.createOscillator();
    const bowlGain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    bowlOsc.type = 'triangle';
    bowlOsc.frequency.setValueAtTime(216, now);
    bowlGain.gain.setValueAtTime(0.14, now);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(6, now); // 6Hz Theta pulse
    lfoGain.gain.setValueAtTime(0.06, now);

    lfo.connect(lfoGain);
    lfoGain.connect(bowlGain.gain);
    bowlOsc.connect(bowlGain);
    bowlGain.connect(this.masterGain);

    bowlOsc.start();
    lfo.start();
    this.activeOscillators.push(bowlOsc, lfo);
  }

  // 3. Scientific Binaural Beats: Gamma 40Hz Hyper-Focus (Carrier: 240Hz, Difference: 40Hz)
  private startBinauralGamma(ctx: AudioContext) {
    if (!this.masterGain) return;
    const now = ctx.currentTime;
    this.playPinkNoise(ctx, 350, 0.04);

    // Left Ear: 240 Hz
    const oscL = ctx.createOscillator();
    const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gainL = ctx.createGain();
    oscL.type = 'sine';
    oscL.frequency.setValueAtTime(240, now);
    gainL.gain.setValueAtTime(0.28, now);

    if (panL) {
      panL.pan.setValueAtTime(-0.85, now);
      oscL.connect(panL);
      panL.connect(gainL);
    } else {
      oscL.connect(gainL);
    }
    gainL.connect(this.masterGain);
    oscL.start();
    this.activeOscillators.push(oscL);

    // Right Ear: 280 Hz (40Hz Gamma Beat Difference)
    const oscR = ctx.createOscillator();
    const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gainR = ctx.createGain();
    oscR.type = 'sine';
    oscR.frequency.setValueAtTime(280, now);
    gainR.gain.setValueAtTime(0.28, now);

    if (panR) {
      panR.pan.setValueAtTime(0.85, now);
      oscR.connect(panR);
      panR.connect(gainR);
    } else {
      oscR.connect(gainR);
    }
    gainR.connect(this.masterGain);
    oscR.start();
    this.activeOscillators.push(oscR);

    // Crystal Shimmer 480Hz with 40Hz Gamma Modulation
    const crystalOsc = ctx.createOscillator();
    const crystalGain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    crystalOsc.type = 'sine';
    crystalOsc.frequency.setValueAtTime(480, now);
    crystalGain.gain.setValueAtTime(0.12, now);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(40, now);
    lfoGain.gain.setValueAtTime(0.05, now);

    lfo.connect(lfoGain);
    lfoGain.connect(crystalGain.gain);
    crystalOsc.connect(crystalGain);
    crystalGain.connect(this.masterGain);

    crystalOsc.start();
    lfo.start();
    this.activeOscillators.push(crystalOsc, lfo);
  }

  // 0. Crystalline Ting Ting Music Box Chimes (Tactile Bell Tone & Pentatonic Melodies)
  private startTingTingChimes(ctx: AudioContext) {
    // Soft soothing warm tape air
    this.playPinkNoise(ctx, 350, 0.04);

    // Pentatonic bell frequencies (C5, D5, E5, G5, A5, C6, D6, E6, G6)
    const bellNotes = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51, 1567.98];
    // Melodic pattern: [noteIndex, delaySeconds, durationSeconds, velocity]
    const melodyPattern = [
      [2, 0.0, 1.4, 0.28],   // E5 "ting"
      [4, 0.35, 1.2, 0.22],  // A5 "ting"
      [5, 0.70, 1.8, 0.32],  // C6 "ting"
      [7, 1.25, 1.6, 0.30],  // E6 "ting"
      [4, 1.80, 1.2, 0.24],  // A5 "ting"
      [3, 2.15, 1.4, 0.26],  // G5 "ting"
      [1, 2.70, 1.6, 0.28],  // D5 "ting"
      [5, 3.10, 1.9, 0.34],  // C6 "ting"
      [3, 3.65, 1.3, 0.22],  // G5 "ting"
      [6, 4.20, 2.0, 0.30],  // D6 "ting"
      [4, 4.75, 1.5, 0.24],  // A5 "ting"
      [0, 5.30, 2.2, 0.32],  // C5 "ting"
    ];

    const playTing = (freq: number, duration: number, velocity: number) => {
      if (!this.isPlaying || !this.masterGain) return;
      const now = ctx.currentTime;

      // Primary fundamental sine oscillator (The pure "ting")
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator(); // 1st overtone chime
      const osc3 = ctx.createOscillator(); // High sparkle chime

      const noteGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2.756, now); // Metallic chime ratio

      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(freq * 5.404, now); // Shimmer harmonic

      // Resonant bandpass filter for crystalline bell ring
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * 1.5, now);
      filter.Q.setValueAtTime(2.2, now);

      // Bell envelope (Immediate attack, tactile ping, natural exponential decay)
      noteGain.gain.setValueAtTime(0.0001, now);
      noteGain.gain.linearRampToValueAtTime(velocity, now + 0.004);
      noteGain.gain.exponentialRampToValueAtTime(velocity * 0.45, now + 0.12);
      noteGain.gain.exponentialRampToValueAtTime(0.00001, now + duration);

      osc1.connect(filter);
      osc2.connect(filter);
      osc3.connect(filter);
      filter.connect(noteGain);
      noteGain.connect(this.masterGain!);

      osc1.start(now);
      osc2.start(now);
      osc3.start(now);

      osc1.stop(now + duration + 0.05);
      osc2.stop(now + duration + 0.05);
      osc3.stop(now + duration + 0.05);
    };

    const runMelodyLoop = () => {
      if (!this.isPlaying) return;
      melodyPattern.forEach(([noteIdx, delay, duration, velocity]) => {
        setTimeout(() => {
          if (this.isPlaying) {
            playTing(bellNotes[noteIdx], duration, velocity);
          }
        }, delay * 1000);
      });
    };

    runMelodyLoop();
    this.chordInterval = setInterval(runMelodyLoop, 6000);
  }

  // 1. Zen Kalimba Soundscape (Acoustic Thumb Piano & Singing Bells)
  private startZenKalimba(ctx: AudioContext) {
    this.playPinkNoise(ctx, 400, 0.05);
    const kalimbaTines = [261.63, 329.63, 392.00, 493.88, 523.25, 587.33, 659.25, 783.99];
    const kalimbaPattern = [
      [0, 0.0, 1.2, 0.25],
      [2, 0.4, 1.0, 0.22],
      [4, 0.8, 1.4, 0.28],
      [6, 1.3, 1.5, 0.30],
      [3, 1.9, 1.1, 0.20],
      [5, 2.3, 1.3, 0.24],
      [1, 2.8, 1.2, 0.22],
      [7, 3.4, 1.8, 0.32],
    ];

    const playKalimba = () => {
      if (!this.isPlaying || !this.masterGain) return;
      kalimbaPattern.forEach(([noteIdx, delay, duration, velocity]) => {
        setTimeout(() => {
          if (!this.isPlaying || !this.masterGain) return;
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(kalimbaTines[noteIdx], now);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1400, now);
          filter.Q.setValueAtTime(2.0, now);

          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(velocity, now + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.00001, now + duration);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain!);

          osc.start(now);
          osc.stop(now + duration + 0.05);
        }, delay * 1000);
      });
    };

    playKalimba();
    this.chordInterval = setInterval(playKalimba, 4500);
  }

  // 2. Warm Rhodes Lo-Fi Chill Chords + Vinyl Crackle
  private startLofiChill(ctx: AudioContext) {
    // Pink noise / vinyl crackle background
    this.playPinkNoise(ctx, 450, 0.12);

    // Mellow Rhodes chord progressions: Dm9, G13, Cmaj9, A7alt
    const chords = [
      [146.83, 220.00, 261.63, 329.63, 392.00], // Dm9
      [196.00, 246.94, 329.63, 392.00, 440.00], // G13
      [130.81, 196.00, 246.94, 329.63, 392.00], // Cmaj9
      [220.00, 277.18, 329.63, 392.00, 466.16], // A7b9
    ];

    let chordIdx = 0;
    const playChord = () => {
      if (!this.isPlaying || !this.masterGain) return;
      const notes = chords[chordIdx];
      chordIdx = (chordIdx + 1) % chords.length;

      const now = ctx.currentTime;
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const noteGain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.04);

        // Low-pass filter for warm vintage tape lo-fi sound
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(850, now);
        filter.Q.setValueAtTime(1.8, now);

        // Rich ADSR envelope
        noteGain.gain.setValueAtTime(0.0001, now);
        noteGain.gain.exponentialRampToValueAtTime(0.24, now + 0.2 + idx * 0.04);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.8);

        osc.connect(filter);
        filter.connect(noteGain);
        noteGain.connect(this.masterGain!);

        osc.start(now + idx * 0.04);
        osc.stop(now + 4.0);
      });
    };

    playChord();
    this.chordInterval = setInterval(playChord, 3800);
  }

  // 2. Rain & Café Ambience
  private startRainCafe(ctx: AudioContext) {
    this.playPinkNoise(ctx, 800, 0.35);
  }

  // 3. Binaural 432Hz Deep Focus Alpha Wave (432Hz / 440Hz -> 8Hz Alpha)
  private startBinauralFocus(ctx: AudioContext) {
    if (!this.masterGain) return;
    const now = ctx.currentTime;

    // Left ear (432Hz)
    const oscL = ctx.createOscillator();
    const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gainL = ctx.createGain();
    oscL.type = 'sine';
    oscL.frequency.setValueAtTime(432, now);
    gainL.gain.setValueAtTime(0.18, now);

    if (panL) {
      panL.pan.setValueAtTime(-1, now);
      oscL.connect(panL);
      panL.connect(gainL);
    } else {
      oscL.connect(gainL);
    }
    gainL.connect(this.masterGain);
    oscL.start();

    // Right ear (440Hz) -> 8Hz Alpha beat
    const oscR = ctx.createOscillator();
    const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gainR = ctx.createGain();
    oscR.type = 'sine';
    oscR.frequency.setValueAtTime(440, now);
    gainR.gain.setValueAtTime(0.18, now);

    if (panR) {
      panR.pan.setValueAtTime(1, now);
      oscR.connect(panR);
      panR.connect(gainR);
    } else {
      oscR.connect(gainR);
    }
    gainR.connect(this.masterGain);
    oscR.start();

    this.noiseNode = oscL as any;
  }

  // 4. Synth Flow Pads
  private startSynthFlow(ctx: AudioContext) {
    const padNotes = [
      [110.00, 164.81, 220.00, 293.66], // A sus2
      [130.81, 196.00, 261.63, 349.23], // C sus4
      [146.83, 220.00, 293.66, 392.00], // D sus2
      [98.00, 146.83, 196.00, 261.63],  // G sus4
    ];
    let padIdx = 0;
    const playPad = () => {
      if (!this.isPlaying || !this.masterGain) return;
      const notes = padNotes[padIdx];
      padIdx = (padIdx + 1) % padNotes.length;

      const now = ctx.currentTime;
      notes.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(500, now);
        filter.frequency.exponentialRampToValueAtTime(1200, now + 2.5);
        filter.frequency.exponentialRampToValueAtTime(500, now + 5.5);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 1.5);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.8);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain!);

        osc.start(now);
        osc.stop(now + 6.0);
      });
    };

    playPad();
    this.chordInterval = setInterval(playPad, 5500);
  }

  private playPinkNoise(ctx: AudioContext, cutoff: number, gainLevel: number) {
    const bufferSize = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.035;
      b6 = white * 0.115926;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, ctx.currentTime);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(gainLevel, ctx.currentTime);

    noise.connect(filter);
    filter.connect(noiseGain);
    if (this.masterGain) {
      noiseGain.connect(this.masterGain);
    }
    noise.start();
    this.noiseNode = noise;
  }
}

export const audioSynth = new AudioSynthEngine();
