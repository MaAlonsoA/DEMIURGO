// AC de S2 sobre el motor de conocimiento: actualización verificada, invalidar en lugar de
// borrar, reconstrucción con la misma huella, frescura, evaluación de ideas, context packs,
// taxonomía y confianza.

import { randomUUID } from 'node:crypto';
import {
  type Actor,
  type Change,
  type Classifier,
  type Graph,
  DEFAULT_THRESHOLDS,
  VERDICTS,
  externalAgent,
  routeByConfidence,
  human,
  buildPlan,
  system,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { inbox } from '../src/queries/read.ts';
import { createCascadeClassifier } from '../src/classifier/cascade.ts';
import { UPDATER } from '../src/knowledge/commands.ts';
import { compareRebuild } from '../src/knowledge/rebuild.ts';
import { loadGraph, readGraphVersion } from '../src/knowledge/graph-pg.ts';
import type { Services } from '../src/services.ts';
import { createScriptedClassifier, response } from './support/scripted-classifier.ts';
import { useEnvironment } from './support/env.ts';

const script = createScriptedClassifier();
const environment = useEnvironment({ classifier: () => script });
const ana = human('ana');
let s: Services;

beforeAll(() => {
  s = environment().services;
});
beforeEach(() => script.restart());

async function newProject(name: string): Promise<string> {
  return (await executeCommand(s, { command: 'project.create', actor: ana, data: { name } })).projectId;
}

const cmd = (
  projectId: string,
  command: Parameters<typeof executeCommand>[1]['command'],
  data: unknown,
  entityId?: string,
  actor: Actor = ana,
) => executeCommand(s, { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });

async function decision(projectId: string, title: string, text: string, approve = true) {
  const r = await cmd(projectId, 'record.create', {
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
  if (approve) await cmd(projectId, 'record_version.approve', {}, res.versionId);
  return res;
}

async function newVersion(projectId: string, recordId: string, text: string) {
  const v = await cmd(projectId, 'record_version.create', {
    record_id: recordId,
    title: 'Versión revisada',
    sections: [
      { title: 'Context', content: 'Revisión.' },
      { title: 'Decisión', content: text },
      { title: 'Consequences', content: 'Hay que rediseñarlo.' },
    ],
    change_note: 'Cambia la decisión.',
  });
  await cmd(projectId, 'record_version.approve', {}, v.entityId);
  return v.entityId;
}

const updates = (projectId: string) =>
  s.db
    .selectFrom('knowledge_updates')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('trigger_seq')
    .orderBy('id')
    .execute();
const nodes = (projectId: string) =>
  s.db.selectFrom('knowledge_nodes').selectAll().where('project_id', '=', projectId).execute();
const unique = () => randomUUID().slice(0, 8);

/** Lote de un agente externo con propuestas de un tipo. */
async function agentBatch(projectId: string, payloads: Record<string, unknown>[], type = 'decision') {
  const r = await cmd(
    projectId,
    'batch.submit',
    { proposals: payloads.map((payload) => ({ type, payload })) },
    undefined,
    externalAgent('bot', 'session'),
  );
  return r.result as { batchId: string; proposals: string[] };
}

const decisionPayload = (title: string, text: string) => ({ title, context: 'c', decision: text, consequences: 'k' });

/** Taxonomía de un eje con una categoría propia y «otra». */
const axesWith = (cat: string) => [
  {
    code: 'area',
    name: 'Área',
    categories: [
      { code: cat, name: cat, description: `Todo sobre ${cat} y socios.` },
      { code: 'other', name: 'Other', description: 'Other.' },
    ],
  },
];

/** Clasificador que responde siempre lo mismo, con la confianza de cada posición. */
const fixed = (id: string, choice: string, confidences: number[]): Classifier => ({
  id,
  choice: async (items) => items.map((i, k) => response(i.id, choice, confidences[k] ?? 0.5)),
  score: async () => [],
  noul: async () => [],
});

/** Nodo con autoridad para las pruebas puras del plan. */
const testNode = (ref: string) => ({
  ref,
  type: 'decision',
  label: ref,
  text: ref,
  categories: {},
  epistemic: 'confirmed' as const,
  authority: true,
  origin: { type: 'record_version', id: null, version: 1 },
  from: 1,
  until: null,
});

/** Nodos vigentes de un proyecto como «ref|estado epistémico». */
const current = async (projectId: string) =>
  (await nodes(projectId))
    .filter((n) => n.valid_to === null)
    .map((n) => `${n.ref}|${n.epistemic}`)
    .sort();

describe('Actualizar conocimiento', () => {
  it('AC-CON-001-01 aprobar una versión dispara la actualización y sube la versión del grafo', async () => {
    const p = await newProject('Trigger');
    expect(await readGraphVersion(s.db, p)).toBe(0);
    const d = await decision(p, `Alta de socios ${unique()}`, 'Cada socio se da de alta con su correo.');
    const us = await updates(p);
    expect(us).toHaveLength(1);
    expect(us[0]).toMatchObject({ state: 'applied', trigger: { type: 'record_version', id: d.versionId } });
    expect(await readGraphVersion(s.db, p)).toBe(1);
    const n = await nodes(p);
    expect(n.map((x) => [x.ref, x.epistemic, x.valid_to])).toEqual([[`${d.code}@1`, 'confirmed', null]]);
    const event = await s.db
      .selectFrom('events')
      .select(['actor'])
      .where('command', '=', 'knowledge_update.apply')
      .where('entity_id', '=', us[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(event.actor).toBe('system:conocimiento@1');
  });

  it('AC-CON-001-02 un conjunto de veredictos que no cubre un candidato deja el update rejected sin efectos', async () => {
    const p = await newProject('Sin veredicto');
    const t = unique();
    await decision(p, `Cuotas anuales ${t}`, `Los socios pagan una cuota anual ${t}.`);
    const before = { version: await readGraphVersion(s.db, p), nodes: (await nodes(p)).length };
    script.scripts.verdict = () => [];
    await decision(p, `Cuotas anuales revisadas ${t}`, `Los socios pagan una cuota anual ${t} en enero.`);
    const us = await updates(p);
    expect(us.at(-1)).toMatchObject({ state: 'rejected' });
    expect(us.at(-1)?.failure).toMatch(/no tiene veredicto/);
    expect({ version: await readGraphVersion(s.db, p), nodes: (await nodes(p)).length }).toEqual(before);
    expect((await inbox(s.db, p)).rejected_updates).toHaveLength(1);
  });

  it('AC-CON-001-03 un veredicto que cita un nodo inexistente deja el update rejected sin efectos', async () => {
    const p = await newProject('Nodo inexistente');
    const t = unique();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    const before = { version: await readGraphVersion(s.db, p), nodes: (await nodes(p)).length };
    script.scripts.verdict = (items, baseline) => [...baseline, response('DEC-XXX-999@1', 'relate', 0.9)];
    await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    const u = (await updates(p)).at(-1);
    expect(u).toMatchObject({ state: 'rejected' });
    expect(u?.failure).toMatch(/nodo inexistente: DEC-XXX-999@1/);
    expect({ version: await readGraphVersion(s.db, p), nodes: (await nodes(p)).length }).toEqual(before);
  });

  it('AC-CON-001-04 un veredicto que invalida una decisión aprobada produce una propuesta en la bandeja, nunca un cambio directo', async () => {
    const p = await newProject('Invalidar autoridad');
    const t = unique();
    const old = await decision(p, `Pago en efectivo ${t}`, `Las cuotas se pagan en efectivo ${t}.`);
    script.scripts.verdict = (items) =>
      items.map((i) => response(i.id, 'invalidate', 0.95, 'El pago por transferencia sustituye al efectivo.'));
    await decision(p, `Pago por transferencia ${t}`, `Las cuotas se pagan por transferencia ${t}.`);
    // La decisión vieja sigue aprobada y su nodo sigue vigente.
    const v = await s.db
      .selectFrom('record_versions')
      .select('state')
      .where('id', '=', old.versionId)
      .executeTakeFirstOrThrow();
    expect(v.state).toBe('approved');
    const oldNode = (await nodes(p)).find((n) => n.ref === `${old.code}@1`);
    expect(oldNode?.valid_to).toBeNull();
    // Y en la bandeja hay una propuesta de revisión del conocimiento, que resuelve la persona.
    const b = await inbox(s.db, p);
    const batch = b.batches.find((l) => l.type === 'knowledge');
    expect(batch?.producer).toBe('system:conocimiento@1');
    expect(batch?.proposals[0]).toMatchObject({
      type: 'review',
      payload: { record: { code: old.code, version: 1 }, verdict: 'invalidate' },
    });
  });

  it('AC-CON-001-04 si una revisión no puede proponerse, la actualización se rechaza en lugar de perderla', async () => {
    const p = await newProject('Revisión sin origen');
    const t = unique();
    await decision(p, `Base ${t}`, `Algo de base ${t}.`);
    // Un nodo con autoridad cuyo origen no es una versión de este proyecto (p. ej. un grafo alterado).
    await sql`insert into knowledge_nodes (project_id, ref, kind, source_type, source_id, source_version, label, body, epistemic, valid_from, state)
      values (${p}::uuid, 'DEC-ZZZ-009@1', 'decision', 'record_version', ${randomUUID()}::uuid, 1,
              ${`Pago en efectivo ${t}`}, ${`Las cuotas se pagan en efectivo ${t}.`}, 'confirmado', 1, 'current')`.execute(s.db);
    script.scripts.verdict = (items) => items.map((i) => response(i.id, 'invalidate', 0.95, 'Superseded.'));
    await decision(p, `Pago por transferencia ${t}`, `Las cuotas se pagan por transferencia ${t}.`);
    const u = (await updates(p)).at(-1);
    expect(u?.state).toBe('rejected');
    expect(u?.failure).toMatch(/No se puede proponer la revisión de DEC-ZZZ-009@1/);
  });

  it('AC-CON-001-04 un registro con un dominio con dígitos se rechaza al crearlo: su código no podría citarse', async () => {
    const p = await newProject('Dominio con dígitos');
    await expect(
      cmd(p, 'record.create', {
        type: 'decision',
        domain: 'b2b',
        title: 'Payment',
        sections: [
          { title: 'Context', content: 'c' },
          { title: 'Decisión', content: 'd' },
          { title: 'Consequences', content: 'k' },
        ],
      }),
    ).rejects.toMatchObject({ type: 'validation' });
  });

  it('AC-CON-001-05 lo sustituido queda con valid_to y nunca se borra', async () => {
    const p = await newProject('Invalidate');
    const d = await decision(p, `Horario ${unique()}`, 'La sede abre por la tarde.');
    await newVersion(p, d.recordId, 'La sede abre por la mañana.');
    const n = await nodes(p);
    const v1 = n.find((x) => x.ref === `${d.code}@1`);
    const v2 = n.find((x) => x.ref === `${d.code}@2`);
    expect(v1?.valid_to).toBe('2');
    expect(v2?.valid_to).toBeNull();
    await expect(sql`delete from knowledge_nodes where id = ${v1?.id ?? ''}::uuid`.execute(s.db)).rejects.toThrow(/DELETE/);
    await expect(sql`update knowledge_nodes set valid_to = null where id = ${v1?.id ?? ''}::uuid`.execute(s.db)).rejects.toThrow(
      /solo se invalida/,
    );
  });

  it('AC-CON-001-06 reconstruir con las clasificaciones guardadas da la misma huella', async () => {
    const p = await newProject('Rebuild');
    const t = unique();
    await cmd(p, 'taxonomy.propose', {
      code: 'TAX-001',
      title: 'Taxonomía',
      axes: [
        {
          code: 'area',
          name: 'Área',
          categories: [
            { code: 'socios', name: 'Socios', description: 'Alta, baja y datos de los socios.' },
            { code: 'dues', name: 'Dues', description: 'Pagos y cuotas de la asociación.' },
            { code: 'other', name: 'Other', description: 'Nada de lo anterior.' },
          ],
        },
      ],
    }).then((r) => cmd(p, 'taxonomy.approve', {}, r.entityId));
    const a = await decision(p, `Alta de socios ${t}`, `Los socios se dan de alta con su correo ${t}.`);
    const b = await decision(p, `Cuota anual ${t}`, `Los socios pagan una cuota anual ${t}.`);
    await newVersion(p, a.recordId, `Los socios se dan de alta con correo y teléfono ${t}.`);
    await cmd(p, 'record.create', {
      type: 'fdr',
      domain: 'socios',
      title: `Alta ${t}`,
      sections: [
        { title: 'Goal', content: 'Alta de socios.' },
        { title: 'Scope', content: 'Formulario.' },
        { title: 'Fuera de alcance', content: 'Pagos.' },
        { title: 'Behavior', content: 'Se rellena y se confirma.' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'Alta',
          statement: 'Cuando se envía, entonces se guarda.',
          verification: 'automatic',
          check: 'Test.',
        },
      ],
      links: [{ type: 'based_on', target: { code: b.code, version: 1 } }],
    }).then((r) => cmd(p, 'record_version.approve', {}, (r.result as { versionId: string }).versionId));
    const callsBefore = { ...script.calls };
    const comparison = await compareRebuild(s.db, p);
    expect(comparison.equal).toBe(true);
    expect(comparison.alive).toMatch(/^[0-9a-f]{64}$/);
    // La reconstrucción no vuelve a llamar al clasificador: todo sale de lo guardado.
    expect(script.calls).toEqual(callsBefore);
    const g = await loadGraph(s.db, p);
    expect(g.nodes.some((n) => Object.keys(n.categories).length > 0)).toBe(true);
  });

  it('AC-CON-001-06 la reconstrucción reproduce propuestas, descartes, enlaces, rechazos y reintentos, y detecta un grafo alterado', async () => {
    const p = await newProject('Reconstruir todo');
    const t = unique();
    const a = await decision(p, `Horario de la sede ${t}`, `La sede abre por la tarde ${t}.`);
    // Una propuesta aceptada sin aprobar se proyecta como propuesta; al descartar el borrador se retira.
    const discarded = await agentBatch(p, [decisionPayload(`Sede por la mañana ${t}`, `La sede abre por la mañana ${t}.`)]);
    const draft = (await cmd(p, 'proposal.accept', {}, discarded.proposals[0])).result as {
      versionId: string;
      code: string;
    };
    expect(await current(p)).toContain(`${draft.code}@1|propuesto`);
    await cmd(p, 'record_version.discard', { reason: 'No.' }, draft.versionId);
    expect((await current(p)).some((n) => n.startsWith(`${draft.code}@1`))).toBe(false);
    // «Aceptar y aprobar».
    const approved = await agentBatch(p, [decisionPayload(`Sede en agosto ${t}`, `La sede cierra en agosto ${t}.`)]);
    await cmd(p, 'proposal.accept', { approve: true }, approved.proposals[0]);
    // Una FDR con su enlace a una decisión.
    await cmd(p, 'record.create', {
      type: 'fdr',
      domain: 'socios',
      title: `Reservas de la sede ${t}`,
      sections: [
        { title: 'Goal', content: 'Reservar la sede.' },
        { title: 'Scope', content: 'Formulario.' },
        { title: 'Fuera de alcance', content: 'Pagos.' },
        { title: 'Behavior', content: 'Se reserva y se confirma.' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'Reservation',
          statement: 'Cuando se reserva, entonces se confirma.',
          verification: 'automatic',
          check: 'Test.',
        },
      ],
      links: [{ type: 'based_on', target: { code: a.code, version: 1 } }],
    }).then((r) => cmd(p, 'record_version.approve', {}, (r.result as { versionId: string }).versionId));
    // Una actualización rechazada, otra aplicada después y el reintento de la rechazada al final.
    script.scripts.verdict = () => [];
    await decision(p, `Sede abierta los sábados ${t}`, `La sede abre por la tarde los sábados ${t}.`);
    script.restart();
    await decision(p, `Llaves de la sede ${t}`, `Cada socio de la junta tiene llave de la sede ${t}.`);
    const rejected = (await updates(p)).find((u) => u.state === 'rejected');
    expect(rejected).toBeDefined();
    await cmd(p, 'knowledge_update.retry', {}, rejected?.id);
    expect((await updates(p)).find((u) => u.id === rejected?.id)?.state).toBe('applied');
    await newVersion(p, a.recordId, `La sede abre por la tarde y los domingos ${t}.`);

    const callsBefore = { ...script.calls };
    expect(await compareRebuild(s.db, p)).toMatchObject({ equal: true, derivation: null });
    expect(script.calls).toEqual(callsBefore);

    // La reconstrucción parte de la autoridad, no del grafo vivo: un nodo colado a mano la hace divergir.
    await sql`insert into knowledge_nodes (project_id, ref, kind, source_type, label, body, epistemic, valid_from, state)
      values (${p}::uuid, 'DEC-ZZZ-999@1', 'decision', 'manual', 'Colado', 'Colado', 'confirmado', 1, 'current')`.execute(s.db);
    expect(await compareRebuild(s.db, p)).toMatchObject({ equal: false, derivation: expect.stringMatching(/no coincide/) });
  });

  it('AC-CON-001-13 la misma entrada reutiliza los veredictos guardados por input_hash sin llamar al clasificador', async () => {
    const t = unique();
    const text = `La junta aprueba las altas ${t}.`;
    const p1 = await newProject('Caché 1');
    await decision(p1, `Aprobación de altas ${t}`, text);
    await decision(p1, `Revisión de altas ${t}`, `${text} Y revisa las bajas.`);
    const calls = script.calls.verdict;
    expect(calls).toBeGreaterThan(0);
    const p2 = await newProject('Caché 2');
    await decision(p2, `Aprobación de altas ${t}`, text);
    await decision(p2, `Revisión de altas ${t}`, `${text} Y revisa las bajas.`);
    expect(script.calls.verdict).toBe(calls);
    const [u1, u2] = [(await updates(p1)).at(-1), (await updates(p2)).at(-1)];
    expect(u2?.input_hash).toBe(u1?.input_hash);
    expect(u2?.verdicts).toEqual(u1?.verdicts);
  });

  it('AC-CON-001-13 una salida que no se verifica no entra en la caché: reintentar vuelve a preguntar y se aplica', async () => {
    const p = await newProject('Caché sin veneno');
    const t = unique();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    script.scripts.verdict = () => [];
    await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    const rejected = (await updates(p)).at(-1);
    expect(rejected?.state).toBe('rejected');
    const saved = await s.db
      .selectFrom('verdict_cache')
      .select('input_hash')
      .where('input_hash', '=', rejected?.input_hash ?? '')
      .executeTakeFirst();
    expect(saved).toBeUndefined();
    script.restart();
    await cmd(p, 'knowledge_update.retry', {}, rejected?.id);
    expect(script.calls.verdict).toBe(1);
    expect((await updates(p)).at(-1)?.state).toBe('applied');
  });

  it('AC-CON-001-02 un veredicto que cita un nodo que no era candidato o dos veredictos para el mismo candidato dejan el update rejected', async () => {
    const p = await newProject('Verificación estricta');
    const t = unique();
    const a = await decision(p, `Cuotas ${t}`, `Los socios pagan una cuota anual ${t}.`);
    // Otra decisión del mismo tema: así hay candidatos y el clasificador responde.
    await decision(p, `Recibos de las cuotas ${t}`, `Los socios pagan la cuota anual ${t} con recibo.`);
    // La versión que se sustituye existe, pero nunca es candidata: la precedencia la decide el código.
    script.scripts.verdict = (items, baseline) => [...baseline, response(`${a.code}@1`, 'relate', 0.9)];
    await newVersion(p, a.recordId, `Los socios pagan una cuota anual ${t} en enero.`);
    const u1 = (await updates(p)).at(-1);
    expect(u1?.state).toBe('rejected');
    expect(u1?.failure).toMatch(/no era candidato/);
    script.scripts.verdict = (items, baseline) => [...baseline, ...baseline];
    await decision(p, `Cuotas de enero ${t}`, `Los socios pagan una cuota anual ${t} cada enero.`);
    const u2 = (await updates(p)).at(-1);
    expect(u2?.state).toBe('rejected');
    expect(u2?.failure).toMatch(/tiene 2 veredictos/);
  });
});

describe('freshness', () => {
  it('AC-CON-001-07 con un evento de autoridad sin proyectar, pedir una ejecución se rechaza por grafo desfasado', async () => {
    const p = await newProject('Freshness');
    const d = await decision(p, `Frescura ${unique()}`, 'Algo aprobado.');
    // Un evento de autoridad cuya actualización aún no se ha aplicado (p. ej. tras un corte).
    await sql`insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${p}::uuid, ${JSON.stringify({ type: 'record_version', id: d.versionId, version: 1 })}::jsonb, 999, 'queued')`.execute(
      s.db,
    );
    const request = () =>
      cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } });
    await expect(request()).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('no está al día')] });
    await s.engine.startUpdate('', p);
    await expect(request()).resolves.toMatchObject({ state: 'queued' });
  });
});

