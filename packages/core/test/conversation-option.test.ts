// The answer a side conversation leads to (Go deeper): each run that answers the person there also
// words the idea they arrived at as one more option of the question, kept apart from its predefined
// options and replaced by the next one. It is kept for open questions only (pending or inferred), and
// neither a run of the main thread nor the explainer sets it.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ durable: true });
const ana = human('ana');
let projectId = '';
let thread = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown) => executeCommand(environment().services, { command, actor: ana, projectId, data });

const question = (key: string) =>
  environment()
    .services.db.selectFrom('questions')
    .select(['id', 'state', 'options', 'conversation_option'])
    .where('project_id', '=', projectId)
    .where('stage_key', '=', key)
    .executeTakeFirstOrThrow();

async function talk(questionId: string | null, text: string, agent?: string) {
  const s = environment().services;
  if (agent) {
    const r = await cmd('run.request', {
      action: 'exploration_chat',
      agent,
      scope: { type: 'exploration', id: thread },
      input: { question_id: questionId },
    });
    await waitForRun(r.entityId);
    return;
  }
  const posted = await cmd('message.post', {
    exploration_id: thread,
    ...(questionId ? { question_id: questionId } : {}),
    text,
    respond: true,
  });
  // The run that answers it has ended.
  for (let i = 0; i < 400; i++) {
    const m = await s.db.selectFrom('messages').select('response_run').where('id', '=', posted.entityId).executeTakeFirst();
    if (m?.response_run) {
      const r = await s.db.selectFrom('ai_runs').select('id').where('id', '=', m.response_run).executeTakeFirstOrThrow();
      await waitForRun(r.id);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('The run did not end.');
}

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Club trips' } })).projectId;
  thread = (await cmd('exploration.open', { purpose: 'An app for our club trips' })).entityId;
  // The idea answers six questions of the product definition ([infer]); two stay pending.
  await talk(null, 'Members sign up for club trips and organizers see who is coming. They pay at the door. [infer]');
});

describe('the answer a side conversation leads to', () => {
  it('is kept as one more option of an inferred question, beside its options, and the next one replaces it', async () => {
    const before = await question('stakeholders');
    expect(before.state).toBe('inferred');
    expect(before.conversation_option).toBeNull();

    await talk(before.id, 'Guests can come too, invited by a member.');
    const after = await question('stakeholders');
    expect(after.state).toBe('inferred');
    expect(after.options).toEqual(before.options);
    expect(after.conversation_option).toEqual({
      answer: 'From our talk: Guests can come too, invited by a member.',
      implies: 'It is what the side conversation arrived at.',
    });

    await talk(before.id, 'Only members, in the end.');
    expect((await question('stakeholders')).conversation_option).toMatchObject({
      answer: 'From our talk: Only members, in the end.',
    });
  });

  it('is kept for a pending question too', async () => {
    const pending = await question('constraints');
    expect(pending.state).toBe('pending');
    await talk(pending.id, 'It has to work on phones.');
    expect((await question('constraints')).conversation_option).toMatchObject({
      answer: 'From our talk: It has to work on phones.',
    });
  });

  it('is not set by a run of the main thread, nor by the explainer', async () => {
    const purpose = await question('purpose');
    await talk(null, 'Organizers also want a reminder the day before.');
    await talk(purpose.id, '', 'explainer');
    expect((await question('purpose')).conversation_option).toBeNull();
  });
});
