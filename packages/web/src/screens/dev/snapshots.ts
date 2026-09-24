// Logic of the dev snapshots panel: whether to show it and how to sum up a snapshot.

import type { Snapshot } from '../../api/dev.ts';

/** GET /api/session announces the dev tools only when the API runs with DEMIURGO_DEV_TOOLS=1. */
export function hasDevTools(session: unknown): boolean {
  return typeof session === 'object' && session !== null && (session as { dev_tools?: unknown }).dev_tools === true;
}

const events = (n: number): string => `${n} ${n === 1 ? 'event' : 'events'}`;

export function summaryOf(s: Snapshot): string {
  const [only] = s.projects;
  if (!only) return 'No projects';
  if (s.projects.length === 1) return `${only.name} · ${events(only.events)}`;
  return `${s.projects.length} projects · ${events(s.projects.reduce((n, p) => n + p.events, 0))}`;
}

export const sizeOf = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;
