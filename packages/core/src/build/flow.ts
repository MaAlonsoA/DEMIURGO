// Two reads of how a task went through the build, both pure.
//
// Flow efficiency: process time over lead time. Lean value-stream mapping calls it process time over lead
// time (Rother and Shook, «Learning to See»; Kanban uses the same «flow efficiency»). The split of the lead
// time into build, CI, review and wait is «convención nuestra»: from the first start to the merge, build is
// the builder running, CI is any CI run the task waited for before merging (the pull request CI and the
// recheck CI inside the merge stage), review is the reviewer running, and wait is everything else
// (preparation, gaps between attempts, needs-you, merge waits). CI on main after the merge is postsubmit and
// not part of the lead time. Where two overlap, build wins over review and review over CI.
//
// Context hit rate: «what it saw vs what it touched». The files the builder was given as code to extend
// (`code_to_extend.files`) against the files the merged pull request changed (merge footprint), as recall
// (touched and given over touched) and precision (touched and given over given). Convention ours, the
// precision and recall of information retrieval applied to the brief.

import { isReusableFile } from './footprint.ts';

export type Shares = { build: number; ci: number; review: number; wait: number };

export type Flow = {
  lead_ms: number;
  build_ms: number;
  ci_ms: number;
  review_ms: number;
  wait_ms: number;
  /** Whole percents that add up to 100 (largest remainder). */
  pct: Shares;
};

/** A step row reduced to what the split needs. `recheck`: the merge of this attempt ran CI again (or updated from base). */
export type FlowRow = { attempt: number; stage: string; outcome: string; at: number; recheck?: boolean; duration_ms?: number | null };

type Kind = 'build' | 'ci' | 'review';
const KIND_RANK: Record<Kind, number> = { build: 0, review: 1, ci: 2 };
const ENDS = new Set(['ok', 'failed', 'changes_requested', 'cancelled']);

/** The intervals of builder, reviewer and CI of the rows. An interval still open is closed at `openAt`, or dropped without it. */
function intervalsOf(rows: readonly FlowRow[], openAt: number | null): { kind: Kind; start: number; end: number }[] {
  const out: { kind: Kind; start: number; end: number }[] = [];
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const attempts = [...new Set(sorted.map((r) => r.attempt))];
  for (const attempt of attempts) {
    const mine = sorted.filter((r) => r.attempt === attempt);
    for (const stage of ['builder', 'review', 'ci']) {
      const kind: Kind = stage === 'builder' ? 'build' : stage === 'review' ? 'review' : 'ci';
      let open: number | null = null;
      for (const r of mine.filter((x) => x.stage === stage)) {
        if (r.outcome === 'started') open ??= r.at;
        else if (ENDS.has(r.outcome)) {
          if (open !== null) out.push({ kind, start: open, end: r.at });
          else if (stage === 'builder' && r.duration_ms) out.push({ kind, start: r.at - r.duration_ms, end: r.at });
          open = null;
        }
      }
      if (open !== null && openAt !== null) out.push({ kind, start: open, end: openAt });
    }
    // The recheck CI inside the merge stage: from the merge «waiting» row that says so up to the CI result on the new head (or the end of the merge).
    const wait = mine.find((r) => r.stage === 'merge' && r.outcome === 'waiting' && r.recheck === true);
    if (wait) {
      const end = mine.find((r) => r.at >= wait.at && r !== wait && ((r.stage === 'ci' && ENDS.has(r.outcome)) || (r.stage === 'merge' && ENDS.has(r.outcome))));
      if (end) out.push({ kind: 'ci', start: wait.at, end: end.at });
      else if (openAt !== null) out.push({ kind: 'ci', start: wait.at, end: openAt });
    }
  }
  return out;
}

