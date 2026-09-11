import { describe, it, expect, beforeEach, vi } from 'vitest';
import { audioSynth, TRACK_METADATA } from '../utils/audioSynth.js';

describe('SUTRA AudioSynth — Enterprise Binaural Beats & Ambient Sound Engine', () => {
  beforeEach(() => {
    const mockAudioNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      setValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    const mockOscillator = {
      ...mockAudioNode,
      type: 'sine',
      frequency: { ...mockAudioNode, value: 440 },
    };

    const mockGain = {
      ...mockAudioNode,
      gain: { ...mockAudioNode, value: 1 },
    };

    const mockFilter = {
      ...mockAudioNode,
      type: 'lowpass',
      frequency: { ...mockAudioNode, value: 1000 },
      Q: { ...mockAudioNode, value: 1 },
    };

    const mockPanner = {
      ...mockAudioNode,
      pan: { ...mockAudioNode, value: 0 },
    };

    const mockBufferSource = {
      ...mockAudioNode,
      buffer: null,
      loop: false,
    };

    const mockBuffer = {
      getChannelData: vi.fn().mockReturnValue(new Float32Array(44100)),
    };

    class MockAudioContext {
      state = 'running';
      currentTime = 0;
      sampleRate = 44100;
      destination = {};
      createGain() { return mockGain; }
      createOscillator() { return mockOscillator; }
      createBiquadFilter() { return mockFilter; }
      createStereoPanner() { return mockPanner; }
      createBufferSource() { return mockBufferSource; }
      createBuffer() { return mockBuffer; }
      async resume() {}
      async suspend() {}
      async close() {}
    }

    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).window = {
      AudioContext: MockAudioContext,
    };
  });

  it('exports valid metadata for all binaural beats and acoustic tracks', () => {
    expect(TRACK_METADATA.length).toBeGreaterThanOrEqual(8);
    const alpha = TRACK_METADATA.find((t) => t.id === 'binaural_alpha');
    expect(alpha).toBeDefined();
    expect(alpha?.title).toContain('Alpha');
    expect(alpha?.category).toBe('Binaural Beats');
  });

  it('plays and stops binaural_alpha without error', () => {
    expect(() => {
      audioSynth.play('binaural_alpha');
    }).not.toThrow();

    expect(() => {
      audioSynth.setVolume(0.8);
      audioSynth.stop();
    }).not.toThrow();
  });

  it('plays all available tracks cleanly through the engine', () => {
    for (const track of TRACK_METADATA) {
      expect(() => {
        audioSynth.play(track.id);
        audioSynth.stop();
      }).not.toThrow();
    }
  });
});
