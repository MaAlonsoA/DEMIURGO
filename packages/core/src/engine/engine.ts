// Motor de pasos durable sobre DBOS Transact, en el mismo Postgres que el dominio.
// Flujo de una ejecución: preparar (tx) → invocar (agente, al menos una vez) → aplicar (tx).
// «aplicar» es idempotente: la marca en step_completions se confirma en la misma transacción
// que sus efectos, así que un corte y la reanudación no repiten el efecto (AC-ESQ-001-07).

import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { type AgentAction, OUTPUT_SCHEMAS, type AgentResult, agentRun, jsonSchemaOf, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { APPLIERS } from '../actions/appliers.ts';
import { loadMethod, schemaVersion } from '../agents/methods.ts';
import { executeCommand, inTransaction } from '../bus/bus.ts';
import { graphUpToDate } from '../context/graph.ts';
import type { WorkflowEngine, Services } from '../services.ts';
import { starters, reconcilers, setEngineServices, engineServices } from './registry.ts';

export {
  registerUpdateStarter,
  registerAssessmentStarter,
  registerReconciler,
  engineServices,
} from './registry.ts';
export type { WorkflowStarter } from './registry.ts';

const compress = promisify(gzip);
const ENGINE = system('engine');
const AGENT_TIME_MS = 180_000;

/**
 * Versión fija de la aplicación para DBOS: sin ella, DBOS la deriva del código y un cambio
 * entre un corte y el rearranque impediría recuperar los flujos pendientes. Se sube a mano
 * solo si cambia la forma de un flujo de manera incompatible.
 */
export const WORKFLOWS_VERSION = 'demiurgo-v2-flujos-1';

/** Reintentos de los pasos transaccionales ante fallos transitorios (corte de conexión, bloqueo). */
const RETRIES = { retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 } as const;

const controllers = new Map<string, AbortController>();

// DBOS no permite arrancar un flujo desde dentro de un paso. Los arranques pedidos dentro de un
// flujo (p. ej. tras confirmar un paso) se difieren a un temporizador creado al lanzar el motor,
// fuera de cualquier contexto de DBOS. Si el proceso cae antes, la conciliación al arrancar los recupera.
const deferred: (() => Promise<void>)[] = [];
let dispatcher: NodeJS.Timeout | undefined;

function startOutsideWorkflow(startup: () => Promise<void>): Promise<void> {
  if (!DBOS.isWithinWorkflow()) return startup();
  deferred.push(startup);
  return Promise.resolve();
}

async function dispatchDeferred(): Promise<void> {
  while (deferred.length > 0) {
    const next = deferred.shift();
    try {
      await next?.();
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', m: 'No se pudo arrancar un flujo diferido', error: String(e) }));
    }
  }
}
let onStepComplete: ((step: string, id: string) => void) | undefined;

function require(): Services {
  return engineServices();
}

export const workflowRunId = (runId: string): string => `run:${runId}`;

async function prepare(runId: string, projectId: string): Promise<string> {
  const s = require();
  const run = await s.db.selectFrom('ai_runs').select('state').where('id', '=', runId).executeTakeFirstOrThrow();
  if (run.state === 'queued') {
    await executeCommand(s, { command: 'run.begin', actor: ENGINE, projectId, entityId: runId, data: {} });
    return 'running';
  }
  return run.state;
}

async function invoke(runId: string): Promise<AgentResult> {
  const s = require();
  const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
  const pack = await s.db
    .selectFrom('context_packs')
    .select(['hash', 'content'])
    .where('id', '=', run.context_pack_id ?? '')
    .executeTakeFirstOrThrow();
  const action = run.action as AgentAction;
  const [, version] = run.method.split('@');
  const method = await loadMethod(action, version);
  const control = new AbortController();
  controllers.set(runId, control);
  try {
    return await s.agent.execute({
      runId,
      action,
      method: { version: method.id, text: method.text },
      outputSchema: jsonSchemaOf(action),
      context: { hash: pack.hash, content: pack.content },
      budget: { timeMs: AGENT_TIME_MS },
      signal: control.signal,
    });
  } catch (e) {
    return {
      state: 'error',
      failureKind: 'infra',
      message: `El adaptador falló: ${String(e)}`,
      rawEvents: '',
      provider: s.agent.provider,
      model: 'unknown',
    };
  } finally {
    controllers.delete(runId);
  }
}

function summarizeErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 8)
    .map((i) => `${i.path.map(String).join('.') || 'output'}: ${i.message}`)
    .join('; ');
}

