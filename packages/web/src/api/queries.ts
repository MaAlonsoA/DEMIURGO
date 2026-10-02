// One query function per API query, each with its cache key. Keys are grouped under the project
// (['p', projectId, …]) so an event or a command can invalidate what it touches (spec §8).

import { queryOptions } from '@tanstack/react-query';
import { ApiError, get, setCsrf } from './client.ts';
import type { CodeMap } from './code-map-types.ts';
import type {
  TaskView,
  AgentToken,
  BatchDetail,
  BuildQueue,
  Changes,
  ProjectCommits,
  CommandCatalog,
  EventRow,
  Exploration,
  GlossaryEntry,
  ExplorationDetail,
  IdeaAssessment,
  Inbox,
  IssueView,
  Knowledge,
  KnowledgeGraph,
  ProductState,
  Project,
  ProductDefinition,
  Readiness,
  StageRow,
  ProjectUsageRow,
  RecordDetail,
  RunDetail,
  ReadingTranslation,
  QueuedRun,
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
  coherence: (p: string, code: string) => ['p', p, 'coherence', code] as const,
  definition: (p: string) => ['p', p, 'definition'] as const,
  readiness: (p: string, versionId: string) => ['p', p, 'readiness', versionId] as const,
  batch: (p: string, id: string) => ['p', p, 'batch', id] as const,
  run: (p: string, id: string) => ['p', p, 'run', id] as const,
  runs: (p: string) => ['p', p, 'runs'] as const,
  events: (p: string, from: string) => ['p', p, 'events', from] as const,
  knowledge: (p: string) => ['p', p, 'knowledge'] as const,
  sources: (p: string) => ['p', p, 'sources'] as const,
  tokens: (p: string) => ['p', p, 'tokens'] as const,
  issues: (p: string) => ['p', p, 'issues'] as const,
  issue: (p: string, code: string) => ['p', p, 'issue', code] as const,
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

export const glossaryQuery = (p: string) =>
  queryOptions({
    queryKey: ['p', p, 'glossary'] as const,
    queryFn: () => get<GlossaryEntry[]>(`${P(p)}/glossary`),
  });

/** A record in the person's language, for reading. Refetched with the rest of the project on its events. */
export const translationQuery = (p: string, subject: string, id: string, lang: string) =>
  queryOptions({
    queryKey: ['p', p, 'translation', subject, id, lang] as const,
    queryFn: () => get<ReadingTranslation>(`${P(p)}/translations/${subject}/${id}?lang=${lang}`),
    staleTime: 10 * 60_000,
    retry: false,
  });

export const projectsQuery = queryOptions({
  queryKey: keys.projects,
  queryFn: () => get<Project[]>('/api/projects'),
});

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
  queryOptions({
    queryKey: keys.state(p),
    queryFn: () => get<ProductState>(`${P(p)}/state`),
  });

export const inboxQuery = (p: string) =>
  queryOptions({
    queryKey: keys.inbox(p),
    queryFn: () => get<Inbox>(`${P(p)}/inbox`),
  });

export const explorationsQuery = (p: string) =>
  queryOptions({
    queryKey: keys.explorations(p),
    queryFn: () => get<Exploration[]>(`${P(p)}/explorations`),
  });

export const explorationQuery = (p: string, id: string) =>
  queryOptions({
    queryKey: keys.exploration(p, id),
    queryFn: () => get<ExplorationDetail>(`${P(p)}/explorations/${id}`),
  });

/** The Build page (FDR-BUI-002): the server's queue, Waiting and open requests. */
export const buildQueueQuery = (p: string) =>
  queryOptions({
    queryKey: ['p', p, 'build'] as const,
    queryFn: () => get<BuildQueue>(`${P(p)}/build`),
  });

/** The server-composed build brief of a ready record: never composed in the browser. */
export const fetchBrief = (p: string, code: string) =>
  get<{ brief: string }>(`${P(p)}/records/${encodeURIComponent(code)}/brief`).then((r) => r.brief);

export const recordQuery = (p: string, code: string) =>
  queryOptions({
    queryKey: keys.record(p, code),
    queryFn: () => get<RecordDetail>(`${P(p)}/records/${encodeURIComponent(code)}`),
  });

/** A task the task planner proposed (pending, accepted or rejected), read as the task page reads a record. */
export const taskDraftQuery = (p: string, proposalId: string) =>
  queryOptions({
    queryKey: ['p', p, 'task-draft', proposalId] as const,
    queryFn: () => get<TaskView>(`${P(p)}/task-drafts/${encodeURIComponent(proposalId)}`),
  });

/** The last coherence review of an epic (FDR-KNO-056). */
export type CoherenceStatus = {
  epic: string;
  run: {
    id: string;
    state: string;
    running: boolean;
    created_at: string;
    finished_at: string | null;
    failure_kind: string | null;
    error: string | null;
  } | null;
  read?: string[];
  omitted?: string[];
  found?: number;
  dropped?: number;
  proposed?: number;
  pending?: number;
  batch?: string | null;
};

export const coherenceQuery = (p: string, code: string) =>
  queryOptions({
    queryKey: keys.coherence(p, code),
    queryFn: () => get<CoherenceStatus>(`${P(p)}/records/${encodeURIComponent(code)}/coherence`),
  });

export const definitionQuery = (p: string) =>
  queryOptions({
    queryKey: keys.definition(p),
    queryFn: () => get<ProductDefinition>(`${P(p)}/definition`),
  });

export const readinessQuery = (p: string, versionId: string) =>
  queryOptions({
    queryKey: keys.readiness(p, versionId),
    queryFn: () => get<Readiness>(`${P(p)}/versions/${versionId}/readiness`),
  });

export const batchQuery = (p: string, id: string) =>
  queryOptions({
    queryKey: keys.batch(p, id),
    queryFn: () => get<BatchDetail>(`${P(p)}/batches/${id}`),
  });

export const runQuery = (p: string, id: string) =>
  queryOptions({
    queryKey: keys.run(p, id),
    queryFn: () => get<RunDetail>(`${P(p)}/runs/${id}`),
  });

export const eventsQuery = (p: string, from: string) =>
  queryOptions({
    queryKey: keys.events(p, from),
    queryFn: () => get<EventRow[]>(`${P(p)}/events?from=${from}`),
  });

export const knowledgeQuery = (p: string) =>
  queryOptions({
    queryKey: keys.knowledge(p),
    queryFn: () => get<Knowledge>(`${P(p)}/knowledge`),
  });

export const knowledgeSearchQuery = (p: string, q: string) =>
  queryOptions({
    queryKey: [...keys.knowledge(p), 'search', q] as const,
    queryFn: () => get<{ results: SearchResult[] }>(`${P(p)}/knowledge/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });

export const sourcesQuery = (p: string) =>
  queryOptions({
    queryKey: keys.sources(p),
    queryFn: () => get<Source[]>(`${P(p)}/sources`),
  });

/** The keys of the external agents of a project (never their secrets). */
export const tokensQuery = (p: string) =>
  queryOptions({
    queryKey: keys.tokens(p),
    queryFn: () => get<AgentToken[]>(`${P(p)}/tokens`),
  });

export const runsQuery = (p: string, filter: { exploration?: string; state?: string } = {}) => {
  const search = new URLSearchParams(filter).toString();
  return queryOptions({
    queryKey: [...keys.runs(p), filter] as const,
    queryFn: () => get<RunListItem[]>(`${P(p)}/runs${search ? `?${search}` : ''}`),
  });
};

/** The run requests the server queued (HTTP 202); polled while any waits, since no event says it started. */
export const queuedRunsQuery = (p: string) =>
  queryOptions({
    queryKey: [...keys.runs(p), 'queued'] as const,
    queryFn: () => get<QueuedRun[]>(`${P(p)}/runs-queued`),
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? 3000 : false),
  });

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

/**
 * Keyed apart from 'knowledge' on purpose: rebuilding is expensive, so knowledge events don't
 * recompute it; "Rebuild again" and the person's own commands do.
 */
export const rebuildQuery = (p: string) =>
  queryOptions({
    queryKey: ['p', p, 'knowledge-rebuild'] as const,
    queryFn: () =>
      get<{
        live: string;
        rebuilt: string | null;
        equal: boolean;
        drift: string | null;
      }>(`${P(p)}/knowledge/rebuild`),
    staleTime: 60_000,
  });

export const taxonomiesQuery = (p: string) =>
  queryOptions({
    queryKey: [...keys.knowledge(p), 'taxonomies'] as const,
    queryFn: () => get<Taxonomy[]>(`${P(p)}/taxonomies`),
  });

export const changesQuery = (p: string, since: string) =>
  queryOptions({
    queryKey: ['p', p, 'changes', since] as const,
    queryFn: () => get<Changes>(`${P(p)}/changes?since=${since}`),
    staleTime: Infinity,
  });

/** The events of one entity (a run, a batch…), oldest first. */
export const entityEventsQuery = (p: string, entityId: string) =>
  queryOptions({
    queryKey: ['p', p, 'events', 'entity', entityId] as const,
    queryFn: () => get<EventRow[]>(`${P(p)}/events?entity=${entityId}`),
  });

/** The design stages of the project (design engine) with the coverage of their mandatory questions. */
export const stagesQuery = (p: string) =>
  queryOptions({
    queryKey: ['p', p, 'stages'] as const,
    queryFn: () => get<StageRow[]>(`${P(p)}/stages`),
  });

/** The project's repository and its commits; they land right after each change, so it polls. */
export const commitsQuery = (p: string) =>
  queryOptions({
    queryKey: ['p', p, 'commits'] as const,
    queryFn: () => get<ProjectCommits>(`${P(p)}/commits`),
    refetchInterval: 5000,
  });

/** The project's app running from main («Open the app»); it polls while the app is starting. */
export type PreviewState =
  | { state: 'stopped' }
  | { state: 'starting'; step: string }
  | { state: 'running'; url: string; port: number; started_at: string; commit: string; seed?: string; accounts?: { role: string; email: string; password: string }[] }
  | { state: 'failed'; reason: string; log?: string };
export const previewQuery = (p: string) =>
  queryOptions({
    queryKey: ['p', p, 'preview'] as const,
    queryFn: () => get<PreviewState>(`${P(p)}/preview`),
    refetchInterval: (q) => (q.state.data?.state === 'starting' ? 2000 : false),
  });

/** How features map onto code: files per feature, hotspots and owners of tables and routes. */
export const codeMapQuery = (p: string) =>
  queryOptions({
    queryKey: ['p', p, 'code-map'] as const,
    queryFn: () => get<CodeMap>(`${P(p)}/code-map`),
  });

/** What the project's agents consumed, per agent. Under 'runs' so every run event refreshes it. */
export const usageQuery = (p: string) =>
  queryOptions({
    queryKey: ['p', p, 'runs', 'usage'] as const,
    queryFn: () => get<ProjectUsageRow[]>(`${P(p)}/usage`),
  });

export const issuesQuery = (p: string) =>
  queryOptions({
    queryKey: keys.issues(p),
    queryFn: () => get<{ issues: IssueView[] }>(`${P(p)}/issues`).then((r) => r.issues),
  });

export const issueQuery = (p: string, code: string) =>
  queryOptions({
    queryKey: keys.issue(p, code),
    queryFn: () => get<IssueView>(`${P(p)}/issues/${encodeURIComponent(code)}`),
  });
