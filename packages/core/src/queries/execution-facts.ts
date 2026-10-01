// Integrated observability, first piece: one fact per build attempt (build request, attempt number), joined with
// what DEMIURGO already knows (task, feature, sizes, criteria, reviewer findings, usage, issues opened later), and
// a pure summary that answers improvement questions without SQL. Derived on read; nothing is stored.
//
// Practice notes. Lead time for changes (first start to merge) follows the DORA definition (Forsgren, Humble and Kim,
// «Accelerate», 2018; DORA reports). The rank correlation is Spearman's (C. Spearman, «The proof and measurement of
// association between two things», 1904), with the average rank for ties. Medians instead of means because lead
// times are skewed (statistics textbook practice). Everything else is «convención nuestra»: the split of an attempt
// into builder, CI, review and wait (the timeline's segments, see build/timeline.ts and build/flow.ts), the token
// total (input + output; cached and reasoning tokens are subsets reported apart), the size points (XS 1, S 2, M 3,
// L 5, XL 8: SIZE_POINTS of the domain) and the grouping of costs per task and per feature.

import { SIZE_POINTS, type TaskSize } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { withEffectiveBasis } from '../build/basis.ts';
import { contextHit } from '../build/flow.ts';
import { type BuildTimeline, type TimelineAttempt, buildTimeline } from '../build/timeline.ts';

/** What one agent call consumed. Null fields: the provider did not say. */
export type UsageFact = {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  /** Total tokens: input + output (cached and reasoning are subsets of those; our convention). Null when none were reported. */
  total_tokens: number | null;
  /** Only when the provider declared a cost; never estimated. */
  cost_usd: number | null;
  duration_ms: number | null;
  turns: number | null;
};

export type FactOutcome = 'merged' | 'changes_requested' | 'failed' | 'running' | 'cancelled' | 'open';

export type ExecutionFact = {
  request_id: string;
  attempt: number;
  /** Attempts the request has in total. */
  request_attempts: number;
  task_code: string;
  task_title: string | null;
  feature_code: string | null;
  /** The task's current sizes (not as they were when the attempt ran). */
  size_person: TaskSize | null;
  size_jev: TaskSize | null;
  jev_confidence: number | null;
  criteria_count: number;
  provider: string | null;
  model: string | null;
  agent_version: string | null;
  outcome: FactOutcome;
  /** Why a failed attempt failed (the recorded kind, else the stage that failed). */
  failure_kind: string | null;
  /** The stage whose row ended the attempt, for any non-merged outcome. */
  ended_stage: string | null;
  blocking_comments: number;
  /** Jev's category of each blocking comment (`unclassified` while Jev has not said). */
  blocking_kinds: string[];
  started_at: string;
  ended_at: string;
  attempt_minutes: number;
  builder_minutes: number | null;
  ci_minutes: number;
  review_minutes: number;
  /** The rest of the attempt's wall time: preparation, gaps, merge waits. */
  wait_minutes: number;
  /** First start to merge of the request (DORA lead time for changes); only on the attempt that merged. */
  lead_minutes: number | null;
  builder_usage: UsageFact | null;
  reviewer_usage: UsageFact | null;
  files_changed: number | null;
  /** Of the files the attempt changed, the share the builder had been given; null when either side is unknown. */
  context_recall: number | null;
  /** Of the files the builder was given, the share the attempt changed. */
  context_precision: number | null;
  merged_at: string | null;
  main_conclusion: string | null;
  /** Issues opened against the task after it merged; only on the attempt that merged. */
  issues_later: number | null;
};

export type AgentRunFact = {
  agent: string;
  provider: string | null;
  model: string | null;
  state: string;
  failure_kind: string | null;
  duration_ms: number | null;
  usage: UsageFact | null;
};

export type Observability = { facts: ExecutionFact[]; agent_runs: AgentRunFact[] };

