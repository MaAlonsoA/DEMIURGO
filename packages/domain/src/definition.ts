// The product definition (PRD): what the product is, what it builds first and how. The system
// composes it, without AI, from the answers a person confirmed in the product definition stage: each
// section is one confirmed conclusion and keeps the question it comes from. A person accepts it; its
// changes are new versions, each with what changed and why. Pure.

import { VERSION_LIMITS, type Section } from './records.ts';

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
      sections.push({ title: s.title, content: q.conclusion?.trim() || 'Confirmed without an answer.' });
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
  const before = new Map(previous.map((s) => [s.title, s.content.trim()]));
  const changed = next.filter((s) => before.get(s.title) !== s.content.trim()).map((s) => s.title);
  const removed = previous.filter((s) => !next.some((n) => n.title === s.title)).map((s) => s.title);
  return [...changed, ...removed];
}

/** The change note of a new version: which sections changed and, for each, why. */
export function definitionChangeNote(changes: readonly { section: string; why: string | null }[]): string {
  const lines = changes.map((c) => `${c.section}: ${c.why?.trim() || 'its answer changed.'}`);
  const note = `Changed: ${changes.map((c) => c.section).join(', ')}.\n\n${lines.join('\n')}`;
  return note.length > VERSION_LIMITS.changeNote ? `${note.slice(0, VERSION_LIMITS.changeNote - 1).trimEnd()}…` : note;
}

const normalized = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Whether a quote is really in a text: the same words, ignoring case and spacing. An inference rests
 * on the person's exact words, so a quote an agent paraphrased or made up is not evidence.
 */
export function quoteFound(quote: string, text: string): boolean {
  const q = normalized(quote);
  return q.length > 0 && normalized(text).includes(q);
}
