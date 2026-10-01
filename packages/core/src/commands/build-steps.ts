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
import { computeRequestBasis, effectiveBasis } from '../build/basis.ts';
import { openHoldOf } from '../build/holds.ts';
import type { CommandContext } from '../bus/types.ts';
import type { Db, Tx } from '../db/connection.ts';
import { githubConfig } from '../github/client.ts';
import { advanceBuildQueue } from '../build/auto.ts';
import { mergedBuildOf } from '../queries/read.ts';

/** The open request of a task (by code), with the task's row. */
async function openRequestOf(trx: Tx, projectId: string, code: string) {
  return trx
    .selectFrom('build_requests')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select([
      'build_requests.id',
      'build_requests.state',
      'build_requests.task_id',
      'build_requests.task_version_id',
      'build_requests.feature_version_id',
      'records.code',
    ])
    .where('build_requests.project_id', '=', projectId)
    .where('records.code', '=', code)
    .where('build_requests.state', 'in', ['requested', 'in_review'])
    .executeTakeFirst();
}

type OpenRequest = {
  id: string;
  code: string;
  task_id: string;
  task_version_id: string;
  feature_version_id: string | null;
};

/**
 * If the task (or its feature) has a newer approved version than the request is pinned to, appends the new
 * basis (the request snapshot is immutable) and regenerates its brief exactly as «request the build» does. Returns what changed, or null
 * (also when the task is not ready to build any more: the request then keeps its old basis).
 */
export async function adoptCurrentVersions(
  trx: Tx,
  projectId: string,
  request: OpenRequest,
  by: string,
  attempt: number,
) {
  let basis;
  try {
    basis = await computeRequestBasis(trx, projectId, { id: request.task_id, code: request.code });
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
  const newFeature = basis.feature?.id ?? null;
  const current = await effectiveBasis(trx, request.id);
  if (basis.taskVersionId === current.task_version_id && newFeature === current.feature_version_id) return null;
  const old = await trx
    .selectFrom('record_versions')
    .select('n')
    .where('id', '=', current.task_version_id)
    .executeTakeFirst();
  const oldFeature = current.feature_version_id
    ? await trx.selectFrom('record_versions').select('n').where('id', '=', current.feature_version_id).executeTakeFirst()
    : undefined;
  await trx
    .insertInto('build_request_bases')
    .values({
      project_id: projectId,
      build_request_id: request.id,
      task_version_id: basis.taskVersionId,
      feature_version_id: newFeature,
      brief: basis.brief,
      adopted_by: by,
      attempt,
    })
    .execute();
  return {
    task_version: { from: old?.n ?? null, to: basis.taskVersionN },
    feature_version: { from: oldFeature?.n ?? null, to: basis.feature?.n ?? null },
  };
}

/** True while the latest attempt of a request has neither failed, asked for changes nor merged. */
export async function buildRunning(trx: Db | Tx, requestId: string): Promise<boolean> {
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
        eb('outcome', '=', 'cancelled'),
      ]),
    )
    .executeTakeFirst();
  return !ended;
}

/** Whether an automatic source already has an issue: in any state when `anyState`, else an open one. */
async function issueFromSource(ctx: CommandContext, key: string, anyState: boolean): Promise<boolean> {
  let q = ctx.trx.selectFrom('issues').select('id').where('project_id', '=', ctx.projectId).where('source_key', '=', key);
  if (!anyState) q = q.where('state', '=', 'open');
  return (await q.executeTakeFirst()) !== undefined;
}

async function taskCodeOf(ctx: CommandContext, requestId: string): Promise<string> {
  const row = await ctx.trx
    .selectFrom('build_requests')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select('records.code')
    .where('build_requests.id', '=', requestId)
    .executeTakeFirstOrThrow();
  return row.code;
}

