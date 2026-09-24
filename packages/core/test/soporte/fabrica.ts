// Fábrica genérica para las pruebas generadas desde las tablas: crea una entidad y la lleva a
// cualquier estado siguiendo transiciones legales de design/datos/transiciones.yaml.

import { readFileSync } from 'node:fs';
import {
  type Actor,
  type NombreComando,
  type NombreEntidad,
  type TipoActor,
  agenteExterno,
  agenteRun,
  definicionComando,
  definicionEntidad,
  humano,
  sistema,
} from '@demiurgo/domain';
import { ejecutarComando } from '../../src/bus/bus.ts';
import type { Servicios } from '../../src/servicios.ts';

export const ACTOR_DE_TIPO: Record<TipoActor, Actor> = {
  human: humano('ana'),
  agent_external: agenteExterno('bot-prueba', 'sesion-1'),
  agent_run: agenteRun('00000000-0000-7000-8000-00000000abcd'),
  system: sistema('prueba'),
};

export function actorPermitido(comando: NombreComando): Actor {
  const tipo = definicionComando(comando).permitido[0] as TipoActor;
  return ACTOR_DE_TIPO[tipo];
}

/** Último incremento implementado según package.json. */
export function incrementoActual(): string {
  const raiz = JSON.parse(readFileSync('package.json', 'utf8')) as { demiurgo: { incrementosImplementados: string[] } };
  const s = raiz.demiurgo.incrementosImplementados.filter((i) => i.startsWith('S'));
  return s[s.length - 1] ?? 'S0';
}

export type Contexto = { s: Servicios; proyectoId: string; entidadId: string };

export type Receta = {
  /** Crea la entidad en su estado inicial y devuelve su id. */
  crear(s: Servicios, proyectoId: string): Promise<string>;
  /** Datos válidos para cada comando no creador. Por defecto `{}`. */
  datos?: Partial<Record<NombreComando, (c: Contexto) => unknown>>;
};

let contador = 0;
export const unico = (prefijo: string): string => `${prefijo}-${Date.now()}-${++contador}`;

export const RECETAS: Partial<Record<NombreEntidad, Receta>> = {
  project: {
    async crear(s) {
      const r = await ejecutarComando(s, { comando: 'project.create', actor: humano('ana'), datos: { nombre: unico('P') } });
      return r.entidadId;
    },
  },
  context_pack: {
    async crear(s, proyectoId) {
      const r = await ejecutarComando(s, {
        comando: 'context_pack.build',
        actor: sistema('prueba'),
        proyectoId,
        datos: { rol: 'eco', constructor: 'eco@1', presupuesto: {}, version_grafo: 0, dependencias: [], contenido: unico('c') },
      });
      return r.entidadId;
    },
  },
  ai_run: {
    async crear(s, proyectoId) {
      const r = await ejecutarComando(s, {
        comando: 'run.request',
        actor: humano('ana'),
        proyectoId,
        datos: { accion: 'eco', alcance: { tipo: 'proyecto' }, entrada: { texto: unico('t') } },
      });
      return r.entidadId;
    },
    datos: {
      'run.complete': () => ({ salida: { reply: 'x' }, uso: null, modelo: null }),
      'run.fail': () => ({ failure_kind: 'agent_error', error: 'x' }),
      'run.interrupt': () => ({ motivo: 'x' }),
    },
  },
};

export function registrarReceta(entidad: NombreEntidad, receta: Receta): void {
  RECETAS[entidad] = receta;
}

/** Camino de comandos (sin creación) desde el estado inicial hasta `destino`, por BFS. */
export function camino(entidad: NombreEntidad, inicial: string, destino: string): NombreComando[] | null {
  const def = definicionEntidad(entidad);
  const cola: [string, NombreComando[]][] = [[inicial, []]];
  const vistos = new Set([inicial]);
  while (cola.length > 0) {
    const [estado, ruta] = cola.shift() as [string, NombreComando[]];
    if (estado === destino) return ruta;
    for (const t of def.transiciones) {
      if (t.desde === 'nuevo' || !t.desde.includes(estado) || vistos.has(t.hacia)) continue;
      vistos.add(t.hacia);
      cola.push([t.hacia, [...ruta, t.comando as NombreComando]]);
    }
  }
  return null;
}

export async function llevarA(s: Servicios, proyectoId: string, entidad: NombreEntidad, destino: string): Promise<string> {
  const receta = RECETAS[entidad];
  if (!receta) throw new Error(`No hay receta para «${entidad}».`);
  const id = entidad === 'project' ? await receta.crear(s, proyectoId) : await receta.crear(s, proyectoId);
  const pid = entidad === 'project' ? id : proyectoId;
  const fila = await estadoActual(s, entidad, id);
  const ruta = camino(entidad, fila, destino);
  if (!ruta) throw new Error(`«${entidad}» no llega a «${destino}» desde «${fila}».`);
  for (const comando of ruta) {
    const datos: unknown = await Promise.resolve(receta.datos?.[comando]?.({ s, proyectoId: pid, entidadId: id }) ?? {});
    await ejecutarComando(s, { comando, actor: actorPermitido(comando), proyectoId: pid, entidadId: id, datos });
  }
  return id;
}

const TABLA: Partial<Record<NombreEntidad, string>> = {};
export async function estadoActual(s: Servicios, entidad: NombreEntidad, id: string): Promise<string> {
  const { TABLAS } = await import('../../src/bus/bus.ts');
  const tabla = TABLA[entidad] ?? TABLAS[entidad];
  if (!tabla) throw new Error(`Sin tabla para ${entidad}`);
  const { sql } = await import('kysely');
  const { rows } = await sql<{ state: string }>`select state from ${sql.table(tabla)} where id = ${id}::uuid`.execute(s.db);
  return rows[0]?.state ?? '';
}
