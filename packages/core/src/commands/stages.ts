// Design stages (design engine). The catalog fixes the stages, their order and their mandatory
// questions; opening a stage opens its thread and raises them as the system; passing it is a
// person's decision, allowed only when every mandatory question is covered.

import { COVERED_QUESTION_STATES, STAGES, formatActor, nextStage, stageDefinition, system } from '@demiurgo/domain';
import { z } from 'zod';
import { field, registerGuards, trimmed } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';

registerGuards({
  async stage_in_order({ ctx, data }) {
    const key = trimmed(field(data, 'stage'));
    const i = STAGES.findIndex((s) => s.key === key);
    if (i < 0) return `There is no design stage "${key}".`;
    const opened = await ctx.trx
      .selectFrom('stages')
      .select(['stage', 'state'])
      .where('project_id', '=', ctx.projectId)
      .execute();
    if (opened.some((s) => s.stage === key)) return `The ${STAGES[i]?.title} stage is already open.`;
    const previous = i > 0 ? STAGES[i - 1] : undefined;
    if (previous && !opened.some((s) => s.stage === previous.key && s.state === 'passed'))
      return `The ${previous.title} stage has to pass first.`;
    return null;
  },
  async stage_covered({ ctx, entity }) {
    const stageId = entity?.id ?? '';
    const questions = await ctx.trx
      .selectFrom('questions')
      .select(['question', 'state'])
      .where('stage_id', '=', stageId)
      .where('stage_key', 'is not', null)
      .execute();
    const open = questions.filter((q) => !(COVERED_QUESTION_STATES as readonly string[]).includes(q.state));
    if (open.length === 0) return null;
    return `${open.length} mandatory ${open.length === 1 ? 'question is' : 'questions are'} not confirmed yet: ${open
      .map((q) => q.question)
      .join(' · ')}`;
  },
});

registerHandlers({
  'stage.open': handler({
    data: z.object({ stage: z.string().trim().min(1).max(40) }).strict(),
    async apply(ctx, data, _e, to) {
      const def = stageDefinition(data.stage);
      if (!def) throw new Error(`Unknown stage ${data.stage}`);
      const actor = system('design');
      const thread = await ctx.execute({
        command: 'exploration.open',
        actor: ctx.actor.type === 'human' ? ctx.actor : actor,
        projectId: ctx.projectId,
        data: { purpose: def.purpose },
      });
      const { id } = await ctx.trx
        .insertInto('stages')
        .values({
          project_id: ctx.projectId,
          stage: def.key,
          position: STAGES.indexOf(def),
          exploration_id: thread.entityId,
          state: to,
          opened_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const q of def.questions) {
        await ctx.execute({
          command: 'question.raise',
          actor,
          projectId: ctx.projectId,
          data: {
            exploration_id: thread.entityId,
            question: q.question,
            reason: q.reason,
            impact: q.impact,
            stage_id: id,
            stage_key: q.key,
          },
        });
      }
      return { entityId: id, after: { stage: def.key, exploration: thread.entityId } };
    },
  }),

  'stage.pass': handler({
    data: z.object({}).strict(),
    async apply(ctx, _d, e) {
      const id = e?.id ?? '';
      const stage = String(e?.row.stage ?? '');
      await ctx.trx
        .updateTable('stages')
        .set({ passed_by: formatActor(ctx.actor), passed_at: new Date() })
        .where('id', '=', id)
        .execute();
      const next = nextStage(stage);
      if (next)
        await ctx.execute({
          command: 'stage.open',
          actor: system('design'),
          projectId: ctx.projectId,
          data: { stage: next.key },
        });
      return { entityId: id, after: { stage, next: next?.key ?? null } };
    },
  }),
});
