import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { aggregateTests, flakyOf, median, prFlakyOf, slowestOf, testHistory, type TestRunRow } from '../src/queries/test-history.ts';
import { useEnvironment } from './support/env.ts';

const row = (test_name: string, outcome: TestRunRow['outcome'], head_sha: string | null, duration_ms: number | null, at = '2026-10-01T10:00:00Z'): TestRunRow => ({
  test_name,
  head_sha,
  outcome,
  duration_ms,
  recorded_at: at,
});

describe('test history aggregation', () => {
  it('median handles empty, odd and even lists', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3);
  });

  it('flags a test that passed and failed on the same commit, not one that failed on every commit', () => {
    const stats = aggregateTests([
      row('flaky one', 'fail', 'aaa', 100),
      row('flaky one', 'pass', 'aaa', 300, '2026-10-02T10:00:00Z'),
      row('flaky one', 'pass', 'bbb', 200),
      row('broken', 'fail', 'aaa', 10),
      row('broken', 'fail', 'bbb', 10),
      row('changed', 'fail', 'aaa', 10),
      row('changed', 'pass', 'bbb', 10),
      row('skipped', 'skip', 'aaa', null),
    ]);
    const by = (n: string) => stats.find((s) => s.test_name === n)!;
    expect(by('flaky one')).toMatchObject({ runs: 3, fails: 1, flaky_shas: ['aaa'], median_duration_ms: 200, last_seen: '2026-10-02T10:00:00.000Z' });
    expect(by('broken').flaky_shas).toEqual([]);
    expect(by('changed').flaky_shas).toEqual([]);
    expect(by('skipped')).toMatchObject({ runs: 0, fails: 0, median_duration_ms: null });
    expect(flakyOf(stats).map((s) => s.test_name)).toEqual(['flaky one']);
  });

  it('lists the slowest tests by median duration', () => {
    const stats = aggregateTests([row('a', 'pass', 's', 10), row('b', 'pass', 's', 900), row('c', 'pass', 's', 50), row('d', 'skip', 's', null)]);
    expect(slowestOf(stats, 2).map((s) => s.test_name)).toEqual(['b', 'c']);
  });
});

describe('G06 on pull requests', () => {
  const pr = (name: string, outcome: TestRunRow['outcome'], sha: string, at: string): TestRunRow => ({ ...row(name, outcome, sha, 10, at), build_request_id: 'req-1' });
  it('flags a test that failed on a pull request and passed afterwards on the same commit; a fix on a new commit is not it', () => {
    const stats = aggregateTests([
      pr('rerun', 'fail', 'aaa', '2026-10-01T10:00:00Z'),
      pr('rerun', 'pass', 'aaa', '2026-10-01T10:05:00Z'),
      pr('fixed', 'fail', 'aaa', '2026-10-01T10:00:00Z'),
      pr('fixed', 'pass', 'bbb', '2026-10-01T10:30:00Z'),
      // A pass before the PR failure on the same commit (main ran first) is not «failed and then passed».
      pr('earlier pass', 'pass', 'ccc', '2026-10-01T09:00:00Z'),
      pr('earlier pass', 'fail', 'ccc', '2026-10-01T10:00:00Z'),
      row('main only', 'fail', 'ddd', 10, '2026-10-01T10:00:00Z'),
      row('main only', 'pass', 'ddd', 10, '2026-10-01T10:05:00Z'),
    ]);
    const by = (n: string) => stats.find((s) => s.test_name === n)!;
    expect(by('rerun')).toMatchObject({ pr_flaky_shas: ['aaa'], pr_runs: 2 });
    expect(by('fixed').pr_flaky_shas).toEqual([]);
    expect(by('earlier pass').pr_flaky_shas).toEqual([]);
    // Without a build request the rows are main's: flaky in the old sense, not a pull request one.
    expect(by('main only')).toMatchObject({ flaky_shas: ['ddd'], pr_flaky_shas: [], pr_runs: 0 });
    expect(prFlakyOf(stats).map((x) => x.test_name)).toEqual(['rerun']);
  });
});

describe('test_runs from evidence.ingest_junit', () => {
  const environment = useEnvironment();
  it('keeps every test case and sees a test as flaky when one commit has a fail and a pass', async () => {
    const s = environment().services;
    const ana = human('ana');
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Flaky' } });
    const junit = (outcome: 'pass' | 'fail') => `<testsuites><testsuite name="x">
  <testcase classname="a.spec" file="a.spec.ts" name="logs in" time="0.250">${outcome === 'fail' ? '<failure message="x"/>' : ''}</testcase>
  <testcase classname="a.spec" name="stable test" time="1.5"/>
  <testcase classname="a.spec" name="skipped test"><skipped/></testcase>
</testsuite></testsuites>`;
    const ingest = (xml: string, extra: Record<string, unknown> = {}) =>
      executeCommand(s, { command: 'evidence.ingest_junit', actor: ana, projectId, data: { junit: xml, reference: 'sha1', ...extra } });
    await ingest(junit('fail'), { ci_run_id: '111' });
    await ingest(junit('pass'), { ci_run_id: '222' });
    await ingest(junit('pass'), { head_sha: 'sha2' });

    const history = await testHistory(s.db, projectId);
    expect(history.total_runs).toBe(9);
    expect(history.total_tests).toBe(3);
    expect(history.flaky).toHaveLength(1);
    expect(history.flaky[0]).toMatchObject({ test_name: 'logs in', runs: 3, fails: 1, flaky_shas: ['sha1'], median_duration_ms: 250 });
    expect(history.slowest[0]).toMatchObject({ test_name: 'stable test', median_duration_ms: 1500 });
    const stored = await s.db.selectFrom('test_runs').select(['ci_run_id', 'file', 'head_sha']).where('test_name', '=', 'logs in').orderBy('recorded_at').execute();
    expect(stored.map((r) => r.ci_run_id)).toEqual(['111', '222', null]);
    expect(stored.map((r) => r.head_sha)).toEqual(['sha1', 'sha1', 'sha2']);
    expect(stored[0]!.file).toBe('a.spec.ts');
  });
});
