// Calibration of Jev's judgments, derived on read from what is stored (no outcome table yet): did the size and
// the files Jev predicted match what happened? Two judgments:
//  - the task size (`task_size_opinions`) against the builder's time (the only ground truth: nobody sets sizes by
//    hand) of the merged build;
//  - the files of «Code to extend» (`task_code_opinions`) against the files the merged pull request changed.
//
// Practice notes. A reliability table (accuracy per confidence bucket) and the Expected Calibration Error are
// the ideas of Guo, Pleiss, Sun and Weinberger, «On Calibration of Modern Neural Networks» (ICML 2017, PMLR 70);
// here the ECE is taken over the three buckets below, so it is a coarse version of theirs. The multi-class Brier
// score is Brier, «Verification of forecasts expressed in terms of probability» (Monthly Weather Review 78,
// 1950): the mean over the cases of the sum over the levels of (probability - outcome)^2, 0 being perfect. The
// rank correlation is Spearman's (as in execution-facts). Precision and recall are the usual retrieval ones.
// Everything else is «convención nuestra»: the confidence buckets (< 0.6, 0.6 to 0.75, >= 0.75); the size bands
// (as many as sizes in use, cut at the empirical quantiles of the builder minutes of the project's merged builds),
// with «correct» meaning that the band holding the actual time is Jev's size; builder minutes being the sum of
// the builder stage over the attempts up to the merge; a file counting as predicted when Jev's probability for it
// is at least 0.5; and the latest opinion of a task being the one judged.

import { TASK_SIZES, type TaskSize } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { type ExecutionFact, executionFacts, median, spearman } from './execution-facts.ts';

