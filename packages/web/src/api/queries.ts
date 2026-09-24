// One query function per API query, each with its cache key. Keys are grouped under the project
// (['p', projectId, …]) so an event or a command can invalidate what it touches (spec §8).

import { queryOptions } from '@tanstack/react-query';
import { ApiError, get, setCsrf } from './client.ts';
import type {
  BatchDetail,
  CommandCatalog,
  EventRow,
  Exploration,
  ExplorationDetail,
  IdeaAssessment,
  Inbox,
  Knowledge,
  KnowledgeGraph,
  ProductState,
  Project,
  Readiness,
  RecordDetail,
  RunDetail,
  RunListItem,
  SearchResult,
  Session,
  Source,
  Tables,
  Taxonomy,
} from './types.ts';

const P = (projectId: string) => `/api/projects/${projectId}`;

export const keys = {
  session: ['session'] as const,
  projects: ['projects'] as const,
  tables: ['tables'] as const,
  commands: ['commands'] as const,
  project: (p: string) => ['p', p] as const,
  state: (p: string) => ['p', p, 'state'] as const,
  inbox: (p: string) => ['p', p, 'inbox'] as const,
  explorations: (p: string) => ['p', p, 'explorations'] as const,
  exploration: (p: string, id: string) => ['p', p, 'exploration', id] as const,
  record: (p: string, code: string) => ['p', p, 'record', code] as const,
  readiness: (p: string, versionId: string) => ['p', p, 'readiness', versionId] as const,
  batch: (p: string, id: string) => ['p', p, 'batch', id] as const,
  run: (p: string, id: string) => ['p', p, 'run', id] as const,
  runs: (p: string) => ['p', p, 'runs'] as const,
  events: (p: string, from: string) => ['p', p, 'events', from] as const,
  knowledge: (p: string) => ['p', p, 'knowledge'] as const,
  sources: (p: string) => ['p', p, 'sources'] as const,
};

/** The session, or null without one. Keeps the CSRF token in memory for the mutations. */
export const sessionQuery = queryOptions({
  queryKey: keys.session,
  queryFn: async (): Promise<Session | null> => {
    try {
      const s = await get<Session>('/api/session');
      setCsrf(s.csrf);
      return s;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setCsrf(null);
        return null;
      }
      throw e;
    }
  },
  staleTime: 60_000,
});

export const projectsQuery = queryOptions({ queryKey: keys.projects, queryFn: () => get<Project[]>('/api/projects') });

export const tablesQuery = queryOptions({
  queryKey: keys.tables,
  queryFn: () => get<Tables>('/api/tables'),
  staleTime: Infinity,
});

export const commandsQuery = queryOptions({
  queryKey: keys.commands,
  queryFn: () => get<CommandCatalog>('/api/commands'),
  staleTime: Infinity,
});

export const stateQuery = (p: string) =>
  queryOptions({ queryKey: keys.state(p), queryFn: () => get<ProductState>(`${P(p)}/state`) });

export const inboxQuery = (p: string) => queryOptions({ queryKey: keys.inbox(p), queryFn: () => get<Inbox>(`${P(p)}/inbox`) });

export const explorationsQuery = (p: string) =>
  queryOptions({ queryKey: keys.explorations(p), queryFn: () => get<Exploration[]>(`${P(p)}/explorations`) });

export const explorationQuery = (p: string, id: string) =>
  queryOptions({ queryKey: keys.exploration(p, id), queryFn: () => get<ExplorationDetail>(`${P(p)}/explorations/${id}`) });

export const recordQuery = (p: string, code: string) =>
  queryOptions({
    queryKey: keys.record(p, code),
    queryFn: () => get<RecordDetail>(`${P(p)}/records/${encodeURIComponent(code)}`),
  });

export const readinessQuery = (p: string, versionId: string) =>
  queryOptions({
    queryKey: keys.readiness(p, versionId),
    queryFn: () => get<Readiness>(`${P(p)}/versions/${versionId}/readiness`),
  });

export const batchQuery = (p: string, id: string) =>
  queryOptions({ queryKey: keys.batch(p, id), queryFn: () => get<BatchDetail>(`${P(p)}/batches/${id}`) });

export const runQuery = (p: string, id: string) =>
  queryOptions({ queryKey: keys.run(p, id), queryFn: () => get<RunDetail>(`${P(p)}/runs/${id}`) });

export const eventsQuery = (p: string, from: string) =>
  queryOptions({ queryKey: keys.events(p, from), queryFn: () => get<EventRow[]>(`${P(p)}/events?from=${from}`) });

export const knowledgeQuery = (p: string) =>
  queryOptions({ queryKey: keys.knowledge(p), queryFn: () => get<Knowledge>(`${P(p)}/knowledge`) });

export const knowledgeSearchQuery = (p: string, q: string) =>
  queryOptions({
    queryKey: [...keys.knowledge(p), 'search', q] as const,
    queryFn: () => get<{ results: SearchResult[] }>(`${P(p)}/knowledge/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });

export const sourcesQuery = (p: string) =>
  queryOptions({ queryKey: keys.sources(p), queryFn: () => get<Source[]>(`${P(p)}/sources`) });

export const runsQuery = (p: string, filter: { exploration?: string; state?: string } = {}) => {
  const search = new URLSearchParams(filter).toString();
  return queryOptions({
    queryKey: [...keys.runs(p), filter] as const,
    queryFn: () => get<RunListItem[]>(`${P(p)}/runs${search ? `?${search}` : ''}`),
  });
};

export const graphQuery = (p: string) =>
  queryOptions({
    queryKey: [...keys.knowledge(p), 'graph'] as const,
    queryFn: () => get<KnowledgeGraph>(`${P(p)}/knowledge/graph`),
  });

export const ideaAssessmentsQuery = (p: string) =>
  queryOptions({
    queryKey: [...keys.knowledge(p), 'idea-assessments'] as const,
    queryFn: () => get<IdeaAssessment[]>(`${P(p)}/knowledge/idea-assessments`),
  });

export const rebuildQuery = (p: string) =>
  queryOptions({
    queryKey: [...keys.knowledge(p), 'rebuild'] as const,
    queryFn: () =>
      get<{ live: string; rebuilt: string | null; equal: boolean; drift: string | null }>(`${P(p)}/knowledge/rebuild`),
    staleTime: 60_000,
  });

export const taxonomiesQuery = (p: string) =>
  queryOptions({ queryKey: [...keys.knowledge(p), 'taxonomies'] as const, queryFn: () => get<Taxonomy[]>(`${P(p)}/taxonomies`) });
