// Bus de comandos. Orden fijo para cada comando:
//   1. capacidad (matriz)       → 403 sin efectos
//   2. validación de los datos  → 422 sin efectos
//   3. carga de la entidad      → 404 sin efectos
//   4. transición (tabla)       → 409 sin efectos
//   5. guardas                  → 409 con motivos, sin efectos
//   6. aplicar + estado + evento en la misma transacción.

import { randomUUID } from 'node:crypto';
import {
  ErrorDominio,
  buscarTransicion,
  entidadDe,
  esCreacion,
  etiquetaEntidad,
  etiquetaEstado,
  formatearActor,
  permitidoComando,
  type NombreEntidad,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Servicios } from '../servicios.ts';
import '../comandos/index.ts';
import { GUARDAS } from './guardas.ts';
import { MANEJADORES } from './manejadores.ts';
import type { Causa, ContextoComando, EntidadCargada, Peticion, Resultado, Tx } from './tipos.ts';

/** Tabla de cada entidad implementada. */
export const TABLAS: Partial<Record<NombreEntidad, string>> = {
  project: 'projects',
  agent_token: 'agent_tokens',
  exploration: 'explorations',
  message: 'messages',
  source: 'sources',
  question: 'questions',
  record: 'records',
  record_version: 'record_versions',
  criterion: 'criteria',
  link: 'links',
  batch: 'proposal_batches',
  proposal: 'proposals',
  ai_run: 'ai_runs',
  context_pack: 'context_packs',
  taxonomy: 'taxonomies',
  classification: 'classifications',
  knowledge_update: 'knowledge_updates',
  idea_assessment: 'idea_assessments',
};

type Pendiente = () => Promise<void> | void;

/** Ejecuta un comando en su propia transacción y, tras confirmar, el trabajo diferido. */
export async function ejecutarComando(servicios: Servicios, peticion: Peticion): Promise<Resultado> {
  comprobarCapacidad(peticion);
  const pendientes: Pendiente[] = [];
  const resultado = await servicios.db
    .transaction()
    .execute((trx) => ejecutarEnTransaccion(servicios, trx, peticion, pendientes));
  await ejecutarPendientes(servicios, pendientes);
  return resultado;
}

/** Ejecuta varios comandos dependientes en una sola transacción. */
export async function enTransaccion<T>(
  servicios: Servicios,
  trabajo: (ejecutar: (p: Peticion) => Promise<Resultado>, trx: Tx) => Promise<T>,
): Promise<T> {
  const pendientes: Pendiente[] = [];
  const correlacion = randomUUID();
  const r = await servicios.db
    .transaction()
    .execute((trx) =>
      trabajo((p) => ejecutarEnTransaccion(servicios, trx, { ...p, causa: { correlacion, ...p.causa } }, pendientes), trx),
    );
  await ejecutarPendientes(servicios, pendientes);
  return r;
}

async function ejecutarPendientes(servicios: Servicios, pendientes: Pendiente[]): Promise<void> {
  for (const f of pendientes) {
    try {
      await f();
    } catch (e) {
      servicios.registro.error('Fallo en trabajo diferido tras confirmar', { error: String(e) });
    }
  }
}

function comprobarCapacidad(p: Peticion): void {
  if (!permitidoComando(p.comando, p.actor.tipo)) {
    throw new ErrorDominio('prohibido', `${formatearActor(p.actor)} no puede ejecutar «${p.comando}».`, [
      `La matriz de capacidades no permite «${p.comando}» a ${p.actor.tipo}.`,
    ]);
  }
}

