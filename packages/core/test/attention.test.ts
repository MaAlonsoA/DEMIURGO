// Attention and cost per stage and «is it worth it?» (salud-del-harness §5, §6.7, §10): the pure core on synthetic
// facts (stages, provenance chain, whole batches, seconds per item, proxies) and the queries on an ephemeral database.

import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { type AttentionFacts, attentionByStage, attentionOf, ciOf, personMinutesOf, statOf, usageOf, worthIt } from '../src/queries/attention.ts';
import { useEnvironment } from './support/env.ts';

const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, 0) + min * 60_000);
const empty = (): AttentionFacts => ({ stages: [], questions: [], confirms: [], proposals: [], batches: [], runs: [], versions: [], records: [], answers: [], humanEvents: [] });
const stage = (facts: ReturnType<typeof attentionOf>, k: string) => facts.stages.find((s) => s.stage === k)!;

describe('pure helpers', () => {
  it('computes median, p90 and max, and nothing for an empty list', () => {
    expect(statOf([])).toEqual({ n: 0, median: null, p90: null, max: null });
    expect(statOf([10, 20, 30, 40, 100])).toEqual({ n: 5, median: 30, p90: 76, max: 100 });
  });

  it('buckets person minutes by 5 and splits sessions at a gap over 15 minutes', () => {
    const t = [0, 1, 2, 7, 40, 41].map((m) => at(m).getTime());
    expect(personMinutesOf(t)).toEqual({ buckets_minutes: 15, session_minutes: 8, sessions: 2 });
    expect(personMinutesOf([])).toEqual({ buckets_minutes: 0, session_minutes: 0, sessions: 0 });
  });

  it('reads usage and tells declared from missing', () => {
    expect(usageOf({ inputTokens: 10, outputTokens: 5, declaredCostUsd: 0.5 })).toEqual({ input: 10, output: 5, usd: 0.5, declared: true });
    expect(usageOf(null).declared).toBe(false);
  });

  it('measures CI minutes from started to the next decisive result of an attempt', () => {
    const s = (outcome: string, min: number, attempt = 1) => ({ build_request_id: 'r', attempt, outcome, created_at: at(min) });
    expect(ciOf([s('started', 0), s('waiting', 1), s('ok', 6), s('started', 10, 2), s('failed', 14, 2)])).toEqual({ runs: 2, minutes: 10 });
    expect(ciOf([s('started', 0)])).toEqual({ runs: 0, minutes: 0 });
  });
});

