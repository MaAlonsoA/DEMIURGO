// Global quality as the system proposes it. A confirmed answer keeps what the chosen option implies
// (its targets and figures), not only the short answer. When the Global quality stage is covered,
// the system proposes one quality requirement (NFR) per answer, with its measure; a person accepts
// or rejects each. Nothing here uses AI and nothing becomes authority on its own.

import { DEFINITION_STAGE, formatActor, system } from '@demiurgo/domain';
import type { CommandContext, Db } from '../bus/types.ts';

export const QUALITY_ACTOR = system('quality');
const QUALITY_STAGE = 'quality';
const SEP = ' · ';
const DASH = ' — ';

type Option = { answer: string; implies: string };

const ATTRIBUTES: Record<string, string> = {
  performance: 'Performance',
  availability: 'Availability and recovery',
  usability: 'Usability and accessibility',
  data: 'Data retention and ownership',
  quality_scenarios: 'Priority quality scenario',
};

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
  const picked = pickedOptions(conclusion, q.options, q.conversation_option);
  if (!picked) return conclusion;
  return picked.map((o) => (o.implies ? `${o.answer}${DASH}${o.implies}` : o.answer)).join('\n');
}

/** A conclusion split into what was chosen and what it implies (older conclusions match their options). */
function scenarioAndMeasure(conclusion: string, options: readonly Option[] | null, idea: Option | null) {
  const picked =
    pickedOptions(conclusion, options, idea) ??
    conclusion.split('\n').map((line) => {
      const i = line.indexOf(DASH);
      return i < 0 ? { answer: line, implies: '' } : { answer: line.slice(0, i), implies: line.slice(i + DASH.length) };
    });
  return {
    scenario: picked.map((o) => o.answer.trim()).join('\n'),
    measure: picked
      .map((o) => o.implies.trim())
      .filter(Boolean)
      .join('\n'),
  };
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Proposes one quality requirement per confirmed answer when the given stage is the covered Global quality stage. Once per project. */
export async function proposeQualityIfCovered(ctx: CommandContext, stageId: string | null | undefined): Promise<void> {
  const data = await qualityBatch(ctx.trx, ctx.projectId, stageId);
  if (!data) return;
  await ctx.execute({
    command: 'batch.submit',
    actor: QUALITY_ACTOR,
    projectId: ctx.projectId,
    cause: { sourceCommand: 'batch.submit' },
    data,
  });
}

/** The batch of quality requirements for a covered Global quality stage; null when it isn't covered or was already proposed. */
export async function qualityBatch(trx: Db, projectId: string, stageId: string | null | undefined) {
  if (!stageId) return null;
  const stage = await trx.selectFrom('stages').select('stage').where('id', '=', stageId).executeTakeFirst();
  if (stage?.stage !== QUALITY_STAGE) return null;
  const questions = await trx
    .selectFrom('questions')
    .select(['stage_key', 'state', 'conclusion', 'options', 'conversation_option'])
    .where('stage_id', '=', stageId)
    .where('stage_key', 'is not', null)
    .execute();
  if (questions.some((q) => q.state !== 'confirmed')) return null;
  const proposed = await trx
    .selectFrom('proposal_batches')
    .select('id')
    .where('project_id', '=', projectId)
    .where('producer', '=', formatActor(QUALITY_ACTOR))
    .executeTakeFirst();
  if (proposed) return null;
  const proposals = questions.flatMap((q) => {
    const conclusion = q.conclusion?.trim();
    if (!conclusion) return [];
    const attribute = ATTRIBUTES[q.stage_key ?? ''] ?? 'Quality';
    const { scenario, measure } = scenarioAndMeasure(conclusion, q.options, q.conversation_option);
    const target = measure || 'No measure was given: set one before accepting.';
    return [
      {
        type: 'design_record',
        payload: {
          record_type: 'quality_requirement',
          title: cut(`${attribute}: ${scenario.split('\n')[0] ?? ''}`, 200),
          sections: [
            { title: 'Quality attribute', content: attribute },
            { title: 'Scenario', content: scenario },
            { title: 'Measure', content: target },
          ],
          criteria: [
            {
              title: cut(`${attribute} targets are met`, 160),
              statement: cut(target, 1500),
              verification: 'manual',
              check: cut(`Check the product against each target: ${target}`, 600),
            },
          ],
        },
        dependencies: [],
      },
    ];
  });
  if (proposals.length === 0) return null;
  return {
    summary: 'The quality requirements (NFR), one per Global quality answer you confirmed.',
    batch_type: 'system_package' as const,
    resolution: 'item' as const,
    proposals,
  };
}
