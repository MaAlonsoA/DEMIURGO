// task_plan action: a dedicated agent breaks an approved feature into tasks. The checker gates the
// output (every criterion covered, XL split, one walking skeleton at most) before the applier turns
// it into one package the person accepts in a step, depending on the feature's version.

import { DomainError, behaviorSteps, type Section } from '@demiurgo/domain';
import { approvedBasis } from '../context/approved-basis.ts';
import { registerBuilder } from '../context/build.ts';
import { knowledgeForContext } from '../context/knowledge.ts';
import { ManifestBuilder, recordKnowledge } from '../context/manifest.ts';
import { approvedDesignSystem as approvedDesignSystemFull } from './screen-design.ts';
import { approvedDesignSystem, screensOfFeatureVersion } from '../design/screens.ts';
import type { Db } from '../db/connection.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { packContentOf, sourcesPayload } from './drafting.ts';
import { featureTasksOf } from './exploration-chat.ts';
import { mergedBuildOf, originExploration } from '../queries/read.ts';

const BUILDER = 'task_plan@1';
const BUDGET = {
  feature: 12_000,
  related: 4_000,
  basis: 40_000,
  knowledge: 4_000,
};
const CUT = { related: 40 };

/** Whether the project has a task yet: the first feature's first task is the walking skeleton. */
async function projectHasTasks(db: Db, projectId: string): Promise<boolean> {
  return !!(await db
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', projectId)
    .where('type', '=', 'task')
    .executeTakeFirst());
}

type ExistingTask = {
  code: string;
  title: string;
  state: string;
  version: number;
  covers: string[];
  /** Built by a merged pull request: its coverage can't change, a new task is needed instead. */
  merged: boolean;
  goal: string;
  scope: string;
};

/** The feature's tasks with what the planner needs to re-assign criteria: version, whether merged, Goal and Scope. */
async function existingTasksOf(
  db: Db,
  projectId: string,
  feature: NonNullable<Awaited<ReturnType<typeof featureTasksOf>>>,
): Promise<ExistingTask[]> {
  const out: ExistingTask[] = [];
  for (const t of feature.tasks) {
    const rec = await db
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', projectId)
      .where('code', '=', t.code)
      .executeTakeFirst();
    if (!rec) continue;
    const v = await db
      .selectFrom('record_versions')
      .select('sections')
      .where('record_id', '=', rec.id)
      .where('n', '=', t.version)
      .executeTakeFirst();
    const sections = (v?.sections ?? []) as Section[];
    const of = (title: string) => sections.find((x) => x.title === title)?.content ?? '';
    out.push({
      ...t,
      merged: !!(await mergedBuildOf(db, rec.id)),
      goal: of('Goal'),
      scope: of('Scope'),
    });
  }
  return out;
}

type RequestMessage = { id: string; author: string; body: string };

/**
 * What the person asked for in the thread the draft comes from. The run is requested on the feature version,
 * not on a thread, so the thread is found: the one about this feature (it designed the feature, was opened on
 * it, or names its code) with the newest message of the person. Its last messages of the person and the last
 * reply of an agent are what the planner must act on when it re-plans.
 */
async function requestOf(db: Db, projectId: string, feature: { recordId: string; code: string }, versionId: string) {
  const versionIds = (
    await db.selectFrom('record_versions').select('id').where('record_id', '=', feature.recordId).execute()
  ).map((v) => v.id);
  const origin = await originExploration(db, versionId);
  const rows = await db
    .selectFrom('explorations')
    .select(['id', 'purpose', 'origin_type', 'origin_id'])
    .where('project_id', '=', projectId)
    .execute();
  const ids = rows
    .filter(
      (e) =>
        e.id === origin ||
        e.purpose.includes(feature.code) ||
        (e.origin_type === 'record_version' && !!e.origin_id && versionIds.includes(e.origin_id)),
    )
    .map((e) => e.id);
  if (ids.length === 0) return null;
  const latest = await db
    .selectFrom('messages')
    .select('exploration_id')
    .where('exploration_id', 'in', ids)
    .where('author', 'like', 'human:%')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!latest) return null;
  const clip = (m: RequestMessage): RequestMessage => ({
    ...m,
    body: m.body.length > 1500 ? `${m.body.slice(0, 1500)}…` : m.body,
  });
  const human = (
    await db
      .selectFrom('messages')
      .select(['id', 'author', 'body'])
      .where('exploration_id', '=', latest.exploration_id)
      .where('author', 'like', 'human:%')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(3)
      .execute()
  ).reverse();
  const reply = await db
    .selectFrom('messages')
    .select(['id', 'author', 'body'])
    .where('exploration_id', '=', latest.exploration_id)
    .where('author', 'not like', 'human:%')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return {
    thread: latest.exploration_id,
    messages: human.map(clip),
    last_reply: reply ? clip(reply) : null,
  };
}

