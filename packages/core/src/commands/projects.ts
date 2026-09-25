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
      // The design engine starts with the first thread a person opens (exploration.open): the stages
      // live in that main thread.
      return { entityId: id, projectId: id, after: { name: data.name } };
    },
  }),

  'project.rename': handler({
    data: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('projects').set({ name: data.name }).where('id', '=', id).execute();
      return { entityId: id, before: { name: e?.row.name ?? null }, after: { name: data.name } };
    },
  }),

  'project.archive': handler({
    data: z.object({ reason: z.string().trim().max(500).optional() }).strict(),
    async apply(_ctx, data, e) {
      return { entityId: e?.id ?? '', after: { reason: data.reason ?? null } };
    },
  }),
});
