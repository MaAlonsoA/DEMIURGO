import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useEphemeralDatabase } from './support/ephemeral-db.ts';

const base = useEphemeralDatabase();
let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: base().url });
  const { rows } = await pool.query<{ id: string }>("insert into projects (name, state) values ('P', 'active') returning id");
  await pool.query(
    "insert into events (project_id, seq, actor, command, entity_type, entity_id) values ($1, 1, 'human:ana', 'project.create', 'project', $1)",
    [rows[0]?.id],
  );
});
afterAll(async () => {
  await pool.end();
});

describe('event log', () => {
  it('AC-ESQ-001-04 rejects UPDATE, DELETE and TRUNCATE and the log stays the same', async () => {
    const before = await pool.query('select * from events order by id');
    await expect(pool.query("update events set actor = 'human:other'")).rejects.toThrow(/only admits INSERT/);
    await expect(pool.query('delete from events')).rejects.toThrow(/only admits INSERT/);
    await expect(pool.query('truncate events cascade')).rejects.toThrow(/only admits INSERT/);
    const after = await pool.query('select * from events order by id');
    expect(after.rows).toEqual(before.rows);
  });
});
