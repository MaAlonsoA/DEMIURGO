// The commands of the known-error vault (forensics/vault.ts). Only the system writes them: from a forensic (open,
// occurrence, recur, validate), from the vault seed and from the operator's CLI (claim_fix). Every command appends a
// row (a new version of the entry or a new occurrence) and its event; the entry's status is a column of the version,
// and which status may follow which is checked here (the table says who may run each command).

import { DomainError, KNOWN_ERROR_CODE, formatActor, newKnownErrorShape } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { Tx } from '../db/connection.ts';
import { type KnownErrorRow, latestKnownError, needsRecurrenceWhy, occurredAtOf, ranWithFix } from '../forensics/vault.ts';

const code = z.string().regex(KNOWN_ERROR_CODE);
const forensicPhase = z.string().regex(/^P(0|1[0-3]|[1-9])$/);

async function mustFind(trx: Tx, c: string): Promise<KnownErrorRow> {
  const ke = await latestKnownError(trx, c);
  if (!ke) throw new DomainError('not_found', `The known error ${c} does not exist.`);
  return ke;
}

/** Appends the next version of an entry with some columns changed. */
async function nextVersion(trx: Tx, ke: KnownErrorRow, actor: string, change: { status: KnownErrorRow['status']; fix?: KnownErrorRow['fix'] }): Promise<{ id: string; version: number }> {
  const version = ke.version + 1;
  const fix = change.fix === undefined ? ke.fix : change.fix;
  const { id } = await trx
    .insertInto('known_errors')
    .values({
      code: ke.code,
      version,
      title: ke.title,
      description: ke.description,
      error_class: ke.error_class,
      phase: ke.phase,
      dimension: ke.dimension,
      signature: ke.signature,
      pieces: ke.pieces,
      status: change.status,
      fix: fix === null ? null : JSON.stringify(fix),
      origin_project_id: ke.origin_project_id,
      created_by: actor,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id, version };
}

const refuse = (message: string, why: string) => new DomainError('guard', message, [why]);

registerHandlers({
  'known_error.open': handler({
    data: newKnownErrorShape.extend({ error_class: z.string().min(1).max(80), phase: forensicPhase }).strict(),
    async apply(ctx, data) {
      // Codes are global and sequential: one writer at a time while the next is chosen.
      await sql`select pg_advisory_xact_lock(hashtext('known_errors'))`.execute(ctx.trx);
      const last = await sql<{ n: number | null }>`select max(substring(code from 4)::int) as n from known_errors`.execute(ctx.trx);
      const next = (last.rows[0]?.n ?? 0) + 1;
      const c = `KE-${String(next).padStart(3, '0')}`;
      const { id } = await ctx.trx
        .insertInto('known_errors')
        .values({
          code: c,
          version: 1,
          title: data.title,
          description: data.description,
          error_class: data.error_class,
          phase: data.phase,
          dimension: data.dimension,
          signature: data.signature,
          pieces: data.pieces,
          status: 'open',
          fix: null,
          origin_project_id: ctx.projectId,
          created_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { code: c, version: 1, title: data.title, error_class: data.error_class, pieces: data.pieces.length }, result: { id, code: c, version: 1 } };
    },
  }),

  'known_error.claim_fix': handler({
    data: z
      .object({
        code,
        description: z.string().trim().min(1).max(2000),
        commits: z.array(z.string().regex(/^[0-9a-f]{7,40}$/i)).min(1).max(40),
        piece_versions: z.record(z.string(), z.string()),
      })
      .strict(),
    async apply(ctx, data) {
      const ke = await mustFind(ctx.trx, data.code);
      // The moment of the claim is what later tasks are compared with: a task that ran after it ran with the fix.
      const fix = { description: data.description, commits: data.commits, piece_versions: data.piece_versions, claimed_at: new Date().toISOString() };
      const v = await nextVersion(ctx.trx, ke, formatActor(ctx.actor), { status: 'fix_claimed', fix });
      return { entityId: v.id, after: { code: ke.code, version: v.version, from: ke.status, commits: data.commits, claimed_at: fix.claimed_at }, result: { id: v.id, code: ke.code, version: v.version, claimed_at: fix.claimed_at } };
    },
  }),

  'known_error.validate': handler({
    data: z.object({ code, forensic_ids: z.array(z.string().uuid()).min(1) }).strict(),
    async apply(ctx, data) {
      const ke = await mustFind(ctx.trx, data.code);
      if (ke.status !== 'fix_claimed') throw refuse(`${ke.code} cannot be validated.`, `Only an entry with a claimed fix is validated; it is ${ke.status}.`);
      const v = await nextVersion(ctx.trx, ke, formatActor(ctx.actor), { status: 'validated' });
      return { entityId: v.id, after: { code: ke.code, version: v.version, from: ke.status, clean_forensics: data.forensic_ids.length }, result: { id: v.id, code: ke.code, version: v.version } };
    },
  }),

  'known_error.recur': handler({
    data: z.object({ code, forensic_id: z.string().uuid() }).strict(),
    async apply(ctx, data) {
      const ke = await mustFind(ctx.trx, data.code);
      if (ke.status !== 'fix_claimed' && ke.status !== 'validated') throw refuse(`${ke.code} cannot be marked as recurred.`, `Only an entry with a claimed or validated fix recurs; it is ${ke.status}.`);
      const v = await nextVersion(ctx.trx, ke, formatActor(ctx.actor), { status: 'recurred' });
      return { entityId: v.id, after: { code: ke.code, version: v.version, from: ke.status, forensic: data.forensic_id }, result: { id: v.id, code: ke.code, version: v.version } };
    },
  }),

  'known_error.occurrence': handler({
    data: z
      .object({
        code,
        forensic_id: z.string().uuid(),
        went_wrong_index: z.number().int().nonnegative(),
        recurrence_why: z.string().trim().min(1).max(600).nullable(),
      })
      .strict(),
    async apply(ctx, data) {
      const ke = await mustFind(ctx.trx, data.code);
      const f = await ctx.trx
        .selectFrom('task_forensics')
        .select(['id', 'task_id', 'created_at', 'task_ended_at', 'analysis'])
        .where('id', '=', data.forensic_id)
        .where('project_id', '=', ctx.projectId)
        .executeTakeFirst();
      if (!f) throw new DomainError('not_found', 'The forensic does not exist.');
      const analysis = f.analysis as { went_wrong?: { at?: string | null }[]; catalog_marks?: Record<string, string> };
      const item = analysis.went_wrong?.[data.went_wrong_index];
      if (!item) throw new DomainError('validation', `The forensic has no went_wrong item ${data.went_wrong_index}.`);
      const occurredAt = occurredAtOf(item.at, f.task_ended_at as unknown as Date | null, f.created_at as unknown as Date);
      const afterFix = ranWithFix(ke.fix, occurredAt);
      if (needsRecurrenceWhy(ke, occurredAt) && !data.recurrence_why) throw new DomainError('validation', `${ke.code} had a fix in place when this happened: say why the fix did not prevent it (recurrence_why).`);
      const marks = analysis.catalog_marks ?? {};
      const pieceVersions = Object.fromEntries(ke.pieces.filter((p) => marks[p] !== undefined).map((p) => [p, marks[p] as string]));
      const { id } = await ctx.trx
        .insertInto('known_error_occurrences')
        .values({
          ke_code: ke.code,
          project_id: ctx.projectId,
          task_id: f.task_id,
          forensic_id: f.id,
          went_wrong_index: data.went_wrong_index,
          occurred_at: occurredAt.toISOString() as never,
          piece_versions: JSON.stringify(pieceVersions),
          after_fix: afterFix,
          // The why is kept only where it explains a recurrence.
          recurrence_why: afterFix ? data.recurrence_why : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: { code: ke.code, forensic: f.id, went_wrong_index: data.went_wrong_index, occurred_at: occurredAt.toISOString(), after_fix: afterFix, status: ke.status },
        result: { id, code: ke.code, after_fix: afterFix, status: ke.status, recurs: needsRecurrenceWhy(ke, occurredAt) },
      };
    },
  }),
});
