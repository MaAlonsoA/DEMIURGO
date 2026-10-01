// The product definition (DEF): what the product is, what it builds first and how. The system
// composes it, without AI, from the answers a person confirmed in the product definition stage: each
// section is one confirmed conclusion and keeps the question it comes from. A person accepts it; its
// changes are new versions, each with what changed and why. Pure.

import { VERSION_LIMITS, type Section } from './records.ts';
import { stageQuestionMultiple } from './stages.ts';

/** The stage whose answers make the definition. */
export const DEFINITION_STAGE = 'requirements';
export const DEFINITION_TITLE = 'Product definition';

/** Each section of the definition and the stage question it comes from, in the template's order. */
export const DEFINITION_SECTIONS = [
  { title: 'Purpose', key: 'purpose' },
  { title: 'Outcomes', key: 'outcomes' },
  { title: 'Principles', key: 'principles' },
  { title: 'Users', key: 'stakeholders' },
  { title: 'Problem', key: 'problem' },
  { title: 'First version', key: 'features' },
  { title: 'Out of scope', key: 'scope_out' },
  { title: 'Constraints', key: 'constraints' },
] as const;

export type DefinitionSectionTitle = (typeof DEFINITION_SECTIONS)[number]['title'];

/** The section titles, for the schemas that name one (a change proposed from a thread). */
export const DEFINITION_SECTION_TITLES = DEFINITION_SECTIONS.map((s) => s.title) as [
  DefinitionSectionTitle,
  ...DefinitionSectionTitle[],
];

export type DefinitionQuestion = {
  id: string;
  key: string;
  state: string;
  conclusion: string | null;
  state_reason: string | null;
};

/** Where a section comes from: its question, confirmed or discarded, or none when it was never asked. */
export type DefinitionSource = {
  section: string;
  key: string;
  question_id: string | null;
  state: 'confirmed' | 'discarded' | 'missing';
};

export type ComposedDefinition = { title: string; sections: Section[]; sources: DefinitionSource[] };

const BULLET = /^\s*(?:[-*\u2022]\s+)/;

/**
 * The items of a list answer: one per line, or joined with « · » as a multiple choice joins its picks
 * (the thread's separator). A leading bullet mark is dropped. Empty lines are ignored.
 */
export function answerItems(text: string): string[] {
  return text
    .split(/\n| \u00b7 /)
    .map((l) => l.replace(BULLET, '').trim())
    .filter(Boolean);
}

/**
 * A list answer as a Markdown bullet list, so each item reads on its own line (a plain newline would
 * collapse into one sentence). One item stays as written: it is not a list.
 */
export function answerBullets(text: string): string {
  const items = answerItems(text);
  return items.length < 2 ? text.trim() : items.map((i) => `- ${i}`).join('\n');
}

/** A section whose question the project never had (its stage opened before the question existed). */
export const NOT_ASKED = 'Not asked when this stage opened.';

/**
 * The definition made of the stage's answers, or null while any of its questions is still open
 * (pending, assumed or postponed): nothing is composed on an answer no person gave.
 */
export function composeDefinition(questions: readonly DefinitionQuestion[]): ComposedDefinition | null {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const sections: Section[] = [];
  const sources: DefinitionSource[] = [];
  for (const s of DEFINITION_SECTIONS) {
    const q = byKey.get(s.key);
    if (!q) {
      sections.push({ title: s.title, content: NOT_ASKED });
      sources.push({ section: s.title, key: s.key, question_id: null, state: 'missing' });
      continue;
    }
    if (q.state === 'confirmed') {
      const answer = q.conclusion?.trim();
      // A list question keeps its items apart: one bullet each, never run together in one sentence.
      const content = answer ? (stageQuestionMultiple(DEFINITION_STAGE, s.key) ? answerBullets(answer) : answer) : 'Confirmed without an answer.';
      sections.push({ title: s.title, content });
      sources.push({ section: s.title, key: s.key, question_id: q.id, state: 'confirmed' });
    } else if (q.state === 'discarded') {
      const reason = q.state_reason?.trim();
      sections.push({ title: s.title, content: reason ? `Left open: ${reason}` : 'Left open.' });
      sources.push({ section: s.title, key: s.key, question_id: q.id, state: 'discarded' });
    } else return null;
  }
  return { title: DEFINITION_TITLE, sections, sources };
}

/** The titles of the sections whose content differs between two versions, in the next one's order. */
export function definitionChanges(previous: readonly Section[], next: readonly Section[]): string[] {
  // Compared by items, so a list written as plain lines and the same list as bullets are the same text.
  const same = (s: string) => answerItems(s).join('\n');
  const before = new Map(previous.map((s) => [s.title, same(s.content)]));
  const changed = next.filter((s) => before.get(s.title) !== same(s.content)).map((s) => s.title);
  const removed = previous.filter((s) => !next.some((n) => n.title === s.title)).map((s) => s.title);
  return [...changed, ...removed];
}

