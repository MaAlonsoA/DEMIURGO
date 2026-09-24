// AC de S1 sobre el núcleo (sin HTTP): versiones, criterios, preguntas, readiness y lotes.

import { type Actor, ErrorDominio, agenteExterno, humano, sistema } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComando } from '../src/bus/bus.ts';
import { bandeja, detalleExploracion, detalleLote, estadoProducto, readinessDeVersion } from '../src/consultas/lectura.ts';
import type { Servicios } from '../src/servicios.ts';
import { usarEntorno } from './soporte/entorno.ts';
import { nuevaDecision, nuevaExploracion, nuevoLote } from './soporte/recetas.ts';

const entorno = usarEntorno();
const ana = humano('ana');
let s: Servicios;
let proyectoId = '';

beforeAll(async () => {
  s = entorno().servicios;
  proyectoId = (await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Diseño' } })).proyectoId;
});

const cmd = (comando: Parameters<typeof ejecutarComando>[1]['comando'], datos: unknown, entidadId?: string, actor: Actor = ana) =>
  ejecutarComando(s, { comando, actor, proyectoId, datos, ...(entidadId ? { entidadId } : {}) });

const SECCIONES_FDR = [
  { titulo: 'Objetivo', contenido: 'Que los socios se den de alta.' },
  { titulo: 'Alcance', contenido: 'Alta con nombre y correo.' },
  { titulo: 'Fuera de alcance', contenido: 'Pagos.' },
  { titulo: 'Comportamiento', contenido: 'La persona rellena el formulario y ve la confirmación.' },
];
const AC = (titulo: string) => ({
  arrastre: 'new' as const,
  titulo,
  enunciado: `Dado un socio nuevo, cuando envía el formulario de ${titulo}, entonces ve la confirmación.`,
  verificacion: 'automatic' as const,
  comprobacion: 'Prueba de extremo a extremo del formulario.',
});

async function fdrSobre(
  decision: { codigo: string },
  opciones: { criterios?: unknown[]; aprobar?: boolean; origen?: unknown } = {},
) {
  const r = await cmd('record.create', {
    tipo: 'fdr',
    dominio: 'socios',
    titulo: 'Alta de socios',
    secciones: SECCIONES_FDR,
    criterios: opciones.criterios ?? [AC('alta'), AC('baja')],
    enlaces: [{ tipo: 'based_on', destino: { codigo: decision.codigo, version: 1 } }],
    ...(opciones.origen ? { origen: opciones.origen } : {}),
  });
  const res = r.resultado as { recordId: string; versionId: string; codigo: string };
  if (opciones.aprobar) await cmd('record_version.approve', {}, res.versionId);
  return res;
}

const SECCIONES_DECISION = [
  { titulo: 'Contexto', contenido: 'c2' },
  { titulo: 'Decisión', contenido: 'd2' },
  { titulo: 'Consecuencias', contenido: 'k2' },
];

/** Crea (y por defecto aprueba) una versión nueva de una decisión. */
async function nuevaVersionDecision(recordId: string, aprobar = true, pid = proyectoId): Promise<string> {
  const v = await ejecutarComando(s, {
    comando: 'record_version.create',
    actor: ana,
    proyectoId: pid,
    datos: { record_id: recordId, titulo: 'Decisión revisada', secciones: SECCIONES_DECISION, nota_de_cambio: 'Cambio.' },
  });
  if (aprobar) {
    await ejecutarComando(s, {
      comando: 'record_version.approve',
      actor: ana,
      proyectoId: pid,
      entidadId: v.entidadId,
      datos: {},
    });
  }
  return v.entidadId;
}

const dependencia = (r: { recordId: string; codigo: string }, version = 1) => ({
  tipo: 'record',
  id: r.recordId,
  codigo: r.codigo,
  version,
});

async function estadoDe(tabla: 'proposals' | 'proposal_batches', id: string) {
  return (await s.db.selectFrom(tabla).select('state').where('id', '=', id).executeTakeFirstOrThrow()).state;
}

async function versiones(recordId: string) {
  return s.db.selectFrom('record_versions').select(['id', 'n', 'state']).where('record_id', '=', recordId).orderBy('n').execute();
}

describe('versiones y criterios', () => {
  it('AC-DIS-001-08 aprobar no crea versión: la vigente es la última aprobada y la anterior queda sustituida', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    expect(await versiones(d.recordId)).toMatchObject([{ n: 1, state: 'approved' }]);
    const v2 = await cmd('record_version.create', {
      record_id: d.recordId,
      titulo: 'Decisión revisada',
      secciones: [
        { titulo: 'Contexto', contenido: 'c2' },
        { titulo: 'Decisión', contenido: 'd2' },
        { titulo: 'Consecuencias', contenido: 'k2' },
      ],
      nota_de_cambio: 'Se precisa la decisión.',
    });
    expect(await versiones(d.recordId)).toMatchObject([
      { n: 1, state: 'approved' },
      { n: 2, state: 'draft' },
    ]);
    await cmd('record_version.approve', {}, v2.entidadId);
    expect(await versiones(d.recordId)).toMatchObject([
      { n: 1, state: 'superseded' },
      { n: 2, state: 'approved' },
    ]);
    const supersede = await s.db
      .selectFrom('events')
      .select(['actor', 'cause'])
      .where('command', '=', 'record_version.supersede')
      .where('entity_id', '=', (await versiones(d.recordId))[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(supersede.actor).toBe('system:versiones@1');
  });

  it('AC-DIS-001-08 no se aprueba un borrador anterior a una versión ya aprobada: se descarta', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    const v2 = await nuevaVersionDecision(d.recordId, false);
    const v3 = await nuevaVersionDecision(d.recordId, false);
    await cmd('record_version.approve', {}, v3);
    await expect(cmd('record_version.approve', {}, v2)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['Ya hay una versión aprobada posterior (v3): descarta este borrador o crea una versión nueva.'],
    });
    expect((await readinessDeVersion(s.db, proyectoId, v2)).motivos).toContain(
      'La versión 2 es un borrador anterior a la vigente (v3): solo se puede descartar.',
    );
    expect((await bandeja(s.db, proyectoId)).versiones_por_aprobar.find((v) => v.id === v2)).toMatchObject({ aprobable: false });
    await cmd('record_version.discard', { motivo: 'La sustituye la v3.' }, v2);
    expect(await versiones(d.recordId)).toMatchObject([
      { n: 1, state: 'superseded' },
      { n: 2, state: 'discarded' },
      { n: 3, state: 'approved' },
    ]);
  });

  it('AC-DIS-001-09 los criterios y los enlaces solo nacen con su versión, y la base lo impone', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    const f = await fdrSobre(d, { aprobar: true });
    const soloConSuVersion = 'Los criterios y los enlaces se crean con su versión: crea una versión nueva del registro.';
    const criterio = {
      version_id: f.versionId,
      codigo: `AC-${f.codigo.slice(4)}-07`,
      titulo: 'Colado',
      enunciado: 'Cuando se añade, entonces cambia la versión.',
      verificacion: 'automatic',
      comprobacion: 'Prueba.',
      arrastre: 'kept',
      deriva_de_id: null,
      posicion: 9,
    };
    await expect(cmd('criterion.record', criterio)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: expect.arrayContaining([soloConSuVersion]),
    });
    // Ni siquiera en un borrador: el contenido de la versión se fija al crearla.
    const borrador = await fdrSobre(d);
    await expect(cmd('criterion.record', { ...criterio, version_id: borrador.versionId })).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: [soloConSuVersion],
    });
    await expect(
      cmd('link.create', {
        tipo: 'based_on',
        desde: { tipo: 'record_version', id: f.versionId },
        hacia: { tipo: 'record_version', id: d.versionId },
      }),
    ).rejects.toMatchObject({ tipo: 'guarda', motivos: [soloConSuVersion] });
    // La base lo impide aunque falle una guarda.
    await expect(
      sql`insert into criteria (project_id, record_version_id, code, title, statement, verification, check_text, carry, position, state)
          values (${proyectoId}::uuid, ${f.versionId}::uuid, ${criterio.codigo}, 't', 's', 'automatic', 'c', 'new', 9, 'recorded')`.execute(
        s.db,
      ),
    ).rejects.toThrow(/borrador/);
    await expect(
      sql`insert into links (project_id, type, from_type, from_id, from_version, to_type, to_id, to_version, state, created_by)
          values (${proyectoId}::uuid, 'based_on', 'record_version', ${f.versionId}::uuid, 1, 'record_version', ${d.versionId}::uuid, 1, 'current', 'human:ana')`.execute(
        s.db,
      ),
    ).rejects.toThrow(/borrador/);
  });

  it('AC-DIS-001-09 un criterio nuevo nunca reutiliza el código de uno descartado y una versión nueva exige nota de cambio', async () => {
    const d = await nuevaDecision(s, proyectoId);
    const f = await fdrSobre(d);
    const [c1, c2] = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).orderBy('position').execute()
    ).map((c) => c.code);
    const base = { record_id: f.recordId, titulo: 'v2', secciones: SECCIONES_FDR };
    await expect(
      cmd('record_version.create', { ...base, criterios: [{ arrastre: 'kept', codigo: c1 }], descartados: [c2] }),
    ).rejects.toMatchObject({ tipo: 'guarda', motivos: ['Una versión nueva exige una nota de cambio.'] });
    await cmd('record_version.create', {
      ...base,
      criterios: [{ arrastre: 'kept', codigo: c1 }],
      descartados: [c2],
      nota_de_cambio: 'Se descarta un criterio.',
    });
    const v3 = { ...base, titulo: 'v3', nota_de_cambio: 'Vuelve un criterio.' };
    await expect(
      cmd('record_version.create', {
        ...v3,
        criterios: [
          { arrastre: 'kept', codigo: c1 },
          { ...AC('otro'), codigo: c2 },
        ],
      }),
    ).rejects.toMatchObject({ tipo: 'validacion', message: expect.stringContaining(`${c2} ya se usó`) });
    const r = await cmd('record_version.create', { ...v3, criterios: [{ arrastre: 'kept', codigo: c1 }, AC('otro')] });
    const codigos = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', r.entidadId).orderBy('position').execute()
    ).map((c) => c.code);
    expect(codigos).toEqual([c1, expect.stringMatching(/-03$/)]);
  });

  it('AC-DIS-001-08 crear un registro con una versión explícita (importación) devuelve esa versión', async () => {
    const r = await cmd('record.create', {
      tipo: 'decision',
      dominio: 'socios',
      titulo: 'Importada en su versión 2',
      secciones: SECCIONES_DECISION,
      numero: 2,
      nota_de_cambio: 'Viene de design/.',
    });
    expect(r.resultado).toMatchObject({ version: 2 });
  });

  it('AC-DIS-001-09 la base rechaza modificar una versión o sus criterios', async () => {
    const d = await nuevaDecision(s, proyectoId);
    const f = await fdrSobre(d);
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
    const d = await nuevaDecision(s, proyectoId);
    const f = await fdrSobre(d);
    const codigos = (
      await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).orderBy('position').execute()
    ).map((c) => c.code);
    expect(codigos).toHaveLength(2);
    const base = {
      record_id: f.recordId,
      titulo: 'Alta de socios v2',
      secciones: SECCIONES_FDR,
      nota_de_cambio: 'Cambia un criterio.',
    };
    // Sin decir qué pasa con el segundo criterio: se rechaza con el motivo.
    const sinArrastre = cmd('record_version.create', { ...base, criterios: [{ arrastre: 'kept', codigo: codigos[0] }] });
    await expect(sinArrastre).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: [expect.stringContaining(`${codigos[1]}: mantener, modificar o descartar`)],
    });
    const r = await cmd('record_version.create', {
      ...base,
      criterios: [
        { arrastre: 'kept', codigo: codigos[0] },
        { ...AC('modificado'), arrastre: 'modified', deriva_de: codigos[1] },
        AC('nuevo'),
      ],
    });
    const nuevos = await s.db
      .selectFrom('criteria')
      .select(['code', 'carry', 'derived_from', 'statement'])
      .where('record_version_id', '=', r.entidadId)
      .orderBy('position')
      .execute();
    expect(nuevos.map((c) => [c.code, c.carry])).toEqual([
      [codigos[0], 'kept'],
      [codigos[1], 'modified'],
      [expect.stringMatching(/-03$/), 'new'],
    ]);
    expect(nuevos[0]?.derived_from).not.toBeNull();
    // Descartar también es explícito.
    const v3 = await cmd('record_version.create', {
      ...base,
      titulo: 'v3',
      criterios: [{ arrastre: 'kept', codigo: codigos[0] }],
      descartados: [codigos[1], nuevos[2]?.code],
    });
    expect(v3.estado).toBe('draft');
  });

  it('AC-DIS-001-18 crear o aprobar un registro que no cumple su plantilla se rechaza con lo que falta', async () => {
    const bug = cmd('record.create', {
      tipo: 'bug',
      dominio: 'socios',
      titulo: 'Falla el alta',
      secciones: [
        { titulo: 'Esperado', contenido: 'e' },
        { titulo: 'Observado', contenido: 'o' },
      ],
    });
    await expect(bug).rejects.toMatchObject({ tipo: 'guarda', motivos: [expect.stringContaining('Reproducción')] });
    const vacia = cmd('record.create', {
      tipo: 'decision',
      dominio: 'socios',
      titulo: 'x',
      secciones: [
        { titulo: 'Contexto', contenido: '' },
        { titulo: 'Decisión', contenido: 'd' },
        { titulo: 'Consecuencias', contenido: 'k' },
      ],
    });
    await expect(vacia).rejects.toMatchObject({ tipo: 'guarda', motivos: [expect.stringContaining('está vacía')] });
  });

  it('AC-DIS-001-18 una FDR o un ADR sin una sección de su plantilla se rechaza, y también al aprobar', async () => {
    const fdr = cmd('record.create', {
      tipo: 'fdr',
      dominio: 'socios',
      titulo: 'Sin alcance',
      secciones: SECCIONES_FDR.filter((x) => x.titulo !== 'Alcance'),
      criterios: [AC('alta')],
    });
    await expect(fdr).rejects.toMatchObject({ tipo: 'guarda', motivos: [expect.stringContaining('Alcance')] });
    const adr = cmd('record.create', {
      tipo: 'adr',
      dominio: 'socios',
      titulo: 'Sin opciones',
      secciones: [
        { titulo: 'Contexto', contenido: 'c' },
        { titulo: 'Decisión', contenido: 'd' },
        { titulo: 'Consecuencias', contenido: 'k' },
      ],
      criterios: [AC('alta')],
    });
    await expect(adr).rejects.toMatchObject({ tipo: 'guarda', motivos: [expect.stringContaining('Opciones')] });
    // Al aprobar se vuelve a comprobar: una versión que no la cumple (insertada sin pasar por la guarda de creación).
    const d = await nuevaDecision(s, proyectoId);
    const secciones = JSON.stringify([
      { titulo: 'Contexto', contenido: 'c' },
      { titulo: 'Decisión', contenido: 'd' },
    ]);
    const { rows } = await sql<{ id: string }>`
      insert into record_versions (project_id, record_id, n, title, sections, author, content_hash, state)
      values (${proyectoId}::uuid, ${d.recordId}::uuid, 2, 'Sin consecuencias', ${secciones}::jsonb, 'human:ana', 'h', 'draft')
      returning id`.execute(s.db);
    await expect(cmd('record_version.approve', {}, rows[0]?.id)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: [expect.stringContaining('Consecuencias')],
    });
  });
});

