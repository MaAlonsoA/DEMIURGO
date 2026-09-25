// Real time (spec §8): one EventSource per open project on …/events/stream. Each event
// invalidates the queries of its entity and the aggregated ones; the page is never reloaded.
// The browser sends Last-Event-ID back when it reconnects.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createElement, useEffect, useState, useSyncExternalStore } from 'react';
import { PRODUCT_WORDS } from '../words.ts';
import { type RunProgress, recordProgress } from './progress.ts';
import { tablesQuery } from './queries.ts';
import type { EventRow } from './types.ts';

/** Queries (third part of the key) each entity of an event invalidates. */
export const INVALIDATES: Record<string, string[]> = {
  proposal: ['inbox', 'batch', 'state', 'record', 'readiness'],
  batch: ['inbox', 'batch', 'state', 'runs'],
  record: ['record', 'state'],
  record_version: ['record', 'readiness', 'state', 'inbox'],
  criterion: ['record'],
  link: ['record', 'readiness', 'inbox', 'state'],
  question: ['exploration', 'inbox', 'state', 'readiness', 'explorations', 'stages'],
  stage: ['stages', 'explorations', 'state'],
  message: ['exploration', 'explorations'],
  exploration: ['exploration', 'explorations', 'state', 'events'],
  ai_run: ['run', 'runs', 'exploration', 'events'],
  context_pack: ['run'],
  knowledge_update: ['knowledge', 'inbox'],
  knowledge_node: ['knowledge'],
  knowledge_edge: ['knowledge'],
  classification: ['knowledge', 'inbox'],
  taxonomy: ['knowledge', 'inbox'],
  idea_assessment: ['knowledge', 'inbox', 'batch'],
  source: ['sources'],
  agent_token: ['tokens'],
};

export type Connection = 'connecting' | 'open' | 'down';

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
const connectionListeners = new Set<() => void>();
function setConnection(c: Connection): void {
  if (c === connection) return;
  connection = c;
  for (const l of connectionListeners) l();
}

export function useConnection(): Connection {
  return useSyncExternalStore(
    (l) => {
      connectionListeners.add(l);
      return () => connectionListeners.delete(l);
    },
    () => connection,
  );
}

export function useProjectStream(projectId: string): void {
  const client = useQueryClient();
  const tables = useQuery(tablesQuery).data;

  useEffect(() => {
    if (!projectId || !tables || typeof EventSource === 'undefined') return;
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const names = new Set(pending);
      pending.clear();
      void client.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'p' && q.queryKey[1] === projectId && names.has(String(q.queryKey[2])),
      });
    };
    const source = new EventSource(`/api/projects/${projectId}/events/stream?from=latest`);
    let wasDown = false;
    source.addEventListener('open', () => {
      setConnection('open');
      // After a cut, whatever happened meanwhile is fetched again.
      if (wasDown) void client.invalidateQueries({ queryKey: ['p', projectId] });
      wasDown = false;
    });
    source.addEventListener('error', () => {
      wasDown = true;
      setConnection('down');
    });
    source.addEventListener('ready', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { latest: string };
      setLatest(projectId, data.latest);
    });
    const onEvent = (e: Event) => {
      const row = JSON.parse((e as MessageEvent<string>).data) as EventRow;
      setLatest(projectId, row.id);
      for (const name of INVALIDATES[row.entity_type] ?? []) pending.add(name);
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
  }, [projectId, tables, client]);
}

/** Amber band while the stream reconnects (spec §7.1). */
export function ConnectionBanner() {
  const c = useConnection();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (c !== 'down') {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [c]);
  if (!visible) return null;
  return createElement(
    'div',
    {
      role: 'status',
      className:
        'dm-text-small sticky top-14 z-20 border-b border-working bg-working-soft px-6 py-1.5 text-center font-medium text-working-text',
    },
    PRODUCT_WORDS.cantReach,
  );
}
