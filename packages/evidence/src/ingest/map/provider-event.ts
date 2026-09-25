// `demiurgo.provider.event` (§6.3) → `provider_events`: the raw line of the provider, by its event id.

import { ATTR } from '@demiurgo/domain';
import type { FlatLog } from '../otlp.ts';
import { type MapContext, int, jsonAttr, jsonb, recordHash, stampAttr, str, uuidAttr } from './common.ts';

export async function mapProviderEvent(ctx: MapContext, log: FlatLog): Promise<void> {
  const a = log.attributes;
  const eventId = str(a, ATTR.eventId) ?? recordHash(log);
  const receivedAt = stampAttr(a, ATTR.eventReceivedAt) ?? log.time;
  const raw = typeof log.body === 'string' ? log.body : log.body === null ? null : JSON.stringify(log.body);
  const { rowCount } = await ctx.client.query(
    `insert into provider_events (event_id, call_id, seq, kind, tokens, received_at, raw)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (event_id, received_at) do nothing`,
    [
      eventId,
      uuidAttr(a, ATTR.callId),
      int(a, ATTR.eventSeq),
      str(a, ATTR.eventKind),
      jsonb(jsonAttr(a, ATTR.eventTokens)),
      receivedAt,
      raw,
    ],
  );
  if ((rowCount ?? 0) > 0) ctx.counts.upserted += 1;
}
