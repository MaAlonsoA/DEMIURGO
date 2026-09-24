import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { readMigrations, migrate } from '../src/db/migrator.ts';

// Base vacía (sin plantilla) creada solo para esta prueba.
const name = `dmg_t_${Math.floor(Date.now() / 1000)}_migraciones`;
let pool: Pool;

async function admin<T>(f: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: inject('urlAdmin') });
  await c.connect();
  try {
    return await f(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await admin((c) => c.query(`create database "${name}"`));
  const u = new URL(inject('urlAdmin'));
  u.pathname = `/${name}`;
  pool = new Pool({ connectionString: u.toString() });
});
afterAll(async () => {
  await pool.end();
  await admin((c) => c.query(`drop database if exists "${name}" with (force)`));
});

describe('migrations', () => {
  it('AC-ESQ-001-05 una base vacía queda en la última versión y aplicar de nuevo no cambia nada', async () => {
    const all = await readMigrations();
    const applied = await migrate(pool, all);
    expect(applied).toEqual(all.map((m) => `${m.version}_${m.name}`));
    const { rows } = await pool.query<{ version: string }>('select version from schema_migrations order by version');
    expect(rows.map((r) => r.version)).toEqual(all.map((m) => m.version));
    const tables = await pool.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(await migrate(pool, all)).toEqual([]);
    const after = await pool.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(after.rows[0]?.n).toBe(tables.rows[0]?.n);
  });

  it('AC-ESQ-001-05 una migración aplicada y modificada impide arrancar', async () => {
    const all = await readMigrations();
    const altered = all.map((m, i) => (i === 0 ? { ...m, checksum: 'another' } : m));
    await expect(migrate(pool, altered)).rejects.toThrow(/ha cambiado/);
  });
});
