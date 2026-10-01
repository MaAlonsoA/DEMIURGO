import { describe, expect, it } from 'vitest';
import { contextHit, contextSummary, flowOf, unionMs } from '../src/build/flow.ts';
import { type StepRow, contextFilesFromRows, deliveryMetrics } from '../src/build/metrics.ts';
import { type TimelineStepRow, buildTimeline } from '../src/build/timeline.ts';

describe('flow efficiency', () => {
  it('splits active and wait over the lead time', () => {
    expect(flowOf(27, 100)).toEqual({ active_ms: 27, wait_ms: 73, active_pct: 27 });
    expect(flowOf(500, 100)?.active_pct).toBe(100);
    expect(flowOf(10, 0)).toBeNull();
  });
  it('takes the union of overlapping intervals, clipped', () => {
    expect(unionMs([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 20, end: 30 }], 2, 25)).toBe(13 + 5);
  });
});

describe('context hit', () => {
  it('splits hits, missed and unused; ignores tests, lockfiles and generated files', () => {
    const c = contextHit({
      given: ['a.ts', 'b.ts', 'c.ts'],
      touched: ['a.ts', 'd.ts', 'a.test.ts', 'pnpm-lock.yaml', 'x/generated/t.ts', 'packages/x/test/e.ts'],
      reuse: ['a.test.ts', 'zz.test.ts'],
    });
    expect(c?.hits).toEqual(['a.ts']);
    expect(c?.missed).toEqual(['d.ts']);
    expect(c?.unused).toEqual(['b.ts', 'c.ts']);
    expect(c?.counts).toEqual({ touched: 2, given: 3, hits: 1 });
    expect(c?.reuse).toEqual({ suggested: 2, touched: 1 });
  });
  it('is null without given or touched files', () => {
    expect(contextHit({ given: [], touched: ['a.ts'] })).toBeNull();
    expect(contextHit({ given: ['a.ts'], touched: ['a.test.ts'] })).toBeNull();
  });
  it('summarises recall and precision over tasks that have both', () => {
    const a = contextHit({ given: ['a', 'b'], touched: ['a', 'c'] });
    const b = contextHit({ given: ['x'], touched: ['x'] });
    expect(contextSummary([a, b, null])).toEqual({ tasks: 2, recall: 67, precision: 67 });
    expect(contextSummary([null])).toEqual({ tasks: 0, recall: null, precision: null });
  });
  it('reads the merged attempt from step rows', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 1, 10, m));
    const rows = [
      { request: 'r', task_code: 'TSK-1', attempt: 1, stage: 'builder', at: at(1), given: ['a.ts'], reuse: [], touched: null },
      { request: 'r', task_code: 'TSK-1', attempt: 1, stage: 'merge', at: at(2), given: null, reuse: null, touched: ['a.ts', 'b.ts'] },
    ];
    expect(contextFilesFromRows(rows).get('TSK-1')).toEqual({ given: ['a.ts'], touched: ['a.ts', 'b.ts'], reuse: [] });
  });
});

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
describe('flow and context in delivery and timeline', () => {
  it('computes flow per merged task, the median and the trend', () => {
    let n = 0;
    const s = (stage: string, outcome: string, min: number): StepRow => ({ build_request_id: 'r', task_code: 'TSK-1', attempt: 1, stage, outcome, model: null, duration_ms: null, at: new Date(T0 + min * 60_000 + n++) });
    const d = deliveryMetrics([s('repo', 'started', 0), s('builder', 'started', 10), s('builder', 'ok', 20), s('ci', 'started', 20), s('ci', 'ok', 30), s('merge', 'ok', 40)]);
    expect(d.merged[0]?.flow_pct).toBe(50);
    expect(d.last10.flow_median).toBe(50);
    expect(d.flow_trend).toEqual([50]);
  });
  it('puts flow and context on a merged request', () => {
    const st = (stage: string, outcome: string, min: number, detail: unknown = null): TimelineStepRow => ({ build_request_id: 'r', attempt: 1, stage, outcome, at: new Date(T0 + min * 60_000), detail });
    const tl = buildTimeline(
      [{ id: 'r', task_code: 'TSK-1', state: 'done', requested_by: 'human:a', requested_at: new Date(T0), pr_url: null, pr_number: null }],
      [
        st('repo', 'started', 0),
        st('repo', 'ok', 5),
        st('builder', 'started', 5),
        st('builder', 'ok', 15, { code_to_extend: { files: ['a.ts', 'b.ts'], section: 's' }, test_reuse: [{ criterion: 'AC-1', path: 'a.test.ts' }] }),
        st('merge', 'ok', 20, { footprint: { merge_commit: 'x', files: [{ path: 'a.ts' }, { path: 'c.ts' }, { path: 'a.test.ts' }] } }),
      ],
      { now: new Date(T0 + 60 * 60_000), since: new Date(T0 - 1) },
    );
    const r = tl.requests[0];
    expect(r?.flow).toEqual({ active_ms: 600_000, wait_ms: 600_000, active_pct: 50 });
    expect(r?.context?.hits).toEqual(['a.ts']);
    expect(r?.context?.missed).toEqual(['c.ts']);
    expect(r?.context?.reuse).toEqual({ suggested: 1, touched: 1 });
  });
});
