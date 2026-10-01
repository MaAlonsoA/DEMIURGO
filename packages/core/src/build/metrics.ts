// Delivery metrics of a project's builds, computed on read from `build_steps` (nothing is stored):
// lead time from the first `repo started` to `merge ok`, attempts, minutes per stage and the builder's
// model for each merged task, the medians and p90 over the latest merged tasks, the first-pass rate and
// the running builds. Practice: DORA «lead time for changes» and «change failure rate» (here: a task that
// needed more than one attempt), Forsgren, Humble and Kim, «Accelerate» (2018). Pure: no I/O.

import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';

export type StepRow = {
  build_request_id: string;
  task_code: string;
  attempt: number;
  stage: string;
  outcome: string;
  model: string | null;
  duration_ms: number | null;
  at: Date | string;
};

export const TIMED_STAGES = ['builder', 'environment', 'ci', 'review'] as const;
export type TimedStage = (typeof TIMED_STAGES)[number];

export type MergedTaskMetrics = {
  code: string;
  merged_at: string;
  lead_minutes: number;
  attempts: number;
  stage_minutes: Record<TimedStage, number>;
  model: string | null;
};

export type Summary = {
  tasks: number;
  lead_median: number | null;
  lead_p90: number | null;
  builder_median: number | null;
  ci_median: number | null;
  review_median: number | null;
  /** Merged on attempt 1 (null without merged tasks). */
  first_pass: { merged_first_try: number; of: number } | null;
};

export type ModelSummary = { model: string; tasks: number; lead_median: number | null; builder_median: number | null; ci_median: number | null; review_median: number | null };

export type RunningBuild = { code: string; elapsed_minutes: number; stage: string; outcome: string; attempt: number };

export type DeliveryMetrics = {
  /** The last merged tasks, newest first. */
  merged: MergedTaskMetrics[];
  last10: Summary;
  all: Summary;
  by_model_last10: ModelSummary[];
  by_model_all: ModelSummary[];
  running: RunningBuild[];
};

const ms = (d: Date | string) => new Date(d).getTime();
const minutes = (n: number) => Math.round((n / 60_000) * 10) / 10;
const ENDS = new Set(['ok', 'failed', 'changes_requested', 'cancelled']);

/** The p-th percentile (nearest rank) of the values, or null without values. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] as number;
}

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const m = sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return Math.round(m * 10) / 10;
};

/** Time spent in a stage over all attempts: each `started` up to the next ending row of that attempt and stage. */
function stageMs(rows: StepRow[], stage: string): number {
  let total = 0;
  const attempts = new Set(rows.filter((r) => r.stage === stage).map((r) => r.attempt));
  for (const attempt of attempts) {
    const mine = rows.filter((r) => r.stage === stage && r.attempt === attempt);
    let startedAt: number | null = null;
    for (const r of mine) {
      if (r.outcome === 'started') startedAt ??= ms(r.at);
      else if (ENDS.has(r.outcome)) {
        if (startedAt !== null) total += Math.max(0, ms(r.at) - startedAt);
        else if (stage === 'builder' && r.duration_ms) total += r.duration_ms;
        startedAt = null;
      }
    }
  }
  return total;
}

const summaryOf = (tasks: MergedTaskMetrics[]): Summary => ({
  tasks: tasks.length,
  lead_median: median(tasks.map((t) => t.lead_minutes)),
  lead_p90: percentile(tasks.map((t) => t.lead_minutes), 90),
  builder_median: median(tasks.map((t) => t.stage_minutes.builder)),
  ci_median: median(tasks.map((t) => t.stage_minutes.ci)),
  review_median: median(tasks.map((t) => t.stage_minutes.review)),
  first_pass: tasks.length ? { merged_first_try: tasks.filter((t) => t.attempts === 1).length, of: tasks.length } : null,
});

function byModel(tasks: MergedTaskMetrics[]): ModelSummary[] {
  const groups = new Map<string, MergedTaskMetrics[]>();
  for (const t of tasks) groups.set(t.model ?? 'unknown', [...(groups.get(t.model ?? 'unknown') ?? []), t]);
  return [...groups.entries()]
    .map(([model, list]) => {
      const s = summaryOf(list);
      return { model, tasks: list.length, lead_median: s.lead_median, builder_median: s.builder_median, ci_median: s.ci_median, review_median: s.review_median };
    })
    .sort((a, b) => b.tasks - a.tasks || a.model.localeCompare(b.model));
}

/** Metrics from the steps of every build request of a project (any order), at `now`. */
export function deliveryMetrics(steps: StepRow[], now: Date = new Date()): DeliveryMetrics {
  const requests = new Map<string, StepRow[]>();
  for (const s of steps) requests.set(s.build_request_id, [...(requests.get(s.build_request_id) ?? []), s]);
  const merged: MergedTaskMetrics[] = [];
  const running: RunningBuild[] = [];
  for (const [, unsorted] of requests) {
    const rows = [...unsorted].sort((a, b) => ms(a.at) - ms(b.at));
    const code = (rows[0] as StepRow).task_code;
    const first = rows.find((r) => r.stage === 'repo' && r.outcome === 'started') ?? (rows[0] as StepRow);
    const done = [...rows].reverse().find((r) => r.stage === 'merge' && r.outcome === 'ok');
    if (done) {
      const builders = rows.filter((r) => r.stage === 'builder' && r.model);
      merged.push({
        code,
        merged_at: new Date(done.at).toISOString(),
        lead_minutes: minutes(ms(done.at) - ms(first.at)),
        attempts: Math.max(...rows.map((r) => r.attempt)),
        stage_minutes: Object.fromEntries(TIMED_STAGES.map((st) => [st, minutes(stageMs(rows, st))])) as Record<TimedStage, number>,
        model: builders.at(-1)?.model ?? null,
      });
      continue;
    }
    const last = rows.at(-1) as StepRow;
    if (last.outcome === 'started' || last.outcome === 'waiting')
      running.push({ code, elapsed_minutes: minutes(Math.max(0, now.getTime() - ms(first.at))), stage: last.stage, outcome: last.outcome, attempt: last.attempt });
  }
  // One row per task: its latest merge.
  merged.sort((a, b) => b.merged_at.localeCompare(a.merged_at));
  const seen = new Set<string>();
  const perTask = merged.filter((m) => !seen.has(m.code) && seen.add(m.code));
  const last10 = perTask.slice(0, 10);
  running.sort((a, b) => b.elapsed_minutes - a.elapsed_minutes);
  return { merged: last10, last10: summaryOf(last10), all: summaryOf(perTask), by_model_last10: byModel(last10), by_model_all: byModel(perTask), running };
}

/** Reads the steps of a project and computes its delivery metrics. */
export async function projectDeliveryMetrics(db: Db, projectId: string): Promise<DeliveryMetrics> {
  const rows = await db
    .selectFrom('build_steps')
    .innerJoin('build_requests', 'build_requests.id', 'build_steps.build_request_id')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select([
      'build_steps.build_request_id',
      'records.code as task_code',
      'build_steps.attempt',
      'build_steps.stage',
      'build_steps.outcome',
      'build_steps.created_at as at',
      sql<string | null>`build_steps.detail->>'model'`.as('model'),
      sql<number | null>`(build_steps.detail->>'duration_ms')::float8`.as('duration_ms'),
    ])
    .where('build_steps.project_id', '=', projectId)
    .orderBy('build_steps.created_at')
    .execute();
  return deliveryMetrics(
    rows.map((r) => ({ ...r, at: r.at as unknown as Date, duration_ms: r.duration_ms === null ? null : Number(r.duration_ms) })),
  );
}
