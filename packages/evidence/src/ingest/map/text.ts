// `demiurgo.text` (§6.3) → `texts`, once per fingerprint: a hash already stored is left alone.

import { ATTR, sha256Hex } from '@demiurgo/domain';
import type { FlatLog } from '../otlp.ts';
import { type MapContext, int, str, unmapped } from './common.ts';

export async function mapText(ctx: MapContext, log: FlatLog): Promise<void> {
  const a = log.attributes;
  const body = typeof log.body === 'string' ? log.body : null;
  if (body === null) {
    await unmapped(ctx, 'log', 'text without a string body', log, log.time);
    return;
  }
  const hash = str(a, ATTR.textHash) ?? sha256Hex(body);
  const { rowCount } = await ctx.client.query(
    `insert into texts (hash, kind, chars, body, first_seen_at) values ($1, $2, $3, $4, $5)
     on conflict (hash) do nothing`,
    [hash, str(a, ATTR.textKind), int(a, ATTR.textChars) ?? body.length, body, log.time],
  );
  if ((rowCount ?? 0) > 0) ctx.counts.upserted += 1;
}
