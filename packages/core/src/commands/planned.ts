// The features of an epic, in order, as records from the moment the epic lists them: each reserves
// its FDR code (with the epic's domain) and says in a sentence what it does. Designing it creates the
// record with that code; a feature not designed yet can be moved or dropped, and its code is never
// reused.

import { DomainError } from '@demiurgo/domain';
import { z } from 'zod';
import { field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { Tx } from '../db/connection.ts';
import { nextCode } from './records.ts';

const uuid = z.string().uuid();

registerGuards({
  async epic_of_project({ ctx, data }) {
    const id = field(data, 'epic_id');
    const epic =
      typeof id === 'string'
        ? await ctx.trx
            .selectFrom('records')
            .select(['type'])
            .where('id', '=', id)
            .where('project_id', '=', ctx.projectId)
            .executeTakeFirst()
        : undefined;
    return epic?.type === 'epic' ? null : 'The epic does not exist in this project.';
  },
});

/** The features of an epic still in its list, in order. */
async function listOf(trx: Tx, epicId: string) {
  return trx
    .selectFrom('planned_features')
    .select(['id', 'position'])
    .where('epic_id', '=', epicId)
    .where('state', '<>', 'dropped')
    .orderBy('position')
    .orderBy('created_at')
    .execute();
}

/** Numbers the list 1..n in the order given. */
async function renumber(trx: Tx, ids: readonly string[]) {
  for (const [i, id] of ids.entries()) await trx.updateTable('planned_features').set({ position: i + 1 }).where('id', '=', id).execute();
}

/** Puts `id` at `position` (1-based, clamped) in its epic's list. */
async function place(trx: Tx, epicId: string, id: string, position: number) {
  const ids = (await listOf(trx, epicId)).map((f) => f.id).filter((x) => x !== id);
  const at = Math.min(Math.max(position, 1), ids.length + 1) - 1;
  ids.splice(at, 0, id);
  await renumber(trx, ids);
}

registerHandlers({
  'planned_feature.add': handler({
    data: z
      .object({
        epic_id: uuid,
        name: z.string().trim().min(1).max(120),
        summary: z.string().trim().min(1).max(500),
        /** Where in the list (1-based); at the end when absent. */
        position: z.number().int().positive().optional(),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const epic = await ctx.trx
        .selectFrom('records')
        .select(['code', 'domain'])
        .where('id', '=', data.epic_id)
        .executeTakeFirstOrThrow();
      const code = await nextCode(ctx.trx, ctx.projectId, 'fdr', epic.domain);
      const list = await listOf(ctx.trx, data.epic_id);
      const { id } = await ctx.trx
        .insertInto('planned_features')
        .values({
          project_id: ctx.projectId,
          epic_id: data.epic_id,
          code,
          name: data.name,
          summary: data.summary,
          position: list.length + 1,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (data.position !== undefined) await place(ctx.trx, data.epic_id, id, data.position);
      return {
        entityId: id,
        after: { epic: epic.code, code, name: data.name, summary: data.summary },
        result: { code },
      };
    },
  }),

  'planned_feature.move': handler({
    data: z.object({ position: z.number().int().positive() }).strict(),
    async apply(ctx, data, e) {
      const epicId = String(e?.row.epic_id);
      await place(ctx.trx, epicId, e?.id ?? '', data.position);
      return { entityId: e?.id ?? '', after: { code: e?.row.code, position: data.position } };
    },
  }),

  'planned_feature.drop': handler({
    data: z.object({ reason: z.string().trim().max(1000).optional() }).strict(),
    async apply(ctx, data, e) {
      const epicId = String(e?.row.epic_id);
      await renumber(
        ctx.trx,
        (await listOf(ctx.trx, epicId)).map((f) => f.id).filter((x) => x !== e?.id),
      );
      return { entityId: e?.id ?? '', after: { code: e?.row.code, reason: data.reason ?? null } };
    },
  }),

  'planned_feature.design': handler({
    data: z.object({ record_id: uuid }).strict(),
    async apply(ctx, data, e) {
      const r = await ctx.trx
        .selectFrom('records')
        .select(['code', 'type'])
        .where('id', '=', data.record_id)
        .where('project_id', '=', ctx.projectId)
        .executeTakeFirst();
      if (!r || r.type !== 'fdr' || r.code !== e?.row.code)
        throw new DomainError('validation', `The record that designs ${String(e?.row.code)} has to be the feature with that code.`);
      await ctx.trx.updateTable('planned_features').set({ record_id: data.record_id }).where('id', '=', e.id).execute();
      return { entityId: e.id, after: { code: r.code } };
    },
  }),
});
