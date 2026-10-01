import { describe, expect, it } from 'vitest';
import type { TimelineAttempt, TimelineSegment } from '../../src/api/types.ts';
import { flattenSegments, reviewOverlapsCi, stageStates } from '../../src/screens/build/timelineLogic.ts';

const at = (m: number) => new Date(Date.UTC(2026, 9, 1, 10, m)).toISOString();
const seg = (stage: string, kind: TimelineSegment['kind'], a: number, b: number, outcome = 'ok'): TimelineSegment => ({ stage, kind, start: at(a), end: at(b), outcome });
const attempt = (segments: TimelineSegment[]) => ({ segments }) as unknown as TimelineAttempt;

describe('CI and review in parallel', () => {
  it('detects an overlap and not the old sequential shape', () => {
    expect(reviewOverlapsCi(attempt([seg('ci', 'wait', 6, 12), seg('review', 'review', 6, 9)]))).toBe(true);
    expect(reviewOverlapsCi(attempt([seg('ci', 'wait', 6, 12), seg('review', 'review', 12, 13)]))).toBe(false);
  });

  it('flattens overlapping segments into consecutive pieces, review first', () => {
    const flat = flattenSegments([seg('ci', 'wait', 6, 12), seg('review', 'review', 7, 9)]);
    expect(flat.map((s) => [s.stage, s.start, s.end])).toEqual([
      ['ci', at(6), at(7)],
      ['review', at(7), at(9)],
      ['ci', at(9), at(12)],
    ]);
  });

  it('gives a cancelled CI its own state and keeps the review state', () => {
    const states = stageStates(attempt([seg('ci', 'wait', 6, 8, 'cancelled'), seg('review', 'review', 6, 8, 'changes_requested')]));
    expect(states.get('ci')?.state).toBe('cancelled');
    expect(states.get('review')?.state).toBe('changes');
  });
});
