// `demiurgo.text` (§6.3) → `texts`, once per fingerprint: a hash already stored is left alone. A
// `transcript_chunk` (§5.4) also becomes a row of `transcript_chunks`: which call added what to the
// transcript of which session, from which byte offset. A chunk re-emitted after a restart (offset 0
// again) collides on `(session_id, offset)` and is left alone too.

import { ATTR, sha256Hex } from '@demiurgo/domain';
import type { FlatLog } from '../otlp.ts';
import { type MapContext, int, str, unmapped, uuidAttr } from './common.ts';

export async function mapText(ctx: MapContext, log: FlatLog): Promise<void> {
  const a = log.attributes;
  const body = typeof log.body === 'string' ? log.body : null;
  if (body === null) {
    await unmapped(ctx, 'log', 'text without a string body', log, log.time);
    return;
  }
  const hash = str(a, ATTR.textHash) ?? sha256Hex(body);
  const kind = str(a, ATTR.textKind);
  const chars = int(a, ATTR.textChars) ?? body.length;
  const { rowCount } = await ctx.client.query(
    `insert into texts (hash, kind, chars, body, first_seen_at) values ($1, $2, $3, $4, $5)
     on conflict (hash) do nothing`,
    [hash, kind, chars, body, log.time],
  );
  if ((rowCount ?? 0) > 0) ctx.counts.upserted += 1;

  if (kind !== 'transcript_chunk') return;
  const sessionId = uuidAttr(a, ATTR.sessionId);
  const offset = int(a, ATTR.transcriptOffset);
  if (sessionId === null || offset === null) {
    await unmapped(ctx, 'log', 'transcript chunk without a session id or an offset', log, log.time);
    return;
  }
  const chunk = await ctx.client.query(
    `insert into transcript_chunks (session_id, "offset", call_id, chars, text_hash, at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (session_id, "offset") do nothing`,
    [sessionId, offset, uuidAttr(a, ATTR.callId), chars, hash, log.time],
  );
  if ((chunk.rowCount ?? 0) > 0) ctx.counts.upserted += 1;
}
