// Every span lands in `spans`, whatever its service (§11), with the ids it carries as columns.
// Insert-only by (trace_id, span_id): the same span again changes nothing, and says so.

import { ATTR, interactionIdOf } from '@demiurgo/domain';
import type { FlatSpan } from '../otlp.ts';
import { type MapContext, type SpanSource, durationMs, str, uuid, uuidAttr } from './common.ts';

export async function insertSpan(
  ctx: MapContext,
  span: FlatSpan,
  source: SpanSource,
  callId: string | null = null,
): Promise<boolean> {
  const a = span.attributes;
  const { rowCount } = await ctx.client.query(
    `insert into spans (trace_id, span_id, parent_span_id, source, kind, name, started_at, ended_at, duration_ms,
       status, error_type, error_message, project_id, run_id, call_id, update_id, batch_id, entity_type, entity_id,
       attributes, links)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     on conflict (trace_id, span_id, started_at) do nothing`,
    [
      span.traceId,
      span.spanId,
      span.parentSpanId,
      source,
      span.kind,
      span.name,
      span.start,
      span.end,
      durationMs(span.start, span.end),
      span.status,
      str(a, ATTR.errorType),
      str(a, ATTR.errorMessage) ?? span.statusMessage,
      uuidAttr(a, ATTR.projectId),
      uuidAttr(a, ATTR.runId),
      uuidAttr(a, ATTR.callId) ?? uuid(callId),
      uuidAttr(a, ATTR.updateId),
      uuidAttr(a, ATTR.batchId),
      str(a, ATTR.entityType),
      str(a, ATTR.entityId),
      JSON.stringify(a),
      JSON.stringify(span.links),
    ],
  );
  const inserted = (rowCount ?? 0) > 0;
  if (inserted) ctx.counts.upserted += 1;
  return inserted;
}

/**
 * Every DEMIURGO span keeps its interaction alive (§5.1: `last_seen_at` is computed here) and is
 * counted once: a span already stored counts nothing, so a replay leaves the counters alone.
 */
export async function touchInteraction(ctx: MapContext, span: FlatSpan, inserted: boolean): Promise<void> {
  const id = interactionIdOf(span.traceId);
  const seen = span.end ?? span.start;
  const spans = inserted ? 1 : 0;
  const errors = inserted && span.status === 'error' ? 1 : 0;
  await ctx.client.query(
    `insert into interactions (id, last_seen_at, span_count, error_count) values ($1, $2, $3, $4)
     on conflict (id) do update set
       last_seen_at = greatest(interactions.last_seen_at, excluded.last_seen_at),
       span_count = interactions.span_count + excluded.span_count,
       error_count = interactions.error_count + excluded.error_count`,
    [id, seen, spans, errors],
  );
}
