// Global setup for the database tests: ensures the development Postgres, creates a migrated
// template database (one per migration content) and cleans up old ephemeral databases. It never
// touches a database that does not start with dmg_t_ or dmg_template_.

import { execFileSync } from 'node:child_process';
import { Client, Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { sha256 } from '@demiurgo/domain';
import { readMigrations, migrate } from '../../src/db/migrator.ts';

export const URL_ADMIN = process.env.DEMIURGO_TEST_DB_URL ?? 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/postgres';

declare module 'vitest' {
  export interface ProvidedContext {
    urlAdmin: string;
    template: string;
  }
}

export function urlFromBase(name: string, base = URL_ADMIN): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: URL_ADMIN });
  await client.connect();
  return client;
}

async function ensurePostgres(): Promise<Client> {
  try {
    return await connect();
  } catch {
    if (process.env.CI) throw new Error(`No test Postgres at ${URL_ADMIN}.`);
    execFileSync('docker', ['compose', '-p', 'demiurgo-v2-dev', '-f', 'compose.dev.yaml', 'up', '-d', '--wait'], {
      stdio: 'inherit',
    });
    return await connect();
  }
}

export default async function prepare(project: TestProject): Promise<void> {
  const admin = await ensurePostgres();
  try {
    const migrations = await readMigrations();
    const template = `dmg_template_${sha256(migrations.map((m) => m.checksum).join(':')).slice(0, 12)}`;
    const { rows } = await admin.query<{ datname: string }>(
      "select datname from pg_database where datname like 'dmg_template_%' or datname like 'dmg_t_%'",
    );
    const now = Math.floor(Date.now() / 1000);
    for (const { datname } of rows) {
      const ts = /^dmg_t_(\d+)_/.exec(datname)?.[1];
      const old = ts !== undefined && now - Number(ts) > 7200;
      // Only old ephemeral databases get dropped: another concurrent run may be using its template.
      if (old) await admin.query(`drop database if exists "${datname}" with (force)`);
    }
    if (!rows.some((r) => r.datname === template)) {
      const tmp = `${template}_${process.pid}_tmp`;
      await admin.query(`drop database if exists "${tmp}" with (force)`);
      await admin.query(`create database "${tmp}"`);
      const pool = new Pool({ connectionString: urlFromBase(tmp) });
      try {
        await migrate(pool, migrations);
      } finally {
        await pool.end();
      }
      try {
        await admin.query(`alter database "${tmp}" rename to "${template}"`);
      } catch {
        // Another concurrent run already created the template.
        await admin.query(`drop database if exists "${tmp}" with (force)`);
      }
    }
    project.provide('urlAdmin', URL_ADMIN);
    project.provide('template', template);
  } finally {
    await admin.end();
  }
}