describe('evaluación de ideas', () => {
  it('AC-CON-001-08 una idea que duplica una decisión aprobada aparece en la bandeja marcada como duplicado con la cita', async () => {
    const p = await newProject('Ideas');
    const t = unique();
    const d = await decision(
      p,
      `Dos invitados por socio ${t}`,
      `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`,
    );
    await cmd(
      p,
      'batch.submit',
      {
        proposals: [
          {
            type: 'decision',
            payload: {
              title: `Dos invitados por socio ${t}`,
              context: 'Aforo.',
              decision: `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`,
              consequences: 'Contarlos.',
            },
          },
        ],
      },
      undefined,
      externalAgent('bot', 's1'),
    );
    const b = await inbox(s.db, p);
    const proposal = b.batches[0]?.proposals[0];
    expect(proposal?.assessment).toMatchObject({
      findings: [expect.objectContaining({ finding: 'duplicates', citation: `${d.code}@1` })],
    });
  });
});

describe('evaluación de ideas: paquetes, citas y fallos', () => {
  it('AC-CON-001-08 las ideas de un paquete de una ejecución se evalúan, con el estado epistémico de la cita y las respuestas inválidas registradas', async () => {
    const p = await newProject('Ideas de paquetes');
    const t = unique();
    const text = `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`;
    const d = await decision(p, `Dos invitados por socio ${t}`, text);
    const run = await cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } });
    script.scripts.idea = (items, baseline) => [...baseline, response('DEC-ZZZ-001@1', 'duplicates', 0.9)];
    const batch = await cmd(
      p,
      'batch.submit',
      {
        batch_type: 'system_package',
        resolution: 'package',
        run_id: run.entityId,
        proposals: [
          {
            type: 'fdr',
            payload: {
              title: `Dos invitados por socio ${t}`,
              goal: text,
              scope: 'Eventos.',
              out_of_scope: 'Pagos.',
              behavior: text,
              criteria: [
                {
                  title: 'Cap',
                  statement: 'Cuando trae un tercero, entonces se rechaza.',
                  verification: 'automatic',
                  check: 'E2E.',
                },
              ],
              based_on: { code: d.code, version: 1 },
            },
          },
        ],
      },
      undefined,
      system('design'),
    );
    const b = await inbox(s.db, p);
    const assessment = b.batches.find((l) => l.id === batch.entityId)?.proposals[0]?.assessment;
    expect(assessment).toMatchObject({
      findings: [expect.objectContaining({ citation: `${d.code}@1`, epistemic_status: 'confirmed' })],
      invalid: [expect.objectContaining({ citation: 'DEC-ZZZ-001@1', reason: 'No era candidata.' })],
      error: null,
    });
  });

  it('AC-CON-001-08 si la evaluación de una idea falla, queda registrado el error en lugar de quedarse pendiente', async () => {
    const p = await newProject('Ideas con fallo');
    const t = unique();
    await decision(p, `Sede ${t}`, `La sede abre por la tarde ${t}.`);
    script.scripts.idea = () => {
      throw new Error('proveedor caído');
    };
    const batch = await agentBatch(p, [decisionPayload(`Sede por la tarde ${t}`, `La sede abre por la tarde ${t}.`)]);
    const b = await inbox(s.db, p);
    expect(b.batches.find((l) => l.id === batch.batchId)?.proposals[0]?.assessment).toMatchObject({
      findings: [],
      error: expect.stringMatching(/proveedor caído/),
    });
  });
});

