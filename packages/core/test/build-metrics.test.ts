import { describe, expect, it } from 'vitest';
import { type StepRow, deliveryMetrics, median, percentile } from '../src/build/metrics.ts';

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
let n = 0;
const step = (req: string, code: string, attempt: number, stage: string, outcome: string, min: number, model: string | null = null): StepRow => ({
  build_request_id: req,
  task_code: code,
  attempt,
  stage,
  outcome,
  model,
  duration_ms: null,
  at: new Date(T0 + min * 60_000 + n++),
});

/** repo 0, builder 1-11 (10 min), ci 12-16 (4), review 16-17 (1), merge at 18. */
const clean = (req: string, code: string, offset: number, model: string): StepRow[] => [
  step(req, code, 1, 'repo', 'started', offset),
  step(req, code, 1, 'repo', 'ok', offset + 1),
  step(req, code, 1, 'builder', 'started', offset + 1),
  step(req, code, 1, 'builder', 'ok', offset + 11, model),
  step(req, code, 1, 'ci', 'started', offset + 12),
  step(req, code, 1, 'ci', 'ok', offset + 16),
  step(req, code, 1, 'review', 'started', offset + 16),
  step(req, code, 1, 'review', 'ok', offset + 17),
  step(req, code, 1, 'merge', 'ok', offset + 18),
];

describe('delivery metrics', () => {
  it('computes lead time, stage minutes, attempts and model of a merged task', () => {
    const m = deliveryMetrics(clean('r1', 'TSK-1', 0, 'opus'));
    expect(m.merged).toHaveLength(1);
    expect(m.merged[0]).toMatchObject({ code: 'TSK-1', lead_minutes: 18, attempts: 1, model: 'opus' });
    expect(m.merged[0]?.stage_minutes).toEqual({ builder: 10, environment: 0, ci: 4, review: 1 });
    expect(m.all.first_pass).toEqual({ merged_first_try: 1, of: 1 });
  });

  it('sums stages over attempts and takes the last builder model', () => {
    const rows = [
      step('r2', 'TSK-2', 1, 'repo', 'started', 0),
      step('r2', 'TSK-2', 1, 'environment', 'started', 1),
      step('r2', 'TSK-2', 1, 'environment', 'ok', 3),
      step('r2', 'TSK-2', 1, 'builder', 'started', 3),
      step('r2', 'TSK-2', 1, 'builder', 'ok', 13, 'sonnet'),
      step('r2', 'TSK-2', 1, 'ci', 'started', 14),
      step('r2', 'TSK-2', 1, 'ci', 'failed', 16),
      step('r2', 'TSK-2', 2, 'builder', 'started', 20),
      step('r2', 'TSK-2', 2, 'builder', 'ok', 25, 'opus'),
      step('r2', 'TSK-2', 2, 'ci', 'started', 26),
      step('r2', 'TSK-2', 2, 'ci', 'ok', 29),
      step('r2', 'TSK-2', 2, 'merge', 'ok', 30),
    ];
    const t = deliveryMetrics(rows).merged[0];
    expect(t).toMatchObject({ lead_minutes: 30, attempts: 2, model: 'opus' });
    expect(t?.stage_minutes).toEqual({ builder: 15, environment: 2, ci: 5, review: 0 });
  });

  it('summarises medians, p90, first pass and by model', () => {
    const rows = [
      ...clean('a', 'T-A', 0, 'opus'),
      ...clean('b', 'T-B', 100, 'sonnet'),
      ...clean('c', 'T-C', 200, 'sonnet'),
      // T-D needed two attempts: lead 40
      step('d', 'T-D', 1, 'repo', 'started', 300),
      step('d', 'T-D', 1, 'builder', 'started', 301),
      step('d', 'T-D', 1, 'builder', 'ok', 311, 'opus'),
      step('d', 'T-D', 2, 'builder', 'started', 320),
      step('d', 'T-D', 2, 'builder', 'ok', 330, 'opus'),
      step('d', 'T-D', 2, 'merge', 'ok', 340),
    ];
    const m = deliveryMetrics(rows);
    expect(m.all.tasks).toBe(4);
    expect(m.all.lead_median).toBe(18);
    expect(m.all.lead_p90).toBe(40);
    expect(m.all.first_pass).toEqual({ merged_first_try: 3, of: 4 });
    expect(m.merged[0]?.code).toBe('T-D');
    const sonnet = m.by_model_all.find((x) => x.model === 'sonnet');
    expect(sonnet).toMatchObject({ tasks: 2, lead_median: 18, builder_median: 10 });
    expect(m.by_model_all.find((x) => x.model === 'opus')?.tasks).toBe(2);
  });

  it('reports a running build with its elapsed minutes and current stage, and no summary without merges', () => {
    const rows = [step('r', 'T-R', 1, 'repo', 'started', 0), step('r', 'T-R', 1, 'builder', 'started', 2)];
    const m = deliveryMetrics(rows, new Date(T0 + 7 * 60_000 + 500));
    expect(m.running).toEqual([{ code: 'T-R', elapsed_minutes: 7, stage: 'builder', outcome: 'started', attempt: 1 }]);
    expect(m.merged).toEqual([]);
    expect(m.all.first_pass).toBeNull();
    expect(m.all.lead_median).toBeNull();
  });

  it('does not list a failed build as running and tolerates missing stages', () => {
    const m = deliveryMetrics([step('x', 'T-X', 1, 'repo', 'started', 0), step('x', 'T-X', 1, 'builder', 'failed', 3)]);
    expect(m.running).toEqual([]);
    const merged = deliveryMetrics([step('y', 'T-Y', 1, 'repo', 'started', 0), step('y', 'T-Y', 1, 'merge', 'ok', 5)]);
    expect(merged.merged[0]).toMatchObject({ lead_minutes: 5, model: null });
    expect(merged.merged[0]?.stage_minutes.builder).toBe(0);
  });

  it('median and percentile helpers', () => {
    expect(median([])).toBeNull();
    expect(median([1, 3, 2, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
});