describe('preguntas', () => {
  async function pregunta(): Promise<string> {
    const e = await nuevaExploracion(s, proyectoId);
    return (await cmd('question.raise', { exploracion_id: e, pregunta: '¿Quién paga la cuota?' })).entidadId;
  }

  it('AC-DIS-001-10 confirmar exige conclusión; posponer y descartar exigen motivo; reabrir conserva el historial', async () => {
    const q = await pregunta();
    await expect(cmd('question.confirm', {}, q)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['Hace falta una conclusión.'],
    });
    await expect(cmd('question.postpone', { motivo: '  ' }, q)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['Hace falta un motivo.'],
    });
    await cmd('question.confirm', { conclusion: 'La paga cada socio.' }, q);
    await cmd('question.reopen', { motivo: 'Cambia el reglamento.' }, q);
    const fila = await s.db.selectFrom('questions').selectAll().where('id', '=', q).executeTakeFirstOrThrow();
    expect(fila.state).toBe('pending');
    const historial = await s.db
      .selectFrom('events')
      .select(['command', 'state_before', 'state_after', 'after'])
      .where('entity_id', '=', q)
      .orderBy('seq')
      .execute();
    expect(historial.map((e) => e.command)).toEqual(['question.raise', 'question.confirm', 'question.reopen']);
    expect(historial[1]?.after).toEqual({ conclusion: 'La paga cada socio.' });
    // Reabierta, vuelve sin conclusión: confirmarla otra vez exige una nueva.
    expect(fila.conclusion).toBeNull();
    await expect(cmd('question.confirm', {}, q)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['Hace falta una conclusión.'],
    });
    await expect(cmd('question.discard', {}, q)).rejects.toMatchObject({ tipo: 'guarda' });
    await cmd('question.discard', { motivo: 'Ya no aplica.' }, q);
  });

  it('AC-DIS-001-19 una pregunta solo pasa a inferida por el sistema; un agente no puede inferirla ni confirmarla', async () => {
    const q = await pregunta();
    for (const actor of [
      agenteExterno('bot', 's'),
      { tipo: 'agent_run', run: '00000000-0000-7000-8000-000000000001' } as Actor,
    ]) {
      await expect(cmd('question.infer', { conclusion: 'x' }, q, actor)).rejects.toMatchObject({ tipo: 'prohibido' });
      await expect(cmd('question.confirm', { conclusion: 'x' }, q, actor)).rejects.toMatchObject({ tipo: 'prohibido' });
    }
    await cmd('question.infer', { conclusion: 'Cada socio.', razonamiento: 'Lo dijo la persona.' }, q, sistema('exploracion'));
    const fila = await s.db.selectFrom('questions').select(['state', 'conclusion']).where('id', '=', q).executeTakeFirstOrThrow();
    expect(fila).toEqual({ state: 'inferred', conclusion: 'Cada socio.' });
    // La persona la confirma con la conclusión inferida.
    await cmd('question.confirm', {}, q);
  });
});

