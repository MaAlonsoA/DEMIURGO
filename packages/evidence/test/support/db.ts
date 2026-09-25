// An ephemeral evidence base per test file, on the test Postgres (`dmg_t_*`, like the core's), with
// the evidence migrations applied. The core's global setup provides the admin URL.

import { randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';
import { ensureMonthPartitions, migrate } from '../../src/db/migrator.ts';

export type EvidenceDatabase = { name: string; url: string; pool: Pool; drop(): Promise<void> };

function urlWith(name: string, base: string): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

/** A fresh `dmg_t_*` database; with `migrated`, the evidence schema is applied. */
export async function createEvidenceDatabase(migrated = true): Promise<EvidenceDatabase> {
  const urlAdmin = inject('urlAdmin');
  const name = `dmg_t_${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = urlWith(name, urlAdmin);
  const pool = new Pool({ connectionString: url, max: 4 });
  pool.on('error', () => undefined);
  // What `pnpm evidence migrate` does: the schema, then this month's and next month's partitions.
  if (migrated) {
    await migrate(pool);
    await ensureMonthPartitions(pool, 1);
  }
  return {
    name,
    url,
    pool,
    async drop() {
      if (!name.startsWith('dmg_t_')) throw new Error('Only ephemeral databases are dropped.');
      await pool.end();
      const c = new Client({ connectionString: urlAdmin });
      await c.connect();
      try {
        await c.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}

/** Registers an ephemeral, migrated evidence base for the current test file. */
export function useEvidenceDatabase(): () => EvidenceDatabase {
  let base: EvidenceDatabase | undefined;
  beforeAll(async () => {
    base = await createEvidenceDatabase();
  });
  afterAll(async () => {
    await base?.drop();
  });
  return () => {
    if (!base) throw new Error('The evidence database does not exist yet.');
    return base;
  };
}

export async function count(pool: Pool, table: string, where = 'true', params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`select count(*)::text as n from ${table} where ${where}`, params);
  return Number(rows[0]?.n ?? 0);
}