describe('attentionOf', () => {
  it('counts questions per stage, what led to a version, and seconds to answer', () => {
    const f = empty();
    f.stages = [{ id: 's1', stage: 'quality', exploration_id: 'e1' }];
    f.questions = [
      { id: 'q1', exploration_id: 'e1', state: 'confirmed', stage_id: 's1', shown_at: at(0) },
      { id: 'q2', exploration_id: 'e1', state: 'confirmed', stage_id: 's1', shown_at: at(0) },
      { id: 'q3', exploration_id: 'e1', state: 'pending', stage_id: 's1', shown_at: null },
      { id: 'q4', exploration_id: 'e9', state: 'confirmed', stage_id: null, shown_at: at(0) },
    ];
    f.confirms = [
      { entity_id: 'q1', at: new Date(at(0).getTime() + 20_000) },
      { entity_id: 'q2', at: new Date(at(0).getTime() + 60_000) },
      { entity_id: 'q4', at: new Date(at(0).getTime() + 10_000) },
    ];
    // An accepted definition proposal cites q1; q2 is cited through version_answers.
    f.proposals = [{ id: 'p1', batch_id: 'b1', type: 'product_definition', state: 'accepted', position: 0, record_type: null, code: null, sources: [{ key: 'purpose', question_id: 'q1' }], version_id: 'v1', created_at: at(1), resolved_at: at(2) }];
    f.batches = [{ id: 'b1', kind: 'system_package', run_id: null, created_at: at(1), shown_at: null, resolved_at: at(2) }];
    f.answers = [{ record_version_id: 'v1', question_id: 'q2' }];
    const a = attentionOf(f);
    expect(stage(a, 'quality').questions).toMatchObject({ raised: 3, answered: 2, pending: 1, led_to_version: 2 });
    expect(stage(a, 'quality').questions.seconds_to_answer).toMatchObject({ n: 2, median: 40 });
    // a question outside any stage lands in «other», and a definition proposal in «definition»
    expect(stage(a, 'other').questions).toMatchObject({ raised: 1, answered: 1, led_to_version: 0 });
    expect(stage(a, 'definition').proposals.accepted).toBe(1);
  });

  it('uses the proxy: a later run of the exploration whose batch ended in an accepted version', () => {
    const f = empty();
    f.questions = [{ id: 'q1', exploration_id: 'e1', state: 'confirmed', stage_id: null, shown_at: at(0) }];
    f.confirms = [{ entity_id: 'q1', at: at(1) }];
    f.runs = [{ id: 'r1', action: 'exploration_chat', scope: { id: 'e1' }, usage: null }];
    f.batches = [{ id: 'b1', kind: 'agent', run_id: 'r1', created_at: at(3), shown_at: null, resolved_at: at(4) }];
    f.proposals = [{ id: 'p1', batch_id: 'b1', type: 'design_record', state: 'accepted', position: 0, record_type: 'fdr', code: null, sources: null, version_id: 'v1', created_at: at(3), resolved_at: at(4) }];
    const q = stage(attentionOf(f), 'other').questions;
    expect(q.led_to_version).toBe(0);
    expect(q.led_to_version_proxy).toBe(1);
  });

  it('counts proposals, whole batches and seconds per item (from shown_at when there is one)', () => {
    const f = empty();
    const items = (batch: string, n: number, state = 'accepted') =>
      Array.from({ length: n }, (_, i) => ({ id: `${batch}-${i}`, batch_id: batch, type: 'design_record', state, position: i, record_type: 'task', code: null, sources: null, version_id: null, created_at: at(0), resolved_at: at(10) }));
    f.batches = [
      { id: 'big', kind: 'agent', run_id: null, created_at: at(0), shown_at: at(5), resolved_at: at(10) },
      { id: 'edited', kind: 'agent', run_id: null, created_at: at(0), shown_at: null, resolved_at: at(10) },
      { id: 'small', kind: 'agent', run_id: null, created_at: at(0), shown_at: null, resolved_at: at(10) },
    ];
    f.proposals = [...items('big', 5), ...items('edited', 5).map((p, i) => (i === 0 ? { ...p, state: 'accepted_edited' } : p)), ...items('small', 1, 'rejected')];
    const t = stage(attentionOf(f), 'tasks');
    expect(t.proposals).toMatchObject({ accepted: 10, edited: 1, rejected: 1 });
    expect(t.batches).toMatchObject({ resolved: 3, whole_accepted: 1, timed: 2, timed_from_shown: 1 });
    // big: 5 min over 5 items = 60 s; edited: 10 min over 5 items = 120 s
    expect(t.batches.seconds_per_item).toMatchObject({ n: 2, median: 90 });
  });

  it('shares a run cost among the versions its batch produced, through the provenance chain, and keeps wasted runs against the stage', () => {
    const f = empty();
    f.records = [
      { id: 'rec1', code: 'FDR-A-001', type: 'fdr' },
      { id: 'rec2', code: 'FDR-A-002', type: 'fdr' },
    ];
    f.runs = [
      { id: 'r1', action: 'feature_design', scope: { id: 'x' }, usage: { inputTokens: 1000, outputTokens: 200, declaredCostUsd: 0.4 } },
      { id: 'r2', action: 'feature_design', scope: { id: 'x' }, usage: { inputTokens: 500, outputTokens: 100, declaredCostUsd: 0.2 } },
      { id: 'r3', action: 'explainer', scope: {}, usage: null },
    ];
    f.batches = [
      { id: 'b1', kind: 'agent', run_id: 'r1', created_at: at(0), shown_at: null, resolved_at: at(1) },
      { id: 'b2', kind: 'agent', run_id: 'r2', created_at: at(0), shown_at: null, resolved_at: at(1) },
    ];
    const prop = (id: string, batch: string, state: string) => ({ id, batch_id: batch, type: 'design_record', state, position: 0, record_type: 'fdr', code: null, sources: null, version_id: null, created_at: at(0), resolved_at: at(1) });
    f.proposals = [prop('p1', 'b1', 'accepted'), prop('p2', 'b1', 'accepted'), prop('p3', 'b2', 'rejected')];
    f.versions = [
      { id: 'v1', record_id: 'rec1', proposal_id: 'p1' },
      { id: 'v2', record_id: 'rec2', proposal_id: 'p2' },
    ];
    const a = attentionOf(f);
    const c = stage(a, 'epics_features').cost;
    // both runs count against the stage (the rejected one too), over the two versions produced
    expect(c).toMatchObject({ runs: 2, input_tokens: 1500, output_tokens: 300, usd: 0.6, artefacts: 2, tokens_per_artefact: 900, usd_per_artefact: 0.3 });
    // the run with no batch and no stage thread, and no usage, is «other» and says so
    expect(stage(a, 'other').cost).toMatchObject({ runs: 1, runs_without_usage: 1 });
  });

  it('attributes person minutes to the stage of the entity each human event touched', () => {
    const f = empty();
    f.proposals = [{ id: 'p1', batch_id: 'b1', type: 'design_record', state: 'accepted', position: 0, record_type: 'task', code: null, sources: null, version_id: null, created_at: at(0), resolved_at: at(1) }];
    f.batches = [{ id: 'b1', kind: 'agent', run_id: null, created_at: at(0), shown_at: null, resolved_at: at(1) }];
    f.humanEvents = [
      { at: at(0), entity_id: 'p1' },
      { at: at(1), entity_id: 'p1' },
      { at: at(30), entity_id: 'unknown' },
    ];
    const a = attentionOf(f);
    expect(stage(a, 'tasks').person_minutes_proxy).toBe(5);
    expect(stage(a, 'other').person_minutes_proxy).toBe(5);
    expect(a.person).toMatchObject({ buckets_minutes: 10, sessions: 2 });
    expect(a.person.basis).toBe('convención nuestra');
  });
});

