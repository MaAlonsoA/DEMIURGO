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
import { DomainError, system } from '@demiurgo/domain';
import { executeCommand } from '@demiurgo/core';
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
    const r = await dev.restoreProject(name);
    const settled = await afterProjectRestore(services, r.restored.project.id);
    return { restored: r.restored, git: `${r.git} ${settled}`.trim() };
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

/**
 * A project snapshot keeps its runs as they were at that moment, but the durable engine (DBOS) is not
 * part of it: a run saved while running has no workflow left, and a stage's deferred introduction is
 * remembered as done. So, after a restore, the runs saved mid-way are marked interrupted (the person
 * can retry them) and every open stage whose questions still have no options asks for its
 * introduction again, under a new key.
 */
async function afterProjectRestore(services: Services, projectId: string): Promise<string> {
  const db = services.db;
  const running = await db
    .selectFrom('ai_runs')
    .select('id')
    .where('project_id', '=', projectId)
    .where('state', '=', 'running')
    .execute();
  for (const run of running)
    await executeCommand(services, {
      command: 'run.interrupt',
      actor: system('dev-tools'),
      projectId,
      entityId: run.id,
      data: { reason: 'Restored from a snapshot: this run was in progress when the snapshot was saved.' },
    });
  const queued = await db.selectFrom('ai_runs').select('id').where('project_id', '=', projectId).where('state', '=', 'queued').execute();
  for (const run of queued) await services.engine.startRun(run.id, projectId);
  const stages = await db
    .selectFrom('stages')
    .select(['id', 'stage', 'exploration_id'])
    .where('project_id', '=', projectId)
    .where('state', '=', 'open')
    .execute();
  let asked = 0;
  for (const st of stages) {
    if (!st.exploration_id) continue;
    const bare = await db
      .selectFrom('questions')
      .select('id')
      .where('stage_id', '=', st.id)
      .where('state', '=', 'pending')
      .where((eb) => eb.or([eb('options', 'is', null), eb(eb.fn('jsonb_array_length', ['options']), '=', 0)]))
      .executeTakeFirst();
    if (!bare) continue;
    await services.engine.startDeferredRun(`stage_opened:${st.id}:restored:${Date.now()}`, projectId, st.exploration_id, {
      stage_opened: st.stage,
    });
    asked++;
  }
  const parts = [
    running.length ? `${running.length} run(s) saved mid-way marked interrupted.` : '',
    queued.length ? `${queued.length} queued run(s) started.` : '',
    asked ? `${asked} open stage(s) asked again for their options.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}