registerBuilder('task_plan', async ({ trx, projectId, scope, graphVersion }) => {
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
  if (v.type !== 'fdr' || v.state !== 'approved')
    throw new DomainError('validation', 'Tasks are planned from an approved feature.');
  const feature = await featureTasksOf(trx, projectId, v.code);
  if (!feature || feature.version !== v.n)
    throw new DomainError(
      'validation',
      `${v.code} v${v.n} is not the current approved version of the feature: plan its tasks from the current one.`,
    );
  // With an approved design system, the screens come first: the tasks are planned with them in front (`no_ui`
  // counts as designed). Without a design system nothing changes.
  let screens: Awaited<ReturnType<typeof screensOfFeatureVersion>> = null;
  if (await approvedDesignSystem(trx, projectId)) {
    screens = await screensOfFeatureVersion(trx, projectId, { code: v.code, version: v.n }, true);
    if (!screens)
      throw new DomainError(
        'validation',
        `${v.code} v${v.n} has no approved screen design: design its screens (or say it has no interface) before planning its tasks.`,
      );
  }
  const sections = v.sections as { title: string; content: string }[];
  const text = (t: string) => sections.find((s) => s.title === t)?.content ?? '';
  const criteria = await trx
    .selectFrom('criteria')
    .select(['code', 'title', 'statement', 'step', 'verification', 'given_text', 'when_text', 'then_text'])
    .where('record_version_id', '=', v.id)
    .orderBy('position')
    .execute();
  const content = {
    code: v.code,
    version: v.n,
    domain: v.domain,
    title: v.title,
    goal: text('Goal'),
    scope: text('Scope'),
    out_of_scope: text('Out of scope'),
    steps: behaviorSteps(text('Behavior')).map((s) => ({
      n: s.n,
      text: s.title,
    })),
    criteria: criteria.map((c) => ({
      code: c.code,
      title: c.title,
      step: c.step,
      verification: c.verification,
      given: c.given_text,
      when: c.when_text,
      then: c.then_text,
      ...(c.given_text ? {} : { statement: c.statement }),
    })),
  };
  manifest.entered({
    section: 'feature',
    source: {
      type: 'record_version',
      id: v.id,
      version: v.n,
      eventSeq: null,
    },
    text: JSON.stringify(content),
    reason: 'scope',
  });
  const firstFeature = !(await projectHasTasks(trx, projectId));
  const existing = await existingTasksOf(trx, projectId, feature);
  const request = await requestOf(trx, projectId, { recordId: v.recordId, code: v.code }, v.id);
  if (request)
    manifest.entered({
      section: 'request',
      source: {
        type: 'exploration',
        id: request.thread,
        version: null,
        eventSeq: null,
      },
      text: JSON.stringify(request),
      reason: 'the thread the draft was requested from',
    });
  const related = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type', 'record_versions.n', 'record_versions.title'])
    .where('records.project_id', '=', projectId)
    .where('records.type', 'in', ['requirement', 'production_readiness'])
    .where('record_versions.state', '=', 'approved')
    .orderBy('records.code')
    .limit(CUT.related)
    .execute();
  for (const r of related)
    manifest.entered({
      section: 'related',
      source: {
        type: 'record',
        id: r.recordId,
        version: r.n,
        eventSeq: null,
      },
      text: r.title,
      reason: 'approved',
    });
  // The decisions, the threat model and the quality requirements in full: a task cites them and follows them.
  const basis = await approvedBasis(trx, projectId, {
    kinds: ['adr', 'threat_model', 'quality_requirement'],
    budget: BUDGET.basis,
    section: 'basis',
    manifest,
  });
  const design = await approvedDesignSystemFull(trx, projectId);
  if (design)
    manifest.entered({
      section: 'basis',
      source: {
        type: 'record',
        id: design.recordId,
        version: design.version,
        eventSeq: null,
      },
      text: JSON.stringify(design.principles),
      reason: 'approved',
    });
  const knowledge = await knowledgeForContext(trx, projectId, `${v.title} ${text('Goal')} ${text('Scope')}`, BUDGET.knowledge);
  recordKnowledge(manifest, knowledge);
  return {
    pack: {
      role: 'design',
      constructor: BUILDER,
      budget: BUDGET,
      graph_version: graphVersion,
      dependencies: [
        { type: 'record', id: v.recordId, version: v.n },
        ...basis.dependencies.map((d) => ({
          type: 'record',
          id: d.id,
          version: d.version,
        })),
        ...(design ? [{ type: 'record', id: design.recordId, version: design.version }] : []),
        ...knowledge.dependencies,
      ],
      content: {
        feature: content,
        existing_tasks: existing.map((t) => ({
          ...t,
          changeable: !t.merged,
        })),
        // The person's latest words in the feature's thread, and the last reply there: the change they want in the plan.
        request,
        uncovered: feature.uncovered,
        first_feature: firstFeature,
        ...(screens?.spec
          ? {
              screens: {
                no_ui: screens.spec.no_ui,
                screens: screens.spec.screens.map((x) => ({
                  id: x.id,
                  name: x.name,
                  purpose: x.purpose,
                  steps: x.steps,
                  components: x.components,
                })),
                flow: screens.spec.flow,
              },
            }
          : {}),
        approved_records: related.map((r) => ({
          code: r.code,
          type: r.type,
          version: r.n,
          title: r.title,
        })),
        // Full text of what the plan must respect; `trimmed` ones end in «[trimmed]», `omitted` ones did not fit at all.
        approved_decisions: basis.records.filter((r) => r.type === 'adr').map(({ type: _t, ...r }) => r),
        approved_threat_model: basis.records.filter((r) => r.type === 'threat_model').map(({ type: _t, ...r }) => r),
        approved_quality_requirements: basis.records
          .filter((r) => r.type === 'quality_requirement')
          .map(({ type: _t, ...r }) => r),
        ...(basis.omitted.length > 0 ? { omitted_for_budget: basis.omitted } : {}),
        design_system_principles: design
          ? {
              code: design.code,
              version: design.version,
              principles: design.principles,
            }
          : null,
        basis_dependencies: [
          ...basis.dependencies,
          ...(design
            ? [
                {
                  type: 'record' as const,
                  id: design.recordId,
                  code: design.code,
                  version: design.version,
                },
              ]
            : []),
        ],
        knowledge: knowledge.nodes,
      },
    },
    manifest: manifest.build(),
  };
});

