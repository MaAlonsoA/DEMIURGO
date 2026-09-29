// exploration_chat action: an exploration conversation. The builder deterministically gathers
// what's on record; the applier turns the validated output into messages, questions,
// inferences and a batch of proposals. None of this touches authority.
// While it gathers, the builder writes the manifest (observability §9): every message, question,
// decision, source and knowledge node it weighed, with the journal event or version it derives
// from and what happened to it. The pack itself is the same as `exploration_chat@1` produced.

import {
  COVERED_QUESTION_STATES,
  DomainError,
  STAGES,
  type Section,
  findQuote,
  stageDefinition,
  system,
} from '@demiurgo/domain';
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
  // After the onboarding (every onboarding stage passed in this thread) and before any feature
  // exists, the next step is designing the first feature: the explorer offers where to start.
  const nextStep = stage ? null : await firstFeatureStep(trx, projectId, exploration.id, input.onboarding_done === true);
  if (nextStep)
    manifest.entered({
      section: 'design_stage',
      source: source('exploration', exploration.id),
      text: 'Onboarding done: design the first feature',
      reason: 'next_step:first_feature',
    });
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
  const aboutColumns = [
    'records.id as recordId',
    'records.code',
    'records.type',
    'records.domain',
    'record_versions.id',
    'record_versions.n',
    'record_versions.state',
    'record_versions.title',
    'record_versions.sections',
  ] as const;
  const opened =
    exploration.origin_type === 'record_version' && exploration.origin_id
      ? await trx
          .selectFrom('record_versions')
          .innerJoin('records', 'records.id', 'record_versions.record_id')
          .select(aboutColumns)
          .where('record_versions.id', '=', exploration.origin_id)
          .where('records.project_id', '=', projectId)
          .executeTakeFirst()
      : undefined;
  // The latest version (a draft or approved), when it is newer than the one the thread was opened on
  // (a change it proposed was accepted or approved): the agent reads, and proposes changes to, what
  // the record says now.
  const inForce = opened
    ? await trx
        .selectFrom('record_versions')
        .innerJoin('records', 'records.id', 'record_versions.record_id')
        .select(aboutColumns)
        .where('record_versions.record_id', '=', opened.recordId)
        .where('record_versions.state', 'in', ['approved', 'draft'])
        .where('record_versions.n', '>', opened.n)
        .orderBy('record_versions.n', 'desc')
        .executeTakeFirst()
    : undefined;
  const about = inForce ?? opened;
  // The features an epic lists that are still in its list, in order: planned or already designed.
  const epicFeatures =
    about?.type === 'epic'
      ? await trx
          .selectFrom('planned_features')
          .select(['code', 'name', 'summary', 'position', 'state'])
          .where('epic_id', '=', about.recordId)
          .where('state', '<>', 'dropped')
          .orderBy('position')
          .orderBy('created_at')
          .execute()
      : null;
  const aboutRecord = about
    ? {
        code: about.code,
        type: about.type,
        // The name an epic's features share: the `domain` their proposals carry.
        domain: about.domain,
        version: about.n,
        state: about.state,
        title: about.title,
        sections: about.sections as { title: string; content: string }[],
        ...(epicFeatures ? { features: epicFeatures } : {}),
      }
    : null;
  // A feature thread (`Design "<name>" (FDR-…, EPC-…): …`): the planned feature it designs, while it is planned.
  const plannedCode = /\bFDR-[A-Z]{3}-\d{3}\b/.exec(exploration.purpose)?.[0];
  const planned = plannedCode ? await plannedFeatureByCode(trx, projectId, plannedCode) : undefined;
  const plannedFeature =
    planned?.state === 'planned' ? { code: planned.code, name: planned.name, summary: planned.summary } : null;
  if (plannedFeature)
    manifest.entered({
      section: 'planned_feature',
      source: source('exploration', exploration.id),
      text: JSON.stringify(plannedFeature),
      reason: 'thread purpose',
    });
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
  // The design records the person accepted (product definition, requirements, NFRs, ADRs, threat
  // model...), their latest version, approved or still a draft: each stage builds on the ones before.
  const approved = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type', 'record_versions.n', 'record_versions.state', 'record_versions.title', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.type', 'in', ['product_definition', 'epic', 'fdr', 'requirement', 'quality_requirement', 'adr', 'threat_model', 'production_readiness'])
    .where('record_versions.state', 'in', ['approved', 'draft'])
    .orderBy('records.code')
    .orderBy('record_versions.n', 'desc')
    .execute();
  const latest = approved.filter((r, i) => approved.findIndex((o) => o.recordId === r.recordId) === i);
  const recordSplit = splitByBudget(
    latest.map((r) => {
      const full = (r.sections as { title: string; content: string }[]).map((x) => `${x.title}: ${x.content}`).join('\n');
      return { code: r.code, type: r.type, version: r.n, state: r.state, title: r.title, content: full.slice(0, LIMIT.recordChars), recordId: r.recordId, fullChars: full.length };
    }),
    (r) => r.title.length + r.content.length,
    BUDGET.records,
  );
  const designRecords = recordSplit.chosen.map(({ code, type, version, state, title, content }) => ({ code, type, version, state, title, content }));
  for (const r of recordSplit.chosen)
    manifest.entered({
      section: 'design_records',
      source: source('record', r.recordId, r.version),
      text: r.content,
      originalChars: r.fullChars,
      reason: r.fullChars > r.content.length ? `excerpt:${LIMIT.recordChars}` : r.state,
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
        ...(nextStep ? { next_step: nextStep } : {}),
        ...(aboutRecord ? { about_record: aboutRecord } : {}),
        ...(plannedFeature ? { planned_feature: plannedFeature } : {}),
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

/**
 * The step after the onboarding, while no feature exists yet: the thread that hosted the onboarding
 * stages, all of them passed. `feature_threads` are the threads already opened from it, so the
 * explorer doesn't offer them again.
 */
async function firstFeatureStep(trx: Tx, projectId: string, explorationId: string, justArrived: boolean) {
  const onboarding = STAGES.filter((s) => s.moment === 'onboarding').map((s) => s.key);
  const passed = await trx
    .selectFrom('stages')
    .select('stage')
    .where('project_id', '=', projectId)
    .where('exploration_id', '=', explorationId)
    .where('state', '=', 'passed')
    .execute();
  if (!onboarding.every((k) => passed.some((p) => p.stage === k))) return null;
  const feature = await trx
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', projectId)
    .where('type', 'in', ['epic', 'fdr', 'requirement'])
    .executeTakeFirst();
  if (feature) return null;
  const children = await trx
    .selectFrom('explorations')
    .select('purpose')
    .where('parent_id', '=', explorationId)
    .where('state', '=', 'active')
    .orderBy('created_at')
    .execute();
  return {
    step: 'design_first_feature',
    just_arrived: justArrived,
    feature_threads: children.map((c) => c.purpose),
  };
}

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
    ...output.proposals.flatMap((p) => ('quotes' in p ? p.quotes : [])),
  ];
  const notes = quotes
    .filter((quote) => !findQuote(quote, said))
    .map(
      (quote) =>
        `The quote "${quote}" is not in what the person wrote in this thread. Copy their words exactly as they wrote them, or leave the quote out.`,
    );
  // A change to a record only lands on the one the thread is about, on a section it has.
  const changes = output.proposals.filter((p) => p.type === 'record_change');
  if (changes.length > 0) {
    const target = await recordChangeTarget(db, run.project_id, (run.scope as { id: string }).id);
    for (const c of changes) {
      if (!target || c.code !== target.code)
        notes.push(
          `A record_change only applies to the record this thread is about${target ? ` (${target.code})` : ', and this thread is not about an approved record'}, not to ${c.code}.`,
        );
      else if (!target.sections.some((x) => x.title === c.section))
        notes.push(
          `${target.code} has no section titled "${c.section}": its sections are ${target.sections.map((x) => `"${x.title}"`).join(', ')}.`,
        );
    }
  }
  for (const p of output.proposals) {
    if (p.type === 'feature_plan') {
      const problem = await featurePlanProblem(db, run.project_id, (run.scope as { id: string }).id, p);
      if (problem) notes.push(problem);
      continue;
    }
    if (p.type !== 'design_record') continue;
    if (p.record_type === 'epic' && p.sections.some(isFeaturesSection))
      notes.push(
        'An epic has no "Features" section: its features go in `features` (each with a `name` and a `summary`), never as text in a section. The section was left out.',
      );
    if (p.features && p.record_type !== 'epic')
      notes.push('`features` is only for an epic (`record_type` `epic`): leave it null for any other record.');
    if (p.code && p.record_type !== 'fdr')
      notes.push(
        '`code` is only for a feature (`record_type` `fdr`) designed from a planned feature: leave it null for any other record.',
      );
    if (p.code && p.record_type === 'fdr' && (await plannedFeatureByCode(db, run.project_id, p.code))?.state !== 'planned')
      notes.push(
        `${p.code} in \`code\` is not a planned feature of this project (it may be designed or dropped already). \`code\` is the \`planned_feature.code\` of the context: leave it null otherwise.`,
      );
    if (p.record_type !== 'fdr' || !p.needs) continue;
    const found = await neededFeatures(db, run.project_id, p.needs);
    for (const n of p.needs)
      if (!found.some((f) => f.code === n.code && f.version === n.version))
        notes.push(
          `${n.code} v${n.version} in \`needs\` is not an approved feature at that version. \`needs\` only names approved features listed in design_records, with their current version.`,
        );
  }
  return notes;
});

