// Paso «Actualizar conocimiento» (§7.3): candidatos deterministas → clasificador → verificación
// determinista → aplicación en una transacción con su evento. Los veredictos verificados se
// guardan por input_hash y se reutilizan: la misma entrada da el mismo resultado aplicado. Lo
// que no se verifica no entra en la caché, así que reintentar vuelve a preguntar.

import {
  type Candidato,
  type Cambio,
  type Clasificador,
  type Grafo,
  type ItemChoice,
  type Plan,
  type RespuestaChoice,
  VEREDICTOS,
  enrutarPorConfianza,
  hashEntradaCategorias,
  hashEntradaVeredictos,
  nodosVigentes,
  planRetirada,
  planSinCambios,
  planVacio,
  planificar,
  seleccionarCandidatos,
  verificarCategorias,
  verificarVeredictos,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { enTransaccion, ejecutarComando } from '../bus/bus.ts';
import type { Peticion, Resultado } from '../bus/tipos.ts';
import type { Bd, Tx } from '../db/conexion.ts';
import type { Servicios } from '../servicios.ts';
import { ACTUALIZADOR } from './comandos.ts';
import { DISPARO_DESCARTE, type ObjetoAutoridad, derivarCambio, derivarRetirada } from './derivar.ts';
import { cargarGrafo } from './grafo-pg.ts';

export type Eje = { codigo: string; nombre: string; categorias: { codigo: string; nombre: string; descripcion: string }[] };
/** Taxonomía aprobada vigente; `contenido` es su huella, parte del input_hash de las categorías. */
export type TaxonomiaVigente = { id: string; codigo: string; version: number; contenido: string; ejes: Eje[] };

export async function taxonomiaVigente(db: Bd, proyectoId: string): Promise<TaxonomiaVigente | null> {
  const t = await db
    .selectFrom('taxonomies')
    .select(['id', 'code', 'version', 'axes', 'content_hash'])
    .where('project_id', '=', proyectoId)
    .where('state', '=', 'approved')
    .orderBy('code')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  return t ? { id: t.id, codigo: t.code, version: t.version, contenido: t.content_hash, ejes: t.axes as Eje[] } : null;
}

/** Clave de la taxonomía en el input_hash: el mismo código y versión con otro contenido es otra entrada. */
export const claveTaxonomia = (t: { codigo: string; version: number; contenido: string }): string =>
  `${t.codigo}@${t.version}#${t.contenido}`;

/** Respuesta de un clasificador pendiente de guardar: solo entra en la caché si se verifica. */
export type AGuardar = { hash: string; clasificador: string; respuestas: RespuestaChoice[] };

/** Lee de la caché o pregunta al clasificador. No guarda: eso se hace tras verificar. */
export async function responderConCache(
  db: Bd,
  clasificador: Clasificador,
  hash: string,
  items: readonly ItemChoice[],
): Promise<{ respuestas: RespuestaChoice[]; desdeCache: boolean; aGuardar: AGuardar | null }> {
  const previa = await db.selectFrom('verdict_cache').select('answers').where('input_hash', '=', hash).executeTakeFirst();
  if (previa) return { respuestas: previa.answers as RespuestaChoice[], desdeCache: true, aGuardar: null };
  const respuestas = items.length === 0 ? [] : await clasificador.choice(items);
  return { respuestas, desdeCache: false, aGuardar: { hash, clasificador: clasificador.id, respuestas } };
}

/** Guarda respuestas verificadas (inmutables: la primera que llega se queda). */
export async function guardarEnCache(db: Bd, entradas: readonly (AGuardar | null)[]): Promise<void> {
  for (const e of entradas) {
    if (!e) continue;
    await sql`insert into verdict_cache (input_hash, classifier, answers) values (${e.hash}, ${e.clasificador}, ${JSON.stringify(e.respuestas)}::jsonb)
      on conflict (input_hash) do nothing`.execute(db);
  }
}

export function itemsDeCategorias(cambio: Cambio, taxonomia: { ejes: readonly Eje[] }): ItemChoice[] {
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
  taxonomia: { id: string; codigo: string; version: number; contenido: string } | null;
  ejes: Eje[];
  hashCategorias: string | null;
  categorias: RespuestaChoice[];
  candidatos: Candidato[];
  hashVeredictos: string;
  veredictos: RespuestaChoice[];
  /** Respuestas nuevas del clasificador: se guardan en la caché solo si se verifican. */
  aGuardar: AGuardar[];
};

/** Recorre el cálculo completo de un cambio sobre un grafo dado (incremental y reconstrucción). */
export async function clasificarCambio(
  db: Bd,
  clasificador: Clasificador,
  grafo: Grafo,
  cambio: Cambio,
  taxonomia: TaxonomiaVigente | null,
): Promise<Clasificado> {
  const aGuardar: AGuardar[] = [];
  let hashCategorias: string | null = null;
  let categorias: RespuestaChoice[] = [];
  if (taxonomia) {
    hashCategorias = hashEntradaCategorias(clasificador.id, claveTaxonomia(taxonomia), cambio);
    const r = await responderConCache(db, clasificador, hashCategorias, itemsDeCategorias(cambio, taxonomia));
    categorias = r.respuestas;
    if (r.aGuardar) aGuardar.push(r.aGuardar);
  }
  // Solo las categorías válidas orientan la búsqueda de candidatos; las inválidas rechazan después.
  const validas = taxonomia && verificarCategorias(taxonomia.ejes, categorias).ok ? categorias : [];
  const candidatos = seleccionarCandidatos(grafo, cambio, categoriasAplicables(validas));
  const hashVeredictos = hashEntradaVeredictos(clasificador.id, cambio, candidatos);
  const r = await responderConCache(db, clasificador, hashVeredictos, itemsDeVeredictos(cambio, candidatos));
  if (r.aGuardar) aGuardar.push(r.aGuardar);
  return {
    cambio,
    taxonomia: taxonomia
      ? { id: taxonomia.id, codigo: taxonomia.codigo, version: taxonomia.version, contenido: taxonomia.contenido }
      : null,
    ejes: taxonomia?.ejes ?? [],
    hashCategorias,
    categorias,
    candidatos,
    hashVeredictos,
    veredictos: r.respuestas,
    aGuardar,
  };
}

/** Motivos por los que la salida del clasificador no se verifica (vacío si se verifica). */
export function motivosDeVerificacion(grafo: Grafo, d: Clasificado): string[] {
  const motivos: string[] = [];
  const v = verificarVeredictos(grafo, d.candidatos, d.veredictos);
  if (!v.ok) motivos.push(...v.motivos);
  if (d.taxonomia) {
    const c = verificarCategorias(d.ejes, d.categorias);
    if (!c.ok) motivos.push(...c.motivos);
  }
  return motivos;
}

export type ResultadoPasoClasificar =
  | { tipo: 'terminado' }
  | { tipo: 'sin_cambio' }
  | { tipo: 'error'; motivo: string }
  | { tipo: 'retirada'; refs: string[] }
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
  // Cualquier fallo al derivar o clasificar rechaza la actualización: nunca se queda en curso.
  try {
    const disparo = u.trigger as ObjetoAutoridad;
    if (disparo.tipo === DISPARO_DESCARTE) return { tipo: 'retirada', refs: await derivarRetirada(s.db, disparo) };
    const cambio = await derivarCambio(s.db, disparo);
    if (!cambio) return { tipo: 'sin_cambio' };
    const grafo = await cargarGrafo(s.db, proyectoId);
    const datos = await clasificarCambio(s.db, s.clasificador, grafo, cambio, await taxonomiaVigente(s.db, proyectoId));
    return { tipo: 'clasificado', datos };
  } catch (e) {
    return { tipo: 'error', motivo: `No se pudo clasificar el cambio: ${String(e).slice(0, 1500)}` };
  }
}

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

