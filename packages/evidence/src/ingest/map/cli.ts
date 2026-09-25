// Native telemetry of Claude Code and Codex (§13): their spans go to `spans` with their source, and
// their API request events become `cli_requests`, joined to our call by the resource attribute
// `demiurgo.call.id` or, failing that, by the trace. Codex counts the cache inside `input_tokens`
// (§8); Claude Code reports it apart. Everything they send stays in `attributes`.

import { ATTR } from '@demiurgo/domain';
import type { Attrs, FlatLog, FlatSpan } from '../otlp.ts';
import { type MapContext, type SpanSource, int, num, recordHash, str, unmapped, uuid, uuidAttr } from './common.ts';
import { insertSpan } from './span.ts';

/** The events that describe one API request (§13). Anything else of theirs is kept as unmapped. */
export const CLI_REQUEST_EVENTS: ReadonlySet<string> = new Set([
  'claude_code.api_request',
  'claude_code.api_error',
  'claude_code.api_retry',
  'codex.api_request',
  'codex.sse_event',
]);

/** The call a CLI note belongs to: the resource says it, or the trace does (the call span shares it). */
export async function callOf(ctx: MapContext, resource: Attrs, traceId: string | null): Promise<string | null> {
  const fromResource = uuidAttr(resource, ATTR.callId);
  if (fromResource !== null) return fromResource;
  if (traceId === null) return null;
  const { rows } = await ctx.client.query<{ call_id: string }>(
    'select call_id from provider_calls where trace_id = $1 order by started_at desc nulls last limit 1',
    [traceId],
  );
  return uuid(rows[0]?.call_id);
}

export async function mapCliSpan(ctx: MapContext, span: FlatSpan, source: SpanSource): Promise<void> {
  await insertSpan(ctx, span, source, await callOf(ctx, span.resource, span.traceId));
}

export async function mapCliLog(ctx: MapContext, log: FlatLog, source: SpanSource): Promise<void> {
  const name = log.eventName ?? '';
  if (!CLI_REQUEST_EVENTS.has(name)) {
    await unmapped(ctx, 'log', `CLI event not mapped: ${name || '(unnamed)'}`, log, log.time);
    return;
  }
  const a = log.attributes;
  const codex = source === 'codex';
  const cacheRead = int(a, codex ? 'cached_tokens' : 'cache_read_tokens') ?? int(a, 'cache_read_input_tokens');
  const input = int(a, 'input_tokens');
  const uncached = input === null ? null : codex ? input - (cacheRead ?? 0) : input;
  const errorStatus =
    str(a, 'status_code') ??
    str(a, 'http.response.status_code') ??
    str(a, 'status') ??
    str(a, 'error') ??
    str(a, 'error.message');
  const { rowCount } = await ctx.client.query(
    `insert into cli_requests (id, trace_id, call_id, source, request_id, attempt, model, at, duration_ms, ttft_ms,
       stop_reason, tokens_uncached_input, tokens_cache_read, tokens_cache_write, tokens_output, tokens_reasoning, cost_usd,
       error_status, attributes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     on conflict (id, at) do update set call_id = coalesce(cli_requests.call_id, excluded.call_id)`,
    [
      recordHash(log),
      log.traceId,
      await callOf(ctx, log.resource, log.traceId),
      source,
      str(a, 'request_id'),
      int(a, 'attempt'),
      str(a, 'model'),
      log.time,
      num(a, 'duration_ms'),
      num(a, 'ttft_ms'),
      str(a, 'stop_reason'),
      uncached,
      cacheRead,
      int(a, 'cache_creation_tokens') ?? int(a, 'cache_write_tokens'),
      int(a, 'output_tokens'),
      int(a, 'reasoning_tokens'),
      num(a, 'cost_usd'),
      name.endsWith('api_request') && errorStatus === null
        ? null
        : (errorStatus ?? (name.endsWith('api_error') ? 'error' : null)),
      JSON.stringify({ ...a, 'event.name': name }),
    ],
  );
  if ((rowCount ?? 0) > 0) ctx.counts.upserted += 1;
}