async function cargarEntidad(trx: Tx, entidad: NombreEntidad, id: string, proyectoId: string): Promise<EntidadCargada> {
  const tabla = TABLAS[entidad];
  if (!tabla) throw new ErrorDominio('no_implementado', `La entidad «${entidad}» aún no está implementada.`);
  const esProyecto = entidad === 'project';
  const { rows } = await sql<Record<string, unknown>>`
    select * from ${sql.table(tabla)} where id = ${id}::uuid for update`.execute(trx);
  const fila = rows[0];
  const filaProyecto = esProyecto ? fila?.id : fila?.project_id;
  if (!fila || filaProyecto !== proyectoId) {
    throw new ErrorDominio('no_encontrado', `No existe ${etiquetaEntidad(entidad).toLowerCase()} ${id} en este proyecto.`);
  }
  return { id, proyectoId, estado: String(fila.state), fila };
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ejecutarEnTransaccion(
  servicios: Servicios,
  trx: Tx,
  peticion: Peticion,
  pendientes: Pendiente[],
): Promise<Resultado> {
  comprobarCapacidad(peticion);
  const { comando, actor } = peticion;
  const entidad = entidadDe(comando);
  const manejador = MANEJADORES[comando];
  if (!manejador) throw new ErrorDominio('no_implementado', `El comando «${comando}» aún no está implementado.`);

  const validacion = manejador.datos.safeParse(peticion.datos ?? {});
  if (!validacion.success) {
    throw new ErrorDominio(
      'validacion',
      `Los datos de «${comando}» no son válidos.`,
      validacion.error.issues.map((i) => `${i.path.join('.') || 'datos'}: ${i.message}`),
    );
  }

  const creacion = esCreacion(comando);
  let proyectoId = peticion.proyectoId ?? '';
  if (comando !== 'project.create') {
    if (!RE_UUID.test(proyectoId)) throw new ErrorDominio('no_encontrado', 'Falta el proyecto.');
    const proyecto = await sql<{ state: string }>`select state from projects where id = ${proyectoId}::uuid for update`.execute(
      trx,
    );
    const estadoProyecto = proyecto.rows[0]?.state;
    if (!estadoProyecto) throw new ErrorDominio('no_encontrado', 'El proyecto no existe.');
    if (estadoProyecto === 'archived' && entidad !== 'project') {
      throw new ErrorDominio('transicion_invalida', 'El proyecto está archivado: no admite cambios.');
    }
  }

  let cargada: EntidadCargada | null = null;
  if (!creacion) {
    const id = peticion.entidadId ?? '';
    if (!RE_UUID.test(id)) throw new ErrorDominio('no_encontrado', `Falta la entidad sobre la que actúa «${comando}».`);
    cargada = await cargarEntidad(trx, entidad, id, proyectoId);
  }

  const transicion = buscarTransicion(entidad, cargada?.estado ?? null, comando);
  if (!transicion) {
    const estado = cargada ? etiquetaEstado(entidad, cargada.estado) : 'nuevo';
    throw new ErrorDominio(
      'transicion_invalida',
      `No se puede aplicar «${comando}» a ${etiquetaEntidad(entidad).toLowerCase()} en estado «${estado}».`,
    );
  }

  const causa: Causa = { correlacion: peticion.causa?.correlacion ?? randomUUID(), ...peticion.causa };
  const ctx: ContextoComando = {
    trx,
    actor,
    proyectoId,
    comando,
    causa,
    servicios,
    ejecutar: (p) =>
      ejecutarEnTransaccion(
        servicios,
        trx,
        { proyectoId, ...p, causa: { ...causa, comandoOrigen: causa.comandoOrigen ?? comando, ...p.causa } },
        pendientes,
      ),
    despuesDeConfirmar: (f) => {
      pendientes.push(f);
    },
  };

  const motivos: string[] = [];
  for (const nombre of transicion.guardas) {
    const guarda = GUARDAS[nombre];
    if (!guarda) throw new Error(`La guarda «${nombre}» no tiene implementación.`);
    const motivo = await guarda({ ctx, datos: validacion.data, entidad: cargada });
    if (motivo) motivos.push(motivo);
  }
  if (motivos.length > 0) {
    throw new ErrorDominio('guarda', `No se cumplen las condiciones de «${comando}».`, motivos);
  }

  const aplicado = await manejador.aplicar(ctx, validacion.data, cargada, transicion.hacia);
  if (aplicado.proyectoId) {
    proyectoId = aplicado.proyectoId;
    ctx.proyectoId = proyectoId;
  }
  if (aplicado.sinCambios) {
    return {
      proyectoId,
      entidad,
      entidadId: aplicado.entidadId,
      estado: transicion.hacia,
      seq: null,
      resultado: aplicado.resultado,
    };
  }
  if (cargada) {
    const tabla = TABLAS[entidad] as string;
    await sql`update ${sql.table(tabla)} set state = ${transicion.hacia} where id = ${cargada.id}::uuid`.execute(trx);
  }
  const seq = await registrarEvento(trx, {
    proyectoId,
    actor: formatearActor(actor),
    comando,
    entidad,
    entidadId: aplicado.entidadId,
    version: aplicado.version ?? null,
    estadoAntes: cargada?.estado ?? null,
    estadoDespues: transicion.hacia,
    antes: aplicado.antes,
    despues: aplicado.despues,
    causa,
  });
  return { proyectoId, entidad, entidadId: aplicado.entidadId, estado: transicion.hacia, seq, resultado: aplicado.resultado };
}

type NuevoEvento = {
  proyectoId: string;
  actor: string;
  comando: string;
  entidad: string;
  entidadId: string;
  version: number | null;
  estadoAntes: string | null;
  estadoDespues: string | null;
  antes?: unknown;
  despues?: unknown;
  causa: Causa;
};

const aJson = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

/** Añade un evento al diario con el siguiente número de secuencia del proyecto. */
export async function registrarEvento(trx: Tx, e: NuevoEvento): Promise<number> {
  const { event_seq } = await trx
    .updateTable('projects')
    .set({ event_seq: sql`event_seq + 1` })
    .where('id', '=', e.proyectoId)
    .returning('event_seq')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('events')
    .values({
      project_id: e.proyectoId,
      seq: event_seq,
      actor: e.actor,
      command: e.comando,
      entity_type: e.entidad,
      entity_id: e.entidadId,
      entity_version: e.version,
      state_before: e.estadoAntes,
      state_after: e.estadoDespues,
      before: aJson(e.antes),
      after: aJson(e.despues),
      cause: aJson(e.causa),
    })
    .execute();
  return Number(event_seq);
}
