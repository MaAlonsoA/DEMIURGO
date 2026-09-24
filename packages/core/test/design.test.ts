// AC de S1 sobre el núcleo (sin HTTP): versiones, criterios, preguntas, readiness y lotes.

import { type Actor, DomainError, externalAgent, human, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { inbox, explorationDetail, batchDetail, productState, versionReadiness } from '../src/queries/read.ts';
import type { Services } from '../src/services.ts';
import { useEnvironment } from './support/env.ts';
import { newDecision, newExploration, newBatch } from './support/recipes.ts';

const environment = useEnvironment();
const ana = human('ana');
let s: Services;
let projectId = '';

beforeAll(async () => {
  s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Diseño' } })).projectId;
});

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string, actor: Actor = ana) =>
  executeCommand(s, { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });

const FDR_SECTIONS = [
  { title: 'Goal', content: 'Que los socios se den de alta.' },
  { title: 'Scope', content: 'Alta con nombre y correo.' },
  { title: 'Fuera de alcance', content: 'Pagos.' },
  { title: 'Behavior', content: 'La persona rellena el formulario y ve la confirmación.' },
];
const AC = (title: string) => ({
  carry: 'new' as const,
  title,
  statement: `Dado un socio nuevo, cuando envía el formulario de ${title}, entonces ve la confirmación.`,
  verification: 'automatic' as const,
  check: 'Prueba de extremo a extremo del formulario.',
});

async function fdrOn(
  decision: { code: string },
  options: { criteria?: unknown[]; approve?: boolean; origin?: unknown } = {},
) {
  const r = await cmd('record.create', {
    type: 'fdr',
    domain: 'socios',
    title: 'Alta de socios',
    sections: FDR_SECTIONS,
    criteria: options.criteria ?? [AC('alta'), AC('baja')],
    links: [{ type: 'based_on', target: { code: decision.code, version: 1 } }],
    ...(options.origin ? { origin: options.origin } : {}),
  });
  const res = r.result as { recordId: string; versionId: string; code: string };
  if (options.approve) await cmd('record_version.approve', {}, res.versionId);
  return res;
}

const DECISION_SECTIONS = [
  { title: 'Context', content: 'c2' },
  { title: 'Decisión', content: 'd2' },
  { title: 'Consequences', content: 'k2' },
];

/** Crea (y por defecto aprueba) una versión nueva de una decisión. */
async function newDecisionVersion(recordId: string, approve = true, pid = projectId): Promise<string> {
  const v = await executeCommand(s, {
    command: 'record_version.create',
    actor: ana,
    projectId: pid,
    data: { record_id: recordId, title: 'Decisión revisada', sections: DECISION_SECTIONS, change_note: 'Change.' },
  });
  if (approve) {
    await executeCommand(s, {
      command: 'record_version.approve',
      actor: ana,
      projectId: pid,
      entityId: v.entityId,
      data: {},
    });
  }
  return v.entityId;
}

const dependency = (r: { recordId: string; code: string }, version = 1) => ({
  type: 'record',
  id: r.recordId,
  code: r.code,
  version,
});

async function stateOf(table: 'proposals' | 'proposal_batches', id: string) {
  return (await s.db.selectFrom(table).select('state').where('id', '=', id).executeTakeFirstOrThrow()).state;
}

async function versions(recordId: string) {
  return s.db.selectFrom('record_versions').select(['id', 'n', 'state']).where('record_id', '=', recordId).orderBy('n').execute();
}

