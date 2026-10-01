import { queryOptions } from '@tanstack/react-query';
import { get } from '../../api/client.ts';
import type { ForensicsOverview, KnownErrorDetail, KnownErrorsOverview, TaskForensics } from './types.ts';

export const taskForensicsQuery = (projectId: string, code: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'forensics', 'task', code] as const,
    queryFn: () => get<TaskForensics>(`/api/projects/${projectId}/tasks/${code}/forensics`),
  });

export const forensicsOverviewQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'observability', 'forensics'] as const,
    queryFn: () => get<ForensicsOverview>(`/api/projects/${projectId}/observability/forensics.json`),
  });

export const knownErrorsQuery = () =>
  queryOptions({
    queryKey: ['observability', 'known-errors'] as const,
    queryFn: () => get<KnownErrorsOverview>('/api/observability/known-errors.json'),
  });

export const knownErrorQuery = (code: string) =>
  queryOptions({
    queryKey: ['observability', 'known-errors', code] as const,
    queryFn: () => get<KnownErrorDetail>(`/api/observability/known-errors/${code}`),
  });
