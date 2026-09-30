// screen_design action: a dedicated agent designs the screens of an approved feature (flow, screens and
// their four states) using only the components and tokens of the project's approved design system. The
// checker is the deterministic gate after the model call: the domain's `screenDesignProblems` and
// `missingComponents`, plus the tokens as CSS variables in every state. The applier submits one
// `screen_design` proposal that the person accepts and approves.

import { DomainError, behaviorSteps, missingComponents, screenDesignProblems } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import { knowledgeForContext } from '../context/knowledge.ts';
import { ManifestBuilder, recordKnowledge } from '../context/manifest.ts';
import type { Db } from '../db/connection.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { packContentOf } from './drafting.ts';
import { featureTasksOf } from './exploration-chat.ts';

const BUILDER = 'screen_design@1';
const BUDGET = { feature: 12_000, design_system: 30_000, existing: 20_000, knowledge: 4_000 };

/** What the agent needs of a design system: its parts without the specimens (the agent draws from names, states and tokens). */
export type DsyForScreens = {
  recordId: string;
  code: string;
  version: number;
  principles: string[];
  tokens: unknown;
  components: { name: string; purpose: string; variants: string[]; states: string[]; interactive: boolean }[];
  patterns: { name: string; purpose: string; uses: string[] }[];
};

/** The project's approved design system (its current approved version), or null while it has none. */
export async function approvedDesignSystem(db: Db, projectId: string): Promise<DsyForScreens | null> {
  const v = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'record_versions.n', 'record_versions.spec'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'design_system')
    .where('record_versions.state', '=', 'approved')
    .orderBy('record_versions.n', 'desc')
    .executeTakeFirst();
  if (!v?.spec) return null;
  const spec = v.spec as {
    principles?: string[];
    tokens?: unknown;
    components?: { name: string; purpose: string; variants: string[]; states: string[]; interactive: boolean }[];
    patterns?: { name: string; purpose: string; uses: string[] }[];
  };
  return {
    recordId: v.recordId,
    code: v.code,
    version: v.n,
    principles: spec.principles ?? [],
    tokens: spec.tokens ?? {},
    components: (spec.components ?? []).map((c) => ({
      name: c.name,
      purpose: c.purpose,
      variants: c.variants,
      states: c.states,
      interactive: c.interactive,
    })),
    patterns: spec.patterns ?? [],
  };
}

/** The screen designs (SCR) based on any version of the feature, newest first, with the feature version each is based on. */
async function screenDesignsOf(db: Db, projectId: string, featureRecordId: string) {
  return db
    .selectFrom('records as s')
    .innerJoin('record_versions as sv', 'sv.record_id', 's.id')
    .innerJoin('links', 'links.from_id', 'sv.id')
    .innerJoin('record_versions as fv', 'fv.id', 'links.to_id')
    .select(['s.id as recordId', 's.code', 'sv.n', 'sv.state', 'sv.spec', 'fv.n as featureVersion'])
    .where('s.project_id', '=', projectId)
    .where('s.type', '=', 'screen_design')
    .where('links.type', '=', 'based_on')
    .where('fv.record_id', '=', featureRecordId)
    .where('sv.state', 'in', ['approved', 'draft'])
    .orderBy('s.code')
    .orderBy('sv.n', 'desc')
    .execute();
}

/** Whether the feature version has an approved screen design based on it. */
export async function hasApprovedScreens(db: Db, projectId: string, featureVersionId: string): Promise<boolean> {
  const row = await db
    .selectFrom('record_versions as sv')
    .innerJoin('records as s', 's.id', 'sv.record_id')
    .innerJoin('links', 'links.from_id', 'sv.id')
    .select('sv.id')
    .where('s.project_id', '=', projectId)
    .where('s.type', '=', 'screen_design')
    .where('sv.state', '=', 'approved')
    .where('links.type', '=', 'based_on')
    .where('links.to_id', '=', featureVersionId)
    .executeTakeFirst();
  return !!row;
}

