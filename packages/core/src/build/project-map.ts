// The project's code map: how features map onto code, so the person can plan what can be built in parallel.
// For each feature, the files its merged tasks changed (grouped by folder); the hotspots (files many merged
// tasks changed) with the features that share them; and the owners of tables and routes. Practices: code
// ownership by path (GitHub CODEOWNERS, Google OWNERS files; here the owner is the feature that first added
// a table or a route, see ownership.ts) and hotspot analysis by change frequency (Adam Tornhill, "Your Code
// as a Crime Scene"; thresholds in hotspots.ts, convención nuestra). Derived on read, nothing is stored.

import { posix } from 'node:path';
import type { Db } from '../db/connection.ts';
import { projectRepoDir } from '../classifier/repo-context.ts';
import { loadTaskDependencies } from '../queries/task-deps.ts';
import { isReusableFile, taskFootprints, type TaskFootprint } from './footprint.ts';
import { hotspotCounts, isHotspot } from './hotspots.ts';
import { moduleOwners, type Owners } from './ownership.ts';

/** Most hotspots listed (convención nuestra: a screen, not an audit). */
export const MAX_MAP_HOTSPOTS = 25;

export type MapFeature = {
  code: string;
  title: string;
  tasks: { code: string; title: string }[];
  /** Files changed by its merged tasks, grouped by folder (noise such as lockfiles left out). */
  folders: { dir: string; files: string[] }[];
};
export type MapHotspot = { path: string; tasks: number; of: number; features: string[] };
export type MapOwner = { name: string; feature: string; task: string };
export type ProjectMap = {
  merged_tasks: number;
  hotspots: MapHotspot[];
  features: MapFeature[];
  tables: MapOwner[];
  routes: MapOwner[];
};

export type ProjectMapInput = {
  footprints: readonly TaskFootprint[];
  /** The feature each task is based on. */
  taskFeature: ReadonlyMap<string, string>;
  featureTitles: ReadonlyMap<string, string>;
  owners: Owners;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure: the code map from the footprints of the merged tasks, their features and the owners. */
export function buildProjectMap(input: ProjectMapInput): ProjectMap {
  const { footprints, taskFeature, featureTitles, owners } = input;
  const featureOf = (code: string) => taskFeature.get(code) ?? null;

  const sharing = new Map<string, Set<string>>();
  for (const fp of footprints) {
    const feature = featureOf(fp.code);
    if (!feature) continue;
    for (const f of fp.files) {
      if (!sharing.has(f.path)) sharing.set(f.path, new Set());
      sharing.get(f.path)?.add(feature);
    }
  }
  const hotspots = hotspotCounts(footprints)
    .filter((h) => isHotspot(h))
    .slice(0, MAX_MAP_HOTSPOTS)
    .map((h) => ({ ...h, features: [...(sharing.get(h.path) ?? [])].sort(byText) }));

  const perFeature = new Map<string, { tasks: { code: string; title: string }[]; files: Set<string> }>();
  for (const fp of footprints) {
    const feature = featureOf(fp.code);
    if (!feature) continue;
    const entry = perFeature.get(feature) ?? { tasks: [], files: new Set<string>() };
    entry.tasks.push({ code: fp.code, title: fp.title });
    for (const f of fp.files) if (isReusableFile(f.path)) entry.files.add(f.path);
    perFeature.set(feature, entry);
  }
  const features = [...perFeature.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([code, e]) => {
      const dirs = new Map<string, string[]>();
      for (const path of [...e.files].sort(byText)) {
        const dir = posix.dirname(path);
        dirs.set(dir, [...(dirs.get(dir) ?? []), posix.basename(path)]);
      }
      return {
        code,
        title: featureTitles.get(code) ?? code,
        tasks: e.tasks,
        folders: [...dirs.entries()].map(([dir, files]) => ({ dir: dir === '.' ? '/' : dir, files })),
      };
    });

  const list = (m: ReadonlyMap<string, { feature: string; task: string }>): MapOwner[] =>
    [...m.entries()].map(([name, o]) => ({ name, feature: o.feature, task: o.task })).sort((a, b) => byText(a.name, b.name));
  return { merged_tasks: footprints.length, hotspots, features, tables: list(owners.tables), routes: list(owners.routes) };
}

/** Loads the footprints, features and owners of a project and builds its map. */
export async function loadProjectMap(db: Db, projectId: string): Promise<ProjectMap> {
  const footprints = await taskFootprints(db, projectId);
  if (footprints.length === 0) return buildProjectMap({ footprints, taskFeature: new Map(), featureTitles: new Map(), owners: { tables: new Map(), routes: new Map() } });
  const deps = await loadTaskDependencies(db, projectId);
  const repoDir = await projectRepoDir(db, projectId);
  const owners = await moduleOwners(db, projectId, repoDir ? { repoDir } : {}).catch(() => ({ tables: new Map(), routes: new Map() }) as Owners);
  const rows = await db
    .selectFrom('records')
    .innerJoin('record_versions as v', 'v.record_id', 'records.id')
    .select(['records.code', 'v.title', 'v.n'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'fdr')
    .where('v.state', '=', 'approved')
    .orderBy('v.n')
    .execute();
  const featureTitles = new Map<string, string>();
  for (const r of rows) featureTitles.set(r.code, r.title);
  return buildProjectMap({ footprints, taskFeature: deps.taskFeature, featureTitles, owners });
}
