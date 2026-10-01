// What is already built, for the design agents (`feature_design` and `task_plan` packs): per feature of the project
// the merged tasks with the files each added or changed, the screens, routes, tables and migrations it owns and its
// criteria with their verification level, plus whether a deployment is recorded. The design agents used to see none of
// it and wrote «if the day view already exists, extend it; otherwise create it», or a feature that extends another
// without saying so. The practice is the context map (Evans, Domain-Driven Design, ch. 14: «describe the points of
// contact between the models») and tracing what a change touches (Bohner & Arnold, Software Change Impact Analysis,
// 1996). Everything comes from the footprints of merged tasks, nothing is stored. The caps are our convention: one
// compact line per piece so the pack stays small, with the count of what was left out.

import type { Db } from '../db/connection.ts';
import { kindOfPath, routeOfPath } from '../build/code-map.ts';
import { isReusableFile, taskFootprints, type TaskFootprint } from '../build/footprint.ts';
import { moduleOwners } from '../build/ownership.ts';
import { loadTaskDependencies } from '../queries/task-deps.ts';

/** Caps of the pack section (convención nuestra). */
export const BUILT_STATE_CAP = { features: 30, tasks: 12, files: 8, pieces: 10, criteria: 20, evidence: 5 } as const;

export type BuiltTask = { code: string; title: string; files_owned: string[]; files_touched: string[]; omitted_files: number };
export type BuiltFeature = {
  code: string;
  title: string;
  tasks: BuiltTask[];
  omitted_tasks: number;
  screens: string[];
  routes: string[];
  tables: string[];
  migrations: string[];
  criteria: { code: string; verification: string }[];
  omitted_criteria: number;
};
export type BuiltState = { features: BuiltFeature[]; omitted_features: number };

const capped = <T>(xs: readonly T[], n: number): { kept: T[]; omitted: number } => ({ kept: xs.slice(0, n), omitted: Math.max(0, xs.length - n) });

/** The screens, routes and migrations of the files a task added; the files it added and the ones it changed. Pure. */
export function piecesOfFiles(files: readonly { path: string; status: string }[]): {
  owned: string[];
  touched: string[];
  screens: string[];
  routes: string[];
  migrations: string[];
} {
  const useful = files.filter((f) => isReusableFile(f.path) && kindOfPath(f.path) !== 'test');
  const owned = useful.filter((f) => f.status === 'added').map((f) => f.path);
  const touched = useful.filter((f) => f.status !== 'added' && f.status !== 'removed').map((f) => f.path);
  const screens: string[] = [];
  const routes: string[] = [];
  for (const p of owned) {
    const kind = kindOfPath(p);
    const route = routeOfPath(p);
    if (kind === 'page' && route) screens.push(route);
    else if (kind === 'route' && route) routes.push(route);
  }
  return { owned, touched, screens, routes, migrations: owned.filter((p) => p.endsWith('.sql')) };
}

/** Pure: groups merged footprints by feature into the compact state. `features` is every other feature with its title and criteria. */
export function builtStateOf(input: {
  features: { code: string; title: string; criteria: { code: string; verification: string }[] }[];
  featureTasks: ReadonlyMap<string, readonly string[]>;
  footprints: readonly TaskFootprint[];
  tables: ReadonlyMap<string, { feature: string }>;
}): BuiltState {
  const byCode = new Map(input.footprints.map((f) => [f.code, f] as const));
  const uniq = (xs: string[]) => [...new Set(xs)];
  const out: BuiltFeature[] = input.features.map((f) => {
    const merged = (input.featureTasks.get(f.code) ?? []).map((c) => byCode.get(c)).filter((x): x is TaskFootprint => !!x);
    const tasks = capped(merged, BUILT_STATE_CAP.tasks);
    const pieces = merged.map((t) => piecesOfFiles(t.files));
    const crit = capped(f.criteria, BUILT_STATE_CAP.criteria);
    return {
      code: f.code,
      title: f.title,
      tasks: tasks.kept.map((t, i) => {
        const p = pieces[i]!;
        const owned = capped(p.owned, BUILT_STATE_CAP.files);
        const touched = capped(p.touched, BUILT_STATE_CAP.files);
        return {
          code: t.code,
          title: t.title,
          files_owned: owned.kept,
          files_touched: touched.kept,
          omitted_files: owned.omitted + touched.omitted,
        };
      }),
      omitted_tasks: tasks.omitted,
      screens: uniq(pieces.flatMap((p) => p.screens)).slice(0, BUILT_STATE_CAP.pieces),
      routes: uniq(pieces.flatMap((p) => p.routes)).slice(0, BUILT_STATE_CAP.pieces),
      tables: [...input.tables.entries()].filter(([, o]) => o.feature === f.code).map(([name]) => name).slice(0, BUILT_STATE_CAP.pieces),
      migrations: uniq(pieces.flatMap((p) => p.migrations)).slice(0, BUILT_STATE_CAP.pieces),
      criteria: crit.kept,
      omitted_criteria: crit.omitted,
    };
  });
  // Features with something built first, then by code; the rest of the cap goes to the ones with criteria only.
  const ranked = out.sort((a, b) => Number(b.tasks.length > 0) - Number(a.tasks.length > 0) || (a.code < b.code ? -1 : 1));
  const features = capped(ranked, BUILT_STATE_CAP.features);
  return { features: features.kept, omitted_features: features.omitted };
}