describe('versiones y criterios', () => {
  it('AC-DIS-001-08 aprobar no crea versión: la vigente es la última aprobada y la anterior queda sustituida', async () => {
    const d = await newDecision(s, projectId, true);
    expect(await versions(d.recordId)).toMatchObject([{ n: 1, state: 'approved' }]);
    const v2 = await cmd('record_version.create', {
      record_id: d.recordId,
      title: 'Decisión revisada',
      sections: [
        { title: 'Context', content: 'c2' },
        { title: 'Decisión', content: 'd2' },
        { title: 'Consequences', content: 'k2' },
      ],
      change_note: 'Se precisa la decisión.',
    });
    expect(await versions(d.recordId)).toMatchObject([
      { n: 1, state: 'approved' },
      { n: 2, state: 'draft' },
    ]);
    await cmd('record_version.approve', {}, v2.entityId);
    expect(await versions(d.recordId)).toMatchObject([
      { n: 1, state: 'superseded' },
      { n: 2, state: 'approved' },
    ]);
    const supersede = await s.db
      .selectFrom('events')
      .select(['actor', 'cause'])
      .where('command', '=', 'record_version.supersede')
      .where('entity_id', '=', (await versions(d.recordId))[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(supersede.actor).toBe('system:versiones@1');
  });

  it('AC-DIS-001-08 no se aprueba un borrador anterior a una versión ya aprobada: se descarta', async () => {
    const d = await newDecision(s, projectId, true);
    const v2 = await newDecisionVersion(d.recordId, false);
    const v3 = await newDecisionVersion(d.recordId, false);
    await cmd('record_version.approve', {}, v3);
    await expect(cmd('record_version.approve', {}, v2)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Ya hay una versión aprobada posterior (v3): descarta este borrador o crea una versión nueva.'],
    });
    expect((await versionReadiness(s.db, projectId, v2)).reasons).toContain(
      'La versión 2 es un borrador anterior a la vigente (v3): solo se puede descartar.',
    );
    expect((await inbox(s.db, projectId)).versions_to_approve.find((v) => v.id === v2)).toMatchObject({ approvable: false });
    await cmd('record_version.discard', { reason: 'La sustituye la v3.' }, v2);
    expect(await versions(d.recordId)).toMatchObject([
      { n: 1, state: 'superseded' },
      { n: 2, state: 'discarded' },
      { n: 3, state: 'approved' },
    ]);
  });

  it('AC-DIS-001-09 los criterios y los enlaces solo nacen con su versión, y la base lo impone', async () => {
    const d = await newDecision(s, projectId, true);
    const f = await fdrOn(d, { approve: true });
    const onlyWithOwnVersion = 'Los criterios y los enlaces se crean con su versión: crea una versión nueva del registro.';
    const criterion = {
      version_id: f.versionId,
      code: `AC-${f.code.slice(4)}-07`,
      title: 'Snuck',
      statement: 'Cuando se añade, entonces cambia la versión.',
      verification: 'automatic',
      check: 'Test.',
      carry: 'kept',
      derived_from_id: null,
      position: 9,
    };
    await expect(cmd('criterion.record', criterion)).rejects.toMatchObject({
      type: 'guard',
      reasons: expect.arrayContaining([onlyWithOwnVersion]),
    });
    // Ni siquiera en un borrador: el contenido de la versión se fija al crearla.
    const draft = await fdrOn(d);
    await expect(cmd('criterion.record', { ...criterion, version_id: draft.versionId })).rejects.toMatchObject({
      type: 'guard',
      reasons: [onlyWithOwnVersion],
    });
    await expect(
      cmd('link.create', {
        type: 'based_on',
        from: { type: 'record_version', id: f.versionId },
        to: { type: 'record_version', id: d.versionId },
      }),
    ).rejects.toMatchObject({ type: 'guard', reasons: [onlyWithOwnVersion] });
    // La base lo impide aunque falle una guarda.
    await expect(
      sql`insert into criteria (project_id, record_version_id, code, title, statement, verification, check_text, carry, position, state)
          values (${projectId}::uuid, ${f.versionId}::uuid, ${criterion.code}, 't', 's', 'automatic', 'c', 'new', 9, 'recorded')`.execute(
        s.db,
      ),
    ).rejects.toThrow(/borrador/);
    await expect(
      sql`insert into links (project_id, type, from_type, from_id, from_version, to_type, to_id, to_version, state, created_by)
          values (${projectId}::uuid, 'based_on', 'record_version', ${f.versionId}::uuid, 1, 'record_version', ${d.versionId}::uuid, 1, 'current', 'human:ana')`.execute(
        s.db,
      ),
    ).rejects.toThrow(/borrador/);
  });

  it('AC-DIS-001-09 un criterio nuevo nunca reutiliza el código de uno descartado y una versión nueva exige nota de cambio', async () => {
    const d = await newDecision(s, projectId);
    const f = await fdrOn(d);
    const [c1, c2] = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).orderBy('position').execute()
    ).map((c) => c.code);
    const base = { record_id: f.recordId, title: 'v2', sections: FDR_SECTIONS };
    await expect(
      cmd('record_version.create', { ...base, criteria: [{ carry: 'kept', code: c1 }], discarded: [c2] }),
    ).rejects.toMatchObject({ type: 'guard', reasons: ['Una versión nueva exige una nota de cambio.'] });
    await cmd('record_version.create', {
      ...base,
      criteria: [{ carry: 'kept', code: c1 }],
      discarded: [c2],
      change_note: 'Se descarta un criterio.',
    });
    const v3 = { ...base, title: 'v3', change_note: 'Vuelve un criterio.' };
    await expect(
      cmd('record_version.create', {
        ...v3,
        criteria: [
          { carry: 'kept', code: c1 },
          { ...AC('another'), code: c2 },
        ],
      }),
    ).rejects.toMatchObject({ type: 'validation', message: expect.stringContaining(`${c2} ya se usó`) });
    const r = await cmd('record_version.create', { ...v3, criteria: [{ carry: 'kept', code: c1 }, AC('another')] });
    const codes = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', r.entityId).orderBy('position').execute()
    ).map((c) => c.code);
    expect(codes).toEqual([c1, expect.stringMatching(/-03$/)]);
  });

  it('AC-DIS-001-08 crear un registro con una versión explícita (importación) devuelve esa versión', async () => {
    const r = await cmd('record.create', {
      type: 'decision',
      domain: 'socios',
      title: 'Importada en su versión 2',
      sections: DECISION_SECTIONS,
      number: 2,
      change_note: 'Viene de design/.',
    });
    expect(r.result).toMatchObject({ version: 2 });
  });

  it('AC-DIS-001-09 la base rechaza modificar una versión o sus criterios', async () => {
    const d = await newDecision(s, projectId);
    const f = await fdrOn(d);
    await expect(sql`update record_versions set title = 'otro' where id = ${f.versionId}::uuid`.execute(s.db)).rejects.toThrow(
      /inmutable/,
    );
    await expect(sql`update record_versions set sections = '[]' where id = ${f.versionId}::uuid`.execute(s.db)).rejects.toThrow(
      /inmutable/,
    );
    await expect(
      sql`update criteria set statement = 'otro' where record_version_id = ${f.versionId}::uuid`.execute(s.db),
    ).rejects.toThrow(/no admite cambios/);
    await expect(sql`delete from criteria where record_version_id = ${f.versionId}::uuid`.execute(s.db)).rejects.toThrow(
      /no admite DELETE/,
    );
  });

  it('AC-DIS-001-09 una versión nueva exige mantener, modificar o descartar cada criterio', async () => {
    const d = await newDecision(s, projectId);
    const f = await fdrOn(d);
    const codes = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).orderBy('position').execute()
    ).map((c) => c.code);
    expect(codes).toHaveLength(2);
    const base = {
      record_id: f.recordId,
      title: 'Alta de socios v2',
      sections: FDR_SECTIONS,
      change_note: 'Cambia un criterio.',
    };
    // Sin decir qué pasa con el segundo criterio: se rechaza con el motivo.
    const withoutCarryOver = cmd('record_version.create', { ...base, criteria: [{ carry: 'kept', code: codes[0] }] });
    await expect(withoutCarryOver).rejects.toMatchObject({
      type: 'guard',
      reasons: [expect.stringContaining(`${codes[1]}: mantener, modificar o descartar`)],
    });
    const r = await cmd('record_version.create', {
      ...base,
      criteria: [
        { carry: 'kept', code: codes[0] },
        { ...AC('modified'), carry: 'modified', derived_from: codes[1] },
        AC('new'),
      ],
    });
    const created = await s.db
      .selectFrom('criteria')
      .select(['code', 'carry', 'derived_from', 'statement'])
      .where('record_version_id', '=', r.entityId)
      .orderBy('position')
      .execute();
    expect(created.map((c) => [c.code, c.carry])).toEqual([
      [codes[0], 'kept'],
      [codes[1], 'modified'],
      [expect.stringMatching(/-03$/), 'new'],
    ]);
    expect(created[0]?.derived_from).not.toBeNull();
    // Descartar también es explícito.
    const v3 = await cmd('record_version.create', {
      ...base,
      title: 'v3',
      criteria: [{ carry: 'kept', code: codes[0] }],
      discarded: [codes[1], created[2]?.code],
    });
    expect(v3.state).toBe('draft');
  });

  it('AC-DIS-001-18 crear o aprobar un registro que no cumple su plantilla se rechaza con lo que falta', async () => {
    const bug = cmd('record.create', {
      type: 'bug',
      domain: 'socios',
      title: 'Falla el alta',
      sections: [
        { title: 'Expected', content: 'e' },
        { title: 'Observed', content: 'o' },
      ],
    });
    await expect(bug).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('Reproducción')] });
    const empty = cmd('record.create', {
      type: 'decision',
      domain: 'socios',
      title: 'x',
      sections: [
        { title: 'Context', content: '' },
        { title: 'Decisión', content: 'd' },
        { title: 'Consequences', content: 'k' },
      ],
    });
    await expect(empty).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('está vacía')] });
  });

  it('AC-DIS-001-18 una FDR o un ADR sin una sección de su plantilla se rechaza, y también al aprobar', async () => {
    const fdr = cmd('record.create', {
      type: 'fdr',
      domain: 'socios',
      title: 'Sin alcance',
      sections: FDR_SECTIONS.filter((x) => x.title !== 'Scope'),
      criteria: [AC('alta')],
    });
    await expect(fdr).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('Scope')] });
    const adr = cmd('record.create', {
      type: 'adr',
      domain: 'socios',
      title: 'Sin opciones',
      sections: [
        { title: 'Context', content: 'c' },
        { title: 'Decisión', content: 'd' },
        { title: 'Consequences', content: 'k' },
      ],
      criteria: [AC('alta')],
    });
    await expect(adr).rejects.toMatchObject({ type: 'guard', reasons: [expect.stringContaining('Options')] });
    // Al aprobar se vuelve a comprobar: una versión que no la cumple (insertada sin pasar por la guarda de creación).
    const d = await newDecision(s, projectId);
    const sections = JSON.stringify([
      { title: 'Context', content: 'c' },
      { title: 'Decisión', content: 'd' },
    ]);
    const { rows } = await sql<{ id: string }>`
      insert into record_versions (project_id, record_id, n, title, sections, author, content_hash, state)
      values (${projectId}::uuid, ${d.recordId}::uuid, 2, 'Sin consecuencias', ${sections}::jsonb, 'human:ana', 'h', 'draft')
      returning id`.execute(s.db);
    await expect(cmd('record_version.approve', {}, rows[0]?.id)).rejects.toMatchObject({
      type: 'guard',
      reasons: [expect.stringContaining('Consequences')],
    });
  });
});

