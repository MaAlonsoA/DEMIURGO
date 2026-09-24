// Development snapshots: whole-database copies in the same cluster (save, list, restore, reset, drop).

import { human } from '@demiurgo/domain';
import { Client, escapeIdentifier, escapeLiteral } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { createSimulatedAgent } from '../src/agents/simulated.ts';
import { createSimulatedClassifier } from '../src/classifier/simulated.ts';
import { connect } from '../src/db/connection.ts';
import {
  type SnapshotTarget,
  dropSnapshot,
  listSnapshots,
  resetDatabase,
  restoreSnapshot,
  saveSnapshot,
  slugOf,
  snapshotName,
  snapshotTarget,
} from '../src/dev/snapshots.ts';
import { inertEngine, silentLogger } from '../src/services.ts';
import { useEphemeralDatabase } from './support/ephemeral-db.ts';

// The prefix starts like an ephemeral database, so the global setup cleans up whatever a failed run leaves.
const PREFIX = `dmg_t_${Math.floor(Date.now() / 1000)}_snap_`;
const base = useEphemeralDatabase();
const target = (): SnapshotTarget => snapshotTarget(base().url, PREFIX);
let clock = Date.UTC(2026, 8, 24, 10, 0, 0);
const nextMoment = (): Date => new Date((clock += 1000));

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
      agent: createSimulatedAgent(),
      classifier: createSimulatedClassifier(),
      logger: silentLogger,
      engine: inertEngine(),
    };
    await executeCommand(services, { command: 'project.create', actor: human('ana'), data: { name } });
  } finally {
    await c.close();
  }
}

const projectNames = (): Promise<string[]> =>
  withClient(base().url, async (c) =>
    (await c.query<{ name: string }>('select name from projects order by name')).rows.map((r) => r.name),
  );

const usernames = (): Promise<string[]> =>
  withClient(base().url, async (c) =>
    (await c.query<{ username: string }>('select username from humans order by username')).rows.map((r) => r.username),
  );

async function addPerson(username: string, session: { expired?: boolean } = {}): Promise<void> {
  await withClient(base().url, async (c) => {
    const { rows } = await c.query<{ id: string }>("insert into humans (username, password_hash) values ($1, 'x') returning id", [
      username,
    ]);
    await c.query(
      `insert into sessions (human_id, token_hash, csrf_hash, expires_at)
       values ($1, $2, 'c', now() + ($3 || ' hours')::interval)`,
      [rows[0]?.id, `token-${username}`, session.expired ? '-1' : '1'],
    );
  });
}

const url = (db: string): string => `postgres://demiurgo:x@127.0.0.1:55432/${db}`;

const databasesWithPrefix = (): Promise<string[]> =>
  withClient(target().adminUrl, async (c) =>
    (await c.query<{ datname: string }>('select datname from pg_database where starts_with(datname, $1)', [PREFIX])).rows.map(
      (r) => r.datname,
    ),
  );

afterAll(async () => {
  await withClient(target().adminUrl, async (c) => {
    for (const name of await databasesWithPrefix())
      await c.query(`drop database if exists ${escapeIdentifier(name)} with (force)`);
  });
});

describe('dev snapshots: names', () => {
  it('turns a label into a safe identifier and fits the name in 63 characters', () => {
    expect(slugOf('After Day 1 — ¡ok!')).toBe('after_day_1_ok');
    expect(slugOf('   ')).toBe('snapshot');
    const name = snapshotName('dmg_snap_', 'a very long label '.repeat(8), new Date(Date.UTC(2026, 8, 24, 22, 54, 26)));
    expect(name).toMatch(/^dmg_snap_20260924_225426_a_very_long_label/);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).not.toMatch(/_$/);
  });

  it('refuses to target the maintenance databases, templates and snapshots themselves', () => {
    for (const db of ['postgres', 'template1', 'dmg_template_abc', 'dmg_snap_20260924_225426_x', 'Weird-Name']) {
      expect(() => snapshotTarget(url(db))).toThrow(/cannot target/);
    }
    expect(snapshotTarget(url('demiurgo_web_dev'))).toMatchObject({
      database: 'demiurgo_web_dev',
      adminUrl: url('postgres'),
      prefix: 'dmg_snap_',
    });
  });
});

