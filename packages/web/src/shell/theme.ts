// The theme the person pinned (DESIGN.md §6.1, D-010): System follows prefers-color-scheme; Light
// and Dark set data-theme on <html>, which sets the color-scheme that the tokens' light-dark() read.
// A per-browser preference; storage may be unavailable, and then System stays.

import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'dm-theme';
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let current: ThemeChoice = typeof window === 'undefined' ? 'system' : read();

function apply(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

apply(current);

export function setTheme(choice: ThemeChoice): void {
  current = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Kept for this visit only.
  }
  apply(choice);
  for (const l of listeners) l();
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => current,
    () => 'system',
  );
}
