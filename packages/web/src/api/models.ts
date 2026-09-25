// Models & providers (FDR-AGE-002): what each provider offers, which engine runs each agent
// (globally and for this project), statistics and consumption, and the calls of a run.

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

export type Assignment = {
  agent: string;
  scope: 'global' | 'project';
  projectId: string | null;
  engine: Engine;
  assignedBy: string;
  assignedAt: string;
};

export type Resolution =
  | ({ status: 'ok'; source: 'override' | 'project' | 'global' } & Engine)
  | { status: 'unassigned' }
  | ({ status: 'unavailable'; source: 'override' | 'project' | 'global'; reason: string } & Engine);

export type AgentInfo = {
  id: string;
  description: string;
  action: string;
  section: string;
  skills: string[];
  session: 'thread' | 'none';
  time_limit: number;
  version: string;
  global: Assignment | null;
  project: Assignment | null;
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

export type AgentsResponse = { agents: AgentInfo[]; skills: { id: string; description: string }[] };

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
  agents: (projectId?: string) => ['models', 'agents', projectId ?? 'everywhere'] as const,
  calls: (projectId: string, runId: string) => ['p', projectId, 'run', runId, 'calls'] as const,
};

export const providersQuery = queryOptions({
  queryKey: modelKeys.providers,
  queryFn: () => get<ProvidersResponse>('/api/providers'),
});

/** The agents with their engines: of a project, or only everywhere's outside any project. */
export const agentsQuery = (projectId?: string) =>
  queryOptions({
    queryKey: modelKeys.agents(projectId),
    queryFn: () => get<AgentsResponse>(projectId ? `/api/agents?project=${encodeURIComponent(projectId)}` : '/api/agents'),
  });

export const runCallsQuery = (projectId: string, runId: string) =>
  queryOptions({
    queryKey: modelKeys.calls(projectId, runId),
    queryFn: async () => (await get<{ calls: RunCall[] }>(`/api/projects/${projectId}/runs/${runId}/calls`)).calls,
  });

export const refreshProviders = () => request<{ catalogs: Catalog[] }>('POST', '/api/providers/refresh');

export const assignEngine = (agent: string, scope: 'global' | 'project', engine: Engine, projectId?: string) =>
  request<{ ok: true }>('PUT', `/api/agents/${encodeURIComponent(agent)}/assignment`, {
    scope,
    ...(scope === 'project' && projectId ? { project_id: projectId } : {}),
    ...engine,
  });

export const unassignEngine = (agent: string, scope: 'global' | 'project', projectId?: string) =>
  request<{ ok: true }>(
    'DELETE',
    `/api/agents/${encodeURIComponent(agent)}/assignment?scope=${scope}${scope === 'project' && projectId ? `&project=${projectId}` : ''}`,
  );
