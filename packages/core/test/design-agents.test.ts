// The design-system agents end to end with the simulated provider: a design-system thread offers
// visual directions once its explorer says it is ready, design_directions stores them in the run (it
// proposes nothing), and after the person chooses one design_system_plan submits one design_system
// proposal. A style tile with a script is stopped by the checker.

import { designSystemProblems, human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SCRIPTS, createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { explorationDetail } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';

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
        // A tile with a script, whenever the thread says so.
        design_directions: (p) => {
          const out = DEFAULT_SCRIPTS.design_directions(p) as { directions: { tile_html: string }[] };
          if (JSON.stringify(p.context.content).includes('Script tile'))
            out.directions[0]!.tile_html = `${out.directions[0]!.tile_html}<script>alert(1)</script>`;
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
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Design agents' } }))
    .projectId;
});

async function run(action: string, threadId: string) {
  const r = await cmd('run.request', { action, scope: { type: 'exploration', id: threadId } });
  await waitForRun(r.entityId);
  return db().selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
}

const state: { thread: string } = { thread: '' };

describe('the design-system agents', () => {
  it('a design-system thread offers visual directions once its explorer says it is ready', async () => {
    state.thread = (await cmd('exploration.open', { purpose: 'Design system: start from Carbon' })).entityId;
    await cmd('message.post', { exploration_id: state.thread, text: 'Design system: start from Carbon', respond: false });
    expect((await explorationDetail(db(), projectId, state.thread)).draft).toBeNull();
    const chat = await run('exploration_chat', state.thread);
    expect(chat.state).toBe('completed');
    const detail = await explorationDetail(db(), projectId, state.thread);
    expect(detail.draft).toMatchObject({ kind: 'design_directions', action: 'design_directions', suggested: true });
  });

  it('design_directions stores two directions in the run and proposes nothing', async () => {
    const r = await run('design_directions', state.thread);
    expect(r.state).toBe('completed');
    const output = r.output as { directions: { name: string; tile_html: string }[] };
    expect(output.directions.map((d) => d.name)).toEqual(['Calm', 'Bold']);
    for (const d of output.directions) {
      expect(d.tile_html).not.toMatch(/<script/i);
      expect(d.tile_html).not.toMatch(/https?:/i);
    }
    const batches = await db().selectFrom('proposal_batches').select('id').where('run_id', '=', r.id).execute();
    expect(batches).toHaveLength(0);
  });

  it('the system is not drafted before a direction is chosen', async () => {
    await expect(cmd('run.request', { action: 'design_system_plan', scope: { type: 'exploration', id: state.thread } })).rejects.toThrow(
      /direction/i,
    );
  });

  it('after "I choose direction" the thread offers the design system, and design_system_plan submits one valid proposal', async () => {
    await cmd('message.post', { exploration_id: state.thread, text: 'I choose direction: Bold', respond: false });
    const detail = await explorationDetail(db(), projectId, state.thread);
    expect(detail.draft).toMatchObject({ kind: 'design_system', action: 'design_system_plan' });
    const r = await run('design_system_plan', state.thread);
    expect(r.state).toBe('completed');
    const proposals = await db()
      .selectFrom('proposals')
      .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
      .select(['proposals.type', 'proposals.state', 'proposals.payload'])
      .where('proposal_batches.run_id', '=', r.id)
      .execute();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ type: 'design_system', state: 'pending' });
    const payload = proposals[0]?.payload as { spec: Parameters<typeof designSystemProblems>[0]; sections: Record<string, string> };
    expect(designSystemProblems(payload.spec)).toEqual([]);
    expect(payload.spec.components).toHaveLength(12);
    expect(payload.spec.base).toMatchObject({ kind: 'public', name: 'Carbon', license: 'Apache-2.0' });
    expect(Object.keys(payload.sections)).toHaveLength(8);
  });

  it('the checker rejects a style tile with a script, and nothing is stored', async () => {
    const thread = (await cmd('exploration.open', { purpose: 'Design system: from scratch' })).entityId;
    await cmd('message.post', { exploration_id: thread, text: 'Script tile please', respond: false });
    const r = await run('design_directions', thread);
    expect(r.state).not.toBe('completed');
    expect(r.output ?? null).toBeNull();
  });
});
