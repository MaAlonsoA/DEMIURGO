// Reading a record in the person's language. Records are always in English; when the person reads
// in another language, their prose comes translated from GET …/translations/:subject/:id, marked as
// a translation and one click away from the original. A translation is never what gets accepted:
// the actions always act on the English record.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api/client.ts';
import { translationQuery } from '../api/queries.ts';
import { LanguagesIcon } from '../components/icons.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { cn } from '../lib/cn.ts';
import { messages, useMessages } from './define.ts';
import { useLocale } from './locale.ts';

export type ReadingSubject = 'question' | 'message' | 'proposal' | 'record_version' | 'exploration';

const WORDS = messages(
  {
    translated: 'Translated',
    original: 'Original in English',
    translating: 'Translating…',
    showOriginal: 'Show the original',
    showTranslation: 'Show the translation',
    why: 'A translation for reading, by DEMIURGO. What you accept is always the English text.',
    failed: (message: string) => `Couldn't translate it: ${message}`,
    translatedBy: (by: string) => `Translated by ${by}.`,
  },
  {
    translated: 'Traducido',
    original: 'Original en inglés',
    translating: 'Traduciendo…',
    showOriginal: 'Ver el original',
    showTranslation: 'Ver la traducción',
    why: 'Una traducción para leer, hecha por DEMIURGO. Lo que aceptas es siempre el texto en inglés.',
    failed: (message: string) => `No se pudo traducir: ${message}`,
    translatedBy: (by: string) => `Traducido por ${by}.`,
  },
);

export type Reading = {
  /** The text to show for a field: its translation when there is one and it's on, else the original. */
  text: (key: string, original: string) => string;
  /** The same, for a text that may be missing. */
  maybe: (key: string, original: string | null | undefined) => string | null;
  /** The mark that says it's a translation and switches to the original; null when there's nothing to mark. */
  mark: React.ReactNode;
  /** The translated fields when they're shown, else null. */
  fields: Readonly<Record<string, string>> | null;
};

/** The prose of a record in the language shown now. `id` null (or reading in English) keeps the original. */
export function useReading(projectId: string, subject: ReadingSubject, id: string | null | undefined): Reading {
  const locale = useLocale();
  const [original, setOriginal] = useState(false);
  const enabled = locale !== 'en' && !!id;
  const q = useQuery({ ...translationQuery(projectId, subject, id ?? '', locale), enabled });
  const t = useMessages(WORDS);

  const translated = enabled && !original && q.data?.translated ? q.data.fields : null;
  const text = (key: string, value: string) => translated?.[key] ?? value;
  const maybe = (key: string, value: string | null | undefined) => (value ? text(key, value) : null);

  let mark: React.ReactNode = null;
  if (enabled && q.isPending) {
    mark = <ReadingNote icon>{t.translating}</ReadingNote>;
  } else if (enabled && q.isError) {
    const message = q.error instanceof ApiError ? q.error.message : String(q.error);
    mark = <ReadingNote>{t.failed(message)}</ReadingNote>;
  } else if (enabled && q.data?.translated) {
    const tip = q.data.by ? `${t.why} ${t.translatedBy(q.data.by)}` : t.why;
    mark = (
      <span className="inline-flex items-center gap-1.5 text-sm text-fg-3" data-reading={original ? 'original' : 'translated'}>
        <Tooltip content={tip}>
          <button type="button" className="inline-flex cursor-help items-center gap-1 rounded-md" aria-label={tip}>
            <LanguagesIcon size={13} />
            {original ? t.original : t.translated}
          </button>
        </Tooltip>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="cursor-pointer rounded-md text-accent-text underline-offset-2 hover:underline"
          aria-pressed={original}
          onClick={() => setOriginal((v) => !v)}
        >
          {original ? t.showTranslation : t.showOriginal}
        </button>
      </span>
    );
  }
  return { text, maybe, mark, fields: translated };
}

function ReadingNote({ children, icon }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm text-fg-3')} aria-live="polite">
      {icon ? <LanguagesIcon size={13} /> : null}
      {children}
    </span>
  );
}

/** A copy of `value` with the translated texts at their paths (`sections.0.content`); the rest as is. */
export function withTranslation<T>(value: T, fields: Readonly<Record<string, string>> | null): T {
  if (!fields) return value;
  const copy = structuredClone(value) as unknown;
  for (const [path, text] of Object.entries(fields)) {
    const keys = path.split('.');
    let node = copy as Record<string, unknown> | unknown[] | null;
    for (const k of keys.slice(0, -1)) {
      node = node && typeof node === 'object' ? ((node as Record<string, unknown>)[k] as typeof node) : null;
    }
    const last = keys.at(-1);
    if (node && typeof node === 'object' && last !== undefined && typeof (node as Record<string, unknown>)[last] === 'string') {
      (node as Record<string, unknown>)[last] = text;
    }
  }
  return copy as T;
}

/** A whole structure (a proposal's payload) in the language shown, with its mark. */
export function useReadingOf<T>(
  projectId: string,
  subject: ReadingSubject,
  id: string | null | undefined,
  value: T,
): { value: T; mark: React.ReactNode } {
  const reading = useReading(projectId, subject, id);
  return { value: withTranslation(value, reading.fields), mark: reading.mark };
}
