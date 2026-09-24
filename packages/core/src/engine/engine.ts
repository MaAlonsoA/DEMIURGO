// Motor de pasos durable sobre DBOS Transact, en el mismo Postgres que el dominio.
// Flujo de una ejecución: preparar (tx) → invocar (agente, al menos una vez) → aplicar (tx).
// «aplicar» es idempotente: la marca en step_completions se confirma en la misma transacción
// que sus efectos, así que un corte y la reanudación no repiten el efecto (AC-ESQ-001-07).

import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { type AccionAgente, ESQUEMAS_SALIDA, type ResultadoAgente, agenteRun, esquemaJsonDe, sistema } from '@demiurgo/domain';
import { sql } from 'kysely';
import { APLICADORES } from '../acciones/aplicadores.ts';
import { cargarMetodo, versionEsquema } from '../agentes/metodos.ts';
import { ejecutarComando, enTransaccion } from '../bus/bus.ts';
import { grafoAlDia } from '../contexto/grafo.ts';
import type { MotorFlujos, Servicios } from '../servicios.ts';
import { arrancadores, conciliadores, fijarServiciosDelMotor, serviciosDelMotor } from './registro.ts';

export {
  registrarArranqueActualizacion,
  registrarArranqueEvaluacion,
  registrarConciliador,
  serviciosDelMotor,
} from './registro.ts';
export type { ArrancadorFlujo } from './registro.ts';

const comprimir = promisify(gzip);
const MOTOR = sistema('motor');
const TIEMPO_AGENTE_MS = 180_000;

/**
 * Versión fija de la aplicación para DBOS: sin ella, DBOS la deriva del código y un cambio
 * entre un corte y el rearranque impediría recuperar los flujos pendientes. Se sube a mano
 * solo si cambia la forma de un flujo de manera incompatible.
 */
export const VERSION_FLUJOS = 'demiurgo-v2-flujos-1';

/** Reintentos de los pasos transaccionales ante fallos transitorios (corte de conexión, bloqueo). */
const REINTENTOS = { retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 } as const;

const controladores = new Map<string, AbortController>();

// DBOS no permite arrancar un flujo desde dentro de un paso. Los arranques pedidos dentro de un
// flujo (p. ej. tras confirmar un paso) se difieren a un temporizador creado al lanzar el motor,
// fuera de cualquier contexto de DBOS. Si el proceso cae antes, la conciliación al arrancar los recupera.
const diferidos: (() => Promise<void>)[] = [];
let despachador: NodeJS.Timeout | undefined;

function arrancarFueraDeFlujo(arranque: () => Promise<void>): Promise<void> {
  if (!DBOS.isWithinWorkflow()) return arranque();
  diferidos.push(arranque);
  return Promise.resolve();
}

async function despacharDiferidos(): Promise<void> {
  while (diferidos.length > 0) {
    const siguiente = diferidos.shift();
    try {
      await siguiente?.();
    } catch (e) {
      console.error(JSON.stringify({ nivel: 'error', m: 'No se pudo arrancar un flujo diferido', error: String(e) }));
    }
  }
}
let alCompletarPaso: ((paso: string, id: string) => void) | undefined;

function requerir(): Servicios {
  return serviciosDelMotor();
}

export const idFlujoRun = (runId: string): string => `run:${runId}`;

async function preparar(runId: string, proyectoId: string): Promise<string> {
  const s = requerir();
  const run = await s.db.selectFrom('ai_runs').select('state').where('id', '=', runId).executeTakeFirstOrThrow();
  if (run.state === 'queued') {
    await ejecutarComando(s, { comando: 'run.begin', actor: MOTOR, proyectoId, entidadId: runId, datos: {} });
    return 'running';
  }
  return run.state;
}