/** The built state of the project's features other than `except`: their merged tasks, pieces owned and criteria. */
export async function loadBuiltState(db: Db, projectId: string, except: string | null): Promise<BuiltState> {
  const records = await db
    .selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', projectId)
    .where('type', '=', 'fdr')
    .orderBy('code')
    .execute();
  const features: Parameters<typeof builtStateOf>[0]['features'] = [];
  for (const r of records) {
    if (r.code === except) continue;
    const v = await db
      .selectFrom('record_versions')
      .select(['id', 'title'])
      .where('record_id', '=', r.id)
      .where('state', '=', 'approved')
      .orderBy('n', 'desc')
      .executeTakeFirst();
    if (!v) continue;
    const criteria = await db.selectFrom('criteria').select(['code', 'verification']).where('record_version_id', '=', v.id).orderBy('position').execute();
    features.push({ code: r.code, title: v.title, criteria });
  }
  const deps = await loadTaskDependencies(db, projectId);
  const owners = await moduleOwners(db, projectId);
  return builtStateOf({ features, featureTasks: deps.featureTasks, footprints: await taskFootprints(db, projectId), tables: owners.tables });
}

/** What records a deployment: a merged task that says so (convención nuestra). A plan to deploy is not a deployment. */
const DEPLOY_WORDS = /\b(deploy(?:ed|ment|ing)?s?|hosting|release candidate|go[- ]live|staging environment)\b/i;

export type Deployment = { recorded: boolean; evidence: { code: string; title: string }[] };

/**
 * Whether the project has a deployment recorded. DEMIURGO keeps no deployment record of its own yet, so this is a
 * heuristic (convención nuestra): a merged task whose title, Goal or Scope speaks of deploying or hosting.
 * «recorded: false» tells the designer there is no deployed
 * candidate to measure a `release` criterion against.
 */
export async function loadDeployment(db: Db, projectId: string): Promise<Deployment> {
  const evidence: { code: string; title: string }[] = [];
  const footprints = await taskFootprints(db, projectId);
  const merged = new Set(footprints.map((f) => f.code));
  const rows = await db
    .selectFrom('records')
    .innerJoin('record_versions as v', 'v.record_id', 'records.id')
    .select(['records.code', 'v.title', 'v.sections', 'v.n'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'task')
    .where('v.state', '=', 'approved')
    .orderBy('v.n')
    .execute();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(r.code, r);
  for (const r of latest.values()) {
    if (!merged.has(r.code)) continue;
    const text = `${r.title}\n${((r.sections ?? []) as { title: string; content: string }[]).filter((s) => s.title === 'Goal' || s.title === 'Scope').map((s) => s.content).join('\n')}`;
    if (DEPLOY_WORDS.test(text)) evidence.push({ code: r.code, title: r.title });
  }
  return { recorded: evidence.length > 0, evidence: evidence.slice(0, BUILT_STATE_CAP.evidence) };
}

/** The task and feature that first added each file of the project's merged work (the file's owner; convención nuestra, as in `moduleOwners`). */
export async function loadFileOwners(db: Db, projectId: string): Promise<Map<string, { task: string; feature: string }>> {
  const deps = await loadTaskDependencies(db, projectId);
  const out = new Map<string, { task: string; feature: string }>();
  for (const fp of await taskFootprints(db, projectId)) {
    const feature = deps.taskFeature.get(fp.code);
    if (!feature) continue;
    for (const f of fp.files) if (f.status === 'added' && isReusableFile(f.path) && !out.has(f.path)) out.set(f.path, { task: fp.code, feature });
  }
  return out;
}
