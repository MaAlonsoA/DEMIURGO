// feature_design action: a dedicated agent designs the planned feature of a thread, or says it is too
// big and must be split. The checker is the programmatic gate after the model call (Anthropic,
// "Building effective agents"): what it finds goes back to the agent once (engine.ts `corrected`).

import { DomainError, MAIN_FLOW_STEPS } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import type { Db } from '../db/connection.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { criterionPayload, relabelPack, sourcesPayload, threadBasis, withSection } from './drafting.ts';
import { explorationPack, neededFeatures, plannedFeatureByCode } from './exploration-chat.ts';

const BUILDER = 'feature_design@1';

/** The feature a thread designs (its purpose names its reserved code) and the epic it belongs to, or why there is none to design. */
type Designable =
  | { problem: string }
  | {
      problem?: undefined;
      planned: { id: string; code: string; name: string; summary: string; position: number; epicId: string };
      epic: { id: string; code: string; domain: string; version: number; title: string };
    };

async function featureOfThread(db: Db, projectId: string, explorationId: string): Promise<Designable> {
  const thread = await db.selectFrom('explorations').select('purpose').where('id', '=', explorationId).executeTakeFirst();
  const code = /\bFDR-[A-Z]{3}-\d{3}\b/.exec(thread?.purpose ?? '')?.[0];
  const found = code ? await plannedFeatureByCode(db, projectId, code) : undefined;
  if (!found) return { problem: 'This thread does not design a planned feature of an epic.' };
  if (found.state !== 'planned')
    return { problem: `${found.code} is already ${found.state === 'designed' ? 'designed' : 'dropped'}: only a planned feature is designed.` };
  const planned = await db.selectFrom('planned_features').select(['position']).where('id', '=', found.id).executeTakeFirstOrThrow();
  const epic = await db
    .selectFrom('records')
    .innerJoin('record_versions', 'record_versions.record_id', 'records.id')
    .select(['records.id', 'records.code', 'records.domain', 'record_versions.n', 'record_versions.title'])
    .where('records.id', '=', found.epic_id)
    .where('record_versions.state', '=', 'approved')
    .orderBy('record_versions.n', 'desc')
    .executeTakeFirst();
  if (!epic) return { problem: 'The epic of this feature is not approved yet: it has to be approved before a feature is designed.' };
  return {
    planned: { id: found.id, code: found.code, name: found.name, summary: found.summary, position: planned.position, epicId: found.epic_id },
    epic: { id: epic.id, code: epic.code, domain: epic.domain ?? '', version: epic.n, title: epic.title },
  };
}

registerBuilder('feature_design', async (a) => {
  if (a.scope.type !== 'exploration' || !a.scope.id) throw new DomainError('validation', 'A feature is designed from its thread.');
  const f = await featureOfThread(a.trx, a.projectId, a.scope.id);
  if (f.problem !== undefined) throw new DomainError('validation', f.problem);
  const built = relabelPack(await explorationPack(a), BUILDER);
  // The epic's list with what each sibling has: its approved version is what `needs` refers to.
  const siblings = await a.trx
    .selectFrom('planned_features')
    .select(['code', 'name', 'summary', 'state'])
    .where('epic_id', '=', f.planned.epicId)
    .where('state', '<>', 'dropped')
    .where('code', '<>', f.planned.code)
    .orderBy('position')
    .execute();
  const versions = await a.trx
    .selectFrom('records')
    .innerJoin('record_versions', 'record_versions.record_id', 'records.id')
    .select(['records.code', 'record_versions.n'])
    .where('records.project_id', '=', a.projectId)
    .where('records.type', '=', 'fdr')
    .where('record_versions.state', '=', 'approved')
    .orderBy('record_versions.n', 'desc')
    .execute();
  const feature_design = {
    epic: { code: f.epic.code, version: f.epic.version, domain: f.epic.domain, title: f.epic.title },
    planned_feature: { code: f.planned.code, name: f.planned.name, summary: f.planned.summary },
    siblings: siblings.map((s) => ({
      ...s,
      approved_version: versions.find((v) => v.code === s.code)?.n ?? null,
    })),
  };
  return withSection(built, 'feature_design', feature_design, { type: 'exploration', id: a.scope.id, version: null, eventSeq: null }, 'planned feature and its siblings');
});

