import { describe, expect, it } from 'vitest';
import { questionCounts, questionCountText } from '../../src/lib/question-count.ts';

describe('question counts', () => {
  const q = (state: string, shown: boolean) => ({ state, shown_at: shown ? '2026-10-01T10:00:00Z' : null });
  it('splits the shown questions from the ones in reserve and ignores the settled ones', () => {
    const counts = questionCounts([q('pending', true), q('inferred', true), q('pending', false), q('postponed', false), q('confirmed', true), q('discarded', false)]);
    expect(counts).toEqual({ now: 2, later: 2 });
    expect(questionCountText(counts)).toBe('2 questions now · 2 more later');
  });
  it('says each case in words', () => {
    expect(questionCountText({ now: 1, later: 0 })).toBe('1 question now');
    expect(questionCountText({ now: 0, later: 3 })).toBe('3 more questions later');
    expect(questionCountText({ now: 0, later: 0 })).toBe('No open questions');
  });
});