const SIZES = new Set<string>(Object.keys(SIZE_POINTS));
const asSize = (v: unknown): TaskSize | null => (typeof v === 'string' && SIZES.has(v) ? (v as TaskSize) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ms = (d: Date | string | number) => new Date(d).getTime();
const min1 = (n: number) => Math.round((n / 60_000) * 10) / 10;

/** Reads the `usage` object of a builder step or of an ai_run; null when it has no number in it. */
export function usageOf(raw: unknown): UsageFact | null {
  const u = obj(raw);
  const input = num(u.inputTokens);
  const output = num(u.outputTokens);
  const out: UsageFact = {
    input_tokens: input,
    cached_input_tokens: num(u.cachedInputTokens),
    output_tokens: output,
    reasoning_tokens: num(u.reasoningTokens),
    total_tokens: input === null && output === null ? null : (input ?? 0) + (output ?? 0),
    cost_usd: num(u.declaredCostUsd),
    duration_ms: num(u.durationMs),
    turns: num(u.turns),
  };
  return Object.values(out).every((v) => v === null) ? null : out;
}

/** Wall time covered by the union of the intervals of the segments of the given stages (overlaps counted once). */
function coveredMs(attempt: TimelineAttempt, stages: readonly string[]): number {
  const iv = attempt.segments
    .filter((s) => stages.includes(s.stage))
    .map((s) => [ms(s.start), ms(s.end)] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = 0;
  let curEnd = -Infinity;
  for (const [a, b] of iv) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else curEnd = Math.max(curEnd, b);
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

type StepRow = { build_request_id: string; attempt: number; stage: string; outcome: string; at: Date | string; detail: unknown };

/** Reads every attempt of the project and joins what DEMIURGO knows about it. */
export async function executionFacts(db: Db, projectId: string, now: Date = new Date()): Promise<Observability> {
  const requestsRaw = await db
    .selectFrom('build_requests')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select([
      'build_requests.id',
      'build_requests.task_id',
      'build_requests.task_version_id',
      'build_requests.feature_version_id',
      'build_requests.brief',
      'records.code as task_code',
      'build_requests.state',
      'build_requests.requested_by',
      'build_requests.requested_at',
      'build_requests.pr_url',
      'build_requests.pr_number',
    ])
    .where('build_requests.project_id', '=', projectId)
    .execute();
  const requests = await withEffectiveBasis(db, requestsRaw);
  const steps: StepRow[] = (
    await db
      .selectFrom('build_steps')
      .select(['build_request_id', 'attempt', 'stage', 'outcome', 'detail', 'created_at as at'])
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute()
  ).map((s) => ({ ...s, at: s.at as unknown as Date }));
  const timeline: BuildTimeline = buildTimeline(
    requests.map((r) => ({ ...r, requested_at: r.requested_at as unknown as Date })),
    steps,
    { now, since: new Date(0) },
  );

  // Task titles, features, sizes, criteria.
  const taskIds = [...new Set(requests.map((r) => r.task_id))];
  const versionIds = [...new Set(requests.map((r) => r.task_version_id))];
  const titles = new Map<string, string>();
  if (versionIds.length > 0) {
    const rows = await db.selectFrom('record_versions').select(['id', 'title']).where('id', 'in', versionIds).execute();
    for (const r of rows) titles.set(r.id, r.title);
  }
  const featureIds = [...new Set(requests.map((r) => r.feature_version_id).filter((x): x is string => !!x))];
  const featureCode = new Map<string, string>();
  if (featureIds.length > 0) {
    const rows = await db
      .selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['record_versions.id', 'records.code'])
      .where('record_versions.id', 'in', featureIds)
      .execute();
    for (const r of rows) featureCode.set(r.id, r.code);
  }
  const personSize = new Map<string, TaskSize | null>();
  const jevSize = new Map<string, { size: TaskSize | null; confidence: number | null }>();
  const covers = new Map<string, number>();
  const issuesByTask = new Map<string, Date[]>();
  if (taskIds.length > 0) {
    for (const r of await db
      .selectFrom('task_sizes')
      .select(['record_id', 'size', 'created_at', 'id'])
      .where('record_id', 'in', taskIds)
      .orderBy('created_at')
      .orderBy('id')
      .execute())
      personSize.set(r.record_id, asSize(r.size));
    for (const r of await db
      .selectFrom('task_size_opinions')
      .select(['record_id', 'size', 'confidence', 'created_at', 'id'])
      .where('record_id', 'in', taskIds)
      .orderBy('created_at')
      .orderBy('id')
      .execute())
      jevSize.set(r.record_id, { size: asSize(r.size), confidence: num(r.confidence) });
    for (const r of await db
      .selectFrom('task_covers')
      .select(['record_id', 'codes', 'created_at', 'id'])
      .where('record_id', 'in', taskIds)
      .orderBy('created_at')
      .orderBy('id')
      .execute())
      covers.set(r.record_id, (r.codes ?? []).length);
    for (const r of await db.selectFrom('issues').select(['task_id', 'opened_at']).where('project_id', '=', projectId).where('task_id', 'in', taskIds).execute()) {
      if (r.task_id) issuesByTask.set(r.task_id, [...(issuesByTask.get(r.task_id) ?? []), new Date(r.opened_at as unknown as Date)]);
    }
  }

  // Reviewer runs, their reviews and Jev's category of each comment.
  const stepsOf = new Map<string, StepRow[]>();
  for (const s of steps) stepsOf.set(`${s.build_request_id}:${s.attempt}`, [...(stepsOf.get(`${s.build_request_id}:${s.attempt}`) ?? []), s]);
  const runIds = [...new Set(steps.map((s) => str(obj(s.detail).run_id)).filter((x): x is string => !!x && s_isUuid(x)))];
  const runUsage = new Map<string, UsageFact | null>();
  const reviewByRun = new Map<string, { id: string; comments: { severity: string | null }[] }>();
  const kindsOf = new Map<string, string>();
  if (runIds.length > 0) {
    for (const r of await db.selectFrom('ai_runs').select(['id', 'usage']).where('id', 'in', runIds).execute()) runUsage.set(r.id, usageOf(r.usage));
    const reviews = await db.selectFrom('pr_reviews').select(['id', 'run_id', 'comments']).where('run_id', 'in', runIds).execute();
    for (const r of reviews) {
      if (!r.run_id) continue;
      const comments = Array.isArray(r.comments) ? (r.comments as unknown[]).map((c) => ({ severity: str(obj(c).severity) })) : [];
      reviewByRun.set(r.run_id, { id: r.id, comments });
    }
    const reviewIds = [...reviewByRun.values()].map((r) => r.id);
    if (reviewIds.length > 0) {
      for (const k of await db
        .selectFrom('review_finding_kinds')
        .select(['pr_review_id', 'comment_index', 'category', 'created_at', 'id'])
        .where('pr_review_id', 'in', reviewIds)
        .orderBy('created_at')
        .orderBy('id')
        .execute())
        kindsOf.set(`${k.pr_review_id}:${k.comment_index}`, k.category);
    }
  }

  const byId = new Map(requests.map((r) => [r.id, r]));
  const facts: ExecutionFact[] = [];
  for (const tr of timeline.requests) {
    const req = byId.get(tr.id);
    if (!req) continue;
    const lastMergedAttempt = [...tr.attempts].reverse().find((a) => a.merged_at)?.n ?? null;
    const total = Math.max(...tr.attempts.map((a) => a.n));
    for (const a of tr.attempts) {
      const rows = stepsOf.get(`${tr.id}:${a.n}`) ?? [];
      const builderRow = [...rows].reverse().find((r) => r.stage === 'builder' && (r.outcome === 'ok' || r.outcome === 'failed'));
      const bd = obj(builderRow?.detail);
      const reviewRow = [...rows].reverse().find((r) => r.stage === 'review' && str(obj(r.detail).run_id));
      const runId = str(obj(reviewRow?.detail).run_id);
      const review = runId ? reviewByRun.get(runId) : undefined;
      const blockingIdx = review ? review.comments.flatMap((c, i) => (c.severity === 'blocking' ? [i] : [])) : [];
      const blocking = review ? blockingIdx.length : (a.ended_by?.blocking ?? 0);
      const kinds = review ? blockingIdx.map((i) => kindsOf.get(`${review.id}:${i}`) ?? 'unclassified') : [];
      const commit = [...rows].reverse().find((r) => r.stage === 'commit' && r.outcome === 'ok');
      const cfiles = obj(commit?.detail).files;
      const merge = [...rows].reverse().find((r) => r.stage === 'merge' && r.outcome === 'ok');
      const mfiles = obj(obj(merge?.detail).footprint).files;
      const touched: string[] | null = Array.isArray(cfiles)
        ? cfiles.filter((f): f is string => typeof f === 'string')
        : Array.isArray(mfiles)
          ? mfiles.map((f) => str(obj(f).path)).filter((f): f is string => !!f)
          : null;
      const given = obj(bd.code_to_extend).files;
      const hit = touched && Array.isArray(given) ? contextHit({ given: given.filter((f): f is string => typeof f === 'string'), touched }, 0) : null;
      const builderMs = coveredMs(a, ['builder']);
      const ciMs = coveredMs(a, ['ci']);
      const reviewMs = coveredMs(a, ['review']);
      const wall = Math.max(0, ms(a.end) - ms(a.start));
      const wait = Math.max(0, wall - coveredMs(a, ['builder', 'ci', 'review']));
      const merged = a.merged_at !== null;
      const mergedAt = a.merged_at ? new Date(a.merged_at) : null;
      const later = merged && mergedAt ? (issuesByTask.get(req.task_id) ?? []).filter((d) => d.getTime() > (mergedAt as Date).getTime()).length : null;
      const outcome = (a.result === 'open' || a.result === 'running' || a.result === 'cancelled' || a.result === 'failed' || a.result === 'changes_requested' || a.result === 'merged' ? a.result : 'open') as FactOutcome;
      const failure =
        outcome === 'failed'
          ? (a.ended_by?.failure_kind ?? a.builder?.failure_kind ?? (a.ended_by ? `${a.ended_by.stage}_failed` : 'unknown'))
          : null;
      facts.push({
        request_id: tr.id,
        attempt: a.n,
        request_attempts: total,
        task_code: tr.task_code,
        task_title: titles.get(req.task_version_id) ?? null,
        feature_code: req.feature_version_id ? (featureCode.get(req.feature_version_id) ?? null) : null,
        size_person: personSize.get(req.task_id) ?? null,
        size_jev: jevSize.get(req.task_id)?.size ?? null,
        jev_confidence: jevSize.get(req.task_id)?.confidence ?? null,
        criteria_count: covers.get(req.task_id) ?? 0,
        provider: str(bd.provider) ?? a.builder?.provider ?? null,
        model: str(bd.model) ?? a.builder?.model ?? null,
        agent_version: str(bd.agent_version),
        outcome,
        failure_kind: failure,
        ended_stage: outcome === 'merged' ? null : (a.ended_by?.stage ?? null),
        blocking_comments: outcome === 'changes_requested' ? blocking : 0,
        blocking_kinds: outcome === 'changes_requested' ? kinds : [],
        started_at: a.start,
        ended_at: a.end,
        attempt_minutes: min1(wall),
        builder_minutes: builderRow || builderMs > 0 ? min1(builderMs || num(bd.duration_ms) || 0) : null,
        ci_minutes: min1(ciMs),
        review_minutes: min1(reviewMs),
        wait_minutes: min1(wait),
        lead_minutes: merged && tr.flow ? min1(tr.flow.lead_ms) : null,
        builder_usage: usageOf(bd.usage),
        reviewer_usage: runId ? (runUsage.get(runId) ?? null) : null,
        files_changed: touched ? touched.length : null,
        context_recall: hit && hit.counts.touched > 0 ? round2(hit.counts.hits / hit.counts.touched) : null,
        context_precision: hit && hit.counts.given > 0 ? round2(hit.counts.hits / hit.counts.given) : null,
        merged_at: a.merged_at,
        main_conclusion: merged && a.n === lastMergedAttempt ? (a.out.main?.conclusion ?? null) : null,
        issues_later: later,
      });
    }
  }
  facts.sort((a, b) => b.started_at.localeCompare(a.started_at) || b.attempt - a.attempt);

  const runs = await db
    .selectFrom('ai_runs')
    .select(['agent', 'provider', 'model', 'state', 'failure_kind', 'started_at', 'finished_at', 'usage'])
    .where('project_id', '=', projectId)
    .execute();
  const agent_runs: AgentRunFact[] = runs.map((r) => ({
    agent: r.agent ?? 'unknown',
    provider: r.provider ?? null,
    model: r.model ?? null,
    state: r.state,
    failure_kind: r.failure_kind ?? null,
    duration_ms: r.started_at && r.finished_at ? Math.max(0, ms(r.finished_at as unknown as Date) - ms(r.started_at as unknown as Date)) : null,
    usage: usageOf(r.usage),
  }));
  return { facts, agent_runs };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const s_isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ---------------------------------------------------------------------------------------------------------------
// The summary (pure)

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const sum = (xs: readonly (number | null)[]): number | null => {
  const k = xs.filter((x): x is number => x !== null);
  return k.length === 0 ? null : k.reduce((a, b) => a + b, 0);
};

/** Average ranks (1-based; ties share the mean of their positions). */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1] as { v: number }).v === (order[i] as { v: number }).v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[(order[k] as { i: number }).i] = rank;
    i = j + 1;
  }
  return out;
}

