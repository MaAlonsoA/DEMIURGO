// Pure logic of the Questions tab (canvas B2): the questions of the thread a version comes from
// that were shown in it, open first; the short answer of the Confirm button; and whether the readiness of the version
// cites a question, in the words the server gives.

import { questionReason } from '../../../../domain/src/records.ts';
import type { Question, Readiness } from '../../api/types.ts';

export type QuestionGroups = {
  /** Pending, then assumed (inferred): what can still be answered here. */
  open: Question[];
  answered: Question[];
  notNow: Question[];
  doesNotApply: Question[];
};

const byCreation = (a: Question, b: Question) => a.created_at.localeCompare(b.created_at);

export function questionGroups(questions: readonly Question[]): QuestionGroups {
  // Questions still in the thread's reserve (not shown yet) aren't asked yet: Needs you doesn't
  // show them either (INVENTORY INV-REC, UX problem: mismatch with Needs you).
  const sorted = questions.filter((q) => q.shown_at !== null).toSorted(byCreation);
  const inState = (...states: string[]) => sorted.filter((q) => states.includes(q.state));
  return {
    open: [...inState('pending'), ...inState('inferred')],
    answered: inState('confirmed'),
    notNow: inState('postponed'),
    doesNotApply: inState('discarded'),
  };
}

/** The assumed answer said short for its button ("Confirm: organizers set a limit"). */
export function shortAnswer(text: string, max = 44): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean.replace(/[.。]$/, '');
  const cut = clean.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return `${clean.slice(0, space > max / 2 ? space : max).trimEnd()}…`;
}

/** The level DEMIURGO gave to a question (question.raise takes high, medium or low). */
export const IMPACT_WORDS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export type Citation = { cited: boolean; text: string; reason: string | null };

/**
 * Whether "Before it can be built" cites the question: the server names each pending, postponed
 * or assumed question of the origin thread in a reason of its own. A decision has no readiness: null.
 */
export function readinessCitation(
  question: Pick<Question, 'id' | 'state' | 'question'>,
  readiness: Readiness | null,
): Citation | null {
  if (!readiness) return null;
  const expected = questionReason(question.state, question.question);
  const reason = readiness.reasons.find((r) => r === expected) ?? null;
  if (!reason) return { cited: false, text: "Its readiness doesn't cite it.", reason: null };
  const text =
    question.state === 'inferred'
      ? 'Yes. It waits until you confirm the answer DEMIURGO assumed.'
      : 'Yes. It waits on this question of its thread.';
  return { cited: true, text, reason };
}
