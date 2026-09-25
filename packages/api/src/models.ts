// Models & providers (FDR-AGE-002): what each provider offers, the groups of agents and the agents
// with their engines (one per group, an agent's own as an exception, for every project), statistics
// and consumption, and the calls of a run. Reading is a query of the matrix
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

const engineBody = z
  .object({
    provider: z.string(),
    model: z.string(),
    effort: z.string().nullable(),
  })
  .strict();

function parseEngine(body: unknown) {
  const r = engineBody.safeParse(body ?? {});
  if (!r.success) {
    throw new DomainError(
      'validation',
      'The assignment is invalid.',
      r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    );
  }
  return r.data;
}

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
    const { db, providers } = deps();
    const catalog = await loadAgentCatalog();
    const current = await currentAssignments(db);
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
        group: a.group,
        own: current.agents[a.id] ?? null,
        effective: await resolveEngine(db, providers, { agent: a.id }),
      })),
    );
    const groups = catalog.groups.map((g) => ({ ...g, assignment: current.groups[g.id] ?? null }));
    return { groups, agents, skills: catalog.skills.map((s) => ({ id: s.id, description: s.description })) };
  });

  app.put('/api/groups/:group/assignment', async (req) => {
    const { group } = req.params as { group: string };
    await SETTINGS['agent.assign'](deps(), r.actorOf(req), { group, ...parseEngine(req.body) });
    return { ok: true };
  });

  app.delete('/api/groups/:group/assignment', async (req) => {
    const { group } = req.params as { group: string };
    await SETTINGS['agent.unassign'](deps(), r.actorOf(req), { group });
    return { ok: true };
  });

  app.put('/api/agents/:agent/assignment', async (req) => {
    const { agent } = req.params as { agent: string };
    await SETTINGS['agent.assign'](deps(), r.actorOf(req), { agent, ...parseEngine(req.body) });
    return { ok: true };
  });

  app.delete('/api/agents/:agent/assignment', async (req) => {
    const { agent } = req.params as { agent: string };
    await SETTINGS['agent.unassign'](deps(), r.actorOf(req), { agent });
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