describe('context packs', () => {
  it('AC-CON-001-09 el pack registra rol, presupuesto, nodos con motivo, versión del grafo, dependencias y hash', async () => {
    const p = await newProject('Packs');
    const t = unique();
    await decision(p, `Cuotas ${t}`, `Las cuotas de los socios se pagan cada año ${t}.`);
    const d = await decision(p, `Alta de socios ${t}`, `El alta de los socios exige pagar la cuota ${t}.`);
    const request = () =>
      cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } });
    const r1 = await request();
    const r2 = await request();
    const packs = await s.db.selectFrom('context_packs').selectAll().where('project_id', '=', p).execute();
    expect(packs).toHaveLength(1);
    const pack = packs[0];
    expect(pack).toMatchObject({ role: 'design', builder: 'design_proposal@1', graph_version: '2' });
    expect(pack?.budget).toMatchObject({ decision: 8000, knowledge: 4000 });
    const content = pack?.content as { knowledge: { ref: string; reason: string }[] };
    expect(content.knowledge.length).toBeGreaterThan(0);
    for (const n of content.knowledge) expect(n.reason).toMatch(/relevancia/);
    expect(pack?.dependencies).toContainEqual({ type: 'knowledge_node', id: content.knowledge[0]?.ref, version: 2 });
    expect((r1.result as { contextPackHash: string }).contextPackHash).toBe(
      (r2.result as { contextPackHash: string }).contextPackHash,
    );
    // Con el grafo cambiado, el pack del mismo alcance es otro.
    await decision(p, `Otra ${t}`, 'Algo distinto.');
    const r3 = await request();
    expect((r3.result as { contextPackHash: string }).contextPackHash).not.toBe(
      (r1.result as { contextPackHash: string }).contextPackHash,
    );
  });
});

