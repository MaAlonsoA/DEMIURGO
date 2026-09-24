// Small shared hooks: the current project, and the tables and commands of the API.

import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { commandsQuery, sessionQuery, tablesQuery } from '../api/queries.ts';

/** Route params of the project area, read loosely (every screen lives under /p/$projectId). */
export function useRouteParams(): {
  projectId: string;
  code?: string;
  explorationId?: string;
  batchId?: string;
  runId?: string;
} {
  const p = useParams({ strict: false }) as Record<string, string | undefined>;
  return {
    projectId: p.projectId ?? '',
    ...(p.code ? { code: p.code } : {}),
    ...(p.explorationId ? { explorationId: p.explorationId } : {}),
    ...(p.batchId ? { batchId: p.batchId } : {}),
    ...(p.runId ? { runId: p.runId } : {}),
  };
}

export function useProjectId(): string {
  return useRouteParams().projectId;
}

export function useTables() {
  return useQuery(tablesQuery).data;
}

export function useCatalog() {
  return useQuery(commandsQuery).data;
}

export function usePerson(): string | null {
  const s = useQuery(sessionQuery).data;
  return s?.actor.type === 'human' ? s.actor.person : null;
}
