// Pure logic of the header search (canvas B1): where a result goes and which of its words match.
// The API searches the current knowledge (…/knowledge/search). A node's ref is CODE@n for a
// record and AC-DOM-NNN-MM@n for a check, whose record is the one sharing its DOM-NNN (a code's
// DOM-NNN part is unique across types). It does not say where the words matched: the matched
// words are found here, ignoring case and accents, at the start of a word.

import type { ProductRow } from '../../api/types.ts';

export type SearchTarget = { code: string; v: number; tab?: 'checks' };

const RECORD_REF = /^((?:DEC|FDR|ADR|BUG)-[A-Z0-9]{3}-\d{3})@(\d+)$/;
const CHECK_REF = /^AC-([A-Z0-9]{3}-\d{3})-\d+@(\d+)$/;

export function searchTarget(
  hit: { ref: string; type: string },
  rows: readonly Pick<ProductRow, 'code'>[] | undefined,
): SearchTarget | null {
  const record = RECORD_REF.exec(hit.ref);
  if (record?.[1]) return { code: record[1], v: Number(record[2]) };
  const check = CHECK_REF.exec(hit.ref);
  if (!check?.[1] || !rows) return null;
  const tail = check[1];
  const owner = rows.find((r) => r.code.slice(4) === tail);
  return owner ? { code: owner.code, v: Number(check[2]), tab: 'checks' } : null;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The stem of a searched word, roughly as the full-text search takes it: a long word loses its
 * plural or its last vowel, so "activity" also marks "activities" and "places" marks "place".
 */
function stem(word: string): string {
  if (word.length < 5) return word;
  const bare = word.replace(/(?:ies|es|s|y|e|a|o)$/, '');
  return bare.length >= 4 ? bare : word;
}

function terms(query: string): string[] {
  return [
    ...new Set(
      fold(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 2)
        .map(stem),
    ),
  ];
}

/** Ranges [start, end) of the text where a word starts with (the stem of) a searched word. */
export function matchRanges(text: string, query: string): [number, number][] {
  const words = terms(query);
  if (words.length === 0) return [];
  // The folded text, with where each of its code units comes from in the original.
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join('|')})`, 'gu');
  const ranges: [number, number][] = [];
  for (const m of folded.matchAll(pattern)) {
    const start = starts[m.index] ?? 0;
    const end = ends[m.index + m[0].length - 1] ?? start;
    // A match that starts a word covers the whole word: "sign" marks "Signing".
    let stop = end;
    while (stop < text.length && /[\p{L}\p{N}\p{M}]/u.test(text[stop] ?? '')) stop++;
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], stop);
    else ranges.push([start, stop]);
  }
  return ranges;
}

export type Segment = { text: string; match: boolean };

export function highlight(text: string, query: string): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  for (const [start, end] of matchRanges(text, query)) {
    if (start > at) segments.push({ text: text.slice(at, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    at = end;
  }
  if (at < text.length || segments.length === 0) segments.push({ text: text.slice(at), match: false });
  return segments;
}

/** The first `max` characters, cut at a word. */
function head(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  if (!/[\p{L}\p{N}]/u.test(text[max] ?? '')) return cut.trimEnd();
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : cut).trimEnd();
}

/** A window of the text around its first match, so the matched words are in sight. */
export function snippet(text: string, query: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const first = matchRanges(clean, query)[0]?.[0] ?? -1;
  if (first < max * 0.6) return `${head(clean, max)}…`;
  let start = Math.max(0, first - Math.floor(max / 3));
  const space = clean.indexOf(' ', start);
  if (space !== -1 && space < first) start = space + 1;
  const rest = clean.slice(start);
  return `…${rest.length > max ? `${head(rest, max)}…` : rest}`;
}
