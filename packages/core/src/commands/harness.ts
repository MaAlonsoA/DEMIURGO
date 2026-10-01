// `harness.postmortem`: the system records the deterministic post-mortem of an ended build request and its findings,
// in one transaction with its event. Append-only: the same (request, rules version, inputs hash) is never written twice.

import { DomainError } from '@demiurgo/domain';
import { sql } from 'kysely';
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

const outcome = z
  .object({
    judgment_table: z.string().min(1).max(60),
    judgment_id: z.string().uuid().nullish(),
    judgment_key: z.string().min(1).max(600),
    outcome_name: z.string().min(1).max(60),
    outcome_value: z.number().finite().nullish(),
    outcome_label: z.string().max(500).nullish(),
    observed_at: z.string().datetime(),
    source_type: z.string().min(1).max(40),
    source_id: z.string().uuid(),
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
        /** What really happened after each judgment (salud-del-harness §6.3); written in the same transaction, idempotent. */
        outcomes: z.array(outcome).default([]),
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
      // The version the build's first attempt started under (its `repo started` step; null for builds from before it).
      const first = await ctx.trx
        .selectFrom('build_steps')
        .select(sql<string | null>`detail->>'harness_version_id'`.as('harness_version_id'))
        .where('build_request_id', '=', data.build_request_id)
        .where('stage', '=', 'repo')
        .where('outcome', '=', 'started')
        .orderBy('attempt')
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirst();
      const row = await ctx.trx
        .insertInto('harness_postmortems')
        .values({
          harness_version_id: first?.harness_version_id ?? null,
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
      const written = (id: string) =>
        data.outcomes.length === 0
          ? 0
          : ctx.trx
              .insertInto('judgment_outcomes')
              .values(
                data.outcomes.map((o) => ({
                  project_id: ctx.projectId,
                  judgment_table: o.judgment_table,
                  judgment_id: o.judgment_id ?? null,
                  judgment_key: o.judgment_key,
                  outcome_name: o.outcome_name,
                  outcome_value: o.outcome_value ?? null,
                  outcome_label: o.outcome_label ?? null,
                  observed_at: o.observed_at,
                  source_type: o.source_type,
                  source_id: o.source_id,
                  rules_version: data.rules_version,
                })),
              )
              .onConflict((oc) => oc.columns(['judgment_table', 'judgment_key', 'outcome_name', 'rules_version']).doNothing())
              .returning('id')
              .execute()
              .then((rows) => rows.length);
      if (!row) {
        // The post-mortem exists: only outcomes it lacked may still be written; otherwise it is a conflict as before.
        const existing = await ctx.trx
          .selectFrom('harness_postmortems')
          .select('id')
          .where('build_request_id', '=', data.build_request_id)
          .where('rules_version', '=', data.rules_version)
          .where('inputs_hash', '=', data.inputs_hash)
          .executeTakeFirstOrThrow();
        const added = await written(existing.id);
        if (added === 0) throw new DomainError('conflict', 'This post-mortem is already recorded for these inputs.');
        return { entityId: existing.id, after: { build_request: data.build_request_id, rules_version: data.rules_version, outcomes: added }, result: { id: existing.id, outcomes: added } };
      }
      const outcomes = await written(row.id);
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
          outcomes,
        },
        result: { id: row.id },
      };
    },
  }),
});
