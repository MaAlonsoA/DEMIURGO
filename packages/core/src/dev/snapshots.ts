// Development snapshots: copies of the whole database (domain, event log, graph and the DBOS
// schema) kept as databases of the same cluster. Development tooling only: a restore replaces the
// event log wholesale, which the product never does. Nothing here runs without DEMIURGO_DEV_TOOLS.

import { DomainError } from '@demiurgo/domain';
import { Client, escapeIdentifier, escapeLiteral } from 'pg';
import { z } from 'zod';
import { connect } from '../db/connection.ts';
import { migrate } from '../db/migrator.ts';

export const SNAPSHOT_PREFIX = 'dmg_snap_';

/** The live database, the maintenance database used to copy it, and the prefix of its snapshots. */
export type SnapshotTarget = { databaseUrl: string; adminUrl: string; database: string; prefix: string };

export type Snapshot = {
  name: string;
  label: string;
  created_at: string;
  source: string;
  migration: string | null;
  projects: { name: string; events: number }[];
  size_bytes: number;
};

export type DatabaseSession = { pid: number; application: string; client: string | null };

const MAX_NAME = 63;
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const RESERVED = new Set(['postgres', 'template0', 'template1']);

const metadata = z.object({
  label: z.string(),
  created_at: z.string(),
  source: z.string(),
  migration: z.string().nullable(),
  projects: z.array(z.object({ name: z.string(), events: z.number() })),
});
type Metadata = z.infer<typeof metadata>;

function urlWith(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

const id = escapeIdentifier;

async function withClient<T>(url: string, f: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await f(c);
  } finally {
    await c.end();
  }
}

export function snapshotTarget(databaseUrl: string, prefix = SNAPSHOT_PREFIX): SnapshotTarget {
  const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  const refused =
    !IDENTIFIER.test(database) ||
    RESERVED.has(database) ||
    database.startsWith('dmg_template_') ||
    database.startsWith(SNAPSHOT_PREFIX) ||
    database.startsWith(prefix);
  if (refused || !IDENTIFIER.test(prefix)) {
    throw new DomainError('validation', `Snapshots cannot target the database "${database}".`);
  }
  return { databaseUrl, adminUrl: urlWith(databaseUrl, 'postgres'), database, prefix };
}

export function slugOf(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'snapshot';
}

/** `<prefix><yyyymmdd>_<hhmmss>_<slug>` in UTC, cut to Postgres' 63-character limit. */
export function snapshotName(prefix: string, label: string, at: Date): string {
  const stamp = at.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '').replace('T', '_');
  return `${prefix}${stamp}_${slugOf(label)}`.slice(0, MAX_NAME).replace(/_+$/, '');
}

function isSnapshotName(t: SnapshotTarget, name: string): boolean {
  return name.length <= MAX_NAME && new RegExp(`^${t.prefix}\\d{8}_\\d{6}_[a-z0-9_]+$`).test(name);
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

/** Snapshots of this database, newest first. */
export async function listSnapshots(t: SnapshotTarget): Promise<Snapshot[]> {
  const { rows } = await withClient(t.adminUrl, (c) =>
    c.query<{ name: string; comment: string | null; size: string }>(
      `select datname as name, shobj_description(oid, 'pg_database') as comment, pg_database_size(oid)::text as size
         from pg_database where starts_with(datname, $1)`,
      [t.prefix],
    ),
  );
  const snapshots: Snapshot[] = [];
  for (const r of rows) {
    const meta = isSnapshotName(t, r.name) ? parseMetadata(r.comment) : null;
    if (meta?.source === t.database) snapshots.push({ name: r.name, ...meta, size_bytes: Number(r.size) });
  }
  return snapshots.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.name.localeCompare(a.name));
}

/** A snapshot of this database by its name or, failing that, the newest one with that label. */
export async function findSnapshot(t: SnapshotTarget, ref: string): Promise<Snapshot> {
  const all = await listSnapshots(t);
  const found = isSnapshotName(t, ref) ? all.find((s) => s.name === ref) : all.find((s) => s.label === ref);
  if (!found) throw new DomainError('not_found', `There is no snapshot "${ref}" of ${t.database}.`);
  return found;
}

/** Other clients connected to the live database (the API, psql…). */
export async function connectedSessions(t: SnapshotTarget): Promise<DatabaseSession[]> {
  const { rows } = await withClient(t.adminUrl, (c) =>
    c.query<DatabaseSession>(
      `select pid, application_name as application, client_addr::text as client from pg_stat_activity
        where datname = $1 and backend_type = 'client backend' and pid <> pg_backend_pid()`,
      [t.database],
    ),
  );
  return rows;
}

