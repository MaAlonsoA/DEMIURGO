// AC de S2 sobre el motor de conocimiento: actualización verificada, invalidar en lugar de
// borrar, reconstrucción con la misma huella, frescura, evaluación de ideas, context packs,
// taxonomía y confianza.

import { randomUUID } from 'node:crypto';
import {
  type Actor,
  type Cambio,
  type Clasificador,
  type Grafo,
  UMBRALES_POR_DEFECTO,
  VEREDICTOS,
  agenteExterno,
  enrutarPorConfianza,
  humano,
  planificar,
  sistema,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComando } from '../src/bus/bus.ts';
import { bandeja } from '../src/consultas/lectura.ts';
import { crearClasificadorEnCascada } from '../src/clasificador/cascada.ts';
import { ACTUALIZADOR } from '../src/conocimiento/comandos.ts';
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

/** Lote de un agente externo con propuestas de un tipo. */
async function loteAgente(proyectoId: string, cargas: Record<string, unknown>[], tipo = 'decision') {
  const r = await cmd(
    proyectoId,
    'batch.submit',
    { propuestas: cargas.map((carga) => ({ tipo, carga })) },
    undefined,
    agenteExterno('bot', 'sesion'),
  );
  return r.resultado as { loteId: string; propuestas: string[] };
}

const cargaDecision = (titulo: string, texto: string) => ({ titulo, contexto: 'c', decision: texto, consecuencias: 'k' });

/** Taxonomía de un eje con una categoría propia y «otra». */
const ejesCon = (cat: string) => [
  {
    codigo: 'area',
    nombre: 'Área',
    categorias: [
      { codigo: cat, nombre: cat, descripcion: `Todo sobre ${cat} y socios.` },
      { codigo: 'otra', nombre: 'Otra', descripcion: 'Otra.' },
    ],
  },
];

/** Clasificador que responde siempre lo mismo, con la confianza de cada posición. */
const fijo = (id: string, eleccion: string, confianzas: number[]): Clasificador => ({
  id,
  choice: async (items) => items.map((i, k) => respuesta(i.id, eleccion, confianzas[k] ?? 0.5)),
  score: async () => [],
  noul: async () => [],
});

/** Nodo con autoridad para las pruebas puras del plan. */
const nodoDePrueba = (ref: string) => ({
  ref,
  tipo: 'decision',
  etiqueta: ref,
  texto: ref,
  categorias: {},
  epistemico: 'confirmado' as const,
  autoridad: true,
  origen: { tipo: 'record_version', id: null, version: 1 },
  desde: 1,
  hasta: null,
});