describe('queries on a database', () => {
  const environment = useEnvironment();
  const ana = human('ana');

  async function project() {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Attn' } });
    const made = await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId,
      data: {
        type: 'fdr',
        domain: 'attn',
        title: 'Feature attention',
        sections: [
          { title: 'Goal', content: 'A goal.' },
          { title: 'Scope', content: 'Scope.' },
          { title: 'Out of scope', content: 'Nothing.' },
          { title: 'Behavior', content: '1. It works.' },
        ],
        criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
      },
    });
    return { s, projectId, made };
  }

  it('batch.show fixes shown_at once and the attention query counts the batch', async () => {
    const { s, projectId } = await project();
    const run = await s.db
      .insertInto('ai_runs')
      .values({ project_id: projectId, action: 'feature_design', scope: JSON.stringify({ id: 'x' }), method: 'agent', schema_version: '1', provider: 'simulated', state: 'completed', requested_by: 'human:ana', usage: JSON.stringify({ inputTokens: 100, outputTokens: 50, declaredCostUsd: 0.1 }) })
      .returning('id')
      .executeTakeFirstOrThrow();
    const batch = await s.db
      .insertInto('proposal_batches')
      .values({ project_id: projectId, kind: 'agent', producer: 'agent:x', run_id: run.id, resolution_mode: 'item', dependencies: '[]', state: 'pending' })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (let i = 0; i < 2; i++)
      await s.db
        .insertInto('proposals')
        .values({ project_id: projectId, batch_id: batch.id, position: i, type: 'design_record', payload: JSON.stringify({ record_type: 'task' }), dependencies: '[]', state: 'pending' })
        .execute();

    const before = await s.db.selectFrom('proposal_batches').select('shown_at').where('id', '=', batch.id).executeTakeFirstOrThrow();
    expect(before.shown_at).toBeNull();
    await executeCommand(s, { command: 'batch.show', actor: ana, projectId, entityId: batch.id, data: {} });
    const first = (await s.db.selectFrom('proposal_batches').select('shown_at').where('id', '=', batch.id).executeTakeFirstOrThrow()).shown_at;
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    await executeCommand(s, { command: 'batch.show', actor: ana, projectId, entityId: batch.id, data: {} });
    const second = (await s.db.selectFrom('proposal_batches').select('shown_at').where('id', '=', batch.id).executeTakeFirstOrThrow()).shown_at;
    expect(new Date(second as Date).getTime()).toBe(new Date(first as Date).getTime());

    // An agent cannot declare a person looked at it (403 from the matrix).
    await expect(executeCommand(s, { command: 'batch.show', actor: { type: 'agent', name: 'x', session: 's' } as never, projectId, entityId: batch.id, data: {} })).rejects.toMatchObject({ type: 'forbidden' });

    const a = await attentionByStage(s.db, projectId);
    const tasks = a.stages.find((x) => x.stage === 'tasks')!;
    expect(tasks.proposals.pending).toBe(2);
    expect(tasks.cost).toMatchObject({ runs: 1, input_tokens: 100, output_tokens: 50, usd: 0.1 });
    expect(a.stages.map((x) => x.stage)).toContain('knowledge');
    expect(a.person.buckets_minutes).toBeGreaterThan(0);
  });

  it('worthIt counts merged tasks, verified criteria and approved records against the declared cost', async () => {
    const { s, projectId, made } = await project();
    const versionId = (made.result as { versionId: string }).versionId;
    await s.db
      .insertInto('build_requests')
      .values({ project_id: projectId, task_id: made.entityId, task_version_id: versionId, feature_version_id: null, brief: 'b', requested_by: 'human:ana', state: 'done' })
      .execute();
    await s.db
      .insertInto('ai_runs')
      .values({ project_id: projectId, action: 'pr_review', scope: JSON.stringify({}), method: 'agent', schema_version: '1', provider: 'simulated', state: 'completed', requested_by: 'human:ana', usage: JSON.stringify({ inputTokens: 1000, outputTokens: 0, declaredCostUsd: 0.5 }) })
      .execute();
    await s.db
      .insertInto('ai_runs')
      .values({ project_id: projectId, action: 'task_plan', scope: JSON.stringify({}), method: 'agent', schema_version: '1', provider: 'simulated', state: 'completed', requested_by: 'human:ana' })
      .execute();
    const w = await worthIt(s.db, projectId);
    expect(w.value.merged_tasks).toBe(1);
    expect(w.cost.reviewer).toMatchObject({ tokens: 1000, usd: 0.5, runs: 1 });
    expect(w.cost.design).toMatchObject({ runs: 1, runs_without_usage: 1 });
    expect(w.cost.usd).toBe(0.5);
    expect(w.units).toMatchObject({ usd_per_merged_task: 0.5, tokens_per_merged_task: 1000, patches_per_merged_task: null });
    expect(w.cost.patches).toEqual({ count: null, source: 'not_derivable' });
    const withPatches = await worthIt(s.db, projectId, { patches: 3 });
    expect(withPatches.cost.patches).toEqual({ count: 3, source: 'parameter' });
    expect(withPatches.units.patches_per_merged_task).toBe(3);
    // an empty project has nothing to divide by
    const other = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Empty' } });
    expect((await worthIt(s.db, other.projectId)).units.usd_per_merged_task).toBeNull();
  });
});
