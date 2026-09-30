// Per-project development snapshots: one project's rows (every table with a project_id, plus the
// project itself) copied into a small database of the same cluster, and put back later without
// touching the other projects or restarting the core. Development tooling only. Like the whole-database
// tool, a restore rewrites the event log of that project, which the product never does: the copy runs
// with session_replication_role = replica (FKs and append-only triggers off; the role is superuser).

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DomainError } from '@demiurgo/domain';
import { type Client, escapeIdentifier, escapeLiteral } from 'pg';
import { z } from 'zod';
import { connect } from '../db/connection.ts';
import { migrate } from '../db/migrator.ts';
import { projectsDir } from '../repo/repo.ts';
import { MAX_NAME, SNAPSHOT_PREFIX, type SnapshotTarget, snapshotName, urlWith, withClient } from './snapshots.ts';

export const PROJECT_SNAPSHOT_PREFIX = 'dmg_psnap_';

const CHUNK = 2000;
const id = escapeIdentifier;
const run = promisify(execFile);
const git = (dir: string, args: string[]) => run('git', ['-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 });

/** Work in progress that blocks a restore or a delete: runs not finished, build requests still open. */
const OPEN_RUN_STATES = ['queued', 'running'];
const OPEN_BUILD_STATES = ['requested', 'in_review'];

const gitState = z.object({ repo_dir: z.string(), head: z.string() });
export type ProjectGitState = z.infer<typeof gitState>;

const metadata = z.object({
  label: z.string(),
  created_at: z.string(),
  source: z.string(),
  migration: z.string().nullable(),
  project: z.object({ id: z.string(), name: z.string(), events: z.number() }),
  git: gitState.nullable(),
});
type Metadata = z.infer<typeof metadata>;

export type ProjectSnapshot = Metadata & { name: string; size_bytes: number };

export type RestoreResult = { restored: ProjectSnapshot; git: string };

/** The prefix of project snapshots for a target: the standard one, or a derived one (tests) so each target cleans up its own. */
function prefixOf(t: SnapshotTarget): string {
  return t.prefix === SNAPSHOT_PREFIX ? PROJECT_SNAPSHOT_PREFIX : `${t.prefix}p_`;
}

function isProjectSnapshotName(t: SnapshotTarget, name: string): boolean {
  return name.length <= MAX_NAME && new RegExp(`^${prefixOf(t)}\\d{8}_\\d{6}_[a-z0-9_]+$`).test(name);
}

type TableInfo = { name: string; key: 'project_id' | 'id'; columns: string[]; identity: string[] };

/** Every table of `public` holding project data (a project_id column), plus `projects` itself. */
export async function projectTables(client: Client): Promise<TableInfo[]> {
  const { rows } = await client.query<{ name: string; key: string }>(
    `select c.relname as name, 'project_id' as key
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'project_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      union all select 'projects', 'id'
      order by 1`,
  );
  const tables: TableInfo[] = [];
  for (const r of rows) {
    const cols = await client.query<{ name: string; generated: boolean; identity: string }>(
      `select attname as name, attgenerated <> '' as generated, attidentity::text as identity
         from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`,
      [`public.${id(r.name)}`],
    );
    tables.push({
      name: r.name,
      key: r.key === 'id' ? 'id' : 'project_id',
      columns: cols.rows.filter((c) => !c.generated).map((c) => c.name),
      identity: cols.rows.filter((c) => c.identity === 'a' || c.identity === 'd').map((c) => c.name),
    });
  }
  return tables;
}

/** The other database's tables, reduced to the columns both sides have. */
function common(mine: TableInfo[], theirs: TableInfo[]): TableInfo[] {
  const out: TableInfo[] = [];
  for (const m of mine) {
    const o = theirs.find((x) => x.name === m.name);
    if (!o) continue;
    const cols = m.columns.filter((c) => o.columns.includes(c));
    out.push({ ...m, columns: cols, identity: m.identity.filter((c) => cols.includes(c)) });
  }
  return out;
}

async function begin(c: Client, readOnly: boolean): Promise<void> {
  await c.query(readOnly ? 'begin isolation level repeatable read read only' : 'begin');
  if (!readOnly) await c.query('set local session_replication_role = replica');
}

/** Copies the project's rows of one table from `src` to `dst` (the latter inside a transaction with replica role). */
async function copyTable(src: Client, dst: Client, t: TableInfo, projectId: string): Promise<number> {
  const cols = t.columns.map(id).join(', ');
  const overriding = t.identity.length > 0 ? ' overriding system value' : '';
  let copied = 0;
  for (let offset = 0; ; offset += CHUNK) {
    const { rows } = await src.query<{ j: string; n: number }>(
      `select coalesce(json_agg(r), '[]')::text as j, count(*)::int as n
         from (select * from ${id(t.name)} where ${id(t.key)} = $1 order by ctid limit $2 offset $3) r`,
      [projectId, CHUNK, offset],
    );
    const chunk = rows[0];
    if (!chunk || chunk.n === 0) break;
    await dst.query(
      `insert into ${id(t.name)} (${cols})${overriding}
       select ${cols} from json_populate_recordset(null::${id(t.name)}, $1::json)`,
      [chunk.j],
    );
    copied += chunk.n;
    if (chunk.n < CHUNK) break;
  }
  return copied;
}

/** Identity sequences never go back: after inserting explicit values the next insert must not collide. */
async function fixSequences(c: Client, tables: TableInfo[]): Promise<void> {
  for (const t of tables) {
    for (const col of t.identity) {
      await c.query(
        `select setval(s, greatest((select coalesce(max(${id(col)}), 1) from ${id(t.name)}), coalesce(pg_sequence_last_value(s), 1)))
           from (select pg_get_serial_sequence($1, $2)::regclass as s) q where s is not null`,
        [`public.${id(t.name)}`, col],
      );
    }
  }
}

/** Deletes every row of the project, `projects` last. Returns the count per table (only tables with rows). */
async function deleteRows(c: Client, tables: TableInfo[], projectId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const ordered = [...tables.filter((t) => t.name !== 'projects'), ...tables.filter((t) => t.name === 'projects')];
  for (const t of ordered) {
    const r = await c.query(`delete from ${id(t.name)} where ${id(t.key)} = $1`, [projectId]);
    if (r.rowCount) counts[t.name] = r.rowCount;
  }
  return counts;
}

async function migrateDatabase(url: string): Promise<void> {
  const c = connect(url, 1);
  try {
    await migrate(c.pool);
  } finally {
    await c.close();
  }
}

async function createWithTemplate(admin: Client, name: string, template: string): Promise<void> {
  // The template must be idle; the backends of its last user exit a moment after they disconnect.
  for (let i = 0; ; i++) {
    try {
      await admin.query(`create database ${id(name)} template ${id(template)}`);
      return;
    } catch (e) {
      if ((e as { code?: string }).code === '55006' && i < 100) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      throw e;
    }
  }
}

function parseMetadata(comment: string | null): Metadata | null {
  if (!comment) return null;
  try {
    const r = metadata.safeParse(JSON.parse(comment));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The project's checkout folder (absolute) when the instance writes repositories and the project has one. */
export async function projectRepoDir(t: SnapshotTarget, projectId: string): Promise<string | null> {
  const root = projectsDir();
  if (!root) return null;
  const { rows } = await withClient(t.databaseUrl, (c) =>
    c.query<{ dir: string }>('select dir from project_repos where project_id = $1', [projectId]),
  );
  return rows[0] ? join(root, rows[0].dir) : null;
}

/** Local git state of a checkout: its folder and HEAD. Null when it is not a repository (or has no commit). */
export async function projectGitState(repoDir: string | null): Promise<ProjectGitState | null> {
  if (!repoDir || !existsSync(repoDir)) return null;
  try {
    const { stdout } = await git(repoDir, ['rev-parse', 'HEAD']);
    const head = stdout.trim();
    return head ? { repo_dir: repoDir, head } : null;
  } catch {
    return null;
  }
}

/** Saves one project. `git` undefined: computed from the project's checkout; null: the snapshot carries none. */
export async function saveProjectSnapshot(
  t: SnapshotTarget,
  projectId: string,
  label: string,
  git?: ProjectGitState | null,
  at: Date = new Date(),
): Promise<ProjectSnapshot> {
  const tidy = label.trim() || 'snapshot';
  const name = snapshotName(prefixOf(t), tidy, at);
  const gitInfo = git === undefined ? await projectGitState(await projectRepoDir(t, projectId)) : git;
  const snapUrl = urlWith(t.databaseUrl, name);
  await withClient(t.adminUrl, async (admin) => {
    try {
      await admin.query(`create database ${id(name)}`);
    } catch (e) {
      if ((e as { code?: string }).code === '42P04') throw new DomainError('conflict', 'A snapshot with that name already exists.');
      throw e;
    }
    try {
      await migrateDatabase(snapUrl);
      await withClient(t.databaseUrl, (src) =>
        withClient(snapUrl, async (dst) => {
          await begin(src, true);
          try {
            const project = await src.query<{ name: string; events: string }>(
              'select name, event_seq::text as events from projects where id = $1',
              [projectId],
            );
            const p = project.rows[0];
            if (!p) throw new DomainError('not_found', 'There is no such project.');
            const migration = await src.query<{ version: string | null }>('select max(version) as version from schema_migrations');
            const tables = common(await projectTables(src), await projectTables(dst));
            await begin(dst, false);
            for (const tbl of tables) await copyTable(src, dst, tbl, projectId);
            await fixSequences(dst, tables);
            await dst.query('commit');
            const meta: Metadata = {
              label: tidy,
              created_at: at.toISOString(),
              source: t.database,
              migration: migration.rows[0]?.version ?? null,
              project: { id: projectId, name: p.name, events: Number(p.events) },
              git: gitInfo,
            };
            await admin.query(`comment on database ${id(name)} is ${escapeLiteral(JSON.stringify(meta))}`);
          } catch (e) {
            await dst.query('rollback').catch(() => undefined);
            throw e;
          } finally {
            await src.query('rollback').catch(() => undefined);
          }
        }),
      );
    } catch (e) {
      await admin.query(`drop database if exists ${id(name)} with (force)`);
      throw e;
    }
  });
  const list = await listProjectSnapshots(t, projectId);
  const saved = list.find((s) => s.name === name);
  if (!saved) throw new DomainError('conflict', 'The snapshot was saved but cannot be read back.');
  return saved;
}

/** Project snapshots of this database, newest first (only one project's when `projectId` is given). */
export async function listProjectSnapshots(t: SnapshotTarget, projectId?: string): Promise<ProjectSnapshot[]> {
  const { rows } = await withClient(t.adminUrl, (c) =>
    c.query<{ name: string; comment: string | null; size: string }>(
      `select datname as name, shobj_description(oid, 'pg_database') as comment, pg_database_size(oid)::text as size
         from pg_database where starts_with(datname, $1)`,
      [prefixOf(t)],
    ),
  );
  const out: ProjectSnapshot[] = [];
  for (const r of rows) {
    const meta = isProjectSnapshotName(t, r.name) ? parseMetadata(r.comment) : null;
    if (!meta || meta.source !== t.database) continue;
    if (projectId && meta.project.id !== projectId) continue;
    out.push({ name: r.name, ...meta, size_bytes: Number(r.size) });
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.name.localeCompare(a.name));
}

/** A project snapshot by name or, failing that, the newest one with that label. */
export async function findProjectSnapshot(t: SnapshotTarget, ref: string): Promise<ProjectSnapshot> {
  const all = await listProjectSnapshots(t);
  const found = isProjectSnapshotName(t, ref) ? all.find((s) => s.name === ref) : all.find((s) => s.label === ref);
  if (!found) throw new DomainError('not_found', `There is no project snapshot "${ref}" of ${t.database}.`);
  return found;
}

/** Refuses while the live project has runs queued or running, or build requests requested or in review. */
async function requireNoWorkInProgress(c: Client, projectId: string): Promise<void> {
  const runs = await c.query<{ n: number }>('select count(*)::int as n from ai_runs where project_id = $1 and state = any($2)', [
    projectId,
    OPEN_RUN_STATES,
  ]);
  const builds = await c.query<{ n: number }>(
    'select count(*)::int as n from build_requests where project_id = $1 and state = any($2)',
    [projectId, OPEN_BUILD_STATES],
  );
  const reasons: string[] = [];
  if (runs.rows[0]?.n) reasons.push(`${runs.rows[0].n} agent run(s) queued or running`);
  if (builds.rows[0]?.n) reasons.push(`${builds.rows[0].n} build request(s) requested or in review`);
  if (reasons.length > 0) {
    throw new DomainError('conflict', 'The project has work in progress: wait for it to finish or cancel it first.', reasons);
  }
}

async function restoreGit(snapshot: ProjectSnapshot): Promise<string> {
  const g = snapshot.git;
  const tail = ' GitHub itself is not rewound.';
  if (!g) return `The snapshot has no local repository: the folder was left alone.${tail}`;
  if (!existsSync(g.repo_dir)) return `The checkout ${g.repo_dir} no longer exists: nothing was done locally.${tail}`;
  try {
    await git(g.repo_dir, ['cat-file', '-e', `${g.head}^{commit}`]);
    await git(g.repo_dir, ['reset', '--hard', g.head]);
    await git(g.repo_dir, ['worktree', 'prune']);
    return `Local checkout ${g.repo_dir} reset to ${g.head.slice(0, 8)} and worktrees pruned.${tail}`;
  } catch (e) {
    return `The local checkout could not be reset to ${g.head.slice(0, 8)} (${e instanceof Error ? e.message.split('\n')[0] : 'git failed'}).${tail}`;
  }
}

/** Puts one project back as it was in the snapshot; the other projects are untouched. */
export async function restoreProjectSnapshot(t: SnapshotTarget, ref: string): Promise<RestoreResult> {
  const snapshot = await findProjectSnapshot(t, ref);
  const projectId = snapshot.project.id;
  const tmp = `${prefixOf(t)}tmp_${randomBytes(4).toString('hex')}`;
  await withClient(t.adminUrl, async (admin) => {
    await createWithTemplate(admin, tmp, snapshot.name);
    try {
      const tmpUrl = urlWith(t.databaseUrl, tmp);
      await migrateDatabase(tmpUrl);
      await withClient(tmpUrl, (src) =>
        withClient(t.databaseUrl, async (live) => {
          const tables = common(await projectTables(live), await projectTables(src));
          await requireNoWorkInProgress(live, projectId);
          await begin(live, false);
          try {
            await requireNoWorkInProgress(live, projectId);
            await deleteRows(live, tables, projectId);
            for (const tbl of tables) await copyTable(src, live, tbl, projectId);
            await fixSequences(live, tables);
            await live.query('commit');
          } catch (e) {
            await live.query('rollback').catch(() => undefined);
            throw e;
          }
        }),
      );
    } finally {
      await admin.query(`drop database if exists ${id(tmp)} with (force)`);
    }
  });
  return { restored: snapshot, git: await restoreGit(snapshot) };
}

/** Removes the project and everything in it from the live database (development only). */
export async function deleteProjectData(t: SnapshotTarget, projectId: string): Promise<Record<string, number>> {
  return withClient(t.databaseUrl, async (live) => {
    const tables = await projectTables(live);
    await begin(live, false);
    try {
      const exists = await live.query('select 1 from projects where id = $1', [projectId]);
      if (exists.rowCount === 0) throw new DomainError('not_found', 'There is no such project.');
      await requireNoWorkInProgress(live, projectId);
      const counts = await deleteRows(live, tables, projectId);
      await live.query('commit');
      return counts;
    } catch (e) {
      await live.query('rollback').catch(() => undefined);
      throw e;
    }
  });
}

export async function dropProjectSnapshot(t: SnapshotTarget, ref: string): Promise<ProjectSnapshot> {
  const snapshot = await findProjectSnapshot(t, ref);
  await withClient(t.adminUrl, (c) => c.query(`drop database if exists ${id(snapshot.name)} with (force)`));
  return snapshot;
}