describe('dev snapshots: whole database', () => {
  it('saves, lists and restores the whole database, and the snapshot stays', async () => {
    await createProject('Alpha');
    const saved = await saveSnapshot(target(), 'after alpha', nextMoment());
    expect(saved).toMatchObject({ label: 'after alpha', source: base().name, projects: [{ name: 'Alpha', events: 1 }] });
    expect(saved.migration).toMatch(/^\d{4}$/);
    expect(saved.size_bytes).toBeGreaterThan(0);

    await createProject('Beta');
    expect(await projectNames()).toEqual(['Alpha', 'Beta']);

    // By label: the newest snapshot with that label.
    const restored = await restoreSnapshot(target(), 'after alpha');
    expect(restored.name).toBe(saved.name);
    expect(await projectNames()).toEqual(['Alpha']);
    expect((await listSnapshots(target())).map((s) => s.name)).toContain(saved.name);
  });

  it('keeps the people and their live sessions across a restore', async () => {
    const saved = await saveSnapshot(target(), 'before people', nextMoment());
    await addPerson('bea');
    await addPerson('carl', { expired: true });
    await restoreSnapshot(target(), saved.name);
    expect(await usernames()).toEqual(expect.arrayContaining(['bea', 'carl']));
    const tokens = await withClient(base().url, async (c) =>
      (await c.query<{ token_hash: string }>('select token_hash from sessions order by token_hash')).rows.map(
        (r) => r.token_hash,
      ),
    );
    expect(tokens).toEqual(['token-bea']);
  });

  it('resets to an empty, migrated database with the same people', async () => {
    const before = await usernames();
    await resetDatabase(target());
    expect(await projectNames()).toEqual([]);
    expect(await usernames()).toEqual(before);
    const migrations = await withClient(
      base().url,
      async (c) => (await c.query('select version from schema_migrations')).rowCount,
    );
    expect(migrations).toBeGreaterThan(0);
  });

  it('refuses to save while someone else is connected, and leaves nothing behind', async () => {
    const before = await databasesWithPrefix();
    await withClient(base().url, async () => {
      await expect(saveSnapshot(target(), 'busy', nextMoment())).rejects.toMatchObject({ type: 'conflict' });
    });
    expect(await databasesWithPrefix()).toEqual(before);
  });

  it('refuses a snapshot whose migrations are not on disk, and leaves the live database alone', async () => {
    await createProject('Gamma');
    const saved = await saveSnapshot(target(), 'from the future', nextMoment());
    await withClient(base().url.replace(`/${base().name}`, `/${saved.name}`), (c) =>
      c.query("insert into schema_migrations (version, name, checksum) values ('9999', 'future', 'x')"),
    );
    await createProject('Delta');
    await expect(restoreSnapshot(target(), saved.name)).rejects.toThrow(/missing from disk/);
    expect(await projectNames()).toEqual(['Delta', 'Gamma']);
    expect((await databasesWithPrefix()).filter((d) => d.includes('tmp'))).toEqual([]);
  });

  it('drops only snapshots of this database', async () => {
    const saved = await saveSnapshot(target(), 'to drop', nextMoment());
    const foreign = `${PREFIX}20260101_000000_foreign`;
    await withClient(target().adminUrl, async (c) => {
      await c.query(`create database ${escapeIdentifier(foreign)}`);
      const meta = {
        label: 'foreign',
        created_at: '2026-01-01T00:00:00.000Z',
        source: 'someone_else',
        migration: null,
        projects: [],
      };
      await c.query(`comment on database ${escapeIdentifier(foreign)} is ${escapeLiteral(JSON.stringify(meta))}`);
    });
    for (const ref of [foreign, base().name, 'postgres', 'dmg_template_abc', 'dmg_snap_20260924_225426_x']) {
      await expect(dropSnapshot(target(), ref)).rejects.toMatchObject({ type: 'not_found' });
    }
    await dropSnapshot(target(), saved.name);
    expect((await listSnapshots(target())).map((s) => s.name)).not.toContain(saved.name);
    expect(await databasesWithPrefix()).not.toContain(saved.name);
    expect(await databasesWithPrefix()).toContain(foreign);
  });
});