/** An epic's features are its planned features, never a section of text. */
const isFeaturesSection = (s: { title: string }) => s.title.trim().toLowerCase() === 'features';

/** A feature an epic lists (reserved code, name, sentence and state), by its code. */
async function plannedFeatureByCode(db: Db, projectId: string, code: string) {
  return db
    .selectFrom('planned_features')
    .select(['id', 'code', 'name', 'summary', 'state', 'epic_id'])
    .where('project_id', '=', projectId)
    .where('code', '=', code)
    .executeTakeFirst();
}

/** The record a thread was opened on (a version of it), whatever that version's state. */
async function threadRecord(db: Db, projectId: string, explorationId: string) {
  const thread = await db
    .selectFrom('explorations')
    .select(['origin_type', 'origin_id'])
    .where('id', '=', explorationId)
    .executeTakeFirst();
  if (thread?.origin_type !== 'record_version' || !thread.origin_id) return null;
  const record = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type'])
    .where('record_versions.id', '=', thread.origin_id)
    .where('records.project_id', '=', projectId)
    .executeTakeFirst();
  return record ?? null;
}

type FeaturePlan = {
  epic: string;
  action: 'add' | 'drop' | 'move';
  code: string | null;
  name: string | null;
  summary: string | null;
  position: number | null;
};

