// Retry with the same context pack (I7) and provenance of a run's batches.

import { waitForRun } from '@demiurgo/core';
import { createSimulatedAgent } from '../../core/src/agents/simulated.ts';
import { DEFAULT_SCRIPTS } from '../../core/src/agents/simulated.ts';
import { describe, expect, it } from 'vitest';
import { useApi } from './support/api.ts';

// The first invocation of each pack returns an invalid output; the following ones, the normal one.
const seen = new Set<string>();
const api = useApi({
  durable: true,
  agent: () =>
    createSimulatedAgent({
      scripts: {
        exploration_chat: (p) => {
          if (!seen.has(p.context.hash)) {
            seen.add(p.context.hash);
            return { reply: 7 };
          }
          return DEFAULT_SCRIPTS.exploration_chat(p);
        },
      },
    }),
});

async function command(projectId: string, name: string, data: unknown, entityId?: string) {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${name}`, {
    ...(entityId ? { entity_id: entityId } : {}),
    data,
  });
  if (r.statusCode !== 200) throw new Error(`${name}: ${r.body}`);
  return r.json<{ entity_id: string; result: Record<string, unknown> }>();
}

describe('retry', () => {
  it("AC-DIS-001-07 the retry's context pack matches the submission's (same hash)", async () => {
    const projectId = (await api().person.request('POST', '/api/projects', { name: 'Retry' })).json<{
      project_id: string;
    }>().project_id;
    const e = await command(projectId, 'exploration.open', { purpose: 'Membership dues' });
    await command(projectId, 'message.post', { exploration_id: e.entity_id, text: 'I want annual dues', respond: false });
    const submission = await command(projectId, 'run.request', {
      action: 'exploration_chat',
      scope: { type: 'exploration', id: e.entity_id },
    });
    expect(await waitForRun(submission.entity_id)).toBe('failed');
    const failed = (await api().person.request('GET', `/api/projects/${projectId}/runs/${submission.entity_id}`)).json<{
      failure_kind: string;
      context_pack: { hash: string };
    }>();
    expect(failed.failure_kind).toBe('invalid_output');

    // Meanwhile the conversation changes: the retry does not rebuild the context.
    await command(projectId, 'message.post', { exploration_id: e.entity_id, text: 'Better monthly', respond: false });
    const retry = await command(projectId, 'run.retry', { run_id: submission.entity_id });
    expect(await waitForRun(retry.entity_id)).toBe('completed');
    const second = (await api().person.request('GET', `/api/projects/${projectId}/runs/${retry.entity_id}`)).json<{
      retry_of: string;
      context_pack: { hash: string };
    }>();
    expect(second.retry_of).toBe(submission.entity_id);
    expect(second.context_pack.hash).toBe(failed.context_pack.hash);

    // Provenance: the run's batch keeps its run and its context pack.
    const batches = await api()
      .environment.services.db.selectFrom('proposal_batches')
      .selectAll()
      .where('project_id', '=', projectId)
      .execute();
    expect(batches).toHaveLength(1);
    const run = await api()
      .environment.services.db.selectFrom('ai_runs')
      .select('context_pack_id')
      .where('id', '=', retry.entity_id)
      .executeTakeFirstOrThrow();
    expect(batches[0]).toMatchObject({
      run_id: retry.entity_id,
      context_pack_id: run.context_pack_id,
      producer: `agent:run:${retry.entity_id}`,
    });
  });

  it('AC-DIS-001-20 every batch from a run keeps the run and the context pack that produced it', async () => {
    const batches = await api()
      .environment.services.db.selectFrom('proposal_batches')
      .select(['run_id', 'context_pack_id', 'producer'])
      .execute();
    expect(batches.length).toBeGreaterThan(0);
    for (const l of batches) {
      expect(l.run_id).not.toBeNull();
      expect(l.context_pack_id).not.toBeNull();
      expect(l.producer).toBe(`agent:run:${l.run_id}`);
    }
  });
});
