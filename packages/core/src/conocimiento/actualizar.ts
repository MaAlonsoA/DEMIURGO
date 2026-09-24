// Paso «Actualizar conocimiento» (§7.3): candidatos deterministas → clasificador → verificación
// determinista → aplicación en una transacción con su evento. Los veredictos se guardan por
// input_hash y se reutilizan: la misma entrada da el mismo resultado aplicado.

import {
  type Candidato,
  type Cambio,
  type Clasificador,
  type Grafo,
  type ItemChoice,
  type RespuestaChoice,
  VEREDICTOS,
  enrutarPorConfianza,
  hashEntradaCategorias,
  hashEntradaVeredictos,
  planVacio,
  planificar,
  seleccionarCandidatos,
  verificarVeredictos,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { enTransaccion, ejecutarComando } from '../bus/bus.ts';
import type { Peticion, Resultado } from '../bus/tipos.ts';
import type { Bd, Tx } from '../db/conexion.ts';
import type { Servicios } from '../servicios.ts';
import { ACTUALIZADOR } from './comandos.ts';
import { type ObjetoAutoridad, derivarCambio } from './derivar.ts';
import { cargarGrafo } from './grafo-pg.ts';

export type Eje = { codigo: string; nombre: string; categorias: { codigo: string; nombre: string; descripcion: string }[] };
export type TaxonomiaVigente = { id: string; codigo: string; version: number; ejes: Eje[] };

export async function taxonomiaVigente(db: Bd, proyectoId: string): Promise<TaxonomiaVigente | null> {
  const t = await db
    .selectFrom('taxonomies')
    .select(['id', 'code', 'version', 'axes'])
    .where('project_id', '=', proyectoId)
    .where('state', '=', 'approved')
    .orderBy('code')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  return t ? { id: t.id, codigo: t.code, version: t.version, ejes: t.axes as Eje[] } : null;
}

/** Lee de la caché o pregunta al clasificador y guarda la respuesta (inmutable). */
export async function responderConCache(
  db: Bd,
  clasificador: Clasificador,
  hash: string,
  items: readonly ItemChoice[],
): Promise<{ respuestas: RespuestaChoice[]; desdeCache: boolean }> {
  const previa = await db.selectFrom('verdict_cache').select('answers').where('input_hash', '=', hash).executeTakeFirst();
  if (previa) return { respuestas: previa.answers as RespuestaChoice[], desdeCache: true };
  const respuestas = items.length === 0 ? [] : await clasificador.choice(items);
  await sql`insert into verdict_cache (input_hash, classifier, answers) values (${hash}, ${clasificador.id}, ${JSON.stringify(respuestas)}::jsonb)
    on conflict (input_hash) do nothing`.execute(db);
  return { respuestas, desdeCache: false };
}

export function itemsDeCategorias(cambio: Cambio, taxonomia: TaxonomiaVigente): ItemChoice[] {
  return taxonomia.ejes.map((eje) => ({
    id: eje.codigo,
    estado: {
      tarea: 'categoria',
      eje: eje.codigo,
      categorias: eje.categorias,
      artefacto: { titulo: cambio.principal.etiqueta, texto: cambio.principal.texto },
    },
    pregunta: `¿A qué categoría de «${eje.nombre}» pertenece este artefacto?`,
    opciones: eje.categorias.map((c) => c.codigo),
  }));
}

export function itemsDeVeredictos(cambio: Cambio, candidatos: readonly Candidato[]): ItemChoice[] {
  return candidatos.map((c) => ({
    id: c.ref,
    estado: {
      tarea: 'veredicto',
      cambio: {
        ref: cambio.principal.ref,
        tipo: cambio.principal.tipo,
        titulo: cambio.principal.etiqueta,
        texto: cambio.principal.texto,
      },
      candidato: { ref: c.ref, tipo: c.tipo, titulo: c.etiqueta, texto: c.texto },
    },
    pregunta:
      'Con este cambio aprobado, ¿qué le pasa al candidato: sigue igual, se relaciona, hay que actualizarlo, queda invalidado, hay que añadirle algo u otra cosa?',
    opciones: VEREDICTOS,
  }));
}

/** Categorías que se aplican al nodo: solo las de confianza alta. */
export function categoriasAplicables(respuestas: readonly RespuestaChoice[]): Record<string, string> {
  return Object.fromEntries(
    respuestas.filter((r) => enrutarPorConfianza(r.confianza) === 'aplicar').map((r) => [r.id, r.eleccion]),
  );
}

export type Clasificado = {
  cambio: Cambio;
  taxonomia: { id: string; codigo: string; version: number } | null;
  hashCategorias: string | null;
  categorias: RespuestaChoice[];
  candidatos: Candidato[];
  hashVeredictos: string;
  veredictos: RespuestaChoice[];
};

/** Recorre el cálculo completo de un cambio sobre un grafo dado (incremental y reconstrucción). */
export async function clasificarCambio(
  db: Bd,
  clasificador: Clasificador,
  grafo: Grafo,
  cambio: Cambio,
  taxonomia: TaxonomiaVigente | null,
): Promise<Clasificado> {
  let hashCategorias: string | null = null;
  let categorias: RespuestaChoice[] = [];
  if (taxonomia) {
    hashCategorias = hashEntradaCategorias(clasificador.id, `${taxonomia.codigo}@${taxonomia.version}`, cambio);
    categorias = (await responderConCache(db, clasificador, hashCategorias, itemsDeCategorias(cambio, taxonomia))).respuestas;
  }
  const candidatos = seleccionarCandidatos(grafo, cambio, categoriasAplicables(categorias));
  const hashVeredictos = hashEntradaVeredictos(clasificador.id, cambio, candidatos);
  const veredictos = (await responderConCache(db, clasificador, hashVeredictos, itemsDeVeredictos(cambio, candidatos)))
    .respuestas;
  return {
    cambio,
    taxonomia: taxonomia ? { id: taxonomia.id, codigo: taxonomia.codigo, version: taxonomia.version } : null,
    hashCategorias,
    categorias,
    candidatos,
    hashVeredictos,
    veredictos,
  };
}

export type ResultadoPasoClasificar =
  | { tipo: 'terminado' }
  | { tipo: 'sin_cambio' }
  | { tipo: 'error'; motivo: string }
  | { tipo: 'clasificado'; datos: Clasificado };

export async function pasoClasificar(s: Servicios, updateId: string, proyectoId: string): Promise<ResultadoPasoClasificar> {
  const u = await s.db
    .selectFrom('knowledge_updates')
    .select(['state', 'trigger'])
    .where('id', '=', updateId)
    .executeTakeFirstOrThrow();
  if (!['queued', 'classifying'].includes(u.state)) return { tipo: 'terminado' };
  if (u.state === 'queued') {
    await ejecutarComando(s, {
      comando: 'knowledge_update.classify',
      actor: ACTUALIZADOR,
      proyectoId,
      entidadId: updateId,
      datos: {},
    });
  }
  const cambio = await derivarCambio(s.db, u.trigger as ObjetoAutoridad);
  if (!cambio) return { tipo: 'sin_cambio' };
  try {
    const grafo = await cargarGrafo(s.db, proyectoId);
    const datos = await clasificarCambio(s.db, s.clasificador, grafo, cambio, await taxonomiaVigente(s.db, proyectoId));
    return { tipo: 'clasificado', datos };
  } catch (e) {
    return { tipo: 'error', motivo: `El clasificador falló: ${String(e).slice(0, 1500)}` };
  }
}

const refARegistro = (ref: string): { codigo: string; version: number } | null => {
  const m = /^([A-Z]{3}-[A-Z]{3}-\d{3})@(\d+)$/.exec(ref);
  return m?.[1] && m[2] ? { codigo: m[1], version: Number(m[2]) } : null;
};

/** Ejecutor del actualizador: el actor por defecto es el propio actualizador (system). */
type Ejecutar = (p: Omit<Peticion, 'actor'> & { actor?: Peticion['actor'] }) => Promise<Resultado>;

async function idNodoVigente(trx: Tx, proyectoId: string, ref: string): Promise<string | null> {
  const n = await trx
    .selectFrom('knowledge_nodes')
    .select('id')
    .where('project_id', '=', proyectoId)
    .where('ref', '=', ref)
    .where('valid_to', 'is', null)
    .executeTakeFirst();
  return n?.id ?? null;
}

/** Verifica y aplica (o rechaza) en una sola transacción; idempotente ante un corte. */
export async function pasoAplicar(
  s: Servicios,
  updateId: string,
  proyectoId: string,
  r: ResultadoPasoClasificar,
): Promise<string> {
  return enTransaccion(s, async (ejecutarBase, trx) => {
    await sql`select 1 from projects where id = ${proyectoId}::uuid for update`.execute(trx);
    const u = await trx
      .selectFrom('knowledge_updates')
      .select('state')
      .where('id', '=', updateId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (u.state !== 'classifying') return u.state;
    const ejecutar: Ejecutar = (p) => ejecutarBase({ proyectoId, ...p, actor: p.actor ?? ACTUALIZADOR });
    const base = { entidadId: updateId, comando: 'knowledge_update.reject' as const };
    if (r.tipo === 'terminado') return u.state;
    if (r.tipo === 'error') {
      await ejecutar({ ...base, datos: { motivos: [r.motivo] } });
      return 'rejected';
    }
    const grafo = await cargarGrafo(trx, proyectoId);
    if (r.tipo === 'sin_cambio') {
      await ejecutar({
        entidadId: updateId,
        comando: 'knowledge_update.verify',
        datos: { cambio: null, candidatos: [], input_hash: '', clasificador: s.clasificador.id, veredictos: [] },
      });
      await ejecutar({
        entidadId: updateId,
        comando: 'knowledge_update.apply',
        datos: { operaciones: {}, version_antes: grafo.version, version_despues: grafo.version },
      });
      return 'applied';
    }
    const d = r.datos;
    await ejecutar({
      entidadId: updateId,
      comando: 'knowledge_update.verify',
      datos: {
        cambio: d.cambio,
        candidatos: d.candidatos,
        input_hash: d.hashVeredictos,
        clasificador: s.clasificador.id,
        veredictos: {
          taxonomia: d.taxonomia,
          hash_categorias: d.hashCategorias,
          categorias: d.categorias,
          veredictos: d.veredictos,
        },
      },
    });
    const verificacion = verificarVeredictos(grafo, d.candidatos, d.veredictos);
    if (!verificacion.ok) {
      await ejecutar({ ...base, datos: { motivos: verificacion.motivos } });
      return 'rejected';
    }
    const aplicables = categoriasAplicables(d.categorias);
    const nueva = grafo.version + 1;
    const plan = planificar(grafo, d.cambio, aplicables, d.veredictos, nueva);
    const version = planVacio(plan) ? grafo.version : nueva;
    // Primero se localizan las aristas a cerrar (con sus nodos aún vigentes) y luego se invalida.
    const aristasACerrar: string[] = [];
    for (const a of plan.aristasInvalidadas) {
      const desde = await idNodoVigente(trx, proyectoId, a.desde);
      const hacia = await idNodoVigente(trx, proyectoId, a.hacia);
      if (!desde || !hacia) continue;
      const aristas = await trx
        .selectFrom('knowledge_edges')
        .select('id')
        .where('project_id', '=', proyectoId)
        .where('kind', '=', a.tipo)
        .where('from_node', '=', desde)
        .where('to_node', '=', hacia)
        .where('valid_to', 'is', null)
        .execute();
      aristasACerrar.push(...aristas.map((e) => e.id));
    }
    for (const id of aristasACerrar)
      await ejecutar({ comando: 'knowledge_edge.invalidate', entidadId: id, datos: { hasta: version } });
    for (const ref of plan.invalidar) {
      const id = await idNodoVigente(trx, proyectoId, ref);
      if (id) await ejecutar({ comando: 'knowledge_node.invalidate', entidadId: id, datos: { hasta: version } });
    }
    for (const n of plan.proyectar) {
      await ejecutar({
        comando: 'knowledge_node.project',
        datos: {
          ref: n.ref,
          tipo: n.tipo,
          etiqueta: n.etiqueta,
          texto: n.texto,
          categorias: n.categorias,
          epistemico: n.epistemico,
          origen: n.origen,
          desde: version,
          update_id: updateId,
        },
      });
    }
    for (const a of plan.aristasNuevas) {
      await ejecutar({
        comando: 'knowledge_edge.project',
        datos: { tipo: a.tipo, desde: a.desde, hacia: a.hacia, alta: version, update_id: updateId },
      });
    }
    if (d.taxonomia) {
      for (const c of d.categorias) {
        await ejecutar({
          comando: enrutarPorConfianza(c.confianza) === 'aplicar' ? 'classification.record' : 'classification.hold',
          datos: {
            nodo_ref: d.cambio.principal.ref,
            taxonomia_id: d.taxonomia.id,
            eje: c.id,
            categoria: c.eleccion,
            confianza: c.confianza,
            justificacion: c.justificacion,
            clasificador: s.clasificador.id,
            input_hash: d.hashCategorias ?? '',
            update_id: updateId,
          },
        });
      }
    }
    if (plan.revisiones.length > 0) await proponerRevisiones(ejecutar, trx, proyectoId, d, plan.revisiones);
    await ejecutar({
      entidadId: updateId,
      comando: 'knowledge_update.apply',
      datos: {
        operaciones: {
          proyectados: plan.proyectar.map((n) => n.ref),
          invalidados: plan.invalidar,
          aristas_nuevas: plan.aristasNuevas.length,
          aristas_invalidadas: plan.aristasInvalidadas.length,
          revisiones: plan.revisiones,
        },
        version_antes: grafo.version,
        version_despues: version,
      },
    });
    return 'applied';
  });
}

/**
 * Si aplicar falla por un error del sistema (tras sus reintentos), la actualización queda
 * rechazada con el motivo: nunca se queda en curso bloqueando la frescura.
 */
export async function rechazarPorError(s: Servicios, updateId: string, proyectoId: string, e: unknown): Promise<void> {
  const u = await s.db.selectFrom('knowledge_updates').select('state').where('id', '=', updateId).executeTakeFirstOrThrow();
  if (!['classifying', 'verifying'].includes(u.state)) return;
  await ejecutarComando(s, {
    comando: 'knowledge_update.reject',
    actor: ACTUALIZADOR,
    proyectoId,
    entidadId: updateId,
    datos: { motivos: [`Error del sistema al aplicar: ${String(e).slice(0, 1500)}`] },
  });
}

/** Lo que toca la autoridad sale como propuesta de revisión para la persona, nunca como cambio. */
async function proponerRevisiones(
  ejecutar: Ejecutar,
  trx: Tx,
  proyectoId: string,
  d: Clasificado,
  revisiones: { ref: string; veredicto: string; confianza: number; motivo: string }[],
): Promise<void> {
  const propuestas = [];
  for (const rv of revisiones) {
    const reg = refARegistro(rv.ref);
    if (!reg) continue;
    const registro = await trx
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', proyectoId)
      .where('code', '=', reg.codigo)
      .executeTakeFirst();
    if (!registro) continue;
    propuestas.push({
      tipo: 'revision',
      carga: {
        registro: reg,
        veredicto: rv.veredicto,
        motivo: (rv.motivo || `El cambio ${d.cambio.principal.ref} podría afectar a ${rv.ref}.`).slice(0, 2000),
        cambio: {
          tipo: d.cambio.principal.origen.tipo,
          id: d.cambio.principal.origen.id ?? '',
          version: d.cambio.principal.origen.version,
        },
        confianza: rv.confianza,
      },
      dependencias: [{ tipo: 'record', id: registro.id, codigo: reg.codigo, version: reg.version }],
    });
  }
  if (propuestas.length === 0) return;
  await ejecutar({
    comando: 'batch.submit',
    datos: {
      resumen: `El conocimiento sugiere revisar ${propuestas.length} registro(s) tras ${d.cambio.principal.ref}.`,
      tipo_lote: 'knowledge',
      resolucion: 'item',
      propuestas,
    },
  });
}
