// S1 walkthrough through the API with simulated agents and the durable engine: from intent to
// "ready to build", with an empty inbox at the end.

import { waitForKnowledge, waitForRun } from '@demiurgo/core';
import { describe, expect, it } from 'vitest';
import { useApi } from './support/api.ts';

const api = useApi({ durable: true });

type Response = { entity_id: string; state: string; result: Record<string, unknown> | null };

async function command(projectId: string, name: string, data: unknown, entityId?: string): Promise<Response> {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${name}`, {
    ...(entityId ? { entity_id: entityId } : {}),
    data,
  });
  if (r.statusCode !== 200) throw new Error(`${name}: ${r.statusCode} ${r.body}`);
  return r.json<Response>();
}

async function read<T>(url: string): Promise<T> {
  const r = await api().person.request('GET', url);
  if (r.statusCode !== 200) throw new Error(`${url}: ${r.statusCode} ${r.body}`);
  return r.json<T>();
}

/** Waits for the project's runs to finish (the reply to the message arrives after committing). */
async function waitForRuns(projectId: string, minimum: number): Promise<string[]> {
  const db = api().environment.services.db;
  for (let i = 0; i < 200; i++) {
    const runs = await db.selectFrom('ai_runs').select(['id', 'state']).where('project_id', '=', projectId).execute();
    if (runs.length >= minimum) {
      for (const r of runs) await waitForRun(r.id);
      return runs.map((r) => r.id);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The expected runs did not arrive.');
}

type Inbox = {
  total: number;
  batches: {
    id: string;
    type: string;
    producer: string;
    resolution: string;
    proposals: { id: string; type: string; epistemic_status: string }[];
  }[];
};

describe('S1 walkthrough', () => {
  it('AC-DIS-001-01 AC-DIS-001-20 intent → accepted and approved decision → FDR with 2 AC → "ready to build" and an empty inbox', async () => {
    const { person, environment } = api();
    const p = await person.request('POST', '/api/projects', { name: 'Association' });
    const projectId = p.json<{ project_id: string }>().project_id;

    // 1. Intent: an exploration and a message from the person. The exploration agent replies.
    const exploration = await command(projectId, 'exploration.open', { purpose: 'Manage the members of an association' });
    await command(projectId, 'message.post', {
      exploration_id: exploration.entity_id,
      text: 'Quiero que cada socio pueda darse de alta con su nombre y su correo',
    });
    const [runChat] = await waitForRuns(projectId, 1);

    // 2. The inbox has a batch from the agent with a decision proposal, visible as a proposal.
    let inbox = await read<Inbox>(`/api/projects/${projectId}/inbox`);
    expect(inbox.total).toBe(1);
    const batch = inbox.batches[0];
    expect(batch).toMatchObject({ type: 'agent', resolution: 'item', producer: `agent:run:${runChat}` });
    expect(batch?.proposals[0]).toMatchObject({ type: 'decision', epistemic_status: 'proposed' });

    // 3. "Accept and approve" the decision (a human action).
    const accepted = await command(projectId, 'proposal.accept', { approve: true }, batch?.proposals[0]?.id);
    const decision = accepted.result as { code: string; versionId: string };
    expect(decision.code).toMatch(/^DEC-PRO-\d{3}$/);

    // 4. Design proposal on the approved decision: a package with the FDR and its 2 AC.
    // The freshness gate requires the knowledge to have already projected the approval.
    await waitForKnowledge(environment.services, projectId);
    await command(projectId, 'run.request', {
      action: 'design_proposal',
      scope: { type: 'record_version', id: decision.versionId },
    });
    await waitForRuns(projectId, 2);
    inbox = await read<Inbox>(`/api/projects/${projectId}/inbox`);
    const packageBatch = inbox.batches.find((l) => l.type === 'system_package');
    expect(packageBatch).toMatchObject({ resolution: 'package' });
    expect(packageBatch?.proposals).toHaveLength(1);
    // Provenance: the package keeps the run and the context pack that produced it.
    const [runDesign] = await environment.services.db
      .selectFrom('ai_runs')
      .select(['id', 'context_pack_id'])
      .where('project_id', '=', projectId)
      .where('action', '=', 'design_proposal')
      .execute();
    const origin = await environment.services.db
      .selectFrom('proposal_batches')
      .select(['run_id', 'context_pack_id', 'producer'])
      .where('id', '=', packageBatch?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(origin).toEqual({
      run_id: runDesign?.id,
      context_pack_id: runDesign?.context_pack_id,
      producer: `agent:run:${runDesign?.id}`,
    });

    // 5. The person accepts the package in one step and approves the FDR.
    const acceptance = await command(projectId, 'batch.accept_package', {}, packageBatch?.id);
    const effect = (acceptance.result as { effects: { code: string; versionId: string }[] }).effects[0];
    const fdr = await read<{ versions: { criteria: unknown[]; readiness: { ready: boolean; reasons: string[] } }[] }>(
      `/api/projects/${projectId}/records/${effect?.code}`,
    );
    expect(fdr.versions[0]?.criteria).toHaveLength(2);
    expect(fdr.versions[0]?.readiness.ready).toBe(false);
    expect(fdr.versions[0]?.readiness.reasons).toContain('Version 1 is not approved.');
    await command(projectId, 'record_version.approve', {}, effect?.versionId);

    // 6. "Ready to build" and an empty inbox.
    const readiness = await read<{ ready: boolean; reasons: string[] }>(
      `/api/projects/${projectId}/versions/${effect?.versionId}/readiness`,
    );
    expect(readiness).toMatchObject({ ready: true, reasons: [] });
    const state = await read<{ ready_to_build: string[]; inbox: { total: number } }>(`/api/projects/${projectId}/state`);
    expect(state.ready_to_build).toEqual([effect?.code]);
    expect(state.inbox.total).toBe(0);

    // Everything decisive was done by the person; the agents only proposed.
    const decisiveCommands = await environment.services.db
      .selectFrom('events')
      .select(['command', 'actor'])
      .where('project_id', '=', projectId)
      .where('command', 'in', ['proposal.accept', 'record_version.approve', 'batch.accept_package'])
      .execute();
    expect(decisiveCommands.length).toBeGreaterThanOrEqual(4);
    expect(decisiveCommands.every((e) => e.actor === 'human:ana')).toBe(true);
  });

  it('AC-DIS-001-12 AC-DIS-001-13 the product state shows the current version, state, readiness and epistemic status', async () => {
    const { person } = api();
    const p = await person.request('POST', '/api/projects', { name: 'State' });
    const projectId = p.json<{ project_id: string }>().project_id;
    const d = await command(projectId, 'record.create', {
      type: 'decision',
      domain: 'members',
      title: 'Member signup',
      sections: [
        { title: 'Context', content: 'c' },
        { title: 'Decision', content: 'd' },
        { title: 'Consequences', content: 'k' },
      ],
    });
    const state = await read<{
      decisions: { code: string; current: number | null; latest: { state: string }; epistemic_status: string }[];
      inbox: { total: number };
    }>(`/api/projects/${projectId}/state`);
    // The draft waits for the person: it counts in the inbox until it is approved.
    expect(state.inbox.total).toBe(1);
    expect(state.decisions).toEqual([
      expect.objectContaining({
        code: (d.result as { code: string }).code,
        current: null,
        latest: { n: 1, state: 'draft' },
        epistemic_status: 'proposed',
      }),
    ]);
    await command(projectId, 'record_version.approve', {}, (d.result as { versionId: string }).versionId);
    const after = await read<{
      decisions: { current: number | null; epistemic_status: string }[];
      inbox: { total: number };
    }>(`/api/projects/${projectId}/state`);
    expect(after.decisions[0]).toMatchObject({ current: 1, epistemic_status: 'confirmed' });
    expect(after.inbox.total).toBe(0);
  });

  it("AC-DIS-001-19 the system infers a pending question from a run's validated output", async () => {
    const { person, environment } = api();
    const p = await person.request('POST', '/api/projects', { name: 'Inference' });
    const projectId = p.json<{ project_id: string }>().project_id;
    const exploration = await command(projectId, 'exploration.open', { purpose: 'Member signups' });
    const question = await command(projectId, 'question.raise', {
      exploration_id: exploration.entity_id,
      question: 'Who can sign up?',
    });
    await command(projectId, 'message.post', {
      exploration_id: exploration.entity_id,
      text: 'Quiero que cualquier vecino pueda darse de alta',
    });
    const [run] = await waitForRuns(projectId, 1);
    const row = await environment.services.db
      .selectFrom('questions')
      .select(['state', 'conclusion'])
      .where('id', '=', question.entity_id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: 'inferred', conclusion: 'Quiero que cualquier vecino pueda darse de alta' });
    const inference = await environment.services.db
      .selectFrom('events')
      .select(['actor', 'cause'])
      .where('command', '=', 'question.infer')
      .where('entity_id', '=', question.entity_id)
      .executeTakeFirstOrThrow();
    expect(inference.actor).toBe('system:exploration@1');
    expect((inference.cause as { run?: string }).run).toBe(run);
  });
});
