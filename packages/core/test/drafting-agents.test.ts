// The three drafting agents end to end with the simulated provider: epic_plan writes the epic of a
// thread, feature_design designs one planned feature of it, task_plan breaks the approved feature into
// tasks. A person accepts and approves each step; a run whose output fails the checker creates nothing.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SCRIPTS, createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { explorationDetail, recordDetail, versionReadiness } from '../src/queries/read.ts';
import { withoutDuplicateCoverage } from '../src/actions/task-plan.ts';
import { taskDraftView } from '../src/queries/task-view.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({
  durable: true,
  providers: () => [
    createSimulatedProvider({
      scripts: {
        // A re-plan whose request moves a criterion out of a task: the planner changes that task and adds a new one.
        task_plan: (p) => {
          const base = DEFAULT_SCRIPTS.task_plan(p) as Record<string, unknown>;
          const c = p.context.content as {
            request?: { messages: { body: string }[] } | null;
            existing_tasks: {
              code: string;
              covers: string[];
              changeable: boolean;
            }[];
          };
          // A plan whose tasks wait for the feature the request names (WAITS_TEST:<code>, the last one).
          const waits = [...JSON.stringify(c.request ?? null).matchAll(/WAITS_TEST:(FDR-[A-Z]{3}-\d{3})/g)].at(-1)?.[1];
          if (waits)
            return {
              ...base,
              tasks: (base.tasks as object[]).map((t) => ({ ...t, waits_for_features: [waits] })),
            };
          if (!JSON.stringify(c.request ?? null).includes('MOVE_TEST')) return base;
          const task = c.existing_tasks.find((t) => t.changeable && t.covers.length > 1);
          if (!task) return base;
          const moved = task.covers[task.covers.length - 1]!;
          return {
            ...base,
            tasks: [
              {
                title: 'Moved criterion, built later',
                goal: 'Build what the moved criterion checks.',
                scope: 'Checked only once another feature exists: build after it.',
                covers: [moved],
                size: 'S',
                size_reason: 'One criterion.',
                split: null,
                walking_skeleton: false,
                depends_on: [],
                waits_for_features: [],
              },
            ],
            task_changes: [
              {
                code: task.code,
                covers: task.covers.slice(0, -1),
                scope: `${moved} moved to a later task.`,
                goal: null,
              },
            ],
          };
        },
        // A feature with only two steps, whatever the thread: the checker must stop it.
        feature_design: (p) => {
          const out = DEFAULT_SCRIPTS.feature_design(p) as {
            result: {
              kind: string;
              feature: { steps: string[]; criteria: { step: number }[] };
            };
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
  executeCommand(environment().services, {
    command,
    actor: ana,
    projectId,
    data,
    ...(entityId ? { entityId } : {}),
  });
const db = () => environment().services.db;

beforeAll(async () => {
  projectId = (
    await executeCommand(environment().services, {
      command: 'project.create',
      actor: ana,
      data: { name: 'Drafting' },
    })
  ).projectId;
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
  criteria: {
    given: string;
    when: string;
    then: string;
    step: number | null;
  }[];
  features?: { name: string; summary: string }[];
  sources?: unknown[];
  size?: string;
  covers?: string[];
};

type Created = {
  recordId: string;
  versionId: string;
  code: string;
  version: number;
};

const state: {
  epicThread: string;
  epic?: Created;
  featureThread: string;
  featureCode: string;
  feature?: Created;
  featureVersion: string;
} = {
  epicThread: '',
  featureThread: '',
  featureCode: '',
  featureVersion: '',
};

describe('the drafting agents', () => {
  it('epic_plan drafts the epic of a thread as one pending proposal with its sections, criteria and features', async () => {
    state.epicThread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
    await cmd('message.post', {
      exploration_id: state.epicThread,
      text: 'People should share recipes end to end.',
      respond: false,
    });
    const run = await draftRun('epic_plan', {
      type: 'exploration',
      id: state.epicThread,
    });
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
    expect(detail.draft).toMatchObject({
      kind: 'feature',
      action: 'feature_design',
      scope: { type: 'exploration', id: state.featureThread },
    });
  });

  it('feature_design proposes the feature under its reserved code, with numbered steps and criteria tied to them', async () => {
    const run = await draftRun('feature_design', {
      type: 'exploration',
      id: state.featureThread,
    });
    expect(run.state).toBe('completed');
    const proposals = await proposalsOf(run.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      type: 'design_record',
      state: 'pending',
    });
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
    expect(detail.draft).toMatchObject({
      kind: 'tasks',
      action: 'task_plan',
      scope: { type: 'record_version', id: state.feature.versionId },
    });
    state.featureVersion = state.feature.versionId;
  });

  it('task_plan proposes a batch of tasks, each decided on its own, that together cover every criterion, and accepting it creates them', async () => {
    const run = await draftRun('task_plan', {
      type: 'record_version',
      id: state.featureVersion,
    });
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

    // The draft page: the feature, the criteria with their text, the order, the dependency and where it comes from.
    const last = proposals.length - 1;
    const draft = await taskDraftView(db(), projectId, proposals[last]!.id);
    expect(draft).toMatchObject({
      draft: { state: 'pending', siblings: proposals.length },
      code: null,
      state: 'proposed',
      feature: { code: state.featureCode },
      order: { n: proposals.length, of: proposals.length },
    });
    expect(draft.feature.epic?.code).toBe(state.epic?.code);
    expect(draft.covers.map((c) => c.code).sort()).toEqual([...(payloads[last]?.covers ?? [])].sort());
    expect(draft.covers.every((c) => c.statement.length > 0 && c.given !== null)).toBe(true);
    expect(draft.provenance.proposed_by).toMatchObject({
      agent: 'task_planner',
      run_id: run.id,
    });
    expect(draft.provenance.thread).not.toBeNull();
    if (proposals.length > 1) {
      expect(draft.depends_on.map((d) => d.ref)).toEqual([proposals[last - 1]!.id]);
      expect(payloads[last]).toMatchObject({
        depends_on_titles: [(payloads[last - 1] as { title?: string }).title],
      });
      const first = await taskDraftView(db(), projectId, proposals[0]!.id);
      expect(first.blocks.map((d) => d.ref)).toEqual([proposals[1]!.id]);
    }

    for (const p of proposals) await cmd('proposal.accept', { approve: true }, p.id);
    const after = await recordDetail(db(), projectId, state.featureCode);
    expect(after.tasks).toHaveLength(proposals.length);
    // The accepted task: same page, now a record, with the link to what it waits for and who decided.
    const codes = (after.tasks ?? []).map((t) => t.code);
    const lastTask = await recordDetail(db(), projectId, codes[last]!);
    expect(lastTask.task).toMatchObject({
      draft: null,
      code: codes[last],
      feature: { code: state.featureCode },
      order: { n: proposals.length, of: proposals.length },
      version: { n: 1, state: 'approved' },
    });
    expect(lastTask.task?.covers.length).toBeGreaterThan(0);
    expect(lastTask.task?.covers.every((c) => c.statement.length > 0)).toBe(true);
    expect(lastTask.task?.provenance).toMatchObject({
      proposed_by: { agent: 'task_planner' },
      accepted_by: 'human:ana',
    });
    expect(lastTask.task?.provenance.approved_at).not.toBeNull();
    expect(lastTask.task?.history).toHaveLength(1);
    expect(lastTask.task?.dod.some((d) => d.item === 'Pull request reviewed and merged' && !d.met)).toBe(true);
    if (proposals.length > 1) {
      expect(lastTask.task?.depends_on.map((d) => d.code)).toEqual([codes[last - 1]]);
      const firstTask = await recordDetail(db(), projectId, codes[0]!);
      expect(firstTask.task?.blocks.map((d) => d.code)).toEqual([codes[last]]);
      const link = await db().selectFrom('links').select('type').where('type', '=', 'depends_on').execute();
      expect(link.length).toBeGreaterThan(0);
    }
    // The accepted draft still reads as a page with the code it got.
    expect((await taskDraftView(db(), projectId, proposals[0]!.id)).draft?.state).toBe('accepted');
    for (const t of after.tasks ?? []) expect(t.size).toBeTruthy();
    expect(after.tasks?.flatMap((t) => t.covers).sort()).toEqual([...criteria].sort());
    expect(after.uncovered).toEqual([]);
    expect(after.dod?.done).toBe(false);
  });

  it('a re-plan with a request that moves a criterion changes the existing task and adds a new one; duplicate coverage is dropped', async () => {
    const before = await recordDetail(db(), projectId, state.featureCode);
    const source = (before.tasks ?? []).find((t) => t.covers.length > 1);
    expect(source).toBeTruthy();
    const moved = source!.covers[source!.covers.length - 1]!;
    await cmd('message.post', {
      exploration_id: state.featureThread,
      text: `Move ${moved} out of ${source!.code} into a task built later. MOVE_TEST`,
      respond: false,
    });
    const run = await draftRun('task_plan', {
      type: 'record_version',
      id: state.featureVersion,
    });
    expect(run.error).toBeNull();
    expect(run.state).toBe('completed');
    const pack = await db()
      .selectFrom('context_packs')
      .select('content')
      .where('id', '=', run.context_pack_id ?? '')
      .executeTakeFirstOrThrow();
    expect(JSON.stringify((pack.content as { request: unknown }).request)).toContain('MOVE_TEST');
    const proposals = await proposalsOf(run.id);
    expect(proposals.map((p) => p.type)).toEqual(['design_record', 'record_change']);
    expect((proposals[0]!.payload as Payload).covers).toEqual([moved]);
    expect(proposals[1]!.payload).toMatchObject({
      record: { code: source!.code },
      covers: source!.covers.slice(0, -1),
    });
    for (const p of proposals) await cmd('proposal.accept', { approve: true }, p.id);
    const after = await recordDetail(db(), projectId, state.featureCode);
    expect(after.tasks?.find((t) => t.code === source!.code)?.covers).toEqual(source!.covers.slice(0, -1));
    expect(after.tasks?.filter((t) => t.covers.includes(moved))).toHaveLength(1);
    expect(after.uncovered).toEqual([]);
  });

  it('withoutDuplicateCoverage drops criteria another task covers, keeps the ones the request names and drops emptied tasks', () => {
    const tasks = [
      { title: 'A', covers: ['AC-X-001-01', 'AC-X-001-02'] },
      { title: 'B', covers: ['AC-X-001-02'] },
      { title: 'C', covers: ['AC-X-001-03', 'AC-X-001-01'] },
    ];
    const kept = withoutDuplicateCoverage(tasks, new Set(['AC-X-001-01']), new Set());
    expect(kept.map((k) => [k.from, k.task.covers])).toEqual([
      [1, ['AC-X-001-02']],
      [3, ['AC-X-001-03']],
    ]);
    const asked = withoutDuplicateCoverage(tasks, new Set(['AC-X-001-01']), new Set(['AC-X-001-01']));
    expect(asked.map((k) => k.task.covers)).toEqual([
      ['AC-X-001-01', 'AC-X-001-02'],
      ['AC-X-001-03', 'AC-X-001-01'],
    ]);
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
    const run = await draftRun('feature_design', {
      type: 'exploration',
      id: thread,
    });
    expect(run.state).toBe('failed');
    expect(await proposalsOf(run.id)).toHaveLength(0);
    expect(run.failure_kind).toBe('invalid_output');
    expect(run.error).toMatch(/2 steps/);
  });

  it('the task_plan checker refuses a waited feature that is unknown, is its own feature or already waits for this one', async () => {
    const plan = async (waits: string) => {
      await cmd('message.post', {
        exploration_id: state.featureThread,
        text: `Plan it again. WAITS_TEST:${waits}`,
        respond: false,
      });
      return draftRun('task_plan', { type: 'record_version', id: state.featureVersion });
    };
    const unknown = await plan('FDR-ZZZ-999');
    expect(unknown.state).toBe('failed');
    expect(unknown.error).toMatch(/FDR-ZZZ-999, which is not a feature of the project/);
    const own = await plan(state.featureCode);
    expect(own.state).toBe('failed');
    expect(own.error).toMatch(/its own feature/);

    // Another feature whose task already waits for this one: waiting for it back is a cycle.
    const other = await cmd('record.create', {
      type: 'fdr',
      domain: 'cycle',
      title: 'Other feature',
      sections: [
        { title: 'Goal', content: 'Do it.' },
        { title: 'Scope', content: 'Just that.' },
        { title: 'Out of scope', content: 'Nothing else.' },
        { title: 'Behavior', content: 'The person does it.' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'a',
          statement: 'Given a person, when she acts, then she sees it.',
          verification: 'automatic',
          check: 'E2E.',
        },
      ],
      links: [],
    });
    const o = other.result as { versionId: string; code: string };
    await cmd('record_version.approve', {}, o.versionId);
    const waiting = await cmd('record.create', {
      type: 'task',
      domain: 'cycle',
      title: 'Waits for the feature under test',
      sections: [
        { title: 'Goal', content: 'Do it.' },
        { title: 'Scope', content: 'Just that.' },
      ],
      size: 'S',
      criteria: [],
      links: [
        { type: 'based_on', target: { code: o.code, version: 1 } },
        { type: 'depends_on', target: { code: state.featureCode, version: 1 } },
      ],
    });
    await cmd('record_version.approve', {}, (waiting.result as { versionId: string }).versionId);
    const cycle = await plan(o.code);
    expect(cycle.state).toBe('failed');
    expect(cycle.error).toMatch(/dependency cycle/);
  });

  it('accepting a plan whose task waits for a feature links it to that feature, and the task is not ready until it is built', async () => {
    const made = await cmd('record.create', {
      type: 'fdr',
      domain: 'wait',
      title: 'Feature to wait for',
      sections: [
        { title: 'Goal', content: 'Do it.' },
        { title: 'Scope', content: 'Just that.' },
        { title: 'Out of scope', content: 'Nothing else.' },
        { title: 'Behavior', content: 'The person does it.' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'a',
          statement: 'Given a person, when she acts, then she sees it.',
          verification: 'automatic',
          check: 'E2E.',
        },
      ],
      links: [],
    });
    const w = made.result as { versionId: string; code: string };
    await cmd('record_version.approve', {}, w.versionId);
    const feature = await recordDetail(db(), projectId, state.featureCode);
    const criterion = feature.versions.find((v) => v.current)?.criteria[0]?.code ?? '';
    await cmd('message.post', {
      exploration_id: state.featureThread,
      text: `Cover ${criterion} once more, in a task that waits. WAITS_TEST:${w.code}`,
      respond: false,
    });
    const run = await draftRun('task_plan', { type: 'record_version', id: state.featureVersion });
    expect(run.error).toBeNull();
    const proposals = await proposalsOf(run.id);
    expect(proposals[0]!.payload).toMatchObject({ waits_for_features: [w.code] });
    const accepted = (await cmd('proposal.accept', { approve: true }, proposals[0]!.id)).result as Created;
    const link = await db()
      .selectFrom('links')
      .innerJoin('record_versions', 'record_versions.id', 'links.to_id')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['records.code', 'record_versions.n'])
      .where('links.from_id', '=', accepted.versionId)
      .where('links.type', '=', 'depends_on')
      .execute();
    expect(link).toEqual([{ code: w.code, n: 1 }]);
    const reasons = (await versionReadiness(db(), projectId, accepted.versionId)).reasons;
    expect(reasons).toContain(`Waits for ${w.code} Feature to wait for (not built yet).`);
  });
});
