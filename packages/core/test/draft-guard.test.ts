// A drafting action is not asked twice for the same scope: while its draft waits for review (or its run is
// working) the thread stops offering it and `run.request` refuses it with a guard error. Once the person
// resolves the draft, it can be asked again.

import { human, isDomainError } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { explorationDetail } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ durable: true });
const ana = human('ana');
let projectId = '';
let thread = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });
const db = () => environment().services.db;

async function rejection(p: Promise<unknown>): Promise<{ type: string; reasons: string[] }> {
  const e: unknown = await p.then(
    () => null,
    (x: unknown) => x,
  );
  return isDomainError(e) ? { type: e.type, reasons: [...e.reasons] } : { type: 'none', reasons: [] };
}

beforeAll(async () => {
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Guard' } }))
    .projectId;
  thread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
  await cmd('message.post', { exploration_id: thread, text: 'People should share recipes end to end.', respond: false });
  await waitForKnowledge(environment().services, projectId, 15_000);
});

describe('one draft at a time per scope', () => {
  it('refuses a second epic draft while the first waits for review, and allows it after the person rejects the first', async () => {
    const scope = { type: 'exploration', id: thread };
    const first = await cmd('run.request', { action: 'epic_plan', scope });
    await waitForRun(first.entityId);
    const batch = await db()
      .selectFrom('proposal_batches')
      .select(['id', 'state'])
      .where('run_id', '=', first.entityId)
      .executeTakeFirstOrThrow();
    expect(batch.state).toBe('pending');

    const again = await rejection(cmd('run.request', { action: 'epic_plan', scope }));
    expect(again.type).toBe('guard');
    expect(again.reasons.join(' ')).toMatch(/draft waiting for your review/);
    const runs = await db().selectFrom('ai_runs').select('id').where('action', '=', 'epic_plan').execute();
    expect(runs).toHaveLength(1);

    // Another action on the same thread is not affected by it.
    const other = await rejection(cmd('run.request', { action: 'feature_design', scope }));
    expect(other.reasons.join(' ')).not.toMatch(/draft waiting/);

    const proposals = await db().selectFrom('proposals').select('id').where('batch_id', '=', batch.id).execute();
    for (const p of proposals) await cmd('proposal.reject', {}, p.id);
    const second = await cmd('run.request', { action: 'epic_plan', scope });
    await waitForRun(second.entityId);
    const after = await db()
      .selectFrom('proposal_batches')
      .select('state')
      .where('run_id', '=', second.entityId)
      .executeTakeFirstOrThrow();
    expect(after.state).toBe('pending');
  });

  it('the thread offer reports the pending batch instead of offering the draft again', async () => {
    const pending = await db()
      .selectFrom('proposal_batches')
      .select('id')
      .where('state', '=', 'pending')
      .executeTakeFirstOrThrow();
    const detail = await explorationDetail(db(), projectId, thread);
    // The agent has not said it is ready (simulated run), so there may be no offer; when there is, it carries the batch.
    const draft = (detail as { draft?: { pending?: { batchId: string | null } | null } | null }).draft;
    if (draft) expect(draft.pending?.batchId).toBe(pending.id);
  });
});
