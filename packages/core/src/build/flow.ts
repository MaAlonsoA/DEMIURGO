// Two reads of how a task went through the build, both pure.
//
// Flow efficiency: active time over lead time. Lean value-stream mapping calls it process time over lead
// time (Rother and Shook, «Learning to See»; Kanban uses the same «flow efficiency»). What counts as active
// is «convención nuestra»: the builder, CI and the reviewer running for the task. Everything else between
// the first start and the merge (preparation, gaps between attempts, needs-you, merge waits) is wait.
//
// Context hit rate: «what it saw vs what it touched». The files the builder was given as code to extend
// (`code_to_extend.files`) against the files the merged pull request changed (merge footprint), as recall
// (touched and given over touched) and precision (touched and given over given). Convention ours, the
// precision and recall of information retrieval applied to the brief.

import { isReusableFile } from './footprint.ts';

/** Stages whose running time is active (our convention). */
export const ACTIVE_STAGES: ReadonlySet<string> = new Set(['builder', 'ci', 'review']);

export type Flow = { active_ms: number; wait_ms: number; active_pct: number };

/** Active/wait split of a lead time; null without lead time. Active never exceeds the lead. */
export function flowOf(activeMs: number, leadMs: number): Flow | null {
  if (!(leadMs > 0)) return null;
  const active = Math.min(Math.max(0, activeMs), leadMs);
  return { active_ms: Math.round(active), wait_ms: Math.round(leadMs - active), active_pct: Math.round((active / leadMs) * 100) };
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