/**
 * Why a change to an epic's list of features can't stand, in words the agent reads; null when it can.
 * It lands on the epic the thread is about (a draft or approved one), on a feature of its list that
 * is there (a drop, only while it is still planned), with what the action needs.
 */
async function featurePlanProblem(db: Db, projectId: string, explorationId: string, plan: FeaturePlan): Promise<string | null> {
  const target = await threadRecord(db, projectId, explorationId);
  if (target?.type !== 'epic') return 'A feature_plan only applies to an epic, and this thread is not about one.';
  if (plan.epic !== target.code)
    return `A feature_plan only applies to the epic this thread is about (${target.code}), not to ${plan.epic}.`;
  if (plan.action === 'add')
    return plan.name && plan.summary
      ? null
      : 'Adding a feature needs its `name` and its `summary` (one sentence of what it lets the person do).';
  if (!plan.code) return `A ${plan.action} needs the \`code\` of the feature: one of \`about_record.features\`.`;
  const feature = await plannedFeatureByCode(db, projectId, plan.code);
  if (!feature || feature.epic_id !== target.recordId || feature.state === 'dropped')
    return `${plan.code} is not in the list of ${target.code}: its features are in \`about_record.features\`.`;
  if (plan.action === 'drop' && feature.state !== 'planned')
    return `${plan.code} is already designed, so it can't be dropped from the list: only a feature that is still planned can.`;
  if (plan.action === 'move' && plan.position === null) return 'A move needs the new `position` of the feature.';
  return null;
}

/**
 * The proposal of a change to the epic's list of features, ready for its batch; null when it can't
 * stand (see `featurePlanProblem`) or none of its quotes is in what the person wrote in the thread.
 */
async function featurePlanProposal(
  trx: Db,
  projectId: string,
  explorationId: string,
  plan: FeaturePlan & { reason: string; quotes: readonly string[] },
  said: readonly { id: string; body: string }[],
) {
  const evidence = plan.quotes.flatMap((quote) => findQuote(quote, said) ?? []);
  if (evidence.length === 0) return null;
  if (await featurePlanProblem(trx, projectId, explorationId, plan)) return null;
  // A drop or a move carries the feature's name as it is now, so the card says which one it is.
  const named = plan.action !== 'add' && plan.code ? (await plannedFeatureByCode(trx, projectId, plan.code))?.name : undefined;
  const only =
    plan.action === 'add'
      ? { name: plan.name, summary: plan.summary, ...(plan.position !== null ? { position: plan.position } : {}) }
      : plan.action === 'drop'
        ? { code: plan.code, ...(named ? { name: named } : {}) }
        : { code: plan.code, ...(named ? { name: named } : {}), position: plan.position };
  return {
    type: 'feature_plan',
    payload: { epic: { code: plan.epic }, action: plan.action, ...only, reason: plan.reason, evidence },
  };
}

