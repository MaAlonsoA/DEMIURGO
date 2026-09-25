// The durable answer to a person's message (FDR-AGE-002): it is requested once the project's
// knowledge is up to date, and knowledge that goes stale again right before the request makes it
// wait again instead of dropping the answer.

import { human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const ana = human('ana');
let makeStale: (() => Promise<void>) | null = null;

const environment = useEnvironment({
  durable: true,
  engineOptions: {
    // Right after the wait for fresh knowledge: another update starts before the request.
    onStepComplete: async (step) => {
      if (step !== 'freshness' || !makeStale) return;
      const stale = makeStale;
      makeStale = null;
      await stale();
    },
  },
});

async function runsOf(explorationId: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from ai_runs where scope->>'id' = ${explorationId}`.execute(environment().services.db);
  return rows[0]?.n ?? 0;
}

async function eventually(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

describe('durable answer to a message', () => {
  it('AC-AGE-002-03 knowledge that goes stale right before the request makes the answer wait, not disappear', async () => {
    const s = environment().services;
    const projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Answers' } })).projectId;
    const thread = (await executeCommand(s, { command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Recipes' } }))
      .entityId;
    let pending = '';
    makeStale = async () => {
      const { rows } = await sql<{ id: string }>`
        insert into knowledge_updates (project_id, trigger, trigger_seq, state)
        values (${projectId}::uuid, '{"type":"test"}'::jsonb, 0, 'classifying') returning id`.execute(s.db);
      pending = rows[0]?.id ?? '';
    };

    await executeCommand(s, {
      command: 'message.post',
      actor: ana,
      projectId,
      data: { exploration_id: thread, text: 'Who pays for this?', respond: true },
    });
    // While that update is in flight, nothing is requested.
    expect(await eventually(async () => pending !== '', 10_000)).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await runsOf(thread)).toBe(0);

    // Once it finishes, the answer is requested.
    await sql`update knowledge_updates set state = 'applied', finished_at = now() where id = ${pending}::uuid`.execute(s.db);
    expect(await eventually(async () => (await runsOf(thread)) === 1, 10_000)).toBe(true);
  });
});
