// Query routes (read-only). Each one declares its query from the capability matrix.

import { DomainError, type QueryName, graphFingerprint } from '@demiurgo/domain';
import { sql } from 'kysely';
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
  explorationsList,
  runsList,
  knowledgeGraph,
  ideaAssessments,
  taxonomiesList,
  changesSince,
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
  if (!v || !RE_UUID.test(v)) throw new DomainError('not_found', `The ${what} does not exist.`);
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
      const projectId = uuid(params.projectId, 'project');
      const from = /^\d+$/.test(query.from ?? '') ? String(query.from) : '0';
      // ?entity= keeps only the events of one entity (a run, a batch…) and those it caused.
      let q = services.db.selectFrom('events').selectAll().where('project_id', '=', projectId).where('id', '>', from);
      if (query.entity) {
        const entity = uuid(query.entity, 'entity');
        q = q.where((eb) => eb.or([eb('entity_id', '=', entity), eb(sql<string>`cause->>'run'`, '=', entity)]));
      }
      return q.orderBy('id').limit(1000).execute();
    },
  },
  {
    path: '/api/projects/:projectId/runs/:runId',
    queryName: 'query.runs',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'project');
      const run = await services.db
        .selectFrom('ai_runs')
        .selectAll()
        .where('project_id', '=', projectId)
        .where('id', '=', uuid(params.runId, 'run'))
        .executeTakeFirst();
      if (!run) throw new DomainError('not_found', 'The run does not exist.');
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
    respond: ({ services, params }) => productState(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/inbox',
    queryName: 'query.inbox',
    respond: ({ services, params }) => inbox(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/explorations',
    queryName: 'query.explorations',
    respond: ({ services, params }) => explorationsList(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/explorations/:explorationId',
    queryName: 'query.explorations',
    respond: ({ services, params }) =>
      explorationDetail(services.db, uuid(params.projectId, 'project'), uuid(params.explorationId, 'exploration')),
  },
  {
    path: '/api/projects/:projectId/sources',
    queryName: 'query.explorations',
    respond: ({ services, params }) =>
      services.db
        .selectFrom('sources')
        .select(['id', 'name', 'content_hash', 'registered_by', 'created_at'])
        .where('project_id', '=', uuid(params.projectId, 'project'))
        .orderBy('created_at')
        .execute(),
  },
  {
    path: '/api/projects/:projectId/records/:code',
    queryName: 'query.records',
    respond: ({ services, params }) => recordDetail(services.db, uuid(params.projectId, 'project'), params.code ?? ''),
  },
  {
    path: '/api/projects/:projectId/versions/:versionId/readiness',
    queryName: 'query.records',
    respond: ({ services, params }) =>
      versionReadiness(services.db, uuid(params.projectId, 'project'), uuid(params.versionId, 'version')),
  },
  {
    path: '/api/projects/:projectId/batches/:batchId',
    queryName: 'query.batches',
    respond: ({ services, params }) => batchDetail(services.db, uuid(params.projectId, 'project'), uuid(params.batchId, 'batch')),
  },
  {
    path: '/api/projects/:projectId/tokens',
    queryName: 'query.tokens',
    respond: ({ services, params }) =>
      services.db
        .selectFrom('agent_tokens')
        .select(['id', 'name', 'state', 'issued_by', 'created_at', 'revoked_at'])
        .where('project_id', '=', uuid(params.projectId, 'project'))
        .orderBy('created_at')
        .execute(),
  },
]);

registerQueries([
  {
    path: '/api/projects/:projectId/knowledge',
    queryName: 'query.knowledge',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'project');
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
      const text = (query.q ?? '').trim();
      if (!text) throw new DomainError('validation', 'The search text (q) is missing.');
      return { results: await searchKnowledge(services.db, uuid(params.projectId, 'project'), text, 10) };
    },
  },
  {
    path: '/api/projects/:projectId/knowledge/rebuild',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => compareRebuild(services.db, uuid(params.projectId, 'project')),
  },
]);

// Queries of the web UI (H1): they reuse the query names of the matrix, so design/data does not change.
const RE_STATE = /^[a-z_]{1,40}$/;

registerQueries([
  {
    path: '/api/projects/:projectId/runs',
    queryName: 'query.runs',
    respond: ({ services, params, query }) =>
      runsList(services.db, uuid(params.projectId, 'project'), {
        ...(query.exploration ? { exploration: uuid(query.exploration, 'exploration') } : {}),
        ...(query.state && RE_STATE.test(query.state) ? { state: query.state } : {}),
      }),
  },
  {
    path: '/api/projects/:projectId/knowledge/graph',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => knowledgeGraph(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/knowledge/idea-assessments',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => ideaAssessments(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/changes',
    queryName: 'query.events',
    respond: ({ services, params, query }) =>
      changesSince(services.db, uuid(params.projectId, 'project'), /^\d+$/.test(query.since ?? '') ? String(query.since) : '0'),
  },
  {
    path: '/api/projects/:projectId/taxonomies',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => taxonomiesList(services.db, uuid(params.projectId, 'project')),
  },
]);
