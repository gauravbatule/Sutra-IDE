import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictation for the Manager composer via the Web Speech API
 * (webkitSpeechRecognition / SpeechRecognition). No dependencies: the
 * vendor-prefixed constructor is typed as `any` because no TS lib ships it.
 *
 * Behavior contract:
 *  - `isSupported` is false on browsers (and jsdom) without SpeechRecognition,
 *    so callers can hide the mic button entirely.
 *  - Interim results stream through `onInterim`; each finalized chunk fires
 *    `onFinalChunk` exactly once.
 *  - Chrome ends recognition after silence; while still listening we restart
 *    automatically so dictation survives pauses.
 *  - Escape stops gracefully, as does unmount.
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  item(index: number): { transcript: string };
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; item(index: number): SpeechRecognitionResultLike; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

export interface UseVoiceInputOptions {
  /** BCP-47 tag for recognition; defaults to the browser locale. */
  lang?: string;
  /** Streams non-final hypotheses while the user speaks. */
  onInterim?: (text: string) => void;
  /** Fires once per finalized dictation chunk. */
  onFinalChunk?: (text: string) => void;
}

export interface VoiceInputController {
  isListening: boolean;
  isSupported: boolean;
  error?: string | null;
  start: () => void;
  stop: () => void;
}

const getRecognitionCtor = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export const useVoiceInput = (options: UseVoiceInputOptions = {}): VoiceInputController => {
  const hasWebSpeech = getRecognitionCtor() !== null;
  const hasMediaDevices = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const isSupported = hasWebSpeech || hasMediaDevices;

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const shouldListenRef = useRef(false);

  const stopAllAudioTracks = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const stop = useCallback(() => {
    shouldListenRef.current = false;

    // 1. Stop SpeechRecognition if active
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Safe ignore
      }
      recognitionRef.current = null;
    }

    // 2. Stop MediaRecorder if active and transcribe
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Safe ignore
      }
    }

    stopAllAudioTracks();
    setIsListening(false);
  }, []);

  const startMediaRecorderFallback = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this environment.');
      setIsListening(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/wav';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stopAllAudioTracks();
        if (audioChunksRef.current.length === 0) return;

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        try {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64Data = (reader.result as string) || '';
            if (!base64Data) return;

            try {
              const res = await fetch('/api/media/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioData: base64Data, mimeType }),
              });
              if (res.ok) {
                const data = await res.json();
                if (data.text) {
                  optionsRef.current.onFinalChunk?.(data.text);
                }
              }
            } catch (err: any) {
              console.warn('[VoiceInput] Transcribe error:', err.message);
            }
          };
          reader.readAsDataURL(audioBlob);
        } catch (e: any) {
          console.warn('[VoiceInput] Blob read error:', e.message);
        }
      };

      recorder.start(1000);
      setIsListening(true);
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access was denied. Please allow microphone permissions.');
      } else {
        setError(err.message || 'Failed to start microphone recording.');
      }
      setIsListening(false);
      stopAllAudioTracks();
    }
  }, []);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    setError(null);
    shouldListenRef.current = true;

    // Mode A: Web Speech API (Fast real-time streaming)
    const Ctor = getRecognitionCtor();
    if (Ctor) {
      try {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch {}
          recognitionRef.current = null;
        }

        const recognition = new Ctor();
        recognition.lang = optionsRef.current.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
          let interim = '';
          let finalText = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0]?.transcript ?? '';
            if (result.isFinal) finalText += transcript;
            else interim += transcript;
          }
          if (interim) optionsRef.current.onInterim?.(interim);
          if (finalText.trim()) optionsRef.current.onFinalChunk?.(finalText.trim());
        };

        recognition.onend = () => {
          if (shouldListenRef.current) {
            try {
              recognition.start();
            } catch {
              // If restart fails, fall back to MediaRecorder
              if (shouldListenRef.current) {
                startMediaRecorderFallback();
              } else {
                setIsListening(false);
              }
            }
          } else {
            setIsListening(false);
          }
        };

        recognition.onerror = (event: { error?: string }) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setError('Microphone access denied. Please allow microphone permissions in your browser/system.');
            shouldListenRef.current = false;
            setIsListening(false);
          } else if (event.error === 'network') {
            // Web Speech API offline/network block -> auto fallback to local MediaRecorder
            if (shouldListenRef.current) {
              startMediaRecorderFallback();
            }
          } else if (event.error === 'no-speech') {
            // Silence timeout is normal, will restart in onend
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
        return;
      } catch (err: any) {
        console.warn('[VoiceInput] Web Speech API start error, falling back to MediaRecorder:', err.message);
      }
    }

    // Mode B: MediaRecorder Fallback
    await startMediaRecorderFallback();
  }, [isSupported, startMediaRecorderFallback]);

  // Graceful stop on unmount and on Escape while listening
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shouldListenRef.current) {
        e.stopPropagation();
        stop();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      shouldListenRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {}
      recognitionRef.current = null;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      stopAllAudioTracks();
    };
  }, [stop]);

  return { isListening, isSupported, error, start, stop };
};