const SIZES = new Set<string>(TASK_SIZES);
const asSize = (v: unknown): TaskSize | null => (typeof v === 'string' && SIZES.has(v) ? (v as TaskSize) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Probability at or above which Jev's answer about a file counts as «this file will be edited» (our convention). */
export const FILE_PREDICTION_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------------------------------------------
// Size. The only ground truth is the builder's time: nobody sets task sizes by hand, so Jev's size is compared
// with how long the builder worked, not with another size.

/** One task, with Jev's latest size opinion and, when merged, the builder's time of its latest merged request. */
export type SizeJudgmentRow = {
  task_code: string;
  jev_size: TaskSize;
  /** Jev's expected score over the levels (0..4); null in opinions that did not store it. */
  score: number | null;
  confidence: number | null;
  /** Probability of each level in the order XS..XL; null in opinions that did not store it. */
  distribution: number[] | null;
  question_version: string | null;
  merged: boolean;
  /** Builder minutes summed over the attempts of the request up to the merge; null when none was measured. */
  builder_minutes: number | null;
  /** Builder minutes of the first attempt. */
  first_attempt_minutes: number | null;
};

/** The sizes in use (ascending) and the cut points between their bands: the empirical quantiles of the builder minutes of merged builds. */
export type SizeBands = { sizes: TaskSize[]; cuts: number[] };

export type SizeRow = {
  size: TaskSize;
  /** Merged builds with a builder time. */
  n: number;
  median_minutes: number | null;
  p25_minutes: number | null;
  p75_minutes: number | null;
  median_first_attempt_minutes: number | null;
  /** The band of this size in builder minutes (lower inclusive, upper exclusive); null ends are open. Null with a single size in use. */
  band: { from: number | null; to: number | null } | null;
  /** Of those builds, how many took a time inside the band. */
  in_band: number;
};

export type ConfidenceBucket = { bucket: 'low' | 'mid' | 'high'; n: number; correct: number; accuracy: number | null; mean_confidence: number | null };

export type SizeCalibration = {
  /** Tasks with Jev's size. */
  tasks: number;
  /** Of those, merged with a builder time: the builds compared. */
  builds: number;
  by_size: SizeRow[];
  /** Spearman between Jev's expected score and the builder minutes; null with fewer than 3 builds or no variation. */
  spearman: { rho: number; n: number } | null;
  buckets: ConfidenceBucket[];
  /** Expected Calibration Error over the buckets; null when no build has a confidence. */
  ece: number | null;
  /** Multi-class Brier score of the distribution against the size whose band holds the actual time; null without distributions. */
  brier: { score: number; n: number } | null;
};

export type SizeCalibrationReport = {
  overall: SizeCalibration;
  /** One per question version, only when some opinion carries one; `null` groups the opinions without a version. */
  by_version: { question_version: string | null; calibration: SizeCalibration }[];
};

/** The bucket of a confidence (our convention): below 0.6, 0.6 up to 0.75, 0.75 and above. */
export const bucketOf = (confidence: number): ConfidenceBucket['bucket'] => (confidence < 0.6 ? 'low' : confidence < 0.75 ? 'mid' : 'high');
const BUCKETS: ConfidenceBucket['bucket'][] = ['low', 'mid', 'high'];

/** Multi-class Brier score of one forecast: the sum over the levels of (probability - outcome)^2. */
export function brierOf(distribution: readonly number[], actual: TaskSize): number {
  const k = TASK_SIZES.indexOf(actual);
  return distribution.reduce((acc, p, i) => acc + (p - (i === k ? 1 : 0)) ** 2, 0);
}

/** Quantile by linear interpolation between order statistics; null for no values. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (v[lo] as number) + ((v[hi] as number) - (v[lo] as number)) * (pos - lo);
}

/**
 * The bands (our convention): as many as sizes Jev used, cut at the empirical quantiles i/k of the builder minutes of
 * every merged build, so each band holds about the same number of builds. The smallest size takes the shortest band.
 */
export function sizeBands(rows: readonly SizeJudgmentRow[]): SizeBands {
  const sizes = TASK_SIZES.filter((s) => rows.some((r) => r.jev_size === s));
  const minutes = rows.flatMap((r) => (r.merged && r.builder_minutes !== null ? [r.builder_minutes] : []));
  const k = sizes.length;
  const cuts = k < 2 || minutes.length === 0 ? [] : Array.from({ length: k - 1 }, (_, i) => quantile(minutes, (i + 1) / k) as number);
  return { sizes, cuts };
}

/** The size whose band holds a builder time; null without bands (a single size in use). */
export function sizeOfMinutes(bands: SizeBands, minutes: number): TaskSize | null {
  if (bands.cuts.length === 0) return null;
  return bands.sizes[bands.cuts.filter((c) => minutes >= c).length] ?? null;
}

/** Pure: how Jev's sizes compare with the builder's time. Bands default to those of these same rows. */
export function calibrateSizes(rows: readonly SizeJudgmentRow[], bands: SizeBands = sizeBands(rows)): SizeCalibration {
  const built = rows.filter((r): r is SizeJudgmentRow & { builder_minutes: number } => r.merged && r.builder_minutes !== null);
  const judged = built.map((r) => ({ r, actual: sizeOfMinutes(bands, r.builder_minutes) }));

  const by_size: SizeRow[] = [];
  for (const size of bands.sizes) {
    const group = judged.filter((j) => j.r.jev_size === size);
    if (group.length === 0) continue;
    const minutes = group.map((j) => j.r.builder_minutes);
    const i = bands.sizes.indexOf(size);
    const firsts = group.flatMap((j) => (j.r.first_attempt_minutes === null ? [] : [j.r.first_attempt_minutes]));
    by_size.push({
      size,
      n: group.length,
      median_minutes: r1(median(minutes)),
      p25_minutes: r1(quantile(minutes, 0.25)),
      p75_minutes: r1(quantile(minutes, 0.75)),
      median_first_attempt_minutes: r1(median(firsts)),
      band: bands.cuts.length === 0 ? null : { from: i === 0 ? null : (bands.cuts[i - 1] as number), to: i >= bands.cuts.length ? null : (bands.cuts[i] as number) },
      in_band: group.filter((j) => j.actual === size).length,
    });
  }

  // Older opinions kept only the size: its level (XS 0 … XL 4) stands in for the expected score, which ranks the same way.
  const scored = built.flatMap((r) => {
    const score = r.score ?? (r.jev_size ? TASK_SIZES.indexOf(r.jev_size) : -1);
    return score >= 0 ? [{ ...r, score }] : [];
  });
  const withConfidence = judged.filter((j): j is typeof j & { actual: TaskSize; r: { confidence: number } } => j.actual !== null && j.r.confidence !== null);
  const buckets: ConfidenceBucket[] = BUCKETS.map((bucket) => {
    const g = withConfidence.filter((j) => bucketOf(j.r.confidence) === bucket);
    const correct = g.filter((j) => j.r.jev_size === j.actual).length;
    return {
      bucket,
      n: g.length,
      correct,
      accuracy: g.length === 0 ? null : r3(correct / g.length),
      mean_confidence: g.length === 0 ? null : r3(g.reduce((a, j) => a + j.r.confidence, 0) / g.length),
    };
  });
  const ece =
    withConfidence.length === 0
      ? null
      : r3(buckets.reduce((acc, b) => (b.n === 0 || b.accuracy === null || b.mean_confidence === null ? acc : acc + (b.n / withConfidence.length) * Math.abs(b.accuracy - b.mean_confidence)), 0));

  const forecasts = judged.filter((j): j is typeof j & { actual: TaskSize; r: { distribution: number[] } } => j.actual !== null && j.r.distribution !== null && j.r.distribution.length === TASK_SIZES.length);
  return {
    tasks: rows.length,
    builds: built.length,
    by_size,
    spearman: spearman(
      scored.map((r) => r.score),
      scored.map((r) => r.builder_minutes),
    ),
    buckets,
    ece,
    brier: forecasts.length === 0 ? null : { score: r3(forecasts.reduce((a, j) => a + brierOf(j.r.distribution, j.actual), 0) / forecasts.length), n: forecasts.length },
  };
}

export function sizeCalibrationReport(rows: readonly SizeJudgmentRow[]): SizeCalibrationReport {
  const bands = sizeBands(rows);
  const versions = [...new Set(rows.map((r) => r.question_version))].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  const grouped = rows.some((r) => r.question_version !== null);
  return {
    overall: calibrateSizes(rows, bands),
    by_version: grouped ? versions.map((v) => ({ question_version: v, calibration: calibrateSizes(rows.filter((r) => r.question_version === v), bands) })) : [],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Files

/** One merged build: the files Jev predicted for the attempt that merged and the files it changed. */
export type FileJudgmentRow = {
  task_code: string;
  attempt: number;
  question_version: string | null;
  /** Files with Jev's probability at or above the threshold. */
  predicted: string[];
  touched: string[];
};

export type FileScore = FileJudgmentRow & { hits: number; precision: number | null; recall: number | null };

export type FileCalibration = {
  builds: number;
  median_precision: number | null;
  median_recall: number | null;
  /** Mean number of files predicted and changed per build. */
  mean_predicted: number | null;
  mean_touched: number | null;
};

export type FileCalibrationReport = {
  overall: FileCalibration;
  by_version: { question_version: string | null; calibration: FileCalibration }[];
  builds: FileScore[];
};

/** Pure: precision (of the predicted files, those changed) and recall (of the changed files, those predicted). */
export function scoreFiles(row: FileJudgmentRow): FileScore {
  const touched = new Set(row.touched);
  const predicted = [...new Set(row.predicted)];
  const hits = predicted.filter((p) => touched.has(p)).length;
  return {
    ...row,
    hits,
    precision: predicted.length === 0 ? null : r3(hits / predicted.length),
    recall: touched.size === 0 ? null : r3(hits / touched.size),
  };
}

function summarizeFiles(scores: readonly FileScore[]): FileCalibration {
  const nums = (f: (s: FileScore) => number | null) => scores.flatMap((s) => (f(s) === null ? [] : [f(s) as number]));
  const mean = (xs: number[]) => (xs.length === 0 ? null : r1(xs.reduce((a, b) => a + b, 0) / xs.length));
  return {
    builds: scores.length,
    median_precision: median(nums((s) => s.precision)),
    median_recall: median(nums((s) => s.recall)),
    mean_predicted: mean(scores.map((s) => new Set(s.predicted).size)),
    mean_touched: mean(scores.map((s) => new Set(s.touched).size)),
  };
}

export function fileCalibrationReport(rows: readonly FileJudgmentRow[]): FileCalibrationReport {
  const scores = rows.map(scoreFiles);
  const grouped = rows.some((r) => r.question_version !== null);
  const versions = [...new Set(rows.map((r) => r.question_version))].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  return {
    overall: summarizeFiles(scores),
    by_version: grouped ? versions.map((v) => ({ question_version: v, calibration: summarizeFiles(scores.filter((s) => s.question_version === v)) })) : [],
    builds: scores.sort((a, b) => a.task_code.localeCompare(b.task_code)),
  };
}

/** The files a merged attempt changed: the commit's list, else the merge footprint (as execution-facts reads them). */
export function touchedFilesOf(commitDetail: unknown, mergeDetail: unknown): string[] | null {
  const cfiles = obj(commitDetail).files;
  if (Array.isArray(cfiles)) return cfiles.filter((f): f is string => typeof f === 'string');
  const mfiles = obj(obj(mergeDetail).footprint).files;
  if (Array.isArray(mfiles)) return mfiles.map((f) => str(obj(f).path)).filter((f): f is string => !!f);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The report from the database

export type JudgmentCalibration = { sizes: SizeCalibrationReport; files: FileCalibrationReport };

const distributionOf = (raw: unknown): number[] | null => {
  const v = typeof raw === 'string' ? safeParse(raw) : raw;
  return Array.isArray(v) && v.length === TASK_SIZES.length && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null;
};
const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Builder minutes of the latest merged request of each task: summed up to the merge, and the first attempt's. */
export function buildTimes(facts: readonly ExecutionFact[]): Map<string, { total: number | null; first: number | null }> {
  const byRequest = new Map<string, ExecutionFact[]>();
  for (const f of facts) byRequest.set(f.request_id, [...(byRequest.get(f.request_id) ?? []), f]);
  const latest = new Map<string, { mergedAt: string; total: number | null; first: number | null }>();
  for (const list of byRequest.values()) {
    const merged = list.find((f) => f.outcome === 'merged' && f.merged_at);
    if (!merged) continue;
    const upTo = list.filter((f) => f.attempt <= merged.attempt);
    const measured = upTo.flatMap((f) => (f.builder_minutes === null ? [] : [f.builder_minutes]));
    const total = measured.length === 0 ? null : r1(measured.reduce((a, b) => a + b, 0));
    const first = upTo.find((f) => f.attempt === 1)?.builder_minutes ?? null;
    const prev = latest.get(merged.task_code);
    if (!prev || (merged.merged_at as string) > prev.mergedAt) latest.set(merged.task_code, { mergedAt: merged.merged_at as string, total, first });
  }
  return new Map([...latest].map(([k, v]) => [k, { total: v.total, first: v.first }]));
}

/** Reads the project's opinions and builds and derives both calibrations. */
export async function judgmentCalibration(db: Db, projectId: string): Promise<JudgmentCalibration> {
  const { facts } = await executionFacts(db, projectId);
  const times = buildTimes(facts);

  // Sizes: the latest opinion of each task.
  const opinions = await db
    .selectFrom('task_size_opinions')
    .innerJoin('records', 'records.id', 'task_size_opinions.record_id')
    .select(['task_size_opinions.record_id', 'records.code', 'task_size_opinions.size', 'task_size_opinions.score', 'task_size_opinions.confidence', 'task_size_opinions.distribution', 'task_size_opinions.question_version'])
    .where('task_size_opinions.project_id', '=', projectId)
    .orderBy('task_size_opinions.created_at')
    .orderBy('task_size_opinions.id')
    .execute();
  const latest = new Map<string, (typeof opinions)[number]>();
  for (const o of opinions) latest.set(o.record_id, o);
  const sizeRows: SizeJudgmentRow[] = [];
  for (const o of latest.values()) {
    const jev = asSize(o.size);
    if (!jev) continue;
    const time = times.get(o.code);
    sizeRows.push({
      task_code: o.code,
      jev_size: jev,
      score: typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : null,
      confidence: Number.isFinite(o.confidence) ? o.confidence : null,
      distribution: distributionOf(o.distribution),
      question_version: o.question_version ?? null,
      merged: time !== undefined,
      builder_minutes: time?.total ?? null,
      first_attempt_minutes: time?.first ?? null,
    });
  }

  // Files: for each request, the attempt that merged.
  const steps = await db
    .selectFrom('build_steps')
    .innerJoin('build_requests', 'build_requests.id', 'build_steps.build_request_id')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select(['build_steps.build_request_id', 'build_steps.attempt', 'build_steps.stage', 'build_steps.outcome', 'build_steps.detail', 'records.code'])
    .where('build_steps.project_id', '=', projectId)
    .where('build_steps.stage', 'in', ['commit', 'merge'])
    .where('build_steps.outcome', '=', 'ok')
    .orderBy('build_steps.created_at')
    .orderBy('build_steps.id')
    .execute();
  const merged = new Map<string, { code: string; attempt: number; commit: unknown; merge: unknown }>();
  for (const s of steps) {
    if (s.stage !== 'merge') continue;
    merged.set(s.build_request_id, { code: s.code, attempt: s.attempt, commit: null, merge: s.detail });
  }
  for (const s of steps) {
    const m = merged.get(s.build_request_id);
    if (s.stage === 'commit' && m && m.attempt === s.attempt) m.commit = s.detail;
  }
  const fileRows: FileJudgmentRow[] = [];
  if (merged.size > 0) {
    const code = await db
      .selectFrom('task_code_opinions')
      .select(['build_request_id', 'attempt', 'path', 'jev_p', 'question_version'])
      .where('project_id', '=', projectId)
      .where('build_request_id', 'in', [...merged.keys()])
      .where('jev_p', 'is not', null)
      .execute();
    const byBuild = new Map<string, typeof code>();
    for (const c of code) byBuild.set(`${c.build_request_id}:${c.attempt}`, [...(byBuild.get(`${c.build_request_id}:${c.attempt}`) ?? []), c]);
    for (const [requestId, m] of merged) {
      const list = byBuild.get(`${requestId}:${m.attempt}`);
      const touched = touchedFilesOf(m.commit, m.merge);
      if (!list || list.length === 0 || !touched) continue;
      fileRows.push({
        task_code: m.code,
        attempt: m.attempt,
        question_version: list[0]?.question_version ?? null,
        predicted: list.filter((c) => (c.jev_p ?? 0) >= FILE_PREDICTION_THRESHOLD).map((c) => c.path),
        touched,
      });
    }
  }
  return { sizes: sizeCalibrationReport(sizeRows), files: fileCalibrationReport(fileRows) };
}
