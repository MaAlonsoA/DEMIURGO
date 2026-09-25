// How a question is answered in its thread (DESIGN.md §3.3), as pure rules: which questions are
// open and shown, the choices an answer can be picked from (DEMIURGO's assumed answer first, then
// the options), how a draft names its picked choices and back — several at once for a multiple
// choice, where an exclusive option clears the others — and a DEMIURGO reply turned into plain text
// to become the person's own words.

import type { Question } from '../../api/types.ts';

/** The longest answer a question takes (question.confirm). */
export const MAX_ANSWER = 3000;

const OPEN = new Set(['pending', 'inferred']);
export const isOpenQuestion = (q: Pick<Question, 'state'>): boolean => OPEN.has(q.state);
/** Shown in its thread; the ones not shown yet wait in DEMIURGO's reserve. */
export const isShown = (q: Pick<Question, 'shown_at'>): boolean => !!q.shown_at;

/** The value of DEMIURGO's assumed answer among the choices. */
export const ASSUMED = 'assumed';

export type AnswerChoice = { value: string; answer: string; implies: string; exclusive: boolean };

type Answerable = Pick<Question, 'state' | 'conclusion' | 'reasoning' | 'options' | 'multiple'>;

/** DEMIURGO's assumed answer, when the question is assumed and has one. */
export function assumedAnswer(q: Answerable): string | null {
  return q.state === 'inferred' && q.conclusion ? q.conclusion : null;
}

/** What the person can pick: the assumed answer (it stands alone), then each option by its index. */
export function answerChoices(q: Answerable): AnswerChoice[] {
  const assumed = assumedAnswer(q);
  return [
    ...(assumed
      ? [
          {
            value: ASSUMED,
            answer: assumed,
            implies: q.reasoning ? `DEMIURGO assumed it: ${q.reasoning}` : 'DEMIURGO assumed it from the conversation.',
            exclusive: true,
          },
        ]
      : []),
    ...(q.options ?? []).map((o, k) => ({ value: String(k), answer: o.answer, implies: o.implies, exclusive: !!o.exclusive })),
  ];
}

const SEP = ' · ';

/** The choices a draft picks: the assumed answer, the option it names or (multiple) every option it joins. */
export function pickedChoices(q: Answerable, draft: string | undefined): string[] {
  if (!draft) return [];
  const assumed = assumedAnswer(q);
  if (assumed && draft === assumed) return [ASSUMED];
  const options = q.options ?? [];
  const parts = q.multiple ? draft.split(SEP) : [draft];
  const picked = options.flatMap((o, k) => (parts.includes(o.answer) ? [String(k)] : []));
  // A multiple choice draft is only "picked" when every part is an option: otherwise it is own words.
  if (q.multiple && picked.length !== parts.length) return [];
  return picked;
}

/** The draft that picked choices write: the options' answers in their order, joined; null for none. */
export function draftOf(q: Answerable, picked: readonly string[]): string | null {
  if (picked.includes(ASSUMED)) return assumedAnswer(q);
  const options = q.options ?? [];
  const text = [...picked]
    .map(Number)
    .filter((k) => Number.isInteger(k) && options[k])
    .sort((a, b) => a - b)
    .map((k) => options[k]?.answer ?? '')
    .filter(Boolean)
    .join(SEP);
  return text || null;
}

/**
 * A change of picked choices with the exclusive rule: picking an exclusive choice (or the assumed
 * answer) leaves only it; picking any other clears the exclusive ones.
 */
export function withExclusive(choices: readonly AnswerChoice[], before: readonly string[], after: readonly string[]): string[] {
  const added = after.find((v) => !before.includes(v));
  if (added === undefined) return [...after];
  const exclusive = (v: string) => choices.find((c) => c.value === v)?.exclusive ?? false;
  if (exclusive(added)) return [added];
  return after.filter((v) => !exclusive(v));
}

/** A reply written in Markdown as plain text: the words without the marks, list items as lines. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*\n?/gm, '')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) =>
      row
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
        .join(SEP),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?=[^\w*]|$)/gm, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