/** Nodos vigentes de un proyecto como «ref|estado epistémico». */
const vigentes = async (proyectoId: string) =>
  (await nodos(proyectoId))
    .filter((n) => n.valid_to === null)
    .map((n) => `${n.ref}|${n.epistemic}`)
    .sort();

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

  it('AC-CON-001-04 si una revisión no puede proponerse, la actualización se rechaza en lugar de perderla', async () => {
    const p = await nuevoProyecto('Revisión sin origen');
    const t = unico();
    await decision(p, `Base ${t}`, `Algo de base ${t}.`);
    // Un nodo con autoridad cuyo origen no es una versión de este proyecto (p. ej. un grafo alterado).
    await sql`insert into knowledge_nodes (project_id, ref, kind, source_type, source_id, source_version, label, body, epistemic, valid_from, state)
      values (${p}::uuid, 'DEC-ZZZ-009@1', 'decision', 'record_version', ${randomUUID()}::uuid, 1,
              ${`Pago en efectivo ${t}`}, ${`Las cuotas se pagan en efectivo ${t}.`}, 'confirmado', 1, 'current')`.execute(s.db);
    guion.guiones.veredicto = (items) => items.map((i) => respuesta(i.id, 'invalidate', 0.95, 'Sustituida.'));
    await decision(p, `Pago por transferencia ${t}`, `Las cuotas se pagan por transferencia ${t}.`);
    const u = (await actualizaciones(p)).at(-1);
    expect(u?.state).toBe('rejected');
    expect(u?.failure).toMatch(/No se puede proponer la revisión de DEC-ZZZ-009@1/);
  });

  it('AC-CON-001-04 un registro con un dominio con dígitos se rechaza al crearlo: su código no podría citarse', async () => {
    const p = await nuevoProyecto('Dominio con dígitos');
    await expect(
      cmd(p, 'record.create', {
        tipo: 'decision',
        dominio: 'b2b',
        titulo: 'Pago',
        secciones: [
          { titulo: 'Contexto', contenido: 'c' },
          { titulo: 'Decisión', contenido: 'd' },
          { titulo: 'Consecuencias', contenido: 'k' },
        ],
      }),
    ).rejects.toMatchObject({ tipo: 'validacion' });
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

  it('AC-CON-001-06 la reconstrucción reproduce propuestas, descartes, enlaces, rechazos y reintentos, y detecta un grafo alterado', async () => {
    const p = await nuevoProyecto('Reconstruir todo');
    const t = unico();
    const a = await decision(p, `Horario de la sede ${t}`, `La sede abre por la tarde ${t}.`);
    // Una propuesta aceptada sin aprobar se proyecta como propuesta; al descartar el borrador se retira.
    const descartada = await loteAgente(p, [cargaDecision(`Sede por la mañana ${t}`, `La sede abre por la mañana ${t}.`)]);
    const borrador = (await cmd(p, 'proposal.accept', {}, descartada.propuestas[0])).resultado as {
      versionId: string;
      codigo: string;
    };
    expect(await vigentes(p)).toContain(`${borrador.codigo}@1|propuesto`);
    await cmd(p, 'record_version.discard', { motivo: 'No.' }, borrador.versionId);
    expect((await vigentes(p)).some((n) => n.startsWith(`${borrador.codigo}@1`))).toBe(false);
    // «Aceptar y aprobar».
    const aprobada = await loteAgente(p, [cargaDecision(`Sede en agosto ${t}`, `La sede cierra en agosto ${t}.`)]);
    await cmd(p, 'proposal.accept', { aprobar: true }, aprobada.propuestas[0]);
    // Una FDR con su enlace a una decisión.
    await cmd(p, 'record.create', {
      tipo: 'fdr',
      dominio: 'socios',
      titulo: `Reservas de la sede ${t}`,
      secciones: [
        { titulo: 'Objetivo', contenido: 'Reservar la sede.' },
        { titulo: 'Alcance', contenido: 'Formulario.' },
        { titulo: 'Fuera de alcance', contenido: 'Pagos.' },
        { titulo: 'Comportamiento', contenido: 'Se reserva y se confirma.' },
      ],
      criterios: [
        {
          arrastre: 'new',
          titulo: 'Reserva',
          enunciado: 'Cuando se reserva, entonces se confirma.',
          verificacion: 'automatic',
          comprobacion: 'Prueba.',
        },
      ],
      enlaces: [{ tipo: 'based_on', destino: { codigo: a.codigo, version: 1 } }],
    }).then((r) => cmd(p, 'record_version.approve', {}, (r.resultado as { versionId: string }).versionId));
    // Una actualización rechazada, otra aplicada después y el reintento de la rechazada al final.
    guion.guiones.veredicto = () => [];
    await decision(p, `Sede abierta los sábados ${t}`, `La sede abre por la tarde los sábados ${t}.`);
    guion.reiniciar();
    await decision(p, `Llaves de la sede ${t}`, `Cada socio de la junta tiene llave de la sede ${t}.`);
    const rechazada = (await actualizaciones(p)).find((u) => u.state === 'rejected');
    expect(rechazada).toBeDefined();
    await cmd(p, 'knowledge_update.retry', {}, rechazada?.id);
    expect((await actualizaciones(p)).find((u) => u.id === rechazada?.id)?.state).toBe('applied');
    await nuevaVersion(p, a.recordId, `La sede abre por la tarde y los domingos ${t}.`);

    const llamadasAntes = { ...guion.llamadas };
    expect(await compararReconstruccion(s.db, p)).toMatchObject({ iguales: true, deriva: null });
    expect(guion.llamadas).toEqual(llamadasAntes);

    // La reconstrucción parte de la autoridad, no del grafo vivo: un nodo colado a mano la hace divergir.
    await sql`insert into knowledge_nodes (project_id, ref, kind, source_type, label, body, epistemic, valid_from, state)
      values (${p}::uuid, 'DEC-ZZZ-999@1', 'decision', 'manual', 'Colado', 'Colado', 'confirmado', 1, 'current')`.execute(s.db);
    expect(await compararReconstruccion(s.db, p)).toMatchObject({ iguales: false, deriva: expect.stringMatching(/no coincide/) });
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

  it('AC-CON-001-13 una salida que no se verifica no entra en la caché: reintentar vuelve a preguntar y se aplica', async () => {
    const p = await nuevoProyecto('Caché sin veneno');
    const t = unico();
    await decision(p, `Invitados ${t}`, `Cada socio puede traer invitados ${t}.`);
    guion.guiones.veredicto = () => [];
    await decision(p, `Invitados limitados ${t}`, `Cada socio puede traer dos invitados ${t}.`);
    const rechazada = (await actualizaciones(p)).at(-1);
    expect(rechazada?.state).toBe('rejected');
    const guardada = await s.db
      .selectFrom('verdict_cache')
      .select('input_hash')
      .where('input_hash', '=', rechazada?.input_hash ?? '')
      .executeTakeFirst();
    expect(guardada).toBeUndefined();
    guion.reiniciar();
    await cmd(p, 'knowledge_update.retry', {}, rechazada?.id);
    expect(guion.llamadas.veredicto).toBe(1);
    expect((await actualizaciones(p)).at(-1)?.state).toBe('applied');
  });

  it('AC-CON-001-02 un veredicto que cita un nodo que no era candidato o dos veredictos para el mismo candidato dejan el update rejected', async () => {
    const p = await nuevoProyecto('Verificación estricta');
    const t = unico();
    const a = await decision(p, `Cuotas ${t}`, `Los socios pagan una cuota anual ${t}.`);
    // Otra decisión del mismo tema: así hay candidatos y el clasificador responde.
    await decision(p, `Recibos de las cuotas ${t}`, `Los socios pagan la cuota anual ${t} con recibo.`);
    // La versión que se sustituye existe, pero nunca es candidata: la precedencia la decide el código.
    guion.guiones.veredicto = (items, normales) => [...normales, respuesta(`${a.codigo}@1`, 'relate', 0.9)];
    await nuevaVersion(p, a.recordId, `Los socios pagan una cuota anual ${t} en enero.`);
    const u1 = (await actualizaciones(p)).at(-1);
    expect(u1?.state).toBe('rejected');
    expect(u1?.failure).toMatch(/no era candidato/);
    guion.guiones.veredicto = (items, normales) => [...normales, ...normales];
    await decision(p, `Cuotas de enero ${t}`, `Los socios pagan una cuota anual ${t} cada enero.`);
    const u2 = (await actualizaciones(p)).at(-1);
    expect(u2?.state).toBe('rejected');
    expect(u2?.failure).toMatch(/tiene 2 veredictos/);
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

describe('evaluación de ideas: paquetes, citas y fallos', () => {
  it('AC-CON-001-08 las ideas de un paquete de una ejecución se evalúan, con el estado epistémico de la cita y las respuestas inválidas registradas', async () => {
    const p = await nuevoProyecto('Ideas de paquetes');
    const t = unico();
    const texto = `Cada socio puede traer como máximo dos invitados a los eventos ${t}.`;
    const d = await decision(p, `Dos invitados por socio ${t}`, texto);
    const run = await cmd(p, 'run.request', { accion: 'design_proposal', alcance: { tipo: 'record_version', id: d.versionId } });
    guion.guiones.idea = (items, normales) => [...normales, respuesta('DEC-ZZZ-001@1', 'duplicates', 0.9)];
    const lote = await cmd(
      p,
      'batch.submit',
      {
        tipo_lote: 'system_package',
        resolucion: 'package',
        run_id: run.entidadId,
        propuestas: [
          {
            tipo: 'fdr',
            carga: {
              titulo: `Dos invitados por socio ${t}`,
              objetivo: texto,
              alcance: 'Eventos.',
              fuera_de_alcance: 'Pagos.',
              comportamiento: texto,
              criterios: [
                {
                  titulo: 'Tope',
                  enunciado: 'Cuando trae un tercero, entonces se rechaza.',
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
      sistema('diseno'),
    );
    const b = await bandeja(s.db, p);
    const evaluacion = b.lotes.find((l) => l.id === lote.entidadId)?.propuestas[0]?.evaluacion;
    expect(evaluacion).toMatchObject({
      hallazgos: [expect.objectContaining({ cita: `${d.codigo}@1`, estado_epistemico: 'confirmado' })],
      invalidas: [expect.objectContaining({ cita: 'DEC-ZZZ-001@1', motivo: 'No era candidata.' })],
      error: null,
    });
  });

  it('AC-CON-001-08 si la evaluación de una idea falla, queda registrado el error en lugar de quedarse pendiente', async () => {
    const p = await nuevoProyecto('Ideas con fallo');
    const t = unico();
    await decision(p, `Sede ${t}`, `La sede abre por la tarde ${t}.`);
    guion.guiones.idea = () => {
      throw new Error('proveedor caído');
    };
    const lote = await loteAgente(p, [cargaDecision(`Sede por la tarde ${t}`, `La sede abre por la tarde ${t}.`)]);
    const b = await bandeja(s.db, p);
    expect(b.lotes.find((l) => l.id === lote.loteId)?.propuestas[0]?.evaluacion).toMatchObject({
      hallazgos: [],
      error: expect.stringMatching(/proveedor caído/),
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

describe('lo aprobado queda confirmado', () => {
  it('AC-CON-001-09 lo aprobado con «Aceptar y aprobar» queda confirmado en el grafo y entra en el context pack', async () => {
    const p = await nuevoProyecto('Aceptar y aprobar');
    const t = unico();
    const lote = await loteAgente(p, [
      cargaDecision(`Cuota de socios ${t}`, `Los socios pagan una cuota anual de treinta euros ${t}.`),
    ]);
    const aceptada = (await cmd(p, 'proposal.accept', { aprobar: true }, lote.propuestas[0])).resultado as { codigo: string };
    expect((await vigentes(p)).filter((n) => n.startsWith(aceptada.codigo))).toEqual([`${aceptada.codigo}@1|confirmado`]);
    const d = await decision(p, `Recibo de la cuota ${t}`, `La cuota anual de los socios se cobra con recibo ${t}.`);
    const r = await cmd(p, 'run.request', { accion: 'design_proposal', alcance: { tipo: 'record_version', id: d.versionId } });
    const pack = await s.db
      .selectFrom('context_packs')
      .select('content')
      .where('id', '=', (r.resultado as { contextPackId: string }).contextPackId)
      .executeTakeFirstOrThrow();
    const refs = (pack.content as { conocimiento: { ref: string }[] }).conocimiento.map((n) => n.ref);
    expect(refs).toContain(`${aceptada.codigo}@1`);
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

  it('AC-CON-001-15 una categoría o un eje fuera de la taxonomía aprobada rechazan la actualización sin efectos', async () => {
    const p = await nuevoProyecto('Taxonomía cerrada');
    const tx = await cmd(p, 'taxonomy.propose', { codigo: 'TAX-001', titulo: 'Taxonomía', ejes });
    await cmd(p, 'taxonomy.approve', {}, tx.entidadId);
    guion.guiones.categoria = (items) => [
      ...items.map((i) => respuesta(i.id, 'inventada', 0.95)),
      respuesta('eje_fantasma', 'x', 0.99),
    ];
    const d = await decision(p, `Categorías ${unico()}`, 'Datos de los socios.');
    const u = (await actualizaciones(p)).at(-1);
    expect(u?.state).toBe('rejected');
    expect(u?.failure).toMatch(/«inventada» no es una categoría del eje area/);
    expect(u?.failure).toMatch(/eje que no está en la taxonomía: eje_fantasma/);
    expect(await s.db.selectFrom('classifications').select('id').where('project_id', '=', p).execute()).toEqual([]);
    expect((await nodos(p)).some((n) => n.ref === `${d.codigo}@1`)).toBe(false);
    // El comando tampoco la admite aunque se llame directamente.
    const datos = {
      nodo_ref: `${d.codigo}@1`,
      taxonomia_id: tx.entidadId,
      eje: 'area',
      categoria: 'inventada',
      confianza: 0.9,
      justificacion: 'x',
      clasificador: 'prueba@1',
      input_hash: 'h',
      update_id: null,
    };
    await expect(cmd(p, 'classification.record', datos, undefined, ACTUALIZADOR)).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['«inventada» no es una categoría del eje area.'],
    });
  });

  it('AC-CON-001-13 la caché de categorías distingue taxonomías con el mismo código y versión pero otro contenido', async () => {
    const t = unico();
    const categorias: string[][] = [];
    for (const cat of ['socios', 'cuotas']) {
      const p = await nuevoProyecto(`Caché de categorías ${cat}`);
      const tx = await cmd(p, 'taxonomy.propose', { codigo: 'TAX-001', titulo: 'Taxonomía', ejes: ejesCon(cat) });
      await cmd(p, 'taxonomy.approve', {}, tx.entidadId);
      await decision(p, `Alta ${t}`, `Alta de los socios ${t}.`);
      const c = await s.db.selectFrom('classifications').select('category').where('project_id', '=', p).execute();
      categorias.push(c.map((x) => x.category));
    }
    expect(guion.llamadas.categoria).toBe(2);
    expect(categorias[1]?.every((c) => ['cuotas', 'otra'].includes(c))).toBe(true);
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

  it('AC-CLA-001-04 sin revisor, una relación de confianza media no se aplica y queda anotada en la actualización', async () => {
    const p = await nuevoProyecto('Relación media');
    const t = unico();
    const a = await decision(p, `Sede ${t}`, `La sede abre por la tarde ${t}.`);
    guion.guiones.veredicto = (items) => items.map((i) => respuesta(i.id, 'relate', 0.6));
    await decision(p, `Sede en verano ${t}`, `La sede abre por la tarde en verano ${t}.`);
    const u = (await actualizaciones(p)).at(-1);
    expect(u?.state).toBe('applied');
    expect((await cargarGrafo(s.db, p)).aristas.filter((x) => x.tipo === 'relacionado')).toEqual([]);
    expect((u?.operations as { sin_aplicar: unknown[] } | undefined)?.sin_aplicar).toEqual([
      { ref: `${a.codigo}@1`, veredicto: 'relate', confianza: 0.6, ruta: 'revisar_llm' },
    ]);
  });

  it('AC-CLA-001-04 la cascada pasa la confianza media al revisor: si la sube, la relación se aplica', async () => {
    const cascada = crearClasificadorEnCascada(fijo('base@1', 'relate', [0.9, 0.6, 0.3]), fijo('revisor@1', 'relate', [0.95]));
    expect(cascada.id).toBe('base@1>revisor@1');
    const items = ['DEC-AAA-001@1', 'DEC-BBB-001@1', 'DEC-CCC-001@1'].map((id) => ({
      id,
      estado: 'x',
      pregunta: '¿Qué le pasa?',
      opciones: VEREDICTOS,
    }));
    const respuestas = await cascada.choice(items);
    expect(respuestas.map((r) => [r.id, r.confianza, r.revisadoPor ?? null])).toEqual([
      ['DEC-AAA-001@1', 0.9, null],
      ['DEC-BBB-001@1', 0.95, 'revisor@1'],
      ['DEC-CCC-001@1', 0.3, null],
    ]);
    // Con el grafo y el cambio, la media revisada al alza se aplica; la baja queda anotada sin aplicar.
    const g: Grafo = { version: 1, nodos: items.map((i) => nodoDePrueba(i.id)), aristas: [] };
    const { desde: _d, hasta: _h, categorias: _c, ...principal } = nodoDePrueba('DEC-NUE-001@1');
    const cambio: Cambio = { principal, acompañantes: [], aristas: [], sustituye: [] };
    const plan = planificar(g, cambio, {}, respuestas, 2);
    expect(plan.aristasNuevas.map((a) => a.hacia)).toEqual(['DEC-AAA-001@1', 'DEC-BBB-001@1']);
    expect(plan.sinAplicar.map((x) => [x.ref, x.ruta])).toEqual([['DEC-CCC-001@1', 'pendiente_persona']]);
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
    // Una segunda decisión del mismo tema: al volver a proyectar la primera, la segunda es candidata.
    await decision(p, `Sede en verano ${t}`, `La sede abre de lunes a viernes en verano ${t}.`);
    guion.guiones.veredicto = (items) => items.map((i) => respuesta(i.id, 'invalidate', 0.99));
    // Se encola una actualización a mano sobre la primera decisión y se procesa: la autoridad no cambia.
    const antes = await autoridad();
    const v = await s.db
      .selectFrom('record_versions')
      .select('id')
      .where('project_id', '=', p)
      .orderBy('id')
      .executeTakeFirstOrThrow();
    await ejecutarComando(s, {
      comando: 'knowledge_update.enqueue',
      actor: ACTUALIZADOR,
      proyectoId: p,
      datos: { objeto: { tipo: 'record_version', id: v.id, version: 1 } },
    });
    expect(guion.llamadas.veredicto).toBeGreaterThan(0);
    expect((await actualizaciones(p)).at(-1)?.state).toBe('applied');
    expect(await autoridad()).toEqual(antes);
    // Lo que invalidaría la autoridad salió como propuesta de revisión.
    expect((await bandeja(s.db, p)).lotes.filter((l) => l.tipo === 'knowledge')).toHaveLength(1);
  });

  it('AC-CON-001-12 el componente del conocimiento no ejecuta comandos de autoridad aunque la matriz los permita a system', async () => {
    const p = await nuevoProyecto('Componente');
    const d = await decision(p, `Aprobada ${unico()}`, 'Algo aprobado.');
    const sustituir = (actor: Actor) =>
      ejecutarComando(s, { comando: 'record_version.supersede', actor, proyectoId: p, entidadId: d.versionId, datos: {} });
    await expect(sustituir(ACTUALIZADOR)).rejects.toMatchObject({ tipo: 'prohibido' });
    // Y ningún componente sustituye una versión aprobada sin otra aprobada posterior.
    await expect(sustituir(sistema('versiones'))).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['Una versión aprobada solo queda sustituida cuando se aprueba otra posterior.'],
    });
    const v = await s.db.selectFrom('record_versions').select('state').where('id', '=', d.versionId).executeTakeFirstOrThrow();
    expect(v.state).toBe('approved');
  });
});
