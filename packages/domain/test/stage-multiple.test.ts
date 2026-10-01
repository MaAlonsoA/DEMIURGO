import { describe, expect, it } from 'vitest';
import { STAGES, composeDefinition, effectiveMultiple, stageQuestionMultiple } from '../src/index.ts';

describe('stage list questions take several answers', () => {
  it.each([
    ['requirements', 'outcomes'],
    ['requirements', 'principles'],
    ['requirements', 'problem'],
    ['requirements', 'scope_out'],
  ])('%s/%s is multiple', (stage, key) => {
    expect(stageQuestionMultiple(stage, key)).toBe(true);
  });

  it('the stage decides over the stored flag; other questions keep theirs', () => {
    expect(effectiveMultiple('requirements', 'outcomes', false)).toBe(true);
    expect(effectiveMultiple('requirements', 'purpose', true)).toBe(false);
    expect(effectiveMultiple(null, null, true)).toBe(true);
    expect(effectiveMultiple(undefined, undefined, false)).toBe(false);
  });

  it('the product definition keeps the own words of an answer as written', () => {
    const own = 'Members book without calling the club · and I want a waiting list';
    const questions = STAGES.find((s) => s.key === 'requirements')!.questions.map((q) => ({
      id: q.key,
      key: q.key,
      state: 'confirmed' as const,
      conclusion: q.key === 'purpose' ? own : 'x',
      state_reason: null,
    }));
    const composed = composeDefinition(questions);
    expect(composed?.sections.some((s) => s.content === own)).toBe(true);
  });
});
