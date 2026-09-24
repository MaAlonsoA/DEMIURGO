// Motor de pasos durable sobre DBOS Transact, en el mismo Postgres que el dominio.
// Flujo de una ejecución: preparar (tx) → invocar (agente, al menos una vez) → aplicar (tx).
// «aplicar» es idempotente: la marca en step_completions se confirma en la misma transacción
// que sus efectos, así que un corte y la reanudación no repiten el efecto (AC-ESQ-001-07).

import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { type AccionAgente, ESQUEMAS_SALIDA, type ResultadoAgente, agenteRun, esquemaJsonDe, sistema } from '@demiurgo/domain';
import { APLICADORES } from '../acciones/aplicadores.ts';
import { cargarMetodo } from '../agentes/metodos.ts';
import { ejecutarComando, enTransaccion } from '../bus/bus.ts';
import type { MotorFlujos, Servicios } from '../servicios.ts';

const comprimir = promisify(gzip);
const MOTOR = sistema('motor');
const TIEMPO_AGENTE_MS = 180_000;

let servicios: Servicios | null = null;
const controladores = new Map<string, AbortController>();

function requerir(): Servicios {
  if (!servicios) throw new Error('El motor no está iniciado.');
  return servicios;
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
  return enTransaccion(s, async (ejecutar, trx) => {
    const hecho = await trx
      .selectFrom('step_completions')
      .select('result')
      .where('workflow_id', '=', flujo)
      .where('step', '=', 'aplicar')
      .executeTakeFirst();
    if (hecho) return String(hecho.result);
    const run = await trx.selectFrom('ai_runs').selectAll().where('id', '=', runId).forUpdate().executeTakeFirstOrThrow();
    let final = run.state;
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
      if (r.estado === 'error') {
        await ejecutar({
          ...base,
          comando: 'run.fail',
          datos: { failure_kind: r.failureKind, error: r.mensaje, uso: r.uso ?? null, modelo: r.modelo },
        });
        final = 'failed';
      } else {
        const accion = run.action as AccionAgente;
        const v = ESQUEMAS_SALIDA[accion].safeParse(r.salidaCruda);
        if (!v.success) {
          // Salida fuera de esquema: ningún efecto salvo el propio fallo de la ejecución (I7).
          await ejecutar({
            ...base,
            comando: 'run.fail',
            datos: { failure_kind: 'invalid_output', error: resumirErrores(v.error.issues), uso: r.uso, modelo: r.modelo },
          });
          final = 'failed';
        } else {
          const aplicador = APLICADORES[accion] as
            | ((e: { trx: typeof trx; ejecutar: typeof ejecutar; run: typeof run; salida: unknown }) => Promise<void>)
            | undefined;
          if (!aplicador) throw new Error(`No hay aplicador para «${accion}».`);
          await aplicador({ trx, ejecutar: (p) => ejecutar({ causa: { run: runId }, ...p }), run, salida: v.data });
          await ejecutar({ ...base, comando: 'run.complete', datos: { salida: v.data, uso: r.uso, modelo: r.modelo } });
          final = 'completed';
        }
      }
    }
    await trx
      .insertInto('step_completions')
      .values({ workflow_id: flujo, step: 'aplicar', result: JSON.stringify(final) })
      .execute();
    return final;
  });
}

async function flujoRun(runId: string, proyectoId: string): Promise<string> {
  const flujo = DBOS.workflowID ?? idFlujoRun(runId);
  const estado = await DBOS.runStep(() => preparar(runId, proyectoId), { name: 'preparar' });
  if (estado !== 'running') return estado;
  const resultado = await DBOS.runStep(() => invocar(runId), { name: 'invocar' });
  try {
    return await DBOS.runStep(() => aplicar(runId, proyectoId, resultado, flujo), { name: 'aplicar' });
  } catch (e) {
    await DBOS.runStep(() => fallarPorInfraestructura(runId, proyectoId, e), { name: 'fallar' });
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

/** Flujos adicionales (p. ej. «Actualizar conocimiento») registrados por otros módulos. */
export type ArrancadorFlujo = (id: string, proyectoId: string) => Promise<void>;
let arrancarActualizacion: ArrancadorFlujo = async () => undefined;
export function registrarArranqueActualizacion(f: ArrancadorFlujo): void {
  arrancarActualizacion = f;
}

export const motorDbos: MotorFlujos = {
  async iniciarRun(runId, proyectoId) {
    // Con el mismo workflowID, DBOS no repite el flujo: devuelve el existente.
    await DBOS.startWorkflow(flujoRunRegistrado, { workflowID: idFlujoRun(runId) })(runId, proyectoId);
  },
  async cancelarRun(runId) {
    controladores.get(runId)?.abort();
    await DBOS.cancelWorkflow(idFlujoRun(runId)).catch(() => undefined);
  },
  async iniciarActualizacion(id, proyectoId) {
    await arrancarActualizacion(id, proyectoId);
  },
};

export type MotorIniciado = { servicios: Servicios; detener(): Promise<void> };

/**
 * Configura y lanza DBOS sobre la base de la aplicación (esquema `dbos`). Al lanzar, DBOS
 * reanuda los flujos pendientes; después se arrancan las ejecuciones encoladas sin flujo.
 */
export async function iniciarMotor(base: Omit<Servicios, 'motor'>, urlBase: string): Promise<MotorIniciado> {
  const s: Servicios = { ...base, motor: motorDbos };
  servicios = s;
  DBOS.setConfig({ name: 'demiurgo', systemDatabaseUrl: urlBase, systemDatabaseSchemaName: 'dbos', logLevel: 'warn' });
  await DBOS.launch();
  const encoladas = await s.db.selectFrom('ai_runs').select(['id', 'project_id']).where('state', '=', 'queued').execute();
  for (const r of encoladas) await motorDbos.iniciarRun(r.id, r.project_id);
  return {
    servicios: s,
    async detener() {
      for (const c of controladores.values()) c.abort();
      await DBOS.shutdown();
      servicios = null;
    },
  };
}

/** Espera el resultado del flujo de una ejecución (pruebas y CLI). */
export async function esperarRun(runId: string): Promise<string | null> {
  return DBOS.retrieveWorkflow<string>(idFlujoRun(runId)).getResult();
}

/** Marca de actor para los efectos de una ejecución. */
export const actorDeRun = agenteRun;
