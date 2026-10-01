// Issues: a problem that impairs or prevents the functions of the product. A person reports a `bug`;
// DEMIURGO opens a `review_escalation` when the reviewer hands over something only a person can
// resolve (see build_step.record). Not a versioned record: its own table, with a code ISS-NNN per
// project. open -> resolved (with its fix: a task, or a version of a task) | closed (with a reason);
// a person can reopen it. The bus moves the state; the handlers fill the resolution and close fields.

import { DomainError, formatActor } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { field, registerGuards, trimmed } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { Tx } from '../db/connection.ts';

const code = z.string().trim().min(1).max(40);

async function recordOf(trx: Tx, projectId: string, recordCode: string, what: string) {
  const record = await trx
    .selectFrom('records')
    .select(['id', 'code', 'type'])
    .where('project_id', '=', projectId)
    .where('code', '=', recordCode)
    .executeTakeFirst();
  if (!record) throw new DomainError('not_found', `${what} ${recordCode} does not exist.`);
  return record;
}

/** The next ISS-NNN of a project (its own sequence; the unique index backs the lock). */
async function nextCode(trx: Tx, projectId: string): Promise<string> {
  await sql`select pg_advisory_xact_lock(hashtext(${`issues:${projectId}`}))`.execute(trx);
  const last = await trx
    .selectFrom('issues')
    .select(sql<number>`coalesce(max(substring(code from 5)::int), 0)`.as('n'))
    .where('project_id', '=', projectId)
    .executeTakeFirstOrThrow();
  return `ISS-${String(Number(last.n) + 1).padStart(3, '0')}`;
}

registerGuards({
  async issue_fix_exists({ ctx, data }) {
    const taskCode = trimmed(field(data, 'fix_task'));
    if (!taskCode) return 'The fix is required: the task that resolves the issue.';
    const task = await ctx.trx
      .selectFrom('records')
      .select(['id', 'type'])
      .where('project_id', '=', ctx.projectId)
      .where('code', '=', taskCode)
      .executeTakeFirst();
    if (!task) return `Task ${taskCode} does not exist.`;
    if (task.type !== 'task') return `${taskCode} is not a task.`;
    const version = field(data, 'version');
    if (version !== undefined && version !== null) {
      const v = await ctx.trx
        .selectFrom('record_versions')
        .select('id')
        .where('record_id', '=', task.id)
        .where('n', '=', Number(version))
        .executeTakeFirst();
      if (!v) return `${taskCode} has no version ${String(version)}.`;
    }
    return null;
  },
});

registerHandlers({
  'issue.open': handler({
    data: z
      .object({
        kind: z.enum(['bug', 'review_escalation']),
        title: z.string().trim().min(1).max(300),
        body: z.string().max(20000).optional(),
        task: code.optional(),
        feature: code.optional(),
        criterion: code.optional(),
        build_request_id: z.string().uuid().optional(),
        attempt: z.number().int().positive().optional(),
        pr_review_id: z.string().uuid().optional(),
        source_key: z.string().trim().min(1).max(300).optional(),
      })
      .strict(),
    async apply(ctx, data) {
      const task = data.task ? await recordOf(ctx.trx, ctx.projectId, data.task, 'Task') : null;
      if (task && task.type !== 'task') throw new DomainError('validation', `${data.task} is not a task.`);
      const feature = data.feature ? await recordOf(ctx.trx, ctx.projectId, data.feature, 'Feature') : null;
      if (data.build_request_id) {
        const request = await ctx.trx
          .selectFrom('build_requests')
          .select('id')
          .where('id', '=', data.build_request_id)
          .where('project_id', '=', ctx.projectId)
          .executeTakeFirst();
        if (!request) throw new DomainError('not_found', 'The build request does not exist.');
      }
      if (data.pr_review_id) {
        const review = await ctx.trx
          .selectFrom('pr_reviews')
          .select('id')
          .where('id', '=', data.pr_review_id)
          .where('project_id', '=', ctx.projectId)
          .executeTakeFirst();
        if (!review) throw new DomainError('not_found', 'The review does not exist.');
      }
      const by = formatActor(ctx.actor);
      const issueCode = await nextCode(ctx.trx, ctx.projectId);
      const { id } = await ctx.trx
        .insertInto('issues')
        .values({
          project_id: ctx.projectId,
          code: issueCode,
          kind: data.kind,
          title: data.title,
          body: data.body ?? '',
          state: 'open',
          task_id: task?.id ?? null,
          feature_id: feature?.id ?? null,
          criterion_code: data.criterion ?? null,
          build_request_id: data.build_request_id ?? null,
          attempt: data.attempt ?? null,
          pr_review_id: data.pr_review_id ?? null,
          source_key: data.source_key ?? null,
          opened_by: by,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: {
          code: issueCode,
          kind: data.kind,
          title: data.title,
          ...(task ? { task: task.code } : {}),
          ...(feature ? { feature: feature.code } : {}),
          ...(data.criterion ? { criterion: data.criterion } : {}),
          ...(data.build_request_id ? { build_request: data.build_request_id, attempt: data.attempt ?? null } : {}),
          opened_by: by,
        },
        result: { code: issueCode },
      };
    },
  }),

  'issue.resolve': handler({
    data: z.object({ fix_task: code, version: z.number().int().positive().optional() }).strict(),
    async apply(ctx, data, e) {
      const task = await recordOf(ctx.trx, ctx.projectId, data.fix_task, 'Task');
      const version =
        data.version === undefined
          ? null
          : ((await ctx.trx
              .selectFrom('record_versions')
              .select('id')
              .where('record_id', '=', task.id)
              .where('n', '=', data.version)
              .executeTakeFirst()) ?? null);
      const by = formatActor(ctx.actor);
      await ctx.trx
        .updateTable('issues')
        .set({
          resolution_task_id: task.id,
          resolution_version_id: version?.id ?? null,
          resolved_by: by,
          resolved_at: new Date(),
        })
        .where('id', '=', e?.id ?? '')
        .execute();
      return {
        entityId: e?.id ?? '',
        after: { fix_task: task.code, ...(data.version ? { version: data.version } : {}), resolved_by: by },
        result: { fix_task: task.code },
      };
    },
  }),

  'issue.close': handler({
    data: z.object({ reason: z.string().trim().min(1).max(2000) }).strict(),
    async apply(ctx, data, e) {
      const by = formatActor(ctx.actor);
      await ctx.trx
        .updateTable('issues')
        .set({ close_reason: data.reason, closed_by: by, closed_at: new Date() })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '', after: { reason: data.reason, closed_by: by }, result: {} };
    },
  }),

  // Reopening clears the resolution and the close fields (the journal keeps them as events).
  'issue.reopen': handler({
    data: z.object({ reason: z.string().trim().max(2000).optional() }).strict(),
    async apply(ctx, data, e) {
      await ctx.trx
        .updateTable('issues')
        .set({
          resolution_task_id: null,
          resolution_version_id: null,
          resolved_by: null,
          resolved_at: null,
          close_reason: null,
          closed_by: null,
          closed_at: null,
        })
        .where('id', '=', e?.id ?? '')
        .execute();
      return {
        entityId: e?.id ?? '',
        before: { state: e?.state },
        after: { reopened_by: formatActor(ctx.actor), ...(data.reason ? { reason: data.reason } : {}) },
        result: {},
      };
    },
  }),
});
