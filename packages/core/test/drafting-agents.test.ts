// The three drafting agents end to end with the simulated provider: epic_plan writes the epic of a
// thread, feature_design designs one planned feature of it, task_plan breaks the approved feature into
// tasks. A person accepts and approves each step; a run whose output fails the checker creates nothing.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SCRIPTS, createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { explorationDetail, recordDetail } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({
  durable: true,
  providers: () => [
    createSimulatedProvider({
      scripts: {
        // A feature with only two steps, whatever the thread: the checker must stop it.
        feature_design: (p) => {
          const out = DEFAULT_SCRIPTS.feature_design(p) as {
            result: { kind: string; feature: { steps: string[]; criteria: { step: number }[] } };
          };
          if (JSON.stringify(p.context.content).includes('Two steps only')) {
            out.result.feature.steps = out.result.feature.steps.slice(0, 2);
            out.result.feature.criteria = out.result.feature.criteria.map((c) => ({ ...c, step: Math.min(c.step, 2) }));
          }
          return out;
        },
      },
    }),
  ],
});

const ana = human('ana');
let projectId = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });
const db = () => environment().services.db;

beforeAll(async () => {
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Drafting' } }))
    .projectId;
});

async function draftRun(action: string, scope: { type: string; id: string }) {
  // A run needs the knowledge graph up to date with what the person just accepted.
  await waitForKnowledge(environment().services, projectId, 15_000);
  const r = await cmd('run.request', { action, scope });
  await waitForRun(r.entityId);
  return db().selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
}

async function proposalsOf(runId: string) {
  return db()
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id', 'proposals.type', 'proposals.state', 'proposals.payload', 'proposal_batches.id as batchId'])
    .where('proposal_batches.run_id', '=', runId)
    .orderBy('proposals.position')
    .execute();
}

type Payload = {
  record_type: string;
  code?: string;
  sections: { title: string; content: string }[];
  criteria: { given: string; when: string; then: string; step: number | null }[];
  features?: { name: string; summary: string }[];
  sources?: unknown[];
  size?: string;
  covers?: string[];
};

type Created = { recordId: string; versionId: string; code: string; version: number };

const state: { epicThread: string; epic?: Created; featureThread: string; featureCode: string; feature?: Created; featureVersion: string } = {
  epicThread: '',
  featureThread: '',
  featureCode: '',
  featureVersion: '',
};

