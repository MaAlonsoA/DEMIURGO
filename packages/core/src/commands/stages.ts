// Design stages (design engine). The catalog fixes the stages, their order and their mandatory
// questions; opening a stage opens its thread and raises them as the system; passing it is a
// person's decision, allowed only when every mandatory question is covered.

import { COVERED_QUESTION_STATES, STAGES, formatActor, nextStage, stageDefinition, system } from '@demiurgo/domain';
import { z } from 'zod';
import { field, registerGuards, trimmed } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import { proposeDefinitionIfCovered } from '../definition/compose.ts';
import { proposePrinciplesIfCovered } from '../definition/principles.ts';

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
    // The product's architecture rests on what is going to be built: at least one approved feature.
    if (STAGES[i]?.moment === 'before_build' && previous?.moment !== 'before_build') {
      const feature = await ctx.trx
        .selectFrom('records')
        .innerJoin('record_versions', 'record_versions.record_id', 'records.id')
        .select('records.id')
        .where('records.project_id', '=', ctx.projectId)
        .where('records.type', 'in', ['fdr', 'requirement'])
        .where('record_versions.state', '=', 'approved')
        .executeTakeFirst();
      if (!feature) return `The ${STAGES[i]?.title} stage rests on the features: approve at least one feature first.`;
    }
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
    // The stages live in the product's main thread: the one given, else the project's first root
    // thread, else a thread of their own (opened by the system, so it doesn't start the stages again).
    data: z.object({ stage: z.string().trim().min(1).max(40), exploration_id: z.string().uuid().optional() }).strict(),
    async apply(ctx, data, _e, to) {
      const def = stageDefinition(data.stage);
      if (!def) throw new Error(`Unknown stage ${data.stage}`);
      const actor = system('design');
      const main =
        data.exploration_id ??
        (
          await ctx.trx
            .selectFrom('explorations')
            .select('id')
            .where('project_id', '=', ctx.projectId)
            .where('parent_id', 'is', null)
            .where('state', '=', 'active')
            .orderBy('created_at')
            .executeTakeFirst()
        )?.id;
      const thread = main
        ? { entityId: main }
        : await ctx.execute({ command: 'exploration.open', actor, projectId: ctx.projectId, data: { purpose: def.purpose } });
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
      // DEMIURGO introduces the stage and gives its questions their options, so the person can
      // answer with one click before writing anything. The request waits for knowledge to be up to
      // date (the approvals that opened the stage are still being processed) and is made once per
      // stage; without an engine assigned it is dropped, and the options come with the first reply.
      // The first stage opened together with the product's first thread (exploration.open) is the
      // exception: nobody has said anything yet, and the first message is answered by the
      // conversation, so no run is requested behind the person's back.
      const exploration = thread.entityId;
      if (ctx.cause.sourceCommand !== 'exploration.open')
        ctx.afterCommit(() =>
          ctx.services.engine.startDeferredRun(`stage_opened:${id}`, ctx.projectId, exploration, { stage_opened: def.key }),
        );
      return { entityId: id, after: { stage: def.key, exploration } };
    },
  }),

  'stage.pass': handler({
    data: z.object({}).strict(),
    async apply(ctx, _d, e) {
      const id = e?.id ?? '';
      const stage = trimmed(e?.row.stage);
      const thread = trimmed(e?.row.exploration_id);
      await ctx.trx
        .updateTable('stages')
        .set({ passed_by: formatActor(ctx.actor), passed_at: new Date() })
        .where('id', '=', id)
        .execute();
      // A stage covered before the definition existed (or whose definition was rejected) proposes it now.
      await proposeDefinitionIfCovered(ctx, id);
      await proposePrinciplesIfCovered(ctx, id);
      const next = nextStage(stage);
      if (next) {
        await ctx.execute({
          command: 'stage.open',
          actor: system('design'),
          projectId: ctx.projectId,
          data: { stage: next.key, ...(thread ? { exploration_id: thread } : {}) },
        });
        // The new stage's introduction is requested by stage.open (deferred until knowledge is up to date).
      }
      // The last onboarding stage passed: DEMIURGO invites the person to design the first feature,
      // with options drawn from the definition's first version (the explorer's reply).
      const def = stageDefinition(stage);
      if (!next && def?.moment === 'onboarding' && thread)
        ctx.afterCommit(() =>
          ctx.services.engine.startDeferredRun(`onboarding_done:${thread}`, ctx.projectId, thread, { onboarding_done: true }),
        );
      return { entityId: id, after: { stage, next: next?.key ?? null } };
    },
  }),
});
