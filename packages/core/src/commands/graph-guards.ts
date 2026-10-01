// Design-graph guards for records created outside a task plan (a person's draft, a record change, a
// design_record proposal): what a task covers, the cycles its links could close and who waits for a
// feature. The task_plan checker applies the same rules to a whole plan before it becomes proposals.

import { DomainError, cycleClosedBy } from '@demiurgo/domain';
import type { CommandContext } from '../bus/types.ts';
import { loadTaskDependencies } from '../queries/task-deps.ts';

/** The feature (record id and code) a task version is based on, if any. */
async function featureOf(ctx: CommandContext, versionId: string) {
  return ctx.trx
    .selectFrom('links')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .innerJoin('records as f', 'f.id', 'tv.record_id')
    .select(['f.id', 'f.code'])
    .where('links.from_id', '=', versionId)
    .where('links.type', '=', 'based_on')
    .where('f.type', '=', 'fdr')
    .executeTakeFirst();
}

/**
 * Every criterion a task covers belongs to the feature the task is based on (its latest version that is not
 * discarded). Same rule as the task_plan checker, applied wherever `covers` is set outside it (422).
 */
export async function assertCoversInFeature(ctx: CommandContext, taskVersionId: string, covers: readonly string[]): Promise<void> {
  if (covers.length === 0) return;
  const feature = await featureOf(ctx, taskVersionId);
  let own = new Set<string>();
  if (feature) {
    const latest = await ctx.trx
      .selectFrom('record_versions')
      .select('id')
      .where('record_id', '=', feature.id)
      .where('state', '<>', 'discarded')
      .orderBy('n', 'desc')
      .executeTakeFirst();
    if (latest)
      own = new Set(
        (await ctx.trx.selectFrom('criteria').select('code').where('record_version_id', '=', latest.id).execute()).map((c) => c.code),
      );
  }
  const foreign = [...new Set(covers)].filter((c) => !own.has(c));
  if (foreign.length === 0) return;
  throw new DomainError(
    'validation',
    feature
      ? `A task only covers criteria of the feature it is based on: ${foreign.join(', ')} ${foreign.length > 1 ? 'are' : 'is'} not a criterion of ${feature.code}.`
      : `A task that covers criteria has to be based on their feature: ${foreign.join(', ')} cannot be covered because the task is based on no feature.`,
  );
}

/**
 * A new version of a task (`depends_on` a task) or of a feature (`based_on` a feature, which is what it
 * needs) must not close a dependency cycle (409). Its new links replace the ones the record had.
 */
export async function assertNoLinkCycle(
  ctx: CommandContext,
  record: { code: string; type: string },
  links: readonly { type: string; targetCode: string; targetType: string }[],
): Promise<void> {
  const taskDeps = record.type === 'task' ? links.filter((l) => l.type === 'depends_on' && l.targetType === 'task') : [];
  const needs = record.type === 'fdr' ? links.filter((l) => l.type === 'based_on' && l.targetType === 'fdr') : [];
  if (taskDeps.length === 0 && needs.length === 0) return;
  const index = await loadTaskDependencies(ctx.trx, ctx.projectId);
  const [graph, edges, verb] =
    taskDeps.length > 0
      ? ([index.tasks, taskDeps, 'depends on'] as const)
      : ([index.featureNeeds, needs, 'needs'] as const);
  const own = new Map(graph);
  own.delete(record.code);
  let built = own;
  for (const l of edges) {
    const cycle = cycleClosedBy(built, record.code, l.targetCode);
    if (cycle)
      throw new DomainError(
        'conflict',
        `${record.code} ${verb} ${l.targetCode} would close a dependency cycle (${[...cycle, record.code].join(` ${verb} `)}): neither could be built first. Drop that link.`,
      );
    built = new Map(built).set(record.code, [...new Set([...(built.get(record.code) ?? []), l.targetCode])]);
  }
}

/**
 * Items that wait for a feature (another feature that needs it, a task that waits for it) when it has no
 * task plan yet (no task is based on it). 0 when it has tasks or nobody waits.
 */
export async function waitingWithoutPlan(ctx: CommandContext, featureRecordId: string): Promise<number> {
  const planned = await ctx.trx
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
    .innerJoin('records as r', 'r.id', 'fv.record_id')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .select('r.id')
    .where('links.project_id', '=', ctx.projectId)
    .where('links.type', '=', 'based_on')
    .where('r.type', '=', 'task')
    .where('tv.record_id', '=', featureRecordId)
    .executeTakeFirst();
  if (planned) return 0;
  const waiting = await ctx.trx
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
    .innerJoin('records as r', 'r.id', 'fv.record_id')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .select('r.id')
    .distinct()
    .where('links.project_id', '=', ctx.projectId)
    .where('links.state', '<>', 'obsolete')
    .where('fv.state', '<>', 'discarded')
    .where('tv.record_id', '=', featureRecordId)
    .where('r.id', '<>', featureRecordId)
    .where((eb) =>
      eb.or([
        eb.and([eb('links.type', '=', 'based_on'), eb('r.type', '=', 'fdr')]),
        eb.and([eb('links.type', '=', 'depends_on'), eb('r.type', '=', 'task')]),
      ]),
    )
    .execute();
  return waiting.length;
}

/** The notice an approval of a feature carries when others wait for it and it has no task plan yet. */
export function waitingNotice(count: number): string {
  return `${count} ${count === 1 ? 'item waits' : 'items wait'} for this feature and it has no task plan yet: plan its tasks next.`;
}
