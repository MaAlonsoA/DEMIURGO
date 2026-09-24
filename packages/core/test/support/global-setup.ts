// Preparación global de las pruebas con base de datos: asegura el Postgres de desarrollo,
// crea una base plantilla migrada (una por contenido de las migraciones) y limpia bases
// efímeras antiguas. Nunca toca bases que no empiecen por dmg_t_ o dmg_plantilla_.

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
    if (process.env.CI) throw new Error(`No hay Postgres de pruebas en ${URL_ADMIN}.`);
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
    const template = `dmg_plantilla_${sha256(migrations.map((m) => m.checksum).join(':')).slice(0, 12)}`;
    const { rows } = await admin.query<{ datname: string }>(
      "select datname from pg_database where datname like 'dmg_plantilla_%' or datname like 'dmg_t_%'",
    );
    const now = Math.floor(Date.now() / 1000);
    for (const { datname } of rows) {
      const ts = /^dmg_t_(\d+)_/.exec(datname)?.[1];
      const old = ts !== undefined && now - Number(ts) > 7200;
      // Solo se borran bases efímeras antiguas: otra ejecución concurrente puede estar usando su plantilla.
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
        // Otra ejecución concurrente ya creó la plantilla.
        await admin.query(`drop database if exists "${tmp}" with (force)`);
      }
    }
    project.provide('urlAdmin', URL_ADMIN);
    project.provide('template', template);
  } finally {
    await admin.end();
  }
}
