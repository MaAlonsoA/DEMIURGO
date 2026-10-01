import { describe, expect, it } from 'vitest';
import { answerChoices, draftOf, pickedChoices, withExclusive } from '../../src/screens/thread/answers.ts';

const q = {
  state: 'pending',
  conclusion: null,
  reasoning: null,
  conversation_option: null,
  multiple: true,
  options: [
    { answer: 'A', implies: 'a', exclusive: false },
    { answer: 'B', implies: 'b', exclusive: false },
    { answer: 'C', implies: 'c', exclusive: false },
  ],
} as never;

describe('a multiple question keeps several picked choices', () => {
  it('picks 0, 1 and 2 one after the other', () => {
    const choices = answerChoices(q);
    let picked: string[] = [];
    for (const v of ['0', '1', '2']) {
      picked = withExclusive(choices, picked, [...picked, v]);
      picked = pickedChoices(q, draftOf(q, picked) ?? undefined);
    }
    expect(picked).toEqual(['0', '1', '2']);
  });
});