describe('readiness', () => {
  it('AC-DIS-001-06 readiness falsa por cada motivo, en lenguaje de producto', async () => {
    const decision = await nuevaDecision(s, proyectoId, true);
    const lista = await fdrSobre(decision, { aprobar: true });
    expect(await readinessDeVersion(s.db, proyectoId, lista.versionId)).toEqual({ listo: true, motivos: [], avisos: [] });

    // Versión no aprobada.
    const borrador = await fdrSobre(decision);
    expect((await readinessDeVersion(s.db, proyectoId, borrador.versionId)).motivos).toContain('La versión 1 no está aprobada.');

    // Sin criterios.
    const sinAc = await fdrSobre(decision, { criterios: [], aprobar: true });
    expect((await readinessDeVersion(s.db, proyectoId, sinAc.versionId)).motivos).toContain('No tiene criterios de aceptación.');

    // Sin decisión aprobada.
    const sinDecision = await nuevaDecision(s, proyectoId, false);
    const fSinDecision = await fdrSobre(sinDecision, { aprobar: true });
    expect((await readinessDeVersion(s.db, proyectoId, fSinDecision.versionId)).motivos).toContain(
      `La decisión ${sinDecision.codigo} en la que se basa no está aprobada.`,
    );

    // No vigente: aprobar una v2 de la FDR deja la v1 sustituida.
    const f = await fdrSobre(decision, { aprobar: true });
    const v2 = await cmd('record_version.create', {
      record_id: f.recordId,
      titulo: 'Alta v2',
      secciones: SECCIONES_FDR,
      criterios: (await s.db.selectFrom('criteria').select('code').where('record_version_id', '=', f.versionId).execute()).map(
        (c) => ({ arrastre: 'kept', codigo: c.code }),
      ),
      enlaces: [{ tipo: 'based_on', destino: { codigo: decision.codigo, version: 1 } }],
      nota_de_cambio: 'Revisión.',
    });
    await cmd('record_version.approve', {}, v2.entidadId);
    expect((await readinessDeVersion(s.db, proyectoId, f.versionId)).motivos).toContain(
      'La versión 1 está sustituida: la vigente es la 2.',
    );

    // Decisión no vigente y enlace pendiente de revisión: se aprueba una v2 de la decisión.
    const d2 = await nuevaDecision(s, proyectoId, true);
    const fd2 = await fdrSobre(d2, { aprobar: true });
    const nueva = await cmd('record_version.create', {
      record_id: d2.recordId,
      titulo: 'Decisión v2',
      secciones: [
        { titulo: 'Contexto', contenido: 'c' },
        { titulo: 'Decisión', contenido: 'otra' },
        { titulo: 'Consecuencias', contenido: 'k' },
      ],
      nota_de_cambio: 'Cambia la decisión.',
    });
    await cmd('record_version.approve', {}, nueva.entidadId);
    const motivos = (await readinessDeVersion(s.db, proyectoId, fd2.versionId)).motivos;
    expect(motivos).toContain(`Se basa en ${d2.codigo} v1, pero la vigente es la v2.`);
    expect(motivos).toContain(`El enlace con ${d2.codigo} está pendiente de revisión.`);

    // Preguntas pendientes o pospuestas en la exploración de origen.
    const e = await nuevaExploracion(s, proyectoId);
    await cmd('question.raise', { exploracion_id: e, pregunta: '¿Hay invitados?' });
    const q2 = (await cmd('question.raise', { exploracion_id: e, pregunta: '¿Cuotas reducidas?' })).entidadId;
    await cmd('question.postpone', { motivo: 'Luego.' }, q2);
    const conPreguntas = await fdrSobre(decision, { aprobar: true, origen: { tipo: 'exploration', id: e } });
    const mp = (await readinessDeVersion(s.db, proyectoId, conPreguntas.versionId)).motivos;
    expect(mp).toContain('Hay 1 pregunta(s) pendiente(s) en la exploración de origen.');
    expect(mp).toContain('Hay 1 pregunta(s) pospuesta(s) en la exploración de origen.');

    // Propuestas pendientes que la afectan.
    const afectada = await fdrSobre(decision, { aprobar: true });
    await cmd(
      'batch.submit',
      {
        propuestas: [
          {
            tipo: 'exploracion',
            carga: { proposito: 'Revisar el alta' },
            dependencias: [{ tipo: 'record', id: afectada.recordId, codigo: afectada.codigo, version: 1 }],
          },
        ],
      },
      undefined,
      sistema('prueba'),
    );
    expect((await readinessDeVersion(s.db, proyectoId, afectada.versionId)).motivos).toContain(
      'Hay 1 propuesta(s) pendiente(s) que la afectan.',
    );
  });

  it('AC-DIS-001-06 las preguntas abiertas se buscan en la exploración de origen: propuesta → lote → ejecución → alcance', async () => {
    const decision = await nuevaDecision(s, proyectoId, true);
    const e = await nuevaExploracion(s, proyectoId);
    await cmd('question.raise', { exploracion_id: e, pregunta: '¿Hay cuota familiar?' });
    const run = await cmd('run.request', { accion: 'exploration_chat', alcance: { tipo: 'exploration', id: e } });
    const lote = await cmd(
      'batch.submit',
      {
        run_id: run.entidadId,
        propuestas: [
          {
            tipo: 'fdr',
            carga: {
              titulo: 'Alta de socios',
              objetivo: 'o',
              alcance: 'a',
              fuera_de_alcance: 'f',
              comportamiento: 'c',
              criterios: [
                {
                  titulo: 'Alta',
                  enunciado: 'Cuando envía, entonces ve la confirmación.',
                  verificacion: 'automatic',
                  comprobacion: 'E2E.',
                },
              ],
              basado_en: { codigo: decision.codigo, version: 1 },
            },
          },
        ],
      },
      undefined,
      sistema('prueba'),
    );
    const [propuesta] = (lote.resultado as { propuestas: string[] }).propuestas;
    const efecto = (await cmd('proposal.accept', { aprobar: true }, propuesta)).resultado as { versionId: string };
    expect((await readinessDeVersion(s.db, proyectoId, efecto.versionId)).motivos).toEqual([
      'Hay 1 pregunta(s) pendiente(s) en la exploración de origen.',
    ]);
  });

  it('AC-DIS-001-14 un criterio no observable recibe un aviso, nunca un bloqueo', async () => {
    const decision = await nuevaDecision(s, proyectoId, true);
    const f = (await fdrSobre(decision, {
      aprobar: true,
      criterios: [{ ...AC('x'), titulo: 'Rápido', enunciado: 'El alta es rápida e intuitiva.' }, AC('bueno')],
    })) as unknown as { versionId: string; codigo: string; avisos: string[] };
    // El aviso llega al registrar el AC; el que cumple la regla no recibe ninguno.
    const prefijo = `AC-${f.codigo.slice(4)}`;
    expect(f.avisos.join(' ')).toMatch(new RegExp(`${prefijo}-01: el enunciado no describe un resultado observable`));
    expect(f.avisos.join(' ')).toMatch(new RegExp(`${prefijo}-01: «rápida» es vago`));
    expect(f.avisos.filter((a) => a.startsWith(`${prefijo}-02`))).toEqual([]);
    const r = await readinessDeVersion(s.db, proyectoId, f.versionId);
    expect(r.listo).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/no describe un resultado observable/);
    expect(r.avisos.join(' ')).toMatch(/«rápida» es vago|es vago/);
  });
});

