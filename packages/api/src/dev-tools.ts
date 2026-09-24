// Development tools over HTTP: snapshots of the whole database and reset. Registered only with
// DEMIURGO_DEV_TOOLS=1 and only for a person with a session (the CSRF check is the server's).
// Saving, restoring and resetting restart the core in place (see runtime.ts).

import {
  type Snapshot,
  dropSnapshot,
  findSnapshot,
  listSnapshots,
  resetDatabase,
  restoreSnapshot,
  saveSnapshot,
  snapshotTarget,
} from '@demiurgo/core';
import { DomainError } from '@demiurgo/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Runtime } from './runtime.ts';

export type DevTools = {
  database: string;
  /** Resolves when no restart is in progress: every request waits for it. */
  ready(): Promise<void>;
  list(): Promise<Snapshot[]>;
  save(label: string): Promise<Snapshot>;
  restore(ref: string): Promise<Snapshot>;
  drop(ref: string): Promise<Snapshot>;
  reset(): Promise<void>;
};

export function createDevTools(runtime: Runtime, databaseUrl: string): DevTools {
  const target = snapshotTarget(databaseUrl);
  return {
    database: target.database,
    ready: () => runtime.ready(),
    list: () => listSnapshots(target),
    save: (label) => runtime.restart(() => saveSnapshot(target, label)),
    async restore(ref) {
      // Checked before stopping anything: a wrong name must not restart the API.
      const snapshot = await findSnapshot(target, ref);
      return runtime.restart(() => restoreSnapshot(target, snapshot.name));
    },
    drop: (ref) => dropSnapshot(target, ref),
    reset: () => runtime.restart(() => resetDatabase(target)),
  };
}

function requirePerson(req: FastifyRequest): void {
  if (req.credential.type === 'none') throw new DomainError('unauthenticated', 'A session is required.');
  if (req.credential.type !== 'person') throw new DomainError('forbidden', 'Only a person can use the dev tools.');
}

const saveBody = z.object({ label: z.string().max(60).optional() });

export function registerDevRoutes(app: FastifyInstance, dev: DevTools): void {
  app.get('/api/dev/snapshots', async (req) => {
    requirePerson(req);
    return { database: dev.database, snapshots: await dev.list() };
  });

  app.post('/api/dev/snapshots', async (req) => {
    requirePerson(req);
    const body = saveBody.safeParse(req.body ?? {});
    if (!body.success) throw new DomainError('validation', 'The label is at most 60 characters.');
    return { snapshot: await dev.save(body.data.label ?? '') };
  });

  app.post('/api/dev/snapshots/:name/restore', async (req) => {
    requirePerson(req);
    const { name } = req.params as { name: string };
    return { restored: await dev.restore(name) };
  });

  app.delete('/api/dev/snapshots/:name', async (req) => {
    requirePerson(req);
    const { name } = req.params as { name: string };
    return { dropped: await dev.drop(name) };
  });

  app.post('/api/dev/reset', async (req) => {
    requirePerson(req);
    await dev.reset();
    return { reset: true };
  });
}
