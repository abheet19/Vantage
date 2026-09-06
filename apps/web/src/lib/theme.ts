/**
 * theme.ts — the manual theme and reduce-transparency toggles (03-UI §2.2, F10).
 *
 * Why it exists: 03-UI requires a manual light/dark switch and a reduce-transparency switch on top of the
 * CSS that already honours the OS (`prefers-color-scheme`, `prefers-reduced-transparency`). This hook
 * writes `data-theme` and `data-flat` on the document element — the two hooks the token CSS keys on — and
 * remembers both. The initial theme follows the OS until the user chooses, matching the token triad.
 */
import { useCallback, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';
const THEME_KEY = 'vantage.theme';
const FLAT_KEY = 'vantage.flat';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage disabled: the toggle still works for the session, it just does not persist.
  }
}

function initialTheme(): Theme {
  const saved = stored(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useTheme(): { theme: Theme; flat: boolean; toggleTheme: () => void; toggleFlat: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [flat, setFlat] = useState<boolean>(() => stored(FLAT_KEY) === '1');

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(() => {
    if (flat) document.documentElement.dataset['flat'] = '1';
    else delete document.documentElement.dataset['flat'];
  }, [flat]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      persist(THEME_KEY, next);
      return next;
    });
  }, []);

  const toggleFlat = useCallback(() => {
    setFlat((f) => {
      const next = !f;
      persist(FLAT_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  return { theme, flat, toggleTheme, toggleFlat };
}
