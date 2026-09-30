// pr_review end to end with the simulated provider: the reviewer's verdict on the pull request of a
// build request is stored in pr_reviews. It approves when the diff has a test for every criterion the
// task covers, and asks for changes otherwise; a request with no test for a criterion cannot be approved.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { recordDetail } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ durable: true, providers: () => [createSimulatedProvider()] });

const ana = human('ana');
let projectId = '';
let buildRequestId = '';
let codes: string[] = [];

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });
const db = () => environment().services.db;

async function draftRun(action: string, scope: { type: string; id: string }, input?: unknown) {
  await waitForKnowledge(environment().services, projectId, 15_000);
  const r = await cmd('run.request', { action, scope, ...(input ? { input } : {}) });
  await waitForRun(r.entityId);
  return db().selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
}

async function accepted(runId: string) {
  return db()
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id', 'proposal_batches.id as batchId'])
    .where('proposal_batches.run_id', '=', runId)
    .orderBy('proposals.position')
    .execute();
}

beforeAll(async () => {
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Review' } })).projectId;
  // Epic -> feature -> tasks, each accepted and approved by the person.
  const thread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
  await cmd('message.post', { exploration_id: thread, text: 'People should share recipes.', respond: false });
  const epicRun = await draftRun('epic_plan', { type: 'exploration', id: thread });
  const epic = (await cmd('proposal.accept', { approve: false }, (await accepted(epicRun.id))[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, epic.versionId);
  const planned = await db().selectFrom('planned_features').select(['code', 'name']).where('project_id', '=', projectId).orderBy('position').executeTakeFirstOrThrow();
  const featureThread = (
    await cmd('exploration.open', {
      purpose: `Design "${planned.name}" (${planned.code}): Walk the whole thing`,
      parent_id: thread,
      origin: { type: 'record_version', id: epic.versionId },
    })
  ).entityId;
  const featureRun = await draftRun('feature_design', { type: 'exploration', id: featureThread });
  const feature = (await cmd('proposal.accept', { approve: false }, (await accepted(featureRun.id))[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, feature.versionId);
  const taskRun = await draftRun('task_plan', { type: 'record_version', id: feature.versionId });
  const proposals = await accepted(taskRun.id);
  for (const p of proposals) await cmd('proposal.accept', { approve: true }, p.id);
  const detail = await recordDetail(db(), projectId, planned.code);
  const task = detail.tasks?.[0];
  codes = task?.covers ?? [];
  expect(codes.length).toBeGreaterThan(0);
  // build_request.request also demands the design stages passed (readiness), which this test is not about:
  // the request is a fixture with the same columns the command fills in.
  const taskRow = await db().selectFrom('records').select('id').where('project_id', '=', projectId).where('code', '=', task?.code ?? '').executeTakeFirstOrThrow();
  const taskVersion = await db().selectFrom('record_versions').select('id').where('record_id', '=', taskRow.id).where('state', '=', 'approved').executeTakeFirstOrThrow();
  buildRequestId = (
    await db()
      .insertInto('build_requests')
      .values({
        project_id: projectId,
        task_id: taskRow.id,
        task_version_id: taskVersion.id,
        feature_version_id: feature.versionId,
        brief: `Build ${task?.code}.`,
        requested_by: 'human:ana',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
});

const ci = (codes: string[]) => ({ conclusion: 'success', tests: codes.map((code) => ({ code, result: 'pass' as const })) });
const diffWith = (codes: string[]) =>
  `diff --git a/tests/x.test.ts b/tests/x.test.ts\n+++ b/tests/x.test.ts\n${codes.map((c) => `+it('${c} does what the criterion says', () => {});`).join('\n')}\n`;

async function review(diff: string, covered: string[]) {
  const run = await draftRun(
    'pr_review',
    { type: 'build_request', id: buildRequestId },
    { diff, pr_url: 'https://github.com/acme/recipes/pull/1', ci: ci(covered) },
  );
  const rows = await db().selectFrom('pr_reviews').selectAll().where('run_id', '=', run.id).execute();
  return { run, rows };
}

describe('the pr_reviewer agent', () => {
  it('approves when the diff has a test for every criterion of the task', async () => {
    const { run, rows } = await review(diffWith(codes), codes);
    expect(run.state).toBe('completed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: 'approve', build_request_id: buildRequestId, published_at: null });
    const criteria = rows[0]?.criteria as { code: string; covered: boolean; test_name: string }[];
    expect(criteria.map((c) => c.code)).toEqual(codes);
    expect(criteria.every((c) => c.covered && c.test_name.startsWith(c.code))).toBe(true);
    const events = await db().selectFrom('events').select('command').where('command', '=', 'pr_review.record').execute();
    expect(events.length).toBeGreaterThan(0);
  });

  it('asks for changes with a blocking comment when a criterion has no test in the diff', async () => {
    const { run, rows } = await review(diffWith(codes.slice(1)), codes.slice(1));
    expect(run.state).toBe('completed');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe('request_changes');
    const comments = rows[0]?.comments as { severity: string }[];
    expect(comments.some((c) => c.severity === 'blocking')).toBe(true);
    expect((rows[0]?.criteria as { code: string; covered: boolean }[]).find((c) => c.code === codes[0])?.covered).toBe(false);
  });

  it('a stored review is append-only: only published_at can be set, once', async () => {
    const row = await db().selectFrom('pr_reviews').select('id').where('build_request_id', '=', buildRequestId).executeTakeFirstOrThrow();
    await expect(db().updateTable('pr_reviews').set({ summary: 'changed' }).where('id', '=', row.id).execute()).rejects.toThrow();
    await db().updateTable('pr_reviews').set({ published_at: new Date() }).where('id', '=', row.id).execute();
    await expect(db().updateTable('pr_reviews').set({ published_at: new Date() }).where('id', '=', row.id).execute()).rejects.toThrow();
  });
});