/** Spearman's rank correlation (Pearson over average ranks); null with fewer than 3 pairs or when one side does not vary. */
export function spearman(xs: readonly number[], ys: readonly number[]): { rho: number; n: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const rx = ranks(xs.slice(0, n));
  const ry = ranks(ys.slice(0, n));
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (rx[i] as number) - mx;
    const dy = (ry[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return { rho: Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000, n };
}

export type TaskRollup = {
  task_code: string;
  task_title: string | null;
  feature_code: string | null;
  size_person: TaskSize | null;
  size_jev: TaskSize | null;
  merged: boolean;
  /** Lead time of the latest merged request (DORA lead time for changes). */
  lead_minutes: number | null;
  attempts: number;
  builder_minutes: number;
  /** Builder + reviewer tokens over every attempt of the task; null when no attempt reported any. */
  tokens: number | null;
  cost_usd: number | null;
  /** Attempts whose builder usage is missing (older attempts). */
  attempts_without_usage: number;
};

/** One row per task: its latest merged request gives the lead time; attempts, minutes, tokens and cost add up over all its attempts. */
export function rollupTasks(facts: readonly ExecutionFact[]): TaskRollup[] {
  const byTask = new Map<string, ExecutionFact[]>();
  for (const f of facts) byTask.set(f.task_code, [...(byTask.get(f.task_code) ?? []), f]);
  const out: TaskRollup[] = [];
  for (const [code, list] of byTask) {
    const mergedFacts = list.filter((f) => f.lead_minutes !== null).sort((a, b) => (b.merged_at ?? '').localeCompare(a.merged_at ?? ''));
    const latest = mergedFacts[0];
    const any = list[0] as ExecutionFact;
    const tokenParts = list.flatMap((f) => [f.builder_usage?.total_tokens ?? null, f.reviewer_usage?.total_tokens ?? null]);
    const costParts = list.flatMap((f) => [f.builder_usage?.cost_usd ?? null, f.reviewer_usage?.cost_usd ?? null]);
    out.push({
      task_code: code,
      task_title: any.task_title,
      feature_code: any.feature_code,
      size_person: any.size_person,
      size_jev: any.size_jev,
      merged: !!latest,
      lead_minutes: latest?.lead_minutes ?? null,
      attempts: list.length,
      builder_minutes: r1(list.reduce((n, f) => n + (f.builder_minutes ?? 0), 0)) ?? 0,
      tokens: sum(tokenParts),
      cost_usd: sum(costParts),
      attempts_without_usage: list.filter((f) => f.builder_minutes !== null && f.builder_usage === null).length,
    });
  }
  return out.sort((a, b) => a.task_code.localeCompare(b.task_code));
}

export type CalibrationRow = {
  /** The size, or `none` for tasks without one. */
  size: TaskSize | 'none';
  tasks: number;
  median_lead_minutes: number | null;
  median_attempts: number | null;
  median_builder_minutes: number | null;
  median_tokens: number | null;
  median_cost_usd: number | null;
};

export type Calibration = {
  rows: CalibrationRow[];
  /** Spearman between size points and lead time over merged, sized tasks. */
  correlation: { rho: number; n: number } | null;
};

const SIZE_ORDER: (TaskSize | 'none')[] = ['XS', 'S', 'M', 'L', 'XL', 'none'];

function calibrate(tasks: readonly TaskRollup[], pick: (t: TaskRollup) => TaskSize | null): Calibration {
  const merged = tasks.filter((t) => t.merged);
  const rows: CalibrationRow[] = [];
  for (const size of SIZE_ORDER) {
    const group = merged.filter((t) => (pick(t) ?? 'none') === size);
    if (group.length === 0) continue;
    rows.push({
      size,
      tasks: group.length,
      median_lead_minutes: r1(median(group.flatMap((t) => (t.lead_minutes === null ? [] : [t.lead_minutes])))),
      median_attempts: median(group.map((t) => t.attempts)),
      median_builder_minutes: r1(median(group.map((t) => t.builder_minutes))),
      median_tokens: r1(median(group.flatMap((t) => (t.tokens === null ? [] : [t.tokens])))),
      median_cost_usd: median(group.flatMap((t) => (t.cost_usd === null ? [] : [t.cost_usd]))),
    });
  }
  const sized = merged.filter((t) => pick(t) !== null && t.lead_minutes !== null);
  return {
    rows,
    correlation: spearman(
      sized.map((t) => SIZE_POINTS[pick(t) as TaskSize]),
      sized.map((t) => t.lead_minutes as number),
    ),
  };
}

export type CostRow = { key: string; title: string | null; tasks: number; attempts: number; tokens: number | null; cost_usd: number | null; attempts_without_usage: number };

export type ReworkCause = { cause: string; count: number };

export type AgentRow = {
  agent: string;
  provider: string | null;
  model: string | null;
  runs: number;
  failures: number;
  tokens: number | null;
  cost_usd: number | null;
  median_duration_seconds: number | null;
};

export type ObservabilitySummary = {
  tasks_merged: number;
  attempts: number;
  calibration: { by_jev: Calibration; by_person: Calibration };
  cost: { per_task: CostRow[]; per_feature: CostRow[]; attempts_without_usage: number; attempts_with_builder: number };
  rework: {
    /** changes_requested: blocking comments by Jev's category. */
    changes_requested_by_kind: ReworkCause[];
    changes_requested_attempts: number;
    failed_by_kind: ReworkCause[];
    failed_attempts: number;
  };
  agents: AgentRow[];
};

function count(keys: readonly string[]): ReworkCause[] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([cause, n]) => ({ cause, count: n })).sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));
}

