// `demiurgo.journal` (§6.3) → `journal_payloads`, next to the command span that produced the event,
// plus what the payload says about runs and batches (the names come from the core's handlers:
// `run.request` → { action, agent, engine, context_pack, answers_message }, `run.retry` → { retry_of,
// engine, override }, `run.complete` → { usage, model }, `run.fail` → { failure_kind, error },
// `batch.submit` → { proposals, ... }).

import { ATTR } from '@demiurgo/domain';
import type { FlatLog } from '../otlp.ts';
import { upsertBatch } from './command.ts';
import { type MapContext, int, jsonb, str, touchCommand, unmapped, uuid, uuidAttr } from './common.ts';
import { rolledBack } from './rollback.ts';
import { type RunFields, upsertRun } from './step.ts';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function journalBody(body: unknown): { before: unknown; after: unknown } {
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      parsed = null;
    }
  }
  if (!isObject(parsed)) return { before: null, after: null };
  return { before: parsed.before ?? null, after: parsed.after ?? null };
}

export async function mapJournal(ctx: MapContext, log: FlatLog): Promise<void> {
  const a = log.attributes;
  if (log.traceId === null || log.spanId === null) {
    await unmapped(ctx, 'log', 'journal record without a span', log, log.time);
    return;
  }
  // The journal never got the events of a rolled-back transaction (§7.3).
  if (await rolledBack(ctx, log.traceId, log.spanId)) return;
  const { before, after } = journalBody(log.body);
  await ctx.client.query(
    `insert into journal_payloads (trace_id, span_id, at, event_seq, before, after) values ($1, $2, $3, $4, $5, $6)
     on conflict (trace_id, span_id, at) do update set
       event_seq = coalesce(excluded.event_seq, journal_payloads.event_seq),
       before = excluded.before, after = excluded.after`,
    [log.traceId, log.spanId, log.time, int(a, ATTR.eventSeq), jsonb(before), jsonb(after)],
  );
  ctx.counts.upserted += 1;
  touchCommand(ctx, log.traceId, log.spanId);

  const command = str(a, ATTR.command);
  const entityType = str(a, ATTR.entityType);
  const entityId = uuidAttr(a, ATTR.entityId);
  if (entityId === null || command === null) return;
  const payload = isObject(after) ? after : {};

  if (entityType === 'ai_run') {
    const fields: RunFields = { trace_id: log.traceId, project_id: uuidAttr(a, ATTR.projectId) };
    const engine = isObject(payload.engine) ? payload.engine : {};
    switch (command) {
      case 'run.request':
      case 'run.retry':
        fields.action = typeof payload.action === 'string' ? payload.action : null;
        fields.agent = typeof payload.agent === 'string' ? payload.agent : null;
        fields.provider = typeof engine.provider === 'string' ? engine.provider : null;
        fields.requested_model = typeof engine.model === 'string' ? engine.model : null;
        fields.effort = typeof engine.effort === 'string' ? engine.effort : null;
        fields.pack_hash = typeof payload.context_pack === 'string' ? payload.context_pack : null;
        fields.answers_message_id = uuid(payload.answers_message);
        fields.retry_of = uuid(payload.retry_of);
        fields.engine_source = command === 'run.retry' && payload.override ? 'override' : null;
        fields.requested_at = log.time;
        break;
      case 'run.complete':
        fields.usage = jsonb(payload.usage);
        fields.observed_model = typeof payload.model === 'string' ? payload.model : null;
        fields.finished_at = log.time;
        break;
      case 'run.fail':
        fields.failure_kind = typeof payload.failure_kind === 'string' ? payload.failure_kind : null;
        fields.error = typeof payload.error === 'string' ? payload.error : null;
        fields.finished_at = log.time;
        break;
      default:
        return;
    }
    await upsertRun(ctx, entityId, fields);
  } else if (entityType === 'batch' && command === 'batch.submit') {
    await upsertBatch(ctx, entityId, {
      run_id: uuid(payload.run_id) ?? uuid(payload.run),
      trace_id: log.traceId,
      project_id: uuidAttr(a, ATTR.projectId),
      proposals: typeof payload.proposals === 'number' ? payload.proposals : null,
      submitted_at: log.time,
    });
  }
}
