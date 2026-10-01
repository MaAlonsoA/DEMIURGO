// The durable GitHub build of a task (src/build/orchestrator.ts). `build.start` is the person's
// button: it checks that the request is open, GitHub is connected and no build is running, records
// the first stage and starts the workflow after the commit. `build_step.record` is how the workflow
// leaves each stage in the journal; it may also carry the branch, the pull request number and the head
// commit of the request, and mark a reviewer verdict as published.

import { DomainError, formatActor } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { field, registerGuards, trimmed } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { Tx } from '../db/connection.ts';
import { githubConfig } from '../github/client.ts';

/** The open request of a task (by code), with the task's row. */
async function openRequestOf(trx: Tx, projectId: string, code: string) {
  return trx
    .selectFrom('build_requests')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select(['build_requests.id', 'build_requests.state', 'records.code'])
    .where('build_requests.project_id', '=', projectId)
    .where('records.code', '=', code)
    .where('build_requests.state', 'in', ['requested', 'in_review'])
    .executeTakeFirst();
}

/** True while the latest attempt of a request has neither failed, asked for changes nor merged. */
export async function buildRunning(trx: Tx, requestId: string): Promise<boolean> {
  const latest = await trx
    .selectFrom('build_steps')
    .select((eb) => eb.fn.max('attempt').as('attempt'))
    .where('build_request_id', '=', requestId)
    .executeTakeFirst();
  const attempt = latest?.attempt;
  if (attempt === null || attempt === undefined) return false;
  const ended = await trx
    .selectFrom('build_steps')
    .select('id')
    .where('build_request_id', '=', requestId)
    .where('attempt', '=', Number(attempt))
    .where((eb) =>
      eb.or([
        // A red CI (with its conclusion) and a review that asks for changes (with its verdict) are the
        // truth about those stages, not the end of the attempt: it goes on to publish and stop at merge.
        eb.and([
          eb('outcome', 'in', ['failed', 'changes_requested']),
          eb.not(eb.and([eb('stage', '=', 'ci'), sql<boolean>`detail->>'conclusion' is not null`])),
          eb.not(eb.and([eb('stage', '=', 'review'), sql<boolean>`detail->>'verdict' is not null`])),
        ]),
        eb.and([eb('stage', '=', 'merge'), eb('outcome', '=', 'ok')]),
      ]),
    )
    .executeTakeFirst();
  return !ended;
}

registerGuards({
  async build_can_start({ ctx, data }) {
    const code = trimmed(field(data, 'task'));
    const request = await openRequestOf(ctx.trx, ctx.projectId, code);
    if (!request) return `${code} has no open build request: request the build first.`;
    if (githubConfig() === null) return 'Connect GitHub first: set DEMIURGO_GITHUB_TOKEN and DEMIURGO_GITHUB_OWNER.';
    if (await buildRunning(ctx.trx, request.id)) return `A build of ${code} is already running.`;
    return null;
  },
});

registerHandlers({
  'build.start': handler({
    data: z.object({ task: z.string().trim().min(1).max(40) }).strict(),
    async apply(ctx, data, _e, to) {
      const request = await openRequestOf(ctx.trx, ctx.projectId, data.task);
      if (!request) throw new DomainError('not_found', `${data.task} has no open build request.`);
      const last = await ctx.trx
        .selectFrom('build_steps')
        .select((eb) => eb.fn.max('attempt').as('attempt'))
        .where('build_request_id', '=', request.id)
        .executeTakeFirst();
      const attempt = Number(last?.attempt ?? 0) + 1;
      const by = formatActor(ctx.actor);
      const { id } = await ctx.trx
        .insertInto('build_steps')
        .values({
          project_id: ctx.projectId,
          build_request_id: request.id,
          attempt,
          stage: 'repo',
          outcome: 'started',
          detail: JSON.stringify({ started_by: by }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const projectId = ctx.projectId;
      ctx.afterCommit(() => ctx.services.engine.startBuild(request.id, projectId, attempt));
      void to;
      return {
        entityId: id,
        after: { task: request.code, build_request: request.id, attempt, started_by: by },
        result: { id: request.id, task: request.code, attempt },
      };
    },
  }),

  'build_step.record': handler({
    data: z
      .object({
        build_request_id: z.string().uuid(),
        attempt: z.number().int().positive(),
        stage: z.string().min(1).max(40),
        outcome: z.enum(['started', 'ok', 'failed', 'waiting', 'changes_requested']),
        detail: z.record(z.string(), z.unknown()).optional(),
        branch: z.string().min(1).max(200).optional(),
        pr_number: z.number().int().positive().optional(),
        head_sha: z.string().min(7).max(64).optional(),
        /** The pr_reviews row that was just published to GitHub. */
        published_review: z.string().uuid().optional(),
      })
      .strict(),
    async apply(ctx, data) {
      const request = await ctx.trx
        .selectFrom('build_requests')
        .select('id')
        .where('id', '=', data.build_request_id)
        .where('project_id', '=', ctx.projectId)
        .executeTakeFirst();
      if (!request) throw new DomainError('not_found', 'The build request does not exist.');
      const { id } = await ctx.trx
        .insertInto('build_steps')
        .values({
          project_id: ctx.projectId,
          build_request_id: data.build_request_id,
          attempt: data.attempt,
          stage: data.stage,
          outcome: data.outcome,
          detail: data.detail === undefined ? null : JSON.stringify(data.detail),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const set = {
        ...(data.branch ? { branch: data.branch } : {}),
        ...(data.pr_number ? { pr_number: data.pr_number } : {}),
        ...(data.head_sha ? { head_sha: data.head_sha } : {}),
      };
      if (Object.keys(set).length > 0) {
        await ctx.trx.updateTable('build_requests').set(set).where('id', '=', data.build_request_id).execute();
      }
      if (data.published_review) {
        await ctx.trx
          .updateTable('pr_reviews')
          .set({ published_at: ctx.services.clock() })
          .where('id', '=', data.published_review)
          .where('build_request_id', '=', data.build_request_id)
          .where('published_at', 'is', null)
          .execute();
      }
      return {
        entityId: id,
        after: {
          build_request: data.build_request_id,
          attempt: data.attempt,
          stage: data.stage,
          outcome: data.outcome,
          ...set,
          ...(data.published_review ? { published_review: data.published_review } : {}),
        },
        result: { id },
      };
    },
  }),
});
