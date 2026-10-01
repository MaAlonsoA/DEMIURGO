// Ownership of code by feature (the guard of the orchestrator's `design` stage). The practice is code
// ownership by path: GitHub CODEOWNERS («Code owners are automatically requested for review when someone
// opens a pull request that modifies code that they own», docs.github.com) and Google's OWNERS files.
// Here the owner is the feature that first ADDED a table or a route, not a person (convención nuestra).
// A task that creates what another feature owns, or a table that clearly belongs to another feature,
// fails the attempt with feedback: to check a criterion that needs that data, the test code uses a test
// double (Meszaros, xUnit Test Patterns), or the task is asked to cover that feature.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Db } from '../db/connection.ts';
import { loadTaskDependencies } from '../queries/task-deps.ts';
import { kindOfPath, routeOfPath } from './code-map.ts';
import { taskFootprints } from './footprint.ts';

const run = promisify(execFile);

export type Owner = { feature: string; task: string };
export type Owners = { tables: Map<string, Owner>; routes: Map<string, Owner> };
export type FeatureRef = { code: string; title: string };
/** The feature whose title best matches a table name, with how many of the name's words matched. */
export type NameMatch = { feature: FeatureRef; matched: string[]; total: number };

export type OwnershipViolation = { kind: 'table' | 'route'; name: string; owner: FeatureRef; reason: 'recreated' | 'name_matches_other_feature'; message: string };

const isSql = (p: string) => p.endsWith('.sql');
const unquote = (n: string) => n.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();

/** Names of the tables a migration CREATEs (not the ones it only alters). Pure. */
export function createdTables(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, '');
  return [...new Set([...text.matchAll(/create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi)].map((m) => unquote(m[1] as string)))];
}

/** URLs of the added files that are pages or routes. Pure. */
export function routesOfFiles(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const kind = kindOfPath(p);
    if (kind !== 'page' && kind !== 'route') continue;
    const route = routeOfPath(p);
    if (route) out.add(route);
  }
  return [...out];
}

/** Adds what a merged task created to the owners: the first task to add a name owns it. Pure. */
export function addOwners(owners: Owners, input: { feature: string; task: string; tables: readonly string[]; routes: readonly string[] }): void {
  for (const t of input.tables) if (!owners.tables.has(t)) owners.tables.set(t, { feature: input.feature, task: input.task });
  for (const r of input.routes) if (!owners.routes.has(r)) owners.routes.set(r, { feature: input.feature, task: input.task });
}

const git = (dir: string, args: string[]) => run('git', ['-c', 'safe.directory=*', '-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 });

/** `git show <commit>:<path>` of the project repository; null when it is not there. */
export async function readAtCommit(repoDir: string, commit: string, path: string): Promise<string | null> {
  try {
    return (await git(repoDir, ['show', `${commit}:${path}`])).stdout;
  } catch {
    return null;
  }
}

/**
 * The owner feature of each table and route of the project: the feature of the merged task that added
 * it (a file with status `added` in its footprint; tables read from the migration at the merge commit).
 * Derived on read from the footprints, nothing is stored. Without `repoDir`, only routes are known.
 */
export async function moduleOwners(
  db: Db,
  projectId: string,
  options: { repoDir?: string; read?: (commit: string, path: string) => Promise<string | null> } = {},
): Promise<Owners> {
  const owners: Owners = { tables: new Map(), routes: new Map() };
  const footprints = await taskFootprints(db, projectId);
  if (footprints.length === 0) return owners;
  const deps = await loadTaskDependencies(db, projectId);
  const read = options.read ?? (options.repoDir ? (c: string, p: string) => readAtCommit(options.repoDir as string, c, p) : null);
  for (const fp of footprints) {
    const feature = deps.taskFeature.get(fp.code);
    if (!feature) continue;
    const added = fp.files.filter((f) => f.status === 'added').map((f) => f.path);
    const tables: string[] = [];
    if (read && fp.merge_commit) {
      for (const p of added.filter(isSql)) tables.push(...createdTables((await read(fp.merge_commit, p)) ?? ''));
    }
    addOwners(owners, { feature, task: fp.code, tables, routes: routesOfFiles(added) });
  }
  return owners;
}

/** Words that say nothing about what a table or a feature is about (our convention). */
const FILLER = new Set('a an and of the to for in on with by from as is are be new record records data entry entries item items list log id'.split(' '));
const stem = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
/** The content words of a name or a title: lowercase, plural dropped, fillers out. Pure. */
export function words(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !FILLER.has(w)).map(stem))];
}

