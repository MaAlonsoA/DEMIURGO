// Real time (spec §8, DESIGN.md §4.5): one EventSource per open project on …/events/stream. Each
// event invalidates the queries of its entity and the aggregated ones; the page is never reloaded.
// The browser sends Last-Event-ID back when it reconnects. The connection has four states: while
// it is down the shell says so and offers "Retry now"; when the browser gives up for good (the
// stream was refused, e.g. a 401), it says so instead of "retrying" forever (DESIGN.md §4.6).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { type RunProgress, recordProgress } from './progress.ts';
import { tablesQuery } from './queries.ts';
import type { EventRow } from './types.ts';

/**
 * Queries (third part of the key) each entity of an event invalidates. `map`, `journeys` and the
 * lens' `changes` follow what they are built from (they were never live before the rebuild).
 */
export const INVALIDATES: Record<string, string[]> = {
  proposal: ['inbox', 'batch', 'state', 'record', 'readiness', 'changes'],
  batch: ['inbox', 'batch', 'state', 'runs', 'changes'],
  record: ['record', 'state', 'map', 'journeys', 'changes'],
  record_version: ['record', 'readiness', 'state', 'inbox', 'map', 'journeys', 'changes'],
  criterion: ['record', 'journeys', 'changes'],
  link: ['record', 'readiness', 'inbox', 'state', 'map', 'changes'],
  question: ['exploration', 'inbox', 'state', 'readiness', 'explorations', 'stages', 'map', 'journeys', 'changes'],
  stage: ['stages', 'explorations', 'state', 'changes'],
  message: ['exploration', 'explorations', 'changes'],
  exploration: ['exploration', 'explorations', 'state', 'events', 'map', 'changes'],
  ai_run: ['run', 'runs', 'exploration', 'events', 'changes'],
  context_pack: ['run'],
  knowledge_update: ['knowledge', 'inbox', 'changes'],
  knowledge_node: ['knowledge'],
  knowledge_edge: ['knowledge'],
  classification: ['knowledge', 'inbox', 'changes'],
  taxonomy: ['knowledge', 'inbox', 'changes'],
  idea_assessment: ['knowledge', 'inbox', 'batch', 'changes'],
  source: ['sources', 'changes'],
  agent_token: ['tokens', 'changes'],
  project: ['changes'],
};

/** Entities whose events also refresh queries outside the project (the projects list). */
const GLOBAL_INVALIDATES: Record<string, string[][]> = {
  project: [['projects']],
};

export type Connection = 'connecting' | 'open' | 'down' | 'closed';

type Listener = (event: EventRow) => void;
const listeners = new Set<Listener>();
/** Other modules (the "What changed" lens, a thread) can follow the events of the project. */
export function onProjectEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let latest: { projectId: string; id: string } | null = null;
const latestListeners = new Set<() => void>();
/** The newest event id seen in this tab for the open project. */
export function latestEventId(projectId: string): string | null {
  return latest?.projectId === projectId ? latest.id : null;
}
export function onLatestEvent(listener: () => void): () => void {
  latestListeners.add(listener);
  return () => latestListeners.delete(listener);
}
function setLatest(projectId: string, id: string): void {
  if (latest?.projectId === projectId && BigInt(latest.id) >= BigInt(id)) return;
  latest = { projectId, id };
  for (const l of latestListeners) l();
}

let connection: Connection = 'connecting';
/** When the connection went down (ms), for "reconnecting since …". */
let downSince: number | null = null;
const connectionListeners = new Set<() => void>();
function setConnection(c: Connection): void {
  if (c === connection) return;
  connection = c;
  downSince = c === 'down' || c === 'closed' ? (downSince ?? Date.now()) : null;
  for (const l of connectionListeners) l();
}
function subscribeConnection(l: () => void) {
  connectionListeners.add(l);
  return () => {
    connectionListeners.delete(l);
  };
}

export function useConnection(): Connection {
  return useSyncExternalStore(subscribeConnection, () => connection);
}

export function connectionDownSince(): number | null {
  return downSince;
}

// "Retry now": a new EventSource replaces the one that is down or closed.
let attempt = 0;
const attemptListeners = new Set<() => void>();
export function reconnect(): void {
  attempt += 1;
  setConnection('connecting');
  for (const l of attemptListeners) l();
}
function useAttempt(): number {
  return useSyncExternalStore(
    (l) => {
      attemptListeners.add(l);
      return () => {
        attemptListeners.delete(l);
      };
    },
    () => attempt,
  );
}

export function useProjectStream(projectId: string): void {
  const client = useQueryClient();
  const tables = useQuery(tablesQuery).data;
  const tries = useAttempt();

  useEffect(() => {
    if (!projectId || !tables || typeof EventSource === 'undefined') return;
    const pending = new Set<string>();
    const globals = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const names = new Set(pending);
      pending.clear();
      void client.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'p' && q.queryKey[1] === projectId && names.has(String(q.queryKey[2])),
      });
      for (const key of globals) void client.invalidateQueries({ queryKey: JSON.parse(key) as string[] });
      globals.clear();
    };
    const source = new EventSource(`/api/projects/${projectId}/events/stream?from=latest`);
    let wasDown = tries > 0;
    source.addEventListener('open', () => {
      setConnection('open');
      // After a cut, whatever happened meanwhile is fetched again.
      if (wasDown) void client.invalidateQueries({ queryKey: ['p', projectId] });
      wasDown = false;
    });
    source.addEventListener('error', () => {
      wasDown = true;
      // CLOSED: the browser will not retry (the stream was refused). CONNECTING: it retries itself.
      setConnection(source.readyState === EventSource.CLOSED ? 'closed' : 'down');
    });
    source.addEventListener('ready', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { latest: string };
      setLatest(projectId, data.latest);
    });
    const onEvent = (e: Event) => {
      const row = JSON.parse((e as MessageEvent<string>).data) as EventRow;
      setLatest(projectId, row.id);
      for (const name of INVALIDATES[row.entity_type] ?? []) pending.add(name);
      for (const key of GLOBAL_INVALIDATES[row.entity_type] ?? []) globals.add(JSON.stringify(key));
      if (!timer) timer = setTimeout(flush, 60);
      for (const l of listeners) l(row);
    };
    const onProgress = (e: Event) => {
      recordProgress(JSON.parse((e as MessageEvent<string>).data) as RunProgress);
    };
    source.addEventListener('run.progress', onProgress);
    const commands = Object.keys(tables.capabilities.commands);
    for (const c of commands) source.addEventListener(c, onEvent);
    return () => {
      if (timer) clearTimeout(timer);
      source.removeEventListener('run.progress', onProgress);
      for (const c of commands) source.removeEventListener(c, onEvent);
      source.close();
      setConnection('connecting');
    };
  }, [projectId, tables, client, tries]);
}