/** Pure: the answers to the improvement questions from the facts (and the agent runs). */
export function observabilitySummary(facts: readonly ExecutionFact[], agentRuns: readonly AgentRunFact[] = []): ObservabilitySummary {
  const tasks = rollupTasks(facts);
  const costRow = (key: string, title: string | null, list: readonly TaskRollup[]): CostRow => ({
    key,
    title,
    tasks: list.length,
    attempts: list.reduce((n, t) => n + t.attempts, 0),
    tokens: sum(list.map((t) => t.tokens)),
    cost_usd: sum(list.map((t) => t.cost_usd)),
    attempts_without_usage: list.reduce((n, t) => n + t.attempts_without_usage, 0),
  });
  const perTask = tasks.map((t) => costRow(t.task_code, t.task_title, [t])).sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.key.localeCompare(b.key));
  const byFeature = new Map<string, TaskRollup[]>();
  for (const t of tasks) byFeature.set(t.feature_code ?? '—', [...(byFeature.get(t.feature_code ?? '—') ?? []), t]);
  const perFeature = [...byFeature].map(([k, list]) => costRow(k, null, list)).sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.key.localeCompare(b.key));

  const changes = facts.filter((f) => f.outcome === 'changes_requested');
  const failed = facts.filter((f) => f.outcome === 'failed');

  // Agents: the recorded ai_runs, and the builder (not an ai_run) from the facts.
  const groups = new Map<string, { agent: string; provider: string | null; model: string | null; runs: number; failures: number; tokens: (number | null)[]; costs: (number | null)[]; durations: number[] }>();
  const bucket = (agent: string, provider: string | null, model: string | null) => {
    const key = `${agent}|${provider ?? ''}|${model ?? ''}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { agent, provider, model, runs: 0, failures: 0, tokens: [], costs: [], durations: [] }));
    return g;
  };
  for (const r of agentRuns) {
    const g = bucket(r.agent, r.provider, r.model);
    g.runs++;
    if (r.state === 'failed' || r.failure_kind) g.failures++;
    g.tokens.push(r.usage?.total_tokens ?? null);
    g.costs.push(r.usage?.cost_usd ?? null);
    const d = r.usage?.duration_ms ?? r.duration_ms;
    if (d !== null) g.durations.push(d);
  }
  for (const f of facts) {
    if (f.builder_minutes === null) continue;
    const g = bucket('builder', f.provider, f.model);
    g.runs++;
    if (f.outcome === 'failed' && f.ended_stage === 'builder') g.failures++;
    g.tokens.push(f.builder_usage?.total_tokens ?? null);
    g.costs.push(f.builder_usage?.cost_usd ?? null);
    g.durations.push(f.builder_usage?.duration_ms ?? f.builder_minutes * 60_000);
  }
  const agents: AgentRow[] = [...groups.values()]
    .map((g) => ({
      agent: g.agent,
      provider: g.provider,
      model: g.model,
      runs: g.runs,
      failures: g.failures,
      tokens: sum(g.tokens),
      cost_usd: sum(g.costs),
      median_duration_seconds: r1((median(g.durations) ?? NaN) / 1000 || null),
    }))
    .sort((a, b) => b.runs - a.runs || a.agent.localeCompare(b.agent));

  return {
    tasks_merged: tasks.filter((t) => t.merged).length,
    attempts: facts.length,
    calibration: { by_jev: calibrate(tasks, (t) => t.size_jev), by_person: calibrate(tasks, (t) => t.size_person) },
    cost: {
      per_task: perTask,
      per_feature: perFeature,
      attempts_without_usage: facts.filter((f) => f.builder_minutes !== null && f.builder_usage === null).length,
      attempts_with_builder: facts.filter((f) => f.builder_minutes !== null).length,
    },
    rework: {
      changes_requested_by_kind: count(changes.flatMap((f) => (f.blocking_kinds.length > 0 ? f.blocking_kinds : ['unclassified']))),
      changes_requested_attempts: changes.length,
      failed_by_kind: count(failed.map((f) => f.failure_kind ?? 'unknown')),
      failed_attempts: failed.length,
    },
    agents,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// CSV

export const FACT_COLUMNS: { key: string; value: (f: ExecutionFact) => string | number | null }[] = [
  { key: 'request_id', value: (f) => f.request_id },
  { key: 'attempt', value: (f) => f.attempt },
  { key: 'request_attempts', value: (f) => f.request_attempts },
  { key: 'task_code', value: (f) => f.task_code },
  { key: 'task_title', value: (f) => f.task_title },
  { key: 'feature_code', value: (f) => f.feature_code },
  { key: 'size_person', value: (f) => f.size_person },
  { key: 'size_jev', value: (f) => f.size_jev },
  { key: 'jev_confidence', value: (f) => f.jev_confidence },
  { key: 'criteria_count', value: (f) => f.criteria_count },
  { key: 'provider', value: (f) => f.provider },
  { key: 'model', value: (f) => f.model },
  { key: 'agent_version', value: (f) => f.agent_version },
  { key: 'outcome', value: (f) => f.outcome },
  { key: 'failure_kind', value: (f) => f.failure_kind },
  { key: 'blocking_comments', value: (f) => f.blocking_comments },
  { key: 'blocking_kinds', value: (f) => f.blocking_kinds.join('|') },
  { key: 'started_at', value: (f) => f.started_at },
  { key: 'ended_at', value: (f) => f.ended_at },
  { key: 'attempt_minutes', value: (f) => f.attempt_minutes },
  { key: 'builder_minutes', value: (f) => f.builder_minutes },
  { key: 'ci_minutes', value: (f) => f.ci_minutes },
  { key: 'review_minutes', value: (f) => f.review_minutes },
  { key: 'wait_minutes', value: (f) => f.wait_minutes },
  { key: 'lead_minutes', value: (f) => f.lead_minutes },
  { key: 'builder_input_tokens', value: (f) => f.builder_usage?.input_tokens ?? null },
  { key: 'builder_cached_input_tokens', value: (f) => f.builder_usage?.cached_input_tokens ?? null },
  { key: 'builder_output_tokens', value: (f) => f.builder_usage?.output_tokens ?? null },
  { key: 'builder_reasoning_tokens', value: (f) => f.builder_usage?.reasoning_tokens ?? null },
  { key: 'builder_cost_usd', value: (f) => f.builder_usage?.cost_usd ?? null },
  { key: 'reviewer_input_tokens', value: (f) => f.reviewer_usage?.input_tokens ?? null },
  { key: 'reviewer_output_tokens', value: (f) => f.reviewer_usage?.output_tokens ?? null },
  { key: 'reviewer_cost_usd', value: (f) => f.reviewer_usage?.cost_usd ?? null },
  { key: 'files_changed', value: (f) => f.files_changed },
  { key: 'context_recall', value: (f) => f.context_recall },
  { key: 'context_precision', value: (f) => f.context_precision },
  { key: 'merged_at', value: (f) => f.merged_at },
  { key: 'main_conclusion', value: (f) => f.main_conclusion },
  { key: 'issues_later', value: (f) => f.issues_later },
];

/** A CSV cell (RFC 4180 quoting). A text that a spreadsheet would read as a formula gets a leading quote (OWASP «CSV injection»). */
function cell(v: string | number | null): string {
  if (v === null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The facts as CSV (header, then one line per attempt), CRLF line ends. */
export function factsToCsv(facts: readonly ExecutionFact[]): string {
  const lines = [FACT_COLUMNS.map((c) => c.key).join(',')];
  for (const f of facts) lines.push(FACT_COLUMNS.map((c) => cell(c.value(f))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
