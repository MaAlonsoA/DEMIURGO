// Preparación global de las pruebas con base de datos: asegura el Postgres de desarrollo,
// crea una base plantilla migrada (una por contenido de las migraciones) y limpia bases
// efímeras antiguas. Nunca toca bases que no empiecen por dmg_t_ o dmg_plantilla_.

import { execFileSync } from 'node:child_process';
import { Client, Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { sha256 } from '@demiurgo/domain';
import { leerMigraciones, migrar } from '../../src/db/migrador.ts';

export const URL_ADMIN = process.env.DEMIURGO_PRUEBAS_URL ?? 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/postgres';

declare module 'vitest' {
  export interface ProvidedContext {
    urlAdmin: string;
    plantilla: string;
  }
}

export function urlDeBase(nombre: string, base = URL_ADMIN): string {
  const u = new URL(base);
  u.pathname = `/${nombre}`;
  return u.toString();
}

async function conectar(): Promise<Client> {
  const cliente = new Client({ connectionString: URL_ADMIN });
  await cliente.connect();
  return cliente;
}

async function asegurarPostgres(): Promise<Client> {
  try {
    return await conectar();
  } catch {
    if (process.env.CI) throw new Error(`No hay Postgres de pruebas en ${URL_ADMIN}.`);
    execFileSync('docker', ['compose', '-p', 'demiurgo-v2-dev', '-f', 'compose.dev.yaml', 'up', '-d', '--wait'], {
      stdio: 'inherit',
    });
    return await conectar();
  }
}

export default async function preparar(proyecto: TestProject): Promise<void> {
  const admin = await asegurarPostgres();
  try {
    const migraciones = await leerMigraciones();
    const plantilla = `dmg_plantilla_${sha256(migraciones.map((m) => m.checksum).join(':')).slice(0, 12)}`;
    const { rows } = await admin.query<{ datname: string }>(
      "select datname from pg_database where datname like 'dmg_plantilla_%' or datname like 'dmg_t_%'",
    );
    const ahora = Math.floor(Date.now() / 1000);
    for (const { datname } of rows) {
      const ts = /^dmg_t_(\d+)_/.exec(datname)?.[1];
      const antigua = ts !== undefined && ahora - Number(ts) > 7200;
      // Solo se borran bases efímeras antiguas: otra ejecución concurrente puede estar usando su plantilla.
      if (antigua) await admin.query(`drop database if exists "${datname}" with (force)`);
    }
    if (!rows.some((r) => r.datname === plantilla)) {
      const tmp = `${plantilla}_${process.pid}_tmp`;
      await admin.query(`drop database if exists "${tmp}" with (force)`);
      await admin.query(`create database "${tmp}"`);
      const pool = new Pool({ connectionString: urlDeBase(tmp) });
      try {
        await migrar(pool, migraciones);
      } finally {
        await pool.end();
      }
      try {
        await admin.query(`alter database "${tmp}" rename to "${plantilla}"`);
      } catch {
        // Otra ejecución concurrente ya creó la plantilla.
        await admin.query(`drop database if exists "${tmp}" with (force)`);
      }
    }
    proyecto.provide('urlAdmin', URL_ADMIN);
    proyecto.provide('plantilla', plantilla);
  } finally {
    await admin.end();
  }
}
