// AC de S2 sobre el motor de conocimiento: actualización verificada, invalidar en lugar de
// borrar, reconstrucción con la misma huella, frescura, evaluación de ideas, context packs,
// taxonomía y confianza.

import { randomUUID } from 'node:crypto';
import { type Actor, UMBRALES_POR_DEFECTO, agenteExterno, enrutarPorConfianza, humano } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComando } from '../src/bus/bus.ts';
import { bandeja } from '../src/consultas/lectura.ts';
import { compararReconstruccion } from '../src/conocimiento/reconstruir.ts';
import { cargarGrafo, versionDelGrafo } from '../src/conocimiento/grafo-pg.ts';
import type { Servicios } from '../src/servicios.ts';
import { crearClasificadorGuionizado, respuesta } from './soporte/clasificador-guion.ts';
import { usarEntorno } from './soporte/entorno.ts';

const guion = crearClasificadorGuionizado();
const entorno = usarEntorno({ clasificador: () => guion });
const ana = humano('ana');
let s: Servicios;

beforeAll(() => {
  s = entorno().servicios;
});
beforeEach(() => guion.reiniciar());

async function nuevoProyecto(nombre: string): Promise<string> {
  return (await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre } })).proyectoId;
}

const cmd = (
  proyectoId: string,
  comando: Parameters<typeof ejecutarComando>[1]['comando'],
  datos: unknown,
  entidadId?: string,
  actor: Actor = ana,
) => ejecutarComando(s, { comando, actor, proyectoId, datos, ...(entidadId ? { entidadId } : {}) });

async function decision(proyectoId: string, titulo: string, texto: string, aprobar = true) {
  const r = await cmd(proyectoId, 'record.create', {
    tipo: 'decision',
    dominio: 'socios',
    titulo,
    secciones: [
      { titulo: 'Contexto', contenido: `Contexto de ${titulo}.` },
      { titulo: 'Decisión', contenido: texto },
      { titulo: 'Consecuencias', contenido: 'Hay que diseñarlo.' },
    ],
  });
  const res = r.resultado as { recordId: string; versionId: string; codigo: string };
  if (aprobar) await cmd(proyectoId, 'record_version.approve', {}, res.versionId);
  return res;
}

async function nuevaVersion(proyectoId: string, recordId: string, texto: string) {
  const v = await cmd(proyectoId, 'record_version.create', {
    record_id: recordId,
    titulo: 'Versión revisada',
    secciones: [
      { titulo: 'Contexto', contenido: 'Revisión.' },
      { titulo: 'Decisión', contenido: texto },
      { titulo: 'Consecuencias', contenido: 'Hay que rediseñarlo.' },
    ],
    nota_de_cambio: 'Cambia la decisión.',
  });
  await cmd(proyectoId, 'record_version.approve', {}, v.entidadId);
  return v.entidadId;
}

const actualizaciones = (proyectoId: string) =>
  s.db
    .selectFrom('knowledge_updates')
    .selectAll()
    .where('project_id', '=', proyectoId)
    .orderBy('trigger_seq')
    .orderBy('id')
    .execute();
const nodos = (proyectoId: string) =>
  s.db.selectFrom('knowledge_nodes').selectAll().where('project_id', '=', proyectoId).execute();
const unico = () => randomUUID().slice(0, 8);

