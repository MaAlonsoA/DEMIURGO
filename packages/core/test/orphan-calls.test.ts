// A provider call left "running" by a crash is closed when DEMIURGO starts again: its row says it was
// interrupted and its trace ends with an error event, so the run page and the statistics never show
// a call that is still running forever.

import { human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { closeOrphanCalls } from '../src/assignments/calls.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();

async function call(projectId: string, state: 'running' | 'ok'): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into agent_calls (project_id, agent, agent_version, provider, requested_model, session_mode, prompt_hash, state)
    values (${projectId}::uuid, 'explorer', 'v1', 'claude', 'opus', 'none', 'h', ${state}) returning id`.execute(
    environment().services.db,
  );
  return rows[0]?.id ?? '';
}

describe('orphan provider calls', () => {
  it('are closed as interrupted with an error event, and finished calls are left as they are', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: human('ana'), data: { name: 'Crash' } });
    const orphan = await call(projectId, 'running');
    const done = await call(projectId, 'ok');
    await sql`insert into agent_call_events (project_id, call_id, seq, kind, raw) values (${projectId}::uuid, ${orphan}::uuid, 1, 'thinking', '{}')`.execute(
      s.db,
    );

    expect(await closeOrphanCalls(s.db)).toBe(1);
    const { rows } = await sql<{ id: string; state: string; failure_kind: string | null; finished: boolean }>`
      select id, state, failure_kind, finished_at is not null as finished from agent_calls where id in (${orphan}::uuid, ${done}::uuid)`.execute(
      s.db,
    );
    expect(rows.find((r) => r.id === orphan)).toMatchObject({ state: 'error', failure_kind: 'interrupted', finished: true });
    expect(rows.find((r) => r.id === done)).toMatchObject({ state: 'ok', failure_kind: null });
    const { rows: events } = await sql<{ seq: number; kind: string }>`
      select seq, kind from agent_call_events where call_id = ${orphan}::uuid order by seq`.execute(s.db);
    expect(events).toEqual([
      { seq: 1, kind: 'thinking' },
      { seq: 2, kind: 'error' },
    ]);
    expect(await closeOrphanCalls(s.db)).toBe(0);
  });
});
