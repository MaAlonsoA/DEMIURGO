// Evidence of an acceptance criterion: the person records how they checked that it holds (a note and,
// optionally, a commit, PR or URL). Append-only: a criterion's evidence is its latest row. It is
// recorded on a criterion of the record's current approved version; an automatic criterion admits it
// too, shown as checked by hand until the runner records its own.

import { formatActor } from '@demiurgo/domain';
import { z } from 'zod';
import { field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';

const text = (max: number) => z.string().trim().min(1).max(max);

registerGuards({
  async ac_manual({ ctx, data }) {
    const id = field(data, 'criterion_id');
    const c =
      typeof id === 'string'
        ? await ctx.trx
            .selectFrom('criteria')
            .innerJoin('record_versions as v', 'v.id', 'criteria.record_version_id')
            .select(['criteria.project_id', 'v.record_id', 'v.n', 'v.state'])
            .where('criteria.id', '=', id)
            .executeTakeFirst()
        : undefined;
    if (!c || c.project_id !== ctx.projectId) return 'The criterion does not exist in this project.';
    const current = await ctx.trx
      .selectFrom('record_versions')
      .select('n')
      .where('record_id', '=', c.record_id)
      .where('state', '=', 'approved')
      .orderBy('n', 'desc')
      .executeTakeFirst();
    if (c.state !== 'approved' || current?.n !== c.n) {
      return 'Evidence is recorded on a criterion of the current approved version.';
    }
    return null;
  },
});

registerHandlers({
  'evidence.record_manual': handler({
    data: z.object({ criterion_id: z.string().uuid(), note: text(2000), reference: text(500).optional() }).strict(),
    async apply(ctx, data, _e, to) {
      const c = await ctx.trx
        .selectFrom('criteria')
        .select(['code', 'record_version_id'])
        .where('id', '=', data.criterion_id)
        .executeTakeFirstOrThrow();
      const { id } = await ctx.trx
        .insertInto('evidence')
        .values({
          project_id: ctx.projectId,
          criterion_id: data.criterion_id,
          record_version_id: c.record_version_id,
          kind: 'manual',
          note: data.note,
          reference: data.reference ?? null,
          state: to,
          recorded_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { criterion: c.code, kind: 'manual', reference: data.reference ?? null } };
    },
  }),
});