export async function terminateSessions(t: SnapshotTarget): Promise<number> {
  const { rows } = await withClient(t.adminUrl, (c) =>
    c.query<{ n: number }>(
      `select count(*) filter (where pg_terminate_backend(pid))::int as n from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [t.database],
    ),
  );
  return rows[0]?.n ?? 0;
}

const describeSession = (s: DatabaseSession): string => `pid ${s.pid} ${s.application || '(unnamed)'} ${s.client ?? 'local'}`;

async function explainCreate(e: unknown, t: SnapshotTarget): Promise<unknown> {
  const code = (e as { code?: string }).code;
  if (code === '55006') {
    const sessions = await connectedSessions(t);
    return new DomainError(
      'conflict',
      `${t.database} is in use: stop the API or save from the dev panel.`,
      sessions.map(describeSession),
    );
  }
  if (code === '42P04') return new DomainError('conflict', 'A snapshot with that name already exists.');
  return e;
}

export async function saveSnapshot(t: SnapshotTarget, label: string, at: Date = new Date()): Promise<Snapshot> {
  const tidy = label.trim() || 'snapshot';
  const name = snapshotName(t.prefix, tidy, at);
  // The summary connection closes before the copy: CREATE DATABASE … TEMPLATE needs the source idle.
  const summary = await withClient(t.databaseUrl, async (c) => {
    const projects = await c.query<{ name: string; events: string }>(
      'select name, event_seq::text as events from projects order by created_at, id',
    );
    const migration = await c.query<{ version: string | null }>('select max(version) as version from schema_migrations');
    return {
      projects: projects.rows.map((p) => ({ name: p.name, events: Number(p.events) })),
      migration: migration.rows[0]?.version ?? null,
    };
  });
  const meta: Metadata = { label: tidy, created_at: at.toISOString(), source: t.database, ...summary };
  return withClient(t.adminUrl, async (c) => {
    try {
      await c.query(`create database ${id(name)} template ${id(t.database)}`);
    } catch (e) {
      throw await explainCreate(e, t);
    }
    try {
      await c.query(`comment on database ${id(name)} is ${escapeLiteral(JSON.stringify(meta))}`);
      const { rows } = await c.query<{ size: string }>('select pg_database_size($1)::text as size', [name]);
      return { name, ...meta, size_bytes: Number(rows[0]?.size ?? 0) };
    } catch (e) {
      await c.query(`drop database if exists ${id(name)} with (force)`);
      throw e;
    }
  });
}

type People = { humans: unknown[]; sessions: unknown[] };

async function readPeople(t: SnapshotTarget): Promise<People> {
  try {
    return await withClient(t.databaseUrl, async (c) => {
      const { rows } = await c.query<People>(
        `select coalesce((select json_agg(h) from humans h), '[]'::json) as humans,
                coalesce((select json_agg(s) from sessions s where s.revoked_at is null and s.expires_at > now()), '[]'::json) as sessions`,
      );
      return rows[0] ?? { humans: [], sessions: [] };
    });
  } catch (e) {
    // Without a live database (3D000) there is nobody to carry over.
    if ((e as { code?: string }).code === '3D000') return { humans: [], sessions: [] };
    throw e;
  }
}

/** Migrates the new database and, when the live one had people, replaces its people with them. */
async function prepare(url: string, people: People): Promise<void> {
  const c = connect(url, 1);
  try {
    await migrate(c.pool);
    if (people.humans.length === 0) return;
    const client = await c.pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from sessions');
      await client.query('delete from humans');
      await client.query('insert into humans select * from json_populate_recordset(null::humans, $1::json)', [
        JSON.stringify(people.humans),
      ]);
      await client.query('insert into sessions select * from json_populate_recordset(null::sessions, $1::json)', [
        JSON.stringify(people.sessions),
      ]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await c.close();
  }
}

/** Waits until the backends of a database we just used have exited: RENAME, unlike TEMPLATE, doesn't wait. */
async function waitUntilIdle(admin: Client, database: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const { rows } = await admin.query<{ n: number }>('select count(*)::int as n from pg_stat_activity where datname = $1', [
      database,
    ]);
    if (rows[0]?.n === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new DomainError('conflict', `${database} is still in use.`);
}

/**
 * Builds the replacement in a temporary database and only then swaps it in, so a failure never
 * leaves the environment without its database. The live one is dropped WITH (FORCE).
 */
async function replaceDatabase(t: SnapshotTarget, create: (admin: Client, tmp: string) => Promise<unknown>): Promise<void> {
  const tmp = `${t.prefix}tmp_${t.database}`;
  if (tmp.length > MAX_NAME) throw new DomainError('validation', `The database name ${t.database} is too long for a restore.`);
  const people = await readPeople(t);
  await withClient(t.adminUrl, async (admin) => {
    await admin.query(`drop database if exists ${id(tmp)} with (force)`);
    await create(admin, tmp);
    try {
      await prepare(urlWith(t.databaseUrl, tmp), people);
      await waitUntilIdle(admin, tmp);
    } catch (e) {
      await admin.query(`drop database if exists ${id(tmp)} with (force)`);
      throw e;
    }
    await admin.query(`drop database if exists ${id(t.database)} with (force)`);
    await admin.query(`alter database ${id(tmp)} rename to ${id(t.database)}`);
  });
}

/** Puts the snapshot back as the live database (migrated to the current schema), keeping the people. */
export async function restoreSnapshot(t: SnapshotTarget, ref: string): Promise<Snapshot> {
  const snapshot = await findSnapshot(t, ref);
  await replaceDatabase(t, (admin, tmp) => admin.query(`create database ${id(tmp)} template ${id(snapshot.name)}`));
  return snapshot;
}

/** An empty, migrated database with the same people: ready for a new Day 1. */
export async function resetDatabase(t: SnapshotTarget): Promise<void> {
  await replaceDatabase(t, (admin, tmp) => admin.query(`create database ${id(tmp)}`));
}

export async function dropSnapshot(t: SnapshotTarget, ref: string): Promise<Snapshot> {
  const snapshot = await findSnapshot(t, ref);
  await withClient(t.adminUrl, (c) => c.query(`drop database if exists ${id(snapshot.name)} with (force)`));
  return snapshot;
}
