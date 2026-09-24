// Project commands.

import { z } from 'zod';
import { handler, registerHandlers } from '../bus/handlers.ts';

registerHandlers({
  'project.create': handler({
    data: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
    async apply(ctx, data, _e, to) {
      const { id } = await ctx.trx
        .insertInto('projects')
        .values({ name: data.name, state: to })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, projectId: id, after: { name: data.name } };
    },
  }),

  'project.archive': handler({
    data: z.object({ reason: z.string().trim().max(500).optional() }).strict(),
    async apply(_ctx, data, e) {
      return { entityId: e?.id ?? '', after: { reason: data.reason ?? null } };
    },
  }),
});