describe('lo aprobado queda confirmado', () => {
  it('AC-CON-001-09 lo aprobado con «Aceptar y aprobar» queda confirmado en el grafo y entra en el context pack', async () => {
    const p = await newProject('Aceptar y aprobar');
    const t = unique();
    const batch = await agentBatch(p, [
      decisionPayload(`Cuota de socios ${t}`, `Los socios pagan una cuota anual de treinta euros ${t}.`),
    ]);
    const accepted = (await cmd(p, 'proposal.accept', { approve: true }, batch.proposals[0])).result as { code: string };
    expect((await current(p)).filter((n) => n.startsWith(accepted.code))).toEqual([`${accepted.code}@1|confirmado`]);
    const d = await decision(p, `Recibo de la cuota ${t}`, `La cuota anual de los socios se cobra con recibo ${t}.`);
    const r = await cmd(p, 'run.request', { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } });
    const pack = await s.db
      .selectFrom('context_packs')
      .select('content')
      .where('id', '=', (r.result as { contextPackId: string }).contextPackId)
      .executeTakeFirstOrThrow();
    const refs = (pack.content as { knowledge: { ref: string }[] }).knowledge.map((n) => n.ref);
    expect(refs).toContain(`${accepted.code}@1`);
  });
});

describe('taxonomía y confianza', () => {
  const axes = [
    {
      code: 'area',
      name: 'Área',
      categories: [
        { code: 'socios', name: 'Socios', description: 'Alta, baja y datos de los socios.' },
        { code: 'other', name: 'Other', description: 'Nada de lo anterior.' },
      ],
    },
  ];

  it('AC-CON-001-15 solo se clasifica con la taxonomía aprobada vigente', async () => {
    const p = await newProject('Taxonomía');
    await decision(p, `Sin taxonomía ${unique()}`, 'Datos de los socios.');
    const proposal = await cmd(p, 'taxonomy.propose', { code: 'TAX-001', title: 'Taxonomía', axes });
    await decision(p, `Con borrador ${unique()}`, 'Datos de los socios.');
    expect(await s.db.selectFrom('classifications').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
    await cmd(p, 'taxonomy.approve', {}, proposal.entityId);
    await decision(p, `Con aprobada ${unique()}`, 'Alta y datos de los socios.');
    const c = await s.db.selectFrom('classifications').selectAll().where('project_id', '=', p).execute();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ taxonomy_id: proposal.entityId, axis: 'area', category: 'socios', state: 'applied' });
  });

  it('AC-CON-001-15 una categoría o un eje fuera de la taxonomía aprobada rechazan la actualización sin efectos', async () => {
    const p = await newProject('Taxonomía cerrada');
    const tx = await cmd(p, 'taxonomy.propose', { code: 'TAX-001', title: 'Taxonomía', axes });
    await cmd(p, 'taxonomy.approve', {}, tx.entityId);
    script.scripts.category = (items) => [
      ...items.map((i) => response(i.id, 'invented', 0.95)),
      response('ghost_axis', 'x', 0.99),
    ];
    const d = await decision(p, `Categorías ${unique()}`, 'Datos de los socios.');
    const u = (await updates(p)).at(-1);
    expect(u?.state).toBe('rejected');
    expect(u?.failure).toMatch(/«inventada» no es una categoría del eje area/);
    expect(u?.failure).toMatch(/eje que no está en la taxonomía: eje_fantasma/);
    expect(await s.db.selectFrom('classifications').select('id').where('project_id', '=', p).execute()).toEqual([]);
    expect((await nodes(p)).some((n) => n.ref === `${d.code}@1`)).toBe(false);
    // El comando tampoco la admite aunque se llame directamente.
    const data = {
      node_ref: `${d.code}@1`,
      taxonomy_id: tx.entityId,
      axis: 'area',
      category: 'invented',
      confidence: 0.9,
      justification: 'x',
      classifier: 'prueba@1',
      input_hash: 'h',
      update_id: null,
    };
    await expect(cmd(p, 'classification.record', data, undefined, UPDATER)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['«inventada» no es una categoría del eje area.'],
    });
  });

  it('AC-CON-001-13 la caché de categorías distingue taxonomías con el mismo código y versión pero otro contenido', async () => {
    const t = unique();
    const categories: string[][] = [];
    for (const cat of ['socios', 'dues']) {
      const p = await newProject(`Caché de categorías ${cat}`);
      const tx = await cmd(p, 'taxonomy.propose', { code: 'TAX-001', title: 'Taxonomía', axes: axesWith(cat) });
      await cmd(p, 'taxonomy.approve', {}, tx.entityId);
      await decision(p, `Alta ${t}`, `Alta de los socios ${t}.`);
      const c = await s.db.selectFrom('classifications').select('category').where('project_id', '=', p).execute();
      categories.push(c.map((x) => x.category));
    }
    expect(script.calls.category).toBe(2);
    expect(categories[1]?.every((c) => ['dues', 'other'].includes(c))).toBe(true);
  });

  it('AC-CON-001-14 una clasificación de confianza baja queda pendiente y aparece en la bandeja', async () => {
    const p = await newProject('Confidence');
    const tx = await cmd(p, 'taxonomy.propose', { code: 'TAX-001', title: 'Taxonomía', axes });
    await cmd(p, 'taxonomy.approve', {}, tx.entityId);
    script.scripts.category = (items) => items.map((i) => response(i.id, 'socios', 0.3, 'No estoy seguro.'));
    const d = await decision(p, `Dudosa ${unique()}`, 'Algo ambiguo.');
    const c = await s.db.selectFrom('classifications').selectAll().where('project_id', '=', p).executeTakeFirstOrThrow();
    expect(c).toMatchObject({ state: 'pending_review', confidence: 0.3 });
    const node = (await nodes(p)).find((n) => n.ref === `${d.code}@1`);
    expect(node?.categories).toEqual({});
    const b = await inbox(s.db, p);
    expect(b.classifications_to_review).toEqual([expect.objectContaining({ node_ref: `${d.code}@1`, category: 'socios' })]);
    // La persona la resuelve.
    await cmd(p, 'classification.resolve', { category: 'socios' }, c.id);
    expect((await inbox(s.db, p)).classifications_to_review).toHaveLength(0);
  });

  it('AC-CLA-001-04 sin revisor, una relación de confianza media no se aplica y queda anotada en la actualización', async () => {
    const p = await newProject('Relación media');
    const t = unique();
    const a = await decision(p, `Sede ${t}`, `La sede abre por la tarde ${t}.`);
    script.scripts.verdict = (items) => items.map((i) => response(i.id, 'relate', 0.6));
    await decision(p, `Sede en verano ${t}`, `La sede abre por la tarde en verano ${t}.`);
    const u = (await updates(p)).at(-1);
    expect(u?.state).toBe('applied');
    expect((await loadGraph(s.db, p)).edges.filter((x) => x.type === 'related')).toEqual([]);
    expect((u?.operations as { not_applied: unknown[] } | undefined)?.not_applied).toEqual([
      { ref: `${a.code}@1`, verdict: 'relate', confidence: 0.6, path: 'review_llm' },
    ]);
  });

  it('AC-CLA-001-04 la cascada pasa la confianza media al revisor: si la sube, la relación se aplica', async () => {
    const cascade = createCascadeClassifier(fixed('base@1', 'relate', [0.9, 0.6, 0.3]), fixed('revisor@1', 'relate', [0.95]));
    expect(cascade.id).toBe('base@1>revisor@1');
    const items = ['DEC-AAA-001@1', 'DEC-BBB-001@1', 'DEC-CCC-001@1'].map((id) => ({
      id,
      state: 'x',
      question: '¿Qué le pasa?',
      options: VERDICTS,
    }));
    const responses = await cascade.choice(items);
    expect(responses.map((r) => [r.id, r.confidence, r.reviewedBy ?? null])).toEqual([
      ['DEC-AAA-001@1', 0.9, null],
      ['DEC-BBB-001@1', 0.95, 'revisor@1'],
      ['DEC-CCC-001@1', 0.3, null],
    ]);
    // Con el grafo y el cambio, la media revisada al alza se aplica; la baja queda anotada sin aplicar.
    const g: Graph = { version: 1, nodes: items.map((i) => testNode(i.id)), edges: [] };
    const { from: _d, until: _h, categories: _c, ...main } = testNode('DEC-NUE-001@1');
    const change: Change = { main, companions: [], edges: [], supersedes: [] };
    const plan = buildPlan(g, change, {}, responses, 2);
    expect(plan.newEdges.map((a) => a.to)).toEqual(['DEC-AAA-001@1', 'DEC-BBB-001@1']);
    expect(plan.notApplied.map((x) => [x.ref, x.path])).toEqual([['DEC-CCC-001@1', 'pending_person']]);
  });

  it('AC-CLA-001-04 la cascada por umbrales envía la confianza alta a aplicar, la media a revisión y la baja a la persona', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ validFrom: 0.8, average: 0.55 });
    expect(routeByConfidence(0.95)).toBe('apply');
    expect(routeByConfidence(0.8)).toBe('apply');
    expect(routeByConfidence(0.6)).toBe('review_llm');
    expect(routeByConfidence(0.3)).toBe('pending_person');
  });
});

