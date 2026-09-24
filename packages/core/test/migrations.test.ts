import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { leerMigraciones, migrar } from '../src/db/migrador.ts';

// Base vacía (sin plantilla) creada solo para esta prueba.
const nombre = `dmg_t_${Math.floor(Date.now() / 1000)}_migraciones`;
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
  await admin((c) => c.query(`create database "${nombre}"`));
  const u = new URL(inject('urlAdmin'));
  u.pathname = `/${nombre}`;
  pool = new Pool({ connectionString: u.toString() });
});
afterAll(async () => {
  await pool.end();
  await admin((c) => c.query(`drop database if exists "${nombre}" with (force)`));
});

describe('migraciones', () => {
  it('AC-ESQ-001-05 una base vacía queda en la última versión y aplicar de nuevo no cambia nada', async () => {
    const todas = await leerMigraciones();
    const aplicadas = await migrar(pool, todas);
    expect(aplicadas).toEqual(todas.map((m) => `${m.version}_${m.nombre}`));
    const { rows } = await pool.query<{ version: string }>('select version from schema_migrations order by version');
    expect(rows.map((r) => r.version)).toEqual(todas.map((m) => m.version));
    const tablas = await pool.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(await migrar(pool, todas)).toEqual([]);
    const despues = await pool.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(despues.rows[0]?.n).toBe(tablas.rows[0]?.n);
  });

  it('AC-ESQ-001-05 una migración aplicada y modificada impide arrancar', async () => {
    const todas = await leerMigraciones();
    const alterada = todas.map((m, i) => (i === 0 ? { ...m, checksum: 'otro' } : m));
    await expect(migrar(pool, alterada)).rejects.toThrow(/ha cambiado/);
  });
});
