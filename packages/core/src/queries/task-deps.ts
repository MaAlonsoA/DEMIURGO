// Task dependencies as data the build engine enforces (our convention): a task is not ready while a
// task it depends on is not merged or a feature it waits for is not built (every one of its tasks
// merged, and at least one). Both are `depends_on` links from the task's version: to a task, or to a
// feature. Derived on read from the links and the build requests; nothing is stored.

import { type TaskWaits, findDependencyCycle } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { mergedBuildOf } from './read.ts';

type Wait = { code: string; type: string; recordId: string };

export type TaskDependencyIndex = {
  /** The task codes each task depends on, and the feature codes it waits for (from its current version). */
  tasks: Map<string, string[]>;
  features: Map<string, string[]>;
  /** The task codes of each feature (tasks based on it). */
  featureTasks: Map<string, string[]>;
  /** The feature each task is based on. */
  taskFeature: Map<string, string>;
  titles: Map<string, string>;
  merged: Map<string, boolean>;
};

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/**
 * Loads the dependencies of the project's tasks. `own` makes one task read its links from a given
 * version (the one whose readiness is being computed) instead of its current approved one.
 */
export async function loadTaskDependencies(
  db: Db,
  projectId: string,
  own?: { code: string; versionId: string },
): Promise<TaskDependencyIndex> {
  const links = await db
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
    .innerJoin('records as fr', 'fr.id', 'fv.record_id')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .innerJoin('records as tr', 'tr.id', 'tv.record_id')
    .select([
      'links.from_id as fromId',
      'fv.n as fromN',
      'fv.record_id as fromRecord',
      'fr.code as fromCode',
      'tr.code as toCode',
      'tr.type as toType',
      'tr.id as toRecord',
    ])
    .where('links.project_id', '=', projectId)
    .where('links.type', '=', 'depends_on')
    .where('links.state', '!=', 'obsolete')
    .where('fr.type', '=', 'task')
    .execute();
  const fromRecords = unique(links.map((l) => l.fromRecord));
  const approved = fromRecords.length
    ? await db
        .selectFrom('record_versions')
        .select(['record_id', 'n'])
        .where('record_id', 'in', fromRecords)
        .where('state', '=', 'approved')
        .execute()
    : [];
  const currentN = new Map<string, number>();
  for (const v of approved) currentN.set(v.record_id, Math.max(currentN.get(v.record_id) ?? 0, v.n));
  const tasks = new Map<string, string[]>();
  const features = new Map<string, string[]>();
  const targets = new Map<string, Wait>();
  for (const l of links) {
    const mine = own && own.code === l.fromCode ? l.fromId === own.versionId : l.fromN === currentN.get(l.fromRecord);
    if (!mine) continue;
    const bucket = l.toType === 'fdr' ? features : l.toType === 'task' ? tasks : null;
    if (!bucket) continue;
    bucket.set(l.fromCode, unique([...(bucket.get(l.fromCode) ?? []), l.toCode]));
    targets.set(l.toCode, { code: l.toCode, type: l.toType, recordId: l.toRecord });
  }
  // The tasks of every feature waited for, and the merged state of every task that matters.
  const featureTasks = new Map<string, string[]>();
  const taskRecords = new Map<string, string>(); // code -> record id
  for (const t of targets.values()) if (t.type === 'task') taskRecords.set(t.code, t.recordId);
  const taskFeature = new Map<string, string>();
  const based = await db
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
    .innerJoin('records as fr', 'fr.id', 'fv.record_id')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .innerJoin('records as tr', 'tr.id', 'tv.record_id')
    .select(['fr.code as taskCode', 'fr.id as taskRecord', 'tr.code as featureCode'])
    .where('links.project_id', '=', projectId)
    .where('links.type', '=', 'based_on')
    .where('fr.type', '=', 'task')
    .where('tr.type', '=', 'fdr')
    .execute();
  const waitedFeatures = new Set([...targets.values()].filter((t) => t.type === 'fdr').map((t) => t.code));
  for (const b of based) {
    taskFeature.set(b.taskCode, b.featureCode);
    featureTasks.set(b.featureCode, unique([...(featureTasks.get(b.featureCode) ?? []), b.taskCode]));
    if (waitedFeatures.has(b.featureCode)) taskRecords.set(b.taskCode, b.taskRecord);
  }
  const merged = new Map<string, boolean>();
  for (const [code, id] of taskRecords) merged.set(code, !!(await mergedBuildOf(db, id)));
  // The title each one is shown with: its latest version's.
  const ids = [...targets.values()].map((t) => t.recordId);
  const titles = new Map<string, string>();
  if (ids.length > 0) {
    const versions = await db
      .selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['records.code', 'record_versions.n', 'record_versions.title', 'record_versions.state'])
      .where('record_versions.record_id', 'in', ids)
      .where('record_versions.state', '<>', 'discarded')
      .orderBy('record_versions.n')
      .execute();
    for (const v of versions) titles.set(v.code, v.title);
  }
  return { tasks, features, featureTasks, taskFeature, titles, merged };
}

/** What the task `code` waits for, with the dependency cycle it is in. A feature never makes its own task wait. */
export function taskWaitsFrom(index: TaskDependencyIndex, code: string, ownFeature?: string | null): TaskWaits {
  const title = (c: string) => index.titles.get(c) ?? '';
  const cycle = findDependencyCycle(index.tasks, code);
  return {
    cycle: cycle ? (cycle.length > 1 ? cycle.slice(1) : cycle) : null,
    tasks: (index.tasks.get(code) ?? []).map((c) => ({ code: c, title: title(c), merged: index.merged.get(c) ?? false })),
    features: (index.features.get(code) ?? [])
      .filter((f) => f !== ownFeature)
      .map((f) => {
        const own = index.featureTasks.get(f) ?? [];
        return { code: f, title: title(f), built: own.length > 0 && own.every((t) => index.merged.get(t) === true) };
      }),
  };
}

/** The codes (tasks, and every task of each waited feature) a task has to come after in the queue. */
export function waitedTaskCodes(index: TaskDependencyIndex, code: string, ownFeature?: string | null): string[] {
  return unique([
    ...(index.tasks.get(code) ?? []),
    ...(index.features.get(code) ?? []).filter((f) => f !== ownFeature).flatMap((f) => index.featureTasks.get(f) ?? []),
  ]);
}

/** Which features wait for which, from their tasks' dependencies on features and on tasks of other features. */
export function featureWaitGraph(index: TaskDependencyIndex): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const add = (from: string | undefined, to: string | undefined) => {
    if (from && to && from !== to) graph.set(from, unique([...(graph.get(from) ?? []), to]));
  };
  for (const [task, waits] of index.features) for (const f of waits) add(index.taskFeature.get(task), f);
  for (const [task, waits] of index.tasks) for (const t of waits) add(index.taskFeature.get(task), index.taskFeature.get(t));
  return graph;
}