describe('lotes y propuestas', () => {
  it('AC-DIS-001-11 un agente externo propone como máximo 10 elementos, por elementos y con su productor visible', async () => {
    const bot = agenteExterno('bot', 'sesion-x');
    const carga = { proposito: 'Explorar invitados' };
    const once = Array.from({ length: 11 }, () => ({ tipo: 'exploracion', carga }));
    await expect(cmd('batch.submit', { propuestas: once }, undefined, bot)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: [expect.stringContaining('como máximo 10')],
    });
    // Aunque pida paquete, el canal lo fija por elementos.
    const r = await cmd(
      'batch.submit',
      { resolucion: 'package', tipo_lote: 'system_package', propuestas: once.slice(0, 10) },
      undefined,
      bot,
    );
    const lote = await s.db.selectFrom('proposal_batches').selectAll().where('id', '=', r.entidadId).executeTakeFirstOrThrow();
    expect(lote).toMatchObject({ kind: 'agent', resolution_mode: 'item', producer: 'agent:bot:sesion-x' });
    const propuestas = await s.db.selectFrom('proposals').select('id').where('batch_id', '=', lote.id).execute();
    expect(propuestas).toHaveLength(10);
    // No se acepta el lote entero: se resuelve elemento a elemento.
    await expect(cmd('batch.accept_package', {}, lote.id)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['Este lote se resuelve elemento a elemento.'],
    });
    await cmd('proposal.accept', {}, propuestas[0]?.id);
    await cmd('proposal.reject', { motivo: 'No ahora.' }, propuestas[1]?.id);
  });

  it('AC-DIS-001-11 una propuesta de un paquete no se acepta ni se rechaza suelta', async () => {
    const { propuestas } = await nuevoLote(s, proyectoId, true);
    const motivo = 'Esta propuesta forma parte de un paquete: se acepta o se rechaza el paquete completo.';
    await expect(cmd('proposal.accept', {}, propuestas[0])).rejects.toMatchObject({ tipo: 'guarda', motivos: [motivo] });
    await expect(cmd('proposal.reject', {}, propuestas[0])).rejects.toMatchObject({ tipo: 'guarda', motivos: [motivo] });
  });

  it('AC-DIS-001-05 un agente externo solo propone decisiones, exploraciones y FDR, sin tipo de observación ni procedencia', async () => {
    const bot = agenteExterno('bot', 'sesion-z');
    for (const tipo of ['revision', 'registro_importado', 'taxonomia_importada']) {
      await expect(cmd('batch.submit', { propuestas: [{ tipo, carga: {} }] }, undefined, bot)).rejects.toMatchObject({
        tipo: 'guarda',
        motivos: expect.arrayContaining([`Un agente externo no puede proponer «${tipo}».`]),
      });
    }
    const e = await nuevaExploracion(s, proyectoId);
    await expect(
      cmd('message.post', { exploracion_id: e, texto: 'Es seguro que sí.', tipo: 'claim', responder: false }, undefined, bot),
    ).rejects.toMatchObject({ tipo: 'validacion', message: 'Solo la salida de un agente lleva tipo de observación.' });
    // No puede atribuir su lote a una ejecución ni a un context pack: el canal lo anula.
    const r = await cmd(
      'batch.submit',
      {
        run_id: '00000000-0000-7000-8000-00000000000a',
        context_pack_id: '00000000-0000-7000-8000-00000000000b',
        propuestas: [{ tipo: 'exploracion', carga: { proposito: 'x' } }],
      },
      undefined,
      bot,
    );
    const lote = await s.db
      .selectFrom('proposal_batches')
      .select(['run_id', 'context_pack_id', 'producer'])
      .where('id', '=', r.entidadId)
      .executeTakeFirstOrThrow();
    expect(lote).toEqual({ run_id: null, context_pack_id: null, producer: 'agent:bot:sesion-z' });
  });

  it('AC-DIS-001-11 un agente no puede añadir propuestas a un lote ajeno ni fuera de un envío', async () => {
    const { loteId } = await nuevoLote(s, proyectoId, true);
    const bot = agenteExterno('bot', 'sesion-y');
    const intento = cmd(
      'proposal.create',
      { lote_id: loteId, posicion: 9, tipo: 'exploracion', carga: { proposito: 'colar' } },
      undefined,
      bot,
    );
    await expect(intento).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['Las propuestas se envían dentro de un lote (batch.submit).'],
    });
  });

  it('AC-DIS-001-16 una propuesta que depende de una versión que cambió queda obsoleta y no se acepta', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    const dep = { tipo: 'record', id: d.recordId, codigo: d.codigo, version: 1 };
    const r = await cmd(
      'batch.submit',
      { propuestas: [{ tipo: 'exploracion', carga: { proposito: 'Diseñar sobre la v1' }, dependencias: [dep] }] },
      undefined,
      sistema('prueba'),
    );
    const [propuesta] = (r.resultado as { propuestas: string[] }).propuestas;
    // Un cambio humano posterior: se aprueba la v2 de la decisión.
    const v2 = await cmd('record_version.create', {
      record_id: d.recordId,
      titulo: 'v2',
      secciones: [
        { titulo: 'Contexto', contenido: 'c' },
        { titulo: 'Decisión', contenido: 'd' },
        { titulo: 'Consecuencias', contenido: 'k' },
      ],
      nota_de_cambio: 'Cambio.',
    });
    await cmd('record_version.approve', {}, v2.entidadId);
    const fila = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', propuesta ?? '')
      .executeTakeFirstOrThrow();
    expect(fila.state).toBe('superseded');
    expect(JSON.stringify(fila.resolution)).toMatch(/ha cambiado \(vigente: v2; la propuesta partía de v1\)/);
    await expect(cmd('proposal.accept', {}, propuesta)).rejects.toMatchObject({ tipo: 'transicion_invalida' });
  });

  it('AC-DIS-001-16 una propuesta que nace con una dependencia que no es la vigente queda obsoleta desde el envío', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    await nuevaVersionDecision(d.recordId);
    // La dependencia declara la v1, pero la vigente ya es la v2.
    const r = await cmd(
      'batch.submit',
      { propuestas: [{ tipo: 'exploracion', carga: { proposito: 'x' }, dependencias: [dependencia(d)] }] },
      undefined,
      sistema('prueba'),
    );
    const [propuesta] = (r.resultado as { propuestas: string[] }).propuestas;
    const fila = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', propuesta ?? '')
      .executeTakeFirstOrThrow();
    expect(fila.state).toBe('superseded');
    expect(JSON.stringify(fila.resolution)).toMatch(/La propuesta está obsoleta: .* \(vigente: v2; la propuesta partía de v1\)/);
    await expect(cmd('proposal.accept', {}, propuesta)).rejects.toMatchObject({
      tipo: 'transicion_invalida',
      message: expect.stringContaining('Obsoleta'),
    });
  });

  it('AC-DIS-001-16 depender de un borrador sin versión aprobada no hace obsoleta la propuesta; descartarlo sí', async () => {
    const d = await nuevaDecision(s, proyectoId, false);
    const r = await cmd(
      'batch.submit',
      { propuestas: [{ tipo: 'exploracion', carga: { proposito: 'Revisar el borrador' }, dependencias: [dependencia(d)] }] },
      undefined,
      sistema('prueba'),
    );
    const [propuesta] = (r.resultado as { propuestas: string[] }).propuestas;
    // Las revisiones del conocimiento sobre borradores (p. ej. lo importado de design/) llegan a la bandeja.
    expect(await estadoDe('proposals', propuesta ?? '')).toBe('pending');
    await cmd('record_version.discard', { motivo: 'No sigue.' }, d.versionId);
    const fila = await s.db
      .selectFrom('proposals')
      .select(['state', 'resolution'])
      .where('id', '=', propuesta ?? '')
      .executeTakeFirstOrThrow();
    expect(fila.state).toBe('superseded');
    expect(JSON.stringify(fila.resolution)).toMatch(/la versión 1 de .* se ha descartado/);
  });

  it('AC-DIS-001-16 una FDR basada en una versión y que declara otra del mismo registro nace obsoleta', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    await nuevaVersionDecision(d.recordId);
    const r = await cmd(
      'batch.submit',
      {
        propuestas: [
          {
            tipo: 'fdr',
            carga: {
              titulo: 'Alta de socios',
              objetivo: 'o',
              alcance: 'a',
              fuera_de_alcance: 'f',
              comportamiento: 'c',
              criterios: [
                {
                  titulo: 'Alta',
                  enunciado: 'Cuando envía, entonces ve la confirmación.',
                  verificacion: 'automatic',
                  comprobacion: 'E2E.',
                },
              ],
              basado_en: { codigo: d.codigo, version: 1 },
            },
            dependencias: [dependencia(d, 2)],
          },
        ],
      },
      undefined,
      agenteExterno('bot', 'sesion-dos'),
    );
    const [propuesta] = (r.resultado as { propuestas: string[] }).propuestas;
    expect(await estadoDe('proposals', propuesta ?? '')).toBe('superseded');
  });

  it('AC-DIS-001-16 una propuesta de un paquete no queda obsoleta suelta: queda obsoleto el paquete', async () => {
    const { propuestas } = await nuevoLote(s, proyectoId, true);
    await expect(cmd('proposal.supersede', { motivo: 'x' }, propuestas[0], sistema('prueba'))).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['Esta propuesta forma parte de un paquete: queda obsoleto el paquete completo.'],
    });
  });

  it('AC-DIS-001-06 un paquete cuyo lote depende de la FDR la afecta, y descartar la versión enlazada deja el enlace en revisión', async () => {
    const decision = await nuevaDecision(s, proyectoId, true);
    const f = await fdrSobre(decision, { aprobar: true });
    await cmd(
      'batch.submit',
      {
        tipo_lote: 'system_package',
        resolucion: 'package',
        dependencias: [dependencia(f)],
        propuestas: [{ tipo: 'exploracion', carga: { proposito: 'Revisar la FDR' } }],
      },
      undefined,
      sistema('prueba'),
    );
    expect((await readinessDeVersion(s.db, proyectoId, f.versionId)).motivos).toContain(
      'Hay 1 propuesta(s) pendiente(s) que la afectan.',
    );
    // Un borrador enlazado que se descarta: el enlace queda pendiente de revisión.
    const borrador = await nuevaDecision(s, proyectoId, false);
    const g = await fdrSobre(borrador);
    await cmd('record_version.discard', {}, borrador.versionId);
    const enlace = await s.db.selectFrom('links').select('state').where('from_id', '=', g.versionId).executeTakeFirstOrThrow();
    expect(enlace.state).toBe('needs_review');
  });

  it('AC-DIS-001-16 un paquete cuyo lote depende de una versión que cambió queda obsoleto entero', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    const r = await cmd(
      'batch.submit',
      {
        tipo_lote: 'system_package',
        resolucion: 'package',
        dependencias: [dependencia(d)],
        propuestas: [
          { tipo: 'exploracion', carga: { proposito: 'a' } },
          { tipo: 'exploracion', carga: { proposito: 'b' } },
        ],
      },
      undefined,
      sistema('prueba'),
    );
    const { propuestas } = r.resultado as { propuestas: string[] };
    await nuevaVersionDecision(d.recordId);
    expect(await estadoDe('proposal_batches', r.entidadId)).toBe('superseded');
    for (const p of propuestas) expect(await estadoDe('proposals', p)).toBe('superseded');
    await expect(cmd('batch.accept_package', {}, r.entidadId)).rejects.toMatchObject({ tipo: 'transicion_invalida' });
  });

  it('AC-DIS-001-16 si una propuesta de un paquete queda obsoleta, queda obsoleto el paquete: nunca se acepta a medias', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    const r = await cmd(
      'batch.submit',
      {
        tipo_lote: 'system_package',
        resolucion: 'package',
        propuestas: [
          { tipo: 'exploracion', carga: { proposito: 'a' }, dependencias: [dependencia(d)] },
          { tipo: 'exploracion', carga: { proposito: 'b' } },
        ],
      },
      undefined,
      sistema('prueba'),
    );
    await nuevaVersionDecision(d.recordId);
    expect(await estadoDe('proposal_batches', r.entidadId)).toBe('superseded');
    const estados = await s.db.selectFrom('proposals').select('state').where('batch_id', '=', r.entidadId).execute();
    expect(estados.map((e) => e.state)).toEqual(['superseded', 'superseded']);
  });

  it('AC-DIS-001-16 una FDR propuesta sobre una decisión depende de ella aunque el agente no lo declare', async () => {
    const d = await nuevaDecision(s, proyectoId, true);
    const bot = agenteExterno('bot', 'sesion-fdr');
    const r = await cmd(
      'batch.submit',
      {
        propuestas: [
          {
            tipo: 'fdr',
            carga: {
              titulo: 'Alta de socios',
              objetivo: 'o',
              alcance: 'a',
              fuera_de_alcance: 'f',
              comportamiento: 'c',
              criterios: [
                {
                  titulo: 'Alta',
                  enunciado: 'Cuando envía, entonces ve la confirmación.',
                  verificacion: 'automatic',
                  comprobacion: 'E2E.',
                },
              ],
              basado_en: { codigo: d.codigo, version: 1 },
            },
          },
        ],
      },
      undefined,
      bot,
    );
    const [propuesta] = (r.resultado as { propuestas: string[] }).propuestas;
    const fila = await s.db
      .selectFrom('proposals')
      .select('dependencies')
      .where('id', '=', propuesta ?? '')
      .executeTakeFirstOrThrow();
    expect(fila.dependencies).toEqual([dependencia(d)]);
    await nuevaVersionDecision(d.recordId);
    expect(await estadoDe('proposals', propuesta ?? '')).toBe('superseded');
  });

  it('AC-NUC-001-05 «aceptar y aprobar» se descompone en comandos de la tabla con su actor y la misma correlación', async () => {
    const { propuestas } = await nuevoLote(s, proyectoId, false);
    const r = await cmd('proposal.accept', { aprobar: true }, propuestas[0]);
    const aceptacion = await s.db
      .selectFrom('events')
      .select('cause')
      .where('command', '=', 'proposal.accept')
      .where('entity_id', '=', propuestas[0] ?? '')
      .executeTakeFirstOrThrow();
    const correlacion = (aceptacion.cause as { correlacion: string }).correlacion;
    const delMismo = await s.db
      .selectFrom('events')
      .select(['command', 'actor', 'cause'])
      .where('project_id', '=', proyectoId)
      .where(sql<boolean>`cause->>'correlacion' = ${correlacion}`)
      .orderBy('seq')
      .execute();
    const comandos = new Set(delMismo.map((e) => e.command));
    const esperados = ['proposal.accept', 'record.create', 'record_version.create', 'record_version.approve', 'batch.close'];
    expect(esperados.filter((c) => !comandos.has(c))).toEqual([]);
    // Lo decisivo y lo que crea autoridad lo hace la persona; el cierre del lote y el encolado
    // de «Actualizar conocimiento», el sistema.
    for (const e of delMismo) {
      const delSistema = ['batch.close', 'knowledge_update.enqueue'].includes(e.command);
      expect({ comando: e.command, deSuActor: e.actor.startsWith(delSistema ? 'system:' : 'human:') }).toEqual({
        comando: e.command,
        deSuActor: true,
      });
    }
    expect(r.estado).toBe('accepted');
  });

  it('un error de dominio lleva el tipo para la API', () => {
    expect(new ErrorDominio('guarda', 'x').estadoHttp).toBe(409);
  });
});

