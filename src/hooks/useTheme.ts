import { useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'sutra-theme';

const readStoredTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* localStorage may be blocked; fall through */
  }
  return 'dark';
};

const applyTheme = (mode: ThemeMode): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.classList.toggle('dark', mode === 'dark');
};

/**
 * Reactive theme controller. Hydrates from localStorage on first read, reflects
 * the chosen mode onto <html data-theme>, and persists every change so the user's
 * preference survives reloads.
 */
export const useTheme = (): { theme: ThemeMode; toggleTheme: () => void; setTheme: (m: ThemeMode) => void } => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const initial = readStoredTheme();
    applyTheme(initial);
    return initial;
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* best-effort; ignore storage failures */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), []);

  return { theme, toggleTheme, setTheme };
};
