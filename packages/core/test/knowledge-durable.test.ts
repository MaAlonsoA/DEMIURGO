// «Actualizar conocimiento» con el motor durable (DBOS): el reintento de una actualización
// rechazada arranca un flujo nuevo y un fallo al clasificar nunca deja una actualización en curso.

import { randomUUID } from 'node:crypto';
import { type Actor, human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { compareRebuild } from '../src/knowledge/rebuild.ts';
import type { Services } from '../src/services.ts';
import { createScriptedClassifier } from './support/scripted-classifier.ts';
import { useEnvironment } from './support/env.ts';

const script = createScriptedClassifier();
const environment = useEnvironment({ durable: true, classifier: () => script });
const ana = human('ana');
let s: Services;

beforeAll(() => {
  s = environment().services;
});

const unique = () => randomUUID().slice(0, 8);
const cmd = (
  projectId: string,
  command: Parameters<typeof executeCommand>[1]['command'],
  data: unknown,
  entityId?: string,
  actor: Actor = ana,
) => executeCommand(s, { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });

async function newProject(name: string): Promise<string> {
  return (await executeCommand(s, { command: 'project.create', actor: ana, data: { name } })).projectId;
}

async function decision(p: string, title: string, text: string) {
  const r = await cmd(p, 'record.create', {
    type: 'decision',
    domain: 'socios',
    title,
    sections: [
      { title: 'Context', content: `Contexto de ${title}.` },
      { title: 'Decisión', content: text },
      { title: 'Consequences', content: 'Hay que diseñarlo.' },
    ],
  });
  const res = r.result as { recordId: string; versionId: string; code: string };
  await cmd(p, 'record_version.approve', {}, res.versionId);
  await waitForKnowledge(s, p);
  return res;
}

const states = async (p: string) =>
  (
    await s.db
      .selectFrom('knowledge_updates')
      .select(['id', 'state'])
      .where('project_id', '=', p)
      .orderBy('trigger_seq')
      .orderBy('id')
      .execute()
  ).map((u) => u.state);

describe('conocimiento con el motor durable', () => {
  it('AC-CON-001-07 reintentar una actualización rechazada arranca un flujo nuevo y desbloquea la frescura', async () => {
    script.restart();
    const p = await newProject('Reintento durable');
    const t = unique();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    script.scripts.verdict = () => [];
    const d2 = await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    expect(await states(p)).toEqual(['applied', 'rejected']);
    script.restart();
    const rejected = (
      await s.db
        .selectFrom('knowledge_updates')
        .select('id')
        .where('project_id', '=', p)
        .where('state', '=', 'rejected')
        .executeTakeFirstOrThrow()
    ).id;
    await cmd(p, 'knowledge_update.retry', {}, rejected);
    await waitForKnowledge(s, p, 10_000);
    expect(await states(p)).toEqual(['applied', 'applied']);
    // Con todo aplicado, pedir una ejecución ya no choca con el gate de frescura.
    await expect(
      cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d2.versionId } }),
    ).resolves.toMatchObject({ state: 'queued' });
    expect(await compareRebuild(s.db, p)).toMatchObject({ equal: true });
  });

  it('AC-CON-001-07 un fallo persistente al clasificar deja la actualización rechazada, nunca en curso', async () => {
    script.restart();
    const p = await newProject('Fallo al clasificar');
    const t = unique();
    await decision(p, `Uno ${t}`, `Uno ${t}.`);
    // Un disparo que hace fallar la derivación en cada intento (como un fallo persistente de la base).
    const { rows } = await sql<{ id: string }>`insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${p}::uuid, ${JSON.stringify({ type: 'record_version', id: 'no-es-uuid', version: 1 })}::jsonb, 1000, 'queued') returning id`.execute(
      s.db,
    );
    await s.engine.startUpdate(rows[0]?.id ?? '', p);
    await waitForKnowledge(s, p, 15_000);
    expect(await states(p)).toEqual(['applied', 'rejected']);
    const u = await s.db
      .selectFrom('knowledge_updates')
      .select('failure')
      .where('id', '=', rows[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(u.failure).toMatch(/No se pudo clasificar el cambio/);
    // La cola sigue: el siguiente evento de autoridad se aplica.
    await decision(p, `Dos ${t}`, `Dos ${t}.`);
    // (El disparo inyectado lleva trigger_seq 1000: se ordena el último.)
    expect(await states(p)).toEqual(['applied', 'applied', 'rejected']);
  });
});
