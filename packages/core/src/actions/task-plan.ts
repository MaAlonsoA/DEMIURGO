// task_plan action: a dedicated agent breaks an approved feature into tasks. The checker gates the
// output (every criterion covered, XL split, one walking skeleton at most) before the applier turns
// it into one package the person accepts in a step, depending on the feature's version.

import { DomainError, behaviorSteps } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import { knowledgeForContext } from '../context/knowledge.ts';
import { ManifestBuilder, recordKnowledge } from '../context/manifest.ts';
import type { Db } from '../db/connection.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { packContentOf, sourcesPayload } from './drafting.ts';
import { featureTasksOf } from './exploration-chat.ts';

const BUILDER = 'task_plan@1';
const BUDGET = { feature: 12_000, related: 4_000, knowledge: 4_000 };
const CUT = { related: 40 };

/** Whether the project has a task yet: the first feature's first task is the walking skeleton. */
async function projectHasTasks(db: Db, projectId: string): Promise<boolean> {
  return !!(await db.selectFrom('records').select('id').where('project_id', '=', projectId).where('type', '=', 'task').executeTakeFirst());
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
  if (v.type !== 'fdr' || v.state !== 'approved') throw new DomainError('validation', 'Tasks are planned from an approved feature.');
  const feature = await featureTasksOf(trx, projectId, v.code);
  if (!feature || feature.version !== v.n)
    throw new DomainError('validation', `${v.code} v${v.n} is not the current approved version of the feature: plan its tasks from the current one.`);
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
    steps: behaviorSteps(text('Behavior')).map((s) => ({ n: s.n, text: s.title })),
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
    source: { type: 'record_version', id: v.id, version: v.n, eventSeq: null },
    text: JSON.stringify(content),
    reason: 'scope',
  });
  const firstFeature = !(await projectHasTasks(trx, projectId));
  const related = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type', 'record_versions.n', 'record_versions.title'])
    .where('records.project_id', '=', projectId)
    .where('records.type', 'in', ['requirement', 'quality_requirement', 'adr', 'threat_model', 'production_readiness'])
    .where('record_versions.state', '=', 'approved')
    .orderBy('records.code')
    .limit(CUT.related)
    .execute();
  for (const r of related)
    manifest.entered({
      section: 'related',
      source: { type: 'record', id: r.recordId, version: r.n, eventSeq: null },
      text: r.title,
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
      dependencies: [{ type: 'record', id: v.recordId, version: v.n }, ...knowledge.dependencies],
      content: {
        feature: content,
        existing_tasks: feature.tasks,
        uncovered: feature.uncovered,
        first_feature: firstFeature,
        approved_records: related.map((r) => ({ code: r.code, type: r.type, version: r.n, title: r.title })),
        knowledge: knowledge.nodes,
      },
    },
    manifest: manifest.build(),
  };
});

type PackContent = { feature: { code: string; version: number; domain: string | null }; uncovered: string[]; first_feature: boolean };

registerChecker('task_plan', async ({ db, run, output }) => {
  const pack = await packContentOf<PackContent>(db, run);
  const feature = await featureTasksOf(db, run.project_id, pack.feature.code);
  const notes: string[] = [];
  if (!feature || feature.version !== pack.feature.version)
    return [`${pack.feature.code} is no longer at v${pack.feature.version}: its tasks can't be planned from this version.`];
  for (const [i, t] of output.tasks.entries()) {
    const unknown = t.covers.filter((c) => !feature.criteria.includes(c));
    if (unknown.length > 0)
      notes.push(`Task ${i + 1} ("${t.title}") covers ${unknown.join(', ')}, which ${unknown.length > 1 ? 'are' : 'is'} not a criterion of ${feature.code}: \`covers\` only lists \`feature.criteria\` codes.`);
    const bad = t.depends_on.filter((d) => d >= i + 1);
    if (bad.length > 0)
      notes.push(
        `Task ${i + 1} ("${t.title}") depends on ${bad.join(', ')}: \`depends_on\` only lists positions of EARLIER tasks (1 to ${i}), never itself or a later one.`,
      );
    if (t.size === 'XL' && !t.split) notes.push(`Task ${i + 1} ("${t.title}") is XL: say in \`split\` how it could be split into smaller tasks.`);
    if (t.walking_skeleton && (i !== 0 || !pack.first_feature))
      notes.push(
        `Task ${i + 1} ("${t.title}") is marked as the walking skeleton: only the first task of the project's first feature can be (\`first_feature\` is ${pack.first_feature}); mark it false.`,
      );
  }
  const covered = new Set(output.tasks.flatMap((t) => t.covers));
  const missing = pack.uncovered.filter((c) => !covered.has(c));
  if (missing.length > 0) notes.push(`No task covers ${missing.join(', ')}: every criterion of the feature is covered by at least one task.`);
  return notes;
});

registerApplier('task_plan', async ({ trx, execute, run, output }) => {
  const pack = await packContentOf<PackContent & { feature: { title: string } }>(trx, run);
  const f = pack.feature;
  const record = await trx
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', run.project_id)
    .where('code', '=', f.code)
    .executeTakeFirstOrThrow();
  await execute({
    projectId: run.project_id,
    command: 'batch.submit',
    actor: { type: 'agent_run', run: run.id },
    data: {
      summary: `Tasks planned for ${f.code} v${f.version}: ${output.tasks.length} tasks.`,
      batch_type: 'agent',
      resolution: 'item',
      run_id: run.id,
      context_pack_id: run.context_pack_id ?? undefined,
      dependencies: [{ type: 'record', id: record.id, code: f.code, version: f.version }],
      proposals: output.tasks.map((t) => ({
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
          ...(t.depends_on.length > 0
            ? { depends_on_titles: [...new Set(t.depends_on.flatMap((d) => output.tasks[d - 1]?.title ?? []))] }
            : {}),
          ...sourcesPayload(output.sources),
        },
      })),
    },
  });
});
