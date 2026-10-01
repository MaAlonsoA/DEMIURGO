// Calibration of Jev's judgments: the pure part (confusion, buckets, Brier, files) needs no database.

import { describe, expect, it } from 'vitest';
import type { ExecutionFact } from '../src/queries/execution-facts.ts';
import { distributionOf } from '../src/classifier/size.ts';
import { questionVersion } from '../src/classifier/question-version.ts';
import {
  type SizeJudgmentRow,
  brierOf,
  buildTimes,
  bucketOf,
  calibrateSizes,
  fileCalibrationReport,
  quantile,
  scoreFiles,
  sizeBands,
  sizeCalibrationReport,
  sizeOfMinutes,
  touchedFilesOf,
} from '../src/queries/calibration.ts';

const row = (over: Partial<SizeJudgmentRow>): SizeJudgmentRow => ({
  task_code: 'TSK-1',
  jev_size: 'M',
  score: 2,
  confidence: 0.7,
  distribution: null,
  question_version: null,
  merged: true,
  builder_minutes: 10,
  first_attempt_minutes: 10,
  ...over,
});

describe('question version', () => {
  it('is stable, short and independent of key order', () => {
    expect(questionVersion({ a: 1, b: 2 }, ['x'])).toBe(questionVersion({ b: 2, a: 1 }, ['x']));
    expect(questionVersion('q1')).not.toBe(questionVersion('q2'));
    expect(questionVersion('q1')).toMatch(/^[0-9a-f]{12}$/);
  });
  it('reads the level probabilities of an answer only when all five are there', () => {
    expect(distributionOf({ 0: 0.1, 1: 0.2, 2: 0.4, 3: 0.2, 4: 0.1 })).toEqual([0.1, 0.2, 0.4, 0.2, 0.1]);
    expect(distributionOf({ 0: 0.5, 1: 0.5 })).toBeNull();
    expect(distributionOf(undefined)).toBeNull();
  });
});

describe('size calibration against the builder time', () => {
  it('buckets confidence at 0.6 and 0.75', () => {
    expect([bucketOf(0.59), bucketOf(0.6), bucketOf(0.74), bucketOf(0.75)]).toEqual(['low', 'mid', 'mid', 'high']);
  });

  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([], 0.5)).toBeNull();
  });

  it('cuts as many bands as sizes in use at the quantiles of the merged builds', () => {
    const rows = [5, 10, 20, 40].map((m, i) => row({ jev_size: i < 2 ? 'S' : 'L', builder_minutes: m }));
    const bands = sizeBands(rows);
    expect(bands.sizes).toEqual(['S', 'L']);
    expect(bands.cuts).toEqual([15]);
    expect(sizeOfMinutes(bands, 14.9)).toBe('S');
    expect(sizeOfMinutes(bands, 15)).toBe('L');
    expect(sizeOfMinutes(sizeBands([row({})]), 5)).toBeNull();
    // Unmerged tasks do not shape the bands.
    expect(sizeBands([...rows, row({ jev_size: 'XL', merged: false, builder_minutes: null })]).cuts).toHaveLength(2);
  });

  it('gives n, median, p25-p75, first attempt and the in-band count per Jev size', () => {
    const rows = [
      row({ jev_size: 'S', builder_minutes: 4, first_attempt_minutes: 4 }),
      row({ jev_size: 'S', builder_minutes: 8, first_attempt_minutes: 6 }),
      row({ jev_size: 'S', builder_minutes: 30, first_attempt_minutes: 10 }),
      row({ jev_size: 'L', builder_minutes: 20, first_attempt_minutes: 12 }),
      row({ jev_size: 'L', builder_minutes: 50, first_attempt_minutes: 25 }),
      row({ jev_size: 'L', merged: false, builder_minutes: null, first_attempt_minutes: null }),
    ];
    const c = calibrateSizes(rows);
    expect(c.tasks).toBe(6);
    expect(c.builds).toBe(5);
    const s = c.by_size[0];
    expect(s).toMatchObject({ size: 'S', n: 3, median_minutes: 8, p25_minutes: 6, p75_minutes: 19, median_first_attempt_minutes: 6 });
    // Cut at the median of [4, 8, 20, 30, 50] = 20: S holds 4 and 8, not 30.
    expect(s?.band).toEqual({ from: null, to: 20 });
    expect(s?.in_band).toBe(2);
    expect(c.by_size[1]?.band).toEqual({ from: 20, to: null });
    expect(c.by_size[1]?.in_band).toBe(2);
  });

  it('correlates the expected score with the builder minutes', () => {
    const rows = [0, 1, 2, 3].map((sc, i) => row({ score: sc, builder_minutes: (i + 1) * 10 }));
    expect(calibrateSizes(rows).spearman).toEqual({ rho: 1, n: 4 });
    expect(calibrateSizes([row({ score: null }), row({ score: null })]).spearman).toBeNull();
  });

  it('counts a Jev size as right when the band of the actual time is that size, per confidence bucket', () => {
    const rows = [
      row({ jev_size: 'S', builder_minutes: 5, confidence: 0.5 }),
      row({ jev_size: 'S', builder_minutes: 60, confidence: 0.5 }),
      row({ jev_size: 'L', builder_minutes: 60, confidence: 0.9 }),
      row({ jev_size: 'L', builder_minutes: 70, confidence: 0.9 }),
    ];
    const c = calibrateSizes(rows);
    expect(c.buckets.map((b) => [b.bucket, b.n, b.correct, b.accuracy])).toEqual([
      ['low', 2, 1, 0.5],
      ['mid', 0, 0, null],
      ['high', 2, 2, 1],
    ]);
    expect(c.ece).toBe(0.05);
  });

  it('computes the multi-class Brier score against the size of the actual band, only with distributions', () => {
    expect(brierOf([0, 0, 1, 0, 0], 'M')).toBe(0);
    expect(brierOf([0, 0, 1, 0, 0], 'L')).toBe(2);
    expect(brierOf([0.2, 0.2, 0.2, 0.2, 0.2], 'XS')).toBeCloseTo(0.8 ** 2 + 4 * 0.04);
    const none = calibrateSizes([row({ jev_size: 'S', builder_minutes: 1 }), row({ jev_size: 'L', builder_minutes: 9 })]);
    expect(none.brier).toBeNull();
    const c = calibrateSizes([
      row({ jev_size: 'S', builder_minutes: 1, distribution: [0, 1, 0, 0, 0] }),
      row({ jev_size: 'L', builder_minutes: 9, distribution: [0, 1, 0, 0, 0] }),
    ]);
    // First build: actual band S, forecast S -> 0. Second: actual band L, forecast S -> 2.
    expect(c.brier).toEqual({ score: 1, n: 2 });
  });

  it('groups by question version with the project-wide bands, only when some opinion has one', () => {
    expect(sizeCalibrationReport([row({}), row({})]).by_version).toEqual([]);
    const r = sizeCalibrationReport([row({ question_version: 'aaa' }), row({ question_version: null }), row({ question_version: 'aaa', jev_size: 'L', builder_minutes: 30 })]);
    expect(r.by_version.map((g) => [g.question_version, g.calibration.tasks])).toEqual([
      [null, 1],
      ['aaa', 2],
    ]);
    expect(r.overall.tasks).toBe(3);
  });

  it('reads the builder time of the merged request: summed up to the merge, plus the first attempt', () => {
    const f = (over: Partial<ExecutionFact>) => ({ request_id: 'r1', attempt: 1, task_code: 'TSK-1', outcome: 'changes_requested', merged_at: null, builder_minutes: 5, ...over }) as ExecutionFact;
    const t = buildTimes([
      f({ attempt: 1, builder_minutes: 5 }),
      f({ attempt: 2, builder_minutes: 7.5 }),
      f({ attempt: 3, outcome: 'merged', merged_at: '2026-10-01T10:00:00Z', builder_minutes: 2 }),
      f({ request_id: 'r2', attempt: 1, outcome: 'failed', builder_minutes: 99 }),
    ]);
    expect(t.get('TSK-1')).toEqual({ total: 14.5, first: 5 });
  });
});

