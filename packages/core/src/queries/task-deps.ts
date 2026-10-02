// Task dependencies as data the build engine enforces (our convention): a task is not ready while a
// task it depends on is not merged or a feature it waits for is not built (every one of its tasks
// merged, and at least one). Both are `depends_on` links from the task's version: to a task, or to a
// feature. Derived on read from the links and the build requests; nothing is stored.

import { type NeededTask, type TaskWaits, findDependencyCycle } from '@demiurgo/domain';
import { needKey, loadTaskNeeds, taskNeedsWait } from '../classifier/task-needs.ts';
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
  /** The features each feature needs (feature-to-feature `based_on`, from the current version of each feature). */
  featureNeeds: Map<string, string[]>;
  /**
   * Jev's latest probability that a task needs another one, by `pairKey(task, needed)` (task codes). Only
   * opinions on the versions that are current now (or the `own` version) are here.
   */
  needs: Map<string, number>;
};

export const pairKey = (code: string, needed: string): string => `${code}|${needed}`;

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/**
 * Loads the dependencies of the project's tasks. `own` makes one task read its links from a given
 * version (the one whose readiness is being computed) instead of its current approved one.
 */
/**
 * The index of a project is the same for every task read at its current approved version, and a page that reads
 * the readiness of every task (Product, Build) asked for it once per task (125 loads of ~45 ms each). It is kept
 * per database handle for a moment (a transaction is its own handle, so a command never reads a stale one).
 */
const INDEX_TTL_MS = 2_000;
const indexes = new WeakMap<object, Map<string, { at: number; index: Promise<TaskDependencyIndex> }>>();

export async function loadTaskDependencies(
  db: Db,
  projectId: string,
  own?: { code: string; versionId: string },
): Promise<TaskDependencyIndex> {
  if (own) {
    // A task read at its current approved version needs no index of its own.
    const current = await db
      .selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select('record_versions.id')
      .where('records.project_id', '=', projectId)
      .where('records.code', '=', own.code)
      .where('record_versions.state', '=', 'approved')
      .orderBy('record_versions.n', 'desc')
      .executeTakeFirst();
    if (current?.id !== own.versionId) return buildTaskDependencies(db, projectId, own);
  }
  const byProject = indexes.get(db) ?? new Map<string, { at: number; index: Promise<TaskDependencyIndex> }>();
  indexes.set(db, byProject);
  const hit = byProject.get(projectId);
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.index;
  const index = buildTaskDependencies(db, projectId);
  byProject.set(projectId, { at: Date.now(), index });
  index.catch(() => byProject.delete(projectId));
  return index;
}

async function buildTaskDependencies(
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
  // Feature needs (feature based on feature) from each feature's current approved version.
  const featureLinks = await db
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
    .innerJoin('records as fr', 'fr.id', 'fv.record_id')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .innerJoin('records as tr', 'tr.id', 'tv.record_id')
    .select(['fv.record_id as fromRecord', 'fv.n as fromN', 'fr.code as fromCode', 'tr.code as toCode'])
    .where('links.project_id', '=', projectId)
    .where('links.type', '=', 'based_on')
    .where('links.state', '!=', 'obsolete')
    .where('fr.type', '=', 'fdr')
    .where('tr.type', '=', 'fdr')
    .execute();
  const featureApproved = featureLinks.length
    ? await db
        .selectFrom('record_versions')
        .select(['record_id', 'n'])
        .where('record_id', 'in', unique(featureLinks.map((l) => l.fromRecord)))
        .where('state', '=', 'approved')
        .execute()
    : [];
  const featureCurrentN = new Map<string, number>();
  for (const v of featureApproved) featureCurrentN.set(v.record_id, Math.max(featureCurrentN.get(v.record_id) ?? 0, v.n));
  const featureNeeds = new Map<string, string[]>();
  for (const l of featureLinks) {
    if (l.fromN === featureCurrentN.get(l.fromRecord)) featureNeeds.set(l.fromCode, unique([...(featureNeeds.get(l.fromCode) ?? []), l.toCode]));
  }
  // The tasks whose merged state matters: those of the features waited for and of the features a task's feature needs.
  const waitedFeatures = new Set([...targets.values()].filter((t) => t.type === 'fdr').map((t) => t.code));
  for (const b of based) taskFeature.set(b.taskCode, b.featureCode);
  const ownFeature = own ? taskFeature.get(own.code) : undefined;
  for (const [feature, needed] of featureNeeds) if (!own || feature === ownFeature) for (const n of needed) waitedFeatures.add(n);
  for (const b of based) {
    featureTasks.set(b.featureCode, unique([...(featureTasks.get(b.featureCode) ?? []), b.taskCode]));
    if (waitedFeatures.has(b.featureCode)) taskRecords.set(b.taskCode, b.taskRecord);
  }
  const merged = new Map<string, boolean>();
  for (const [code, id] of taskRecords) merged.set(code, !!(await mergedBuildOf(db, id)));
  // The title each one is shown with: its latest version's.
  const ids = [...new Set([...[...targets.values()].map((t) => t.recordId), ...taskRecords.values()])];
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
  // Jev's opinions on which task needs which, for the versions that are current (the `own` one for its task).
  const opinions = await loadTaskNeeds(db, projectId);
  const needs = new Map<string, number>();
  if (opinions.size > 0) {
    const versions = await db
      .selectFrom('record_versions as v')
      .innerJoin('records as r', 'r.id', 'v.record_id')
      .select(['r.code', 'v.id', 'v.n'])
      .where('r.project_id', '=', projectId)
      .where('r.type', '=', 'task')
      .where('v.state', '=', 'approved')
      .orderBy('v.n', 'desc')
      .execute();
    const latest = new Map<string, string>();
    for (const v of versions) if (!latest.has(v.code)) latest.set(v.code, v.id);
    if (own) latest.set(own.code, own.versionId);
    const codes = [...latest.keys()];
    for (const a of codes) {
      for (const b of codes) {
        const o = opinions.get(needKey(latest.get(a) as string, latest.get(b) as string));
        if (o) needs.set(pairKey(a, b), o.p);
      }
    }
  }
  return { tasks, features, featureTasks, taskFeature, titles, merged, featureNeeds, needs };
}