describe('estado epistémico', () => {
  it('AC-DIS-001-12 cada fila de la tabla de correspondencias lleva su estado epistémico en la bandeja, el estado del producto o su detalle', async () => {
    const pid = (await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Epistémico' } })).proyectoId;
    const en = (
      comando: Parameters<typeof ejecutarComando>[1]['comando'],
      datos: unknown,
      entidadId?: string,
      actor: Actor = ana,
    ) => ejecutarComando(s, { comando, actor, proyectoId: pid, datos, ...(entidadId ? { entidadId } : {}) });

    // Versión aprobada y versión en borrador.
    const aprobada = await nuevaDecision(s, pid, true);
    const borrador = await nuevaDecision(s, pid, false);
    // Propuesta pendiente y propuesta aceptada.
    const pendiente = await nuevoLote(s, pid, false);
    const aceptada = await nuevoLote(s, pid, false);
    await en('proposal.accept', {}, aceptada.propuestas[0]);
    // Preguntas confirmada, inferida, pendiente y pospuesta.
    const e = await nuevaExploracion(s, pid);
    const pregunta = async (texto: string) => (await en('question.raise', { exploracion_id: e, pregunta: texto })).entidadId;
    const qConfirmada = await pregunta('¿Confirmada?');
    await en('question.confirm', { conclusion: 'Sí.' }, qConfirmada);
    const qInferida = await pregunta('¿Inferida?');
    await en('question.infer', { conclusion: 'Sí.', razonamiento: 'Lo dijo.' }, qInferida, sistema('exploracion'));
    const qPendiente = await pregunta('¿Pendiente?');
    const qPospuesta = await pregunta('¿Pospuesta?');
    await en('question.postpone', { motivo: 'Luego.' }, qPospuesta);
    // Observaciones de un agente: la salida de una ejecución.
    const run = await en('run.request', { accion: 'exploration_chat', alcance: { tipo: 'exploration', id: e } });
    const agente: Actor = { tipo: 'agent_run', run: run.entidadId };
    for (const tipo of ['claim', 'hypothesis', 'unknown']) {
      await en('message.post', { exploracion_id: e, texto: `Observación ${tipo}`, tipo, responder: false }, undefined, agente);
    }
    // Enlace pendiente de revisión: cambia la decisión en la que se basa una FDR.
    const base = await nuevaDecision(s, pid, true);
    const fdr = await en('record.create', {
      tipo: 'fdr',
      dominio: 'socios',
      titulo: 'Alta',
      secciones: SECCIONES_FDR,
      criterios: [AC('alta')],
      enlaces: [{ tipo: 'based_on', destino: { codigo: base.codigo, version: 1 } }],
    });
    await en('record_version.approve', {}, (fdr.resultado as { versionId: string }).versionId);
    await nuevaVersionDecision(base.recordId, true, pid);

    const b = await bandeja(s.db, pid);
    const estado = await estadoProducto(s.db, pid);
    const exploracion = await detalleExploracion(s.db, pid, e);
    const detalleAceptada = await detalleLote(s.db, pid, aceptada.loteId);
    const epistemicoDe = (id: string) => exploracion.preguntas.find((q) => q.id === id)?.estado_epistemico;
    const observacion = (tipo: string) => exploracion.mensajes.find((m) => m.kind === tipo)?.estado_epistemico;
    const filas = {
      'Versión aprobada': estado.decisiones.find((d) => d.codigo === aprobada.codigo)?.estado_epistemico,
      'Versión en borrador (estado)': estado.decisiones.find((d) => d.codigo === borrador.codigo)?.estado_epistemico,
      'Versión en borrador (bandeja)': b.versiones_por_aprobar.find((v) => v.codigo === borrador.codigo)?.estado_epistemico,
      'Propuesta pendiente': b.lotes.find((l) => l.id === pendiente.loteId)?.propuestas[0]?.estado_epistemico,
      'Propuesta aceptada': detalleAceptada.propuestas[0]?.estado_epistemico,
      'Pregunta confirmada': epistemicoDe(qConfirmada),
      'Pregunta inferida': b.preguntas_por_confirmar.find((q) => q.id === qInferida)?.estado_epistemico,
      'Pregunta pendiente': b.preguntas_abiertas.find((q) => q.id === qPendiente)?.estado_epistemico,
      'Pregunta pospuesta': b.preguntas_abiertas.find((q) => q.id === qPospuesta)?.estado_epistemico,
      'Observación claim': observacion('claim'),
      'Observación hypothesis': observacion('hypothesis'),
      'Observación unknown': observacion('unknown'),
      'Enlace pendiente de revisión': b.enlaces_en_revision[0]?.estado_epistemico,
    };
    expect(filas).toEqual({
      'Versión aprobada': 'confirmado',
      'Versión en borrador (estado)': 'propuesto',
      'Versión en borrador (bandeja)': 'propuesto',
      'Propuesta pendiente': 'propuesto',
      'Propuesta aceptada': 'confirmado',
      'Pregunta confirmada': 'confirmado',
      'Pregunta inferida': 'propuesto',
      'Pregunta pendiente': 'pendiente',
      'Pregunta pospuesta': 'pendiente',
      'Observación claim': 'propuesto',
      'Observación hypothesis': 'propuesto',
      'Observación unknown': 'desconocido',
      'Enlace pendiente de revisión': 'pendiente',
    });
    // La bandeja cuenta todo lo que espera a la persona, también lo que no viene de un agente.
    expect(b.preguntas_abiertas).toHaveLength(2);
    // El borrador y la decisión que creó aceptar la propuesta sin aprobarla.
    expect(b.versiones_por_aprobar).toHaveLength(2);
    expect(estado.bandeja.total).toBe(b.total);
  });
});

describe('proyecto en todas las entidades', () => {
  it('AC-ESQ-001-17 nada se escribe en otro proyecto: ni versiones, ni dependencias, ni siquiera saltándose las guardas', async () => {
    const otro = (await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Otro' } })).proyectoId;
    const ajena = await nuevaDecision(s, otro, true);
    await expect(
      cmd('record_version.create', {
        record_id: ajena.recordId,
        titulo: 'x',
        secciones: SECCIONES_DECISION,
        nota_de_cambio: 'x',
      }),
    ).rejects.toMatchObject({ tipo: 'guarda', motivos: expect.arrayContaining(['El registro no existe en este proyecto.']) });
    await expect(
      cmd(
        'batch.submit',
        { propuestas: [{ tipo: 'exploracion', carga: { proposito: 'x' }, dependencias: [dependencia(ajena)] }] },
        undefined,
        agenteExterno('bot', 'sonda'),
      ),
    ).rejects.toMatchObject({ tipo: 'guarda', motivos: [`La dependencia ${ajena.codigo} v1 no existe en este proyecto.`] });
    await expect(
      sql`insert into record_versions (project_id, record_id, n, title, sections, author, content_hash, state)
          values (${proyectoId}::uuid, ${ajena.recordId}::uuid, 9, 't', '[]', 'human:ana', 'h', 'draft')`.execute(s.db),
    ).rejects.toThrow(/proyectos distintos/);
    expect(await versiones(ajena.recordId)).toMatchObject([{ n: 1, state: 'approved' }]);
  });

  it('AC-ESQ-001-17 toda tabla de dominio lleva project_id y las de autoridad y el diario rechazan DELETE', async () => {
    const sinProyecto = await sql<{ table_name: string }>`
      select t.table_name from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        -- Infraestructura sin proyecto: identidad, motor, migraciones, caché por input_hash y evaluaciones del clasificador.
        and t.table_name not in ('projects', 'humans', 'sessions', 'step_completions', 'schema_migrations', 'verdict_cache', 'classifier_evaluations')
        and not exists (select 1 from information_schema.columns c
                        where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'project_id')`.execute(
      s.db,
    );
    expect(sinProyecto.rows).toEqual([]);
    // Datos propios: la prueba no depende del orden de las demás.
    const e = await nuevaExploracion(s, proyectoId);
    await cmd('message.post', { exploracion_id: e, texto: 'Hola', responder: false });
    await cmd('question.raise', { exploracion_id: e, pregunta: '¿Algo?' });
    await fdrSobre(await nuevaDecision(s, proyectoId, true));
    await nuevoLote(s, proyectoId, false);
    for (const tabla of [
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
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(tabla)}`.execute(s.db);
      expect({ tabla, conFilas: (rows[0]?.n ?? 0) > 0 }).toEqual({ tabla, conFilas: true });
      await expect(sql`delete from ${sql.table(tabla)}`.execute(s.db)).rejects.toThrow(/DELETE|solo admite INSERT/);
    }
  });
});
