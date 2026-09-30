// Per-project development snapshots: save one project, delete it, restore it; the other one is untouched.

import { human } from '@demiurgo/domain';
import { Client, escapeIdentifier } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { createSimulatedClassifier } from '../src/classifier/simulated.ts';
import { createProviderRegistry } from '../src/providers/registry.ts';
import { connect } from '../src/db/connection.ts';
import {
  deleteProjectData,
  dropProjectSnapshot,
  listProjectSnapshots,
  restoreProjectSnapshot,
  saveProjectSnapshot,
} from '../src/dev/project-snapshots.ts';
import { type SnapshotTarget, snapshotTarget } from '../src/dev/snapshots.ts';
import { noopObserver } from '../src/observe/noop.ts';
import { inertEngine, silentLogger } from '../src/services.ts';
import { useEphemeralDatabase } from './support/ephemeral-db.ts';

// Starts like an ephemeral database, so the global setup cleans up whatever a failed run leaves.
const PREFIX = `dmg_t_${Math.floor(Date.now() / 1000)}_psn_`;
const base = useEphemeralDatabase();
const target = (): SnapshotTarget => snapshotTarget(base().url, PREFIX);

async function withClient<T>(url: string, f: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await f(c);
  } finally {
    await c.end();
  }
}

async function createProject(name: string): Promise<void> {
  const c = connect(base().url, 1);
  try {
    const services = {
      db: c.db,
      clock: () => new Date(),
      providers: createProviderRegistry([createSimulatedProvider()]),
      classifierFor: async () => createSimulatedClassifier(),
      agentSessionsDir: '',
      logger: silentLogger,
      engine: inertEngine(),
      observer: noopObserver,
    };
    await executeCommand(services, { command: 'project.create', actor: human('ana'), data: { name } });
  } finally {
    await c.close();
  }
}

const query = <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  withClient(base().url, async (c) => (await c.query<T>(sql, params)).rows);

const count = async (table: string, projectId: string): Promise<number> =>
  Number((await query<{ n: string }>(`select count(*)::text as n from ${table} where project_id = $1`, [projectId]))[0]?.n);

afterAll(async () => {
  await withClient(target().adminUrl, async (c) => {
    const { rows } = await c.query<{ datname: string }>('select datname from pg_database where starts_with(datname, $1)', [PREFIX]);
    for (const r of rows) await c.query(`drop database if exists ${escapeIdentifier(r.datname)} with (force)`);
  });
});

describe('project snapshots', () => {
  it('saves one project, deletes it and restores it without touching the other', async () => {
    await createProject('Alpha');
    await createProject('Beta');
    const [alpha, beta] = await query<{ id: string; name: string }>('select id, name from projects order by name');
    expect(alpha && beta).toBeTruthy();
    const a = alpha?.id as string;
    const b = beta?.id as string;
    const eventsBefore = await count('events', a);
    const betaEvents = await count('events', b);
    expect(eventsBefore).toBeGreaterThan(0);

    const snap = await saveProjectSnapshot(target(), a, 'before delete', null);
    expect(snap.project).toMatchObject({ id: a, name: 'Alpha' });
    expect((await listProjectSnapshots(target(), b)).length).toBe(0);
    expect((await listProjectSnapshots(target(), a)).map((s) => s.name)).toEqual([snap.name]);

    const deleted = await deleteProjectData(target(), a);
    expect(deleted.projects).toBe(1);
    expect(await count('events', a)).toBe(0);
    expect(await query('select 1 from projects where id = $1', [a])).toHaveLength(0);
    expect(await count('events', b)).toBe(betaEvents);

    const restored = await restoreProjectSnapshot(target(), 'before delete');
    expect(restored.restored.name).toBe(snap.name);
    expect(restored.git).toMatch(/GitHub itself is not rewound/);
    expect(await count('events', a)).toBe(eventsBefore);
    expect(await query('select name from projects where id = $1', [a])).toEqual([{ name: 'Alpha' }]);
    expect(await count('events', b)).toBe(betaEvents);
    expect(await query('select 1 from projects where id = $1', [b])).toHaveLength(1);

    await dropProjectSnapshot(target(), snap.name);
    expect(await listProjectSnapshots(target())).toHaveLength(0);
  });
});