describe('questions', () => {
  async function question(): Promise<string> {
    const e = await newExploration(s, projectId);
    return (await cmd('question.raise', { exploration_id: e, question: '¿Quién paga la cuota?' })).entityId;
  }

  it('AC-DIS-001-10 confirmar exige conclusión; posponer y descartar exigen motivo; reabrir conserva el historial', async () => {
    const q = await question();
    await expect(cmd('question.confirm', {}, q)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Hace falta una conclusión.'],
    });
    await expect(cmd('question.postpone', { reason: '  ' }, q)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Hace falta un motivo.'],
    });
    await cmd('question.confirm', { conclusion: 'La paga cada socio.' }, q);
    await cmd('question.reopen', { reason: 'Cambia el reglamento.' }, q);
    const row = await s.db.selectFrom('questions').selectAll().where('id', '=', q).executeTakeFirstOrThrow();
    expect(row.state).toBe('pending');
    const history = await s.db
      .selectFrom('events')
      .select(['command', 'state_before', 'state_after', 'after'])
      .where('entity_id', '=', q)
      .orderBy('seq')
      .execute();
    expect(history.map((e) => e.command)).toEqual(['question.raise', 'question.confirm', 'question.reopen']);
    expect(history[1]?.after).toEqual({ conclusion: 'La paga cada socio.' });
    // Reabierta, vuelve sin conclusión: confirmarla otra vez exige una nueva.
    expect(row.conclusion).toBeNull();
    await expect(cmd('question.confirm', {}, q)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Hace falta una conclusión.'],
    });
    await expect(cmd('question.discard', {}, q)).rejects.toMatchObject({ type: 'guard' });
    await cmd('question.discard', { reason: 'Ya no aplica.' }, q);
  });

  it('AC-DIS-001-19 una pregunta solo pasa a inferida por el sistema; un agente no puede inferirla ni confirmarla', async () => {
    const q = await question();
    for (const actor of [
      externalAgent('bot', 's'),
      { type: 'agent_run', run: '00000000-0000-7000-8000-000000000001' } as Actor,
    ]) {
      await expect(cmd('question.infer', { conclusion: 'x' }, q, actor)).rejects.toMatchObject({ type: 'forbidden' });
      await expect(cmd('question.confirm', { conclusion: 'x' }, q, actor)).rejects.toMatchObject({ type: 'forbidden' });
    }
    await cmd('question.infer', { conclusion: 'Cada socio.', reasoning: 'Lo dijo la persona.' }, q, system('exploration'));
    const row = await s.db.selectFrom('questions').select(['state', 'conclusion']).where('id', '=', q).executeTakeFirstOrThrow();
    expect(row).toEqual({ state: 'inferred', conclusion: 'Cada socio.' });
    // La persona la confirma con la conclusión inferida.
    await cmd('question.confirm', {}, q);
  });
});

