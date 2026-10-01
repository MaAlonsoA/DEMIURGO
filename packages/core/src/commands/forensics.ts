// task_forensics.record and forensic_playbook.record: store the validated output of the forensics agent and of the
// playbook writer. Only the system applies them, from a run; both tables are append-only.

import { DomainError, formatActor, playbookWriteOutput, taskForensicsOutput } from '@demiurgo/domain';
import { z } from 'zod';
import { handler, registerHandlers } from '../bus/handlers.ts';

const engine = z.object({ provider: z.string(), model: z.string().nullable(), effort: z.string().nullable(), mark: z.unknown().optional() }).strict();

registerHandlers({
  'task_forensics.record': handler({
    data: z
      .object({
        task_id: z.string().uuid(),
        task_version_id: z.string().uuid(),
        request_ids: z.array(z.string().uuid()),
        ai_run_id: z.string().uuid(),
        analysis: taskForensicsOutput.extend({ catalog_marks: z.record(z.string(), z.string()) }),
        evidence_hash: z.string().regex(/^[0-9a-f]{64}$/),
        catalog_version: z.string().min(1),
        agent_version: z.string().min(1),
        engine,
      })
      .strict(),
    async apply(ctx, data) {
      const task = await ctx.trx.selectFrom('records').select(['id', 'code']).where('id', '=', data.task_id).where('project_id', '=', ctx.projectId).executeTakeFirst();
      if (!task) throw new DomainError('not_found', 'The task does not exist.');
      const { id } = await ctx.trx
        .insertInto('task_forensics')
        .values({
          project_id: ctx.projectId,
          task_id: data.task_id,
          task_version_id: data.task_version_id,
          request_ids: data.request_ids,
          ai_run_id: data.ai_run_id,
          analysis: JSON.stringify(data.analysis),
          evidence_hash: data.evidence_hash,
          catalog_version: data.catalog_version,
          agent_version: data.agent_version,
          engine: JSON.stringify(data.engine),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: {
          task: task.code,
          run: data.ai_run_id,
          outcome: data.analysis.outcome,
          evidence_hash: data.evidence_hash,
          catalog_version: data.catalog_version,
          went_wrong: data.analysis.went_wrong.length,
          improvements: data.analysis.improvements.length,
          recorded_by: formatActor(ctx.actor),
        },
        result: { id, code: task.code },
      };
    },
  }),

  'forensic_playbook.record': handler({
    data: z
      .object({
        class_key: z.string().min(1).max(80),
        entry: playbookWriteOutput,
        based_on: z.array(z.string().uuid()),
        ai_run_id: z.string().uuid(),
      })
      .strict(),
    async apply(ctx, data) {
      const last = await ctx.trx
        .selectFrom('forensic_playbooks')
        .select('version')
        .where('project_id', '=', ctx.projectId)
        .where('class_key', '=', data.class_key)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      const version = (last?.version ?? 0) + 1;
      const { id } = await ctx.trx
        .insertInto('forensic_playbooks')
        .values({
          project_id: ctx.projectId,
          class_key: data.class_key,
          version,
          entry: JSON.stringify(data.entry),
          based_on: data.based_on,
          ai_run_id: data.ai_run_id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: { class_key: data.class_key, version, run: data.ai_run_id, based_on: data.based_on.length, recorded_by: formatActor(ctx.actor) },
        result: { id, version },
      };
    },
  }),
});