async function apply(runId: string, projectId: string, r: AgentResult, workflow: string): Promise<string> {
  const s = require();
  const final = await inTransaction(s, async (execute, trx) => {
    // Mismo orden de bloqueos que el bus (proyecto y después la entidad): sin interbloqueos.
    await sql`select 1 from projects where id = ${projectId}::uuid for update`.execute(trx);
    const done = await trx
      .selectFrom('step_completions')
      .select('result')
      .where('workflow_id', '=', workflow)
      .where('step', '=', 'apply')
      .executeTakeFirst();
    if (done) return String(done.result);
    const run = await trx.selectFrom('ai_runs').selectAll().where('id', '=', runId).forUpdate().executeTakeFirstOrThrow();
    let state = run.state;
    if (run.state === 'running') {
      const attempt =
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
        .values({ project_id: projectId, run_id: runId, attempt: attempt, raw_gzip: await compress(r.rawEvents) })
        .execute();
      const base = { actor: ENGINE, projectId, entityId: runId, cause: { run: runId } };
      const action = run.action as AgentAction;
      if (r.state === 'error') {
        await execute({
          ...base,
          command: 'run.fail',
          data: { failure_kind: r.failureKind, error: r.message, usage: r.usage ?? null, model: r.model },
        });
        state = 'failed';
      } else if (schemaVersion(action) !== run.schema_version) {
        // El esquema se fija por ejecución (I7): si el código cambió desde que se pidió, no se valida con otro.
        await execute({
          ...base,
          command: 'run.fail',
          data: {
            failure_kind: 'infra',
            error: 'El esquema de salida de la acción cambió desde que se pidió la ejecución.',
            usage: r.usage,
            model: r.model,
          },
        });
        state = 'failed';
      } else {
        const v = OUTPUT_SCHEMAS[action].safeParse(r.rawOutput);
        if (!v.success) {
          // Salida fuera de esquema: ningún efecto salvo el propio fallo de la ejecución (I7).
          await execute({
            ...base,
            command: 'run.fail',
            data: { failure_kind: 'invalid_output', error: summarizeErrors(v.error.issues), usage: r.usage, model: r.model },
          });
          state = 'failed';
        } else {
          const applier = APPLIERS[action] as
            | ((e: { trx: typeof trx; execute: typeof execute; run: typeof run; output: unknown }) => Promise<void>)
            | undefined;
          if (!applier) throw new Error(`No hay aplicador para «${action}».`);
          await applier({ trx, execute: (p) => execute({ cause: { run: runId }, ...p }), run, output: v.data });
          await execute({ ...base, command: 'run.complete', data: { output: v.data, usage: r.usage, model: r.model } });
          state = 'completed';
        }
      }
    }
    await trx
      .insertInto('step_completions')
      .values({ workflow_id: workflow, step: 'apply', result: JSON.stringify(state) })
      .execute();
    return state;
  });
  onStepComplete?.('apply', runId);
  return final;
}