describe('readiness', () => {
  it('AC-DIS-001-06 readiness falsa por cada motivo, en lenguaje de producto', async () => {
    const decision = await newDecision(s, projectId, true);
    const list = await fdrOn(decision, { approve: true });
    expect(await versionReadiness(s.db, projectId, list.versionId)).toEqual({ ready: true, reasons: [], warnings: [] });

    // Versión no aprobada.
    const draft = await fdrOn(decision);
    expect((await versionReadiness(s.db, projectId, draft.versionId)).reasons).toContain('La versión 1 no está aprobada.');

    // Sin criterios.
    const withoutAc = await fdrOn(decision, { criteria: [], approve: true });
    expect((await versionReadiness(s.db, projectId, withoutAc.versionId)).reasons).toContain('No tiene criterios de aceptación.');

    // Sin decisión aprobada.
    const withoutDecision = await newDecision(s, projectId, false);
    const fWithoutDecision = await fdrOn(withoutDecision, { approve: true });
    expect((await versionReadiness(s.db, projectId, fWithoutDecision.versionId)).reasons).toContain(
      `La decisión ${withoutDecision.code} en la que se basa no está aprobada.`,
    );

    // No vigente: aprobar una v2 de la FDR deja la v1 sustituida.
    const f = await fdrOn(decision, { approve: true });
    const v2 = await cmd('record_version.create', {
      record_id: f.recordId,
      title: 'Alta v2',
      sections: FDR_SECTIONS,
      criteria: (await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).execute()).map(
        (c) => ({ carry: 'kept', code: c.code }),
      ),
      links: [{ type: 'based_on', target: { code: decision.code, version: 1 } }],
      change_note: 'Revisión.',
    });
    await cmd('record_version.approve', {}, v2.entityId);
    expect((await versionReadiness(s.db, projectId, f.versionId)).reasons).toContain(
      'La versión 1 está sustituida: la vigente es la 2.',
    );

    // Decisión no vigente y enlace pendiente de revisión: se aprueba una v2 de la decisión.
    const d2 = await newDecision(s, projectId, true);
    const fd2 = await fdrOn(d2, { approve: true });
    const incoming = await cmd('record_version.create', {
      record_id: d2.recordId,
      title: 'Decisión v2',
      sections: [
        { title: 'Context', content: 'c' },
        { title: 'Decisión', content: 'other' },
        { title: 'Consequences', content: 'k' },
      ],
      change_note: 'Cambia la decisión.',
    });
    await cmd('record_version.approve', {}, incoming.entityId);
    const reasons = (await versionReadiness(s.db, projectId, fd2.versionId)).reasons;
    expect(reasons).toContain(`Se basa en ${d2.code} v1, pero la vigente es la v2.`);
    expect(reasons).toContain(`El enlace con ${d2.code} está pendiente de revisión.`);

    // Preguntas pendientes o pospuestas en la exploración de origen.
    const e = await newExploration(s, projectId);
    await cmd('question.raise', { exploration_id: e, question: '¿Hay invitados?' });
    const q2 = (await cmd('question.raise', { exploration_id: e, question: '¿Cuotas reducidas?' })).entityId;
    await cmd('question.postpone', { reason: 'Luego.' }, q2);
    const withQuestions = await fdrOn(decision, { approve: true, origin: { type: 'exploration', id: e } });
    const mp = (await versionReadiness(s.db, projectId, withQuestions.versionId)).reasons;
    expect(mp).toContain('Hay 1 pregunta(s) pendiente(s) en la exploración de origen.');
    expect(mp).toContain('Hay 1 pregunta(s) pospuesta(s) en la exploración de origen.');

    // Propuestas pendientes que la afectan.
    const affected = await fdrOn(decision, { approve: true });
    await cmd(
      'batch.submit',
      {
        proposals: [
          {
            type: 'exploration',
            payload: { purpose: 'Revisar el alta' },
            dependencies: [{ type: 'record', id: affected.recordId, code: affected.code, version: 1 }],
          },
        ],
      },
      undefined,
      system('test'),
    );
    expect((await versionReadiness(s.db, projectId, affected.versionId)).reasons).toContain(
      'Hay 1 propuesta(s) pendiente(s) que la afectan.',
    );
  });

  it('AC-DIS-001-06 las preguntas abiertas se buscan en la exploración de origen: propuesta → lote → ejecución → alcance', async () => {
    const decision = await newDecision(s, projectId, true);
    const e = await newExploration(s, projectId);
    await cmd('question.raise', { exploration_id: e, question: '¿Hay cuota familiar?' });
    const run = await cmd('run.request', { action: 'exploration_chat', scope: { type: 'exploration', id: e } });
    const batch = await cmd(
      'batch.submit',
      {
        run_id: run.entityId,
        proposals: [
          {
            type: 'fdr',
            payload: {
              title: 'Alta de socios',
              goal: 'o',
              scope: 'a',
              out_of_scope: 'f',
              behavior: 'c',
              criteria: [
                {
                  title: 'Alta',
                  statement: 'Cuando envía, entonces ve la confirmación.',
                  verification: 'automatic',
                  check: 'E2E.',
                },
              ],
              based_on: { code: decision.code, version: 1 },
            },
          },
        ],
      },
      undefined,
      system('test'),
    );
    const [proposal] = (batch.result as { proposals: string[] }).proposals;
    const effect = (await cmd('proposal.accept', { approve: true }, proposal)).result as { versionId: string };
    expect((await versionReadiness(s.db, projectId, effect.versionId)).reasons).toEqual([
      'Hay 1 pregunta(s) pendiente(s) en la exploración de origen.',
    ]);
  });

  it('AC-DIS-001-14 un criterio no observable recibe un aviso, nunca un bloqueo', async () => {
    const decision = await newDecision(s, projectId, true);
    const f = (await fdrOn(decision, {
      approve: true,
      criteria: [{ ...AC('x'), title: 'Rápido', statement: 'El alta es rápida e intuitiva.' }, AC('good')],
    })) as unknown as { versionId: string; code: string; warnings: string[] };
    // El aviso llega al registrar el AC; el que cumple la regla no recibe ninguno.
    const prefix = `AC-${f.code.slice(4)}`;
    expect(f.warnings.join(' ')).toMatch(new RegExp(`${prefix}-01: el enunciado no describe un resultado observable`));
    expect(f.warnings.join(' ')).toMatch(new RegExp(`${prefix}-01: «rápida» es vago`));
    expect(f.warnings.filter((a) => a.startsWith(`${prefix}-02`))).toEqual([]);
    const r = await versionReadiness(s.db, projectId, f.versionId);
    expect(r.ready).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/no describe un resultado observable/);
    expect(r.warnings.join(' ')).toMatch(/«rápida» es vago|es vago/);
  });
});