const oneLine = (text: string, max = 120): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** Opens the `review_escalation` issue of an attempt (once per request and attempt, in any state). */
async function openEscalationIssue(ctx: CommandContext, requestId: string, attempt: number): Promise<void> {
  const key = `escalation:${requestId}:${attempt}`;
  if (await issueFromSource(ctx, key, true)) return;
  const taskCode = await taskCodeOf(ctx, requestId);
  const review = await ctx.trx
    .selectFrom('pr_reviews')
    .select(['id', 'summary', 'comments'])
    .where('build_request_id', '=', requestId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const comments = ((review?.comments ?? []) as { path: string; line: number | null; severity: string; body: string; needs_person?: boolean }[]).filter(
    (c) => c.severity === 'blocking' && c.needs_person === true,
  );
  const lines = comments.map((c) => `${c.path}${c.line ? `:${c.line}` : ''} — ${c.body}`);
  const body = [...lines, ...(review ? ['', review.summary] : [])].join('\n').trim();
  await ctx.execute({
    command: 'issue.open',
    actor: ctx.actor,
    data: {
      kind: 'review_escalation',
      title: `Review escalation on ${taskCode}: ${oneLine(comments[0]?.body ?? review?.summary ?? 'the reviewer needs a person')}`,
      ...(body ? { body } : {}),
      task: taskCode,
      build_request_id: requestId,
      attempt,
      ...(review ? { pr_review_id: review.id } : {}),
      source_key: key,
    },
  });
}

/**
 * A quarantined flaky test becomes a `bug` issue so someone fixes it (Martin Fowler, "Eradicating Non-Determinism in
 * Tests": quarantine, and track the fix). One open issue per test.
 */
async function openFlakyIssues(ctx: CommandContext, requestId: string, attempt: number, tests: readonly string[]): Promise<void> {
  const taskCode = await taskCodeOf(ctx, requestId);
  for (const test of tests) {
    const key = `flaky:${test}`;
    if (await issueFromSource(ctx, key, false)) continue;
    await ctx.execute({
      command: 'issue.open',
      actor: ctx.actor,
      data: {
        kind: 'bug',
        title: oneLine(`Flaky test quarantined: ${test}`, 300),
        body: `${test} failed in one CI run and passed in another on the same commit while building ${taskCode} (attempt ${attempt}). It is outside that task's criteria, so DEMIURGO quarantined it instead of blocking; a flaky test must be fixed, not ignored.`,
        build_request_id: requestId,
        attempt,
        source_key: key,
      },
    });
  }
}

/** CI red on main after a merge becomes a `bug` issue linked to the task that merged (one per commit). */
async function openMainRedIssue(ctx: CommandContext, requestId: string, attempt: number, sha: string, conclusion: string | null): Promise<void> {
  const key = `main_red:${sha}`;
  if (await issueFromSource(ctx, key, true)) return;
  const taskCode = await taskCodeOf(ctx, requestId);
  await ctx.execute({
    command: 'issue.open',
    actor: ctx.actor,
    data: {
      kind: 'bug',
      title: `CI on main is red after merging ${taskCode}`,
      body: `CI on main (${sha.slice(0, 12)}) ended ${conclusion ?? 'without a conclusion'} after merging ${taskCode}. DEMIURGO stops building until main is green again.`,
      task: taskCode,
      build_request_id: requestId,
      attempt,
      source_key: key,
    },
  });
}

registerGuards({
  async build_can_start({ ctx, data }) {
    const code = trimmed(field(data, 'task'));
    const record = await ctx.trx
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', ctx.projectId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (record && (await mergedBuildOf(ctx.trx, record.id))) return `${code} is already built: its pull request was merged.`;
    const hold = record ? await openHoldOf(ctx.trx, record.id) : null;
    if (hold) return `${code} is on hold: ${hold.reason}`;
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
      // The ticket was updated while the request was open: adopt the current approved versions and
      // the brief they give, keeping the branch, the PR and the attempts (like a team editing the ticket).
      const adopted = await adoptCurrentVersions(ctx.trx, ctx.projectId, request, by, attempt);
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
        after: { task: request.code, build_request: request.id, attempt, started_by: by, ...(adopted ? { adopted } : {}) },
        result: { id: request.id, task: request.code, attempt, ...(adopted ? { adopted } : {}) },
      };
    },
  }),

  'build_step.record': handler({
    data: z
      .object({
        build_request_id: z.string().uuid(),
        attempt: z.number().int().positive(),
        stage: z.string().min(1).max(40),
        outcome: z.enum(['started', 'ok', 'failed', 'waiting', 'changes_requested', 'cancelled']),
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
      // What a person must look at becomes an issue: a review escalation (once per attempt), a quarantined flaky test
      // (once while open) and CI red on main after a merge (once per commit).
      if (data.stage === 'merge' && data.outcome === 'changes_requested' && data.detail?.escalated === 'needs_person') {
        await openEscalationIssue(ctx, data.build_request_id, data.attempt);
      }
      const quarantined = Array.isArray(data.detail?.quarantined) ? data.detail.quarantined.filter((t): t is string => typeof t === 'string') : [];
      if (data.stage === 'evidence' && quarantined.length > 0) await openFlakyIssues(ctx, data.build_request_id, data.attempt, quarantined);
      if (data.stage === 'main' && data.outcome === 'failed' && typeof data.detail?.sha === 'string') {
        await openMainRedIssue(ctx, data.build_request_id, data.attempt, data.detail.sha, typeof data.detail.conclusion === 'string' ? data.detail.conclusion : null);
      }
      // Level-triggered re-plan (a no-op with the queue off): the real files of a build (commit ok) change which
      // tasks collide, and a failed, cancelled, merged or escalated attempt frees a slot.
      const escalated = data.stage === 'merge' && data.outcome === 'changes_requested' && data.detail?.escalated === 'needs_person';
      if (
        (data.stage === 'commit' && data.outcome === 'ok') ||
        data.outcome === 'failed' ||
        data.outcome === 'cancelled' ||
        (data.stage === 'merge' && data.outcome === 'ok') ||
        escalated
      ) {
        const projectId = ctx.projectId;
        ctx.afterCommit(async () => void (await advanceBuildQueue(ctx.services, projectId)));
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
