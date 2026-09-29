// The language the person reads DEMIURGO in: the interface and the reading translations of records.
// Records themselves are always in English. The person's choice lives in their session (PUT
// /api/session/locale); without one, the browser's language decides, and anything but Spanish
// reads in English. Like the theme, it's a small store: the app root keeps it in step with the
// session, and any component reads it without needing the query client.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { sessionQuery } from '../api/queries.ts';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

/** Each language named in itself, for the language picker. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', es: 'Español' };

export function browserLocale(): Locale {
  const lang = typeof navigator === 'undefined' ? 'en' : (navigator.language ?? 'en');
  return lang.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

// The person's choice (null: follow the browser), as the session last said it.
let choice: Locale | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sets the person's choice (the app root does it from the session). */
export function setLocaleChoice(next: Locale | null): void {
  if (next === choice) return;
  choice = next;
  for (const l of listeners) l();
}

/** The person's chosen language, or null when they follow the browser. */
export function useLocaleChoice(): Locale | null {
  return useSyncExternalStore(
    subscribe,
    () => choice,
    () => choice,
  );
}

/** The language to show now. */
export function useLocale(): Locale {
  return useLocaleChoice() ?? browserLocale();
}

/** At the app root: keeps the store in step with the session and <html lang> with the language shown. */
export function useSessionLocale(): void {
  const session = useQuery(sessionQuery).data;
  const fromSession = isLocale(session?.locale) ? session.locale : null;
  useEffect(() => setLocaleChoice(fromSession), [fromSession]);
  const locale = useLocale();
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);
}

// The language the person reads the project's content in (records, questions, the conversation),
// apart from the interface's: someone may keep the interface in English and read the content in
// Spanish. Null follows the interface. It lives in this browser.
const READING_KEY = 'demiurgo.reading-locale';

function storedReading(): Locale | null {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(READING_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

let readingChoice: Locale | null = storedReading();

/** Sets the content's language (null: like the interface). */
export function setReadingLocaleChoice(next: Locale | null): void {
  if (next === readingChoice) return;
  readingChoice = next;
  try {
    if (next) localStorage.setItem(READING_KEY, next);
    else localStorage.removeItem(READING_KEY);
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
  for (const l of listeners) l();
}

/** The person's chosen content language, or null when it follows the interface. */
export function useReadingLocaleChoice(): Locale | null {
  return useSyncExternalStore(
    subscribe,
    () => readingChoice,
    () => readingChoice,
  );
}

/** The language the project's content is read in now. */
export function useReadingLocale(): Locale {
  const interfaceLocale = useLocale();
  return useReadingLocaleChoice() ?? interfaceLocale;
}
