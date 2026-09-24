// Conexión a Postgres con Kysely. Una única base para dominio, diario, motor y grafo.

import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './schema.ts';

// bigint (int8) llega como texto para no perder precisión; los contadores se convierten al leer.
types.setTypeParser(20, (v) => v);

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

export type Connection = { pool: Pool; db: Db; close(): Promise<void> };

export function connect(url: string, maximum = 10): Connection {
  const pool = new Pool({ connectionString: url, max: maximum });
  pool.on('error', () => undefined);
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return {
    pool,
    db,
    async close() {
      await db.destroy();
    },
  };
}
