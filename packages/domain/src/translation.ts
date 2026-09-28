// Reading translations. Records are always in English; a person reads them in their own language
// through a translation that is never authority. Pure: which fields of each subject get
// translated, the fingerprint of the source and the translator's output contract.

import { z } from 'zod';
import { fingerprint } from './fingerprint.ts';

/** Languages a person can read DEMIURGO in. English is the records' language. */
export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', es: 'Spanish' };

/** Things a person reads that carry record text. */
export const TRANSLATION_SUBJECTS = ['question', 'message', 'proposal', 'record_version', 'exploration'] as const;
export type TranslationSubject = (typeof TRANSLATION_SUBJECTS)[number];

/** Flat map of what gets translated: a stable key (a path) → its English text. */
export type TranslationFields = Readonly<Record<string, string>>;

// Keys whose values are codes, enums or references, never prose.
const NOT_PROSE = new Set([
  'type',
  'record_type',
  'verification',
  'impact',
  'ref',
  'code',
  'id',
  'question_id',
  'record_id',
  'exploration_id',
  'message_id',
  'kind',
  'state',
  'domain',
  'carry',
]);

/** The prose strings of a JSON value, keyed by their path (`sections.0.content`). */
export function proseFields(value: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (v: unknown, path: string, key: string) => {
    if (typeof v === 'string') {
      if (v.trim() && !NOT_PROSE.has(key)) out[path] = v;
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i), key));
    } else if (typeof v === 'object' && v !== null) {
      for (const [k, item] of Object.entries(v)) walk(item, path ? `${path}.${k}` : k, k);
    }
  };
  walk(value, prefix, '');
  return out;
}

export type QuestionSource = {
  question: string;
  reason: string | null;
  conclusion: string | null;
  reasoning: string | null;
  options: readonly { answer: string; implies: string }[];
};

export function questionFields(q: QuestionSource): TranslationFields {
  return proseFields({
    question: q.question,
    reason: q.reason,
    conclusion: q.conclusion,
    reasoning: q.reasoning,
    options: q.options.map((o) => ({ answer: o.answer, implies: o.implies })),
  });
}

export type VersionSource = {
  title: string;
  sections: readonly { title: string; content: string }[];
  criteria: readonly { code: string; title: string; statement: string; check_text: string }[];
};

/** A version's prose; criteria are keyed by their code, which doesn't change between versions. */
export function versionFields(v: VersionSource): TranslationFields {
  const fields: Record<string, string> = proseFields({ title: v.title, sections: v.sections });
  for (const c of v.criteria) {
    Object.assign(fields, proseFields({ title: c.title, statement: c.statement, check: c.check_text }, `criteria.${c.code}`));
  }
  return fields;
}

/** Fingerprint of what was translated: a changed source gets a new translation. */
export function translationSourceHash(subject: TranslationSubject, fields: TranslationFields): string {
  return fingerprint({ subject, fields });
}

const MAX_FIELDS = 200;

/** The translator's output: every key it received, translated. */
export const translationOutput = z
  .object({
    fields: z.array(z.object({ key: z.string().min(1).max(300), text: z.string().max(12000) }).strict()).max(MAX_FIELDS),
  })
  .strict();

export type TranslationOutput = z.infer<typeof translationOutput>;

export function translationJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(translationOutput, { target: 'draft-7' });
}

/**
 * The translated fields, or the reason the output can't be used: every key sent comes back once,
 * with no key that wasn't sent. An empty text keeps the original.
 */
export function readTranslation(
  sent: TranslationFields,
  output: TranslationOutput,
): { ok: true; fields: Record<string, string> } | { ok: false; problem: string } {
  const fields: Record<string, string> = {};
  for (const f of output.fields) {
    if (!(f.key in sent)) return { ok: false, problem: `The translation has a key that wasn't sent: ${f.key}.` };
    if (f.key in fields) return { ok: false, problem: `The translation repeats the key ${f.key}.` };
    fields[f.key] = f.text.trim() ? f.text : (sent[f.key] as string);
  }
  const missing = Object.keys(sent).filter((k) => !(k in fields));
  if (missing.length > 0) return { ok: false, problem: `The translation is missing ${missing.join(', ')}.` };
  return { ok: true, fields };
}

export function tooManyFields(fields: TranslationFields): boolean {
  return Object.keys(fields).length > MAX_FIELDS;
}
