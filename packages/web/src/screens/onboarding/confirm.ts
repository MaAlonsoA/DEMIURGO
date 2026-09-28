// Day 1's block of answers (pure): the product definition stage's questions still open, in the
// definition's order, and the commands that settle them all at once. An answer DEMIURGO read in the
// idea is confirmed as it is unless the person corrected it; one the idea doesn't give needs the
// person's answer or is left open on purpose (discarded with a reason, so the definition says so).

import type { CommandCall } from '../../api/commands.ts';
import type { Question } from '../../api/types.ts';
import { DEFINITION_KEYS } from '../overview/definition.ts';

/** Stored with a question left open on Day 1 (records are in English). */
export const LEFT_OPEN_REASON = 'Left open on Day 1.';

export type Answer = { text: string; open: boolean };

const order = (q: Question) => {
  const i = (DEFINITION_KEYS as readonly string[]).indexOf(q.stage_key ?? '');
  return i < 0 ? DEFINITION_KEYS.length : i;
};

/** The stage's questions still open (assumed or pending), in the definition's order. */
export function openItems(questions: readonly Question[], stageId: string): Question[] {
  return questions
    .filter((q) => q.stage_id === stageId && q.stage_key && (q.state === 'pending' || q.state === 'inferred'))
    .toSorted((a, b) => order(a) - order(b));
}

/** What the person has for a question before touching it: what DEMIURGO read, or nothing. */
export function initialAnswer(q: Question): Answer {
  return { text: q.state === 'inferred' ? (q.conclusion ?? '') : '', open: false };
}

/** Whether every item has an answer or is left open. */
export function missingAnswers(items: readonly Question[], answers: Readonly<Record<string, Answer>>): number {
  return items.filter((q) => {
    const a = answers[q.id] ?? initialAnswer(q);
    return !a.open && !a.text.trim();
  }).length;
}

/** The commands that settle the block, in order. */
export function blockCalls(items: readonly Question[], answers: Readonly<Record<string, Answer>>): CommandCall[] {
  return items.flatMap((q): CommandCall[] => {
    const a = answers[q.id] ?? initialAnswer(q);
    if (a.open) return [{ command: 'question.discard', entityId: q.id, data: { reason: LEFT_OPEN_REASON } }];
    const text = a.text.trim();
    if (!text) return [];
    // What DEMIURGO read, kept as it is: confirmed with its own conclusion (it stays "assumed, then confirmed").
    if (q.state === 'inferred' && text === (q.conclusion ?? '').trim())
      return [{ command: 'question.confirm', entityId: q.id, data: {} }];
    return [{ command: 'question.confirm', entityId: q.id, data: { conclusion: text } }];
  });
}
