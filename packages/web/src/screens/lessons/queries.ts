import { queryOptions } from '@tanstack/react-query';
import { get } from '../../api/client.ts';
import type { ForensicsOverview, TaskForensics } from './types.ts';

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
