// Test history: what `test_runs` (every CI test result, per test and commit) says about each test. A test is flaky
// when, on the same commit, it both passed and failed (Google Testing Blog, «Flaky Tests at Google and How We
// Mitigate Them», 2016; Martin Fowler, «Eradicating Non-Determinism in Tests»). Medians because durations are
// skewed. The cap on rows read and the list lengths are «convención nuestra». Derived on read; nothing is stored.

import type { Db } from '../db/connection.ts';

export type TestRunRow = {
  test_name: string;
  head_sha: string | null;
  outcome: 'pass' | 'fail' | 'skip';
  duration_ms: number | null;
  recorded_at: Date | string;
};

export type TestStat = {
  test_name: string;
  /** Runs that passed or failed (skipped ones are not counted). */
  runs: number;
  fails: number;
  /** Commits on which the test both passed and failed. */
  flaky_shas: string[];
  last_seen: string;
  median_duration_ms: number | null;
};

export type TestHistory = {
  /** Tests with at least one flaky commit, most flaky commits first. */
  flaky: TestStat[];
  /** Slowest tests by median duration. */
  slowest: TestStat[];
  total_tests: number;
  total_runs: number;
};

const MAX_ROWS = 300_000;
const LIST = 25;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

const iso = (d: Date | string): string => (d instanceof Date ? d : new Date(d)).toISOString();

/** Pure: one stat per test. Skipped results count as neither a run nor a failure. */
export function aggregateTests(rows: TestRunRow[]): TestStat[] {
  type Acc = { runs: number; fails: number; bySha: Map<string, Set<string>>; last: string; durations: number[] };
  const byTest = new Map<string, Acc>();
  for (const r of rows) {
    const a: Acc = byTest.get(r.test_name) ?? { runs: 0, fails: 0, bySha: new Map(), last: '', durations: [] };
    const at = iso(r.recorded_at);
    if (at > a.last) a.last = at;
    if (r.outcome !== 'skip') {
      a.runs++;
      if (r.outcome === 'fail') a.fails++;
      if (r.head_sha) a.bySha.set(r.head_sha, (a.bySha.get(r.head_sha) ?? new Set()).add(r.outcome));
      if (r.duration_ms !== null) a.durations.push(r.duration_ms);
    }
    byTest.set(r.test_name, a);
  }
  return [...byTest].map(([test_name, a]) => ({
    test_name,
    runs: a.runs,
    fails: a.fails,
    flaky_shas: [...a.bySha].filter(([, o]) => o.has('pass') && o.has('fail')).map(([sha]) => sha).sort(),
    last_seen: a.last,
    median_duration_ms: median(a.durations),
  }));
}

export function flakyOf(stats: TestStat[], limit = LIST): TestStat[] {
  return stats
    .filter((s) => s.flaky_shas.length > 0)
    .sort((a, b) => b.flaky_shas.length - a.flaky_shas.length || b.fails - a.fails || a.test_name.localeCompare(b.test_name))
    .slice(0, limit);
}

export function slowestOf(stats: TestStat[], limit = LIST): TestStat[] {
  return stats
    .filter((s) => s.median_duration_ms !== null)
    .sort((a, b) => b.median_duration_ms! - a.median_duration_ms! || a.test_name.localeCompare(b.test_name))
    .slice(0, limit);
}

export async function testHistory(db: Db, projectId: string): Promise<TestHistory> {
  const rows = await db
    .selectFrom('test_runs')
    .select(['test_name', 'head_sha', 'outcome', 'duration_ms', 'recorded_at'])
    .where('project_id', '=', projectId)
    .orderBy('recorded_at', 'desc')
    .limit(MAX_ROWS)
    .execute();
  const stats = aggregateTests(rows.map((r) => ({ ...r, recorded_at: r.recorded_at as unknown as Date })));
  return { flaky: flakyOf(stats), slowest: slowestOf(stats), total_tests: stats.length, total_runs: rows.length };
}