describe('el clasificador no toca la autoridad', () => {
  it('AC-CON-001-12 una actualización solo escribe conocimiento derivado, clasificaciones y propuestas', async () => {
    const p = await newProject('Frontier');
    const t = unique();
    await decision(p, `Sede ${t}`, `La sede abre de lunes a viernes ${t}.`);
    const authority = async () => {
      const rows = await sql<{ t: string; n: number; h: string }>`
        select 'records' as t, count(*)::int as n, md5(string_agg(r::text, '' order by r.id)) as h from records r where project_id = ${p}::uuid
        union all select 'record_versions', count(*)::int, md5(string_agg(v::text, '' order by v.id)) from record_versions v where project_id = ${p}::uuid
        union all select 'criteria', count(*)::int, md5(string_agg(c::text, '' order by c.id)) from criteria c where project_id = ${p}::uuid
        union all select 'links', count(*)::int, md5(string_agg(l::text, '' order by l.id)) from links l where project_id = ${p}::uuid
        union all select 'taxonomies', count(*)::int, md5(string_agg(x::text, '' order by x.id)) from taxonomies x where project_id = ${p}::uuid
        union all select 'questions', count(*)::int, md5(string_agg(q::text, '' order by q.id)) from questions q where project_id = ${p}::uuid`.execute(
        s.db,
      );
      return rows.rows;
    };
    // Una segunda decisión del mismo tema: al volver a proyectar la primera, la segunda es candidata.
    await decision(p, `Sede en verano ${t}`, `La sede abre de lunes a viernes en verano ${t}.`);
    script.scripts.verdict = (items) => items.map((i) => response(i.id, 'invalidate', 0.99));
    // Se encola una actualización a mano sobre la primera decisión y se procesa: la autoridad no cambia.
    const before = await authority();
    const v = await s.db
      .selectFrom('record_versions')
      .select('id')
      .where('project_id', '=', p)
      .orderBy('id')
      .executeTakeFirstOrThrow();
    await executeCommand(s, {
      command: 'knowledge_update.enqueue',
      actor: UPDATER,
      projectId: p,
      data: { object: { type: 'record_version', id: v.id, version: 1 } },
    });
    expect(script.calls.verdict).toBeGreaterThan(0);
    expect((await updates(p)).at(-1)?.state).toBe('applied');
    expect(await authority()).toEqual(before);
    // Lo que invalidaría la autoridad salió como propuesta de revisión.
    expect((await inbox(s.db, p)).batches.filter((l) => l.type === 'knowledge')).toHaveLength(1);
  });

  it('AC-CON-001-12 el componente del conocimiento no ejecuta comandos de autoridad aunque la matriz los permita a system', async () => {
    const p = await newProject('Component');
    const d = await decision(p, `Aprobada ${unique()}`, 'Algo aprobado.');
    const supersede = (actor: Actor) =>
      executeCommand(s, { command: 'record_version.supersede', actor, projectId: p, entityId: d.versionId, data: {} });
    await expect(supersede(UPDATER)).rejects.toMatchObject({ type: 'forbidden' });
    // Y ningún componente sustituye una versión aprobada sin otra aprobada posterior.
    await expect(supersede(system('versions'))).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Una versión aprobada solo queda sustituida cuando se aprueba otra posterior.'],
    });
    const v = await s.db.selectFrom('record_versions').select('state').where('id', '=', d.versionId).executeTakeFirstOrThrow();
    expect(v.state).toBe('approved');
  });
});
