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
  start: () => void;
  stop: () => void;
}

const getRecognitionCtor = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export const useVoiceInput = (options: UseVoiceInputOptions = {}): VoiceInputController => {
  const isSupported = getRecognitionCtor() !== null;
  const [isListening, setIsListening] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);

  const createRecognition = useCallback((): SpeechRecognitionLike | null => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return null;
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

    // Chrome auto-stops after a pause — restart unless the user stopped us.
    recognition.onend = () => {
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
    };

    recognition.onerror = () => {
      // Errors (no-speech, network) end the session; onend handles restart/stop
    };

    return recognition;
  }, []);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Already stopped — nothing to do
      }
    }
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    if (!isSupported) return;
    if (!recognitionRef.current) recognitionRef.current = createRecognition();
    const recognition = recognitionRef.current;
    if (!recognition) return;
    shouldListenRef.current = true;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      // InvalidStateError when already running — keep listening state as-is
      setIsListening(true);
    }
  }, [createRecognition, isSupported]);

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
      } catch {
        // Recognition never started or already aborted
      }
      recognitionRef.current = null;
    };
  }, [stop]);

  return { isListening, isSupported, start, stop };
};