registerBuilder('screen_design', async ({ trx, projectId, scope, graphVersion }) => {
  const manifest = new ManifestBuilder(BUILDER, graphVersion, BUDGET);
  const v = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select([
      'records.id as recordId',
      'records.code',
      'records.type',
      'records.domain',
      'record_versions.id',
      'record_versions.n',
      'record_versions.state',
      'record_versions.title',
      'record_versions.sections',
    ])
    .where('record_versions.id', '=', scope.id ?? '')
    .where('records.project_id', '=', projectId)
    .executeTakeFirst();
  if (!v) throw new DomainError('not_found', 'The feature version does not exist.');
  if (v.type !== 'fdr' || v.state !== 'approved') throw new DomainError('validation', 'Screens are designed for an approved feature.');
  const feature = await featureTasksOf(trx, projectId, v.code);
  if (!feature || feature.version !== v.n)
    throw new DomainError('validation', `${v.code} v${v.n} is not the current approved version of the feature: design its screens from the current one.`);
  const dsy = await approvedDesignSystem(trx, projectId);
  if (!dsy) throw new DomainError('validation', 'The screens are designed with the design system: approve the project’s design system first.');
  const sections = v.sections as { title: string; content: string }[];
  const text = (t: string) => sections.find((s) => s.title === t)?.content ?? '';
  const criteria = await trx
    .selectFrom('criteria')
    .select(['code', 'title', 'statement', 'step', 'given_text', 'when_text', 'then_text'])
    .where('record_version_id', '=', v.id)
    .orderBy('position')
    .execute();
  const content = {
    code: v.code,
    version: v.n,
    title: v.title,
    goal: text('Goal'),
    scope: text('Scope'),
    out_of_scope: text('Out of scope'),
    steps: behaviorSteps(text('Behavior')).map((s) => ({ n: s.n, text: s.title })),
    criteria: criteria.map((c) => ({
      code: c.code,
      title: c.title,
      step: c.step,
      ...(c.given_text ? { given: c.given_text, when: c.when_text, then: c.then_text } : { statement: c.statement }),
    })),
  };
  manifest.entered({
    section: 'feature',
    source: { type: 'record_version', id: v.id, version: v.n, eventSeq: null },
    text: JSON.stringify(content),
    reason: 'scope',
  });
  manifest.entered({
    section: 'design_system',
    source: { type: 'record', id: dsy.recordId, version: dsy.version, eventSeq: null },
    text: JSON.stringify(dsy),
    reason: 'approved',
  });
  const existing = (await screenDesignsOf(trx, projectId, v.recordId))[0] ?? null;
  const existing_screen_design = existing
    ? { code: existing.code, version: existing.n, state: existing.state, feature_version: existing.featureVersion, spec: existing.spec }
    : null;
  if (existing) manifest.entered({ section: 'existing', source: { type: 'record', id: existing.recordId, version: existing.n, eventSeq: null }, text: JSON.stringify(existing.spec), reason: 'current' });
  const knowledge = await knowledgeForContext(trx, projectId, `${v.title} ${text('Goal')} ${text('Scope')}`, BUDGET.knowledge);
  recordKnowledge(manifest, knowledge);
  return {
    pack: {
      role: 'design',
      constructor: BUILDER,
      budget: BUDGET,
      graph_version: graphVersion,
      dependencies: [{ type: 'record', id: v.recordId, version: v.n }, ...knowledge.dependencies],
      content: { feature: content, design_system: dsy, existing_screen_design, knowledge: knowledge.nodes },
    },
    manifest: manifest.build(),
  };
});

type PackContent = {
  feature: { code: string; version: number; title: string; steps: unknown[] };
  design_system: DsyForScreens;
};

registerChecker('screen_design', async ({ db, run, output }) => {
  const pack = await packContentOf<PackContent>(db, run);
  const feature = await featureTasksOf(db, run.project_id, pack.feature.code);
  if (!feature || feature.version !== pack.feature.version)
    return [`${pack.feature.code} is no longer at v${pack.feature.version}: its screens can't be designed from this version.`];
  const { spec, sections } = output.result;
  const notes = screenDesignProblems(spec, pack.feature.steps.length);
  if (spec.feature.code !== pack.feature.code || spec.feature.version !== pack.feature.version)
    notes.push(`\`spec.feature\` must be ${pack.feature.code} v${pack.feature.version}, the feature in the context.`);
  for (const [title, content] of Object.entries(sections))
    if (content.trim() === '') notes.push(`The section "${title}" is empty: write it.`);
  const dsy = (await approvedDesignSystem(db, run.project_id)) ?? pack.design_system;
  const missing = missingComponents(spec, dsy.components.map((c) => c.name));
  if (missing.length > 0)
    notes.push(
      `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not in the design system: use only components of \`design_system.components\` (${dsy.components.map((c) => c.name).join(', ')}). Reuse or combine those, even if it is less ideal.`,
    );
  for (const s of spec.screens)
    for (const [state, html] of Object.entries(s.states)) {
      if (!/var\(\s*--/.test(html))
        notes.push(`The ${state} state of "${s.name}" uses no design token: colors, sizes and spacing come from the tokens as CSS variables, \`var(--…)\`.`);
    }
  return [...new Set(notes)];
});

registerApplier('screen_design', async ({ trx, execute, run, output }) => {
  const pack = await packContentOf<PackContent>(trx, run);
  const f = pack.feature;
  const record = await trx
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', run.project_id)
    .where('code', '=', f.code)
    .executeTakeFirstOrThrow();
  const x = output.result;
  await execute({
    projectId: run.project_id,
    command: 'batch.submit',
    actor: { type: 'agent_run', run: run.id },
    data: {
      summary: x.spec.no_ui
        ? `Screens for ${f.code} v${f.version}: no interface.`
        : `Screens designed for ${f.code} v${f.version}: ${x.spec.screens.length} screens.`,
      batch_type: 'agent',
      resolution: 'item',
      run_id: run.id,
      context_pack_id: run.context_pack_id ?? undefined,
      dependencies: [{ type: 'record', id: record.id, code: f.code, version: f.version }],
      proposals: [
        {
          type: 'screen_design',
          payload: {
            title: x.title,
            sections: x.sections,
            spec: x.spec,
            ...(x.change_note ? { change_note: x.change_note } : {}),
          },
        },
      ],
    },
  });
});
