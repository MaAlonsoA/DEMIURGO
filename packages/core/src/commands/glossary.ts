// The project's glossary: the words a person fixed and the English term the records and the reading
// translations use for each (records are always in English). Every change is a new row; a word's
// current term is its latest row, and a removal drops it.

import { formatActor } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { Db, Tx } from '../db/connection.ts';

const text = (max: number) => z.string().trim().min(1).max(max);

export type GlossaryEntry = { term: string; english: string; note: string | null; set_by: string; created_at: string };

/** The glossary in force: each word's latest term, alphabetical. */
export async function projectGlossary(db: Db | Tx, projectId: string): Promise<GlossaryEntry[]> {
  const { rows } = await sql<GlossaryEntry & { state: string }>`
    select distinct on (lower(term)) term, english, note, state, set_by, created_at
    from glossary_terms
    where project_id = ${projectId}
    order by lower(term), created_at desc, id desc`.execute(db);
  return rows
    .filter((r) => r.state === 'set')
    .map(({ state: _state, ...r }) => r)
    .toSorted((a, b) => a.term.localeCompare(b.term));
}

registerHandlers({
  'glossary.set': handler({
    data: z.object({ term: text(120), english: text(120), note: text(500).optional() }).strict(),
    async apply(ctx, data, _e, to) {
      const { id } = await ctx.trx
        .insertInto('glossary_terms')
        .values({
          project_id: ctx.projectId,
          term: data.term,
          english: data.english,
          note: data.note ?? null,
          state: to,
          set_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { term: data.term, english: data.english } };
    },
  }),

  'glossary.remove': handler({
    data: z.object({ term: text(120) }).strict(),
    async apply(ctx, data, _e, to) {
      const { id } = await ctx.trx
        .insertInto('glossary_terms')
        .values({ project_id: ctx.projectId, term: data.term, english: null, state: to, set_by: formatActor(ctx.actor) })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { term: data.term } };
    },
  }),
});
