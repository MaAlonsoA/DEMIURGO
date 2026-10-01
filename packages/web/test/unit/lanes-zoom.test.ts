import { describe, expect, it } from 'vitest';
import { MAX_PX_PER_MIN, clampPx, fitPx, fitRange, ticksOf, zoomScroll } from '../../src/screens/build/timelineLogic.ts';

const MIN = 60_000;

describe('lanes zoom', () => {
  it('ticks get finer as the zoom grows', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0);
    const step = (px: number) => {
      const t = ticksOf(from, from + 8 * 60 * MIN, px);
      return ((t[1] ?? 0) - (t[0] ?? 0)) / MIN;
    };
    expect(step(1)).toBe(120);
    expect(step(4)).toBe(30);
    expect(step(8)).toBe(10);
    expect(step(80)).toBe(1);
  });

  it('clamps the zoom between the fit and the maximum', () => {
    expect(clampPx(0.1, 2)).toBe(2);
    expect(clampPx(9999, 2)).toBe(MAX_PX_PER_MIN);
    expect(clampPx(10, 2)).toBe(10);
  });

  it('fits a span in the available width', () => {
    expect(fitPx(100, 500)).toBe(5);
  });

  it('keeps the time under the pointer when zooming', () => {
    const scrollLeft = 200;
    const anchor = 100;
    const before = (scrollLeft + anchor) / 4;
    const next = zoomScroll(scrollLeft, anchor, 4, 8);
    expect((next + anchor) / 8).toBeCloseTo(before);
  });

  it('never scrolls to a negative position', () => {
    expect(zoomScroll(0, 0, 8, 4)).toBe(0);
  });

  it('fits a range with margin', () => {
    const from = 0;
    const { px, scrollLeft } = fitRange(from, 100 * MIN, 110 * MIN, 120, 0.5);
    expect(px).toBeCloseTo(120 / 12);
    expect(scrollLeft).toBeCloseTo(99 * px);
  });
});
