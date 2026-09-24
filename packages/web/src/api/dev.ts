// Dev tools of the API (only with DEMIURGO_DEV_TOOLS=1): snapshots of the whole database and reset.
// Saving, restoring and resetting restart the API's core; the request answers once it is back.

import { queryOptions } from '@tanstack/react-query';
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
