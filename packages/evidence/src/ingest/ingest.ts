// One OTLP/JSON export request = one transaction = one receipt (§11). Everything inside is
// idempotent, so a retry of the Collector or a replay of the archive changes nothing the second time.
// The partitions of every month the batch touches are created first (fixtures and old archives
// carry dates the hourly check never saw).

import type { Pool } from 'pg';
import { deriveFor } from '../derive.ts';
import { type MapContext, mapLog, mapSpan } from './map/index.ts';
import { type FlatLog, type FlatSpan, parseLogs, parseTraces, requestKind } from './otlp.ts';

export type IngestReceipt = {
  id: string;
  origin: string;
  spans: number;
  logs: number;
  upserted: number;
  unmapped: number;
  ms: number;
};

export type IngestInput = { spans?: FlatSpan[]; logs?: FlatLog[] };

/** Parses an export request of either kind into the flat records to ingest. */
export function parseRequest(request: unknown): IngestInput & { kind: ReturnType<typeof requestKind> } {
  const kind = requestKind(request);
  if (kind === 'traces') return { kind, spans: parseTraces(request) };
  if (kind === 'logs') return { kind, logs: parseLogs(request) };
  return { kind };
}

export async function ingest(pool: Pool, input: IngestInput, origin: string): Promise<IngestReceipt> {
  const started = Date.now();
  const spans = input.spans ?? [];
  const logs = input.logs ?? [];
  const client = await pool.connect();
  const ctx: MapContext = { client, counts: { upserted: 0, unmapped: 0 }, touchedCommands: new Set(), origin };
  try {
    await client.query('begin');
    const stamps = [...spans.map((s) => s.start), ...logs.map((l) => l.time)];
    if (stamps.length > 0) await client.query('select ensure_month_partitions_at($1::timestamptz[])', [stamps]);
    for (const span of spans) await mapSpan(ctx, span);
    for (const log of logs) await mapLog(ctx, log);
    if (ctx.touchedCommands.size > 0) await deriveFor(client, [...ctx.touchedCommands]);
    const ms = Date.now() - started;
    const { rows } = await client.query<{ id: string }>(
      `insert into ingest_receipts (origin, spans, logs, upserted, unmapped, ms) values ($1, $2, $3, $4, $5, $6) returning id`,
      [origin, spans.length, logs.length, ctx.counts.upserted, ctx.counts.unmapped, ms],
    );
    await client.query('commit');
    return {
      id: rows[0]?.id ?? '',
      origin,
      spans: spans.length,
      logs: logs.length,
      upserted: ctx.counts.upserted,
      unmapped: ctx.counts.unmapped,
      ms,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