async function invocar(runId: string): Promise<ResultadoAgente> {
  const s = requerir();
  const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
  const pack = await s.db
    .selectFrom('context_packs')
    .select(['hash', 'content'])
    .where('id', '=', run.context_pack_id ?? '')
    .executeTakeFirstOrThrow();
  const accion = run.action as AccionAgente;
  const [, version] = run.method.split('@');
  const metodo = await cargarMetodo(accion, version);
  const control = new AbortController();
  controladores.set(runId, control);
  try {
    return await s.agente.ejecutar({
      runId,
      accion,
      metodo: { version: metodo.id, texto: metodo.texto },
      esquemaSalida: esquemaJsonDe(accion),
      contexto: { hash: pack.hash, contenido: pack.content },
      presupuesto: { tiempoMs: TIEMPO_AGENTE_MS },
      signal: control.signal,
    });
  } catch (e) {
    return {
      estado: 'error',
      failureKind: 'infra',
      mensaje: `El adaptador falló: ${String(e)}`,
      eventosCrudos: '',
      proveedor: s.agente.proveedor,
      modelo: 'desconocido',
    };
  } finally {
    controladores.delete(runId);
  }
}

function resumirErrores(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 8)
    .map((i) => `${i.path.map(String).join('.') || 'salida'}: ${i.message}`)
    .join('; ');
}

async function aplicar(runId: string, proyectoId: string, r: ResultadoAgente, flujo: string): Promise<string> {
  const s = requerir();
  const final = await enTransaccion(s, async (ejecutar, trx) => {
    // Mismo orden de bloqueos que el bus (proyecto y después la entidad): sin interbloqueos.
    await sql`select 1 from projects where id = ${proyectoId}::uuid for update`.execute(trx);
    const hecho = await trx
      .selectFrom('step_completions')
      .select('result')
      .where('workflow_id', '=', flujo)
      .where('step', '=', 'aplicar')
      .executeTakeFirst();
    if (hecho) return String(hecho.result);
    const run = await trx.selectFrom('ai_runs').selectAll().where('id', '=', runId).forUpdate().executeTakeFirstOrThrow();
    let estado = run.state;
    if (run.state === 'running') {
      const intento =
        Number(
          (
            await trx
              .selectFrom('ai_run_logs')
              .select((eb) => eb.fn.countAll().as('n'))
              .where('run_id', '=', runId)
              .executeTakeFirst()
          )?.n ?? 0,
        ) + 1;
      await trx
        .insertInto('ai_run_logs')
        .values({ project_id: proyectoId, run_id: runId, attempt: intento, raw_gzip: await comprimir(r.eventosCrudos) })
        .execute();
      const base = { actor: MOTOR, proyectoId, entidadId: runId, causa: { run: runId } };
      const accion = run.action as AccionAgente;
      if (r.estado === 'error') {
        await ejecutar({
          ...base,
          comando: 'run.fail',
          datos: { failure_kind: r.failureKind, error: r.mensaje, uso: r.uso ?? null, modelo: r.modelo },
        });
        estado = 'failed';
      } else if (versionEsquema(accion) !== run.schema_version) {
        // El esquema se fija por ejecución (I7): si el código cambió desde que se pidió, no se valida con otro.
        await ejecutar({
          ...base,
          comando: 'run.fail',
          datos: {
            failure_kind: 'infra',
            error: 'El esquema de salida de la acción cambió desde que se pidió la ejecución.',
            uso: r.uso,
            modelo: r.modelo,
          },
        });
        estado = 'failed';
      } else {
        const v = ESQUEMAS_SALIDA[accion].safeParse(r.salidaCruda);
        if (!v.success) {
          // Salida fuera de esquema: ningún efecto salvo el propio fallo de la ejecución (I7).
          await ejecutar({
            ...base,
            comando: 'run.fail',
            datos: { failure_kind: 'invalid_output', error: resumirErrores(v.error.issues), uso: r.uso, modelo: r.modelo },
          });
          estado = 'failed';
        } else {
          const aplicador = APLICADORES[accion] as
            | ((e: { trx: typeof trx; ejecutar: typeof ejecutar; run: typeof run; salida: unknown }) => Promise<void>)
            | undefined;
          if (!aplicador) throw new Error(`No hay aplicador para «${accion}».`);
          await aplicador({ trx, ejecutar: (p) => ejecutar({ causa: { run: runId }, ...p }), run, salida: v.data });
          await ejecutar({ ...base, comando: 'run.complete', datos: { salida: v.data, uso: r.uso, modelo: r.modelo } });
          estado = 'completed';
        }
      }
    }
    await trx
      .insertInto('step_completions')
      .values({ workflow_id: flujo, step: 'aplicar', result: JSON.stringify(estado) })
      .execute();
    return estado;
  });
  alCompletarPaso?.('aplicar', runId);
  return final;
}

