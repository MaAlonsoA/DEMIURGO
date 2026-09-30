// Dev tools of the API (only with DEMIURGO_DEV_TOOLS=1): snapshots of the whole database, reset, and
// the trace of any entity. Saving, restoring and resetting restart the API's core; the request
// answers once it is back.

import { queryOptions } from '@tanstack/react-query';
import type { Trace, TraceType } from '../screens/dev/trace.ts';
import { get, request } from './client.ts';

export type Snapshot = {
  name: string;
  label: string;
  created_at: string;
  source: string;
  migration: string | null;
  projects: { name: string; events: number }[];
  size_bytes: number;
};

export type DevSnapshots = { database: string; snapshots: Snapshot[] };

export const devSnapshotsQuery = queryOptions({
  queryKey: ['dev', 'snapshots'] as const,
  queryFn: () => get<DevSnapshots>('/api/dev/snapshots'),
});

const snapshotPath = (name: string): string => `/api/dev/snapshots/${encodeURIComponent(name)}`;

export const saveSnapshot = (label: string) => request<{ snapshot: Snapshot }>('POST', '/api/dev/snapshots', { label });
export const restoreSnapshot = (name: string) => request<{ restored: Snapshot }>('POST', `${snapshotPath(name)}/restore`);
export const dropSnapshot = (name: string) => request<{ dropped: Snapshot }>('DELETE', snapshotPath(name));
export const resetEnvironment = () => request<{ reset: true }>('POST', '/api/dev/reset');

/** Mirror of the server's one-project snapshot. */
export type ProjectSnapshot = {
  name: string;
  label: string;
  created_at: string;
  source: string;
  migration: string | null;
  project: { id: string; name: string; events: number };
  git: { repo_dir: string; head: string } | null;
  size_bytes: number;
};

export const projectSnapshotsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['dev', 'project-snapshots', projectId] as const,
    queryFn: () => get<{ snapshots: ProjectSnapshot[] }>(`/api/dev/projects/${encodeURIComponent(projectId)}/snapshots`),
  });

const projectSnapshotPath = (name: string): string => `/api/dev/project-snapshots/${encodeURIComponent(name)}`;

export const saveProjectSnapshot = (projectId: string, label: string) =>
  request<{ snapshot: ProjectSnapshot }>('POST', `/api/dev/projects/${encodeURIComponent(projectId)}/snapshots`, { label });
export const restoreProjectSnapshot = (name: string) =>
  request<{ restored: ProjectSnapshot; git: string }>('POST', `${projectSnapshotPath(name)}/restore`);
export const dropProjectSnapshot = (name: string) =>
  request<{ dropped: ProjectSnapshot }>('DELETE', projectSnapshotPath(name));
export const deleteProject = (projectId: string) =>
  request<{ deleted: true; rows: number }>('DELETE', `/api/dev/projects/${encodeURIComponent(projectId)}`);

/** Where an entity comes from, its raw data and the agent contexts that read it. */
export const traceQuery = (project: string, type: TraceType, id: string) =>
  queryOptions({
    queryKey: ['dev', 'trace', project, type, id] as const,
    queryFn: () => get<Trace>(`/api/dev/trace?${new URLSearchParams({ project, type, id }).toString()}`),
  });
