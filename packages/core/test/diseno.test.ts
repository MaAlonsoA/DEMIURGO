// AC de S1 sobre el núcleo (sin HTTP): versiones, criterios, preguntas, readiness y lotes.

import { type Actor, ErrorDominio, agenteExterno, humano, sistema } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComando } from '../src/bus/bus.ts';
import { readinessDeVersion } from '../src/consultas/lectura.ts';
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
    expect((await readinessDeVersion(s.db, proyectoId, f.versionId)).motivos).toContain('La versión 1 no está aprobada.');

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

  it('AC-DIS-001-14 un criterio no observable recibe un aviso, nunca un bloqueo', async () => {
    const decision = await nuevaDecision(s, proyectoId, true);
    const f = await fdrSobre(decision, {
      aprobar: true,
      criterios: [{ ...AC('x'), titulo: 'Rápido', enunciado: 'El alta es rápida e intuitiva.' }],
    });
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
    expect(JSON.stringify(fila.resolution)).toMatch(/versión vigente nueva \(v2\)/);
    await expect(cmd('proposal.accept', {}, propuesta)).rejects.toMatchObject({ tipo: 'transicion_invalida' });
  });

  it('AC-DIS-001-16 la guarda de dependencias rechaza aceptar con aviso de obsolescencia', async () => {
    const d = await nuevaDecision(s, proyectoId, false);
    // La dependencia declara la v1 vigente, pero la decisión no está aprobada: está obsoleta desde el principio.
    const r = await cmd(
      'batch.submit',
      {
        propuestas: [
          {
            tipo: 'exploracion',
            carga: { proposito: 'x' },
            dependencias: [{ tipo: 'record', id: d.recordId, codigo: d.codigo, version: 1 }],
          },
        ],
      },
      undefined,
      sistema('prueba'),
    );
    const [propuesta] = (r.resultado as { propuestas: string[] }).propuestas;
    await expect(cmd('proposal.accept', {}, propuesta)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: [expect.stringContaining('La propuesta está obsoleta')],
    });
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

describe('proyecto en todas las entidades', () => {
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