describe('lotes y propuestas', () => {
  it('AC-DIS-001-11 un agente externo propone como máximo 10 elementos, por elementos y con su productor visible', async () => {
    const bot = externalAgent('bot', 'sesion-x');
    const payload = { purpose: 'Explorar invitados' };
    const once = Array.from({ length: 11 }, () => ({ type: 'exploration', payload }));
    await expect(cmd('batch.submit', { proposals: once }, undefined, bot)).rejects.toMatchObject({
      type: 'guard',
      reasons: [expect.stringContaining('como máximo 10')],
    });
    // Aunque pida paquete, el canal lo fija por elementos.
    const r = await cmd(
      'batch.submit',
      { resolution: 'package', batch_type: 'system_package', proposals: once.slice(0, 10) },
      undefined,
      bot,
    );
    const batch = await s.db.selectFrom('proposal_batches').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
    expect(batch).toMatchObject({ kind: 'agent', resolution_mode: 'item', producer: 'agent:bot:sesion-x' });
    const proposals = await s.db.selectFrom('proposals').select('id').where('batch_id', '=', batch.id).execute();
    expect(proposals).toHaveLength(10);
    // No se acepta el lote entero: se resuelve elemento a elemento.
    await expect(cmd('batch.accept_package', {}, batch.id)).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Este lote se resuelve elemento a elemento.'],
    });
    await cmd('proposal.accept', {}, proposals[0]?.id);
    await cmd('proposal.reject', { reason: 'No ahora.' }, proposals[1]?.id);
  });

  it('AC-DIS-001-11 una propuesta de un paquete no se acepta ni se rechaza suelta', async () => {
    const { proposals } = await newBatch(s, projectId, true);
    const reason = 'Esta propuesta forma parte de un paquete: se acepta o se rechaza el paquete completo.';
    await expect(cmd('proposal.accept', {}, proposals[0])).rejects.toMatchObject({ type: 'guard', reasons: [reason] });
    await expect(cmd('proposal.reject', {}, proposals[0])).rejects.toMatchObject({ type: 'guard', reasons: [reason] });
  });

  it('AC-DIS-001-05 un agente externo solo propone decisiones, exploraciones y FDR, sin tipo de observación ni procedencia', async () => {
    const bot = externalAgent('bot', 'sesion-z');
    for (const type of ['review', 'imported_record', 'imported_taxonomy']) {
      await expect(cmd('batch.submit', { proposals: [{ type, payload: {} }] }, undefined, bot)).rejects.toMatchObject({
        type: 'guard',
        reasons: expect.arrayContaining([`Un agente externo no puede proponer «${type}».`]),
      });
    }
    const e = await newExploration(s, projectId);
    await expect(
      cmd('message.post', { exploration_id: e, text: 'Es seguro que sí.', type: 'claim', respond: false }, undefined, bot),
    ).rejects.toMatchObject({ type: 'validation', message: 'Solo la salida de un agente lleva tipo de observación.' });
    // No puede atribuir su lote a una ejecución ni a un context pack: el canal lo anula.
    const r = await cmd(
      'batch.submit',
      {
        run_id: '00000000-0000-7000-8000-00000000000a',
        context_pack_id: '00000000-0000-7000-8000-00000000000b',
        proposals: [{ type: 'exploration', payload: { purpose: 'x' } }],
      },
      undefined,
      bot,
    );
    const batch = await s.db
      .selectFrom('proposal_batches')
      .select(['run_id', 'context_pack_id', 'producer'])
      .where('id', '=', r.entityId)
      .executeTakeFirstOrThrow();
    expect(batch).toEqual({ run_id: null, context_pack_id: null, producer: 'agent:bot:sesion-z' });
  });

  it('AC-DIS-001-11 un agente no puede añadir propuestas a un lote ajeno ni fuera de un envío', async () => {
    const { batchId } = await newBatch(s, projectId, true);
    const bot = externalAgent('bot', 'sesion-y');
    const attempt = cmd(
      'proposal.create',
      { batch_id: batchId, position: 9, type: 'exploration', payload: { purpose: 'sneak' } },
      undefined,
      bot,
    );
    await expect(attempt).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Las propuestas se envían dentro de un lote (batch.submit).'],
    });
  });

  it('AC-DIS-001-16 una propuesta que depende de una versión que cambió queda obsoleta y no se acepta', async () => {
    const d = await newDecision(s, projectId, true);
    const dep = { type: 'record', id: d.recordId, code: d.code, version: 1 };
    const r = await cmd(
      'batch.submit',
      { proposals: [{ type: 'exploration', payload: { purpose: 'Diseñar sobre la v1' }, dependencies: [dep] }] },
      undefined,
      system('test'),
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    // Un cambio humano posterior: se aprueba la v2 de la decisión.
    const v2 = await cmd('record_version.create', {
      record_id: d.recordId,
      title: 'v2',
      sections: [
        { title: 'Context', content: 'c' },
        { title: 'Decisión', content: 'd' },
        { title: 'Consequences', content: 'k' },
      ],
      change_note: 'Change.',
    });
    await cmd('record_version.approve', {}, v2.entityId);
    const row = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', proposal ?? '')
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('superseded');
    expect(JSON.stringify(row.resolution)).toMatch(/ha cambiado \(vigente: v2; la propuesta partía de v1\)/);
    await expect(cmd('proposal.accept', {}, proposal)).rejects.toMatchObject({ type: 'invalid_transition' });
  });

  it('AC-DIS-001-16 una propuesta que nace con una dependencia que no es la vigente queda obsoleta desde el envío', async () => {
    const d = await newDecision(s, projectId, true);
    await newDecisionVersion(d.recordId);
    // La dependencia declara la v1, pero la vigente ya es la v2.
    const r = await cmd(
      'batch.submit',
      { proposals: [{ type: 'exploration', payload: { purpose: 'x' }, dependencies: [dependency(d)] }] },
      undefined,
      system('test'),
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    const row = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', proposal ?? '')
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('superseded');
    expect(JSON.stringify(row.resolution)).toMatch(/La propuesta está obsoleta: .* \(vigente: v2; la propuesta partía de v1\)/);
    await expect(cmd('proposal.accept', {}, proposal)).rejects.toMatchObject({
      type: 'invalid_transition',
      message: expect.stringContaining('Obsolete'),
    });
  });

  it('AC-DIS-001-16 depender de un borrador sin versión aprobada no hace obsoleta la propuesta; descartarlo sí', async () => {
    const d = await newDecision(s, projectId, false);
    const r = await cmd(
      'batch.submit',
      { proposals: [{ type: 'exploration', payload: { purpose: 'Revisar el borrador' }, dependencies: [dependency(d)] }] },
      undefined,
      system('test'),
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    // Las revisiones del conocimiento sobre borradores (p. ej. lo importado de design/) llegan a la bandeja.
    expect(await stateOf('proposals', proposal ?? '')).toBe('pending');
    await cmd('record_version.discard', { reason: 'No sigue.' }, d.versionId);
    const row = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', proposal ?? '')
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('superseded');
    expect(JSON.stringify(row.resolution)).toMatch(/la versión 1 de .* se ha descartado/);
  });

  it('AC-DIS-001-16 una FDR basada en una versión y que declara otra del mismo registro nace obsoleta', async () => {
    const d = await newDecision(s, projectId, true);
    await newDecisionVersion(d.recordId);
    const r = await cmd(
      'batch.submit',
      {
        proposals: [
          {
            type: 'fdr',
            payload: {
              title: 'Alta de socios',
              goal: 'o',
              scope: 'a',
              out_of_scope: 'f',
              behavior: 'c',
              criteria: [
                {
                  title: 'Alta',
                  statement: 'Cuando envía, entonces ve la confirmación.',
                  verification: 'automatic',
                  check: 'E2E.',
                },
              ],
              based_on: { code: d.code, version: 1 },
            },
            dependencies: [dependency(d, 2)],
          },
        ],
      },
      undefined,
      externalAgent('bot', 'sesion-dos'),
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    expect(await stateOf('proposals', proposal ?? '')).toBe('superseded');
  });

  it('AC-DIS-001-16 una propuesta de un paquete no queda obsoleta suelta: queda obsoleto el paquete', async () => {
    const { proposals } = await newBatch(s, projectId, true);
    await expect(cmd('proposal.supersede', { reason: 'x' }, proposals[0], system('test'))).rejects.toMatchObject({
      type: 'guard',
      reasons: ['Esta propuesta forma parte de un paquete: queda obsoleto el paquete completo.'],
    });
  });

  it('AC-DIS-001-06 un paquete cuyo lote depende de la FDR la afecta, y descartar la versión enlazada deja el enlace en revisión', async () => {
    const decision = await newDecision(s, projectId, true);
    const f = await fdrOn(decision, { approve: true });
    await cmd(
      'batch.submit',
      {
        batch_type: 'system_package',
        resolution: 'package',
        dependencies: [dependency(f)],
        proposals: [{ type: 'exploration', payload: { purpose: 'Revisar la FDR' } }],
      },
      undefined,
      system('test'),
    );
    expect((await versionReadiness(s.db, projectId, f.versionId)).reasons).toContain(
      'Hay 1 propuesta(s) pendiente(s) que la afectan.',
    );
    // Un borrador enlazado que se descarta: el enlace queda pendiente de revisión.
    const draft = await newDecision(s, projectId, false);
    const g = await fdrOn(draft);
    await cmd('record_version.discard', {}, draft.versionId);
    const link = await s.db.selectFrom('links').select('state').where('from_id', '=', g.versionId).executeTakeFirstOrThrow();
    expect(link.state).toBe('needs_review');
  });

  it('AC-DIS-001-16 un paquete cuyo lote depende de una versión que cambió queda obsoleto entero', async () => {
    const d = await newDecision(s, projectId, true);
    const r = await cmd(
      'batch.submit',
      {
        batch_type: 'system_package',
        resolution: 'package',
        dependencies: [dependency(d)],
        proposals: [
          { type: 'exploration', payload: { purpose: 'a' } },
          { type: 'exploration', payload: { purpose: 'b' } },
        ],
      },
      undefined,
      system('test'),
    );
    const { proposals } = r.result as { proposals: string[] };
    await newDecisionVersion(d.recordId);
    expect(await stateOf('proposal_batches', r.entityId)).toBe('superseded');
    for (const p of proposals) expect(await stateOf('proposals', p)).toBe('superseded');
    await expect(cmd('batch.accept_package', {}, r.entityId)).rejects.toMatchObject({ type: 'invalid_transition' });
  });

  it('AC-DIS-001-16 si una propuesta de un paquete queda obsoleta, queda obsoleto el paquete: nunca se acepta a medias', async () => {
    const d = await newDecision(s, projectId, true);
    const r = await cmd(
      'batch.submit',
      {
        batch_type: 'system_package',
        resolution: 'package',
        proposals: [
          { type: 'exploration', payload: { purpose: 'a' }, dependencies: [dependency(d)] },
          { type: 'exploration', payload: { purpose: 'b' } },
        ],
      },
      undefined,
      system('test'),
    );
    await newDecisionVersion(d.recordId);
    expect(await stateOf('proposal_batches', r.entityId)).toBe('superseded');
    const states = await s.db.selectFrom('proposals').select('state').where('batch_id', '=', r.entityId).execute();
    expect(states.map((e) => e.state)).toEqual(['superseded', 'superseded']);
  });

  it('AC-DIS-001-16 una FDR propuesta sobre una decisión depende de ella aunque el agente no lo declare', async () => {
    const d = await newDecision(s, projectId, true);
    const bot = externalAgent('bot', 'sesion-fdr');
    const r = await cmd(
      'batch.submit',
      {
        proposals: [
          {
            type: 'fdr',
            payload: {
              title: 'Alta de socios',
              goal: 'o',
              scope: 'a',
              out_of_scope: 'f',
              behavior: 'c',
              criteria: [
                {
                  title: 'Alta',
                  statement: 'Cuando envía, entonces ve la confirmación.',
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
      bot,
    );
    const [proposal] = (r.result as { proposals: string[] }).proposals;
    const row = await s.db
      .selectFrom('proposals')
      .select('dependencies')
      .where('id', '=', proposal ?? '')
      .executeTakeFirstOrThrow();
    expect(row.dependencies).toEqual([dependency(d)]);
    await newDecisionVersion(d.recordId);
    expect(await stateOf('proposals', proposal ?? '')).toBe('superseded');
  });

  it('AC-NUC-001-05 «aceptar y aprobar» se descompone en comandos de la tabla con su actor y la misma correlación', async () => {
    const { proposals } = await newBatch(s, projectId, false);
    const r = await cmd('proposal.accept', { approve: true }, proposals[0]);
    const acceptance = await s.db
      .selectFrom('events')
      .select('cause')
      .where('command', '=', 'proposal.accept')
      .where('entity_id', '=', proposals[0] ?? '')
      .executeTakeFirstOrThrow();
    const correlation = (acceptance.cause as { correlation: string }).correlation;
    const sameCorrelationEvents = await s.db
      .selectFrom('events')
      .select(['command', 'actor', 'cause'])
      .where('project_id', '=', projectId)
      .where(sql<boolean>`cause->>'correlation' = ${correlation}`)
      .orderBy('seq')
      .execute();
    const commands = new Set(sameCorrelationEvents.map((e) => e.command));
    const expected = ['proposal.accept', 'record.create', 'record_version.create', 'record_version.approve', 'batch.close'];
    expect(expected.filter((c) => !commands.has(c))).toEqual([]);
    // Lo decisivo y lo que crea autoridad lo hace la persona; el cierre del lote y el encolado
    // de «Actualizar conocimiento», el sistema.
    for (const e of sameCorrelationEvents) {
      const fromSystem = ['batch.close', 'knowledge_update.enqueue'].includes(e.command);
      expect({ command: e.command, ofItsActor: e.actor.startsWith(fromSystem ? 'system:' : 'human:') }).toEqual({
        command: e.command,
        ofItsActor: true,
      });
    }
    expect(r.state).toBe('accepted');
  });

  it('un error de dominio lleva el tipo para la API', () => {
    expect(new DomainError('guard', 'x').httpStatus).toBe(409);
  });
});

describe('estado epistémico', () => {
  it('AC-DIS-001-12 cada fila de la tabla de correspondencias lleva su estado epistémico en la bandeja, el estado del producto o su detalle', async () => {
    const pid = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Epistémico' } })).projectId;
    const linkRef = (
      command: Parameters<typeof executeCommand>[1]['command'],
      data: unknown,
      entityId?: string,
      actor: Actor = ana,
    ) => executeCommand(s, { command, actor, projectId: pid, data, ...(entityId ? { entityId } : {}) });

    // Versión aprobada y versión en borrador.
    const approved = await newDecision(s, pid, true);
    const draft = await newDecision(s, pid, false);
    // Propuesta pendiente y propuesta aceptada.
    const isPending = await newBatch(s, pid, false);
    const accepted = await newBatch(s, pid, false);
    await linkRef('proposal.accept', {}, accepted.proposals[0]);
    // Preguntas confirmada, inferida, pendiente y pospuesta.
    const e = await newExploration(s, pid);
    const question = async (text: string) => (await linkRef('question.raise', { exploration_id: e, question: text })).entityId;
    const qConfirmed = await question('¿Confirmada?');
    await linkRef('question.confirm', { conclusion: 'Sí.' }, qConfirmed);
    const qInferred = await question('¿Inferida?');
    await linkRef('question.infer', { conclusion: 'Sí.', reasoning: 'Lo dijo.' }, qInferred, system('exploration'));
    const qPending = await question('¿Pendiente?');
    const qPostponed = await question('¿Pospuesta?');
    await linkRef('question.postpone', { reason: 'Luego.' }, qPostponed);
    // Observaciones de un agente: la salida de una ejecución.
    const run = await linkRef('run.request', { action: 'exploration_chat', scope: { type: 'exploration', id: e } });
    const agent: Actor = { type: 'agent_run', run: run.entityId };
    for (const type of ['claim', 'hypothesis', 'unknown']) {
      await linkRef('message.post', { exploration_id: e, text: `Observación ${type}`, type, respond: false }, undefined, agent);
    }
    // Enlace pendiente de revisión: cambia la decisión en la que se basa una FDR.
    const base = await newDecision(s, pid, true);
    const fdr = await linkRef('record.create', {
      type: 'fdr',
      domain: 'socios',
      title: 'Alta',
      sections: FDR_SECTIONS,
      criteria: [AC('alta')],
      links: [{ type: 'based_on', target: { code: base.code, version: 1 } }],
    });
    await linkRef('record_version.approve', {}, (fdr.result as { versionId: string }).versionId);
    await newDecisionVersion(base.recordId, true, pid);

    const b = await inbox(s.db, pid);
    const state = await productState(s.db, pid);
    const exploration = await explorationDetail(s.db, pid, e);
    const acceptedDetail = await batchDetail(s.db, pid, accepted.batchId);
    const epistemicOf = (id: string) => exploration.questions.find((q) => q.id === id)?.epistemic_status;
    const observation = (type: string) => exploration.messages.find((m) => m.kind === type)?.epistemic_status;
    const rows = {
      'Versión aprobada': state.decisions.find((d) => d.code === approved.code)?.epistemic_status,
      'Versión en borrador (estado)': state.decisions.find((d) => d.code === draft.code)?.epistemic_status,
      'Versión en borrador (bandeja)': b.versions_to_approve.find((v) => v.code === draft.code)?.epistemic_status,
      'Propuesta pendiente': b.batches.find((l) => l.id === isPending.batchId)?.proposals[0]?.epistemic_status,
      'Propuesta aceptada': acceptedDetail.proposals[0]?.epistemic_status,
      'Pregunta confirmada': epistemicOf(qConfirmed),
      'Pregunta inferida': b.questions_to_confirm.find((q) => q.id === qInferred)?.epistemic_status,
      'Pregunta pendiente': b.open_questions.find((q) => q.id === qPending)?.epistemic_status,
      'Pregunta pospuesta': b.open_questions.find((q) => q.id === qPostponed)?.epistemic_status,
      'Observación claim': observation('claim'),
      'Observación hypothesis': observation('hypothesis'),
      'Observación unknown': observation('unknown'),
      'Enlace pendiente de revisión': b.links_under_review[0]?.epistemic_status,
    };
    expect(rows).toEqual({
      'Versión aprobada': 'confirmed',
      'Versión en borrador (estado)': 'proposed',
      'Versión en borrador (bandeja)': 'proposed',
      'Propuesta pendiente': 'proposed',
      'Propuesta aceptada': 'confirmed',
      'Pregunta confirmada': 'confirmed',
      'Pregunta inferida': 'proposed',
      'Pregunta pendiente': 'pending',
      'Pregunta pospuesta': 'pending',
      'Observación claim': 'proposed',
      'Observación hypothesis': 'proposed',
      'Observación unknown': 'unknown',
      'Enlace pendiente de revisión': 'pending',
    });
    // La bandeja cuenta todo lo que espera a la persona, también lo que no viene de un agente.
    expect(b.open_questions).toHaveLength(2);
    // El borrador y la decisión que creó aceptar la propuesta sin aprobarla.
    expect(b.versions_to_approve).toHaveLength(2);
    expect(state.inbox.total).toBe(b.total);
  });
});

describe('proyecto en todas las entidades', () => {
  it('AC-ESQ-001-17 nada se escribe en otro proyecto: ni versiones, ni dependencias, ni siquiera saltándose las guardas', async () => {
    const another = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Other' } })).projectId;
    const foreign = await newDecision(s, another, true);
    await expect(
      cmd('record_version.create', {
        record_id: foreign.recordId,
        title: 'x',
        sections: DECISION_SECTIONS,
        change_note: 'x',
      }),
    ).rejects.toMatchObject({ type: 'guard', reasons: expect.arrayContaining(['El registro no existe en este proyecto.']) });
    await expect(
      cmd(
        'batch.submit',
        { proposals: [{ type: 'exploration', payload: { purpose: 'x' }, dependencies: [dependency(foreign)] }] },
        undefined,
        externalAgent('bot', 'probe'),
      ),
    ).rejects.toMatchObject({ type: 'guard', reasons: [`La dependencia ${foreign.code} v1 no existe en este proyecto.`] });
    await expect(
      sql`insert into record_versions (project_id, record_id, n, title, sections, author, content_hash, state)
          values (${projectId}::uuid, ${foreign.recordId}::uuid, 9, 't', '[]', 'human:ana', 'h', 'draft')`.execute(s.db),
    ).rejects.toThrow(/proyectos distintos/);
    expect(await versions(foreign.recordId)).toMatchObject([{ n: 1, state: 'approved' }]);
  });

  it('AC-ESQ-001-17 toda tabla de dominio lleva project_id y las de autoridad y el diario rechazan DELETE', async () => {
    const withoutProject = await sql<{ table_name: string }>`
      select t.table_name from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        -- Infraestructura sin proyecto: identidad, motor, migraciones, caché por input_hash y evaluaciones del clasificador.
        and t.table_name not in ('projects', 'humans', 'sessions', 'step_completions', 'schema_migrations', 'verdict_cache', 'classifier_evaluations')
        and not exists (select 1 from information_schema.columns c
                        where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'project_id')`.execute(
      s.db,
    );
    expect(withoutProject.rows).toEqual([]);
    // Datos propios: la prueba no depende del orden de las demás.
    const e = await newExploration(s, projectId);
    await cmd('message.post', { exploration_id: e, text: 'Hello', respond: false });
    await cmd('question.raise', { exploration_id: e, question: '¿Algo?' });
    await fdrOn(await newDecision(s, projectId, true));
    await newBatch(s, projectId, false);
    for (const table of [
      'projects',
      'records',
      'record_versions',
      'criteria',
      'links',
      'proposals',
      'proposal_batches',
      'questions',
      'messages',
      'explorations',
      'events',
    ]) {
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}`.execute(s.db);
      expect({ table, withRows: (rows[0]?.n ?? 0) > 0 }).toEqual({ table, withRows: true });
      await expect(sql`delete from ${sql.table(table)}`.execute(s.db)).rejects.toThrow(/DELETE|solo admite INSERT/);
    }
  });
});
