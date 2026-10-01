// Harness post-mortems (salud-del-harness §7): deterministic, idempotent by (request, rules version, inputs hash),
// recomputable under a new rules version without losing the old rows, and found by the reconciler when pending.

import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { HARNESS, computePendingPostmortems, endedOutcome, inputsHashOf, loadInputs, pendingPostmortems, runPostmortem } from '../src/harness/postmortem.ts';
import { RULES_VERSION, type Rule } from '../src/harness/rules/index.ts';
import { deriveOutcomes } from '../src/harness/outcomes.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');

async function projectWithTask(name: string) {
  const s = environment().services;
  const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name } });
  return newTask(projectId, name);
}

async function newTask(projectId: string, name: string) {
  const s = environment().services;
  const made = await executeCommand(s, {
    command: 'record.create',
    actor: ana,
    projectId,
    data: {
      type: 'fdr',
      domain: 'hpm',
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

async function request(p0: { projectId: string; recordId: string; versionId: string }, state: 'requested' | 'done' | 'withdrawn' = 'requested', fresh = false) {
  // At most one open request per task: a further open one needs its own task.
  const p = fresh ? await newTask(p0.projectId, `Task ${Math.random()}`) : p0;
  const s = environment().services;
  const row = await s.db
    .insertInto('build_requests')
    .values({ project_id: p.projectId, task_id: p.recordId, task_version_id: p.versionId, feature_version_id: null, brief: 'brief', requested_by: 'human:ana' })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (state !== 'requested') {
    await s.db.updateTable('build_requests').set(state === 'done' ? { state, done_by: 'system:build', done_at: new Date() } : { state, withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('id', '=', row.id).execute();
  }
  return row.id;
}

async function step(p: { projectId: string }, requestId: string, attempt: number, stage: string, outcome: string, detail?: unknown) {
  await environment()
    .services.db.insertInto('build_steps')
    .values({ project_id: p.projectId, build_request_id: requestId, attempt, stage, outcome, detail: detail === undefined ? null : JSON.stringify(detail) })
    .execute();
}

const count = async (table: 'harness_postmortems' | 'harness_findings', requestId: string) =>
  Number(
    (
      await environment()
        .services.db.selectFrom(table)
        .select((eb) => eb.fn.countAll().as('n'))
        .where('build_request_id', '=', requestId)
        .executeTakeFirstOrThrow()
    ).n,
  );

describe('harness post-mortems', () => {
  it('is idempotent: the same inputs and rules version write nothing the second time', async () => {
    const s = environment().services;
    const p = await projectWithTask('Idem');
    const id = await request(p, 'done');
    await step(p, id, 1, 'builder', 'ok');
    await step(p, id, 1, 'merge', 'ok');
    const first = await runPostmortem(s, id);
    expect(first).toMatchObject({ status: 'recorded', findings: 1 });
    expect(await runPostmortem(s, id)).toEqual({ status: 'unchanged' });
    expect(await count('harness_postmortems', id)).toBe(1);
    expect(await count('harness_findings', id)).toBe(1);
    const row = await s.db.selectFrom('harness_postmortems').selectAll().where('build_request_id', '=', id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ rules_version: RULES_VERSION, outcome: 'merged', attempts: 1, findings: 1 });
    // Append-only: neither table accepts UPDATE or DELETE.
    await expect(s.db.updateTable('harness_postmortems').set({ attempts: 9 }).where('id', '=', row.id).execute()).rejects.toThrow(/only admits INSERT/);
    await expect(s.db.deleteFrom('harness_findings').where('build_request_id', '=', id).execute()).rejects.toThrow(/only admits INSERT/);
    // A late row changes the inputs hash: a new post-mortem, the old one stays.
    await step(p, id, 1, 'main', 'ok', { sha: 'abcdef1' });
    expect(await runPostmortem(s, id)).toMatchObject({ status: 'recorded' });
    expect(await count('harness_postmortems', id)).toBe(2);
  });

  it('a new rules version keeps the old rows and writes its own', async () => {
    const s = environment().services;
    const p = await projectWithTask('Versions');
    const id = await request(p, 'withdrawn');
    await step(p, id, 1, 'builder', 'ok');
    await runPostmortem(s, id, RULES_VERSION);
    const extra: Rule = () => [{ piece: 'B01', finding: 'test.extra', class: 'info', evidence: [] }];
    expect(await runPostmortem(s, id, 'pm-test-2', [extra, extra])).toMatchObject({ status: 'recorded', findings: 2 });
    const rows = await s.db.selectFrom('harness_postmortems').select(['rules_version', 'findings', 'outcome']).where('build_request_id', '=', id).orderBy('rules_version').execute();
    expect(rows).toEqual([
      { rules_version: RULES_VERSION, findings: 1, outcome: 'withdrawn' },
      { rules_version: 'pm-test-2', findings: 2, outcome: 'withdrawn' },
    ]);
  });

  it('queue decisions of a request stop at its first step: a later request of the same task does not leak in (pm-3)', async () => {
    const s = environment().services;
    const p = await projectWithTask('Bound');
    const id = await request(p, 'done');
    const { requested_at } = await s.db.selectFrom('build_requests').select('requested_at').where('id', '=', id).executeTakeFirstOrThrow();
    const code = (await s.db.selectFrom('records').select('code').where('id', '=', p.recordId).executeTakeFirstOrThrow()).code;
    const after = (sec: number) => new Date(new Date(requested_at as unknown as string).getTime() + sec * 1000).toISOString();
    await s.db.insertInto('build_steps').values({ project_id: p.projectId, build_request_id: id, attempt: 1, stage: 'merge', outcome: 'ok', detail: null, created_at: after(10) as never }).execute();
    for (const sec of [2, 3600]) {
      const plan = await s.db
        .insertInto('queue_plans')
        .values({ project_id: p.projectId, decided_at: after(sec) as never, trigger: 'tick', parallel_limit: 2, running: [], started: [], ready_count: 1, plan_hash: `h${sec}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      await s.db.insertInto('queue_decisions').values({ project_id: p.projectId, plan_id: plan.id, task_code: code, decision: 'wait_feature_busy', with_task: 'TSK-OTHER-001', with_source: 'actual' }).execute();
    }
    const loaded = await loadInputs(s.db, id);
    expect(loaded.queueDecisions).toHaveLength(1);
    expect(RULES_VERSION).toBe('pm-4');
  });
  it('pendingPostmortems finds ended requests without a post-mortem, and not the running ones', async () => {
    const s = environment().services;
    const p = await projectWithTask('Pending');
    const done = await request(p, 'done');
    await step(p, done, 1, 'merge', 'ok');
    const failed = await request(p, 'requested', true);
    await step(p, failed, 1, 'builder', 'failed');
    const escalated = await request(p, 'requested', true);
    await step(p, escalated, 1, 'merge', 'changes_requested', { escalated: 'needs_person' });
    const running = await request(p, 'requested', true);
    await step(p, running, 1, 'builder', 'started');
    const redCi = await request(p, 'requested', true);
    await step(p, redCi, 1, 'ci', 'failed', { conclusion: 'failure' });
    const untouched = await request(p, 'requested', true);

    expect(endedOutcome(await loadInputs(s.db, failed))).toBe('failed');
    expect(endedOutcome(await loadInputs(s.db, escalated))).toBe('needs_you');
    expect(endedOutcome(await loadInputs(s.db, running))).toBeNull();
    expect(endedOutcome(await loadInputs(s.db, redCi))).toBeNull();

    const ids = async () => (await pendingPostmortems(s.db)).filter((x) => x.project_id === p.projectId).map((x) => x.id).sort();
    expect(await ids()).toEqual([done, failed, escalated].sort());
    expect(await ids()).not.toContain(untouched);

    expect(await computePendingPostmortems(s, p.projectId)).toBe(3);
    expect(await ids()).toEqual([]);

    // The failed attempt is retried and merged: it is pending again, for the new inputs.
    await step(p, failed, 2, 'merge', 'ok');
    await s.db.updateTable('build_requests').set({ state: 'done', done_by: 'system:build', done_at: new Date() }).where('id', '=', failed).execute();
    expect(await ids()).toEqual([failed]);
    await computePendingPostmortems(s, p.projectId);
    expect(await ids()).toEqual([]);
    const a = await loadInputs(s.db, failed);
    expect(inputsHashOf(a)).toBe(inputsHashOf(await loadInputs(s.db, failed)));
  });

  describe('judgment outcomes', () => {
    const outcomesOf = (projectId: string) =>
      environment().services.db.selectFrom('judgment_outcomes').select(['judgment_table', 'outcome_name', 'outcome_value', 'outcome_label', 'rules_version']).where('project_id', '=', projectId).orderBy('judgment_table').orderBy('outcome_name').orderBy('outcome_label').execute();

    async function mergedRequest(name: string) {
      const s = environment().services;
      const p = await projectWithTask(name);
      // The judgments come before the request.
      await s.db.insertInto('task_size_opinions').values({ project_id: p.projectId, record_id: p.recordId, record_version_id: p.versionId, size: 'S', confidence: 0.7, classifier_id: 'jev@x' }).execute();
      const layers = await s.db
        .insertInto('task_layers_opinions')
        .values({ project_id: p.projectId, record_id: p.recordId, record_version_id: p.versionId, schema_p: 0.9, classifier_id: 'jev@x', input_hash: 'h' })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Timestamps are read back in milliseconds: the request must come clearly after its judgments.
      await new Promise((resolve) => setTimeout(resolve, 15));
      const id = await request(p, 'done');
      for (const [path, rank] of [['src/a.ts', 1], ['src/b.ts', 2]] as const) {
        await s.db.insertInto('task_code_opinions').values({ project_id: p.projectId, build_request_id: id, attempt: 1, record_version_id: p.versionId, path, deterministic_score: 1, jev_p: 0.5, rank, classifier_id: 'jev@x' }).execute();
      }
      await step(p, id, 1, 'builder', 'ok', { duration_ms: 90_000, test_reuse: [{ criterion: 'AC-X-001-01', path: 'test/old.test.ts', title: 't', p: 0.8 }] });
      await step(p, id, 1, 'commit', 'ok', { files: ['src/a.ts', 'test/old.test.ts'] });
      await step(p, id, 1, 'merge', 'ok', { footprint: { files: [{ path: 'src/a.ts' }, { path: 'src/migrations/0001.sql' }] } });
      return { p, id, layersId: layers.id };
    }

    it('writes size, layers, files and test reuse outcomes with the post-mortem, once', async () => {
      const s = environment().services;
      const { p, id, layersId } = await mergedRequest('Outcomes');
      expect(await runPostmortem(s, id)).toMatchObject({ status: 'recorded' });
      const rows = await outcomesOf(p.projectId);
      expect(rows.map((r) => [r.judgment_table, r.outcome_name, r.outcome_label, r.outcome_value === null ? null : Number(r.outcome_value)])).toEqual([
        ['task_code_opinions', 'touched', 'src/a.ts', 1],
        ['task_code_opinions', 'touched', 'src/b.ts', 0],
        ['task_layers_opinions', 'migration_added', 'tp', 1],
        ['task_size_opinions', 'attempts', 'S', 1],
        ['task_size_opinions', 'builder_minutes', 'S', 1.5],
        ['test_reuse', 'test_extended', 'AC-X-001-01', 1],
      ]);
      const layers = await s.db.selectFrom('judgment_outcomes').select('judgment_id').where('judgment_table', '=', 'task_layers_opinions').executeTakeFirstOrThrow();
      expect(layers.judgment_id).toBe(layersId);
      // Idempotent: the same inputs write nothing; the table is append-only.
      expect(await runPostmortem(s, id)).toEqual({ status: 'unchanged' });
      expect(await outcomesOf(p.projectId)).toHaveLength(6);
      await expect(s.db.updateTable('judgment_outcomes').set({ outcome_label: 'x' }).where('project_id', '=', p.projectId).execute()).rejects.toThrow(/only admits INSERT/);
    });

    it('adds outcomes a post-mortem recorded before they existed, without a second post-mortem', async () => {
      const s = environment().services;
      const { p, id } = await mergedRequest('Late outcomes');
      const inputs = await loadInputs(s.db, id);
      await executeCommand(s, {
        command: 'harness.postmortem',
        actor: HARNESS,
        projectId: p.projectId,
        data: { build_request_id: id, rules_version: RULES_VERSION, inputs_hash: inputsHashOf(inputs), attempts: 1, outcome: 'merged', findings: [] },
      });
      expect(await outcomesOf(p.projectId)).toHaveLength(0);
      expect(await runPostmortem(s, id)).toEqual({ status: 'unchanged' });
      expect(await outcomesOf(p.projectId)).toHaveLength(6);
      expect(await count('harness_postmortems', id)).toBe(1);
      expect(await runPostmortem(s, id)).toEqual({ status: 'unchanged' });
      expect(await outcomesOf(p.projectId)).toHaveLength(6);
    });

    it('is pure: no merge, no files outcomes', async () => {
      const p = await projectWithTask('Withdrawn');
      const id = await request(p, 'withdrawn');
      await step(p, id, 1, 'builder', 'ok');
      expect(deriveOutcomes(await loadInputs(environment().services.db, id), [])).toEqual([]);
    });
  });
});
