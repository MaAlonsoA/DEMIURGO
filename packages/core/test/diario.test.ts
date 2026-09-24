import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usarBaseEfimera } from './soporte/base-efimera.ts';

const base = usarBaseEfimera();
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

describe('diario de eventos', () => {
  it('AC-ESQ-001-04 rechaza UPDATE, DELETE y TRUNCATE y el diario queda igual', async () => {
    const antes = await pool.query('select * from events order by id');
    await expect(pool.query("update events set actor = 'human:otro'")).rejects.toThrow(/solo admite INSERT/);
    await expect(pool.query('delete from events')).rejects.toThrow(/solo admite INSERT/);
    await expect(pool.query('truncate events cascade')).rejects.toThrow(/solo admite INSERT/);
    const despues = await pool.query('select * from events order by id');
    expect(despues.rows).toEqual(antes.rows);
  });
});