describe('the drafting agents', () => {
  it('epic_plan drafts the epic of a thread as one pending proposal with its sections, criteria and features', async () => {
    state.epicThread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
    await cmd('message.post', { exploration_id: state.epicThread, text: 'People should share recipes end to end.', respond: false });
    const run = await draftRun('epic_plan', { type: 'exploration', id: state.epicThread });
    expect(run.state).toBe('completed');
    const proposals = await proposalsOf(run.id);
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p).toMatchObject({ type: 'design_record', state: 'pending' });
    const payload = p?.payload as Payload;
    expect(payload.record_type).toBe('epic');
    expect(payload.sections.map((s) => s.title)).toEqual(['Goal', 'Out of scope', 'Done when']);
    expect(payload.criteria.length).toBeGreaterThan(0);
    for (const c of payload.criteria) {
      expect(c.given && c.when && c.then).toBeTruthy();
      expect(c.step).toBeNull();
    }
    expect(payload.features).toHaveLength(3);
    // No practice source cited: the payload leaves `sources` out instead of an empty list.
    expect(payload.sources ?? []).toEqual([]);
  });

  it('accepting and approving the epic makes its planned features, and its first one opens a feature thread that offers feature_design', async () => {
    const epicRun = await db()
      .selectFrom('ai_runs')
      .select('id')
      .where('action', '=', 'epic_plan')
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    const [p] = await proposalsOf(epicRun.id);
    const accepted = await cmd('proposal.accept', { approve: false }, p?.id);
    state.epic = accepted.result as Created;
    await cmd('record_version.approve', {}, state.epic.versionId);
    const planned = await db()
      .selectFrom('planned_features')
      .select(['code', 'name', 'state', 'position'])
      .where('project_id', '=', projectId)
      .orderBy('position')
      .execute();
    expect(planned).toHaveLength(3);
    expect(planned.every((f) => f.state === 'planned')).toBe(true);
    const first = planned[0];
    state.featureCode = first?.code ?? '';
    state.featureThread = (
      await cmd('exploration.open', {
        purpose: `Design "${first?.name}" (${first?.code}, ${state.epic.code}): Walk the whole thing`,
        parent_id: state.epicThread,
        origin: { type: 'record_version', id: state.epic.versionId },
      })
    ).entityId;
    const detail = await explorationDetail(db(), projectId, state.featureThread);
    expect(detail.draft).toMatchObject({ kind: 'feature', action: 'feature_design', scope: { type: 'exploration', id: state.featureThread } });
  });

  it('feature_design proposes the feature under its reserved code, with numbered steps and criteria tied to them', async () => {
    const run = await draftRun('feature_design', { type: 'exploration', id: state.featureThread });
    expect(run.state).toBe('completed');
    const proposals = await proposalsOf(run.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ type: 'design_record', state: 'pending' });
    const payload = proposals[0]?.payload as Payload;
    expect(payload.record_type).toBe('fdr');
    expect(payload.code).toBe(state.featureCode);
    const behavior = payload.sections.find((s) => s.title === 'Behavior')?.content ?? '';
    const steps = behavior.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(9);
    expect(payload.criteria.length).toBeGreaterThan(0);
    for (const c of payload.criteria) {
      expect(c.step).toBeGreaterThanOrEqual(1);
      expect(c.step).toBeLessThanOrEqual(steps.length);
      expect(c.given && c.when && c.then).toBeTruthy();
    }
    expect(payload.size).toBeTruthy();
  });

  it('accepting and approving the feature makes the thread offer task_plan on the approved version', async () => {
    const run = await db()
      .selectFrom('ai_runs')
      .select('id')
      .where('action', '=', 'feature_design')
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    const [p] = await proposalsOf(run.id);
    state.feature = (await cmd('proposal.accept', { approve: false }, p?.id)).result as Created;
    await cmd('record_version.approve', {}, state.feature.versionId);
    const detail = await explorationDetail(db(), projectId, state.featureThread);
    expect(detail.draft).toMatchObject({ kind: 'tasks', action: 'task_plan', scope: { type: 'record_version', id: state.feature.versionId } });
    state.featureVersion = state.feature.versionId;
  });

  it('task_plan proposes one package of tasks that together cover every criterion, and accepting it creates them', async () => {
    const run = await draftRun('task_plan', { type: 'record_version', id: state.featureVersion });
    expect(run.state).toBe('completed');
    const proposals = await proposalsOf(run.id);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(new Set(proposals.map((p) => p.batchId)).size === 1 && proposals.every((p) => p.state === 'pending')).toBe(true);
    const payloads = proposals.map((p) => p.payload as Payload);
    expect(payloads.every((x) => x.record_type === 'task')).toBe(true);
    const feature = await recordDetail(db(), projectId, state.featureCode);
    const criteria = feature.versions.find((v) => v.current)?.criteria.map((c) => c.code) ?? [];
    expect(criteria.length).toBeGreaterThan(0);
    expect(new Set(payloads.flatMap((x) => x.covers ?? []))).toEqual(new Set(criteria));

    await cmd('batch.accept_package', { approve: true }, proposals[0]?.batchId);
    const after = await recordDetail(db(), projectId, state.featureCode);
    expect(after.tasks).toHaveLength(proposals.length);
    for (const t of after.tasks ?? []) expect(t.size).toBeTruthy();
    expect(after.tasks?.flatMap((t) => t.covers).sort()).toEqual([...criteria].sort());
    expect(after.uncovered).toEqual([]);
    expect(after.dod?.done).toBe(false);
  });

  it('a feature with two steps fails the checker: the run fails and no proposal is created', async () => {
    const planned = await db()
      .selectFrom('planned_features')
      .select(['code', 'name'])
      .where('project_id', '=', projectId)
      .where('state', '=', 'planned')
      .orderBy('position')
      .executeTakeFirstOrThrow();
    const thread = (
      await cmd('exploration.open', {
        purpose: `Design "${planned.name}" (${planned.code}, ${state.epic?.code}): Two steps only`,
        parent_id: state.epicThread,
        origin: { type: 'record_version', id: state.epic?.versionId },
      })
    ).entityId;
    const run = await draftRun('feature_design', { type: 'exploration', id: thread });
    expect(run.state).toBe('failed');
    expect(await proposalsOf(run.id)).toHaveLength(0);
    expect(run.failure_kind).toBe('invalid_output');
    expect(run.error).toMatch(/2 steps/);
  });
});
