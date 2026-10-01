import { describe, expect, it } from 'vitest';
import type { TimelineRequest } from "../../src/api/types.ts";
import { MAX_PX_PER_MIN, clampPx, filterRows, fitPx, fitRange, rowWindow, ticksOf, visibleRange, zoomScroll } from "../../src/screens/build/timelineLogic.ts";

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

const req = (id: string, code: string, spans: [number, number][], extra: Partial<TimelineRequest> = {}): TimelineRequest => {
  const iso = (m: number) => new Date(m * MIN).toISOString();
  return {
    id,
    task_code: code,
    task_title: `Title of ${code}`,
    feature: { code: 'FDR-X-001', title: 'Feature words' },
    state: 'done',
    requested_by: 'human:a',
    requested_at: iso(0),
    pr_url: null,
    pr_number: null,
    start: iso(spans[0]?.[0] ?? 0),
    end: iso(spans[spans.length - 1]?.[1] ?? 0),
    running: false,
    merged_at: null,
    attempts: spans.map(([s, e], i) => ({
      n: i + 1,
      start: iso(s),
      end: iso(e),
      result: 'merged',
      segments: [{ stage: 'builder', kind: 'builder', start: iso(s), end: iso(e), outcome: 'done' }],
    })) as unknown as TimelineRequest['attempts'],
    flow: null,
    context: null,
    ...extra,
  } as TimelineRequest;
};
const noFilter = { range: null, text: '', running: false, attention: false, needsYou: null, pinned: null, focus: null };

describe('lanes rows', () => {
  const rows = [req('a', 'TSK-A', [[0, 10]]), req('b', 'TSK-B', [[20, 30]]), req('c', 'TSK-C', [[40, 50]], { running: true })];

  it('computes the visible range from the scroll', () => {
    expect(visibleRange(0, 60, 120, 2)).toEqual({ start: 30 * MIN, end: 90 * MIN });
  });

  it('keeps only rows with a segment in the range, newest first', () => {
    const out = filterRows(rows, { ...noFilter, range: { start: 5 * MIN, end: 25 * MIN } });
    expect(out.map((r) => r.task_code)).toEqual(['TSK-B', 'TSK-A']);
    expect(filterRows(rows, noFilter).map((r) => r.task_code)).toEqual(['TSK-C', 'TSK-B', 'TSK-A']);
  });

  it('keeps the pinned row outside the range', () => {
    const out = filterRows(rows, { ...noFilter, range: { start: 38 * MIN, end: 60 * MIN }, pinned: 'a' });
    expect(out.map((r) => r.id)).toEqual(['c', 'a']);
  });

  it('focus shows only that row', () => {
    expect(filterRows(rows, { ...noFilter, focus: 'b', range: { start: 0, end: 1 } }).map((r) => r.id)).toEqual(['b']);
  });

  it('filters by words in code, title and feature', () => {
    expect(filterRows(rows, { ...noFilter, text: 'tsk-b' }).map((r) => r.id)).toEqual(['b']);
    expect(filterRows(rows, { ...noFilter, text: 'feature words title' }).length).toBe(3);
    expect(filterRows(rows, { ...noFilter, text: 'nothing' }).length).toBe(0);
  });

  it('filters running and failed or needs you, combined with the range', () => {
    const failed = req('d', 'TSK-D', [[0, 10]], {});
    (failed.attempts[0] as { result: string }).result = 'failed';
    const all = [...rows, failed];
    expect(filterRows(all, { ...noFilter, running: true }).map((r) => r.id)).toEqual(['c']);
    expect(filterRows(all, { ...noFilter, attention: true }).map((r) => r.id)).toEqual(['d']);
    expect(filterRows(all, { ...noFilter, attention: true, needsYou: 'TSK-B' }).map((r) => r.id).sort()).toEqual(['b', 'd']);
    expect(filterRows(all, { ...noFilter, attention: true, needsYou: 'TSK-B', range: { start: 0, end: 5 * MIN } }).map((r) => r.id)).toEqual(['d']);
  });

  it('windows rows by scroll position', () => {
    expect(rowWindow(1000, 0, 384, 48, 26, 0)).toEqual({ start: 0, end: 8 });
    const w = rowWindow(1000, 48 * 500 + 26, 384, 48, 26, 2);
    expect(w).toEqual({ start: 498, end: 510 });
    expect(rowWindow(3, 9999, 384, 48, 26)).toEqual({ start: 3, end: 3 });
  });
});
