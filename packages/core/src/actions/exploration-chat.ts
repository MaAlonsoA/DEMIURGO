// exploration_chat action: an exploration conversation. The builder deterministically gathers
// what's on record; the applier turns the validated output into messages, questions,
// inferences and a batch of proposals. None of this touches authority.
// While it gathers, the builder writes the manifest (observability §9): every message, question,
// decision, source and knowledge node it weighed, with the journal event or version it derives
// from and what happened to it. The pack itself is the same as `exploration_chat@1` produced.

import { COVERED_QUESTION_STATES, DomainError, findQuote, stageDefinition, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { loadAgentCatalog } from '../agents/catalog.ts';
import { registerBuilder } from '../context/build.ts';
import { knowledgeForContext } from '../context/knowledge.ts';
import { type FragmentSource, ManifestBuilder, recordKnowledge } from '../context/manifest.ts';
import type { Db, Tx } from '../db/connection.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { revealQuestions } from '../commands/exploration.ts';
import { definitionChangeProposal } from '../definition/compose.ts';

const BUILDER = 'exploration_chat@2';
const BUDGET = { messages: 12_000, decisions: 4_000, records: 16_000, sources: 6_000, knowledge: 4_000 };
const LIMIT = { messages: 60, sources: 5, decisionChars: 400, recordChars: 3000, sourceChars: 2000 };

/** What the budget admits, in order, and what it leaves out: the first element that does not fit closes it. */
function splitByBudget<T>(elements: T[], size: (e: T) => number, budget: number): { chosen: T[]; dropped: T[] } {
  const chosen: T[] = [];
  let used = 0;
  let i = 0;
  for (; i < elements.length; i++) {
    const e = elements[i] as T;
    const t = size(e);
    if (used + t > budget) break;
    chosen.push(e);
    used += t;
  }
  return { chosen, dropped: elements.slice(i) };
}

/** The `seq` of the journal event that created each message (`message.post`), by message id. */
async function messageEventSeqs(trx: Tx, projectId: string, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('events')
    .select(['entity_id', sql<string>`min(seq)`.as('seq')])
    .where('project_id', '=', projectId)
    .where('entity_type', '=', 'message')
    .where('entity_id', 'in', ids)
    .groupBy('entity_id')
    .execute();
  return new Map(rows.map((r) => [r.entity_id, Number(r.seq)]));
}

const source = (type: string, id: string, version: number | null = null, eventSeq: number | null = null): FragmentSource => ({
  type,
  id,
  version,
  eventSeq,
});

registerBuilder('exploration_chat', async ({ trx, projectId, scope, input, graphVersion }) => {
  const manifest = new ManifestBuilder(BUILDER, graphVersion, BUDGET);
  const exploration = await trx
    .selectFrom('explorations')
    .selectAll()
    .where('id', '=', scope.id ?? '')
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (!exploration) throw new DomainError('not_found', 'The exploration does not exist.');
  manifest.entered({
    section: 'purpose',
    source: source('exploration', exploration.id),
    text: exploration.purpose,
    reason: 'scope',
  });
  // Most recent messages first for the budget; they go in chronological order in the pack. The
  // whole thread is read so that what the limit leaves out is on the manifest too.
  const allMessages = await trx
    .selectFrom('messages')
    .select(['id', 'author', 'kind', 'body', 'question_id'])
    .where('exploration_id', '=', exploration.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const messages = allMessages.slice(0, LIMIT.messages);
  const beyondLimit = allMessages.slice(LIMIT.messages);
  const split = splitByBudget(messages, (m) => m.body.length, BUDGET.messages);
  const chosen = split.chosen.toReversed();
  const seqs = await messageEventSeqs(
    trx,
    projectId,
    allMessages.map((m) => m.id),
  );
  const messageSource = (id: string) => source('message', id, null, seqs.get(id) ?? null);
  for (const m of chosen) manifest.entered({ section: 'messages', source: messageSource(m.id), text: m.body, reason: 'recent' });
  for (const m of split.dropped)
    manifest.dropped({ section: 'messages', source: messageSource(m.id), text: m.body, reason: 'budget:messages' });
  for (const m of beyondLimit)
    manifest.dropped({ section: 'messages', source: messageSource(m.id), text: m.body, reason: `limit:${LIMIT.messages}` });
  const allQuestions = await trx
    .selectFrom('questions')
    .select([
      'id',
      'question',
      'reason',
      'state',
      'conclusion',
      'impact',
      'options',
      'conversation_option',
      'multiple',
      'shown_at',
    ])
    .where('exploration_id', '=', exploration.id)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const questions = allQuestions.filter((q) => q.state !== 'discarded');
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
        .select([
          'id',
          'question',
          'reason',
          'state',
          'conclusion',
          'impact',
          'options',
          'conversation_option',
          'multiple',
          'shown_at',
        ])
        .where('stage_id', '=', stage.id)
        .where('stage_key', 'is not', null)
        .where('state', 'not in', [...COVERED_QUESTION_STATES])
        .orderBy('created_at')
        .execute()
    : [];
  const ownQuestions = new Set(questions.map((q) => q.id));
  for (const q of stageQuestions) if (!ownQuestions.has(q.id)) questions.push(q);
  for (const q of questions)
    manifest.entered({
      section: 'questions',
      source: source('question', q.id),
      text: q.question,
      reason: ownQuestions.has(q.id) ? `state:${q.state}` : `stage:${stage?.stage ?? ''}`,
    });
  for (const q of allQuestions)
    if (q.state === 'discarded')
      manifest.dropped({ section: 'questions', source: source('question', q.id), text: q.question, reason: 'state:discarded' });
  const stageTitle = stage ? (stageDefinition(stage.stage)?.title ?? stage.stage) : '';
  if (stage)
    manifest.entered({
      section: 'design_stage',
      source: source('stage', stage.id),
      text: stageTitle,
      reason: `stage:${stage.stage}`,
    });
  // The record the thread was opened about (Ask DEMIURGO about this): whole, with its state, so the
  // agent answers about it without asking the person to paste it.
  const about =
    exploration.origin_type === 'record_version' && exploration.origin_id
      ? await trx
          .selectFrom('record_versions')
          .innerJoin('records', 'records.id', 'record_versions.record_id')
          .select([
            'records.id as recordId',
            'records.code',
            'records.type',
            'record_versions.id',
            'record_versions.n',
            'record_versions.state',
            'record_versions.title',
            'record_versions.sections',
          ])
          .where('record_versions.id', '=', exploration.origin_id)
          .where('records.project_id', '=', projectId)
          .executeTakeFirst()
      : undefined;
  const aboutRecord = about
    ? {
        code: about.code,
        type: about.type,
        version: about.n,
        state: about.state,
        title: about.title,
        sections: about.sections as { title: string; content: string }[],
      }
    : null;
  if (about && aboutRecord)
    manifest.entered({
      section: 'about_record',
      source: source('record_version', about.id, about.n),
      text: JSON.stringify(aboutRecord),
      reason: 'thread origin',
    });
  // The product definition's draft: accepted but not approved yet, newer than the version in force.
  // It is what the person is still exploring before approving it, so the conversation reads it too.
  const definitionDraft = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select([
      'records.id as recordId',
      'records.code',
      'record_versions.id',
      'record_versions.n',
      'record_versions.state',
      'record_versions.sections',
    ])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'product_definition')
    .orderBy('record_versions.n', 'desc')
    .executeTakeFirst()
    .then((v) => (v && v.state === 'draft' ? v : undefined));
  const productDefinitionDraft = definitionDraft
    ? {
        code: definitionDraft.code,
        version: definitionDraft.n,
        state: 'draft',
        sections: definitionDraft.sections as { title: string; content: string }[],
      }
    : null;
  if (definitionDraft && productDefinitionDraft)
    manifest.entered({
      section: 'product_definition_draft',
      source: source('record_version', definitionDraft.id, definitionDraft.n),
      text: JSON.stringify(productDefinitionDraft),
      reason: 'definition draft',
    });
  const decisions = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'record_versions.n', 'record_versions.title', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'decision')
    .where('record_versions.state', '=', 'approved')
    .orderBy('records.code')
    .execute();
  const decisionSplit = splitByBudget(
    decisions.map((d) => {
      const sections = d.sections as { title: string; content: string }[];
      const full = sections.find((s) => s.title === 'Decision')?.content ?? '';
      return {
        code: d.code,
        version: d.n,
        title: d.title,
        decision: full.slice(0, LIMIT.decisionChars),
        recordId: d.recordId,
        fullChars: full.length,
      };
    }),
    (d) => d.title.length + d.decision.length,
    BUDGET.decisions,
  );
  const decisionsSummary = decisionSplit.chosen.map(({ code, version, title, decision }) => ({ code, version, title, decision }));
  for (const d of decisionSplit.chosen)
    manifest.entered({
      section: 'decisions',
      source: source('record', d.recordId, d.version),
      text: d.decision,
      chars: d.title.length + d.decision.length,
      originalChars: d.title.length + d.fullChars,
      decision: d.fullChars > d.decision.length ? 'truncated' : 'included',
      reason: d.fullChars > d.decision.length ? `excerpt:${LIMIT.decisionChars}` : 'approved',
    });
  for (const d of decisionSplit.dropped)
    manifest.dropped({
      section: 'decisions',
      source: source('record', d.recordId, d.version),
      text: d.decision,
      chars: d.title.length + d.decision.length,
      originalChars: d.title.length + d.fullChars,
      reason: 'budget:decisions',
    });
  // The design records in force (product definition, requirements, NFRs, ADRs, threat model...): each
  // stage builds on the ones before, so the agent reads what was approved, not only the answers.
  const approved = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type', 'record_versions.n', 'record_versions.title', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.type', 'in', ['product_definition', 'requirement', 'quality_requirement', 'adr', 'threat_model', 'production_readiness'])
    .where('record_versions.state', '=', 'approved')
    .orderBy('records.code')
    .orderBy('record_versions.n', 'desc')
    .execute();
  const latest = approved.filter((r, i) => approved.findIndex((o) => o.recordId === r.recordId) === i);
  const recordSplit = splitByBudget(
    latest.map((r) => {
      const full = (r.sections as { title: string; content: string }[]).map((x) => `${x.title}: ${x.content}`).join('\n');
      return { code: r.code, type: r.type, version: r.n, title: r.title, content: full.slice(0, LIMIT.recordChars), recordId: r.recordId, fullChars: full.length };
    }),
    (r) => r.title.length + r.content.length,
    BUDGET.records,
  );
  const designRecords = recordSplit.chosen.map(({ code, type, version, title, content }) => ({ code, type, version, title, content }));
  for (const r of recordSplit.chosen)
    manifest.entered({
      section: 'design_records',
      source: source('record', r.recordId, r.version),
      text: r.content,
      originalChars: r.fullChars,
      reason: r.fullChars > r.content.length ? `excerpt:${LIMIT.recordChars}` : 'approved',
    });
  for (const r of recordSplit.dropped)
    manifest.dropped({
      section: 'design_records',
      source: source('record', r.recordId, r.version),
      text: r.content,
      originalChars: r.fullChars,
      reason: 'budget:records',
    });
  const allSources = await trx
    .selectFrom('sources')
    .select(['id', 'name', 'content', 'registered_by'])
    .where('project_id', '=', projectId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const sources = allSources.slice(0, LIMIT.sources);
  const sourceSplit = splitByBudget(
    sources.map((f) => ({
      id: f.id,
      name: f.name,
      registered_by: f.registered_by,
      excerpt: f.content.slice(0, LIMIT.sourceChars),
      fullChars: f.content.length,
    })),
    (f) => f.excerpt.length,
    BUDGET.sources,
  );
  const chosenSources = sourceSplit.chosen.map(({ name, registered_by, excerpt }) => ({ name, registered_by, excerpt }));
  for (const f of sourceSplit.chosen)
    manifest.entered({
      section: 'sources',
      source: source('source', f.id),
      text: f.excerpt,
      originalChars: f.fullChars,
      reason: f.fullChars > f.excerpt.length ? `excerpt:${LIMIT.sourceChars}` : 'recent',
    });
  for (const f of sourceSplit.dropped)
    manifest.dropped({
      section: 'sources',
      source: source('source', f.id),
      text: f.excerpt,
      originalChars: f.fullChars,
      reason: 'budget:sources',
    });
  for (const f of allSources.slice(LIMIT.sources))
    manifest.dropped({
      section: 'sources',
      source: source('source', f.id),
      text: f.content.slice(0, LIMIT.sourceChars),
      originalChars: f.content.length,
      reason: `limit:${LIMIT.sources}`,
    });
  const knowledge = await knowledgeForContext(
    trx,
    projectId,
    `${exploration.purpose} ${chosen.map((m) => m.body).join(' ')}`,
    BUDGET.knowledge,
  );
  recordKnowledge(manifest, knowledge);
  return {
    pack: {
      role: 'explore',
      constructor: BUILDER,
      budget: BUDGET,
      graph_version: graphVersion,
      dependencies: [
        { type: 'exploration', id: exploration.id, version: null },
        ...(about ? [{ type: 'record', id: about.recordId, version: about.n }] : []),
        ...(definitionDraft && definitionDraft.recordId !== about?.recordId
          ? [{ type: 'record', id: definitionDraft.recordId, version: definitionDraft.n }]
          : []),
        ...decisionSplit.chosen.map((d) => ({ type: 'record', id: d.recordId, version: d.version })),
        ...knowledge.dependencies,
      ],
      content: {
        purpose: exploration.purpose,
        question_in_progress: typeof input.question_id === 'string' ? input.question_id : null,
        messages: chosen.map((m) => ({ author: m.author, type: m.kind, question: m.question_id, text: m.body })),
        questions: questions.map((q) => ({
          id: q.id,
          question: q.question,
          reason: q.reason,
          state: q.state,
          conclusion: q.conclusion,
          impact: q.impact,
          has_options: q.options.length > 0,
          // The one being talked about carries its options, so Go deeper and the explainer weigh them,
          // and the answer its conversation led to so far, which the next reply refines.
          ...(q.id === input.question_id && q.options.length > 0
            ? { options: q.options.map((o) => ({ answer: o.answer, implies: o.implies })) }
            : {}),
          ...(q.id === input.question_id && q.conversation_option ? { conversation_option: q.conversation_option } : {}),
          multiple: q.multiple,
          // Not shown yet: it waits in the reserve for its turn (don't ask it again).
          shown: q.shown_at !== null,
        })),
        design_stage: stage
          ? {
              stage: stage.stage,
              title: stageTitle,
              is_this_thread: stage.exploration_id === exploration.id,
              // Opened just now, when the previous stage passed: nobody has written about it yet.
              just_opened: input.stage_opened === stage.stage,
              uncovered_mandatory_questions: stageQuestions.map((q) => ({ id: q.id, question: q.question, state: q.state })),
            }
          : null,
        ...(aboutRecord ? { about_record: aboutRecord } : {}),
        ...(productDefinitionDraft ? { product_definition_draft: productDefinitionDraft } : {}),
        confirmed_decisions: decisionsSummary,
        design_records: designRecords,
        untrusted_sources: chosenSources,
        knowledge: knowledge.nodes,
      },
    },
    manifest: manifest.build(),
  };
});

