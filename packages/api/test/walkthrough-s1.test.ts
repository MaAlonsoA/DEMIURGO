// Recorrido de S1 por la API con agentes simulados y el motor durable: de la intención a
// «Listo para construir», con la bandeja vacía al final.

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

/** Espera a que terminen las ejecuciones del proyecto (la respuesta al mensaje llega tras confirmar). */
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
  throw new Error('No llegaron las ejecuciones esperadas.');
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

describe('recorrido S1', () => {
  it('AC-DIS-001-01 AC-DIS-001-20 intención → decisión aceptada y aprobada → FDR con 2 AC → «Listo para construir» y bandeja vacía', async () => {
    const { person, environment } = api();
    const p = await person.request('POST', '/api/projects', { name: 'Asociación' });
    const projectId = p.json<{ project_id: string }>().project_id;

    // 1. Intención: una exploración y un mensaje de la persona. El agente de exploración responde.
    const exploration = await command(projectId, 'exploration.open', { purpose: 'Gestionar los socios de una asociación' });
    await command(projectId, 'message.post', {
      exploration_id: exploration.entity_id,
      text: 'Quiero que cada socio pueda darse de alta con su nombre y su correo',
    });
    const [runChat] = await waitForRuns(projectId, 1);

    // 2. La bandeja tiene un lote del agente con una propuesta de decisión, visible como propuesta.
    let inbox = await read<Inbox>(`/api/projects/${projectId}/inbox`);
    expect(inbox.total).toBe(1);
    const batch = inbox.batches[0];
    expect(batch).toMatchObject({ type: 'agent', resolution: 'item', producer: `agent:run:${runChat}` });
    expect(batch?.proposals[0]).toMatchObject({ type: 'decision', epistemic_status: 'proposed' });

    // 3. «Aceptar y aprobar» la decisión (acción humana).
    const accepted = await command(projectId, 'proposal.accept', { approve: true }, batch?.proposals[0]?.id);
    const decision = accepted.result as { code: string; versionId: string };
    expect(decision.code).toMatch(/^DEC-PRO-\d{3}$/);

    // 4. Propuesta de diseño sobre la decisión aprobada: un paquete con la FDR y sus 2 AC.
    // El gate de frescura exige que el conocimiento haya proyectado la aprobación.
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
    // Procedencia: el paquete guarda la ejecución y el context pack que lo produjeron.
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

    // 5. La persona acepta el paquete en un paso y aprueba la FDR.
    const acceptance = await command(projectId, 'batch.accept_package', {}, packageBatch?.id);
    const effect = (acceptance.result as { effects: { code: string; versionId: string }[] }).effects[0];
    const fdr = await read<{ versions: { criteria: unknown[]; readiness: { ready: boolean; reasons: string[] } }[] }>(
      `/api/projects/${projectId}/records/${effect?.code}`,
    );
    expect(fdr.versions[0]?.criteria).toHaveLength(2);
    expect(fdr.versions[0]?.readiness.ready).toBe(false);
    expect(fdr.versions[0]?.readiness.reasons).toContain('La versión 1 no está aprobada.');
    await command(projectId, 'record_version.approve', {}, effect?.versionId);

    // 6. «Listo para construir» y bandeja vacía.
    const readiness = await read<{ ready: boolean; reasons: string[] }>(
      `/api/projects/${projectId}/versions/${effect?.versionId}/readiness`,
    );
    expect(readiness).toMatchObject({ ready: true, reasons: [] });
    const state = await read<{ ready_to_build: string[]; inbox: { total: number } }>(
      `/api/projects/${projectId}/state`,
    );
    expect(state.ready_to_build).toEqual([effect?.code]);
    expect(state.inbox.total).toBe(0);

    // Todo lo decisivo lo hizo la persona; los agentes solo propusieron.
    const decisiveCommands = await environment.services.db
      .selectFrom('events')
      .select(['command', 'actor'])
      .where('project_id', '=', projectId)
      .where('command', 'in', ['proposal.accept', 'record_version.approve', 'batch.accept_package'])
      .execute();
    expect(decisiveCommands.length).toBeGreaterThanOrEqual(4);
    expect(decisiveCommands.every((e) => e.actor === 'human:ana')).toBe(true);
  });

  it('AC-DIS-001-12 AC-DIS-001-13 el estado del producto muestra versión vigente, estado, readiness y estado epistémico', async () => {
    const { person } = api();
    const p = await person.request('POST', '/api/projects', { name: 'State' });
    const projectId = p.json<{ project_id: string }>().project_id;
    const d = await command(projectId, 'record.create', {
      type: 'decision',
      domain: 'socios',
      title: 'Alta de socios',
      sections: [
        { title: 'Context', content: 'c' },
        { title: 'Decisión', content: 'd' },
        { title: 'Consequences', content: 'k' },
      ],
    });
    const state = await read<{
      decisions: { code: string; current: number | null; latest: { state: string }; epistemic_status: string }[];
      inbox: { total: number };
    }>(`/api/projects/${projectId}/state`);
    // El borrador espera a la persona: cuenta en la bandeja hasta que se aprueba.
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

  it('AC-DIS-001-19 el sistema infiere una pregunta pendiente a partir de la salida validada de una ejecución', async () => {
    const { person, environment } = api();
    const p = await person.request('POST', '/api/projects', { name: 'Inference' });
    const projectId = p.json<{ project_id: string }>().project_id;
    const exploration = await command(projectId, 'exploration.open', { purpose: 'Altas de socios' });
    const question = await command(projectId, 'question.raise', {
      exploration_id: exploration.entity_id,
      question: '¿Quién puede darse de alta?',
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
    expect(inference.actor).toBe('system:exploracion@1');
    expect((inference.cause as { run?: string }).run).toBe(run);
  });
});
