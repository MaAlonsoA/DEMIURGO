// The language the person reads DEMIURGO in: the interface and the reading translations of records.
// Records themselves are always in English. The person's choice lives in their session (PUT
// /api/session/locale); without one, the browser's language decides, and anything but Spanish
// reads in English.

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
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

/** The person's chosen language, or null when they follow the browser. */
export function useLocaleChoice(): Locale | null {
  const session = useQuery(sessionQuery).data;
  return isLocale(session?.locale) ? session.locale : null;
}

/** The language to show now. */
export function useLocale(): Locale {
  return useLocaleChoice() ?? browserLocale();
}

/** Keeps <html lang> in step with the language shown (screen readers, hyphenation). */
export function useDocumentLanguage(): void {
  const locale = useLocale();
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);
}
