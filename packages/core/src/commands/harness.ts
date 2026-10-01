// `harness.postmortem`: the system records the deterministic post-mortem of an ended build request and its findings,
// in one transaction with its event. Append-only: the same (request, rules version, inputs hash) is never written twice.

import { DomainError } from '@demiurgo/domain';
import { z } from 'zod';
import { handler, registerHandlers } from '../bus/handlers.ts';
import { FINDING_CLASSES, FINDING_UNITS } from '../harness/rules/index.ts';

const finding = z
  .object({
    piece: z.string().min(1).max(10),
    finding: z.string().min(1).max(80),
    class: z.enum(FINDING_CLASSES),
    ground_truth: z.string().max(10).nullish(),
    value: z.number().finite().nullish(),
    unit: z.enum(FINDING_UNITS).nullish(),
    subject: z.string().max(500).nullish(),
    attempt: z.number().int().positive().nullish(),
    evidence: z.unknown(),
  })
  .strict();

registerHandlers({
  'harness.postmortem': handler({
    data: z
      .object({
        build_request_id: z.string().uuid(),
        rules_version: z.string().min(1).max(60),
        inputs_hash: z.string().min(8).max(128),
        attempts: z.number().int().nonnegative(),
        outcome: z.enum(['merged', 'withdrawn', 'failed', 'needs_you']),
        findings: z.array(finding),
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
      const row = await ctx.trx
        .insertInto('harness_postmortems')
        .values({
          project_id: ctx.projectId,
          build_request_id: data.build_request_id,
          rules_version: data.rules_version,
          inputs_hash: data.inputs_hash,
          attempts: data.attempts,
          outcome: data.outcome,
          findings: data.findings.length,
        })
        .onConflict((oc) => oc.columns(['build_request_id', 'rules_version', 'inputs_hash']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!row) throw new DomainError('conflict', 'This post-mortem is already recorded for these inputs.');
      if (data.findings.length > 0) {
        await ctx.trx
          .insertInto('harness_findings')
          .values(
            data.findings.map((f) => ({
              project_id: ctx.projectId,
              postmortem_id: row.id,
              build_request_id: data.build_request_id,
              attempt: f.attempt ?? null,
              piece: f.piece,
              finding: f.finding,
              class: f.class,
              ground_truth: f.ground_truth ?? null,
              value: f.value ?? null,
              unit: f.unit ?? null,
              subject: f.subject ?? null,
              evidence: JSON.stringify(f.evidence ?? null),
            })),
          )
          .execute();
      }
      return {
        entityId: row.id,
        after: {
          build_request: data.build_request_id,
          rules_version: data.rules_version,
          outcome: data.outcome,
          attempts: data.attempts,
          findings: data.findings.length,
        },
        result: { id: row.id },
      };
    },
  }),
});
