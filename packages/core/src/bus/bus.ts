// Bus de comandos. Orden fijo para cada comando:
//   1. capacidad (matriz)       → 403 sin efectos
//   2. validación de los datos  → 422 sin efectos
//   3. carga de la entidad      → 404 sin efectos
//   4. transición (tabla)       → 409 sin efectos
//   5. guardas                  → 409 con motivos, sin efectos
//   6. aplicar + estado + evento en la misma transacción.

import { randomUUID } from 'node:crypto';
import {
  DomainError,
  findTransition,
  entityOf,
  isCreation,
  entityLabel,
  stateLabel,
  formatActor,
  allowedForComponent,
  allowedForCommand,
  type EntityName,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Services } from '../services.ts';
import '../commands/index.ts';
import { GUARDS } from './guards.ts';
import { HANDLERS } from './handlers.ts';
import type { Cause, CommandContext, LoadedEntity, Request, Result, Tx } from './types.ts';

/** Tabla de cada entidad implementada. */
export const TABLES: Partial<Record<EntityName, string>> = {
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
  knowledge_node: 'knowledge_nodes',
  knowledge_edge: 'knowledge_edges',
  idea_assessment: 'idea_assessments',
};

type Pending = () => Promise<void> | void;

/** Ejecuta un comando en su propia transacción y, tras confirmar, el trabajo diferido. */
export async function executeCommand(services: Services, request: Request): Promise<Result> {
  checkCapability(request);
  const pending: Pending[] = [];
  const result = await services.db
    .transaction()
    .execute((trx) => executeInTransaction(services, trx, request, pending));
  await executePending(services, pending);
  return result;
}

/** Ejecuta varios comandos dependientes en una sola transacción. */
export async function inTransaction<T>(
  services: Services,
  job: (execute: (p: Request) => Promise<Result>, trx: Tx) => Promise<T>,
): Promise<T> {
  const pending: Pending[] = [];
  const correlation = randomUUID();
  const r = await services.db
    .transaction()
    .execute((trx) =>
      job((p) => executeInTransaction(services, trx, { ...p, cause: { correlation, ...p.cause } }, pending), trx),
    );
  await executePending(services, pending);
  return r;
}

async function executePending(services: Services, pending: Pending[]): Promise<void> {
  for (const f of pending) {
    try {
      await f();
    } catch (e) {
      services.record.error('Fallo en trabajo diferido tras confirmar', { error: String(e) });
    }
  }
}

function checkCapability(p: Request): void {
  if (!allowedForCommand(p.command, p.actor.type)) {
    throw new DomainError('forbidden', `${formatActor(p.actor)} no puede ejecutar «${p.command}».`, [
      `La matriz de capacidades no permite «${p.command}» a ${p.actor.type}.`,
    ]);
  }
  if (!allowedForComponent(p.command, p.actor)) {
    throw new DomainError('forbidden', `${formatActor(p.actor)} no puede ejecutar «${p.command}».`, [
      `El componente ${formatActor(p.actor)} solo escribe conocimiento derivado, clasificaciones y propuestas.`,
    ]);
  }
}

