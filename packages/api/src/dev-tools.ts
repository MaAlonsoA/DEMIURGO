// Development tools over HTTP: snapshots of the whole database, reset, and the trace of any
// entity (where it comes from, its raw data and which agent contexts read it). Registered only with
// DEMIURGO_DEV_TOOLS=1 and only for a person with a session (the CSRF check is the server's).
// Saving, restoring and resetting restart the core in place (see runtime.ts).

import {
  type ProjectSnapshot,
  type RestoreResult,
  type Services,
  type Snapshot,
  deleteProjectData,
  dropProjectSnapshot,
  dropSnapshot,
  findSnapshot,
  listProjectSnapshots,
  listSnapshots,
  restoreProjectSnapshot,
  saveProjectSnapshot,
  resetDatabase,
  restoreSnapshot,
  saveSnapshot,
  snapshotTarget,
  traceEntity,
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
  /** Per-project snapshots: the core keeps running, nothing restarts. */
  listProject(projectId: string): Promise<ProjectSnapshot[]>;
  saveProject(projectId: string, label: string): Promise<ProjectSnapshot>;
  restoreProject(ref: string): Promise<RestoreResult>;
  dropProject(ref: string): Promise<ProjectSnapshot>;
  deleteProject(projectId: string): Promise<number>;
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
    listProject: (projectId) => listProjectSnapshots(target, projectId),
    saveProject: (projectId, label) => saveProjectSnapshot(target, projectId, label),
    restoreProject: (ref) => restoreProjectSnapshot(target, ref),
    dropProject: (ref) => dropProjectSnapshot(target, ref),
    async deleteProject(projectId) {
      const rows = await deleteProjectData(target, projectId);
      return Object.values(rows).reduce((a, b) => a + b, 0);
    },
  };
}

function requirePerson(req: FastifyRequest): void {
  if (req.credential.type === 'none') throw new DomainError('unauthenticated', 'A session is required.');
  if (req.credential.type !== 'person') throw new DomainError('forbidden', 'Only a person can use the dev tools.');
}

const saveBody = z.object({ label: z.string().max(60).optional() });

const projectParams = z.object({ projectId: z.string().uuid() });

function projectIdOf(req: FastifyRequest): string {
  const p = projectParams.safeParse(req.params);
  if (!p.success) throw new DomainError('validation', 'The project id must be a uuid.');
  return p.data.projectId;
}

const traceQuery = z.object({ project: z.string().uuid(), type: z.string().min(1).max(40), id: z.string().uuid() });

export function registerDevRoutes(app: FastifyInstance, dev: DevTools, services: Services): void {
  app.get('/api/dev/trace', async (req) => {
    requirePerson(req);
    const q = traceQuery.safeParse(req.query);
    if (!q.success) throw new DomainError('validation', 'The trace needs a project, a type and an id.');
    return traceEntity(services.db, q.data.project, q.data.type, q.data.id);
  });

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

  app.get('/api/dev/projects/:projectId/snapshots', async (req) => {
    requirePerson(req);
    return { snapshots: await dev.listProject(projectIdOf(req)) };
  });

  app.post('/api/dev/projects/:projectId/snapshots', async (req) => {
    requirePerson(req);
    const projectId = projectIdOf(req);
    const body = saveBody.safeParse(req.body ?? {});
    if (!body.success) throw new DomainError('validation', 'The label is at most 60 characters.');
    return { snapshot: await dev.saveProject(projectId, body.data.label ?? '') };
  });

  app.post('/api/dev/project-snapshots/:name/restore', async (req) => {
    requirePerson(req);
    const { name } = req.params as { name: string };
    return dev.restoreProject(name).then((r) => ({ restored: r.restored, git: r.git }));
  });

  app.delete('/api/dev/project-snapshots/:name', async (req) => {
    requirePerson(req);
    const { name } = req.params as { name: string };
    return { dropped: await dev.dropProject(name) };
  });

  app.delete('/api/dev/projects/:projectId', async (req) => {
    requirePerson(req);
    return { deleted: true, rows: await dev.deleteProject(projectIdOf(req)) };
  });

  app.post('/api/dev/reset', async (req) => {
    requirePerson(req);
    await dev.reset();
    return { reset: true };
  });
}
