// Postgres connection of the evidence base with Kysely over `pg`.

import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './schema.ts';

// bigint (int8) arrives as text to avoid losing precision; counters are converted on read.
types.setTypeParser(20, (v) => v);

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

export type Connection = { pool: Pool; db: Db; close(): Promise<void> };

export function connect(url: string, maximum = 5): Connection {
  const pool = new Pool({ connectionString: url, max: maximum });
  pool.on('error', () => undefined);
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return {
    pool,
    db,
    async close() {
      await db.destroy();
      if (!pool.ended) await pool.end();
    },
  };
}
