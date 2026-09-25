// The durable answer to a message gives up when knowledge stays out of date past its patience: the
// message says so (abandoned) with its event, so the web can offer to ask again.

import { human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const ana = human('ana');
const environment = useEnvironment({ durable: true, engineOptions: { responsePatienceMs: 1500 } });

async function eventually(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

describe('abandoned answer', () => {
  it('knowledge that stays out of date past the patience leaves the message abandoned, with its event and no run', async () => {
    const s = environment().services;
    const projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Stuck' } })).projectId;
    const thread = (await executeCommand(s, { command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Stuck' } }))
      .entityId;
    await sql`
      insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${projectId}::uuid, '{"type":"test"}'::jsonb, 0, 'classifying')`.execute(s.db);
    const posted = await executeCommand(s, {
      command: 'message.post',
      actor: ana,
      projectId,
      data: { exploration_id: thread, text: 'Anyone there?', respond: true },
    });
    const response = async () =>
      (await sql<{ response: string | null }>`select response from messages where id = ${posted.entityId}::uuid`.execute(s.db))
        .rows[0]?.response;
    expect(await eventually(async () => (await response()) === 'abandoned', 15_000)).toBe(true);
    const { rows } = await sql<{ actor: string }>`
      select actor from events where command = 'message.abandon_response' and entity_id = ${posted.entityId}::uuid`.execute(s.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor.startsWith('system:')).toBe(true);
    const { rows: runs } = await sql<{
      n: number;
    }>`select count(*)::int as n from ai_runs where scope->>'id' = ${thread}`.execute(s.db);
    expect(runs[0]?.n).toBe(0);
  });
});
