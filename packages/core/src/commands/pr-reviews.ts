// pr_review.record: stores the verdict of the reviewer agent on a build request's pull request. Only
// the system applies it, from the validated output of a pr_review run; the row is append-only.

import { DomainError, formatActor } from '@demiurgo/domain';
import { z } from 'zod';
import { handler, registerHandlers } from '../bus/handlers.ts';
import { classifyReviewFindings } from '../classifier/review-findings.ts';

registerHandlers({
  'pr_review.record': handler({
    data: z
      .object({
        build_request_id: z.string().uuid(),
        run_id: z.string().uuid(),
        verdict: z.enum(['approve', 'request_changes']),
        summary: z.string().min(1).max(1500),
        comments: z.array(z.object({ path: z.string(), line: z.number().int().nullable(), severity: z.string(), body: z.string(), needs_person: z.boolean().optional() }).strict()).max(40),
        criteria: z.array(z.object({ code: z.string(), test_name: z.string().nullable(), covered: z.boolean(), note: z.string() }).strict()),
      })
      .strict(),
    async apply(ctx, data) {
      const request = await ctx.trx
        .selectFrom('build_requests')
        .select(['id', 'task_id'])
        .where('id', '=', data.build_request_id)
        .where('project_id', '=', ctx.projectId)
        .executeTakeFirst();
      if (!request) throw new DomainError('not_found', 'The build request does not exist.');
      const { id } = await ctx.trx
        .insertInto('pr_reviews')
        .values({
          project_id: ctx.projectId,
          build_request_id: data.build_request_id,
          run_id: data.run_id,
          verdict: data.verdict,
          summary: data.summary,
          comments: JSON.stringify(data.comments),
          criteria: JSON.stringify(data.criteria),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Jev learns why it bounced: after the commit, best effort, only with a key.
      if (data.comments.length > 0) ctx.afterCommit(() => void classifyReviewFindings(ctx.services, ctx.projectId, id));
      return {
        entityId: id,
        after: {
          build_request: data.build_request_id,
          run: data.run_id,
          verdict: data.verdict,
          blocking: data.comments.filter((c) => c.severity === 'blocking').length,
          criteria: data.criteria.map((c) => ({ code: c.code, covered: c.covered })),
          recorded_by: formatActor(ctx.actor),
        },
        result: { id, verdict: data.verdict },
      };
    },
  }),
});
