// Rutas de consulta (lectura). Cada una declara su consulta de la matriz de capacidades.

import { DomainError, type QueryName, graphFingerprint } from '@demiurgo/domain';
import {
  type Services,
  inbox,
  searchKnowledge,
  loadGraph,
  compareRebuild,
  graphUpToDate,
  explorationDetail,
  batchDetail,
  recordDetail,
  productState,
  versionReadiness,
} from '@demiurgo/core';
import type { Credential } from './credentials.ts';

export type QueryInput = {
  services: Services;
  params: Record<string, string>;
  query: Record<string, string>;
  credential: Credential;
};

export type QueryRoute = {
  path: string;
  queryName: QueryName;
  respond(e: QueryInput): Promise<unknown>;
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: string | undefined, what: string): string {
  if (!v || !RE_UUID.test(v)) throw new DomainError('not_found', `No existe ${what}.`);
  return v;
}

export const QUERIES: QueryRoute[] = [
  {
    path: '/api/projects',
    queryName: 'query.projects',
    async respond({ services }) {
      return services.db.selectFrom('projects').select(['id', 'name', 'state', 'created_at']).orderBy('created_at').execute();
    },
  },
  {
    path: '/api/projects/:projectId/events',
    queryName: 'query.events',
    async respond({ services, params, query }) {
      const projectId = uuid(params.projectId, 'el proyecto');
      const from = /^\d+$/.test(query.from ?? '') ? String(query.from) : '0';
      return services.db
        .selectFrom('events')
        .selectAll()
        .where('project_id', '=', projectId)
        .where('id', '>', from)
        .orderBy('id')
        .limit(1000)
        .execute();
    },
  },
  {
    path: '/api/projects/:projectId/runs/:runId',
    queryName: 'query.runs',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'el proyecto');
      const run = await services.db
        .selectFrom('ai_runs')
        .selectAll()
        .where('project_id', '=', projectId)
        .where('id', '=', uuid(params.runId, 'la ejecución'))
        .executeTakeFirst();
      if (!run) throw new DomainError('not_found', 'No existe la ejecución.');
      const pack = run.context_pack_id
        ? await services.db
            .selectFrom('context_packs')
            .select(['id', 'role', 'builder', 'budget', 'graph_version', 'dependencies', 'content', 'hash'])
            .where('id', '=', run.context_pack_id)
            .executeTakeFirst()
        : null;
      return { ...run, context_pack: pack ?? null };
    },
  },
];

export function registerQueries(additions: QueryRoute[]): void {
  QUERIES.push(...additions);
}

registerQueries([
  {
    path: '/api/projects/:projectId/state',
    queryName: 'query.state',
    respond: ({ services, params }) => productState(services.db, uuid(params.projectId, 'el proyecto')),
  },
  {
    path: '/api/projects/:projectId/inbox',
    queryName: 'query.inbox',
    respond: ({ services, params }) => inbox(services.db, uuid(params.projectId, 'el proyecto')),
  },
  {
    path: '/api/projects/:projectId/explorations',
    queryName: 'query.explorations',
    respond: ({ services, params }) =>
      services.db
        .selectFrom('explorations')
        .selectAll()
        .where('project_id', '=', uuid(params.projectId, 'el proyecto'))
        .orderBy('created_at')
        .execute(),
  },
  {
    path: '/api/projects/:projectId/explorations/:explorationId',
    queryName: 'query.explorations',
    respond: ({ services, params }) =>
      explorationDetail(services.db, uuid(params.projectId, 'el proyecto'), uuid(params.explorationId, 'la exploración')),
  },
  {
    path: '/api/projects/:projectId/sources',
    queryName: 'query.explorations',
    respond: ({ services, params }) =>
      services.db
        .selectFrom('sources')
        .select(['id', 'name', 'content_hash', 'registered_by', 'created_at'])
        .where('project_id', '=', uuid(params.projectId, 'el proyecto'))
        .orderBy('created_at')
        .execute(),
  },
  {
    path: '/api/projects/:projectId/records/:code',
    queryName: 'query.records',
    respond: ({ services, params }) =>
      recordDetail(services.db, uuid(params.projectId, 'el proyecto'), params.code ?? ''),
  },
  {
    path: '/api/projects/:projectId/versions/:versionId/readiness',
    queryName: 'query.records',
    respond: ({ services, params }) =>
      versionReadiness(services.db, uuid(params.projectId, 'el proyecto'), uuid(params.versionId, 'la versión')),
  },
  {
    path: '/api/projects/:projectId/batches/:batchId',
    queryName: 'query.batches',
    respond: ({ services, params }) =>
      batchDetail(services.db, uuid(params.projectId, 'el proyecto'), uuid(params.batchId, 'el lote')),
  },
  {
    path: '/api/projects/:projectId/tokens',
    queryName: 'query.tokens',
    respond: ({ services, params }) =>
      services.db
        .selectFrom('agent_tokens')
        .select(['id', 'name', 'state', 'issued_by', 'created_at', 'revoked_at'])
        .where('project_id', '=', uuid(params.projectId, 'el proyecto'))
        .orderBy('created_at')
        .execute(),
  },
]);

registerQueries([
  {
    path: '/api/projects/:projectId/knowledge',
    queryName: 'query.knowledge',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'el proyecto');
      const freshness = await services.db.transaction().execute((trx) => graphUpToDate(trx, projectId));
      const g = await loadGraph(services.db, projectId);
      const updates = await services.db
        .selectFrom('knowledge_updates')
        .select(['id', 'state', 'trigger', 'failure', 'graph_version_before', 'graph_version_after', 'created_at'])
        .where('project_id', '=', projectId)
        .orderBy('trigger_seq', 'desc')
        .limit(20)
        .execute();
      return {
        graph_version: g.version,
        up_to_date: freshness.upToDate,
        updates_in_progress: freshness.pending,
        fingerprint: graphFingerprint(g),
        current_nodes: g.nodes.filter((n) => n.until === null).length,
        current_edges: g.edges.filter((a) => a.validTo === null).length,
        updates,
      };
    },
  },
  {
    path: '/api/projects/:projectId/knowledge/search',
    queryName: 'query.knowledge',
    async respond({ services, params, query }) {
      const queryName = (query.q ?? '').trim();
      if (!queryName) throw new DomainError('validation', 'Falta el texto de búsqueda (q).');
      return { results: await searchKnowledge(services.db, uuid(params.projectId, 'el proyecto'), queryName, 10) };
    },
  },
  {
    path: '/api/projects/:projectId/knowledge/rebuild',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => compareRebuild(services.db, uuid(params.projectId, 'el proyecto')),
  },
]);
