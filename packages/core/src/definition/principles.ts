// The stages of principles (domain/stages.ts: Global quality, Architecture and security principles)
// as the system proposes them. A confirmed answer keeps what the chosen option implies (its targets
// and figures), not only the short answer. When such a stage is covered, its answers become one
// section of the product definition, proposed as its next version: principles, not a batch of
// decisions to review one by one. Nothing here uses AI and nothing becomes authority on its own.

import {
  COVERED_QUESTION_STATES,
  DEFINITION_STAGE,
  DEFINITION_TITLE,
  type Section,
  definitionChangeNote,
  stageDefinition,
} from '@demiurgo/domain';
import type { CommandContext, Db } from '../bus/types.ts';
import { DEFINITION_ACTOR, versionSources } from './compose.ts';

const SEP = ' · ';

type Option = { answer: string; implies: string };

/** The options a conclusion picks (the side conversation's idea, one option or, joined, several); null for own words. */
function pickedOptions(conclusion: string, options: readonly Option[] | null, idea: Option | null): Option[] | null {
  if (idea && conclusion === idea.answer) return [idea];
  const parts = conclusion.split(SEP);
  const picked = parts.map((p) => options?.find((o) => o.answer === p));
  return picked.every((o) => o) ? (picked as Option[]) : null;
}

/** The conclusion a stage question keeps: each picked option with what it implies. Own words stay as they are. */
export async function conclusionWithImplies(trx: Db, questionId: string, conclusion: string): Promise<string> {
  const q = await trx
    .selectFrom('questions')
    .leftJoin('stages', 'stages.id', 'questions.stage_id')
    .select(['questions.options', 'questions.conversation_option', 'stages.stage'])
    .where('questions.id', '=', questionId)
    .executeTakeFirst();
  // The product definition composes its sections from the short answers.
  if (!q?.stage || q.stage === DEFINITION_STAGE) return conclusion;
  // Each measurable goal is also a quality requirement (NFR) with its scenario and measure (decision
  // of the mission, VISION.md Arranque), so the section keeps only the answer the person chose: the
  // option's explanation could read as a different commitment (seen: «…rather than prescribing
  // indefinite retention» after choosing «no automatic expiry»).
  const picked = pickedOptions(conclusion, q.options, q.conversation_option);
  if (!picked) return conclusion;
  return picked.map((o) => o.answer).join('\n');
}

/** Proposes the definition's next version with a covered stage's principles. */
export async function proposePrinciplesIfCovered(
  ctx: CommandContext,
  stageId: string | null | undefined,
  options: { resolving?: string } = {},
): Promise<void> {
  const data = await principlesBatch(ctx.trx, ctx.projectId, stageId, options.resolving);
  if (!data) return;
  await ctx.execute({
    command: 'batch.submit',
    actor: DEFINITION_ACTOR,
    projectId: ctx.projectId,
    cause: { sourceCommand: 'batch.submit' },
    data,
  });
}

/** Every opened stage of principles that is covered and not in the definition yet (after a definition is resolved). */
export async function proposeCoveredPrinciples(ctx: CommandContext, resolving?: string): Promise<void> {
  const stages = await ctx.trx.selectFrom('stages').select(['id', 'stage']).where('project_id', '=', ctx.projectId).execute();
  for (const s of stages) if (stageDefinition(s.stage)?.principles) await proposePrinciplesIfCovered(ctx, s.id, { resolving });
}

/**
 * The batch with the definition's next version carrying a stage's principles; null when the stage
 * isn't one of principles or isn't covered, there is no definition yet, another definition waits for
 * the person, or the section already says it.
 */
export async function principlesBatch(trx: Db, projectId: string, stageId: string | null | undefined, resolving?: string) {
  if (!stageId) return null;
  const stage = await trx.selectFrom('stages').select('stage').where('id', '=', stageId).executeTakeFirst();
  const def = stage ? stageDefinition(stage.stage) : undefined;
  if (!def?.principles) return null;
  const questions = await trx
    .selectFrom('questions')
    .select(['id', 'stage_key', 'state', 'conclusion', 'state_reason'])
    .where('stage_id', '=', stageId)
    .where('stage_key', 'is not', null)
    .execute();
  if (questions.length === 0 || questions.some((q) => !(COVERED_QUESTION_STATES as readonly string[]).includes(q.state)))
    return null;
  let pendingQuery = trx
    .selectFrom('proposals')
    .select('id')
    .where('project_id', '=', projectId)
    .where('type', '=', 'product_definition')
    .where('state', '=', 'pending');
  if (resolving) pendingQuery = pendingQuery.where('id', '<>', resolving);
  if (await pendingQuery.executeTakeFirst()) return null;
  const record = await trx
    .selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', projectId)
    .where('type', '=', 'product_definition')
    .executeTakeFirst();
  if (!record) return null;
  const base = await trx
    .selectFrom('record_versions')
    .select(['n', 'sections', 'origin'])
    .where('record_id', '=', record.id)
    .where('state', '<>', 'discarded')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  if (!base) return null;
  const lines = def.questions.flatMap((dq) => {
    const q = questions.find((x) => x.stage_key === dq.key);
    if (!q) return [];
    const label = dq.label ?? dq.key;
    if (q.state === 'discarded') return [`${label}: left open${q.state_reason?.trim() ? ` (${q.state_reason.trim()})` : ''}.`];
    const answer = (q.conclusion ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('; ');
    return [`${label}: ${answer || 'confirmed without an answer.'}`];
  });
  const content = lines.join('\n');
  const previous = base.sections as Section[];
  if (previous.find((s) => s.title === def.principles)?.content.trim() === content) return null;
  const sections = previous.some((s) => s.title === def.principles)
    ? previous.map((s) => (s.title === def.principles ? { title: s.title, content } : s))
    : [...previous, { title: def.principles, content }];
  const sources = [
    ...(await versionSources(trx, base.origin)).filter((s) => s.section !== def.principles),
    ...def.questions.flatMap((dq) => {
      const q = questions.find((x) => x.stage_key === dq.key);
      return q
        ? [{ section: def.principles as string, key: dq.key, question_id: q.id, state: q.state as 'confirmed' | 'discarded' }]
        : [];
    }),
  ];
  return {
    summary: `A new version of the product definition: ${def.principles}.`,
    batch_type: 'system_package' as const,
    resolution: 'item' as const,
    proposals: [
      {
        type: 'product_definition',
        payload: {
          record: { code: record.code, version: base.n },
          title: DEFINITION_TITLE,
          sections,
          sources,
          change_note: definitionChangeNote([{ section: def.principles, why: `the ${def.title} answers were confirmed.` }]),
        },
        dependencies: [{ type: 'record', id: record.id, code: record.code, version: base.n }],
      },
    ],
  };
}
