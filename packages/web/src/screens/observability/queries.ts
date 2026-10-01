import { queryOptions } from '@tanstack/react-query';
import { get } from '../../api/client.ts';
import type { JudgmentCalibration, Observability } from './types.ts';

export const observabilityUrl = (projectId: string) => `/api/projects/${projectId}/observability`;
export const observabilityCsvUrl = (projectId: string) => `/api/projects/${projectId}/observability.csv`;

export const observabilityQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'observability'] as const,
    queryFn: () => get<Observability>(observabilityUrl(projectId)),
  });

export const judgmentCalibrationQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'observability', 'calibration'] as const,
    queryFn: () => get<JudgmentCalibration>(`/api/projects/${projectId}/observability/calibration`),
  });
