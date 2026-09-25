// `gen_ai.evaluation.result` (§6.3, §15.2) → `evaluations`: judges and external processes. The
// human ones are derived from commands (derive.ts), not received.

import { ATTR } from '@demiurgo/domain';
import type { FlatLog } from '../otlp.ts';
import { type MapContext, num, str, unmapped } from './common.ts';

export async function mapEvaluation(ctx: MapContext, log: FlatLog): Promise<void> {
  const a = log.attributes;
  const name = str(a, ATTR.evaluationName);
  const targetType = str(a, ATTR.evaluationTargetType);
  const targetId = str(a, ATTR.evaluationTargetId);
  if (name === null || targetType === null || targetId === null) {
    await unmapped(ctx, 'log', 'evaluation without name or target', log, log.time);
    return;
  }
  const { rowCount } = await ctx.client.query(
    `insert into evaluations (trace_id, target_type, target_id, name, score, label, explanation, by_actor, source, at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (target_type, target_id, name, source, by_actor, at) do nothing`,
    [
      log.traceId,
      targetType,
      targetId,
      name,
      num(a, ATTR.evaluationScoreValue),
      str(a, ATTR.evaluationScoreLabel),
      str(a, ATTR.evaluationExplanation),
      str(a, ATTR.evaluationBy) ?? '',
      str(a, ATTR.evaluationSource) ?? 'judge',
      log.time,
    ],
  );
  if ((rowCount ?? 0) > 0) ctx.counts.upserted += 1;
}
