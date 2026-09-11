import React, { useState, useEffect, useRef } from 'react';
import { Cloud, Sparkles, X } from 'lucide-react';
import { useIDEStore } from '../../stores/ideStore.js';

const GREETINGS = [
  "Hi! I'm your Sutra companion. Ready when you are!",
  "Hello! What are we building today?",
  "Hi there! Let's write some clean code.",
  "Meow! Standing by to help you code.",
  "Hello! Ready to inspect, test, or refactor."
];

interface SutraPetCompanionProps {
  className?: string;
  forceFloating?: boolean;
}

export const SutraPetCompanion: React.FC<SutraPetCompanionProps> = ({ className = '', forceFloating = false }) => {
  const isGenerating = useIDEStore((s) => s.isAgentGenerating);

  // Message popup state (dialogue or task completion)
  const [bubbleMessage, setBubbleMessage] = useState<{
    type: 'greeting' | 'completion';
    text: string;
  } | null>(null);

  const [greetingIndex, setGreetingIndex] = useState(0);

  const [isFloating] = useState(() => {
    try {
      return localStorage.getItem('sutra-pet-floating') !== 'false';
    } catch {
      return true;
    }
  });

  const [isVisible, setIsVisible] = useState(() => {
    try {
      return localStorage.getItem('sutra-pet-visible') !== 'false';
    } catch {
      return true;
    }
  });

  // Draggable screen coordinates
  const [position, setPosition] = useState<{ x?: number; y?: number }>(() => {
    try {
      const saved = localStorage.getItem('sutra-pet-pos');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number }>({ startX: 0, startY: 0, initX: 0, initY: 0 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);

  // Auto-play the video on mount
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.playsInline = true;
    v.play().catch(() => {
      const onUserInteraction = () => {
        v.play().catch(() => {});
        window.removeEventListener('pointerdown', onUserInteraction);
      };
      window.addEventListener('pointerdown', onUserInteraction);
    });
  }, []);

  // Listen to custom toggle events from header or settings
  useEffect(() => {
    const handleToggle = (e: CustomEvent<boolean>) => {
      setIsVisible(e.detail);
    };
    window.addEventListener('sutra-pet-toggle' as any, handleToggle as any);
    return () => window.removeEventListener('sutra-pet-toggle' as any, handleToggle as any);
  }, []);

  // Track generation transitions to show completion notification ONLY when a run finishes
  const prevGeneratingRef = useRef(isGenerating);

  useEffect(() => {
    // Detect completion: agent was generating and just stopped
    if (prevGeneratingRef.current && !isGenerating) {
      setBubbleMessage({
        type: 'completion',
        text: '🎉 Task completed! Code updated, verified, and ready.',
      });
      const timer = setTimeout(() => {
        setBubbleMessage(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
    prevGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  // Handle clicking the pet: opens cute cloud bubble with friendly greeting
  const handlePetClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDraggingRef.current) return;

    if (bubbleMessage) {
      // Toggle off if already showing
      setBubbleMessage(null);
      return;
    }

    const nextGreeting = GREETINGS[greetingIndex % GREETINGS.length];
    setGreetingIndex((i) => i + 1);
    setBubbleMessage({
      type: 'greeting',
      text: nextGreeting,
    });

    // Auto dismiss greeting after 6 seconds
    const timer = setTimeout(() => {
      setBubbleMessage((curr) => (curr?.type === 'greeting' ? null : curr));
    }, 6000);
    return () => clearTimeout(timer);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isFloating && !forceFloating) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[role="status"]')) return;

    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: rect.left,
      initY: rect.top,
    };
    isDraggingRef.current = false;

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - dragStartRef.current.startX;
      const dy = ev.clientY - dragStartRef.current.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        isDraggingRef.current = true;
        const newX = Math.max(10, Math.min(window.innerWidth - 80, dragStartRef.current.initX + dx));
        const newY = Math.max(10, Math.min(window.innerHeight - 80, dragStartRef.current.initY + dy));
        setPosition({ x: newX, y: newY });
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (isDraggingRef.current) {
        setPosition((curr) => {
          try { localStorage.setItem('sutra-pet-pos', JSON.stringify(curr)); } catch {}
          return curr;
        });
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  if (!isVisible) {
    return null;
  }

  // When forceFloating is false and isFloating is true, don't render on the composer;
  // instead it renders in the global floating container.
  if (isFloating && !forceFloating) {
    return null;
  }

  const isPositioned = (isFloating || forceFloating) && position.x !== undefined && position.y !== undefined;

  return (
    <div
      onPointerDown={handlePointerDown}
      style={isPositioned ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
      className={`${
        isFloating || forceFloating
          ? isPositioned
            ? 'fixed z-[999999] animate-in fade-in'
            : 'fixed bottom-24 right-8 z-[999999] animate-in fade-in slide-in-from-bottom-3'
          : 'relative inline-block'
      } select-none ${className}`}
    >
      {/* Cloud-Like Speech Balloon Popup (For Greetings & Task Completion) */}
      {bubbleMessage && (
        <div
          role="status"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 min-w-[200px] max-w-[270px] p-3 rounded-2xl bg-obsidian-surface2/95 border border-obsidian-border shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 text-xs font-sans text-obsidian-inkPrimary select-text"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-mono font-medium text-obsidian-inkSecondary">
              {bubbleMessage.type === 'completion' ? (
                <Sparkles className="w-3.5 h-3.5 text-obsidian-inkPrimary shrink-0" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-obsidian-inkSecondary shrink-0" />
              )}
              <span>{bubbleMessage.type === 'completion' ? 'Notification' : 'Sutra Pet'}</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBubbleMessage(null);
              }}
              className="p-1 rounded-md hover:bg-obsidian-surface3 text-obsidian-inkMuted hover:text-obsidian-inkPrimary transition-colors cursor-pointer"
              title="Close"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-obsidian-inkPrimary">
            {bubbleMessage.text}
          </p>

          {/* Cloud bubble pointer tail aligned directly with pet head */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-obsidian-surface2 border-r border-b border-obsidian-border rotate-45" />
        </div>
      )}

      {/* Pure Floating Pet Character (Drag to move, click to say hi) */}
      <div
        onClick={handlePetClick}
        title="Sutra Pet (Click to chat, drag to move)"
        className={`group relative cursor-grab active:cursor-grabbing transition-transform duration-200 hover:scale-105 active:scale-95 ${
          isGenerating ? 'animate-bounce-subtle' : ''
        }`}
      >
        {/* Transparent Pet Character Visual (No background box, no borders, no glow halo) */}
        <div className="w-28 h-28 sm:w-36 sm:h-36 bg-transparent relative select-none">
          <video
            ref={videoRef}
            poster="/assets/sutra-pet.jpg"
            autoPlay
            loop
            muted
            playsInline
            onCanPlay={() => setIsVideoReady(true)}
            onPlaying={() => setIsVideoReady(true)}
            className={`w-full h-full object-contain pointer-events-none bg-transparent transition-opacity duration-300 ${
              isVideoReady ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <source src="/assets/sutra-pet-walking-alpha.webm" type="video/webm" />
            <source src="/assets/sutra-pet-walking.webm" type="video/webm" />
            <source src="/assets/sutra-pet-walking.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
    </div>
  );
};
