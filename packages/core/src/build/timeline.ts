// The build timeline of a project (Build page, «Lanes» and «Path»): per build request, its attempts, and per
// attempt the stages as segments over time, plus the few facts the view needs about what entered the builder
// and what came out. Derived on read from `build_steps` (nothing is stored). Practice: the run timeline of
// Dagster and the Gantt of Airflow (one row per job, runs as bars over time) and the value-stream split of
// process time and waiting time (Rother and Shook, «Learning to See»; the split is in flow.ts). Pure aggregation in `buildTimeline`;
// `buildTimelineOf` only reads. Never carries secrets or whole transcripts: every text is cut (our convention).

import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import { type ContextHit, type Flow, type FlowRow, contextHit, flowSplit } from './flow.ts';

export type TimelineStepRow = {
  build_request_id: string;
  attempt: number;
  stage: string;
  outcome: string;
  at: Date | string;
  detail: unknown;
};

export type TimelineRequestRow = {
  id: string;
  task_code: string;
  state: string;
  requested_by: string;
  requested_at: Date | string;
  pr_url: string | null;
  pr_number: number | null;
};

/** prep: «Prepare» (repo, workspace, environment as one); builder: the agent; light: the merge before it waits; review: the reviewer; wait: CI; main: CI on main. */
export type SegmentKind = 'prep' | 'builder' | 'light' | 'review' | 'wait' | 'main';

/**
 * `outcome` is the row that ended the segment (`running` while open). A CI that was cancelled because the review
 * asked for changes first ends as `cancelled` with its `reason`. Segments of different stages may overlap in time:
 * CI and review run in parallel (trace waterfall of Jaeger: overlapping spans, each from its own start and end).
 */
export type TimelineSegment = { stage: string; kind: SegmentKind; start: string; end: string; outcome: string; reason?: string };

export type AttemptResult = 'merged' | 'running' | 'failed' | 'changes_requested' | 'cancelled' | 'open';

export type TimelineAttempt = {
  n: number;
  start: string;
  end: string;
  result: AttemptResult;
  started_by: string | null;
  automatic: boolean | null;
  start_reason: string | null;
  /** Milliseconds between the end of the previous attempt and this start (the wait between attempts), or null. */
  gap_before_ms: number | null;
  segments: TimelineSegment[];
  /** What ended the attempt (the last ending row), as the next attempt receives it as feedback. */
  ended_by: {
    stage: string;
    outcome: string;
    at: string;
    reason: string | null;
    failure_kind: string | null;
    blocking: number | null;
    comments: number | null;
    behind_by: number | null;
  } | null;
  /** What entered the builder and what it said; null when the attempt never reached the builder's end. */
  builder: {
    model: string | null;
    provider: string | null;
    duration_ms: number | null;
    exit_code: number | null;
    failure_kind: string | null;
    error: string | null;
    session: { mode: string; reason: string | null } | null;
    code_to_extend: {
      files: number;
      first_files: string[];
      section_chars: number | null;
      ordered_by_jev: boolean;
      commit: string | null;
    } | null;
    /** Tests the brief told the builder to run, parsed from the stored «Before finishing…» line; null when not kept. */
    affected_tests: { count: number; first: string[] } | null;
    progress: string | null;
    progress_chars: number;
    notes: string | null;
    tests_written: number | null;
    wip_files: number;
    /** Names of the files kept from the previous attempt's unfinished work (first few). */
    wip_file_names: string[];
    /** Existing tests of other criteria that already check something close (the builder was told to extend them). */
    test_reuse: { count: number; first: { criterion: string; path: string }[] } | null;
  } | null;
  /** What came out: the pull request, CI, review and merge of this attempt. */
  out: {
    pr_number: number | null;
    head_sha: string | null;
    ci: string | null;
    updated_from_base: boolean;
    review: { verdict: string | null; comments: number | null } | null;
    behind_by: number | null;
    /** The merge decision after CI: the branch was behind main, and whether CI ran again (recheck) or was skipped. */
    merge: { behind_by: number | null; recheck: boolean | null; reason: string | null; updated_from_base: boolean } | null;
    main: { at: string; conclusion: string | null } | null;
  };
  /** The mechanical steps (branch, commit, design and ownership checks, push, pull request, status, evidence, publish): only whether they were reached and what went wrong. */
  checkpoint: { reached: boolean; problems: { stage: string; outcome: string; error: string | null }[] };
  merged_at: string | null;
};

