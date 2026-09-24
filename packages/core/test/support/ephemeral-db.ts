// Ephemeral database per test file, cloned from the migrated template.

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';

export type EphemeralDatabase = { name: string; url: string; drop(): Promise<void> };

function urlWith(name: string, base: string): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function createEphemeralDatabase(): Promise<EphemeralDatabase> {
  const urlAdmin = inject('urlAdmin');
  const template = inject('template');
  const name = `dmg_t_${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    await admin.query(`create database "${name}" template "${template}"`);
  } finally {
    await admin.end();
  }
  return {
    name,
    url: urlWith(name, urlAdmin),
    async drop() {
      if (!name.startsWith('dmg_t_')) throw new Error('Only ephemeral databases are dropped.');
      const c = new Client({ connectionString: urlAdmin });
      await c.connect();
      try {
        await c.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}

/** Registers an ephemeral database for the current test file. */
export function useEphemeralDatabase(): () => EphemeralDatabase {
  let base: EphemeralDatabase | undefined;
  beforeAll(async () => {
    base = await createEphemeralDatabase();
  });
  afterAll(async () => {
    await base?.drop();
  });
  return () => {
    if (!base) throw new Error('The ephemeral database does not exist yet.');
    return base;
  };
}
