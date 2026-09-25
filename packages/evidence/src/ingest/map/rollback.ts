// `demiurgo.transaction.rollback` (§7.3): the commands it names closed `ok` inside a transaction that
// never committed. Their outcome becomes `rollback` and their journal payloads go, since the journal
// never got those events. The notice itself is kept in `spans`-less form: its span ids are enough.

import { ATTR } from '@demiurgo/domain';
import type { FlatLog } from '../otlp.ts';
import { type MapContext, list, touchCommand, unmapped } from './common.ts';

export async function mapRollback(ctx: MapContext, log: FlatLog): Promise<void> {
  const spans = (list(log.attributes, ATTR.rollbackSpans) ?? []).map((s) => s.toLowerCase());
  if (log.traceId === null || spans.length === 0) {
    await unmapped(ctx, 'log', 'rollback notice without span ids', log, log.time);
    return;
  }
  const marked = await ctx.client.query(
    `update commands set outcome = 'rollback' where trace_id = $1 and span_id = any($2::text[])`,
    [log.traceId, spans],
  );
  await ctx.client.query('delete from journal_payloads where trace_id = $1 and span_id = any($2::text[])', [log.traceId, spans]);
  // The command spans may arrive after the notice: remember it so a later command upsert cannot undo it.
  await ctx.client.query(
    `insert into unmapped_records (id, at, kind, reason, record) values ($1, $2, 'log', 'rollback-notice', $3)
     on conflict (id, at) do nothing`,
    [`rollback:${log.traceId}:${spans.join(',')}`, log.time, JSON.stringify(log)],
  );
  ctx.counts.upserted += marked.rowCount ?? 0;
  for (const s of spans) touchCommand(ctx, log.traceId, s);
}

/** Whether a rollback notice already names this command (for a command span that arrives late). */
export async function rolledBack(ctx: MapContext, traceId: string, spanId: string): Promise<boolean> {
  const { rowCount } = await ctx.client.query(
    `select 1 from unmapped_records where reason = 'rollback-notice' and id like $1 and record->'attributes'->$2 ? $3 limit 1`,
    [`rollback:${traceId}:%`, ATTR.rollbackSpans, spanId],
  );
  return (rowCount ?? 0) > 0;
}
