// The acceptance criteria a pull request affects, written as a git trailer on the task's commit so the
// project's CI can run only their tests on pull requests (`playwright test --grep`) and the full suite on main.
// Practice: presubmit runs the tests affected by the change, postsubmit runs everything (Google TAP, Software
// Engineering at Google, ch. 23). Selecting by criterion code is our convention, and so are the 60 % cap,
// ignoring non-source files and ignoring barrels (re-export-only index files: touching one says nothing about the
// behaviour of the features that import it; PRO-016 selected 136 criteria for touching src/design-system/index.ts). The trailer format is git's (git-scm.com/docs/git-interpret-trailers): a blank
// line, then `Key: value` at the end of the message.

import type { Db } from '../db/connection.ts';
import { taskCoversOf } from '../queries/sizes.ts';
import { loadTaskDependencies } from '../queries/task-deps.ts';
import { taskFootprints } from './footprint.ts';
import { barrelsAmong, isHotspotCandidate, looksLikeBarrelPath } from './hotspots.ts';

export const AFFECTED_TRAILER = 'Affected-criteria';
/** Above this share of the project's criteria the trailer says `all` (our convention). */
export const AFFECTED_CAP = 0.6;

export type AffectedInput = {
  /** The criteria the task covers (its own). */
  own: readonly string[];
  /** Files this branch changes against main. */
  branchFiles: readonly string[];
  /** Merged tasks: code and the files they changed. */
  footprints: readonly { code: string; files: readonly { path: string }[] }[];
  /** The feature each task is based on. */
  taskFeature: ReadonlyMap<string, string>;
  /** The criteria codes of each feature's current approved version. */
  featureCriteria: ReadonlyMap<string, readonly string[]>;
  /** Every criterion code of the project. */
  all: readonly string[];
  /** The branch files that are barrels (re-export only); without it the path heuristic decides (`looksLikeBarrelPath`). */
  barrels?: ReadonlySet<string>;
};

export type Affected = string[] | 'all' | null;

/** Pure. A sorted list of codes, `all` over the cap, or null when there is nothing to compute. */
export function affectedCriteria(input: AffectedInput): Affected {
  const total = new Set(input.all).size;
  if (total === 0 && input.own.length === 0) return null;
  const isBarrel = (p: string) => (input.barrels ? input.barrels.has(p) : looksLikeBarrelPath(p));
  const files = new Set(input.branchFiles.filter((p) => isHotspotCandidate(p) && !isBarrel(p)));
  const out = new Set(input.own);
  if (files.size > 0) {
    for (const fp of input.footprints) {
      if (!fp.files.some((f) => files.has(f.path))) continue;
      const feature = input.taskFeature.get(fp.code);
      for (const c of (feature ? input.featureCriteria.get(feature) : undefined) ?? []) out.add(c);
    }
  }
  if (out.size === 0) return null;
  if (total > 0 && out.size > AFFECTED_CAP * total) return 'all';
  return [...out].sort();
}

/** The trailer paragraph to append to a commit message ('' when there is nothing to say). */
export function affectedTrailer(affected: Affected): string {
  if (affected === null) return '';
  return `${AFFECTED_TRAILER}: ${affected === 'all' ? 'all' : affected.join(' ')}`;
}

/** The message with the trailer in its own final paragraph. */
export const withAffectedTrailer = (message: string, affected: Affected): string => {
  const trailer = affectedTrailer(affected);
  return trailer ? `${message.trimEnd()}\n\n${trailer}\n` : message;
};

/** Loads the data and computes. Fail safe: any error gives null (no trailer; CI runs the full suite). */
export async function loadAffectedCriteria(db: Db, projectId: string, task: { id: string; versionId?: string | null }, branchFiles: readonly string[]): Promise<Affected> {
  try {
    let own = await taskCoversOf(db, task.id);
    if (own.length === 0 && task.versionId) {
      own = (await db.selectFrom('criteria').select('code').where('record_version_id', '=', task.versionId).execute()).map((c) => c.code);
    }
    const rows = await db
      .selectFrom('records')
      .innerJoin('record_versions as v', 'v.record_id', 'records.id')
      .innerJoin('criteria as c', 'c.record_version_id', 'v.id')
      .select(['records.code as feature', 'v.n', 'c.code'])
      .where('records.project_id', '=', projectId)
      .where('records.type', '=', 'fdr')
      .where('v.state', '=', 'approved')
      .execute();
    const latest = new Map<string, number>();
    for (const r of rows) latest.set(r.feature, Math.max(latest.get(r.feature) ?? 0, r.n));
    const featureCriteria = new Map<string, string[]>();
    for (const r of rows) if (r.n === latest.get(r.feature)) featureCriteria.set(r.feature, [...(featureCriteria.get(r.feature) ?? []), r.code]);
    const deps = await loadTaskDependencies(db, projectId);
    const footprints = await taskFootprints(db, projectId);
    return affectedCriteria({ own, branchFiles, footprints, taskFeature: deps.taskFeature, featureCriteria, all: [...featureCriteria.values()].flat(), barrels: await barrelsAmong(db, projectId, branchFiles) });
  } catch {
    return null;
  }
}
