// "Explain it simply" (the explainer agent): a conversation agent whose only output is its reply.
// Explaining a question leaves the explanation in the question's side conversation and nothing
// else: whatever else it returns (inferences, options, questions, proposals) is never applied.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAgentCatalog } from '../src/agents/catalog.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ durable: true });
const ana = human('ana');
let projectId = '';
let thread = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown) => executeCommand(environment().services, { command, actor: ana, projectId, data });

const questions = () =>
  environment()
    .services.db.selectFrom('questions')
    .select(['id', 'stage_key', 'state', 'conclusion', 'options', 'evidence'])
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Club trips' } })).projectId;
  // The first thread opens the product definition stage, with its eight questions still pending.
  thread = (await cmd('exploration.open', { purpose: 'An app for our club trips' })).entityId;
});

describe('explain it simply', () => {
  it('the explainer is a reply-only conversation agent of Deep thinking; the other agents carry no such mark', async () => {
    const catalog = await loadAgentCatalog();
    expect(catalog.get('explainer')).toMatchObject({
      action: 'exploration_chat',
      group: 'deep',
      session: 'none',
      replyOnly: true,
    });
    expect(catalog.get('explorer')).not.toHaveProperty('replyOnly');
  });

  it('explaining a question leaves the explanation in its side conversation and changes nothing else', async () => {
    const s = environment().services;
    // An idea the simulation reads answers from ([infer]), and questions it would give options to.
    await cmd('message.post', {
      exploration_id: thread,
      text: 'Members sign up for club trips and organizers see who is coming. [infer]',
      respond: false,
    });
    const before = await questions();
    const purpose = before.find((q) => q.stage_key === 'purpose');
    if (!purpose) throw new Error('No purpose question.');

    const r = await cmd('run.request', {
      action: 'exploration_chat',
      agent: 'explainer',
      scope: { type: 'exploration', id: thread },
      input: { question_id: purpose.id },
    });
    await waitForRun(r.entityId);
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
    expect(run).toMatchObject({ state: 'completed', agent: 'explainer' });
    // The simulation answered with inferences and options too: none of them was applied.
    const output = run.output as { inferences: unknown[]; question_options: unknown[] };
    expect(output.inferences.length).toBeGreaterThan(0);
    expect(output.question_options.length).toBeGreaterThan(0);
    expect(await questions()).toEqual(before);

    // Only its reply, in the question's side conversation.
    const written = await s.db.selectFrom('messages').select(['question_id', 'kind']).where('run_id', '=', r.entityId).execute();
    expect(written).toEqual([{ question_id: purpose.id, kind: null }]);
    const batches = await s.db.selectFrom('proposal_batches').select('id').where('run_id', '=', r.entityId).execute();
    expect(batches).toEqual([]);
    const after = await s.db.selectFrom('explorations').select('purpose').where('id', '=', thread).executeTakeFirstOrThrow();
    expect(after.purpose).toBe('An app for our club trips');
  });
});