/**
 * The unmerged tasks of `feature` that `code` waits for: every one without an opinion yet, an explicit link or
 * an opinion of at least the threshold (classifier/task-needs.ts). `unmerged` is how many tasks of the feature
 * are not merged, whatever the answer.
 */
function neededTasksOf(index: TaskDependencyIndex, code: string, feature: string): { needed: NeededTask[]; unmerged: number } {
  const unmerged = (index.featureTasks.get(feature) ?? []).filter((t) => t !== code && index.merged.get(t) === false);
  const explicit = new Set(index.tasks.get(code) ?? []);
  const needed = unmerged
    .filter((t) => taskNeedsWait(index.needs.get(pairKey(code, t)), explicit.has(t)))
    .map((t) => ({ code: t, title: index.titles.get(t) ?? '', feature }));
  return { needed, unmerged: unmerged.length };
}

/** What the task `code` waits for, with the dependency cycle it is in. A feature never makes its own task wait. */
export function taskWaitsFrom(index: TaskDependencyIndex, code: string, ownFeature?: string | null): TaskWaits {
  const title = (c: string) => index.titles.get(c) ?? '';
  const cycle = findDependencyCycle(index.tasks, code);
  // Features this task's feature needs: it waits only for the tasks it needs, and the feature-level reason is replaced.
  const needed: NeededTask[] = [];
  const replacesNeeds: string[] = [];
  for (const f of ownFeature ? (index.featureNeeds.get(ownFeature) ?? []) : []) {
    const n = neededTasksOf(index, code, f);
    if (n.unmerged === 0) continue;
    replacesNeeds.push(f);
    needed.push(...n.needed);
  }
  return {
    cycle: cycle ? (cycle.length > 1 ? cycle.slice(1) : cycle) : null,
    tasks: (index.tasks.get(code) ?? []).map((c) => ({ code: c, title: title(c), merged: index.merged.get(c) ?? false })),
    features: (index.features.get(code) ?? [])
      .filter((f) => f !== ownFeature)
      .map((f) => {
        const own = index.featureTasks.get(f) ?? [];
        const built = own.length > 0 && own.every((t) => index.merged.get(t) === true);
        const n = neededTasksOf(index, code, f);
        return { code: f, title: title(f), built, ...(built || n.unmerged === 0 ? {} : { needed: n.needed }) };
      }),
    needed,
    replacesNeeds,
  };
}

/** The codes (tasks, and the tasks it needs of each waited or needed feature) a task has to come after in the queue. */
export function waitedTaskCodes(index: TaskDependencyIndex, code: string, ownFeature?: string | null): string[] {
  const features = [...(index.features.get(code) ?? []).filter((f) => f !== ownFeature), ...(ownFeature ? (index.featureNeeds.get(ownFeature) ?? []) : [])];
  return unique([...(index.tasks.get(code) ?? []), ...features.flatMap((f) => neededTasksOf(index, code, f).needed.map((t) => t.code))]);
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