export type TimelineRequest = {
  id: string;
  task_code: string;
  /** Filled by the caller from the queue (the build timeline only knows codes). */
  task_title?: string;
  feature?: { code: string; title: string } | null;
  state: string;
  requested_by: string;
  requested_at: string;
  pr_url: string | null;
  pr_number: number | null;
  start: string;
  end: string;
  running: boolean;
  merged_at: string | null;
  attempts: TimelineAttempt[];
  /** Build, CI, review and wait from the first start to the merge (or to now); see flow.ts. */
  flow: Flow | null;
  /** What the merged attempt's builder was given vs what the pull request touched; null unless merged and both are known. */
  context: ContextHit | null;
};

export type BuildTimeline = {
  since: string;
  now: string;
  requests: TimelineRequest[];
  /** Merges on the main line, oldest first. */
  merges: { task_code: string; at: string; pr_number: number | null }[];
  truncated: boolean;
};

/** Default window (hours) and the caps that keep the answer small (our convention). */
export const TIMELINE_HOURS = 8;
export const TIMELINE_MAX_HOURS = 72;
export const TIMELINE_MAX_REQUESTS = 40;
export const TIMELINE_MAX_ATTEMPTS = 30;
const MAX_STEP_ROWS = 4000;
const TEXT = 240;
const NOTES = 320;
const FILES = 6;

const ms = (d: Date | string | number) => new Date(d).getTime();
const iso = (d: Date | string | number) => new Date(d).toISOString();

