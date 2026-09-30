// Task effort size (FDR-DEL-006): a field of the task outside its versioned content. Setting it
// appends a row to `task_sizes` and the command's journal event (actor fixed by the server, previous
// and new size); it creates no version and touches neither approval nor criteria. Only a person runs
// it (capability matrix): an agent gets 403.

import { DomainError, formatActor, sizeDisputeOf, taskSizeSchema, type TaskSize } from '@demiurgo/domain';
import { z } from 'zod';
import { registerGuards } from '../bus/guards.ts';
import { jevAllowed } from '../classifier/aspect.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { CommandContext, Tx } from '../bus/types.ts';

/** A task's current size (its latest row), or null for a task without one. */
export async function currentSize(trx: Tx, recordId: string): Promise<TaskSize | null> {
  const row = await trx
    .selectFrom('task_sizes')
    .select('size')
    .where('record_id', '=', recordId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return (row?.size as TaskSize | undefined) ?? null;
}

/** Appends a size row: the task's size is now `size`, and it replaced `previous`. */
export async function appendSize(ctx: CommandContext, recordId: string, size: TaskSize, previous: TaskSize | null) {
  await ctx.trx
    .insertInto('task_sizes')
    .values({ project_id: ctx.projectId, record_id: recordId, size, previous, set_by: formatActor(ctx.actor) })
    .execute();
}

registerGuards({
  task_record({ entity }) {
    return entity?.row.type === 'task' ? null : 'Only a task has an effort size.';
  },
});

registerHandlers({
  'record.set_size': handler({
    data: z.object({ size: taskSizeSchema }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id as string;
      const previous = await currentSize(ctx.trx, id);
      if (previous === data.size) throw new DomainError('validation', `The task is already ${data.size}.`);
      await appendSize(ctx, id, data.size, previous);
      const code = String(e?.row.code);
      return {
        entityId: id,
        before: { code, size: previous },
        after: { code, size: data.size, previous },
        result: { code, size: data.size, previous },
      };
    },
  }),

  // "Keep <size>": the person keeps the current size against the active second opinion that disputes
  // it. The dismissal hangs from that opinion: the next opinion ends it and the dispute is judged again.
  'record.keep_size': handler({
    data: z.object({ size: taskSizeSchema }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id as string;
      const size = await currentSize(ctx.trx, id);
      if (size !== data.size) throw new DomainError('validation', `The task is ${size ?? 'without a size'}, not ${data.size}.`);
      const opinion = jevAllowed()
        ? await ctx.trx
            .selectFrom('task_size_opinions')
            .select(['id', 'size'])
            .where('record_id', '=', id)
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc')
            .executeTakeFirst()
        : undefined;
      if (!opinion || sizeDisputeOf(size, opinion.size as TaskSize, false) !== 'disputed')
        throw new DomainError('validation', 'There is no second opinion disputing this size.');
      const dismissed = await ctx.trx
        .selectFrom('task_size_dismissals')
        .select('id')
        .where('opinion_id', '=', opinion.id)
        .executeTakeFirst();
      if (dismissed) throw new DomainError('validation', `${size} is already kept against this second opinion.`);
      await ctx.trx
        .insertInto('task_size_dismissals')
        .values({ project_id: ctx.projectId, record_id: id, opinion_id: opinion.id, size, dismissed_by: formatActor(ctx.actor) })
        .execute();
      const code = String(e?.row.code);
      return {
        entityId: id,
        after: { code, kept: size, second_opinion: opinion.size, opinion_id: opinion.id },
        result: { code, size },
      };
    },
  }),
});