async function runWorkflow(runId: string, projectId: string): Promise<string> {
  const workflow = DBOS.workflowID ?? workflowRunId(runId);
  const state = await DBOS.runStep(() => prepare(runId, projectId), { name: 'prepare', ...RETRIES });
  if (state !== 'running') return state;
  const result = await DBOS.runStep(() => invoke(runId), { name: 'invoke' });
  try {
    return await DBOS.runStep(() => apply(runId, projectId, result, workflow), { name: 'apply', ...RETRIES });
  } catch (e) {
    await DBOS.runStep(() => failForInfrastructure(runId, projectId, e), { name: 'fail', ...RETRIES });
    return 'failed';
  }
}

/** Un error del propio sistema al aplicar deja la ejecución fallida (infra), nunca colgada. */
async function failForInfrastructure(runId: string, projectId: string, e: unknown): Promise<void> {
  const s = require();
  const run = await s.db.selectFrom('ai_runs').select('state').where('id', '=', runId).executeTakeFirstOrThrow();
  if (run.state !== 'running') return;
  await executeCommand(s, {
    command: 'run.fail',
    actor: ENGINE,
    projectId,
    entityId: runId,
    data: { failure_kind: 'infra', error: `Error al aplicar la salida: ${String(e).slice(0, 3000)}` },
  });
}

const runWorkflowRegistered = DBOS.registerWorkflow(runWorkflow, { name: 'demiurgo.run' });

// Respuesta durable a un mensaje de la persona: espera a que el conocimiento esté al día y
// pide la ejecución de exploration_chat una sola vez (marca en step_completions).
async function requestResponse(
  workflow: string,
  projectId: string,
  explorationId: string,
  questionId: string | null,
): Promise<void> {
  const s = require();
  await inTransaction(s, async (execute, trx) => {
    await sql`select 1 from projects where id = ${projectId}::uuid for update`.execute(trx);
    const done = await trx
      .selectFrom('step_completions')
      .select('step')
      .where('workflow_id', '=', workflow)
      .where('step', '=', 'request')
      .executeTakeFirst();
    if (done) return;
    const exploration = await trx.selectFrom('explorations').select('state').where('id', '=', explorationId).executeTakeFirst();
    if (exploration?.state === 'active') {
      await execute({
        command: 'run.request',
        actor: system('conversation'),
        projectId,
        data: {
          action: 'exploration_chat',
          scope: { type: 'exploration', id: explorationId },
          input: questionId ? { question_id: questionId } : {},
        },
      });
    }
    await trx
      .insertInto('step_completions')
      .values({ workflow_id: workflow, step: 'request', result: JSON.stringify('ok') })
      .execute();
  });
}

async function respondWorkflow(projectId: string, explorationId: string, questionId: string | null): Promise<void> {
  const workflow = DBOS.workflowID ?? `respuesta:${explorationId}`;
  for (let i = 0; i < 120; i++) {
    const upToDate = await DBOS.runStep(
      () =>
        require()
          .db.transaction()
          .execute((trx) => graphUpToDate(trx, projectId)),
      {
        name: 'freshness',
      },
    );
    if (upToDate.upToDate) break;
    await DBOS.sleepms(500);
  }
  await DBOS.runStep(() => requestResponse(workflow, projectId, explorationId, questionId), { name: 'request', ...RETRIES });
}

const respondWorkflowRegistered = DBOS.registerWorkflow(respondWorkflow, { name: 'demiurgo.respond' });

export const dbosEngine: WorkflowEngine = {
  async startRun(runId, projectId) {
    // Con el mismo workflowID, DBOS no repite el flujo: devuelve el existente.
    await startOutsideWorkflow(async () => {
      await DBOS.startWorkflow(runWorkflowRegistered, { workflowID: workflowRunId(runId) })(runId, projectId);
    });
  },
  async cancelRun(runId) {
    controllers.get(runId)?.abort();
    await DBOS.cancelWorkflow(workflowRunId(runId)).catch(() => undefined);
  },
  async startUpdate(id, projectId) {
    await startOutsideWorkflow(() => starters.update(id, projectId));
  },
  async startEvaluation(batchId, projectId) {
    await startOutsideWorkflow(() => starters.assessment(batchId, projectId));
  },
  async startResponse(messageId, projectId, explorationId, questionId) {
    await startOutsideWorkflow(async () => {
      await DBOS.startWorkflow(respondWorkflowRegistered, { workflowID: `respuesta:${messageId}` })(
        projectId,
        explorationId,
        questionId ?? null,
      );
    });
  },
};