describe('Actualizar conocimiento', () => {
  it('AC-CON-001-01 aprobar una versión dispara la actualización y sube la versión del grafo', async () => {
    const p = await nuevoProyecto('Disparo');
    expect(await versionDelGrafo(s.db, p)).toBe(0);
    const d = await decision(p, `Alta de socios ${unico()}`, 'Cada socio se da de alta con su correo.');
    const us = await actualizaciones(p);
    expect(us).toHaveLength(1);
    expect(us[0]).toMatchObject({ state: 'applied', trigger: { tipo: 'record_version', id: d.versionId } });
    expect(await versionDelGrafo(s.db, p)).toBe(1);
    const n = await nodos(p);
    expect(n.map((x) => [x.ref, x.epistemic, x.valid_to])).toEqual([[`${d.codigo}@1`, 'confirmado', null]]);
    const evento = await s.db
      .selectFrom('events')
      .select(['actor'])
      .where('command', '=', 'knowledge_update.apply')
      .where('entity_id', '=', us[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(evento.actor).toBe('system:conocimiento@1');
  });

  it('AC-CON-001-02 un conjunto de veredictos que no cubre un candidato deja el update rejected sin efectos', async () => {
    const p = await nuevoProyecto('Sin veredicto');
    const t = unico();
    await decision(p, `Cuotas anuales ${t}`, `Los socios pagan una cuota anual ${t}.`);
    const antes = { version: await versionDelGrafo(s.db, p), nodos: (await nodos(p)).length };
    guion.guiones.veredicto = () => [];
    await decision(p, `Cuotas anuales revisadas ${t}`, `Los socios pagan una cuota anual ${t} en enero.`);
    const us = await actualizaciones(p);
    expect(us.at(-1)).toMatchObject({ state: 'rejected' });
    expect(us.at(-1)?.failure).toMatch(/no tiene veredicto/);
    expect({ version: await versionDelGrafo(s.db, p), nodos: (await nodos(p)).length }).toEqual(antes);
    expect((await bandeja(s.db, p)).actualizaciones_rechazadas).toHaveLength(1);
  });

  it('AC-CON-001-03 un veredicto que cita un nodo inexistente deja el update rejected sin efectos', async () => {
    const p = await nuevoProyecto('Nodo inexistente');
    const t = unico();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    const antes = { version: await versionDelGrafo(s.db, p), nodos: (await nodos(p)).length };
    guion.guiones.veredicto = (items, normales) => [...normales, respuesta('DEC-XXX-999@1', 'relate', 0.9)];
    await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    const u = (await actualizaciones(p)).at(-1);
    expect(u).toMatchObject({ state: 'rejected' });
    expect(u?.failure).toMatch(/nodo inexistente: DEC-XXX-999@1/);
    expect({ version: await versionDelGrafo(s.db, p), nodos: (await nodos(p)).length }).toEqual(antes);
  });

  it('AC-CON-001-04 un veredicto que invalida una decisión aprobada produce una propuesta en la bandeja, nunca un cambio directo', async () => {
    const p = await nuevoProyecto('Invalidar autoridad');
    const t = unico();
    const vieja = await decision(p, `Pago en efectivo ${t}`, `Las cuotas se pagan en efectivo ${t}.`);
    guion.guiones.veredicto = (items) =>
      items.map((i) => respuesta(i.id, 'invalidate', 0.95, 'El pago por transferencia sustituye al efectivo.'));
    await decision(p, `Pago por transferencia ${t}`, `Las cuotas se pagan por transferencia ${t}.`);
    // La decisión vieja sigue aprobada y su nodo sigue vigente.
    const v = await s.db
      .selectFrom('record_versions')
      .select('state')
      .where('id', '=', vieja.versionId)
      .executeTakeFirstOrThrow();
    expect(v.state).toBe('approved');
    const nodoViejo = (await nodos(p)).find((n) => n.ref === `${vieja.codigo}@1`);
    expect(nodoViejo?.valid_to).toBeNull();
    // Y en la bandeja hay una propuesta de revisión del conocimiento, que resuelve la persona.
    const b = await bandeja(s.db, p);
    const lote = b.lotes.find((l) => l.tipo === 'knowledge');
    expect(lote?.productor).toBe('system:conocimiento@1');
    expect(lote?.propuestas[0]).toMatchObject({
      tipo: 'revision',
      carga: { registro: { codigo: vieja.codigo, version: 1 }, veredicto: 'invalidate' },
    });
  });

  it('AC-CON-001-05 lo sustituido queda con valid_to y nunca se borra', async () => {
    const p = await nuevoProyecto('Invalidar');
    const d = await decision(p, `Horario ${unico()}`, 'La sede abre por la tarde.');
    await nuevaVersion(p, d.recordId, 'La sede abre por la mañana.');
    const n = await nodos(p);
    const v1 = n.find((x) => x.ref === `${d.codigo}@1`);
    const v2 = n.find((x) => x.ref === `${d.codigo}@2`);
    expect(v1?.valid_to).toBe('2');
    expect(v2?.valid_to).toBeNull();
    await expect(sql`delete from knowledge_nodes where id = ${v1?.id ?? ''}::uuid`.execute(s.db)).rejects.toThrow(/DELETE/);
    await expect(sql`update knowledge_nodes set valid_to = null where id = ${v1?.id ?? ''}::uuid`.execute(s.db)).rejects.toThrow(
      /solo se invalida/,
    );
  });

  it('AC-CON-001-06 reconstruir con las clasificaciones guardadas da la misma huella', async () => {
    const p = await nuevoProyecto('Reconstruir');
    const t = unico();
    await cmd(p, 'taxonomy.propose', {
      codigo: 'TAX-001',
      titulo: 'Taxonomía',
      ejes: [
        {
          codigo: 'area',
          nombre: 'Área',
          categorias: [
            { codigo: 'socios', nombre: 'Socios', descripcion: 'Alta, baja y datos de los socios.' },
            { codigo: 'cuotas', nombre: 'Cuotas', descripcion: 'Pagos y cuotas de la asociación.' },
            { codigo: 'otra', nombre: 'Otra', descripcion: 'Nada de lo anterior.' },
          ],
        },
      ],
    }).then((r) => cmd(p, 'taxonomy.approve', {}, r.entidadId));
    const a = await decision(p, `Alta de socios ${t}`, `Los socios se dan de alta con su correo ${t}.`);
    const b = await decision(p, `Cuota anual ${t}`, `Los socios pagan una cuota anual ${t}.`);
    await nuevaVersion(p, a.recordId, `Los socios se dan de alta con correo y teléfono ${t}.`);
    await cmd(p, 'record.create', {
      tipo: 'fdr',
      dominio: 'socios',
      titulo: `Alta ${t}`,
      secciones: [
        { titulo: 'Objetivo', contenido: 'Alta de socios.' },
        { titulo: 'Alcance', contenido: 'Formulario.' },
        { titulo: 'Fuera de alcance', contenido: 'Pagos.' },
        { titulo: 'Comportamiento', contenido: 'Se rellena y se confirma.' },
      ],
      criterios: [
        {
          arrastre: 'new',
          titulo: 'Alta',
          enunciado: 'Cuando se envía, entonces se guarda.',
          verificacion: 'automatic',
          comprobacion: 'Prueba.',
        },
      ],
      enlaces: [{ tipo: 'based_on', destino: { codigo: b.codigo, version: 1 } }],
    }).then((r) => cmd(p, 'record_version.approve', {}, (r.resultado as { versionId: string }).versionId));
    const llamadasAntes = { ...guion.llamadas };
    const comparacion = await compararReconstruccion(s.db, p);
    expect(comparacion.iguales).toBe(true);
    expect(comparacion.vivo).toMatch(/^[0-9a-f]{64}$/);
    // La reconstrucción no vuelve a llamar al clasificador: todo sale de lo guardado.
    expect(guion.llamadas).toEqual(llamadasAntes);
    const g = await cargarGrafo(s.db, p);
    expect(g.nodos.some((n) => Object.keys(n.categorias).length > 0)).toBe(true);
  });

  it('AC-CON-001-13 la misma entrada reutiliza los veredictos guardados por input_hash sin llamar al clasificador', async () => {
    const t = unico();
    const texto = `La junta aprueba las altas ${t}.`;
    const p1 = await nuevoProyecto('Caché 1');
    await decision(p1, `Aprobación de altas ${t}`, texto);
    await decision(p1, `Revisión de altas ${t}`, `${texto} Y revisa las bajas.`);
    const llamadas = guion.llamadas.veredicto;
    expect(llamadas).toBeGreaterThan(0);
    const p2 = await nuevoProyecto('Caché 2');
    await decision(p2, `Aprobación de altas ${t}`, texto);
    await decision(p2, `Revisión de altas ${t}`, `${texto} Y revisa las bajas.`);
    expect(guion.llamadas.veredicto).toBe(llamadas);
    const [u1, u2] = [(await actualizaciones(p1)).at(-1), (await actualizaciones(p2)).at(-1)];
    expect(u2?.input_hash).toBe(u1?.input_hash);
    expect(u2?.verdicts).toEqual(u1?.verdicts);
  });
});

describe('frescura', () => {
  it('AC-CON-001-07 con un evento de autoridad sin proyectar, pedir una ejecución se rechaza por grafo desfasado', async () => {
    const p = await nuevoProyecto('Frescura');
    const d = await decision(p, `Frescura ${unico()}`, 'Algo aprobado.');
    // Un evento de autoridad cuya actualización aún no se ha aplicado (p. ej. tras un corte).
    await sql`insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${p}::uuid, ${JSON.stringify({ tipo: 'record_version', id: d.versionId, version: 1 })}::jsonb, 999, 'queued')`.execute(
      s.db,
    );
    const pedir = () =>
      cmd(p, 'run.request', { accion: 'design_proposal', alcance: { tipo: 'record_version', id: d.versionId } });
    await expect(pedir()).rejects.toMatchObject({ tipo: 'guarda', motivos: [expect.stringContaining('no está al día')] });
    await s.motor.iniciarActualizacion('', p);
    await expect(pedir()).resolves.toMatchObject({ estado: 'queued' });
  });
});

describe('evaluación de ideas', () => {
  it('AC-CON-001-08 una idea que duplica una decisión aprobada aparece en la bandeja marcada como duplicado con la cita', async () => {
    const p = await nuevoProyecto('Ideas');
    const t = unico();
    const d = await decision(
      p,
      `Dos invitados por socio ${t}`,
      `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`,
    );
    await cmd(
      p,
      'batch.submit',
      {
        propuestas: [
          {
            tipo: 'decision',
            carga: {
              titulo: `Dos invitados por socio ${t}`,
              contexto: 'Aforo.',
              decision: `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`,
              consecuencias: 'Contarlos.',
            },
          },
        ],
      },
      undefined,
      agenteExterno('bot', 's1'),
    );
    const b = await bandeja(s.db, p);
    const propuesta = b.lotes[0]?.propuestas[0];
    expect(propuesta?.evaluacion).toMatchObject({
      hallazgos: [expect.objectContaining({ hallazgo: 'duplicates', cita: `${d.codigo}@1` })],
    });
  });
});

describe('context packs', () => {
  it('AC-CON-001-09 el pack registra rol, presupuesto, nodos con motivo, versión del grafo, dependencias y hash', async () => {
    const p = await nuevoProyecto('Packs');
    const t = unico();
    await decision(p, `Cuotas ${t}`, `Las cuotas de los socios se pagan cada año ${t}.`);
    const d = await decision(p, `Alta de socios ${t}`, `El alta de los socios exige pagar la cuota ${t}.`);
    const pedir = () =>
      cmd(p, 'run.request', { accion: 'design_proposal', alcance: { tipo: 'record_version', id: d.versionId } });
    const r1 = await pedir();
    const r2 = await pedir();
    const packs = await s.db.selectFrom('context_packs').selectAll().where('project_id', '=', p).execute();
    expect(packs).toHaveLength(1);
    const pack = packs[0];
    expect(pack).toMatchObject({ role: 'disenar', builder: 'design_proposal@1', graph_version: '2' });
    expect(pack?.budget).toMatchObject({ decision: 8000, conocimiento: 4000 });
    const contenido = pack?.content as { conocimiento: { ref: string; motivo: string }[] };
    expect(contenido.conocimiento.length).toBeGreaterThan(0);
    for (const n of contenido.conocimiento) expect(n.motivo).toMatch(/relevancia/);
    expect(pack?.dependencies).toContainEqual({ tipo: 'knowledge_node', id: contenido.conocimiento[0]?.ref, version: 2 });
    expect((r1.resultado as { contextPackHash: string }).contextPackHash).toBe(
      (r2.resultado as { contextPackHash: string }).contextPackHash,
    );
    // Con el grafo cambiado, el pack del mismo alcance es otro.
    await decision(p, `Otra ${t}`, 'Algo distinto.');
    const r3 = await pedir();
    expect((r3.resultado as { contextPackHash: string }).contextPackHash).not.toBe(
      (r1.resultado as { contextPackHash: string }).contextPackHash,
    );
  });
});

describe('taxonomía y confianza', () => {
  const ejes = [
    {
      codigo: 'area',
      nombre: 'Área',
      categorias: [
        { codigo: 'socios', nombre: 'Socios', descripcion: 'Alta, baja y datos de los socios.' },
        { codigo: 'otra', nombre: 'Otra', descripcion: 'Nada de lo anterior.' },
      ],
    },
  ];

  it('AC-CON-001-15 solo se clasifica con la taxonomía aprobada vigente', async () => {
    const p = await nuevoProyecto('Taxonomía');
    await decision(p, `Sin taxonomía ${unico()}`, 'Datos de los socios.');
    const propuesta = await cmd(p, 'taxonomy.propose', { codigo: 'TAX-001', titulo: 'Taxonomía', ejes });
    await decision(p, `Con borrador ${unico()}`, 'Datos de los socios.');
    expect(await s.db.selectFrom('classifications').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
    await cmd(p, 'taxonomy.approve', {}, propuesta.entidadId);
    await decision(p, `Con aprobada ${unico()}`, 'Alta y datos de los socios.');
    const c = await s.db.selectFrom('classifications').selectAll().where('project_id', '=', p).execute();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ taxonomy_id: propuesta.entidadId, axis: 'area', category: 'socios', state: 'applied' });
  });

  it('AC-CON-001-14 una clasificación de confianza baja queda pendiente y aparece en la bandeja', async () => {
    const p = await nuevoProyecto('Confianza');
    const tx = await cmd(p, 'taxonomy.propose', { codigo: 'TAX-001', titulo: 'Taxonomía', ejes });
    await cmd(p, 'taxonomy.approve', {}, tx.entidadId);
    guion.guiones.categoria = (items) => items.map((i) => respuesta(i.id, 'socios', 0.3, 'No estoy seguro.'));
    const d = await decision(p, `Dudosa ${unico()}`, 'Algo ambiguo.');
    const c = await s.db.selectFrom('classifications').selectAll().where('project_id', '=', p).executeTakeFirstOrThrow();
    expect(c).toMatchObject({ state: 'pending_review', confidence: 0.3 });
    const nodo = (await nodos(p)).find((n) => n.ref === `${d.codigo}@1`);
    expect(nodo?.categories).toEqual({});
    const b = await bandeja(s.db, p);
    expect(b.clasificaciones_por_revisar).toEqual([expect.objectContaining({ node_ref: `${d.codigo}@1`, category: 'socios' })]);
    // La persona la resuelve.
    await cmd(p, 'classification.resolve', { categoria: 'socios' }, c.id);
    expect((await bandeja(s.db, p)).clasificaciones_por_revisar).toHaveLength(0);
  });

  it('AC-CLA-001-04 la cascada por umbrales envía la confianza alta a aplicar, la media a revisión y la baja a la persona', () => {
    expect(UMBRALES_POR_DEFECTO).toEqual({ alta: 0.8, media: 0.55 });
    expect(enrutarPorConfianza(0.95)).toBe('aplicar');
    expect(enrutarPorConfianza(0.8)).toBe('aplicar');
    expect(enrutarPorConfianza(0.6)).toBe('revisar_llm');
    expect(enrutarPorConfianza(0.3)).toBe('pendiente_persona');
  });
});

describe('el clasificador no toca la autoridad', () => {
  it('AC-CON-001-12 una actualización solo escribe conocimiento derivado, clasificaciones y propuestas', async () => {
    const p = await nuevoProyecto('Frontera');
    const t = unico();
    await decision(p, `Sede ${t}`, `La sede abre de lunes a viernes ${t}.`);
    const autoridad = async () => {
      const filas = await sql<{ t: string; n: number; h: string }>`
        select 'records' as t, count(*)::int as n, md5(string_agg(r::text, '' order by r.id)) as h from records r where project_id = ${p}::uuid
        union all select 'record_versions', count(*)::int, md5(string_agg(v::text, '' order by v.id)) from record_versions v where project_id = ${p}::uuid
        union all select 'criteria', count(*)::int, md5(string_agg(c::text, '' order by c.id)) from criteria c where project_id = ${p}::uuid
        union all select 'links', count(*)::int, md5(string_agg(l::text, '' order by l.id)) from links l where project_id = ${p}::uuid
        union all select 'taxonomies', count(*)::int, md5(string_agg(x::text, '' order by x.id)) from taxonomies x where project_id = ${p}::uuid
        union all select 'questions', count(*)::int, md5(string_agg(q::text, '' order by q.id)) from questions q where project_id = ${p}::uuid`.execute(
        s.db,
      );
      return filas.rows;
    };
    guion.guiones.veredicto = (items) => items.map((i) => respuesta(i.id, 'invalidate', 0.99));
    // Se encola una actualización a mano sobre la decisión ya aprobada y se procesa: la autoridad no cambia.
    const antes = await autoridad();
    const v = await s.db.selectFrom('record_versions').select('id').where('project_id', '=', p).executeTakeFirstOrThrow();
    await ejecutarComando(s, {
      comando: 'knowledge_update.enqueue',
      actor: { tipo: 'system', componente: 'prueba', version: '1' },
      proyectoId: p,
      datos: { objeto: { tipo: 'record_version', id: v.id, version: 1 } },
    });
    expect(await autoridad()).toEqual(antes);
  });
});
