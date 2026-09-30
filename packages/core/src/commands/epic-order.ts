// The person's order of the epics, like a product backlog: the first epic is what is built and
// designed first. Moving an epic up or down appends the whole new order to `epic_positions`
// (append-only; an epic's place is its latest row). Only a person runs it.

import { DomainError, formatActor } from '@demiurgo/domain';
import { z } from 'zod';
import { registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { Db } from '../db/connection.ts';
import type { Tx } from '../db/connection.ts';

/** The epics of a project in the person's order: placed ones by position, then the rest by code. */
export async function epicOrderList(db: Db | Tx, projectId: string): Promise<{ id: string; code: string; position: number | null }[]> {
  const epics = await db
    .selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', projectId)
    .where('type', '=', 'epic')
    .orderBy('code')
    .execute();
  const rows = await db
    .selectFrom('epic_positions')
    .select(['record_id', 'position'])
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const latest = new Map<string, number>();
  for (const r of rows) latest.set(r.record_id, r.position);
  return epics
    .map((e) => ({ ...e, position: latest.get(e.id) ?? null }))
    .sort((a, b) => {
      if (a.position !== null && b.position !== null && a.position !== b.position) return a.position - b.position;
      if ((a.position === null) !== (b.position === null)) return a.position === null ? 1 : -1;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });
}

/** Place (1-based) of each epic by record id. */
export async function epicOrder(db: Db | Tx, projectId: string): Promise<Map<string, number>> {
  return new Map((await epicOrderList(db, projectId)).map((e, i) => [e.id, i + 1]));
}

registerGuards({
  epic_record({ entity }) {
    return entity?.row.type === 'epic' ? null : 'Only an epic can be moved in the backlog.';
  },
});

registerHandlers({
  'record.move_epic': handler({
    data: z.object({ direction: z.enum(['up', 'down']) }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id as string;
      const list = await epicOrderList(ctx.trx, ctx.projectId);
      const from = list.findIndex((x) => x.id === id);
      const to = data.direction === 'up' ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= list.length)
        throw new DomainError('validation', `The epic is already ${data.direction === 'up' ? 'first' : 'last'}.`);
      const ids = list.map((x) => x.id);
      [ids[from], ids[to]] = [ids[to] as string, ids[from] as string];
      const by = formatActor(ctx.actor);
      for (const [i, recordId] of ids.entries()) {
        if (list[i]?.id === recordId && list[i]?.position === i + 1) continue;
        await ctx.trx
          .insertInto('epic_positions')
          .values({ project_id: ctx.projectId, record_id: recordId, position: i + 1, set_by: by })
          .execute();
      }
      const code = String(e?.row.code);
      return { entityId: id, before: { code, position: from + 1 }, after: { code, position: to + 1 }, result: { code, position: to + 1 } };
    },
  }),
});