export type EngineOptions = {
  /** Solo para pruebas de durabilidad: se llama justo después de confirmar un paso. */
  onStepComplete?: (step: string, id: string) => void;
};

export type StartedEngine = { services: Services; stop(): Promise<void> };

/**
 * Concilia al arrancar: una ejecución encolada sin flujo se arranca; una en curso cuyo flujo
 * ya no se puede reanudar (fallido, cancelado o inexistente) queda interrumpida para que la
 * persona la reintente con el mismo context pack. Nunca queda colgada.
 */
async function reconcileRuns(s: Services): Promise<void> {
  const liveRuns = await s.db
    .selectFrom('ai_runs')
    .select(['id', 'project_id', 'state'])
    .where('state', 'in', ['queued', 'running'])
    .execute();
  for (const r of liveRuns) {
    const workflow = await DBOS.getWorkflowStatus(workflowRunId(r.id));
    const alive = workflow && ['PENDING', 'ENQUEUED', 'SUCCESS'].includes(workflow.status);
    if (alive) continue;
    if (!workflow && r.state === 'queued') {
      await dbosEngine.startRun(r.id, r.project_id);
      continue;
    }
    const reason = workflow
      ? `El flujo de la ejecución terminó en ${workflow.status} sin completarla; reinténtala.`
      : 'El proceso se cortó sin un flujo que reanudar; reinténtala con el mismo context pack.';
    await executeCommand(s, {
      command: r.state === 'running' ? 'run.interrupt' : 'run.fail',
      actor: ENGINE,
      projectId: r.project_id,
      entityId: r.id,
      data: r.state === 'running' ? { reason } : { failure_kind: 'infra', error: reason },
    });
  }
}

/**
 * Configura y lanza DBOS sobre la base de la aplicación (esquema `dbos`). Al lanzar, DBOS
 * reanuda los flujos pendientes; después se concilian las ejecuciones y las actualizaciones.
 */
export async function startEngine(
  base: Omit<Services, 'engine'>,
  baseUrl: string,
  options: EngineOptions = {},
): Promise<StartedEngine> {
  const s: Services = { ...base, engine: dbosEngine };
  setEngineServices(s);
  onStepComplete = options.onStepComplete;
  DBOS.setConfig({
    name: 'demiurgo',
    systemDatabaseUrl: baseUrl,
    systemDatabaseSchemaName: 'dbos',
    applicationVersion: WORKFLOWS_VERSION,
    executorID: 'local',
    logLevel: 'warn',
  });
  await DBOS.launch();
  dispatcher = setInterval(() => {
    void dispatchDeferred();
  }, 50);
  await reconcileRuns(s);
  for (const c of reconcilers) await c(s);
  return {
    services: s,
    async stop() {
      for (const c of controllers.values()) c.abort();
      clearInterval(dispatcher);
      await dispatchDeferred();
      await DBOS.shutdown();
      setEngineServices(null);
    },
  };
}

/** Espera el resultado del flujo de una ejecución (pruebas y CLI). */
export async function waitForRun(runId: string): Promise<string | null> {
  return DBOS.retrieveWorkflow<string>(workflowRunId(runId)).getResult();
}

/** Espera la respuesta durable a un mensaje (pruebas). */
export async function waitForResponse(messageId: string): Promise<void> {
  await DBOS.retrieveWorkflow<void>(`respuesta:${messageId}`).getResult();
}

/** Marca de actor para los efectos de una ejecución. */
export const actorOfRun = agentRun;