async function flujoRun(runId: string, proyectoId: string): Promise<string> {
  const flujo = DBOS.workflowID ?? idFlujoRun(runId);
  const estado = await DBOS.runStep(() => preparar(runId, proyectoId), { name: 'preparar', ...REINTENTOS });
  if (estado !== 'running') return estado;
  const resultado = await DBOS.runStep(() => invocar(runId), { name: 'invocar' });
  try {
    return await DBOS.runStep(() => aplicar(runId, proyectoId, resultado, flujo), { name: 'aplicar', ...REINTENTOS });
  } catch (e) {
    await DBOS.runStep(() => fallarPorInfraestructura(runId, proyectoId, e), { name: 'fallar', ...REINTENTOS });
    return 'failed';
  }
}

/** Un error del propio sistema al aplicar deja la ejecución fallida (infra), nunca colgada. */
async function fallarPorInfraestructura(runId: string, proyectoId: string, e: unknown): Promise<void> {
  const s = requerir();
  const run = await s.db.selectFrom('ai_runs').select('state').where('id', '=', runId).executeTakeFirstOrThrow();
  if (run.state !== 'running') return;
  await ejecutarComando(s, {
    comando: 'run.fail',
    actor: MOTOR,
    proyectoId,
    entidadId: runId,
    datos: { failure_kind: 'infra', error: `Error al aplicar la salida: ${String(e).slice(0, 3000)}` },
  });
}

const flujoRunRegistrado = DBOS.registerWorkflow(flujoRun, { name: 'demiurgo.run' });

// Respuesta durable a un mensaje de la persona: espera a que el conocimiento esté al día y
// pide la ejecución de exploration_chat una sola vez (marca en step_completions).
async function pedirRespuesta(
  flujo: string,
  proyectoId: string,
  exploracionId: string,
  preguntaId: string | null,
): Promise<void> {
  const s = requerir();
  await enTransaccion(s, async (ejecutar, trx) => {
    await sql`select 1 from projects where id = ${proyectoId}::uuid for update`.execute(trx);
    const hecho = await trx
      .selectFrom('step_completions')
      .select('step')
      .where('workflow_id', '=', flujo)
      .where('step', '=', 'pedir')
      .executeTakeFirst();
    if (hecho) return;
    const exploracion = await trx.selectFrom('explorations').select('state').where('id', '=', exploracionId).executeTakeFirst();
    if (exploracion?.state === 'active') {
      await ejecutar({
        comando: 'run.request',
        actor: sistema('conversacion'),
        proyectoId,
        datos: {
          accion: 'exploration_chat',
          alcance: { tipo: 'exploration', id: exploracionId },
          entrada: preguntaId ? { pregunta_id: preguntaId } : {},
        },
      });
    }
    await trx
      .insertInto('step_completions')
      .values({ workflow_id: flujo, step: 'pedir', result: JSON.stringify('ok') })
      .execute();
  });
}

async function flujoResponder(proyectoId: string, exploracionId: string, preguntaId: string | null): Promise<void> {
  const flujo = DBOS.workflowID ?? `respuesta:${exploracionId}`;
  for (let i = 0; i < 120; i++) {
    const alDia = await DBOS.runStep(
      () =>
        requerir()
          .db.transaction()
          .execute((trx) => grafoAlDia(trx, proyectoId)),
      {
        name: 'frescura',
      },
    );
    if (alDia.alDia) break;
    await DBOS.sleepms(500);
  }
  await DBOS.runStep(() => pedirRespuesta(flujo, proyectoId, exploracionId, preguntaId), { name: 'pedir', ...REINTENTOS });
}

const flujoResponderRegistrado = DBOS.registerWorkflow(flujoResponder, { name: 'demiurgo.responder' });