/** Aplica al grafo de la base las operaciones de un plan, con sus comandos y eventos. */
async function aplicarOperaciones(
  ejecutar: Ejecutar,
  trx: Tx,
  proyectoId: string,
  plan: Plan,
  version: number,
  updateId: string,
): Promise<void> {
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
}

const operacionesDe = (plan: Plan) => ({
  proyectados: plan.proyectar.map((n) => n.ref),
  invalidados: plan.invalidar,
  aristas_nuevas: plan.aristasNuevas.length,
  aristas_invalidadas: plan.aristasInvalidadas.length,
  revisiones: plan.revisiones,
  sin_aplicar: plan.sinAplicar,
});

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
    const rechazar = async (motivos: string[]) => {
      await ejecutar({ entidadId: updateId, comando: 'knowledge_update.reject', datos: { motivos } });
      return 'rejected';
    };
    if (r.tipo === 'terminado') return u.state;
    if (r.tipo === 'error') return rechazar([r.motivo]);
    const grafo = await cargarGrafo(trx, proyectoId);
    // Aplica el plan; `despues` añade clasificaciones y propuestas antes del evento final.
    const aplicar = async (plan: Plan, despues?: () => Promise<void>) => {
      const version = planVacio(plan) ? grafo.version : grafo.version + 1;
      await aplicarOperaciones(ejecutar, trx, proyectoId, plan, version, updateId);
      await despues?.();
      await ejecutar({
        entidadId: updateId,
        comando: 'knowledge_update.apply',
        datos: { operaciones: operacionesDe(plan), version_antes: grafo.version, version_despues: version },
      });
      return 'applied';
    };
    if (r.tipo === 'sin_cambio' || r.tipo === 'retirada') {
      await ejecutar({
        entidadId: updateId,
        comando: 'knowledge_update.verify',
        datos: {
          cambio: r.tipo === 'retirada' ? { retirada: r.refs } : null,
          candidatos: [],
          input_hash: '',
          clasificador: s.clasificador.id,
          veredictos: [],
        },
      });
      if (r.tipo === 'sin_cambio') return aplicar(planSinCambios());
      return aplicar(planRetirada(grafo, r.refs));
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
    const motivos = motivosDeVerificacion(grafo, d);
    if (motivos.length > 0) return rechazar(motivos);
    const plan = planificar(grafo, d.cambio, categoriasAplicables(d.categorias), d.veredictos, grafo.version + 1);
    // Lo que toca la autoridad sale como propuesta: si una revisión no puede proponerse, la
    // actualización se rechaza en lugar de perderla.
    const revisiones = await prepararRevisiones(trx, proyectoId, grafo, d, plan.revisiones);
    if (revisiones.motivos.length > 0) return rechazar(revisiones.motivos);
    await guardarEnCache(trx, d.aGuardar);
    const taxonomiaId = d.taxonomia?.id;
    return aplicar(plan, async () => {
      for (const c of taxonomiaId ? d.categorias : []) {
        await ejecutar({
          comando: enrutarPorConfianza(c.confianza) === 'aplicar' ? 'classification.record' : 'classification.hold',
          datos: {
            nodo_ref: d.cambio.principal.ref,
            taxonomia_id: taxonomiaId,
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
      if (revisiones.propuestas.length > 0) {
        await ejecutar({
          comando: 'batch.submit',
          datos: {
            resumen: `El conocimiento sugiere revisar ${revisiones.propuestas.length} registro(s) tras ${d.cambio.principal.ref}.`,
            tipo_lote: 'knowledge',
            resolucion: 'item',
            propuestas: revisiones.propuestas,
          },
        });
      }
    });
  });
}

/**
 * Si procesar una actualización falla por un error del sistema (tras sus reintentos), queda
 * rechazada con el motivo: nunca se queda en curso bloqueando la frescura.
 */
export async function rechazarPorError(s: Servicios, updateId: string, proyectoId: string, e: unknown): Promise<void> {
  const u = await s.db.selectFrom('knowledge_updates').select('state').where('id', '=', updateId).executeTakeFirstOrThrow();
  if (!['queued', 'classifying', 'verifying'].includes(u.state)) return;
  const base = { actor: ACTUALIZADOR, proyectoId, entidadId: updateId } as const;
  if (u.state === 'queued') await ejecutarComando(s, { ...base, comando: 'knowledge_update.classify', datos: {} });
  await ejecutarComando(s, {
    ...base,
    comando: 'knowledge_update.reject',
    datos: { motivos: [`Error del sistema al procesar la actualización: ${String(e).slice(0, 1500)}`] },
  });
}

type PropuestaDeRevision = {
  tipo: 'revision';
  carga: Record<string, unknown>;
  dependencias: { tipo: 'record'; id: string; codigo: string; version: number }[];
};

/**
 * Propuestas de revisión para la persona. El registro se localiza por el origen del nodo (la
 * versión que proyectó), nunca interpretando su ref.
 */
async function prepararRevisiones(
  trx: Tx,
  proyectoId: string,
  grafo: Grafo,
  d: Clasificado,
  revisiones: Plan['revisiones'],
): Promise<{ propuestas: PropuestaDeRevision[]; motivos: string[] }> {
  const vigentes = new Map(nodosVigentes(grafo).map((n) => [n.ref, n]));
  const propuestas: PropuestaDeRevision[] = [];
  const motivos: string[] = [];
  for (const rv of revisiones) {
    const origen = vigentes.get(rv.ref)?.origen;
    const v =
      origen?.tipo === 'record_version' && origen.id
        ? await trx
            .selectFrom('record_versions')
            .innerJoin('records', 'records.id', 'record_versions.record_id')
            .select(['records.id as recordId', 'records.code', 'record_versions.n'])
            .where('record_versions.id', '=', origen.id)
            .where('records.project_id', '=', proyectoId)
            .executeTakeFirst()
        : undefined;
    if (!v) {
      motivos.push(
        `No se puede proponer la revisión de ${rv.ref}: su nodo no procede de una versión de registro de este proyecto.`,
      );
      continue;
    }
    propuestas.push({
      tipo: 'revision',
      carga: {
        registro: { codigo: v.code, version: v.n },
        veredicto: rv.veredicto,
        motivo: (rv.motivo || `El cambio ${d.cambio.principal.ref} podría afectar a ${rv.ref}.`).slice(0, 2000),
        cambio: {
          tipo: d.cambio.principal.origen.tipo,
          id: d.cambio.principal.origen.id ?? '',
          version: d.cambio.principal.origen.version,
        },
        confianza: rv.confianza,
      },
      dependencias: [{ tipo: 'record', id: v.recordId, codigo: v.code, version: v.n }],
    });
  }
  return { propuestas, motivos };
}
