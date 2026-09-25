// Models & providers (FDR-AGE-002): what each provider offers, the agents and their assignments,
// statistics and consumption, and the calls of a run. Reading is a query of the matrix
// (query.providers, only people); the changes are workspace settings, checked by their own section
// of the matrix (403 before 422, like the bus).

import {
  SETTINGS,
  type Services,
  consumption,
  currentAssignments,
  currentCatalogs,
  loadAgentCatalog,
  providerStats,
  resolveEngine,
  runCalls,
} from '@demiurgo/core';
import { type Actor, DomainError } from '@demiurgo/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuid } from './queries.ts';

export type ModelRoutes = {
  services: Services;
  actorOf(req: FastifyRequest): Actor;
  requireQuery(req: FastifyRequest, query: 'query.providers' | 'query.runs', projectId?: string): Actor;
};

const assignmentBody = z
  .object({
    scope: z.enum(['global', 'project']),
    project_id: z.string().optional(),
    provider: z.string(),
    model: z.string(),
    effort: z.string().nullable(),
  })
  .strict();

export function registerModelRoutes(app: FastifyInstance, r: ModelRoutes): void {
  const deps = () => ({ db: r.services.db, providers: r.services.providers });

  app.get('/api/providers', async (req) => {
    r.requireQuery(req, 'query.providers');
    const { db, providers } = deps();
    return {
      providers: providers.list().map((p) => ({ id: p.id, label: p.label, sessions: p.sessions })),
      catalogs: await currentCatalogs(db, providers),
      stats: await providerStats(db),
      consumption: await consumption(db, r.services.clock()),
    };
  });

  app.post('/api/providers/refresh', async (req) => {
    const catalogs = await SETTINGS['providers.refresh'](deps(), r.actorOf(req), {});
    return { catalogs };
  });

  app.get('/api/agents', async (req) => {
    r.requireQuery(req, 'query.providers');
    const project = (req.query as { project?: string }).project;
    const projectId = project ? uuid(project, 'project') : undefined;
    const { db, providers } = deps();
    const catalog = await loadAgentCatalog();
    const assignments = await currentAssignments(db, projectId);
    const agents = await Promise.all(
      catalog.agents.map(async (a) => ({
        id: a.id,
        description: a.description,
        action: a.action,
        section: a.section,
        skills: a.skills,
        session: a.session,
        time_limit: a.timeLimitSeconds,
        version: a.version,
        global: assignments.find((x) => x.agent === a.id && x.scope === 'global') ?? null,
        project: projectId ? (assignments.find((x) => x.agent === a.id && x.scope === 'project') ?? null) : null,
        effective: await resolveEngine(db, providers, { ...(projectId ? { projectId } : {}), agent: a.id }),
      })),
    );
    return { agents, skills: catalog.skills.map((s) => ({ id: s.id, description: s.description })) };
  });

  app.put('/api/agents/:agent/assignment', async (req) => {
    const { agent } = req.params as { agent: string };
    const body = assignmentBody.safeParse(req.body ?? {});
    if (!body.success) {
      throw new DomainError(
        'validation',
        'The assignment is invalid.',
        body.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      );
    }
    await SETTINGS['agent.assign'](deps(), r.actorOf(req), { agent, ...body.data });
    return { ok: true };
  });

  app.delete('/api/agents/:agent/assignment', async (req) => {
    const { agent } = req.params as { agent: string };
    const q = req.query as { scope?: string; project?: string };
    await SETTINGS['agent.unassign'](deps(), r.actorOf(req), {
      agent,
      scope: q.scope ?? 'global',
      ...(q.project ? { project_id: q.project } : {}),
    });
    return { ok: true };
  });

  app.get('/api/projects/:projectId/runs/:runId/calls', async (req) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    r.requireQuery(req, 'query.runs', projectId);
    const calls = await runCalls(r.services.db, uuid(projectId, 'project'), uuid(runId, 'run'));
    // An external agent reads the normalized events only: the raw text of a provider can carry
    // local paths and details of the person's environment.
    if (req.credential.type !== 'person') {
      return { calls: calls.map((c) => ({ ...c, events: c.events.map(({ raw: _raw, ...e }) => e) })) };
    }
    return { calls };
  });
}
