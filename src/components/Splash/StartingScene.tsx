import React, { useEffect, useState } from 'react';

interface StartingSceneProps {
  onComplete: () => void;
  duration?: number;
}

export const StartingScene: React.FC<StartingSceneProps> = ({ onComplete, duration = 1200 }) => {
  const [progress, setProgress] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / (duration - 400)) * 100));
      setProgress(pct);

      if (elapsed >= duration - 400 && !isFadingOut) {
        setIsFadingOut(true);
      }

      if (elapsed >= duration) {
        clearInterval(interval);
        onComplete();
      }
    }, 40);

    const handleSkip = () => {
      setIsFadingOut(true);
      setTimeout(onComplete, 300);
    };

    window.addEventListener('keydown', handleSkip);
    window.addEventListener('mousedown', handleSkip);

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleSkip);
      window.removeEventListener('mousedown', handleSkip);
    };
  }, [duration, isFadingOut, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-obsidian-canvas text-obsidian-inkPrimary select-none transition-opacity duration-500 ease-out font-sans ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Logo */}
      <img
        src="/assets/sutra-icon.svg"
        alt="SUTRA"
        className="w-20 h-20 object-contain mb-6"
      />

      {/* Wordmark */}
      <div className="text-2xl font-light tracking-[0.3em] text-obsidian-inkPrimary uppercase mb-8">SUTRA</div>

      {/* Minimal progress line */}
      <div className="w-44 h-[2px] bg-obsidian-surface2 rounded-full overflow-hidden">
        <div
          className="h-full bg-white/80 transition-all duration-75 rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