type PackContent = {
  feature: { code: string; version: number; domain: string | null };
  uncovered: string[];
  existing_tasks?: ExistingTask[];
  request?: { thread: string; messages: RequestMessage[] } | null;
  first_feature: boolean;
  basis_dependencies?: {
    type: 'record';
    id: string;
    code: string;
    version: number;
  }[];
};

/** What each existing task covers once the (valid) changes apply: a merged task never changes. */
function coverageAfterChanges(existing: ExistingTask[], changes: { code: string; covers: string[] }[]): Map<string, string[]> {
  return new Map(
    existing.map((t) => [t.code, t.merged ? t.covers : (changes.find((c) => c.code === t.code)?.covers ?? t.covers)] as const),
  );
}

registerChecker('task_plan', async ({ db, run, output }) => {
  const pack = await packContentOf<PackContent>(db, run);
  const feature = await featureTasksOf(db, run.project_id, pack.feature.code);
  const notes: string[] = [];
  if (!feature || feature.version !== pack.feature.version)
    return [`${pack.feature.code} is no longer at v${pack.feature.version}: its tasks can't be planned from this version.`];
  for (const [i, t] of output.tasks.entries()) {
    const unknown = t.covers.filter((c) => !feature.criteria.includes(c));
    if (unknown.length > 0)
      notes.push(
        `Task ${i + 1} ("${t.title}") covers ${unknown.join(', ')}, which ${unknown.length > 1 ? 'are' : 'is'} not a criterion of ${feature.code}: \`covers\` only lists \`feature.criteria\` codes.`,
      );
    const bad = t.depends_on.filter((d) => d >= i + 1);
    if (bad.length > 0)
      notes.push(
        `Task ${i + 1} ("${t.title}") depends on ${bad.join(', ')}: \`depends_on\` only lists positions of EARLIER tasks (1 to ${i}), never itself or a later one.`,
      );
    if (t.size === 'XL' && !t.split)
      notes.push(`Task ${i + 1} ("${t.title}") is XL: say in \`split\` how it could be split into smaller tasks.`);
    if (t.walking_skeleton && (i !== 0 || !pack.first_feature))
      notes.push(
        `Task ${i + 1} ("${t.title}") is marked as the walking skeleton: only the first task of the project's first feature can be (\`first_feature\` is ${pack.first_feature}); mark it false.`,
      );
  }
  const existing = await existingTasksOf(db, run.project_id, feature);
  const seen = new Set<string>();
  for (const ch of output.task_changes) {
    const task = existing.find((t) => t.code === ch.code);
    if (!task) notes.push(`\`task_changes\` names ${ch.code}, which is not one of \`existing_tasks\`.`);
    else if (task.merged)
      notes.push(
        `${ch.code} is merged: its coverage can't change. Cover the criterion in a new task instead and leave ${ch.code} out of \`task_changes\`.`,
      );
    if (seen.has(ch.code)) notes.push(`\`task_changes\` lists ${ch.code} twice: one entry with its whole new \`covers\`.`);
    seen.add(ch.code);
    const unknown = ch.covers.filter((c) => !feature.criteria.includes(c));
    if (unknown.length > 0)
      notes.push(
        `${ch.code} covers ${unknown.join(', ')}, which ${unknown.length > 1 ? 'are' : 'is'} not a criterion of ${feature.code}.`,
      );
  }
  if (output.tasks.length + output.task_changes.length === 0)
    notes.push('Nothing to propose: return the new tasks and/or the `task_changes` the request needs.');
  const covered = new Set([...coverageAfterChanges(existing, output.task_changes).values()].flat());
  for (const t of output.tasks) for (const c of t.covers) covered.add(c);
  const missing = feature.criteria.filter((c) => !covered.has(c));
  if (missing.length > 0)
    notes.push(`No task covers ${missing.join(', ')}: every criterion of the feature is covered by at least one task.`);
  return notes;
});

