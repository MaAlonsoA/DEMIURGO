import { describe, expect, it } from 'vitest';
import { type FlowRow, contextHit, contextSummary, flowSplit, unionMs } from '../src/build/flow.ts';
import { type StepRow, contextFilesFromRows, deliveryMetrics } from '../src/build/metrics.ts';
import { type TimelineStepRow, buildTimeline } from '../src/build/timeline.ts';

describe('flow split', () => {
  const row = (stage: string, outcome: string, at: number, extra: Partial<FlowRow> = {}): FlowRow => ({ attempt: 1, stage, outcome, at, ...extra });
  it('splits the lead time into build, CI, review and wait, adding up to 100', () => {
    const f = flowSplit(
      [row('builder', 'started', 10), row('builder', 'ok', 40), row('ci', 'started', 40), row('ci', 'ok', 70), row('review', 'started', 70), row('review', 'ok', 73)],
      0,
      100,
    );
    expect(f?.pct).toEqual({ build: 30, ci: 30, review: 3, wait: 37 });
    expect(f).toMatchObject({ lead_ms: 100, build_ms: 30, ci_ms: 30, review_ms: 3, wait_ms: 37 });
    expect(flowSplit([], 0, 0)).toBeNull();
  });
  it('counts the recheck CI inside the merge stage as CI, and a merge without recheck as wait', () => {
    const merge = (recheck: boolean) => [row('merge', 'waiting', 50, { recheck }), row('ci', 'ok', 80, { recheck: false })];
    expect(flowSplit(merge(true), 0, 100)?.pct).toEqual({ build: 0, ci: 30, review: 0, wait: 70 });
    expect(flowSplit(merge(false), 0, 100)?.pct).toEqual({ build: 0, ci: 0, review: 0, wait: 100 });
  });
  it('lets build win over an overlapping CI, drops open intervals without openAt and closes them at it', () => {
    expect(flowSplit([row('builder', 'started', 0), row('builder', 'ok', 50), row('ci', 'started', 40), row('ci', 'ok', 60)], 0, 100)?.pct).toEqual({ build: 50, ci: 10, review: 0, wait: 40 });
    expect(flowSplit([row('ci', 'started', 50)], 0, 100)?.pct.ci).toBe(0);
    expect(flowSplit([row('ci', 'started', 50)], 0, 100, 100)?.pct.ci).toBe(50);
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
  it('computes the split per merged task, the median shares and the lead times', () => {
    let n = 0;
    const s = (stage: string, outcome: string, min: number): StepRow => ({ build_request_id: 'r', task_code: 'TSK-1', attempt: 1, stage, outcome, model: null, duration_ms: null, at: new Date(T0 + min * 60_000 + n++) });
    const d = deliveryMetrics([s('repo', 'started', 0), s('builder', 'started', 10), s('builder', 'ok', 20), s('ci', 'started', 20), s('ci', 'ok', 30), s('merge', 'ok', 40)]);
    expect(d.merged[0]?.flow).toEqual({ build: 25, ci: 25, review: 0, wait: 50 });
    expect(d.last10.flow_median).toEqual({ build: 25, ci: 25, review: 0, wait: 50 });
    expect(d.lead_trend).toEqual([40]);
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
    expect(r?.flow).toMatchObject({ lead_ms: 1_200_000, build_ms: 600_000, ci_ms: 0, wait_ms: 600_000, pct: { build: 50, ci: 0, review: 0, wait: 50 } });
    expect(r?.context?.hits).toEqual(['a.ts']);
    expect(r?.context?.missed).toEqual(['c.ts']);
    expect(r?.context?.reuse).toEqual({ suggested: 1, touched: 1 });
  });
});
