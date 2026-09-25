// Command bus. Fixed order for every command:
//   1. capability (matrix)      → 403, no effects
//   2. data validation          → 422, no effects
//   3. entity load              → 404, no effects
//   4. transition (table)       → 409, no effects
//   5. guards                   → 409 with reasons, no effects
//   6. apply + state + event in the same transaction.
// Every command runs inside a `command <name>` span (observability spec §7.3): its outcome, the
// event it left, the `demiurgo.journal` note and, for creations, the row of `trace_contexts` that
// lets a durable step hang from it later. Handlers know nothing of it.

import { randomUUID } from 'node:crypto';
import {
  ATTR,
  type CommandOutcome,
  DomainError,
  type ErrorType,
  findTransition,
  entityOf,
  isCreation,
  entityLabel,
  LOG,
  SPAN,
  sha256Hex,
  stateLabel,
  formatActor,
  allowedForComponent,
  allowedForCommand,
  type EntityName,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { INERT_SPAN_ID, errorMessageOf, errorTypeOf } from '../observe/core.ts';
import type { Attributes, SpanHandle } from '../observe/observer.ts';
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
  stage: 'stages',
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

/** What a transaction accumulates: work for after commit and the command spans that succeeded in it. */
type Scope = {
  pending: Pending[];
  /** Ids of the command spans that closed with outcome `ok`: the rollback note names them if the transaction fails. */
  okSpans: string[];
};

const newScope = (): Scope => ({ pending: [], okSpans: [] });

/** Runs a command in its own transaction and, after commit, its deferred work. */
export async function executeCommand(services: Services, request: Request): Promise<Result> {
  const scope = newScope();
  const result = await withRollbackNote(services, scope, () =>
    services.db.transaction().execute((trx) => executeInTransaction(services, trx, request, scope)),
  );
  await executePending(services, scope.pending);
  return result;
}

/** Runs several dependent commands in a single transaction. */
export async function inTransaction<T>(
  services: Services,
  job: (execute: (p: Request) => Promise<Result>, trx: Tx) => Promise<T>,
): Promise<T> {
  const scope = newScope();
  const correlation = services.observer.currentInteractionId() ?? randomUUID();
  const r = await withRollbackNote(services, scope, () =>
    services.db
      .transaction()
      .execute((trx) =>
        job((p) => executeInTransaction(services, trx, { ...p, cause: { correlation, ...p.cause } }, scope), trx),
      ),
  );
  await executePending(services, scope.pending);
  return r;
}

/**
 * The spans of the commands close inside the transaction, before it is known to commit. When it
 * fails after some of them succeeded, the `demiurgo.transaction.rollback` note names them: the
 * journal never got their events (§7.3).
 */
async function withRollbackNote<T>(services: Services, scope: Scope, transaction: () => Promise<T>): Promise<T> {
  try {
    return await transaction();
  } catch (error) {
    if (scope.okSpans.length > 0) {
      services.observer.event(LOG.transactionRollback, {
        [ATTR.rollbackSpans]: [...scope.okSpans],
        [ATTR.errorType]: errorTypeOf(error),
        [ATTR.errorMessage]: errorMessageOf(error),
      });
    }
    throw error;
  }
}

async function executePending(services: Services, pending: Pending[]): Promise<void> {
  for (const f of pending) {
    try {
      await f();
    } catch (e) {
      services.logger.error('Deferred job failed after commit', { error: String(e) });
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

/** `demiurgo.outcome` of a command that failed with a domain error (§6.1). */
function outcomeOf(type: ErrorType): CommandOutcome {
  switch (type) {
    case 'forbidden':
    case 'validation':
    case 'not_found':
    case 'invalid_transition':
    case 'guard':
      return type;
    default:
      return 'error';
  }
}

const payloadHash = (v: unknown): string | undefined => (v === undefined ? undefined : sha256Hex(JSON.stringify(v)));

/** Runs one command inside its `command <name>` span, within the given transaction. */
export async function executeInTransaction(services: Services, trx: Tx, request: Request, scope: Scope): Promise<Result> {
  const { command, actor, cause } = request;
  const attrs: Attributes = {
    [ATTR.command]: command,
    [ATTR.actor]: formatActor(actor),
    [ATTR.actorType]: actor.type,
    [ATTR.projectId]: request.projectId,
    [ATTR.entityId]: request.entityId,
    [ATTR.causeRun]: cause?.run,
    [ATTR.causeBatch]: cause?.batch,
    [ATTR.causeProposal]: cause?.proposal,
  };
  return services.observer.span(`${SPAN.command} ${command}`, attrs, async (span) => {
    try {
      const result = await runCommand(services, trx, request, scope, span);
      const spanId = span.spanId();
      if (spanId !== INERT_SPAN_ID) scope.okSpans.push(spanId);
      return result;
    } catch (error) {
      // The observer records `error.type` and `error.message` from what is thrown.
      if (error instanceof DomainError) {
        span.setAttributes({
          [ATTR.outcome]: outcomeOf(error.type),
          [ATTR.reasons]: error.reasons.length > 0 ? [...error.reasons] : undefined,
        });
      } else {
        span.setAttributes({ [ATTR.outcome]: 'error' });
      }
      throw error;
    }
  });
}

async function runCommand(services: Services, trx: Tx, request: Request, scope: Scope, span: SpanHandle): Promise<Result> {
  checkCapability(request);
  const { command, actor } = request;
  const entity = entityOf(command);
  span.setAttributes({ [ATTR.entityType]: entity });
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

  // The correlation is the active interaction (§5.1); an explicit one in the request wins.
  const cause: Cause = {
    correlation: request.cause?.correlation ?? services.observer.currentInteractionId() ?? randomUUID(),
    ...request.cause,
  };
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
        scope,
      ),
    afterCommit: (f) => {
      scope.pending.push(f);
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
  // The result of a command never goes in a note (§6.4): only what the journal carries.
  span.setAttributes({
    [ATTR.projectId]: projectId,
    [ATTR.entityId]: applied.entityId,
    [ATTR.entityVersion]: applied.version ?? undefined,
    [ATTR.stateBefore]: loaded?.state ?? undefined,
    [ATTR.stateAfter]: transition.to,
    [ATTR.outcome]: 'ok',
    [ATTR.payloadBeforeHash]: payloadHash(applied.before),
    [ATTR.payloadAfterHash]: payloadHash(applied.after),
  });
  if (applied.noChanges) {
    span.setAttributes({ [ATTR.eventNone]: true });
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
  span.setAttributes({ [ATTR.eventSeq]: seq });
  services.observer.event(
    LOG.journal,
    {
      [ATTR.eventSeq]: seq,
      [ATTR.command]: command,
      [ATTR.entityType]: entity,
      [ATTR.entityId]: applied.entityId,
      [ATTR.projectId]: projectId,
    },
    { before: applied.before ?? null, after: applied.after ?? null },
  );
  if (creation) await registerTraceContext(services, trx, span, entity, applied.entityId, projectId);
  return { projectId, entity, entityId: applied.entityId, state: transition.to, seq, result: applied.result };
}

/**
 * Ties the entity a command created to the command's span (§5.2), so a durable step that resumes
 * in another process can hang from it. Nothing is written when there is no real span (noop
 * observer, or a span the SDK could not open).
 */
async function registerTraceContext(
  services: Services,
  trx: Tx,
  span: SpanHandle,
  entity: EntityName,
  entityId: string,
  projectId: string,
): Promise<void> {
  if (span.spanId() === INERT_SPAN_ID || services.observer.currentTraceParent() === null) return;
  await trx
    .insertInto('trace_contexts')
    .values({ entity_type: entity, entity_id: entityId, project_id: projectId, trace_parent: span.traceParent() })
    .onConflict((oc) => oc.columns(['entity_type', 'entity_id']).doNothing())
    .execute();
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
