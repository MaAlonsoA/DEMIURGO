// exploration_chat action: an exploration conversation. The builder deterministically gathers
// what's on record; the applier turns the validated output into messages, questions,
// inferences and a batch of proposals. None of this touches authority.

import { COVERED_QUESTION_STATES, DomainError, stageDefinition, system } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import { knowledgeForContext } from '../context/knowledge.ts';
import { registerApplier } from './appliers.ts';

const BUDGET = { messages: 12_000, decisions: 4_000, sources: 6_000, knowledge: 4_000 };

function trimByBudget<T>(elements: T[], size: (e: T) => number, budget: number): T[] {
  const chosen: T[] = [];
  let used = 0;
  for (const e of elements) {
    const t = size(e);
    if (used + t > budget) break;
    chosen.push(e);
    used += t;
  }
  return chosen;
}

registerBuilder('exploration_chat', async ({ trx, projectId, scope, input, graphVersion }) => {
  const exploration = await trx
    .selectFrom('explorations')
    .selectAll()
    .where('id', '=', scope.id ?? '')
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (!exploration) throw new DomainError('not_found', 'The exploration does not exist.');
  // Most recent messages first for the budget; they go in chronological order in the pack.
  const messages = await trx
    .selectFrom('messages')
    .select(['id', 'author', 'kind', 'body', 'question_id'])
    .where('exploration_id', '=', exploration.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(60)
    .execute();
  const chosen = trimByBudget(messages, (m) => m.body.length, BUDGET.messages).toReversed();
  const questions = await trx
    .selectFrom('questions')
    .select(['id', 'question', 'state', 'conclusion', 'impact'])
    .where('exploration_id', '=', exploration.id)
    .where('state', '<>', 'discarded')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  // Design engine: the project's open stage and its mandatory questions not covered yet. They go
  // with the questions so the agent can infer them from any thread.
  const stage = await trx
    .selectFrom('stages')
    .select(['id', 'stage', 'exploration_id'])
    .where('project_id', '=', projectId)
    .where('state', '=', 'open')
    .orderBy('position')
    .executeTakeFirst();
  const stageQuestions = stage
    ? await trx
        .selectFrom('questions')
        .select(['id', 'question', 'state', 'conclusion', 'impact'])
        .where('stage_id', '=', stage.id)
        .where('stage_key', 'is not', null)
        .where('state', 'not in', [...COVERED_QUESTION_STATES])
        .orderBy('created_at')
        .execute()
    : [];
  for (const q of stageQuestions) if (!questions.some((x) => x.id === q.id)) questions.push(q);
  const decisions = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'record_versions.n', 'record_versions.title', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'decision')
    .where('record_versions.state', '=', 'approved')
    .orderBy('records.code')
    .execute();
  const decisionsSummary = trimByBudget(
    decisions.map((d) => {
      const sections = d.sections as { title: string; content: string }[];
      return {
        code: d.code,
        version: d.n,
        title: d.title,
        decision: sections.find((s) => s.title === 'Decision')?.content.slice(0, 400) ?? '',
      };
    }),
    (d) => d.title.length + d.decision.length,
    BUDGET.decisions,
  );
  const sources = await trx
    .selectFrom('sources')
    .select(['id', 'name', 'content', 'registered_by'])
    .where('project_id', '=', projectId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(5)
    .execute();
  const chosenSources = trimByBudget(
    sources.map((f) => ({ name: f.name, registered_by: f.registered_by, excerpt: f.content.slice(0, 2000) })),
    (f) => f.excerpt.length,
    BUDGET.sources,
  );
  const knowledge = await knowledgeForContext(
    trx,
    projectId,
    `${exploration.purpose} ${chosen.map((m) => m.body).join(' ')}`,
    BUDGET.knowledge,
  );
  return {
    role: 'explore',
    constructor: 'exploration_chat@1',
    budget: BUDGET,
    graph_version: graphVersion,
    dependencies: [
      { type: 'exploration', id: exploration.id, version: null },
      ...decisionsSummary.map((d) => {
        const r = decisions.find((x) => x.code === d.code);
        return { type: 'record', id: r?.recordId ?? '', version: d.version };
      }),
      ...knowledge.dependencies,
    ],
    content: {
      purpose: exploration.purpose,
      question_in_progress: typeof input.question_id === 'string' ? input.question_id : null,
      messages: chosen.map((m) => ({ author: m.author, type: m.kind, question: m.question_id, text: m.body })),
      questions: questions.map((q) => ({
        id: q.id,
        question: q.question,
        state: q.state,
        conclusion: q.conclusion,
        impact: q.impact,
      })),
      design_stage: stage
        ? {
            stage: stage.stage,
            title: stageDefinition(stage.stage)?.title ?? stage.stage,
            is_this_thread: stage.exploration_id === exploration.id,
            uncovered_mandatory_questions: stageQuestions.map((q) => ({ id: q.id, question: q.question, state: q.state })),
          }
        : null,
      confirmed_decisions: decisionsSummary,
      untrusted_sources: chosenSources,
      knowledge: knowledge.nodes,
    },
  };
});

registerApplier('exploration_chat', async ({ trx, execute, run, output }) => {
  const actor = { type: 'agent_run' as const, run: run.id };
  const scope = run.scope as { id: string };
  const pack = await trx
    .selectFrom('context_packs')
    .select(['content'])
    .where('id', '=', run.context_pack_id ?? '')
    .executeTakeFirstOrThrow();
  const content = pack.content as { question_in_progress: string | null; questions: { id: string; state: string }[] };
  const questionId = content.question_in_progress ?? undefined;
  const base = { projectId: run.project_id };
  await execute({
    ...base,
    command: 'message.post',
    actor,
    data: {
      exploration_id: scope.id,
      ...(questionId ? { question_id: questionId } : {}),
      text: output.reply,
      respond: false,
    },
  });
  if (output.purpose) {
    const current = await trx
      .selectFrom('explorations')
      .select(['purpose', 'state'])
      .where('id', '=', scope.id)
      .executeTakeFirst();
    if (current?.state === 'active' && current.purpose !== output.purpose) {
      await execute({
        ...base,
        command: 'exploration.revise_purpose',
        actor: system('exploration'),
        entityId: scope.id,
        data: { purpose: output.purpose },
      });
    }
  }
  for (const o of output.observations) {
    await execute({
      ...base,
      command: 'message.post',
      actor,
      data: { exploration_id: scope.id, text: o.text, type: o.type, respond: false },
    });
  }
  for (const q of output.questions) {
    await execute({
      ...base,
      command: 'question.raise',
      actor: system('exploration'),
      data: { exploration_id: scope.id, question: q.question, reason: q.reason, impact: q.impact },
    });
  }
  // Only pending questions that were in this run's context pack get inferred.
  const pending = new Set(content.questions.filter((q) => q.state === 'pending').map((q) => q.id));
  for (const inference of output.inferences) {
    if (!pending.has(inference.question_id)) continue;
    const q = await trx.selectFrom('questions').select('state').where('id', '=', inference.question_id).executeTakeFirst();
    if (q?.state !== 'pending') continue;
    await execute({
      ...base,
      command: 'question.infer',
      actor: system('exploration'),
      entityId: inference.question_id,
      data: { conclusion: inference.conclusion, reasoning: inference.reasoning },
    });
  }
  if (output.proposals.length > 0) {
    await execute({
      ...base,
      command: 'batch.submit',
      actor,
      data: {
        summary: `Proposals from the exploration conversation (${output.proposals.length}).`,
        batch_type: 'agent',
        resolution: 'item',
        run_id: run.id,
        context_pack_id: run.context_pack_id ?? undefined,
        proposals: output.proposals.map(({ type, ...payload }) => ({ type, payload })),
      },
    });
  }
});
