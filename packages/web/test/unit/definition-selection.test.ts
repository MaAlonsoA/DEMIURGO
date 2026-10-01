import { stageQuestionMultiple } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/api/types.ts';
import { answerChoices, draftOf, pickedChoices, withExclusive } from '../../src/screens/thread/answers.ts';

const options = ['Billing', 'Mobile app', 'Multi-user', 'Integrations'].map((answer) => ({ answer, implies: 'x', exclusive: false }));
const list = { state: 'pending', conclusion: null, reasoning: null, options, multiple: true, conversation_option: null } as unknown as Question;

/** One click on a chip, as QuestionCard handles it: toggle, then store the draft. */
function click(q: Question, draft: string | undefined, value: string): string | undefined {
  const picked = pickedChoices(q, draft);
  const next = !q.multiple ? [value] : picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value];
  return draftOf(q, withExclusive(answerChoices(q), picked, next)) ?? undefined;
}

describe('list questions keep every selected chip', () => {
  it('three clicks keep three chips, in option order, and toggle off', () => {
    let draft: string | undefined;
    for (const v of ['2', '0', '1']) draft = click(list, draft, v);
    expect(pickedChoices(list, draft)).toEqual(['0', '1', '2']);
    expect(draft).toBe('Billing · Mobile app · Multi-user');
    draft = click(list, draft, '1');
    expect(draft).toBe('Billing · Multi-user');
  });

  it('a single-choice question keeps only the last chip', () => {
    const single = { ...list, multiple: false } as Question;
    let draft: string | undefined;
    for (const v of ['0', '1']) draft = click(single, draft, v);
    expect(pickedChoices(single, draft)).toEqual(['1']);
  });

  it('the definition list questions are multiple by definition, the single-answer ones are not', () => {
    for (const k of ['outcomes', 'principles', 'scope_out', 'features']) expect(stageQuestionMultiple('requirements', k)).toBe(true);
    expect(stageQuestionMultiple('requirements', 'purpose')).toBe(false);
  });
});
