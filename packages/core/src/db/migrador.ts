// Migraciones SQL planas, revisadas por una persona, aplicadas en orden y en transacción.
// Una migración ya aplicada cuyo contenido cambia impide arrancar.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { sha256 } from '@demiurgo/domain';

export const DIR_MIGRACIONES = fileURLToPath(new URL('../../migraciones/', import.meta.url));

export type Migracion = { version: string; nombre: string; sql: string; checksum: string };

export async function leerMigraciones(dir = DIR_MIGRACIONES): Promise<Migracion[]> {
  const archivos = (await readdir(dir)).filter((a) => /^\d{4}_[a-z0-9_]+\.sql$/.test(a)).sort();
  const migraciones: Migracion[] = [];
  for (const archivo of archivos) {
    const sql = (await readFile(join(dir, archivo), 'utf8')).replaceAll('\r\n', '\n');
    migraciones.push({ version: archivo.slice(0, 4), nombre: archivo.slice(5, -4), sql, checksum: sha256(sql) });
  }
  return migraciones;
}

const BLOQUEO_MIGRACIONES = 7_421_001;

export async function migrar(pool: Pool, migraciones?: Migracion[]): Promise<string[]> {
  const lista = migraciones ?? (await leerMigraciones());
  const cliente = await pool.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query('select pg_advisory_lock($1)', [BLOQUEO_MIGRACIONES]);
    await cliente.query(`create table if not exists schema_migrations (
      version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())`);
    const { rows } = await cliente.query<{ version: string; checksum: string }>(
      'select version, checksum from schema_migrations',
    );
    const previas = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const m of lista) {
      const previa = previas.get(m.version);
      if (previa !== undefined) {
        if (previa !== m.checksum) {
          throw new Error(`La migración ${m.version}_${m.nombre} ya aplicada ha cambiado; no se puede arrancar.`);
        }
        continue;
      }
      await cliente.query('begin');
      try {
        await cliente.query(m.sql);
        await cliente.query('insert into schema_migrations (version, name, checksum) values ($1, $2, $3)', [
          m.version,
          m.nombre,
          m.checksum,
        ]);
        await cliente.query('commit');
        aplicadas.push(`${m.version}_${m.nombre}`);
      } catch (e) {
        await cliente.query('rollback');
        throw e;
      }
    }
    return aplicadas;
  } finally {
    await cliente.query('select pg_advisory_unlock($1)', [BLOQUEO_MIGRACIONES]).catch(() => undefined);
    cliente.release();
  }
}
