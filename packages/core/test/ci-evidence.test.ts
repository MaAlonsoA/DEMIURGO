// Evidence from CI: a JUnit report whose test titles start with a criterion code makes that criterion
// verified or failing, recorded by system:ci-junit@1.

import { externalAgent, human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { evidenceOf, recordDetail } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';
import { newDecision } from './support/recipes.ts';

const environment = useEnvironment();
const ana = human('ana');

describe('evidence.ingest_junit', () => {
  it('records pass and fail evidence by criterion code and reports unknown codes', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'CI' } });
    const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
      executeCommand(s, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });
    const basis = await newDecision(s, projectId, true);
    const thread = (await cmd('exploration.open', { purpose: 'Sign-ups' })).entityId;
    const created = await cmd('record.create', {
      type: 'fdr',
      domain: 'signups',
      title: 'Sign up for an activity',
      sections: [
        { title: 'Goal', content: 'A member takes a place.' },
        { title: 'Scope', content: 'Signing up.' },
        { title: 'Out of scope', content: 'Paying.' },
        { title: 'Behavior', content: '1. The member opens an activity.\n2. The member signs up.' },
      ],
      criteria: ['One', 'Two', 'Three'].map((title) => ({
        carry: 'new',
        title,
        statement: `Given an activity, when a member signs up (${title}), then they are in.`,
        verification: 'automatic',
        check: 'A test signs up.',
      })),
      origin: { type: 'exploration', id: thread },
      links: [{ type: 'based_on', target: { code: basis.code, version: 1 } }],
    });
    await cmd('record_version.approve', {}, (created.result as { versionId: string }).versionId);
    const codes = (
      await sql<{ code: string }>`select c.code from criteria c where c.project_id = ${projectId}::uuid order by c.code`.execute(s.db)
    ).rows.map((r) => r.code);
    expect(codes).toHaveLength(3);
    const recordCode = codes[0]!.replace(/^AC-/, 'FDR-').replace(/-\d{2}$/, '');
    const [c1, c2, c3] = codes as [string, string, string];

    const junit = `<?xml version="1.0"?>
<testsuites><testsuite name="core">
  <testcase classname="a" name="${c1} signs up &amp; sees &quot;in&quot;" time="0.1"/>
  <testcase classname="a" name="${c2} refuses when full"><failure message="boom">stack</failure></testcase>
  <testcase classname="a" name="a test without a code"/>
  <testcase classname="a" name="AC-ZZZ-999-01 nobody owns this"/>
  <testcase classname="a" name="${c3} skipped only"><skipped/></testcase>
</testsuite></testsuites>`;

    const agent = externalAgent('ci', 'run-1');
    const r = await executeCommand(s, {
      command: 'evidence.ingest_junit',
      actor: agent,
      projectId,
      data: { junit, reference: 'abc123', expected: [c1, c2, c3] },
    });
    expect(r.result).toEqual({
      recorded: [
        { code: c1, result: 'pass', tests: 1 },
        { code: c2, result: 'fail', tests: 1 },
      ],
      unknown: ['AC-ZZZ-999-01'],
      ignored: 2,
      // c3 only has a skipped case: it did not run, and no evidence is recorded for it.
      not_run: [c3],
      // Every criterion here is automatic: none is listed as not automated.
      not_automated: [],
      // Nothing was recorded as flaky: every case ran once.
      flaky: [],
      // The failing case with its criterion code, title, file (the classname) and message.
      failures: [{ code: c2, test: `${c2} refuses when full`, file: 'a', message: 'boom\nstack' }],
    });
    const stored = await sql<{ failure: string | null }>`select failure from test_runs where test_name = ${`${c2} refuses when full`}`.execute(s.db);
    expect(stored.rows).toEqual([{ failure: 'boom\nstack' }]);

    const { rows } = await sql<{ code: string; kind: string; result: string; test_name: string; recorded_by: string; reference: string }>`
      select c.code, e.kind, e.result, e.test_name, e.recorded_by, e.reference
      from evidence e join criteria c on c.id = e.criterion_id order by c.code`.execute(s.db);
    expect(rows).toEqual([
      { code: c1, kind: 'system', result: 'pass', test_name: `${c1} signs up & sees "in"`, recorded_by: 'system:ci-junit@1', reference: 'abc123' },
      { code: c2, kind: 'system', result: 'fail', test_name: `${c2} refuses when full`, recorded_by: 'system:ci-junit@1', reference: 'abc123' },
    ]);

    const detail = await recordDetail(s.db, projectId, recordCode);
    const state = (code: string) => detail.versions.at(-1)?.criteria.find((c: { code: string }) => c.code === code)?.state;
    expect(state(c1)).toBe('verified');
    expect(state(c2)).toBe('failing');
    expect(state(c3)).not.toMatch(/verified|failing/);

    // Evidence of the current commit only: another commit's result is «no evidence».
    const criterionId = (await sql<{ id: string }>`select id from criteria where project_id = ${projectId}::uuid and code = ${c1}`.execute(s.db)).rows[0]!.id;
    expect((await evidenceOf(s.db, criterionId, { reference: 'abc123' }))?.result).toBe('pass');
    expect(await evidenceOf(s.db, criterionId, { reference: 'def456' })).toBeNull();
    expect((await evidenceOf(s.db, criterionId))?.result).toBe('pass');
  });

  it('stores the build request, the attempt and the CI run on every test run of a pull request', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'PR rows' } });
    const made = await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId,
      data: {
        type: 'fdr',
        domain: 'prr',
        title: 'Feature',
        sections: [
          { title: 'Goal', content: 'g' },
          { title: 'Scope', content: 's' },
          { title: 'Out of scope', content: 'o' },
          { title: 'Behavior', content: '1. b' },
        ],
        criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
      },
    });
    const request = await s.db
      .insertInto('build_requests')
      .values({ project_id: projectId, task_id: made.entityId, task_version_id: (made.result as { versionId: string }).versionId, feature_version_id: null, brief: 'b', requested_by: 'human:ana' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const junit = (outcome: 'pass' | 'fail') => `<testsuites><testsuite name="x"><testcase classname="a" name="logs in">${outcome === 'fail' ? '<failure message="x"/>' : ''}</testcase><testcase classname="a" name="other"/></testsuite></testsuites>`;
    const build = { build_request_id: request.id, attempt: 2, ci_run_id: '777' };
    await executeCommand(s, { command: 'evidence.ingest_junit', actor: externalAgent('ci', 'run-pr'), projectId, data: { junit: junit('fail'), reference: 'shaPR', ...build } });
    // Main: no request, only its CI run.
    await executeCommand(s, { command: 'evidence.ingest_junit', actor: externalAgent('ci', 'run-main'), projectId, data: { junit: junit('pass'), reference: 'shaMain', ci_run_id: '888' } });
    const rows = await s.db.selectFrom('test_runs').select(['head_sha', 'build_request_id', 'attempt', 'ci_run_id']).where('project_id', '=', projectId).orderBy('head_sha').execute();
    expect(rows.filter((r) => r.head_sha === 'shaPR')).toEqual([
      { head_sha: 'shaPR', build_request_id: request.id, attempt: 2, ci_run_id: '777' },
      { head_sha: 'shaPR', build_request_id: request.id, attempt: 2, ci_run_id: '777' },
    ]);
    expect(rows.filter((r) => r.head_sha === 'shaMain')).toEqual([
      { head_sha: 'shaMain', build_request_id: null, attempt: null, ci_run_id: '888' },
      { head_sha: 'shaMain', build_request_id: null, attempt: null, ci_run_id: '888' },
    ]);
  });
});
