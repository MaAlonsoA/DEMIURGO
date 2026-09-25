// `command <name>` (§6.1) → `commands`, plus what the command says about the entity it touched: an
// `ai_run` command sets the run's state; a `batch.submit` caused by a run materializes the batch.

import { ATTR } from '@demiurgo/domain';
import type { FlatSpan } from '../otlp.ts';
import { type MapContext, bool, int, jsonb, list, str, touchCommand, uuidAttr } from './common.ts';
import { rolledBack } from './rollback.ts';
import { insertSpan, touchInteraction } from './span.ts';
import { upsertRun } from './step.ts';

const RUN_REQUESTS = new Set(['run.request', 'run.retry']);

export async function mapCommand(ctx: MapContext, span: FlatSpan): Promise<void> {
  const a = span.attributes;
  const inserted = await insertSpan(ctx, span, 'demiurgo');
  await touchInteraction(ctx, span, inserted);
  const command = str(a, ATTR.command) ?? span.name.replace(/^command\s+/, '');
  const entityType = str(a, ATTR.entityType);
  const entityId = str(a, ATTR.entityId);
  // A rollback notice may have arrived before the span it names (§7.3).
  const outcome = (await rolledBack(ctx, span.traceId, span.spanId))
    ? 'rollback'
    : (str(a, ATTR.outcome) ?? (span.status === 'error' ? 'error' : null));
  const eventSeq = bool(a, ATTR.eventNone) ? null : int(a, ATTR.eventSeq);
  await ctx.client.query(
    `insert into commands (trace_id, span_id, project_id, actor, actor_type, command, entity_type, entity_id,
       entity_version, state_before, state_after, event_seq, outcome, reasons, cause_run, cause_batch, cause_proposal,
       before_hash, after_hash, started_at, ended_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     on conflict (trace_id, span_id, started_at) do update set
       project_id = coalesce(excluded.project_id, commands.project_id),
       entity_id = coalesce(excluded.entity_id, commands.entity_id),
       entity_version = coalesce(excluded.entity_version, commands.entity_version),
       state_before = coalesce(excluded.state_before, commands.state_before),
       state_after = coalesce(excluded.state_after, commands.state_after),
       event_seq = coalesce(excluded.event_seq, commands.event_seq),
       -- A rollback notice already applied wins over the span's own outcome (§7.3).
       outcome = case when commands.outcome = 'rollback' then 'rollback' else coalesce(excluded.outcome, commands.outcome) end,
       reasons = coalesce(excluded.reasons, commands.reasons),
       before_hash = coalesce(excluded.before_hash, commands.before_hash),
       after_hash = coalesce(excluded.after_hash, commands.after_hash),
       ended_at = coalesce(excluded.ended_at, commands.ended_at)`,
    [
      span.traceId,
      span.spanId,
      uuidAttr(a, ATTR.projectId),
      str(a, ATTR.actor),
      str(a, ATTR.actorType),
      command,
      entityType,
      entityId,
      int(a, ATTR.entityVersion),
      str(a, ATTR.stateBefore),
      str(a, ATTR.stateAfter),
      eventSeq,
      outcome,
      jsonb(list(a, ATTR.reasons)),
      uuidAttr(a, ATTR.causeRun),
      uuidAttr(a, ATTR.causeBatch),
      uuidAttr(a, ATTR.causeProposal),
      str(a, ATTR.payloadBeforeHash),
      str(a, ATTR.payloadAfterHash),
      span.start,
      span.end,
    ],
  );
  ctx.counts.upserted += 1;
  touchCommand(ctx, span.traceId, span.spanId);

  const entityUuid = uuidAttr(a, ATTR.entityId);
  if (entityType === 'ai_run' && entityUuid !== null && outcome !== 'error') {
    await upsertRun(ctx, entityUuid, {
      trace_id: RUN_REQUESTS.has(command) ? span.traceId : null,
      project_id: uuidAttr(a, ATTR.projectId),
      state: str(a, ATTR.stateAfter),
      requested_at: RUN_REQUESTS.has(command) ? span.start : null,
    });
  }
  if (entityType === 'batch' && command === 'batch.submit' && entityUuid !== null) {
    // The run is the cause of the command, or the actor when the run itself submitted it.
    const actorRun = /^agent:run:([0-9a-f-]{36})$/i.exec(str(a, ATTR.actor) ?? '')?.[1] ?? null;
    await upsertBatch(ctx, entityUuid, {
      run_id: uuidAttr(a, ATTR.causeRun) ?? actorRun,
      trace_id: span.traceId,
      project_id: uuidAttr(a, ATTR.projectId),
      proposals: null,
      submitted_at: span.start,
    });
  }
}

export type BatchFields = {
  run_id: string | null;
  trace_id: string | null;
  project_id: string | null;
  proposals: number | null;
  submitted_at: string | null;
};

export async function upsertBatch(ctx: MapContext, batchId: string, f: BatchFields): Promise<void> {
  await ctx.client.query(
    `insert into batches (batch_id, run_id, trace_id, project_id, proposals, submitted_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (batch_id) do update set
       run_id = coalesce(excluded.run_id, batches.run_id),
       trace_id = coalesce(excluded.trace_id, batches.trace_id),
       project_id = coalesce(excluded.project_id, batches.project_id),
       proposals = coalesce(excluded.proposals, batches.proposals),
       submitted_at = coalesce(excluded.submitted_at, batches.submitted_at)`,
    [batchId, f.run_id, f.trace_id, f.project_id, f.proposals, f.submitted_at],
  );
  ctx.counts.upserted += 1;
}