/**
 * The feature whose title shares the most words with a table name, or null when none shares any or the
 * best two tie (conservative: when unsure, no match). Convención nuestra: simple token overlap, no
 * model. Pure.
 */
export function featureOfName(name: string, features: readonly FeatureRef[]): NameMatch | null {
  const nameWords = words(name);
  if (nameWords.length === 0) return null;
  const scored = features
    .map((feature) => {
      const title = new Set(words(feature.title));
      return { feature, matched: nameWords.filter((w) => title.has(w)) };
    })
    .filter((s) => s.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);
  const best = scored[0];
  if (!best || scored[1]?.matched.length === best.matched.length) return null;
  return { feature: best.feature, matched: best.matched, total: nameWords.length };
}

/** The task text says it stores something: then a new table may be part of its work. */
const STORAGE_WORDS = /\b(tables?|stor(e|es|ed|age)|persist(s|ed|ence)?|database|schema|columns?|migrations?|saved?|records?)\b/i;

export type OwnershipInput = {
  taskFeature: FeatureRef | null;
  /** Codes of the features the task covers (its own included): their tables and routes are fair game. */
  taskCoveredFeatures: readonly string[];
  /** Title and covered criteria of the task. */
  taskText?: string;
  addedTables: readonly string[];
  addedRoutes: readonly string[];
  owners: Owners;
  featureOfName: (name: string) => NameMatch | null;
  /** Titles of the features, to name an owner. */
  featureTitles?: ReadonlyMap<string, string>;
};

/**
 * What a change creates that belongs to another feature. Two cases, both conservative:
 * (a) it creates a table or a route another feature already owns (re-created);
 * (b) it creates a new table when the task text never mentions storage and the table name matches the
 *     title of another feature (and not the task's own, nor one the task covers).
 * Pure.
 */
export function ownershipViolations(input: OwnershipInput): OwnershipViolation[] {
  const mine = new Set([...input.taskCoveredFeatures, ...(input.taskFeature ? [input.taskFeature.code] : [])]);
  const titleOf = (code: string) => input.featureTitles?.get(code) ?? code;
  const out: OwnershipViolation[] = [];
  const recreated = (kind: 'table' | 'route', name: string, owner: Owner) => {
    const ref = { code: owner.feature, title: titleOf(owner.feature) };
    out.push({ kind, name, owner: ref, reason: 'recreated', message: `re-creates ${kind} ${name} owned by ${ref.code} (${ref.title}), added by ${owner.task}` });
  };
  for (const t of input.addedTables) {
    const owner = input.owners.tables.get(t);
    if (owner) {
      if (!mine.has(owner.feature)) recreated('table', t, owner);
      continue;
    }
    if (STORAGE_WORDS.test(input.taskText ?? '')) continue;
    const match = input.featureOfName(t);
    if (!match || mine.has(match.feature.code)) continue;
    // The own feature matching the name as well or better means it belongs here.
    const own = input.taskFeature ? featureOfName(t, [input.taskFeature]) : null;
    if (own && own.matched.length >= match.matched.length) continue;
    // Words the task itself talks about are not evidence of another feature.
    const text = new Set(words(input.taskText ?? ''));
    if (match.matched.every((w) => text.has(w))) continue;
    // More than half of the name's words must come from that feature's title.
    if (match.matched.length * 2 <= match.total) continue;
    out.push({ kind: 'table', name: t, owner: match.feature, reason: 'name_matches_other_feature', message: `creates table ${t}, whose name matches ${match.feature.code} (${match.feature.title})` });
  }
  for (const r of input.addedRoutes) {
    const owner = input.owners.routes.get(r);
    if (owner && !mine.has(owner.feature)) recreated('route', r, owner);
  }
  return out;
}