/** The change note of a new version: which sections changed and, for each, why. */
export function definitionChangeNote(changes: readonly { section: string; why: string | null }[]): string {
  const lines = changes.map((c) => `${c.section}: ${c.why?.trim() || 'its answer changed.'}`);
  const note = `Changed: ${changes.map((c) => c.section).join(', ')}.\n\n${lines.join('\n')}`;
  return note.length > VERSION_LIMITS.changeNote ? `${note.slice(0, VERSION_LIMITS.changeNote - 1).trimEnd()}…` : note;
}

/**
 * The reason a change note gives for each changed section, in the form `definitionChangeNote` writes
 * it ("Changed: A, B." and then one "Section: why" line per section).
 */
export function changeReasons(note: string | null | undefined): { section: string; why: string }[] {
  const reasons: { section: string; why: string }[] = [];
  for (const line of (note ?? '').split('\n')) {
    const m = /^([^:]+):\s*(.+)$/.exec(line.trim());
    const section = m?.[1]?.trim();
    if (section && m?.[2] && section !== 'Changed') reasons.push({ section, why: m[2].trim() });
  }
  return reasons;
}

/**
 * The longest a quote of the person's words can be: as long as a message. The server already checks
 * that each quote is in what they wrote, so a shorter cap would only drop good answers.
 */
export const QUOTE_MAX = 20_000;

const normalized = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Whether a quote is really in a text: the same words, ignoring case and spacing. An inference rests
 * on the person's exact words, so a quote an agent paraphrased or made up is not evidence.
 */
export function quoteFound(quote: string, text: string): boolean {
  const q = normalized(quote);
  return q.length > 0 && normalized(text).includes(q);
}

type Word = { key: string; start: number; end: number };

/** The words of a text with where each one is, compared without case, accents or punctuation. */
function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const key = m[0]
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
    if (key) words.push({ key, start: m.index, end: m.index + m[0].length });
  }
  return words;
}

/**
 * The person's own words that a quote copies, closely enough: the passage of `text` whose words
 * differ from the quote's in at most one word in five (a word changed, added or left out), ignoring
 * case, accents, punctuation and spacing. An agent that copied a quote almost exactly keeps its
 * evidence, and the evidence is what the person wrote, not the agent's copy. Null if there is none.
 */
export function matchQuote(quote: string, text: string): { text: string; changes: number } | null {
  const q = wordsOf(quote);
  const t = wordsOf(text);
  const allowed = Math.floor(q.length / 5);
  if (q.length === 0) return null;
  if (q.length <= t.length + allowed) {
    // Approximate substring matching by words (Sellers): the passage may start at any word of the text.
    let cost = Array.from({ length: q.length + 1 }, (_, i) => i);
    let from = Array.from({ length: q.length + 1 }, () => 0);
    let best: { changes: number; start: number; end: number } | null = null;
    for (let j = 1; j <= t.length; j++) {
      const c = [0];
      const f = [j];
      for (let i = 1; i <= q.length; i++) {
        const same = (cost[i - 1] as number) + (q[i - 1]?.key === t[j - 1]?.key ? 0 : 1);
        const extra = (cost[i] as number) + 1;
        const missing = (c[i - 1] as number) + 1;
        const min = Math.min(same, extra, missing);
        c.push(min);
        f.push(min === same ? (from[i - 1] as number) : min === extra ? (from[i] as number) : (f[i - 1] as number));
      }
      cost = c;
      from = f;
      const changes = cost[q.length] as number;
      const start = from[q.length] as number;
      if (start < j && changes <= allowed && (!best || changes < best.changes)) best = { changes, start, end: j };
    }
    if (best) {
      const passage = text.slice(t[best.start]?.start, t[best.end - 1]?.end).replace(/[,;:]+$/, '');
      return { text: passage, changes: best.changes };
    }
  }
  return quoteFound(quote, text) ? { text: quote.trim(), changes: 0 } : null;
}

/**
 * Where a quote is in what the person wrote (`said`): the message and their exact words there, from
 * the message it matches best. Null if it is in none of them.
 */
export function findQuote(
  quote: string,
  said: readonly { id: string; body: string }[],
): { message_id: string; quote: string } | null {
  let best: { message_id: string; quote: string; changes: number } | null = null;
  for (const m of said) {
    const found = matchQuote(quote, m.body);
    if (found && (!best || found.changes < best.changes)) best = { message_id: m.id, quote: found.text, changes: found.changes };
    if (best?.changes === 0) break;
  }
  return best && { message_id: best.message_id, quote: best.quote };
}
