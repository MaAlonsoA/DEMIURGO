// The product definition (domain/definition.ts) as the system proposes it. When the product
// definition stage is covered, the system composes the definition from the confirmed answers and
// proposes it; a person accepts it. When an answer changes later (the question is reopened and
// confirmed again), it proposes the next version with what changed and why. Answers are already in
// English when they get here (definition/english.ts). Nothing here uses AI and nothing becomes
// authority on its own.

import {
  DEFINITION_SECTIONS,
  DEFINITION_STAGE,
  type DefinitionSectionTitle,
  type DefinitionSource,
  type Section,
  composeDefinition,
  definitionChangeNote,
  definitionChanges,
  findQuote,
  system,
} from '@demiurgo/domain';
import type { CommandContext, Db } from '../bus/types.ts';

export const DEFINITION_ACTOR = system('definition');

/** The project's product definition stage, if it has been opened. */
export async function definitionStageId(trx: Db, projectId: string): Promise<string | null> {
  const stage = await trx
    .selectFrom('stages')
    .select('id')
    .where('project_id', '=', projectId)
    .where('stage', '=', DEFINITION_STAGE)
    .executeTakeFirst();
  return stage?.id ?? null;
}

/** The sources a version was proposed with (its proposal's), or none when it came another way. */
export async function versionSources(trx: Db, origin: unknown): Promise<DefinitionSource[]> {
  const o = origin as { type?: string; id?: string } | null;
  if (o?.type !== 'proposal' || !o.id) return [];
  const p = await trx.selectFrom('proposals').select(['type', 'payload']).where('id', '=', o.id).executeTakeFirst();
  if (p?.type !== 'product_definition') return [];
  return ((p.payload as { sources?: DefinitionSource[] }).sources ?? []).slice();
}

export type ProposeOptions = {
  /** The definition proposal being accepted right now: it is still pending until the command ends. */
  resolving?: string;
  /** Called by the acceptance of a change proposed in a thread, once it wrote the next version itself. */
  afterChange?: boolean;
};

/**
 * Proposes the definition (or its next version) when the given stage is the covered definition stage.
 * Within the acceptance of a change proposed in a thread (`definition_change`) it waits: that
 * acceptance writes the next version itself and then calls it with `afterChange`.
 */
export async function proposeDefinitionIfCovered(
  ctx: CommandContext,
  stageId: string | null | undefined,
  options: ProposeOptions = {},
): Promise<void> {
  if (!stageId) return;
  if (!options.afterChange && (await acceptingChange(ctx))) return;
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
  let pendingQuery = ctx.trx
    .selectFrom('proposals')
    .select('id')
    .where('project_id', '=', ctx.projectId)
    .where('type', '=', 'product_definition')
    .where('state', '=', 'pending');
  if (options.resolving) pendingQuery = pendingQuery.where('id', '<>', options.resolving);
  const pending = await pendingQuery.executeTakeFirst();
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
        .select(['n', 'sections', 'origin'])
        .where('record_id', '=', record.id)
        .where('state', '<>', 'discarded')
        .orderBy('n', 'desc')
        .executeTakeFirst()
    : undefined;
  let changeNote: string | undefined;
  let summary = 'The product definition, composed from the answers you confirmed.';
  if (record && base) {
    // The sections a stage of principles added (principles.ts) stay as they are, with their sources.
    const own = new Set<string>(DEFINITION_SECTIONS.map((s) => s.title));
    composed.sections.push(...(base.sections as Section[]).filter((s) => !own.has(s.title)));
    composed.sources.push(...(await versionSources(ctx.trx, base.origin)).filter((s) => !own.has(s.section)));
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

/** Whether the command runs within the acceptance of a change to the definition proposed in a thread. */
async function acceptingChange(ctx: CommandContext): Promise<boolean> {
  if (!ctx.cause.proposal) return false;
  const p = await ctx.trx.selectFrom('proposals').select('type').where('id', '=', ctx.cause.proposal).executeTakeFirst();
  return p?.type === 'definition_change';
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

export type ProposedChange = { section: DefinitionSectionTitle; content: string; reason: string; quotes: readonly string[] };

/**
 * The proposal of a change to the definition an agent returned in a thread, ready for its batch; null
 * when it can't stand: there is no approved definition, the section was never asked, the text is
 * what it already says, or none of its quotes is in what the person wrote in the thread (`said`).
 */
export async function definitionChangeProposal(
  trx: Db,
  projectId: string,
  change: ProposedChange,
  said: readonly { id: string; body: string }[],
): Promise<{ type: 'definition_change'; payload: unknown; dependencies: unknown[] } | null> {
  const evidence = change.quotes.flatMap((quote) => findQuote(quote, said) ?? []);
  if (evidence.length === 0) return null;
  const current = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'record_versions.n', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'product_definition')
    .where('record_versions.state', '=', 'approved')
    .orderBy('record_versions.n', 'desc')
    .executeTakeFirst();
  if (!current) return null;
  const now = (current.sections as Section[]).find((s) => s.title === change.section)?.content;
  if (now?.trim() === change.content.trim()) return null;
  const key = DEFINITION_SECTIONS.find((s) => s.title === change.section)?.key;
  const stageId = await definitionStageId(trx, projectId);
  const asked =
    stageId && key
      ? await trx
          .selectFrom('questions')
          .select('id')
          .where('stage_id', '=', stageId)
          .where('stage_key', '=', key)
          .executeTakeFirst()
      : undefined;
  if (!asked) return null;
  return {
    type: 'definition_change',
    payload: {
      record: { code: current.code, version: current.n },
      section: change.section,
      content: change.content,
      reason: change.reason,
      evidence,
    },
    // Changing the version in force: if the definition changes first, this one is out of date.
    dependencies: [{ type: 'record', id: current.recordId, code: current.code, version: current.n }],
  };
}

/**
 * One turn of the explorer yields at most one `definition_change` per section (two would compete
 * to rewrite the same text and the second would be out of date once the first is approved): the
 * last wins, with the quotes of all of them. Order of the rest is kept.
 */
export function dedupeDefinitionChanges<T extends { type: string }>(proposals: readonly T[]): T[] {
  const last = new Map<string, number>();
  proposals.forEach((p, i) => {
    if (p.type === 'definition_change') last.set((p as unknown as ProposedChange).section, i);
  });
  return proposals.flatMap((p, i) => {
    if (p.type !== 'definition_change') return [p];
    const c = p as unknown as ProposedChange;
    if (last.get(c.section) !== i) return [];
    const quotes = [
      ...new Set(
        proposals.flatMap((q) =>
          q.type === 'definition_change' && (q as unknown as ProposedChange).section === c.section
            ? (q as unknown as ProposedChange).quotes
            : [],
        ),
      ),
    ];
    return [{ ...p, quotes }];
  });
}