describe('file calibration', () => {
  it('computes precision and recall of the predicted files against the changed ones', () => {
    const s = scoreFiles({ task_code: 'T', attempt: 1, question_version: null, predicted: ['a', 'b', 'c', 'c'], touched: ['a', 'c', 'd', 'e'] });
    expect(s.hits).toBe(2);
    expect(s.precision).toBeCloseTo(0.667, 3);
    expect(s.recall).toBe(0.5);
    expect(scoreFiles({ task_code: 'T', attempt: 1, question_version: null, predicted: [], touched: ['a'] }).precision).toBeNull();
    expect(scoreFiles({ task_code: 'T', attempt: 1, question_version: null, predicted: ['a'], touched: [] }).recall).toBeNull();
  });

  it('gives the median per project and per question version', () => {
    const mk = (code: string, v: string | null, predicted: string[], touched: string[]) => ({ task_code: code, attempt: 1, question_version: v, predicted, touched });
    const r = fileCalibrationReport([mk('A', 'v1', ['a'], ['a']), mk('B', 'v1', ['a', 'b'], ['a']), mk('C', 'v2', ['x'], ['y'])]);
    expect(r.overall.builds).toBe(3);
    expect(r.overall.median_precision).toBe(0.5);
    expect(r.overall.median_recall).toBe(1);
    expect(r.by_version.map((g) => [g.question_version, g.calibration.builds, g.calibration.median_precision])).toEqual([
      ['v1', 2, 0.75],
      ['v2', 1, 0],
    ]);
  });

  it('reads the changed files from the commit, else from the merge footprint', () => {
    expect(touchedFilesOf({ files: ['a.ts', 'b.ts'] }, null)).toEqual(['a.ts', 'b.ts']);
    expect(touchedFilesOf(null, { footprint: { files: [{ path: 'c.ts' }, { nope: 1 }] } })).toEqual(['c.ts']);
    expect(touchedFilesOf(null, null)).toBeNull();
  });
});