/** Whole percents that add up to 100, by largest remainder. */
function percents(parts: readonly number[], total: number): number[] {
  const raw = parts.map((p) => (p / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((n, x) => n + x, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floor[i] = (floor[i] as number) + 1;
    left--;
  }
  return floor;
}

/**
 * The one split of a lead time [from, to] into build, CI, review and wait, for the lane label and Delivery.
 * Null without lead time.
 */
export function flowSplit(rows: readonly FlowRow[], from: number, to: number, openAt: number | null = null): Flow | null {
  const lead = to - from;
  if (!(lead > 0)) return null;
  const intervals = intervalsOf(rows, openAt)
    .map((i) => ({ ...i, start: Math.max(i.start, from), end: Math.min(i.end, to) }))
    .filter((i) => i.end > i.start);
  const cuts = [...new Set([from, to, ...intervals.flatMap((i) => [i.start, i.end])])].sort((a, b) => a - b);
  const ms: Record<Kind | 'wait', number> = { build: 0, ci: 0, review: 0, wait: 0 };
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k] as number;
    const b = cuts[k + 1] as number;
    const kinds = intervals.filter((i) => i.start <= a && i.end >= b).map((i) => i.kind);
    const kind = kinds.length === 0 ? 'wait' : kinds.reduce((x, y) => (KIND_RANK[x] <= KIND_RANK[y] ? x : y));
    ms[kind] += b - a;
  }
  const [build, ci, review, wait] = percents([ms.build, ms.ci, ms.review, ms.wait], lead) as [number, number, number, number];
  return {
    lead_ms: Math.round(lead),
    build_ms: Math.round(ms.build),
    ci_ms: Math.round(ms.ci),
    review_ms: Math.round(ms.review),
    wait_ms: Math.round(ms.wait),
    pct: { build, ci, review, wait },
  };
}

/** Length of the union of the intervals, clipped to [from, to]. */
export function unionMs(intervals: readonly { start: number; end: number }[], from: number, to: number): number {
  const sorted = intervals
    .map((i) => ({ start: Math.max(i.start, from), end: Math.min(i.end, to) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = -Infinity;
  for (const i of sorted) {
    const s = Math.max(i.start, cursor);
    if (i.end > s) total += i.end - s;
    cursor = Math.max(cursor, i.end);
  }
  return total;
}

const TEST_PATH = [/(^|\/)(test|tests|__tests__|e2e)\//, /\.(test|spec)\.[cm]?[jt]sx?$/];
export const isTestFile = (path: string): boolean => TEST_PATH.some((re) => re.test(path));

export type ContextHit = {
  /** Touched and given. */
  hits: string[];
  /** Touched but not given. */
  missed: string[];
  /** Given but not touched. */
  unused: string[];
  counts: { touched: number; given: number; hits: number };
  /** Test-reuse suggestions and how many of them the pull request touched. */
  reuse: { suggested: number; touched: number } | null;
};

/**
 * Pure: compares the files given with the files touched. Touched files are filtered (lockfiles, snapshots and
 * generated files say nothing; tests are left out). Null when nothing was given (the builder had no code to
 * extend) or nothing was touched.
 */
export function contextHit(input: { given: readonly string[]; touched: readonly string[]; reuse?: readonly string[] }, cap = 8): ContextHit | null {
  const touchedAll = [...new Set(input.touched)];
  const touched = touchedAll.filter((p) => isReusableFile(p) && !isTestFile(p));
  const given = [...new Set(input.given)];
  if (given.length === 0 || touched.length === 0) return null;
  const g = new Set(given);
  const t = new Set(touched);
  const hits = touched.filter((p) => g.has(p));
  const reuse = [...new Set(input.reuse ?? [])];
  const touchedSet = new Set(touchedAll);
  return {
    hits: hits.slice(0, cap),
    missed: touched.filter((p) => !g.has(p)).slice(0, cap),
    unused: given.filter((p) => !t.has(p)).slice(0, cap),
    counts: { touched: touched.length, given: given.length, hits: hits.length },
    reuse: reuse.length > 0 ? { suggested: reuse.length, touched: reuse.filter((p) => touchedSet.has(p)).length } : null,
  };
}

export type ContextSummary = {
  /** Merged tasks that have both what was given and what was touched. */
  tasks: number;
  recall: number | null;
  precision: number | null;
};

/** Pure: recall and precision pooled over the tasks (sum of hits over sum of touched, and over sum of given), in percent. */
export function contextSummary(items: readonly (ContextHit | null)[]): ContextSummary {
  const list = items.filter((x): x is ContextHit => x !== null);
  const hits = list.reduce((n, c) => n + c.counts.hits, 0);
  const touched = list.reduce((n, c) => n + c.counts.touched, 0);
  const given = list.reduce((n, c) => n + c.counts.given, 0);
  return {
    tasks: list.length,
    recall: touched > 0 ? Math.round((hits / touched) * 100) : null,
    precision: given > 0 ? Math.round((hits / given) * 100) : null,
  };
}
