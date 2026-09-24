// Context packs: inmutables e identificados por su hash (I7). Construir dos veces el mismo
// pack devuelve el existente sin crear otro.

import { fingerprint } from '@demiurgo/domain';
import { z } from 'zod';
import { handler, registerHandlers } from '../bus/handlers.ts';

export const packSchema = z
  .object({
    role: z.string().min(1),
    constructor: z.string().min(1),
    budget: z.record(z.string(), z.number().int().nonnegative()),
    graph_version: z.number().int().nonnegative(),
    dependencies: z.array(z.object({ type: z.string(), id: z.string(), version: z.number().int().nullable() }).strict()),
    content: z.unknown(),
  })
  .strict();

export type PackData = z.infer<typeof packSchema>;

export function hashPack(p: PackData): string {
  return fingerprint({
    role: p.role,
    constructor: p.constructor,
    budget: p.budget,
    graph_version: p.graph_version,
    dependencies: p.dependencies,
    content: p.content,
  });
}

registerHandlers({
  'context_pack.build': handler({
    data: packSchema,
    async apply(ctx, data, _e, to) {
      const hash = hashPack(data);
      const existing = await ctx.trx
        .selectFrom('context_packs')
        .select('id')
        .where('project_id', '=', ctx.projectId)
        .where('hash', '=', hash)
        .executeTakeFirst();
      if (existing) return { entityId: existing.id, noChanges: true, result: { hash } };
      const { id } = await ctx.trx
        .insertInto('context_packs')
        .values({
          project_id: ctx.projectId,
          role: data.role,
          builder: data.constructor,
          budget: JSON.stringify(data.budget),
          graph_version: data.graph_version,
          dependencies: JSON.stringify(data.dependencies),
          content: JSON.stringify(data.content ?? null),
          hash,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { role: data.role, hash, graph_version: data.graph_version }, result: { hash } };
    },
  }),
});
