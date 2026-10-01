// Pure formatting and reading helpers of the Observability screen (unit-tested). Strings that a person
// reads live in words.i18n.ts; these only produce numbers and kinds.

import type { Correlation } from './types.ts';

const nf = (locale: string, max: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: max });

/** «—» for a missing number, else the number with at most `max` decimals. */
export function num(locale: string, v: number | null | undefined, max = 1): string {
  return v === null || v === undefined ? '—' : nf(locale, max).format(v);
}

/** Minutes with their unit: «45.2 min», «2 h 5 min» from 120 minutes on. */
export function minutesText(locale: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v < 120) return `${num(locale, v)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v - h * 60);
  return `${h} h ${m} min`;
}

/** Tokens, thousands abbreviated: 1,234 → «1.2k», 2,500,000 → «2.5M». */
export function tokensText(locale: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v >= 1_000_000) return `${num(locale, v / 1_000_000)}M`;
  if (v >= 1_000) return `${num(locale, v / 1_000)}k`;
  return num(locale, v, 0);
}

/** A cost the provider declared, in US dollars; «—» when none was. */
export function costText(locale: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `$${num(locale, v, v < 1 ? 3 : 2)}`;
}

/** A share 0–1 as a whole percent. */
export function shareText(locale: string, v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${num(locale, v * 100, 0)}%`;
}

export type CorrelationReading =
  | { kind: 'none' }
  | { kind: 'few'; n: number }
  | { kind: 'weak' | 'moderate' | 'strong'; direction: 'up' | 'down'; rho: number; n: number };

/** Fewer tasks than this say too little (our convention, not a statistical threshold). */
export const MIN_TASKS_FOR_READING = 8;

/**
 * A plain reading of a rank correlation. The bands (below 0.3 weak, below 0.6 moderate, else strong) and the
 * minimum of tasks are «convención nuestra»: a rule of thumb for a sober reading, not a significance test.
 */
export function correlationReading(c: Correlation | null): CorrelationReading {
  if (!c) return { kind: 'none' };
  if (c.n < MIN_TASKS_FOR_READING) return { kind: 'few', n: c.n };
  const a = Math.abs(c.rho);
  return { kind: a < 0.3 ? 'weak' : a < 0.6 ? 'moderate' : 'strong', direction: c.rho >= 0 ? 'up' : 'down', rho: c.rho, n: c.n };
}
