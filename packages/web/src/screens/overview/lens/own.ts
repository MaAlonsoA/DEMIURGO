// What the lens leaves out and where its lines lead (DESIGN.md §3.5, INV-LENS-*). The `changes`
// query is live now, so without this the person would be told their own actions of this very
// session as "while you were away" ("You approved…"). An event is the person's own current action
// when its actor is the person signed in and it came after this app started: after the first event
// id this tab saw for the project (the stream's `ready`), or — before that is known — after the
// app's start time. Everything the person did before (another browser, before a reload) stays.

import { latestEventId, onLatestEvent } from '../../../api/stream.ts';
import type { ChangedThing, Changes } from '../../../api/types.ts';
import type { LensLine } from './lines.ts';
import { projectOfPath } from './visit.ts';

/** When this app started (ms): the module loads with the bundle. */
export const APP_STARTED = Date.now();

/** The first event id this tab saw for each project, once its stream said where the log was. */
const firstSeen = new Map<string, string>();
const listeners = new Set<() => void>();

function noteFirst(): void {
  if (typeof location === 'undefined') return;
  const projectId = projectOfPath(location.pathname);
  if (!projectId || firstSeen.has(projectId)) return;
  const id = latestEventId(projectId);
  if (!id) return;
  firstSeen.set(projectId, id);
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') onLatestEvent(noteFirst);

/** The first event id this tab saw for the project, or null before its stream is ready. */
export function sessionStartEvent(projectId: string): string | null {
  return firstSeen.get(projectId) ?? null;
}

export function onSessionStart(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type SessionMark = { event: string | null; at: number };

type Event = ChangedThing['events'][number];

/** Is this event the person's own, done in this session of the app? */
export function isOwnCurrent(e: Pick<Event, 'id' | 'actor' | 'at'>, actor: string | null, since: SessionMark): boolean {
  if (!actor || e.actor !== actor) return false;
  if (since.event !== null && /^\d+$/.test(e.id) && /^\d+$/.test(since.event)) return BigInt(e.id) > BigInt(since.event);
  return Date.parse(e.at) >= since.at;
}

/** The changes without the person's own current actions; a thing left without events goes too. */
export function withoutOwn(changes: Changes, actor: string | null, since: SessionMark): Changes {
  if (!actor) return changes;
  return {
    ...changes,
    things: changes.things
      .map((t) => ({ ...t, events: t.events.filter((e) => !isOwnCurrent(e, actor, since)) }))
      .filter((t) => t.events.length > 0),
  };
}

export type LineTarget =
  | { to: '/p/$projectId/records/$code'; params: { code: string } }
  | { to: '/p/$projectId/threads/$explorationId'; params: { explorationId: string } }
  | { to: '/p/$projectId/batches/$batchId'; params: { batchId: string } }
  | { to: '/p/$projectId/knowledge' | '/p/$projectId/sources' | '/p/$projectId/agent-keys'; params: Record<string, never> };

/** Where a line of the lens leads: to the thing that changed (the lines are links, INVENTORY §2 #17). */
export function lineTarget(line: Pick<LensLine, 'kind' | 'key'>, thing?: Pick<ChangedThing, 'events'>): LineTarget | null {
  switch (line.kind) {
    case 'record':
      return { to: '/p/$projectId/records/$code', params: { code: line.key } };
    case 'exploration':
      return { to: '/p/$projectId/threads/$explorationId', params: { explorationId: line.key } };
    case 'batch':
      return { to: '/p/$projectId/batches/$batchId', params: { batchId: line.key } };
    case 'knowledge':
      return { to: '/p/$projectId/knowledge', params: {} };
    default: {
      const commands = new Set((thing?.events ?? []).map((e) => e.command));
      if (commands.has('source.register')) return { to: '/p/$projectId/sources', params: {} };
      if (commands.has('agent_token.issue') || commands.has('agent_token.revoke'))
        return { to: '/p/$projectId/agent-keys', params: {} };
      return null;
    }
  }
}
