// Actores. El servidor los fija a partir de la credencial o del canal; el cliente nunca
// declara su actor (principio 2 del plan).

import type { TipoActor } from './tablas/esquemas.ts';

export type Actor =
  | { tipo: 'human'; persona: string }
  | { tipo: 'agent_external'; nombre: string; sesion: string }
  | { tipo: 'agent_run'; run: string }
  | { tipo: 'system'; componente: string; version: string }
  | { tipo: 'unknown' };

export type TipoActorConDesconocido = TipoActor | 'unknown';

export const humano = (persona: string): Actor => ({ tipo: 'human', persona });
export const agenteExterno = (nombre: string, sesion: string): Actor => ({ tipo: 'agent_external', nombre, sesion });
export const agenteRun = (run: string): Actor => ({ tipo: 'agent_run', run });
export const sistema = (componente: string, version = '1'): Actor => ({ tipo: 'system', componente, version });

export function formatearActor(a: Actor): string {
  switch (a.tipo) {
    case 'human':
      return `human:${a.persona}`;
    case 'agent_external':
      return `agent:${a.nombre}:${a.sesion}`;
    case 'agent_run':
      return `agent:run:${a.run}`;
    case 'system':
      return `system:${a.componente}@${a.version}`;
    case 'unknown':
      return 'unknown';
  }
}

export function parsearActor(texto: string): Actor {
  if (texto === 'unknown') return { tipo: 'unknown' };
  const h = /^human:(.+)$/.exec(texto);
  if (h?.[1]) return { tipo: 'human', persona: h[1] };
  const r = /^agent:run:(.+)$/.exec(texto);
  if (r?.[1]) return { tipo: 'agent_run', run: r[1] };
  const e = /^agent:([^:]+):(.+)$/.exec(texto);
  if (e?.[1] && e[2]) return { tipo: 'agent_external', nombre: e[1], sesion: e[2] };
  const s = /^system:([^@]+)@(.+)$/.exec(texto);
  if (s?.[1] && s[2]) return { tipo: 'system', componente: s[1], version: s[2] };
  return { tipo: 'unknown' };
}

export const NOMBRE_AGENTE_VALIDO = /^[a-z][a-z0-9-]{1,39}$/;
