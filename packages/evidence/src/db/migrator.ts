// Plain SQL migrations of the evidence base, applied in order and in a transaction, each with its
// checksum in `evidence_migrations` (spec §10, §14.6). The same approach as the core's migrator:
// an already-applied migration whose content changes prevents startup.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@demiurgo/domain';
import type { Pool } from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export type Migration = { version: string; name: string; sql: string; checksum: string };

export async function readMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((a) => /^\d{4}_[a-z0-9_]+\.sql$/.test(a)).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const sql = (await readFile(join(dir, file), 'utf8')).replaceAll('\r\n', '\n');
    migrations.push({ version: file.slice(0, 4), name: file.slice(5, -4), sql, checksum: sha256(sql) });
  }
  return migrations;
}

// A different lock than the core's: the two migrators never share a server, but they never share a key either.
const MIGRATIONS_LOCK = 7_421_002;

export async function migrate(pool: Pool, migrations?: Migration[]): Promise<string[]> {
  const list = migrations ?? (await readMigrations());
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATIONS_LOCK]);
    await client.query(`create table if not exists evidence_migrations (
      version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'select version, checksum from evidence_migrations',
    );
    const priors = new Map(rows.map((r) => [r.version, r.checksum]));
    const onDisk = new Set(list.map((m) => m.version));
    const missing = [...priors.keys()].filter((v) => !onDisk.has(v));
    if (missing.length)
      throw new Error(`Evidence migrations already applied are missing from disk (${missing.join(', ')}); cannot start.`);
    for (const m of list) {
      const prior = priors.get(m.version);
      if (prior !== undefined) {
        if (prior !== m.checksum) {
          throw new Error(`Evidence migration ${m.version}_${m.name}, already applied, has changed; cannot start.`);
        }
        continue;
      }
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query('insert into evidence_migrations (version, name, checksum) values ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query('commit');
        applied.push(`${m.version}_${m.name}`);
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATIONS_LOCK]).catch(() => undefined);
    client.release();
  }
}

/** Creates the partitions of the current month and the next `monthsAhead` (§11). Returns the ones created. */
export async function ensureMonthPartitions(pool: Pool, monthsAhead = 1): Promise<string[]> {
  const { rows } = await pool.query<{ ensure_month_partitions: string }>('select ensure_month_partitions($1)', [monthsAhead]);
  return rows.map((r) => r.ensure_month_partitions);
}
