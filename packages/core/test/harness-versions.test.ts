// Harness versions (salud-del-harness §9.3, phase 4): registered once per content hash, every build attempt and agent run
// tagged with the version in force, cohorts flagged when they do not overlap in time, and the CI timings read from a
// check-run response.

import { human, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { ciTimingsOf, parseCheckRun } from '../src/github/client.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { runPostmortem } from '../src/harness/postmortem.ts';
import { currentHarnessMarks, currentHarnessVersionId, demiurgoSha, harnessContentHash, registerHarnessVersion } from '../src/harness/version.ts';
import { NOT_COMPARABLE, overlapsOf, scorecardsByVersion } from '../src/queries/harness-health.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ durable: true });
const ana = human('ana');

async function task(name: string, inProject?: string) {
  const s = environment().services;
  const projectId = inProject ?? (await executeCommand(s, { command: 'project.create', actor: ana, data: { name } })).projectId;
  const made = await executeCommand(s, {
    command: 'record.create',
    actor: ana,
    projectId,
    data: {
      type: 'fdr',
      domain: 'hv',
      title: `Feature ${name}`,
      sections: [
        { title: 'Goal', content: 'A goal.' },
        { title: 'Scope', content: 'Scope.' },
        { title: 'Out of scope', content: 'Nothing.' },
        { title: 'Behavior', content: '1. It works.' },
      ],
      criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
    },
  });
  return { projectId, recordId: made.entityId, versionId: (made.result as { versionId: string }).versionId };
}

async function buildRequest(p: { projectId: string; recordId: string; versionId: string }) {
  const row = await environment()
    .services.db.insertInto('build_requests')
    .values({ project_id: p.projectId, task_id: p.recordId, task_version_id: p.versionId, feature_version_id: null, brief: 'brief', requested_by: 'human:ana' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('harness versions', () => {
  it('does not insert the same version twice', async () => {
    const db = environment().services.db;
    const first = await registerHarnessVersion(db);
    const second = await registerHarnessVersion(db);
    expect(second).toBe(first);
    expect(await currentHarnessVersionId(db)).toBe(first);
    const marks = await currentHarnessMarks();
    const rows = await db.selectFrom('harness_versions').selectAll().where('content_hash', '=', harnessContentHash(marks)).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ demiurgo_sha: marks.demiurgo_sha, rules_version: marks.rules_version });
    // Other marks are another version; the table is append-only.
    const other = await registerHarnessVersion(db, { ...marks, demiurgo_sha: 'f'.repeat(40) });
    expect(other).not.toBe(first);
    await expect(db.deleteFrom('harness_versions').where('id', '=', other).execute()).rejects.toThrow(/only admits INSERT/);
  });

  it('reads the DEMIURGO commit from the environment, git or the .git files', async () => {
    expect(await demiurgoSha('/nonexistent', { DEMIURGO_BUILD_SHA: ' abc1234 ' })).toBe('abc1234');
    expect(await demiurgoSha(undefined, {})).toMatch(/^[0-9a-f]{40}$/);
    expect(await demiurgoSha('/nonexistent', {})).toBe('unknown');
  });

  it('tags the attempts of a build and the post-mortem with the version in force', async () => {
    const s = environment().services;
    const p = await task('Tagging');
    const id = await buildRequest(p);
    const version = await currentHarnessVersionId(s.db);
    await executeCommand(s, { command: 'build_step.record', actor: system('build', '1'), projectId: p.projectId, data: { build_request_id: id, attempt: 1, stage: 'repo', outcome: 'started', detail: { started_by: 'x' } } });
    await executeCommand(s, { command: 'build_step.record', actor: system('build', '1'), projectId: p.projectId, data: { build_request_id: id, attempt: 1, stage: 'builder', outcome: 'ok' } });
    await executeCommand(s, { command: 'build_step.record', actor: system('build', '1'), projectId: p.projectId, data: { build_request_id: id, attempt: 1, stage: 'merge', outcome: 'ok' } });
    await s.db.updateTable('build_requests').set({ state: 'done', done_by: 'system:build', done_at: new Date() }).where('id', '=', id).execute();
    const steps = await s.db.selectFrom('build_steps').select(['stage', 'detail']).where('build_request_id', '=', id).orderBy('created_at').execute();
    expect((steps[0]?.detail as { harness_version_id?: string }).harness_version_id).toBe(version);
    expect(steps[1]?.detail).toBeNull();
    await runPostmortem(s, id);
    const pm = await s.db.selectFrom('harness_postmortems').select('harness_version_id').where('build_request_id', '=', id).executeTakeFirstOrThrow();
    expect(pm.harness_version_id).toBe(version);
  });

  it('tags a new agent run with the version in force', async () => {
    const s = environment().services;
    const p = await task('Runs');
    const version = await currentHarnessVersionId(s.db);
    const done = await executeCommand(s, { command: 'run.request', actor: ana, projectId: p.projectId, data: { action: 'echo', scope: { type: 'echo' }, input: { text: 'hi' } } });
    await waitForRun(done.entityId);
    const row = await s.db.selectFrom('ai_runs').select('harness_version_id').where('id', '=', done.entityId).executeTakeFirstOrThrow();
    expect(row.harness_version_id).toBe(version);
  });

  it('flags cohorts that do not overlap in time as observational, not comparable', async () => {
    const s = environment().services;
    const p = await task('Cohorts');
    const marks = await currentHarnessMarks();
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((x) => registerHarnessVersion(s.db, { ...marks, demiurgo_sha: x.repeat(40) })));
    const at = (day: number) => new Date(Date.UTC(2026, 8, day, 10));
    // a: 1st and 2nd; b: 2nd and 3rd (overlaps a); c: the 20th (overlaps nobody).
    const plan: [string, number][] = [[a as string, 1], [a as string, 2], [b as string, 2], [b as string, 3], [c as string, 20]];
    for (const [version, day] of plan) {
      const id = await buildRequest(await task(`Cohort ${version.slice(0, 4)} ${day}`, p.projectId));
      await sql`insert into build_steps (project_id, build_request_id, attempt, stage, outcome, created_at) values (${p.projectId}, ${id}, 1, 'repo', 'started', ${at(day)})`.execute(s.db);
      const pm = await s.db
        .insertInto('harness_postmortems')
        .values({ project_id: p.projectId, build_request_id: id, rules_version: 'pm-test', harness_version_id: version, inputs_hash: `h${version}${day}x`.padEnd(10, '0'), attempts: 1, outcome: 'merged', findings: 1 })
        .returning('id')
        .executeTakeFirstOrThrow();
      await s.db.insertInto('harness_findings').values({ project_id: p.projectId, postmortem_id: pm.id, build_request_id: id, piece: 'B01', finding: 'x', class: 'tp', evidence: JSON.stringify([]) }).execute();
    }
    const out = await scorecardsByVersion(s.db, p.projectId, { rules: 'pm-test' });
    const byId = new Map(out.cohorts.map((x) => [x.harness_version_id, x]));
    expect(out.cohorts).toHaveLength(3);
    expect(byId.get(a as string)).toMatchObject({ requests: 2, label: 'observational', overlaps: [b] });
    expect(byId.get(b as string)?.label).toBe('observational');
    expect(byId.get(c as string)).toMatchObject({ requests: 1, label: NOT_COMPARABLE, overlaps: [] });
    expect(out.cohorts.map((x) => x.harness_version_id)).toEqual([a, b, c]);
  });

  it('computes overlaps of closed spans, and none for a span without dates', () => {
    const d = (n: number) => new Date(Date.UTC(2026, 8, n));
    const o = overlapsOf([
      { key: 'x', from: d(1), to: d(5) },
      { key: 'y', from: d(5), to: d(6) },
      { key: 'z', from: d(10), to: d(11) },
      { key: 'n', from: null, to: null },
    ]);
    expect(o.get('x')).toEqual(['y']);
    expect(o.get('y')).toEqual(['x']);
    expect(o.get('z')).toEqual([]);
    expect(o.get('n')).toEqual([]);
  });
});

describe('CI timings from a check-run response', () => {
  // The shape of GitHub's «List check runs for a Git reference» (two runs named ci: push and pull_request).
  const response = {
    total_count: 3,
    check_runs: [
      { id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-10-01T10:00:05Z', completed_at: '2026-10-01T10:04:00Z', details_url: 'https://github.com/o/r/actions/runs/100/job/1' },
      { id: 2, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-10-01T10:00:02Z', completed_at: '2026-10-01T10:05:30Z', details_url: 'https://github.com/o/r/actions/runs/101/job/2' },
      { id: 3, name: 'lint', status: 'completed', conclusion: 'success', started_at: '2026-10-01T09:00:00Z', completed_at: '2026-10-01T09:01:00Z', details_url: null },
    ],
  };

  it('parses the runs and takes the latest workflow run, the earliest start and the latest completion', () => {
    const checks = response.check_runs.map(parseCheckRun);
    expect(checks[0]).toMatchObject({ name: 'ci', conclusion: 'success', startedAt: '2026-10-01T10:00:05Z', createdAt: null });
    expect(ciTimingsOf(checks)).toEqual({ run_id: '101', queued_at: null, started_at: '2026-10-01T10:00:02Z', completed_at: '2026-10-01T10:05:30Z' });
  });

  it('has no completion while a run is still going, and nothing without ci runs', () => {
    const checks = [...response.check_runs.slice(0, 1), { name: 'ci', status: 'in_progress', conclusion: null, started_at: '2026-10-01T10:01:00Z', completed_at: null, details_url: null }].map(parseCheckRun);
    expect(ciTimingsOf(checks).completed_at).toBeNull();
    expect(ciTimingsOf(checks.slice(0, 0))).toEqual({ run_id: null, queued_at: null, started_at: null, completed_at: null });
  });
});