export const motorDbos: MotorFlujos = {
  async iniciarRun(runId, proyectoId) {
    // Con el mismo workflowID, DBOS no repite el flujo: devuelve el existente.
    await arrancarFueraDeFlujo(async () => {
      await DBOS.startWorkflow(flujoRunRegistrado, { workflowID: idFlujoRun(runId) })(runId, proyectoId);
    });
  },
  async cancelarRun(runId) {
    controladores.get(runId)?.abort();
    await DBOS.cancelWorkflow(idFlujoRun(runId)).catch(() => undefined);
  },
  async iniciarActualizacion(id, proyectoId) {
    await arrancarFueraDeFlujo(() => arrancadores.actualizacion(id, proyectoId));
  },
  async iniciarEvaluacion(loteId, proyectoId) {
    await arrancarFueraDeFlujo(() => arrancadores.evaluacion(loteId, proyectoId));
  },
  async iniciarRespuesta(mensajeId, proyectoId, exploracionId, preguntaId) {
    await arrancarFueraDeFlujo(async () => {
      await DBOS.startWorkflow(flujoResponderRegistrado, { workflowID: `respuesta:${mensajeId}` })(
        proyectoId,
        exploracionId,
        preguntaId ?? null,
      );
    });
  },
};

export type OpcionesMotor = {
  /** Solo para pruebas de durabilidad: se llama justo después de confirmar un paso. */
  alCompletarPaso?: (paso: string, id: string) => void;
};

export type MotorIniciado = { servicios: Servicios; detener(): Promise<void> };

/**
 * Concilia al arrancar: una ejecución encolada sin flujo se arranca; una en curso cuyo flujo
 * ya no se puede reanudar (fallido, cancelado o inexistente) queda interrumpida para que la
 * persona la reintente con el mismo context pack. Nunca queda colgada.
 */
async function conciliarEjecuciones(s: Servicios): Promise<void> {
  const vivas = await s.db
    .selectFrom('ai_runs')
    .select(['id', 'project_id', 'state'])
    .where('state', 'in', ['queued', 'running'])
    .execute();
  for (const r of vivas) {
    const flujo = await DBOS.getWorkflowStatus(idFlujoRun(r.id));
    const vivo = flujo && ['PENDING', 'ENQUEUED', 'SUCCESS'].includes(flujo.status);
    if (vivo) continue;
    if (!flujo && r.state === 'queued') {
      await motorDbos.iniciarRun(r.id, r.project_id);
      continue;
    }
    const motivo = flujo
      ? `El flujo de la ejecución terminó en ${flujo.status} sin completarla; reinténtala.`
      : 'El proceso se cortó sin un flujo que reanudar; reinténtala con el mismo context pack.';
    await ejecutarComando(s, {
      comando: r.state === 'running' ? 'run.interrupt' : 'run.fail',
      actor: MOTOR,
      proyectoId: r.project_id,
      entidadId: r.id,
      datos: r.state === 'running' ? { motivo } : { failure_kind: 'infra', error: motivo },
    });
  }
}

/**
 * Configura y lanza DBOS sobre la base de la aplicación (esquema `dbos`). Al lanzar, DBOS
 * reanuda los flujos pendientes; después se concilian las ejecuciones y las actualizaciones.
 */
export async function iniciarMotor(
  base: Omit<Servicios, 'motor'>,
  urlBase: string,
  opciones: OpcionesMotor = {},
): Promise<MotorIniciado> {
  const s: Servicios = { ...base, motor: motorDbos };
  fijarServiciosDelMotor(s);
  alCompletarPaso = opciones.alCompletarPaso;
  DBOS.setConfig({
    name: 'demiurgo',
    systemDatabaseUrl: urlBase,
    systemDatabaseSchemaName: 'dbos',
    applicationVersion: VERSION_FLUJOS,
    executorID: 'local',
    logLevel: 'warn',
  });
  await DBOS.launch();
  despachador = setInterval(() => {
    void despacharDiferidos();
  }, 50);
  await conciliarEjecuciones(s);
  for (const c of conciliadores) await c(s);
  return {
    servicios: s,
    async detener() {
      for (const c of controladores.values()) c.abort();
      clearInterval(despachador);
      await despacharDiferidos();
      await DBOS.shutdown();
      fijarServiciosDelMotor(null);
    },
  };
}

/** Espera el resultado del flujo de una ejecución (pruebas y CLI). */
export async function esperarRun(runId: string): Promise<string | null> {
  return DBOS.retrieveWorkflow<string>(idFlujoRun(runId)).getResult();
}

/** Espera la respuesta durable a un mensaje (pruebas). */
export async function esperarRespuesta(mensajeId: string): Promise<void> {
  await DBOS.retrieveWorkflow<void>(`respuesta:${mensajeId}`).getResult();
}

/** Marca de actor para los efectos de una ejecución. */
export const actorDeRun = agenteRun;
