// The product definition (domain/definition.ts) as the system proposes it. When the product
// definition stage is covered, the system composes the definition from the confirmed answers and
// proposes it; a person accepts it. When an answer changes later (the question is reopened and
// confirmed again), it proposes the next version with what changed and why. Nothing here uses AI and
// nothing becomes authority on its own.

import {
  DEFINITION_STAGE,
  type Section,
  composeDefinition,
  definitionChangeNote,
  definitionChanges,
  system,
} from '@demiurgo/domain';
import type { CommandContext } from '../bus/types.ts';

export const DEFINITION_ACTOR = system('definition');

/** Proposes the definition (or its next version) when the given stage is the covered definition stage. */
export async function proposeDefinitionIfCovered(ctx: CommandContext, stageId: string | null | undefined): Promise<void> {
  if (!stageId) return;
  const stage = await ctx.trx.selectFrom('stages').select('stage').where('id', '=', stageId).executeTakeFirst();
  if (stage?.stage !== DEFINITION_STAGE) return;
  const questions = await ctx.trx
    .selectFrom('questions')
    .select(['id', 'stage_key', 'state', 'conclusion', 'state_reason'])
    .where('stage_id', '=', stageId)
    .where('stage_key', 'is not', null)
    .execute();
  const composed = composeDefinition(questions.map((q) => ({ ...q, key: q.stage_key ?? '' })));
  if (!composed) return;
  // One proposed definition at a time: a newer answer waits until the person resolves it.
  const pending = await ctx.trx
    .selectFrom('proposals')
    .select('id')
    .where('project_id', '=', ctx.projectId)
    .where('type', '=', 'product_definition')
    .where('state', '=', 'pending')
    .executeTakeFirst();
  if (pending) return;
  const record = await ctx.trx
    .selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', ctx.projectId)
    .where('type', '=', 'product_definition')
    .executeTakeFirst();
  const base = record
    ? await ctx.trx
        .selectFrom('record_versions')
        .select(['n', 'sections'])
        .where('record_id', '=', record.id)
        .where('state', '<>', 'discarded')
        .orderBy('n', 'desc')
        .executeTakeFirst()
    : undefined;
  let changeNote: string | undefined;
  let summary = 'The product definition, composed from the answers you confirmed.';
  if (record && base) {
    const changed = definitionChanges(base.sections as Section[], composed.sections);
    if (changed.length === 0) return;
    const reasons = [];
    for (const section of changed) {
      const questionId = composed.sources.find((s) => s.section === section)?.question_id ?? null;
      reasons.push({ section, why: questionId ? await reopenReason(ctx, questionId) : null });
    }
    changeNote = definitionChangeNote(reasons);
    summary = `A new version of the product definition: ${changed.join(', ')}.`;
  }
  await ctx.execute({
    command: 'batch.submit',
    actor: DEFINITION_ACTOR,
    projectId: ctx.projectId,
    // Proposals are born within their batch's submission, whatever command covered the stage.
    cause: { sourceCommand: 'batch.submit' },
    data: {
      summary,
      batch_type: 'system_package',
      resolution: 'item',
      proposals: [
        {
          type: 'product_definition',
          payload: {
            ...(record && base ? { record: { code: record.code, version: base.n } } : {}),
            title: composed.title,
            sections: composed.sections,
            sources: composed.sources,
            ...(changeNote ? { change_note: changeNote } : {}),
          },
          dependencies: record && base ? [{ type: 'record', id: record.id, code: record.code, version: base.n }] : [],
        },
      ],
    },
  });
}

/** Why an answer changed: the reason the person gave when reopening its question, if any. */
async function reopenReason(ctx: CommandContext, questionId: string): Promise<string | null> {
  const reopened = await ctx.trx
    .selectFrom('events')
    .select('after')
    .where('project_id', '=', ctx.projectId)
    .where('entity_id', '=', questionId)
    .where('command', '=', 'question.reopen')
    .orderBy('seq', 'desc')
    .executeTakeFirst();
  const reason = (reopened?.after as { reason?: string | null } | null)?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}