/** What the person wrote in the thread, most recent first: where an agent's quotes have to be. */
function saidInThread(db: Db, explorationId: string) {
  return db
    .selectFrom('messages')
    .select(['id', 'body'])
    .where('exploration_id', '=', explorationId)
    .where('author', 'like', 'human:%')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
}

// A quote that isn't in what the person wrote goes back to the agent once: dropped, it would take
// its inference or its change with it, and it is often just a word copied wrong.
registerChecker('exploration_chat', async ({ db, run, output }) => {
  const said = await saidInThread(db, (run.scope as { id: string }).id);
  const quotes = [
    ...output.inferences.flatMap((i) => i.quotes),
    ...output.proposals.flatMap((p) => (p.type === 'definition_change' ? p.quotes : [])),
  ];
  return quotes
    .filter((quote) => !findQuote(quote, said))
    .map(
      (quote) =>
        `The quote "${quote}" is not in what the person wrote in this thread. Copy their words exactly as they wrote them, or leave the quote out.`,
    );
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
  // In a side conversation (Go deeper, and the explanation inside it), the answer it led to becomes one
  // more option of the question while it is open.
  if (questionId && output.conversation_option) {
    const q = await trx.selectFrom('questions').select(['state']).where('id', '=', questionId).executeTakeFirst();
    if (q?.state === 'pending' || q?.state === 'inferred') {
      await execute({
        ...base,
        command: 'question.set_conversation_option',
        actor: system('exploration'),
        entityId: questionId,
        data: output.conversation_option,
      });
    }
  }
  // A reply-only agent (the explainer) leaves its reply and the idea, nothing else, whatever it returned.
  if ((await loadAgentCatalog()).get(run.agent ?? '')?.replyOnly) return;
  // The product's main thread keeps its product-wide purpose: each stage brings its own (design_stage).
  const hostsStages = await trx.selectFrom('stages').select('id').where('exploration_id', '=', scope.id).executeTakeFirst();
  if (output.purpose && !hostsStages) {
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
      data: {
        exploration_id: scope.id,
        question: q.question,
        reason: q.reason,
        impact: q.impact,
        options: q.options,
        multiple: q.multiple,
      },
    });
  }
  for (const suggestion of output.question_options) {
    if (suggestion.options.length === 0 && !suggestion.question) continue;
    const q = await trx
      .selectFrom('questions')
      .select(['state', 'exploration_id'])
      .where('id', '=', suggestion.question_id)
      .executeTakeFirst();
    if (q?.state !== 'pending') continue;
    await execute({
      ...base,
      command: 'question.suggest_options',
      actor: system('exploration'),
      entityId: suggestion.question_id,
      data: {
        options: suggestion.options,
        multiple: suggestion.multiple,
        ...(suggestion.question ? { question: suggestion.question } : {}),
        ...(suggestion.reason ? { reason: suggestion.reason } : {}),
      },
    });
  }
  // Only pending questions that were in this run's context pack get inferred, and only on the
  // person's own words: each quote has to be in one of their messages in this thread. An inference
  // with no quote found is dropped, so the question stays open and gets asked.
  const pending = new Set(content.questions.filter((q) => q.state === 'pending').map((q) => q.id));
  const said = await saidInThread(trx, scope.id);
  for (const inference of output.inferences) {
    if (!pending.has(inference.question_id)) continue;
    const evidence = inference.quotes.flatMap((quote) => findQuote(quote, said) ?? []);
    if (evidence.length === 0) continue;
    const q = await trx.selectFrom('questions').select('state').where('id', '=', inference.question_id).executeTakeFirst();
    if (q?.state !== 'pending') continue;
    await execute({
      ...base,
      command: 'question.infer',
      actor: system('exploration'),
      entityId: inference.question_id,
      data: { conclusion: inference.conclusion, reasoning: inference.reasoning, evidence },
    });
  }
  // After DEMIURGO's reply, the reserve shows the next questions while the thread has room.
  await revealQuestions(trx, scope.id);
  // A change to the definition rests, like an inference, on the person's words in this thread, and on
  // the version in force: without either, it is dropped.
  const proposals: { type: string; payload: unknown; dependencies?: unknown[] }[] = [];
  for (const p of output.proposals) {
    if (p.type !== 'definition_change') {
      const { type, ...payload } = p;
      proposals.push({ type, payload });
      continue;
    }
    const change = await definitionChangeProposal(trx, run.project_id, p, said);
    if (change) proposals.push(change);
  }
  if (proposals.length > 0) {
    await execute({
      ...base,
      command: 'batch.submit',
      actor,
      data: {
        summary: `Proposals from the exploration conversation (${proposals.length}).`,
        batch_type: 'agent',
        resolution: 'item',
        run_id: run.id,
        context_pack_id: run.context_pack_id ?? undefined,
        proposals,
      },
    });
  }
});
