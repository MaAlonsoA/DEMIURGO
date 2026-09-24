// Pure logic of the Questions tab (canvas B2): the questions of the thread a version comes from,
// open first; the short answer of the Confirm button; and whether the readiness of the version
// cites a question, in the words the server gives.

import type { Question, Readiness, RecordVersion } from '../../api/types.ts';

export type QuestionGroups = {
  /** Pending, then assumed (inferred): what can still be answered here. */
  open: Question[];
  answered: Question[];
  notNow: Question[];
  doesNotApply: Question[];
};

const byCreation = (a: Question, b: Question) => a.created_at.localeCompare(b.created_at);

export function questionGroups(questions: readonly Question[]): QuestionGroups {
  const sorted = questions.toSorted(byCreation);
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

const PENDING = /pending question/i;
const POSTPONED = /postponed question/i;

/**
 * Whether "Before it can be built" cites the question. The server counts the pending and
 * postponed questions of the origin thread among its reasons, and lists the assumed ones apart.
 * A decision has no readiness: null.
 */
export function readinessCitation(
  question: Pick<Question, 'id' | 'state'>,
  inferred: RecordVersion['inferred_questions'],
  readiness: Readiness | null,
): Citation | null {
  if (!readiness) return null;
  const pattern = question.state === 'pending' ? PENDING : question.state === 'postponed' ? POSTPONED : null;
  const reason = pattern ? (readiness.reasons.find((r) => pattern.test(r)) ?? null) : null;
  if (reason) {
    return { cited: true, text: 'Yes. It waits on the open questions of its thread, this one among them.', reason };
  }
  if (question.state === 'inferred' && inferred.some((i) => i.id === question.id)) {
    return {
      cited: true,
      text: "It doesn't block it, but it is listed as an assumed answer until you confirm it.",
      reason: null,
    };
  }
  return { cited: false, text: "Its readiness doesn't cite it.", reason: null };
}
