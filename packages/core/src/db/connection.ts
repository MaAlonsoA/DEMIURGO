// Conexión a Postgres con Kysely. Una única base para dominio, diario, motor y grafo.

import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool, types } from 'pg';
import type { BD } from './esquema.ts';

// bigint (int8) llega como texto para no perder precisión; los contadores se convierten al leer.
types.setTypeParser(20, (v) => v);

export type Bd = Kysely<BD>;
export type Tx = Transaction<BD>;

export type Conexion = { pool: Pool; db: Bd; cerrar(): Promise<void> };

export function conectar(url: string, maximo = 10): Conexion {
  const pool = new Pool({ connectionString: url, max: maximo });
  pool.on('error', () => undefined);
  const db = new Kysely<BD>({ dialect: new PostgresDialect({ pool }) });
  return {
    pool,
    db,
    async cerrar() {
      await db.destroy();
    },
  };
}
