// Runtime of the API process: the core can be stopped and started again in the same process (DBOS
// included) while the database is swapped underneath, as the dev tools do.

import {
  connect,
  readConfig,
  restoreSnapshot,
  saveSnapshot,
  silentLogger,
  snapshotTarget,
  waitForRun,
  executeCommand,
} from '@demiurgo/core';
import { human } from '@demiurgo/domain';
import { Client, escapeIdentifier } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useEphemeralDatabase } from '../../core/test/support/ephemeral-db.ts';
import { seedSimulated } from '../../core/test/support/seed.ts';
import { type Runtime, startRuntime } from '../src/runtime.ts';

const PREFIX = `dmg_t_${Math.floor(Date.now() / 1000)}_rt_`;
const base = useEphemeralDatabase();
let runtime: Runtime;

beforeAll(async () => {
  // Every agent on the simulated provider, which only exists with the dev tools on.
  const seed = connect(base().url, 1);
  await seedSimulated(seed.db);
  await seed.close();
  runtime = await startRuntime(
    readConfig({ DEMIURGO_DATABASE_URL: base().url, DEMIURGO_DEV_TOOLS: '1', DEMIURGO_OPENCODE_CONFIG: 'missing-opencode.json' }),
    silentLogger,
  );
});

afterAll(async () => {
  await runtime?.stop();
  const admin = new Client({ connectionString: snapshotTarget(base().url, PREFIX).adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ datname: string }>('select datname from pg_database where starts_with(datname, $1)', [
      PREFIX,
    ]);
    for (const r of rows) await admin.query(`drop database if exists ${escapeIdentifier(r.datname)} with (force)`);
  } finally {
    await admin.end();
  }
});

async function createProject(name: string): Promise<string> {
  const r = await executeCommand(runtime.services, { command: 'project.create', actor: human('ana'), data: { name } });
  return r.projectId;
}

async function echo(projectId: string): Promise<string | null> {
  const r = await executeCommand(runtime.services, {
    command: 'run.request',
    actor: human('ana'),
    projectId,
    data: { action: 'echo', scope: { type: 'project' }, input: { text: 'hi' } },
  });
  return waitForRun(r.entityId);
}

const projectNames = async (): Promise<string[]> =>
  (await runtime.services.db.selectFrom('projects').select('name').orderBy('name').execute()).map((p) => p.name);

describe('API runtime', () => {
  it('restarts the core, DBOS included, around a snapshot and a restore', async () => {
    const target = snapshotTarget(base().url, PREFIX);
    const alpha = await createProject('Alpha');
    expect(await echo(alpha)).toBe('completed');

    const saved = await runtime.restart(() => saveSnapshot(target, 'alpha'));
    expect(await echo(alpha)).toBe('completed');

    await createProject('Beta');
    expect(await projectNames()).toEqual(['Alpha', 'Beta']);
    await runtime.restart(() => restoreSnapshot(target, saved.name));
    expect(await projectNames()).toEqual(['Alpha']);
    expect(await echo(alpha)).toBe('completed');
  });

  it('holds new requests until the restart finishes and refuses a second restart meanwhile', async () => {
    const held = Promise.withResolvers<void>();
    const restarting = runtime.restart(() => held.promise);
    let ready = false;
    const waiting = runtime.ready().then(() => {
      ready = true;
    });
    await expect(runtime.restart(async () => undefined)).rejects.toMatchObject({ type: 'conflict' });
    await new Promise((r) => setTimeout(r, 50));
    expect(ready).toBe(false);
    held.resolve();
    await restarting;
    await waiting;
    expect(ready).toBe(true);
  });

  it('starts the core again even when the operation fails', async () => {
    await expect(
      runtime.restart(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await projectNames()).toEqual(['Alpha']);
  });
});
