// The screen designer end to end with the simulated provider: a feature thread offers its screens only
// once the project has an approved design system, screen_design submits one valid screen_design
// proposal that uses only the system's components, and the checker stops a component that the system
// does not have and a state with a script.

import { human, missingComponents, screenDesignProblems, type ScreenDesignSpec } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SCRIPTS, createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { explorationDetail } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';

// What the next screen_design run does wrong, if anything.
let mode: 'ok' | 'unknown_component' | 'script' = 'ok';

const environment = useEnvironment({
  durable: true,
  providers: () => [
    createSimulatedProvider({
      scripts: {
        // In a design-system thread the explorer says it has the principles.
        exploration_chat: (p) => ({
          ...(DEFAULT_SCRIPTS.exploration_chat(p) as object),
          ready_to_draft: { kind: 'design_directions', why: 'The principles are answered.' },
        }),
        screen_design: (p) => {
          const out = DEFAULT_SCRIPTS.screen_design(p) as { result: { spec: ScreenDesignSpec } };
          const screen = out.result.spec.screens[0]!;
          if (mode === 'unknown_component') screen.components = [...screen.components, 'HologramPicker'];
          if (mode === 'script') screen.states.data = `${screen.states.data}<script>alert(1)</script>`;
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
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Screens' } })).projectId;
});

async function run(action: string, scope: { type: string; id: string }) {
  await waitForKnowledge(environment().services, projectId, 15_000);
  const r = await cmd('run.request', { action, scope });
  await waitForRun(r.entityId);
  return db().selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
}

async function proposalsOf(runId: string) {
  return db()
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id', 'proposals.type', 'proposals.state', 'proposals.payload'])
    .where('proposal_batches.run_id', '=', runId)
    .execute();
}

type Created = { recordId: string; versionId: string; code: string; version: number };
const state: { thread: string; featureVersion: string } = { thread: '', featureVersion: '' };

/** Accepts the only proposal of the last completed run of an action and approves the version it creates. */
async function acceptAndApprove(action: string): Promise<Created> {
  const r = await db().selectFrom('ai_runs').select('id').where('action', '=', action).where('project_id', '=', projectId).executeTakeFirstOrThrow();
  const [p] = await proposalsOf(r.id);
  const created = (await cmd('proposal.accept', { approve: false }, p?.id)).result as Created;
  await cmd('record_version.approve', {}, created.versionId);
  return created;
}

describe('the screen designer', () => {
  it('a feature thread offers tasks while the project has no approved design system', async () => {
    const epicThread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
    await cmd('message.post', { exploration_id: epicThread, text: 'People should share recipes end to end.', respond: false });
    expect((await run('epic_plan', { type: 'exploration', id: epicThread })).state).toBe('completed');
    const epic = await acceptAndApprove('epic_plan');
    const first = await db().selectFrom('planned_features').select(['code', 'name']).where('project_id', '=', projectId).orderBy('position').executeTakeFirstOrThrow();
    state.thread = (
      await cmd('exploration.open', {
        purpose: `Design "${first.name}" (${first.code}, ${epic.code}): Walk the whole thing`,
        parent_id: epicThread,
        origin: { type: 'record_version', id: epic.versionId },
      })
    ).entityId;
    expect((await run('feature_design', { type: 'exploration', id: state.thread })).state).toBe('completed');
    state.featureVersion = (await acceptAndApprove('feature_design')).versionId;
    expect((await explorationDetail(db(), projectId, state.thread)).draft).toMatchObject({ kind: 'tasks', action: 'task_plan' });
    await waitForKnowledge(environment().services, projectId, 15_000);
    await expect(cmd('run.request', { action: 'screen_design', scope: { type: 'record_version', id: state.featureVersion } })).rejects.toThrow(
      /design system/i,
    );
  });

  it('with an approved design system, the approved feature offers its screens instead of its tasks', async () => {
    const dsThread = (await cmd('exploration.open', { purpose: 'Design system: start from Carbon' })).entityId;
    await cmd('message.post', { exploration_id: dsThread, text: 'Design system: start from Carbon', respond: false });
    expect((await run('design_directions', { type: 'exploration', id: dsThread })).state).toBe('completed');
    await cmd('message.post', { exploration_id: dsThread, text: 'I choose direction: Calm', respond: false });
    expect((await run('design_system_plan', { type: 'exploration', id: dsThread })).state).toBe('completed');
    await acceptAndApprove('design_system_plan');
    expect((await explorationDetail(db(), projectId, state.thread)).draft).toMatchObject({
      kind: 'screens',
      action: 'screen_design',
      scope: { type: 'record_version', id: state.featureVersion },
    });
  });

  it('screen_design submits one valid screen_design proposal that uses only design system components', async () => {
    mode = 'ok';
    const r = await run('screen_design', { type: 'record_version', id: state.featureVersion });
    expect(r.state).toBe('completed');
    const proposals = await proposalsOf(r.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ type: 'screen_design', state: 'pending' });
    const payload = proposals[0]?.payload as { spec: ScreenDesignSpec; sections: Record<string, string> };
    const dsy = await db()
      .selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select('record_versions.spec')
      .where('records.type', '=', 'design_system')
      .where('records.project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    const names = (dsy.spec as { components: { name: string }[] }).components.map((c) => c.name);
    expect(missingComponents(payload.spec, names)).toEqual([]);
    expect(payload.spec.screens.length).toBeGreaterThan(0);
    const steps = (await db().selectFrom('record_versions').select('sections').where('id', '=', state.featureVersion).executeTakeFirstOrThrow())
      .sections as { title: string; content: string }[];
    const behavior = steps.find((s) => s.title === 'Behavior')?.content ?? '';
    expect(screenDesignProblems(payload.spec, behavior.split('\n').filter((l) => /^\d+\. /.test(l)).length)).toEqual([]);
    expect(Object.keys(payload.sections).sort()).toEqual(['Components', 'Flow', 'Screens', 'States']);
  });

  it('the checker rejects a component that is not in the design system, and nothing is stored', async () => {
    mode = 'unknown_component';
    const r = await run('screen_design', { type: 'record_version', id: state.featureVersion });
    expect(r.state).not.toBe('completed');
    expect(r.output ?? null).toBeNull();
  });

  it('the checker rejects a state with a script, and nothing is stored', async () => {
    mode = 'script';
    const r = await run('screen_design', { type: 'record_version', id: state.featureVersion });
    expect(r.state).not.toBe('completed');
    expect(r.output ?? null).toBeNull();
  });
});