async function loadEntity(trx: Tx, entity: EntityName, id: string, projectId: string): Promise<LoadedEntity> {
  const table = TABLES[entity];
  if (!table) throw new DomainError('not_implemented', `La entidad «${entity}» aún no está implementada.`);
  const isProject = entity === 'project';
  const { rows } = await sql<Record<string, unknown>>`
    select * from ${sql.table(table)} where id = ${id}::uuid for update`.execute(trx);
  const row = rows[0];
  const projectRow = isProject ? row?.id : row?.project_id;
  if (!row || projectRow !== projectId) {
    throw new DomainError('not_found', `No existe ${entityLabel(entity).toLowerCase()} ${id} en este proyecto.`);
  }
  return { id, projectId, state: String(row.state), row };
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function executeInTransaction(
  services: Services,
  trx: Tx,
  request: Request,
  pending: Pending[],
): Promise<Result> {
  checkCapability(request);
  const { command, actor } = request;
  const entity = entityOf(command);
  const handler = HANDLERS[command];
  if (!handler) throw new DomainError('not_implemented', `El comando «${command}» aún no está implementado.`);

  const validation = handler.data.safeParse(request.data ?? {});
  if (!validation.success) {
    throw new DomainError(
      'validation',
      `Los datos de «${command}» no son válidos.`,
      validation.error.issues.map((i) => `${i.path.join('.') || 'data'}: ${i.message}`),
    );
  }

  const creation = isCreation(command);
  let projectId = request.projectId ?? '';
  if (command !== 'project.create') {
    if (!RE_UUID.test(projectId)) throw new DomainError('not_found', 'Falta el proyecto.');
    const project = await sql<{ state: string }>`select state from projects where id = ${projectId}::uuid for update`.execute(
      trx,
    );
    const projectState = project.rows[0]?.state;
    if (!projectState) throw new DomainError('not_found', 'El proyecto no existe.');
    if (projectState === 'archived' && entity !== 'project') {
      throw new DomainError('invalid_transition', 'El proyecto está archivado: no admite cambios.');
    }
  }

  let loaded: LoadedEntity | null = null;
  if (!creation) {
    const id = request.entityId ?? '';
    if (!RE_UUID.test(id)) throw new DomainError('not_found', `Falta la entidad sobre la que actúa «${command}».`);
    loaded = await loadEntity(trx, entity, id, projectId);
  }

  const transition = findTransition(entity, loaded?.state ?? null, command);
  if (!transition) {
    const state = loaded ? stateLabel(entity, loaded.state) : 'new';
    throw new DomainError(
      'invalid_transition',
      `No se puede aplicar «${command}» a ${entityLabel(entity).toLowerCase()} en estado «${state}».`,
    );
  }

  const cause: Cause = { correlation: request.cause?.correlation ?? randomUUID(), ...request.cause };
  const ctx: CommandContext = {
    trx,
    actor,
    projectId,
    command,
    cause,
    services,
    execute: (p) =>
      executeInTransaction(
        services,
        trx,
        { projectId, ...p, cause: { ...cause, sourceCommand: cause.sourceCommand ?? command, ...p.cause } },
        pending,
      ),
    afterConfirm: (f) => {
      pending.push(f);
    },
  };

  const reasons: string[] = [];
  for (const name of transition.guards) {
    const guard = GUARDS[name];
    if (!guard) throw new Error(`La guarda «${name}» no tiene implementación.`);
    const reason = await guard({ ctx, data: validation.data, entity: loaded });
    if (reason) reasons.push(reason);
  }
  if (reasons.length > 0) {
    throw new DomainError('guard', `No se cumplen las condiciones de «${command}».`, reasons);
  }

  // El estado cambia antes de aplicar: los comandos anidados ya ven la entidad en su estado nuevo.
  if (loaded) {
    const table = TABLES[entity] as string;
    await sql`update ${sql.table(table)} set state = ${transition.to} where id = ${loaded.id}::uuid`.execute(trx);
  }
  const applied = await handler.apply(ctx, validation.data, loaded, transition.to);
  if (applied.projectId) {
    projectId = applied.projectId;
    ctx.projectId = projectId;
  }
  if (applied.noChanges) {
    return {
      projectId,
      entity,
      entityId: applied.entityId,
      state: transition.to,
      seq: null,
      result: applied.result,
    };
  }
  const seq = await registerEvent(trx, {
    projectId,
    actor: formatActor(actor),
    command,
    entity,
    entityId: applied.entityId,
    version: applied.version ?? null,
    stateBefore: loaded?.state ?? null,
    stateAfter: transition.to,
    before: applied.before,
    after: applied.after,
    cause,
  });
  return { projectId, entity, entityId: applied.entityId, state: transition.to, seq, result: applied.result };
}

type NewEvent = {
  projectId: string;
  actor: string;
  command: string;
  entity: string;
  entityId: string;
  version: number | null;
  stateBefore: string | null;
  stateAfter: string | null;
  before?: unknown;
  after?: unknown;
  cause: Cause;
};

const toJson = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

/** Añade un evento al diario con el siguiente número de secuencia del proyecto. */
export async function registerEvent(trx: Tx, e: NewEvent): Promise<number> {
  const { event_seq } = await trx
    .updateTable('projects')
    .set({ event_seq: sql`event_seq + 1` })
    .where('id', '=', e.projectId)
    .returning('event_seq')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('events')
    .values({
      project_id: e.projectId,
      seq: event_seq,
      actor: e.actor,
      command: e.command,
      entity_type: e.entity,
      entity_id: e.entityId,
      entity_version: e.version,
      state_before: e.stateBefore,
      state_after: e.stateAfter,
      before: toJson(e.before),
      after: toJson(e.after),
      cause: toJson(e.cause),
    })
    .execute();
  return Number(event_seq);
}
