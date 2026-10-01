import { describe, expect, it } from 'vitest';
import type { TimelineAttempt, TimelineSegment } from '../../src/api/types.ts';
import { attemptColumns, chainLayout, scrollTargetFor } from '../../src/screens/build/timelineLogic.ts';

const at = (m: number) => new Date(Date.UTC(2026, 9, 1, 10, m)).toISOString();
const seg = (stage: string, kind: TimelineSegment['kind'], a: number, b: number, outcome = 'ok'): TimelineSegment => ({ stage, kind, start: at(a), end: at(b), outcome });
const attempt = (n: number, result: TimelineAttempt['result'], segments: TimelineSegment[], extra: Partial<TimelineAttempt> = {}) => ({ n, result, segments, merged_at: null, ended_by: null, ...extra }) as unknown as TimelineAttempt;

const failedInBuild = attempt(1, 'failed', [seg('prepare', 'prep', 0, 1), seg('builder', 'builder', 1, 5, 'failed')]);
const changes = attempt(2, 'changes_requested', [seg('prepare', 'prep', 6, 7), seg('builder', 'builder', 7, 12), seg('ci', 'wait', 12, 15), seg('review', 'review', 12, 14, 'changes_requested')]);
const merged = attempt(3, 'merged', [seg('prepare', 'prep', 16, 17), seg('builder', 'builder', 17, 20), seg('ci', 'wait', 20, 22), seg('review', 'review', 20, 21), seg('merge', 'light', 22, 23)], { merged_at: at(23) });

describe('attempt chain layout', () => {
  it('cuts an attempt after its last reached stage', () => {
    expect(attemptColumns(failedInBuild, false)).toBe(2);
    expect(attemptColumns(changes, false)).toBe(3);
  });

  it('draws everything for a merged attempt and for the last running one, but not an earlier unfinished one', () => {
    expect(attemptColumns(merged, true)).toBe(5);
    expect(attemptColumns(attempt(1, 'running', [seg('builder', 'builder', 0, 1, 'running')]), true)).toBe(5);
    expect(attemptColumns(attempt(1, 'open', []), false)).toBe(4);
  });

  it('uses the stage where it ended even when no segment of it was kept', () => {
    const a = attempt(1, 'failed', [seg('prepare', 'prep', 0, 1)], { ended_by: { stage: 'builder' } as TimelineAttempt['ended_by'] });
    expect(attemptColumns(a, false)).toBe(2);
  });

  it('places the blocks one after another with the gap between them', () => {
    const { blocks, width } = chainLayout([failedInBuild, changes, merged], 100, 40);
    expect(blocks.map((b) => [b.n, b.x, b.cols, b.width])).toEqual([
      [1, 0, 2, 200],
      [2, 240, 3, 300],
      [3, 580, 5, 500],
    ]);
    expect(width).toBe(1080);
  });

  it('a single merged attempt is the full five columns with no gap', () => {
    expect(chainLayout([merged], 132, 48)).toEqual({ blocks: [{ n: 3, x: 0, cols: 5, width: 660 }], width: 660 });
  });

  it('scrolls only when the selected block is out of view', () => {
    expect(scrollTargetFor(240, 300, 0, 800)).toBe(0);
    expect(scrollTargetFor(900, 300, 0, 800)).toBe(650);
    expect(scrollTargetFor(0, 300, 500, 800)).toBe(0);
    expect(scrollTargetFor(900, 300, 0, 0)).toBe(0);
  });
});
