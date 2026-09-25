// `interaction <command>` (§6.1): the root of a trace. Sets what only the root knows; the counters
// and `last_seen_at` are kept by every span of the trace (span.ts).

import { ATTR, RESOURCE, interactionIdOf } from '@demiurgo/domain';
import type { FlatSpan } from '../otlp.ts';
import { type MapContext, str, uuidAttr } from './common.ts';
import { insertSpan, touchInteraction } from './span.ts';

export async function mapInteraction(ctx: MapContext, span: FlatSpan): Promise<void> {
  const a = span.attributes;
  const r = span.resource;
  const inserted = await insertSpan(ctx, span, 'demiurgo');
  await ctx.client.query(
    `insert into interactions (id, environment, instance, service_version, project_id, channel, actor, actor_type,
       root_command, root_entity_type, root_entity_id, started_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (id) do update set
       environment = coalesce(excluded.environment, interactions.environment),
       instance = coalesce(excluded.instance, interactions.instance),
       service_version = coalesce(excluded.service_version, interactions.service_version),
       project_id = coalesce(excluded.project_id, interactions.project_id),
       channel = coalesce(excluded.channel, interactions.channel),
       actor = coalesce(excluded.actor, interactions.actor),
       actor_type = coalesce(excluded.actor_type, interactions.actor_type),
       root_command = coalesce(excluded.root_command, interactions.root_command),
       root_entity_type = coalesce(excluded.root_entity_type, interactions.root_entity_type),
       root_entity_id = coalesce(excluded.root_entity_id, interactions.root_entity_id),
       started_at = least(excluded.started_at, interactions.started_at),
       last_seen_at = greatest(excluded.last_seen_at, interactions.last_seen_at)`,
    [
      interactionIdOf(span.traceId),
      str(r, RESOURCE.environment),
      str(r, RESOURCE.instance),
      str(r, RESOURCE.serviceVersion),
      uuidAttr(a, ATTR.projectId),
      str(a, ATTR.channel),
      str(a, ATTR.actor),
      str(a, ATTR.actorType),
      str(a, ATTR.command) ?? span.name.replace(/^interaction\s+/, ''),
      str(a, ATTR.entityType),
      str(a, ATTR.entityId),
      span.start,
      span.end ?? span.start,
    ],
  );
  ctx.counts.upserted += 1;
  await touchInteraction(ctx, span, inserted);
}
