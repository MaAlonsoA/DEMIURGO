// Rutas de consulta (lectura). Cada una declara su consulta de la matriz de capacidades.

import { ErrorDominio, type NombreConsulta } from '@demiurgo/domain';
import type { Servicios } from '@demiurgo/core';
import type { Credencial } from './credenciales.ts';

export type EntradaConsulta = {
  servicios: Servicios;
  params: Record<string, string>;
  query: Record<string, string>;
  credencial: Credencial;
};

export type RutaConsulta = {
  ruta: string;
  consulta: NombreConsulta;
  responder(e: EntradaConsulta): Promise<unknown>;
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: string | undefined, que: string): string {
  if (!v || !RE_UUID.test(v)) throw new ErrorDominio('no_encontrado', `No existe ${que}.`);
  return v;
}

export const CONSULTAS: RutaConsulta[] = [
  {
    ruta: '/api/proyectos',
    consulta: 'query.projects',
    async responder({ servicios }) {
      return servicios.db.selectFrom('projects').select(['id', 'name', 'state', 'created_at']).orderBy('created_at').execute();
    },
  },
  {
    ruta: '/api/proyectos/:proyectoId/eventos',
    consulta: 'query.events',
    async responder({ servicios, params, query }) {
      const proyectoId = uuid(params.proyectoId, 'el proyecto');
      const desde = /^\d+$/.test(query.desde ?? '') ? String(query.desde) : '0';
      return servicios.db
        .selectFrom('events')
        .selectAll()
        .where('project_id', '=', proyectoId)
        .where('id', '>', desde)
        .orderBy('id')
        .limit(1000)
        .execute();
    },
  },
  {
    ruta: '/api/proyectos/:proyectoId/runs/:runId',
    consulta: 'query.runs',
    async responder({ servicios, params }) {
      const proyectoId = uuid(params.proyectoId, 'el proyecto');
      const run = await servicios.db
        .selectFrom('ai_runs')
        .selectAll()
        .where('project_id', '=', proyectoId)
        .where('id', '=', uuid(params.runId, 'la ejecución'))
        .executeTakeFirst();
      if (!run) throw new ErrorDominio('no_encontrado', 'No existe la ejecución.');
      const pack = run.context_pack_id
        ? await servicios.db
            .selectFrom('context_packs')
            .select(['id', 'role', 'builder', 'budget', 'graph_version', 'dependencies', 'content', 'hash'])
            .where('id', '=', run.context_pack_id)
            .executeTakeFirst()
        : null;
      return { ...run, context_pack: pack ?? null };
    },
  },
];

export function registrarConsultas(nuevas: RutaConsulta[]): void {
  CONSULTAS.push(...nuevas);
}