/**
 * Drops from the new tasks the criteria another task already covers (after the changes apply): the same
 * criterion in two tasks is built twice. A criterion the person's request names stays (they may want it in both),
 * and a task left without criteria goes. Returns the kept tasks with their old position, to remap `depends_on`.
 */
export function withoutDuplicateCoverage<T extends { title: string; covers: string[] }>(
  tasks: T[],
  taken: ReadonlySet<string>,
  asked: ReadonlySet<string>,
): { task: T; from: number }[] {
  const seen = new Set(taken);
  const kept: { task: T; from: number }[] = [];
  for (const [i, t] of tasks.entries()) {
    const covers = t.covers.filter((c) => asked.has(c) || !seen.has(c));
    for (const c of t.covers)
      if (!covers.includes(c)) console.info(`[task_plan] «${t.title}»: ${c} dropped, another task already covers it`);
    if (covers.length === 0) {
      console.info(`[task_plan] «${t.title}» dropped: every criterion it covers is already covered by another task`);
      continue;
    }
    for (const c of covers) seen.add(c);
    kept.push({ task: { ...t, covers }, from: i + 1 });
  }
  return kept;
}

registerApplier('task_plan', async ({ trx, execute, run, output }) => {
  const pack = await packContentOf<PackContent & { feature: { title: string } }>(trx, run);
  const f = pack.feature;
  const record = await trx
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', run.project_id)
    .where('code', '=', f.code)
    .executeTakeFirstOrThrow();
  const existing = pack.existing_tasks ?? [];
  // The changes to existing tasks: only the ones not merged (the checker already refused the others).
  const changes = output.task_changes.filter((c) => existing.some((t) => t.code === c.code && !t.merged));
  const after = coverageAfterChanges(existing, changes);
  const taken = new Set([...after.values()].flat());
  const asked = new Set((pack.request?.messages ?? []).flatMap((m) => m.body.match(/AC-[A-Z]{3}-\d{3}-\d{2}/g) ?? []));
  const kept = withoutDuplicateCoverage(output.tasks, taken, asked);
  const fresh = kept.map((k) => k.task);
  const newPosition = new Map(kept.map((k, i) => [k.from, i + 1] as const));
  const evidenceMessage = [...(pack.request?.messages ?? [])].reverse().find((m) => m.author.startsWith('human:'));
  const existingId = new Map(
    (
      await trx
        .selectFrom('records')
        .select(['id', 'code'])
        .where('project_id', '=', run.project_id)
        .where('code', 'in', existing.map((t) => t.code).concat('-'))
        .execute()
    ).map((r) => [r.code, r.id] as const),
  );
  const taskChanges = evidenceMessage
    ? changes.flatMap((c) => {
        const t = existing.find((x) => x.code === c.code)!;
        return [
          {
            type: 'record_change',
            payload: {
              record: { code: t.code, version: t.version },
              sections: [...(c.goal ? [{ section: 'Goal', content: c.goal }] : []), { section: 'Scope', content: c.scope }],
              covers: c.covers,
              reason: `Criteria re-assigned in the plan of ${f.code}: ${t.covers.filter((x) => !c.covers.includes(x)).join(', ') || 'none moved out'}.`,
              evidence: [
                {
                  message_id: evidenceMessage.id,
                  quote: evidenceMessage.body.slice(0, 600),
                },
              ],
            },
            dependencies: [
              {
                type: 'record' as const,
                id: existingId.get(t.code)!,
                code: t.code,
                version: t.version,
              },
            ],
          },
        ];
      })
    : [];
  if (changes.length > 0 && taskChanges.length === 0)
    console.info('[task_plan] task changes dropped: the thread has no message of the person to rest them on');
  if (fresh.length === 0 && taskChanges.length === 0)
    throw new DomainError(
      'validation',
      'The plan has nothing left to propose: every criterion it covers is already covered by another task.',
    );
  await execute({
    projectId: run.project_id,
    command: 'batch.submit',
    actor: { type: 'agent_run', run: run.id },
    data: {
      summary: `Tasks planned for ${f.code} v${f.version}: ${fresh.length} new${taskChanges.length > 0 ? `, ${taskChanges.length} changed` : ''}.`,
      batch_type: 'agent',
      resolution: 'item',
      run_id: run.id,
      context_pack_id: run.context_pack_id ?? undefined,
      dependencies: [{ type: 'record', id: record.id, code: f.code, version: f.version }, ...(pack.basis_dependencies ?? [])],
      proposals: [
        ...fresh.map((t, i) => ({
          type: 'design_record',
          payload: {
            record_type: 'task',
            title: t.title,
            ...(f.domain ? { domain: f.domain } : {}),
            based_on: { code: f.code, version: f.version },
            sections: [
              { title: 'Goal', content: t.goal },
              {
                title: 'Scope',
                content: t.walking_skeleton
                  ? `${t.scope}\n\nWalking skeleton: the thinnest slice that runs end to end, done once at the start of the project (Freeman & Pryce, GOOS).`
                  : t.scope,
              },
            ],
            criteria: [],
            covers: t.covers,
            size: t.size,
            size_reason: t.size_reason,
            ...(t.split ? { split: t.split } : {}),
            ...(() => {
              const titles = [
                ...new Set(
                  t.depends_on.flatMap((d) => {
                    const at = newPosition.get(d);
                    return at && at <= i ? (fresh[at - 1]?.title ?? []) : [];
                  }),
                ),
              ];
              return titles.length > 0 ? { depends_on_titles: titles } : {};
            })(),
            ...sourcesPayload(output.sources),
          },
        })),
        ...taskChanges,
      ],
    },
  });
});