const cut = (v: unknown, max = TEXT): string | null => {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const ENDING = new Set(['failed', 'changes_requested', 'cancelled']);
/** Rows that say nothing about time (a backfill). */
const SKIP = new Set(['footprint']);
/** Stages with nothing to say about time: kept out of the segments; only a failure shows (our convention). */
const MECHANICAL = new Set(['commit', 'design', 'push', 'pr', 'status', 'evidence', 'publish']);
const PREPARE = new Set(['repo', 'worktree', 'environment']);

function kindOf(stage: string, afterWaiting: boolean): SegmentKind {
  if (stage === 'repo' || stage === 'worktree' || stage === 'environment') return 'prep';
  if (stage === 'builder') return 'builder';
  if (stage === 'review') return 'review';
  if (stage === 'ci') return 'wait';
  if (stage === 'main') return 'main';
  if (stage === 'merge') return afterWaiting ? 'wait' : 'light';
  return 'light';
}

/** The tests of the stored «Before finishing, run the tests …: a, b and N more; …» line, or null. */
export function affectedTestsOf(section: string | null): { count: number; first: string[] } | null {
  if (!section) return null;
  const m = section.match(/run the tests that depend on what you change: ([^\n]*?)(?: and (\d+) more)?; the full suite runs in CI\./);
  if (!m) return null;
  const names = (m[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { count: names.length + Number(m[2] ?? 0), first: names.slice(0, 4) };
}

function builderOf(rows: TimelineStepRow[]): TimelineAttempt['builder'] {
  const row = [...rows].reverse().find((r) => r.stage === 'builder' && (r.outcome === 'ok' || r.outcome === 'failed'));
  if (!row) return null;
  const d = obj(row.detail);
  const session = obj(d.session);
  const cte = obj(d.code_to_extend);
  const files = Array.isArray(cte.files) ? cte.files.filter((f): f is string => typeof f === 'string') : [];
  const section = typeof cte.section === 'string' ? cte.section : null;
  const report = obj(d.report);
  const progress = typeof d.progress === 'string' ? d.progress : null;
  return {
    model: cut(d.model, 60),
    provider: cut(d.provider, 40),
    duration_ms: num(d.duration_ms),
    exit_code: num(d.exit_code),
    failure_kind: cut(d.failure_kind, 40),
    error: cut(d.error),
    session: typeof session.mode === 'string' ? { mode: session.mode, reason: cut(session.reason) } : null,
    code_to_extend: Object.keys(cte).length > 0
      ? {
          files: files.length,
          first_files: files.slice(0, FILES).map((f) => cut(f, 120) ?? ''),
          section_chars: section ? section.length : null,
          ordered_by_jev: typeof cte.classifier_id === 'string' && cte.classifier_id !== '',
          commit: typeof cte.commit === 'string' ? cte.commit.slice(0, 8) : null,
        }
      : null,
    affected_tests: affectedTestsOf(section),
    progress: cut(progress, NOTES),
    progress_chars: progress ? progress.length : 0,
    notes: cut(report.notes, NOTES),
    tests_written: Array.isArray(report.tests) ? report.tests.length : null,
    wip_files: Array.isArray(d.wip_files) ? d.wip_files.length : 0,
    wip_file_names: Array.isArray(d.wip_files) ? d.wip_files.filter((f): f is string => typeof f === 'string').slice(0, FILES).map((f) => cut(f, 120) ?? '') : [],
    test_reuse: Array.isArray(d.test_reuse) && d.test_reuse.length > 0
      ? {
          count: d.test_reuse.length,
          first: d.test_reuse.slice(0, 3).map((x) => ({ criterion: cut(obj(x).criterion, 40) ?? '', path: cut(obj(x).path, 120) ?? '' })),
        }
      : null,
  };
}

function attemptOf(n: number, rows: TimelineStepRow[], previousEnd: number | null, open: boolean, now: number): TimelineAttempt {
  const segments: TimelineSegment[] = [];
  const last = new Map<string, { at: number; outcome: string }>();
  let prevAt = ms(rows[0]?.at ?? now);
  let mergedAt: string | null = null;
  let mainRow: { at: string; conclusion: string | null } | null = null;
  // Each stage builds its interval from its own rows: a row of another stage never closes it, so CI and review can overlap.
  const push = (stage: string, kind: SegmentKind, start: number, end: number, outcome: string, reason?: string | null) => {
    const prev = [...segments].reverse().find((x) => x.stage === stage);
    if (prev && prev.kind === kind && ms(prev.end) >= start - 1) {
      prev.end = iso(new Date(Math.max(end, ms(prev.end))));
      prev.outcome = outcome;
      if (reason) prev.reason = reason;
      return;
    }
    segments.push({ stage, kind, start: iso(new Date(start)), end: iso(new Date(end)), outcome, ...(reason ? { reason } : {}) });
  };
  for (const r of rows) {
    if (SKIP.has(r.stage)) continue;
    const at = ms(r.at);
    if (r.outcome === 'started') {
      last.set(r.stage, { at, outcome: 'started' });
      prevAt = at;
      continue;
    }
    if (r.stage === 'withdraw') {
      prevAt = at;
      continue;
    }
    const prior = last.get(r.stage);
    const start = prior ? prior.at : prevAt;
    const cancelledCi = r.stage === 'ci' && r.outcome === 'failed' && obj(r.detail).cancelled === true;
    // The first row of a parallel stage is a `waiting` row (the review run starts right away, without `started`): it only opens the interval.
    const opens = r.outcome === 'waiting' && !prior && (r.stage === 'ci' || r.stage === 'review');
    if (!MECHANICAL.has(r.stage) && !opens && !(r.outcome === 'waiting' && at <= start)) {
      const stage = PREPARE.has(r.stage) ? 'prepare' : r.stage;
      push(stage, kindOf(r.stage, prior?.outcome === 'waiting'), start, at, cancelledCi ? 'cancelled' : r.outcome, cancelledCi ? (cut(obj(r.detail).reason, 60) ?? 'cancelled') : null);
    }
    if (r.outcome === 'waiting') last.set(r.stage, { at, outcome: 'waiting' });
    else last.delete(r.stage);
    if (r.stage === 'merge' && r.outcome === 'ok') mergedAt = iso(r.at);
    if (r.stage === 'main') mainRow = { at: iso(r.at), conclusion: cut(obj(r.detail).conclusion, 40) };
    prevAt = at;
  }
  const lastRow = rows.at(-1);
  // A CI cancelled because the review asked for changes is a consequence, not what ended the attempt.
  const ending = [...rows].reverse().find((r) => ENDING.has(r.outcome) && !(r.stage === 'ci' && obj(r.detail).cancelled === true));
  const result: AttemptResult = mergedAt
    ? 'merged'
    : ending
      ? (ending.outcome as AttemptResult)
      : open
        ? 'running'
        : 'open';
  if (result === 'running') {
    // The stage that has started (or waits) and has not ended: it runs up to now.
    // With CI and review in parallel there can be several: each one runs up to now.
    for (const [stage, since] of [...last.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (!MECHANICAL.has(stage)) push(PREPARE.has(stage) ? 'prepare' : stage, kindOf(stage, since.outcome === 'waiting'), since.at, now, 'running');
    }
  }
  segments.sort((a, b) => ms(a.start) - ms(b.start) || ms(a.end) - ms(b.end));
  const startRow = rows.find((r) => r.stage === 'repo' && r.outcome === 'started') ?? rows[0];
  const sd = obj(startRow?.detail);
  const start = ms(rows[0]?.at ?? now);
  const end = result === 'running' ? now : Math.max(ms(lastRow?.at ?? now), ...segments.map((s) => ms(s.end)));
  const pr = rows.find((r) => r.stage === 'pr' && r.outcome === 'ok');
  const ci = [...rows].reverse().find((r) => r.stage === 'ci' && (r.outcome === 'ok' || r.outcome === 'failed'));
  const review = [...rows].reverse().find((r) => r.stage === 'review' && r.outcome !== 'started' && r.outcome !== 'waiting');
  const withSha = [...rows].reverse().find((r) => typeof obj(r.detail).head_sha === 'string');
  const merge = [...rows].reverse().find((r) => r.stage === 'merge' && obj(r.detail).behind_by !== undefined);
  const decision = [...rows].reverse().find((r) => r.stage === 'merge' && (obj(r.detail).recheck !== undefined || obj(r.detail).updated_from_base === true));
  const dd = obj(decision?.detail);
  const problems = rows
    .filter((r) => (MECHANICAL.has(r.stage) || PREPARE.has(r.stage)) && (r.outcome === 'failed' || r.outcome === 'cancelled'))
    .map((r) => {
      const d = obj(r.detail);
      const counts = [
        Array.isArray(d.violations) && d.violations.length > 0 ? `${d.violations.length} design violations` : null,
        Array.isArray(d.ownership) && d.ownership.length > 0 ? `${d.ownership.length} ownership violations` : null,
        num(obj(d.test_guard).violations) ? `${num(obj(d.test_guard).violations)} duplicate tests` : null,
      ].filter(Boolean);
      return { stage: r.stage, outcome: r.outcome, error: cut(d.error) ?? (counts.length > 0 ? counts.join(', ') : null) };
    });
  const rd = obj(review?.detail);
  const ed = obj(ending?.detail);
  return {
    n,
    start: iso(new Date(start)),
    end: iso(new Date(end)),
    result,
    started_by: cut(sd.started_by, 80),
    automatic: typeof sd.automatic === 'boolean' ? sd.automatic : null,
    start_reason: cut(sd.reason),
    gap_before_ms: previousEnd === null ? null : Math.max(0, start - previousEnd),
    segments,
    ended_by: ending
      ? {
          stage: ending.stage,
          outcome: ending.outcome,
          at: iso(ending.at),
          reason: cut(ed.reason ?? ed.error),
          failure_kind: cut(ed.failure_kind, 40),
          blocking: num(ed.blocking),
          comments: num(ed.comments_count),
          behind_by: num(ed.behind_by),
        }
      : null,
    builder: builderOf(rows),
    out: {
      pr_number: num(obj(pr?.detail).number),
      head_sha: typeof obj(withSha?.detail).head_sha === 'string' ? (obj(withSha?.detail).head_sha as string).slice(0, 8) : null,
      ci: ci ? (obj(ci.detail).cancelled === true ? 'cancelled' : (cut(obj(ci.detail).conclusion, 40) ?? ci.outcome)) : null,
      updated_from_base: rows.some((r) => obj(r.detail).updated_from_base === true),
      review: review ? { verdict: cut(rd.verdict, 40), comments: num(rd.comments_count) } : null,
      behind_by: num(obj(merge?.detail).behind_by),
      merge: decision
        ? { behind_by: num(dd.behind_by), recheck: typeof dd.recheck === 'boolean' ? dd.recheck : null, reason: cut(dd.reason, 60), updated_from_base: dd.updated_from_base === true }
        : null,
      main: mainRow,
    },
    checkpoint: { reached: rows.some((r) => r.stage === 'pr' && r.outcome === 'ok'), problems },
    merged_at: mergedAt,
  };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Files given to the builder of the merged attempt vs files of the merge footprint. */
function contextOf(rows: TimelineStepRow[], mergedAttempt: number): ContextHit | null {
  const merge = [...rows].reverse().find((r) => r.attempt === mergedAttempt && r.stage === 'merge' && r.outcome === 'ok');
  const footprint = obj(obj(merge?.detail).footprint);
  const touched = Array.isArray(footprint.files) ? footprint.files.map((f) => obj(f).path).filter((p): p is string => typeof p === 'string') : [];
  const builder = [...rows].reverse().find((r) => r.stage === 'builder' && r.outcome === 'ok' && r.attempt <= mergedAttempt);
  const d = obj(builder?.detail);
  const reuse = Array.isArray(d.test_reuse) ? d.test_reuse.map((x) => obj(x).path).filter((p): p is string => typeof p === 'string') : [];
  return contextHit({ given: strings(obj(d.code_to_extend).files), touched, reuse });
}

/**
 * Pure: the timeline of the given requests. A request is `running` while its state is open (requested, in_review)
 * and its latest attempt has not ended; its latest attempt is then the one in progress.
 */
export function buildTimeline(
  requests: readonly TimelineRequestRow[],
  steps: readonly TimelineStepRow[],
  options: { now: Date; since: Date; truncated?: boolean },
): BuildTimeline {
  const now = options.now.getTime();
  const byRequest = new Map<string, TimelineStepRow[]>();
  for (const s of steps) byRequest.set(s.build_request_id, [...(byRequest.get(s.build_request_id) ?? []), s]);
  const out: TimelineRequest[] = [];
  for (const r of requests) {
    const rows = [...(byRequest.get(r.id) ?? [])].sort((a, b) => ms(a.at) - ms(b.at));
    if (rows.length === 0) continue;
    const numbers = [...new Set(rows.map((x) => x.attempt))].sort((a, b) => a - b);
    const attempts: TimelineAttempt[] = [];
    let previousEnd: number | null = null;
    for (const [i, n] of numbers.entries()) {
      const mine = rows.filter((x) => x.attempt === n);
      const isLast = i === numbers.length - 1;
      const attempt = attemptOf(n, mine, previousEnd, isLast && (r.state === 'requested' || r.state === 'in_review'), now);
      attempts.push(attempt);
      previousEnd = ms(attempt.end);
    }
    const shown = attempts.slice(-TIMELINE_MAX_ATTEMPTS);
    const merged = [...attempts].reverse().find((a) => a.merged_at)?.merged_at ?? null;
    const mergedAttempt = [...attempts].reverse().find((a) => a.merged_at)?.n ?? null;
    const leadStart = ms((rows.find((x) => x.stage === 'repo' && x.outcome === 'started') ?? (rows[0] as TimelineStepRow)).at);
    const leadEnd = merged ? ms(merged) : ms((attempts.at(-1) as TimelineAttempt).end);
    const running = attempts.at(-1)?.result === 'running';
    const flowRows: FlowRow[] = rows.map((x) => {
      const d = obj(x.detail);
      return { attempt: x.attempt, stage: x.stage, outcome: x.outcome, at: ms(x.at), recheck: d.recheck === true, duration_ms: num(d.duration_ms) };
    });
    out.push({
      id: r.id,
      task_code: r.task_code,
      state: r.state,
      requested_by: r.requested_by,
      requested_at: iso(r.requested_at),
      pr_url: r.pr_url,
      pr_number: r.pr_number,
      start: (attempts[0] as TimelineAttempt).start,
      end: (attempts.at(-1) as TimelineAttempt).end,
      running,
      merged_at: merged,
      attempts: shown,
      flow: flowSplit(flowRows, leadStart, leadEnd, running ? now : null),
      context: mergedAttempt === null ? null : contextOf(rows, mergedAttempt),
    });
  }
  out.sort((a, b) => ms(a.start) - ms(b.start));
  const merges = out
    .filter((r) => r.merged_at)
    .map((r) => ({ task_code: r.task_code, at: r.merged_at as string, pr_number: r.pr_number }))
    .sort((a, b) => ms(a.at) - ms(b.at));
  return { since: options.since.toISOString(), now: options.now.toISOString(), requests: out, merges, truncated: options.truncated ?? false };
}

/** Reads the requests with activity in the last `hours` (or still open) and builds their timeline. */
export async function buildTimelineOf(db: Db, projectId: string, hours = TIMELINE_HOURS, now: Date = new Date()): Promise<BuildTimeline> {
  const h = Math.min(Math.max(Number.isFinite(hours) ? hours : TIMELINE_HOURS, 1), TIMELINE_MAX_HOURS);
  const since = new Date(now.getTime() - h * 3_600_000);
  const active = await db
    .selectFrom('build_steps')
    .innerJoin('build_requests', 'build_requests.id', 'build_steps.build_request_id')
    .select(['build_steps.build_request_id as id', sql<Date>`max(build_steps.created_at)`.as('last_at')])
    .where('build_steps.project_id', '=', projectId)
    .where((eb) =>
      eb.or([sql<boolean>`build_steps.created_at >= ${since.toISOString()}::timestamptz`, eb('build_requests.state', 'in', ['requested', 'in_review'])]),
    )
    .groupBy('build_steps.build_request_id')
    .orderBy('last_at', 'desc')
    .limit(TIMELINE_MAX_REQUESTS + 1)
    .execute();
  const truncated = active.length > TIMELINE_MAX_REQUESTS;
  const ids = active.slice(0, TIMELINE_MAX_REQUESTS).map((a) => a.id);
  if (ids.length === 0) return buildTimeline([], [], { now, since });
  const requests = await db
    .selectFrom('build_requests')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select([
      'build_requests.id',
      'records.code as task_code',
      'build_requests.state',
      'build_requests.requested_by',
      'build_requests.requested_at',
      'build_requests.pr_url',
      'build_requests.pr_number',
    ])
    .where('build_requests.id', 'in', ids)
    .execute();
  const steps = await db
    .selectFrom('build_steps')
    .select(['build_request_id', 'attempt', 'stage', 'outcome', 'detail', 'created_at as at'])
    .where('build_request_id', 'in', ids)
    .orderBy('created_at')
    .orderBy('id')
    .limit(MAX_STEP_ROWS)
    .execute();
  return buildTimeline(
    requests.map((r) => ({ ...r, requested_at: r.requested_at as unknown as Date })),
    steps.map((s) => ({ ...s, at: s.at as unknown as Date })),
    { now, since, truncated },
  );
}
