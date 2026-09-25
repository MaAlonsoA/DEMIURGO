// `pnpm evidence retention --raw-before YYYY-MM [--yes]` (§14.4): drops the monthly partitions of the
// raw tables, and only those, older than the given month. Without `--yes` it only lists what it
// would drop. Nothing else of the base is ever touched by a program.

import type { Pool } from 'pg';

/** The only tables retention may touch (§11). */
export const RAW_TABLES = ['provider_events', 'journal_payloads', 'cli_requests', 'unmapped_records'] as const;

export type Partition = { table: string; partition: string; month: string };

const RE_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseMonth(value: string | undefined): string {
  if (!value || !RE_MONTH.test(value)) throw new Error('--raw-before needs a month as YYYY-MM.');
  return value;
}

/** The raw partitions whose month is before `before` (YYYY-MM). */
export async function rawPartitionsBefore(pool: Pool, before: string): Promise<Partition[]> {
  const out: Partition[] = [];
  for (const table of RAW_TABLES) {
    const { rows } = await pool.query<{ name: string }>(
      `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
       where i.inhparent = $1::regclass order by c.relname`,
      [table],
    );
    for (const { name } of rows) {
      const m = new RegExp(`^${table}_(\\d{4})_(\\d{2})$`).exec(name);
      if (!m) continue;
      const month = `${m[1]}-${m[2]}`;
      if (month < before) out.push({ table, partition: name, month });
    }
  }
  return out;
}

export async function dropPartitions(pool: Pool, partitions: Partition[]): Promise<void> {
  for (const p of partitions) {
    if (!RAW_TABLES.some((t) => p.partition.startsWith(`${t}_`))) throw new Error(`Refusing to drop ${p.partition}.`);
    await pool.query(`drop table if exists "${p.partition}"`);
  }
}