registerChecker('feature_design', async ({ db, run, output }) => {
  const f = await featureOfThread(db, run.project_id, (run.scope as { id: string }).id);
  if (f.problem !== undefined) return [f.problem];
  const notes: string[] = [];
  const result = output.result;
  if (result.kind === 'split') {
    const names = result.features.map((x) => x.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) notes.push('Two of the features of the split have the same name.');
    return notes;
  }
  const { steps, criteria, needs } = result.feature;
  if (steps.length < MAIN_FLOW_STEPS.min || steps.length > MAIN_FLOW_STEPS.max)
    notes.push(
      `The main success scenario has ${steps.length} steps; it has ${MAIN_FLOW_STEPS.min} to ${MAIN_FLOW_STEPS.max} (Cockburn). Merge or split steps, or, if it needs more, it is too big: answer with kind "split".`,
    );
  for (const c of criteria)
    if (c.step > steps.length)
      notes.push(`The criterion "${c.title}" sets \`step\` to ${c.step}, but the feature has ${steps.length} steps: use 1 to ${steps.length}.`);
  for (const [i] of steps.entries())
    if (!criteria.some((c) => c.step === i + 1)) notes.push(`Step ${i + 1} has no criterion: every step needs at least one.`);
  const found = await neededFeatures(db, run.project_id, needs);
  for (const n of needs) {
    const same = found.some((x) => x.code === n.code && x.version === n.version);
    if (!same) {
      notes.push(`${n.code} v${n.version} in \`needs\` is not an approved feature at that version: \`needs\` only names approved siblings, with their current version.`);
      continue;
    }
    const sibling = await plannedFeatureByCode(db, run.project_id, n.code);
    if (sibling?.epic_id !== f.planned.epicId || n.code === f.planned.code)
      notes.push(`${n.code} in \`needs\` is not another feature of ${f.epic.code}: \`needs\` only names siblings of the same epic.`);
  }
  return notes;
});

registerApplier('feature_design', async ({ trx, execute, run, output }) => {
  const scope = run.scope as { id: string };
  const f = await featureOfThread(trx, run.project_id, scope.id);
  if (f.problem !== undefined) throw new DomainError('conflict', f.problem);
  const actor = { type: 'agent_run' as const, run: run.id };
  const base = { projectId: run.project_id, command: 'batch.submit' as const, actor };
  const common = { batch_type: 'agent' as const, resolution: 'item' as const, run_id: run.id, context_pack_id: run.context_pack_id ?? undefined };
  const result = output.result;
  if (result.kind === 'split') {
    const reason = `Too big for one feature (${result.pattern}): ${result.reason}`.slice(0, 1000);
    const plan = { epic: { code: f.epic.code }, reason, evidence: [], split_by_agent: true };
    await execute({
      ...base,
      data: {
        ...common,
        summary: `${f.planned.code} is too big: split into ${result.features.length} features.`,
        proposals: [
          { type: 'feature_plan', payload: { ...plan, action: 'drop', code: f.planned.code, name: f.planned.name } },
          ...result.features.map((x, i) => ({
            type: 'feature_plan',
            payload: { ...plan, action: 'add', name: x.name, summary: x.summary, position: f.planned.position + i },
          })),
        ],
      },
    });
    return;
  }
  const x = result.feature;
  const needs = await neededFeatures(trx, run.project_id, x.needs);
  const basis = await threadBasis(trx, scope.id);
  await execute({
    ...base,
    data: {
      ...common,
      summary: `Feature designed from the thread: ${x.title} (${x.criteria.length} criteria, size ${x.size}).`,
      proposals: [
        {
          type: 'design_record',
          payload: {
            record_type: 'fdr',
            code: f.planned.code,
            title: x.title,
            domain: f.epic.domain,
            based_on: { code: f.epic.code, version: f.epic.version },
            sections: [
              { title: 'Goal', content: x.goal },
              { title: 'Scope', content: x.scope },
              { title: 'Out of scope', content: x.out_of_scope },
              { title: 'Behavior', content: x.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') },
            ],
            criteria: x.criteria.map((c) => criterionPayload(c)),
            size: x.size,
            size_reason: x.size_reason,
            ...(needs.length > 0 ? { needs: needs.map((n) => ({ code: n.code, version: n.version })) } : {}),
            ...sourcesPayload(output.sources),
            ...(basis.length > 0 ? { basis } : {}),
          },
          // Each needed feature, like the epic it is based on, must still be at that version when it is accepted.
          ...(needs.length > 0 ? { dependencies: needs.map((n) => ({ type: 'record' as const, ...n })) } : {}),
        },
      ],
    },
  });
});