/** The feedback line for the builder (one per violation). */
export function ownershipLine(v: OwnershipViolation): string {
  return `This change creates ${v.name} that belongs to ${v.owner.code} (${v.owner.title}). Check the criterion with a test double in the test code instead (Meszaros, xUnit Test Patterns), or ask for the task to cover that feature.`;
}

export type OwnershipContext = {
  taskFeature: FeatureRef | null;
  taskCoveredFeatures: string[];
  taskText: string;
  features: FeatureRef[];
};

/** The task's feature, the features its covered criteria belong to, its text and every feature of the project. */
export async function loadOwnershipContext(db: Db, projectId: string, taskCode: string): Promise<OwnershipContext> {
  const rows = await db
    .selectFrom('records')
    .innerJoin('record_versions as v', 'v.record_id', 'records.id')
    .select(['records.id', 'records.code', 'records.type', 'v.title', 'v.n'])
    .where('records.project_id', '=', projectId)
    .where('records.type', 'in', ['fdr', 'task'])
    .where('v.state', '=', 'approved')
    .orderBy('v.n')
    .execute();
  const latest = new Map<string, { id: string; code: string; type: string; title: string }>();
  for (const r of rows) latest.set(r.code, { id: r.id, code: r.code, type: r.type, title: r.title });
  const features = [...latest.values()].filter((r) => r.type === 'fdr').map((r) => ({ code: r.code, title: r.title }));
  const task = latest.get(taskCode);
  const deps = await loadTaskDependencies(db, projectId);
  const featureCode = deps.taskFeature.get(taskCode) ?? null;
  const taskFeature = features.find((f) => f.code === featureCode) ?? null;
  const covers = task
    ? ((await db.selectFrom('task_covers').select('codes').where('record_id', '=', task.id).orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirst())?.codes ?? [])
    : [];
  const covered = new Set<string>();
  const texts: string[] = [task?.title ?? ''];
  if (covers.length > 0) {
    const crit = await db
      .selectFrom('criteria')
      .innerJoin('record_versions as v', 'v.id', 'criteria.record_version_id')
      .innerJoin('records as r', 'r.id', 'v.record_id')
      .select(['criteria.code', 'criteria.title', 'criteria.statement', 'r.code as feature'])
      .where('criteria.project_id', '=', projectId)
      .where('criteria.code', 'in', covers)
      .execute();
    for (const c of crit) {
      covered.add(c.feature);
      texts.push(c.title, c.statement);
    }
  }
  return { taskFeature, taskCoveredFeatures: [...covered], taskText: texts.join('\n'), features };
}

/** Everything the `design` stage needs: the violations of the files a branch ADDED against the project's owners. */
export async function checkOwnership(
  db: Db,
  projectId: string,
  taskCode: string,
  added: { paths: readonly string[]; read: (path: string) => Promise<string | null>; repoDir?: string },
): Promise<OwnershipViolation[]> {
  const addedTables: string[] = [];
  for (const p of added.paths.filter(isSql)) addedTables.push(...createdTables((await added.read(p)) ?? ''));
  const addedRoutes = routesOfFiles(added.paths);
  if (addedTables.length === 0 && addedRoutes.length === 0) return [];
  const ctx = await loadOwnershipContext(db, projectId, taskCode);
  const owners = await moduleOwners(db, projectId, added.repoDir ? { repoDir: added.repoDir } : {});
  return ownershipViolations({
    taskFeature: ctx.taskFeature,
    taskCoveredFeatures: ctx.taskCoveredFeatures,
    taskText: ctx.taskText,
    addedTables,
    addedRoutes,
    owners,
    featureOfName: (n) => featureOfName(n, ctx.features),
    featureTitles: new Map(ctx.features.map((f) => [f.code, f.title])),
  });
}