/** The approved features (at that version) among the references an agent gave as what a feature needs. */
async function neededFeatures(db: Db, projectId: string, refs: readonly { code: string; version: number }[]) {
  const found: { id: string; code: string; version: number }[] = [];
  for (const ref of refs) {
    if (found.some((f) => f.code === ref.code)) continue;
    const feature = await db
      .selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select('records.id')
      .where('records.project_id', '=', projectId)
      .where('records.type', '=', 'fdr')
      .where('records.code', '=', ref.code)
      .where('record_versions.n', '=', ref.version)
      .where('record_versions.state', '=', 'approved')
      .executeTakeFirst();
    if (feature) found.push({ id: feature.id, code: ref.code, version: ref.version });
  }
  return found;
}

/**
 * The record the thread is about, at the version in force: where a `record_change` can land. Null
 * when the thread is not about a record, the record has no approved version or it is the product
 * definition (whose changes go through `definition_change`).
 */
async function recordChangeTarget(db: Db, projectId: string, explorationId: string) {
  const record = await threadRecord(db, projectId, explorationId);
  if (!record || record.type === 'product_definition') return null;
  const current = await db
    .selectFrom('record_versions')
    .select(['n', 'sections'])
    .where('record_id', '=', record.recordId)
    .where('state', '=', 'approved')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  if (!current) return null;
  return { recordId: record.recordId, code: record.code, version: current.n, sections: current.sections as Section[] };
}

/**
 * The proposal of a change to a section of the record the thread is about, ready for its batch; null
 * when it can't stand: another record, no approved version, a section it doesn't have, the text it
 * already says, or none of its quotes in what the person wrote in the thread (`said`).
 */
async function recordChangeProposal(
  trx: Db,
  projectId: string,
  explorationId: string,
  change: { code: string; section: string; content: string; reason: string; quotes: readonly string[] },
  said: readonly { id: string; body: string }[],
) {
  const evidence = change.quotes.flatMap((quote) => findQuote(quote, said) ?? []);
  if (evidence.length === 0) return null;
  const target = await recordChangeTarget(trx, projectId, explorationId);
  if (!target || target.code !== change.code) return null;
  const now = target.sections.find((s) => s.title === change.section)?.content;
  if (now === undefined || now.trim() === change.content.trim()) return null;
  return {
    type: 'record_change',
    payload: {
      record: { code: target.code, version: target.version },
      section: change.section,
      content: change.content,
      reason: change.reason,
      evidence,
    },
    // Changing the version in force: if the record changes first, this one is out of date.
    dependencies: [{ type: 'record', id: target.recordId, code: target.code, version: target.version }],
  };
}

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
    if (p.type === 'exploration') {
      const { type, ...payload } = p;
      proposals.push({ type, payload });
      continue;
    }
    if (p.type === 'record_change') {
      const change = await recordChangeProposal(trx, run.project_id, scope.id, p, said);
      if (change) proposals.push(change);
      continue;
    }
    if (p.type === 'feature_plan') {
      const plan = await featurePlanProposal(trx, run.project_id, scope.id, p, said);
      if (plan) proposals.push(plan);
      continue;
    }
    if (p.type !== 'definition_change') {
      // "Based on": the person's words it rests on and the question being talked about.
      const { type, quotes, ...fields } = p;
      // Fields the agent leaves null (an epic's name, a feature's epic) are left out of the payload.
      const payload = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
      // A feature's needs: approved features only; the ones that aren't are dropped (the checker told the agent).
      const needs = p.type === 'design_record' && p.record_type === 'fdr' ? await neededFeatures(trx, run.project_id, p.needs ?? []) : [];
      delete payload.needs;
      if (p.type === 'design_record') {
        // An epic has no "Features" section: they travel in `features` (unless that would leave it without sections).
        const kept = p.sections.filter((s) => !isFeaturesSection(s));
        if (p.record_type === 'epic' && kept.length > 0) payload.sections = kept;
        // An epic's features only travel with an epic; a feature's planned code only with a planned feature of this project.
        if (p.record_type !== 'epic' || !p.features?.length) delete payload.features;
        if (p.record_type !== 'fdr' || !p.code || (await plannedFeatureByCode(trx, run.project_id, p.code))?.state !== 'planned')
          delete payload.code;
      }
      const basis = [
        ...quotes.flatMap((quote) => {
          const found = findQuote(quote, said);
          return found ? [{ type: 'message' as const, id: found.message_id, quote: found.quote }] : [];
        }),
        ...(questionId ? [{ type: 'question' as const, id: questionId }] : []),
      ];
      proposals.push({
        type,
        payload: {
          ...payload,
          ...(needs.length > 0 ? { needs: needs.map((n) => ({ code: n.code, version: n.version })) } : {}),
          ...(basis.length > 0 ? { basis } : {}),
        },
        // Each needed feature, like the epic it is based on, must still be at that version when it is accepted.
        ...(needs.length > 0 ? { dependencies: needs.map((n) => ({ type: 'record', ...n })) } : {}),
      });
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
