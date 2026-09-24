// Command bus. Fixed order for every command:
//   1. capability (matrix)      → 403, no effects
//   2. data validation          → 422, no effects
//   3. entity load              → 404, no effects
//   4. transition (table)       → 409, no effects
//   5. guards                   → 409 with reasons, no effects
//   6. apply + state + event in the same transaction.

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

/** Table for each implemented entity. */
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

/** Runs a command in its own transaction and, after commit, its deferred work. */
export async function executeCommand(services: Services, request: Request): Promise<Result> {
  checkCapability(request);
  const pending: Pending[] = [];
  const result = await services.db.transaction().execute((trx) => executeInTransaction(services, trx, request, pending));
  await executePending(services, pending);
  return result;
}

/** Runs several dependent commands in a single transaction. */
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
      services.record.error('Deferred job failed after commit', { error: String(e) });
    }
  }
}

function checkCapability(p: Request): void {
  if (!allowedForCommand(p.command, p.actor.type)) {
    throw new DomainError('forbidden', `${formatActor(p.actor)} cannot execute "${p.command}".`, [
      `The capability matrix does not allow "${p.command}" for ${p.actor.type}.`,
    ]);
  }
  if (!allowedForComponent(p.command, p.actor)) {
    throw new DomainError('forbidden', `${formatActor(p.actor)} cannot execute "${p.command}".`, [
      `The component ${formatActor(p.actor)} only writes derived knowledge, classifications and proposals.`,
    ]);
  }
}

async function loadEntity(trx: Tx, entity: EntityName, id: string, projectId: string): Promise<LoadedEntity> {
  const table = TABLES[entity];
  if (!table) throw new DomainError('not_implemented', `The "${entity}" entity is not implemented yet.`);
  const isProject = entity === 'project';
  const { rows } = await sql<Record<string, unknown>>`
    select * from ${sql.table(table)} where id = ${id}::uuid for update`.execute(trx);
  const row = rows[0];
  const projectRow = isProject ? row?.id : row?.project_id;
  if (!row || projectRow !== projectId) {
    throw new DomainError('not_found', `There is no ${entityLabel(entity).toLowerCase()} ${id} in this project.`);
  }
  return { id, projectId, state: String(row.state), row };
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function executeInTransaction(services: Services, trx: Tx, request: Request, pending: Pending[]): Promise<Result> {
  checkCapability(request);
  const { command, actor } = request;
  const entity = entityOf(command);
  const handler = HANDLERS[command];
  if (!handler) throw new DomainError('not_implemented', `The "${command}" command is not implemented yet.`);

  const validation = handler.data.safeParse(request.data ?? {});
  if (!validation.success) {
    throw new DomainError(
      'validation',
      `The data for "${command}" is invalid.`,
      validation.error.issues.map((i) => `${i.path.join('.') || 'data'}: ${i.message}`),
    );
  }

  const creation = isCreation(command);
  let projectId = request.projectId ?? '';
  if (command !== 'project.create') {
    if (!RE_UUID.test(projectId)) throw new DomainError('not_found', 'The project is missing.');
    const project = await sql<{ state: string }>`select state from projects where id = ${projectId}::uuid for update`.execute(
      trx,
    );
    const projectState = project.rows[0]?.state;
    if (!projectState) throw new DomainError('not_found', 'The project does not exist.');
    if (projectState === 'archived' && entity !== 'project') {
      throw new DomainError('invalid_transition', 'The project is archived: it does not accept changes.');
    }
  }

  let loaded: LoadedEntity | null = null;
  if (!creation) {
    const id = request.entityId ?? '';
    if (!RE_UUID.test(id)) throw new DomainError('not_found', `The entity that "${command}" acts on is missing.`);
    loaded = await loadEntity(trx, entity, id, projectId);
  }

  const transition = findTransition(entity, loaded?.state ?? null, command);
  if (!transition) {
    const state = loaded ? stateLabel(entity, loaded.state) : 'new';
    throw new DomainError(
      'invalid_transition',
      `Cannot apply "${command}" to ${entityLabel(entity).toLowerCase()} in state "${state}".`,
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
    if (!guard) throw new Error(`The "${name}" guard has no implementation.`);
    const reason = await guard({ ctx, data: validation.data, entity: loaded });
    if (reason) reasons.push(reason);
  }
  if (reasons.length > 0) {
    throw new DomainError('guard', `The conditions for "${command}" are not met.`, reasons);
  }

  // The state changes before applying: nested commands already see the entity in its new state.
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

/** Appends an event to the log with the project's next sequence number. */
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
