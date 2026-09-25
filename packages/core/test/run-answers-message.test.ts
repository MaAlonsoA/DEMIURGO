// A run that answers a message links to it (message.response_run). Only the durable response
// links a message still waiting; a person links only an abandoned message of the same thread, when
// they ask again. The link is in the run's event.

import { human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
let projectId = '';

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Answers' } })).projectId;
});

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data });

async function thread(purpose: string): Promise<string> {
  return (await cmd('exploration.open', { purpose })).entityId;
}

async function messageIn(exploration: string, response: string | null): Promise<string> {
  const id = (await cmd('message.post', { exploration_id: exploration, text: 'Anyone there?' })).entityId;
  await sql`update messages set response = ${response} where id = ${id}::uuid`.execute(environment().services.db);
  return id;
}

const ask = (exploration: string, message: string) =>
  cmd('run.request', {
    action: 'exploration_chat',
    scope: { type: 'exploration', id: exploration },
    answers_message: message,
  });

async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { type: string }).type;
  }
  throw new Error('The command was accepted.');
}

describe('a run that answers a message', () => {
  it('a person asking again links the abandoned message of the thread, and the event says so', async () => {
    const t = await thread('Asking again');
    const m = await messageIn(t, 'abandoned');
    const r = await ask(t, m);
    const row = await environment()
      .services.db.selectFrom('messages')
      .select(['response', 'response_run'])
      .where('id', '=', m)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ response: 'requested', response_run: r.entityId });
    const { rows } = await sql<{ after: { answers_message?: string } }>`
      select after from events where command = 'run.request' and entity_id = ${r.entityId}::uuid`.execute(
      environment().services.db,
    );
    expect(rows[0]?.after.answers_message).toBe(m);
  });

  it('a person cannot link a message DEMIURGO is still waiting to answer, or already answered', async () => {
    const t = await thread('Still waiting');
    expect(await rejection(ask(t, await messageIn(t, 'waiting')))).toBe('validation');
    expect(await rejection(ask(t, await messageIn(t, 'requested')))).toBe('validation');
    expect(await rejection(ask(t, await messageIn(t, null)))).toBe('validation');
  });

  it('the message must belong to the thread the run reads', async () => {
    const other = await thread('Another thread');
    const m = await messageIn(other, 'abandoned');
    expect(await rejection(ask(await thread('This thread'), m))).toBe('validation');
  });
});
