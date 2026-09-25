// Invariants of the observability engine (spec §16): `trace_contexts` is append-only and carries
// the project, and no note ever carries the `result` of a command (§6.4).

import { SPAN, human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/bus/bus.ts';
import { useEnvironment } from '../support/env.ts';

const environment = useEnvironment();
let projectId = '';

beforeAll(async () => {
  const r = await executeCommand(environment().services, {
    command: 'project.create',
    actor: human('ana'),
    data: { name: 'Notes' },
  });
  projectId = r.projectId;
});

describe('trace_contexts is append-only and scoped by project', () => {
  it('rejects UPDATE and DELETE and keeps the rows as they were', async () => {
    const db = environment().services.db;
    const before = await db.selectFrom('trace_contexts').selectAll().orderBy('created_at').execute();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((row) => row.project_id === projectId)).toBe(true);
    await expect(sql`update trace_contexts set trace_parent = 'x'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`delete from trace_contexts`.execute(db)).rejects.toThrow(/append-only/);
    expect(await db.selectFrom('trace_contexts').selectAll().orderBy('created_at').execute()).toEqual(before);
  });

  it('requires a project', async () => {
    const db = environment().services.db;
    await expect(
      sql`insert into trace_contexts (entity_type, entity_id, project_id, trace_parent)
          values ('project', gen_random_uuid(), gen_random_uuid(), '00-${sql.raw('0'.repeat(32))}-${sql.raw('1'.repeat(16))}-01')`.execute(
        db,
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('no note carries the result of a command', () => {
  it('the secret of agent_token.issue appears in no span, no log record and no trace context', async () => {
    const s = environment().services;
    environment().observer.reset();
    const r = await s.observer.interaction(
      { channel: 'api', actor: 'human:ana', actorType: 'human', command: 'agent_token.issue', projectId },
      () => executeCommand(s, { command: 'agent_token.issue', actor: human('ana'), projectId, data: { name: 'claude-code' } }),
    );
    const secret = (r.result as { token: string }).token;
    expect(secret.length).toBeGreaterThan(16);

    const spans = environment().observer.spans();
    expect(spans.map((sp) => sp.name)).toContain(`${SPAN.command} agent_token.issue`);
    for (const span of spans) {
      expect(JSON.stringify(span.attributes)).not.toContain(secret);
      expect(Object.keys(span.attributes).filter((key) => key.includes('result'))).toEqual([]);
    }
    for (const log of environment().observer.logs()) {
      expect(JSON.stringify(log.attributes)).not.toContain(secret);
      expect(JSON.stringify(log.body ?? null)).not.toContain(secret);
    }
    const contexts = await s.db.selectFrom('trace_contexts').selectAll().where('project_id', '=', projectId).execute();
    expect(contexts.some((c) => c.entity_type === 'agent_token' && c.entity_id === r.entityId)).toBe(true);
    for (const c of contexts) expect(JSON.stringify(c)).not.toContain(secret);
  });
});
