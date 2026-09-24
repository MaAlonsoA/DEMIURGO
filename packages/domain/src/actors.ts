// Actores. El servidor los fija a partir de la credencial o del canal; el cliente nunca
// declara su actor (principio 2 del plan).

import type { ActorType } from './tables/schemas.ts';

export type Actor =
  | { type: 'human'; person: string }
  | { type: 'agent_external'; name: string; session: string }
  | { type: 'agent_run'; run: string }
  | { type: 'system'; component: string; version: string }
  | { type: 'unknown' };

export type ActorTypeWithUnknown = ActorType | 'unknown';

export const human = (person: string): Actor => ({ type: 'human', person });
export const externalAgent = (name: string, session: string): Actor => ({ type: 'agent_external', name, session });
export const agentRun = (run: string): Actor => ({ type: 'agent_run', run });
export const system = (component: string, version = '1'): Actor => ({ type: 'system', component, version });

export function formatActor(a: Actor): string {
  switch (a.type) {
    case 'human':
      return `human:${a.person}`;
    case 'agent_external':
      return `agent:${a.name}:${a.session}`;
    case 'agent_run':
      return `agent:run:${a.run}`;
    case 'system':
      return `system:${a.component}@${a.version}`;
    case 'unknown':
      return 'unknown';
  }
}

export function parseActor(text: string): Actor {
  if (text === 'unknown') return { type: 'unknown' };
  const h = /^human:(.+)$/.exec(text);
  if (h?.[1]) return { type: 'human', person: h[1] };
  const r = /^agent:run:(.+)$/.exec(text);
  if (r?.[1]) return { type: 'agent_run', run: r[1] };
  const e = /^agent:([^:]+):(.+)$/.exec(text);
  if (e?.[1] && e[2]) return { type: 'agent_external', name: e[1], session: e[2] };
  const s = /^system:([^@]+)@(.+)$/.exec(text);
  if (s?.[1] && s[2]) return { type: 'system', component: s[1], version: s[2] };
  return { type: 'unknown' };
}

export const VALID_AGENT_NAME = /^[a-z][a-z0-9-]{1,39}$/;
