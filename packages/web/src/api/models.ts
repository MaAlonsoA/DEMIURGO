// Models & providers (FDR-AGE-002): what each provider offers, which engine runs each group of
// agents and each agent's own as an exception (the same for every project), statistics and
// consumption, and the calls of a run.

import { queryOptions } from '@tanstack/react-query';
import { get, request } from './client.ts';

export type ProviderModel = { id: string; label: string; efforts: string[]; defaultEffort: string | null };

export type Catalog = {
  provider: string;
  label: string;
  installed: boolean;
  version: string | null;
  ready: boolean;
  message: string | null;
  sessions: boolean;
  models: ProviderModel[];
  discoveredAt: string;
};

export type Engine = { provider: string; model: string; effort: string | null };

export type Assignment = { engine: Engine; assignedBy: string; assignedAt: string };

/** Where an agent's engine comes from: Retry with…, its own (an exception), or its group's. */
export type EngineSource = 'override' | 'agent' | 'group';

export type Resolution =
  | ({ status: 'ok'; source: EngineSource } & Engine)
  | { status: 'unassigned' }
  | ({ status: 'unavailable'; source: EngineSource; reason: string } & Engine);

export type AgentGroup = { id: string; name: string; description: string; assignment: Assignment | null };

export type AgentInfo = {
  id: string;
  description: string;
  action: string;
  section: string;
  skills: string[];
  session: 'thread' | 'none';
  time_limit: number;
  version: string;
  /** The group whose engine it follows, or null if it only runs on its own. */
  group: string | null;
  /** Its own engine, an exception to its group's. */
  own: Assignment | null;
  effective: Resolution | null;
};

export type StatsRow = {
  agent: string;
  provider: string;
  model: string;
  effort: string | null;
  calls: number;
  failures: Record<string, number>;
  avgDurationMs: number | null;
  avgTokens: number | null;
  avgQuestions: number | null;
  avgProposals: number | null;
};

export type ConsumptionRow = { key: string; calls: number; inputTokens: number; outputTokens: number; declaredCostUsd: number };

export type Consumption = {
  today: { byProvider: ConsumptionRow[]; byAgent: ConsumptionRow[] };
  week: { byProvider: ConsumptionRow[]; byAgent: ConsumptionRow[] };
};

export type ProvidersResponse = {
  providers: { id: string; label: string; sessions: boolean }[];
  catalogs: Catalog[];
  stats: StatsRow[];
  consumption: Consumption;
};

export type AgentsResponse = {
  groups: AgentGroup[];
  agents: AgentInfo[];
  skills: { id: string; description: string }[];
};

export type RunUsage = {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  declaredCostUsd?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  turns?: number;
  provenance?: Record<string, string>;
};

export type CallEvent = { seq: number; received_at: string; kind: string; tokens: number | null; raw: string };

export type RunCall = {
  id: string;
  state: 'running' | 'ok' | 'error';
  provider: string;
  requested_model: string;
  observed_model: string | null;
  effort: string | null;
  session_mode: 'none' | 'fresh' | 'resumed';
  provider_session_id: string | null;
  usage: RunUsage | null;
  failure_kind: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  events: CallEvent[];
};

export const modelKeys = {
  providers: ['models', 'providers'] as const,
  agents: ['models', 'agents'] as const,
  calls: (projectId: string, runId: string) => ['p', projectId, 'run', runId, 'calls'] as const,
};

export const providersQuery = queryOptions({
  queryKey: modelKeys.providers,
  queryFn: () => get<ProvidersResponse>('/api/providers'),
});

/** The groups and the agents with their engines: the same inside and outside any project. */
export const agentsQuery = queryOptions({
  queryKey: modelKeys.agents,
  queryFn: () => get<AgentsResponse>('/api/agents'),
});

export const runCallsQuery = (projectId: string, runId: string) =>
  queryOptions({
    queryKey: modelKeys.calls(projectId, runId),
    queryFn: async () => (await get<{ calls: RunCall[] }>(`/api/projects/${projectId}/runs/${runId}/calls`)).calls,
  });

export const refreshProviders = () => request<{ catalogs: Catalog[] }>('POST', '/api/providers/refresh');

/** What an engine choice is for: a whole group, or one agent as an exception to its group. */
export type EngineTarget = { group: string } | { agent: string };

const assignmentPath = (t: EngineTarget) =>
  'group' in t
    ? `/api/groups/${encodeURIComponent(t.group)}/assignment`
    : `/api/agents/${encodeURIComponent(t.agent)}/assignment`;

export const assignEngine = (target: EngineTarget, engine: Engine) =>
  request<{ ok: true }>('PUT', assignmentPath(target), engine);

export const unassignEngine = (target: EngineTarget) => request<{ ok: true }>('DELETE', assignmentPath(target));
