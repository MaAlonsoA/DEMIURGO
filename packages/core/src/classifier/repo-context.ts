// What Jev may know about the project's code when it judges a task: a deterministic reading of the
// project's own repository at its base commit, never a guess. Two pieces go into a request's state:
//
// - `project_stack.ci`: one sentence on what the project's CI really runs (and what it cannot offer:
//   no deployed environment, no device, no person), derived from `.github/workflows/*.yml` and
//   `package.json`. The testability check needs it to tell «a CI test can decide this» from «this needs
//   production or a person».
// - `repository`: the migrations, the tables and columns the migrations create, and the server,
//   route and page files. The layers guess needs it to tell «reads existing tables» from «needs a new
//   table».
//
// A Jev A/B audit on 35 criteria and 30 merged tasks of «Comidas y entrenos» (01-10-2026) measured that
// both pieces raise accuracy; the path patterns below follow the Next.js App Router layout of that
// project and degrade to empty lists elsewhere (convención nuestra). Everything here is best effort:
// anything unreadable gives null and the request goes out without the field.

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import type { Db } from '../db/connection.ts';
import { projectsDir } from '../repo/repo.ts';

const run = promisify(execFile);
const git = async (dir: string, args: string[]): Promise<string> =>
  (await run('git', ['-c', 'safe.directory=*', '-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout;

/** Caps, so a large repository never blows the 64k-token context (convención nuestra). */
const MAX_FILES = 200;
const MAX_TABLES = 80;
const MAX_COLUMNS = 60;

export type ProjectStack = { ci: string };
export type DatabaseTable = { table: string; columns: string[] };
export type RepositoryContext = {
  migrations: string[];
  database_tables: DatabaseTable[];
  server_modules: string[];
  server_actions: string[];
  route_handlers: string[];
  pages: string[];
  ui_components: string[];
};
export type RepoContext = { project_stack: ProjectStack | null; repository: RepositoryContext };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The tables a set of migration texts creates, with their columns (CREATE TABLE, then ADD COLUMN). */
export function tablesFromMigrations(sqls: readonly string[]): DatabaseTable[] {
  const tables: DatabaseTable[] = [];
  for (const sql of sqls) {
    for (const x of sql.matchAll(/create table (?:if not exists )?(?:"?public"?\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\);/gi)) {
      const columns = (x[2] ?? '')
        .split('\n')
        .map((l) => l.trim().split(/\s+/)[0] ?? '')
        .filter((c) => c && !/^(constraint|primary|unique|check|foreign|--)/i.test(c))
        .map((c) => c.replace(/,$/, '').replace(/"/g, ''));
      tables.push({ table: x[1] as string, columns });
    }
    for (const x of sql.matchAll(/alter table (?:only )?(?:if exists )?(?:"?public"?\.)?"?([a-z_0-9]+)"?\s+add column (?:if not exists )?"?([a-z_0-9]+)"?/gi)) {
      const t = tables.find((y) => y.table === x[1]);
      if (t && !t.columns.includes(x[2] as string)) t.columns.push(x[2] as string);
    }
  }
  return tables.slice(0, MAX_TABLES).map((t) => ({ table: t.table, columns: t.columns.slice(0, MAX_COLUMNS) }));
}

const isTest = (f: string): boolean => /\.(test|spec)\.[jt]sx?$/.test(f);

/** The repository summary Jev reads, from the file list and the text of the migrations. */
export function repositoryFrom(files: readonly string[], migrationSql: readonly string[]): RepositoryContext {
  const cap = (xs: string[]) => xs.slice(0, MAX_FILES);
  const migrations = files.filter((f) => /(^|\/)migrations\/.*\.sql$/.test(f));
  return {
    migrations: cap(migrations.map((m) => m.replace(/^.*?migrations\//, ''))),
    database_tables: tablesFromMigrations(migrationSql),
    server_modules: cap(files.filter((f) => f.startsWith('src/server/') && !isTest(f))),
    server_actions: cap(files.filter((f) => /^src\/app\/.*actions[^/]*\.ts$/.test(f) && !isTest(f))),
    route_handlers: cap(files.filter((f) => /^src\/app\/.*route\.ts$/.test(f))),
    pages: cap(files.filter((f) => /^src\/app\/.*page\.tsx$/.test(f))),
    ui_components: cap(files.filter((f) => /^src\/(app|design-system)\/.*\.tsx$/.test(f) && !/page\.tsx$/.test(f) && !isTest(f))),
  };
}

const TEST_TOOLS: [string, RegExp][] = [
  ['Vitest', /\bvitest\b/i],
  ['Jest', /\bjest\b/i],
  ['Cypress', /\bcypress\b/i],
];

/**
 * One sentence on what the project's CI runs, from its workflow and package.json. Null when the
 * workflow is not one we understand. The closing clause is true of every CI pipeline: it runs on a
 * CI machine, with no deployed environment, no real device and no person.
 */
export function describeCi(workflowYaml: string, packageJson: string | null, files: readonly string[]): string | null {
  let doc: unknown;
  try {
    doc = parse(workflowYaml);
  } catch {
    return null;
  }
  if (!isRecord(doc) || !isRecord(doc.jobs)) return null;
  const runs: string[] = [];
  const services: string[] = [];
  for (const job of Object.values(doc.jobs)) {
    if (!isRecord(job)) continue;
    if (isRecord(job.services)) {
      for (const raw of Object.values(job.services)) {
        const image = isRecord(raw) && typeof raw.image === 'string' ? raw.image : null;
        if (!image) continue;
        const [name = '', tag] = image.split(':');
        const base = name.split('/').at(-1) ?? name;
        services.push(`ephemeral ${base === 'postgres' ? 'Postgres' : base}${tag && /^\d/.test(tag) ? ` ${tag.split('-')[0]}` : ''}`);
      }
    }
    for (const step of Array.isArray(job.steps) ? job.steps : []) if (isRecord(step) && typeof step.run === 'string') runs.push(step.run);
  }
  if (runs.length === 0 && services.length === 0) return null;
  let pkg: Record<string, unknown> = {};
  try {
    const p: unknown = packageJson ? JSON.parse(packageJson) : {};
    if (isRecord(p)) pkg = p;
  } catch {
    // no readable package.json: the workflow alone describes the CI
  }
  const scripts = isRecord(pkg.scripts) ? Object.values(pkg.scripts).filter((s): s is string => typeof s === 'string') : [];
  const deps = [...Object.keys(isRecord(pkg.dependencies) ? pkg.dependencies : {}), ...Object.keys(isRecord(pkg.devDependencies) ? pkg.devDependencies : {})];
  const haystack = `${runs.join('\n')}\n${scripts.join('\n')}\n${deps.join('\n')}`;
  const ranText = runs.join('\n');

  const runs_: string[] = [];
  if (/\btsc\b|typecheck|type-check/.test(ranText)) runs_.push('type check');
  if (/\bbuild\b/.test(ranText)) runs_.push('production build');
  runs_.push(...services);
  for (const [label, re] of TEST_TOOLS) if (re.test(haystack)) runs_.push(label);
  if (/playwright/i.test(haystack)) {
    runs_.push(`Playwright end-to-end tests${/axe-core/i.test(haystack) ? ' with axe accessibility checks' : ''} against the app running on the CI machine`);
  }
  const fakes = files.some((f) => /(^|\/)(fakes?|mocks?|stubs?)([-_./]|$)/i.test(f) || /(^|\/)(fake|mock|stub)[-_.][^/]*$/i.test(f));
  const parts = [`GitHub Actions${runs_.length ? `: ${runs_.join(', ')}` : ''}`];
  if (fakes) parts.push('external services replaced by local fakes');
  return `${parts.join('; ')}; no deployed environment, no real device or network conditions, no person.`;
}

/** The project's repository folder, or null when it has none (or no projects directory). */
export async function projectRepoDir(db: Db, projectId: string): Promise<string | null> {
  const root = projectsDir();
  if (!root) return null;
  const row = await db.selectFrom('project_repos').select('dir').where('project_id', '=', projectId).executeTakeFirst();
  return row ? join(root, row.dir) : null;
}

async function firstRev(dir: string, revs: readonly string[]): Promise<string | null> {
  for (const rev of revs) {
    try {
      await git(dir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
      return rev;
    } catch {
      // try the next one
    }
  }
  return null;
}

const show = (dir: string, rev: string, path: string): Promise<string | null> => git(dir, ['show', `${rev}:${path}`]).then((s) => s, () => null);

/**
 * Reads the repository at `rev` (default: the project's base: origin/main, else main, else HEAD).
 * Null when there is no repository, no such commit or git fails: callers then omit the fields.
 */
export async function readRepoContext(dir: string, rev?: string): Promise<RepoContext | null> {
  try {
    const at = await firstRev(dir, rev ? [rev] : ['origin/main', 'main', 'HEAD']);
    if (!at) return null;
    const files = (await git(dir, ['ls-tree', '-r', '--name-only', at])).split('\n').filter(Boolean);
    const migrationFiles = files.filter((f) => /(^|\/)migrations\/.*\.sql$/.test(f)).sort();
    const sqls = (await Promise.all(migrationFiles.map((f) => show(dir, at, f)))).filter((s): s is string => s !== null);
    const workflow = files.includes('.github/workflows/ci.yml') ? await show(dir, at, '.github/workflows/ci.yml') : null;
    const ci = workflow === null ? null : describeCi(workflow, await show(dir, at, 'package.json'), files);
    return { project_stack: ci ? { ci } : null, repository: repositoryFrom(files, sqls) };
  } catch {
    return null;
  }
}

/** The project's repository context at its base commit; null when unavailable. */
export async function loadRepoContext(db: Db, projectId: string, rev?: string): Promise<RepoContext | null> {
  const dir = await projectRepoDir(db, projectId);
  return dir ? readRepoContext(dir, rev) : null;
}
