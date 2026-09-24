// Rutas de consulta (lectura). Cada una declara su consulta de la matriz de capacidades.

import { ErrorDominio, type NombreConsulta } from '@demiurgo/domain';
import {
  type Servicios,
  bandeja,
  detalleExploracion,
  detalleLote,
  detalleRegistro,
  estadoProducto,
  readinessDeVersion,
} from '@demiurgo/core';
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

registrarConsultas([
  {
    ruta: '/api/proyectos/:proyectoId/estado',
    consulta: 'query.state',
    responder: ({ servicios, params }) => estadoProducto(servicios.db, uuid(params.proyectoId, 'el proyecto')),
  },
  {
    ruta: '/api/proyectos/:proyectoId/bandeja',
    consulta: 'query.inbox',
    responder: ({ servicios, params }) => bandeja(servicios.db, uuid(params.proyectoId, 'el proyecto')),
  },
  {
    ruta: '/api/proyectos/:proyectoId/exploraciones',
    consulta: 'query.explorations',
    responder: ({ servicios, params }) =>
      servicios.db
        .selectFrom('explorations')
        .selectAll()
        .where('project_id', '=', uuid(params.proyectoId, 'el proyecto'))
        .orderBy('created_at')
        .execute(),
  },
  {
    ruta: '/api/proyectos/:proyectoId/exploraciones/:exploracionId',
    consulta: 'query.explorations',
    responder: ({ servicios, params }) =>
      detalleExploracion(servicios.db, uuid(params.proyectoId, 'el proyecto'), uuid(params.exploracionId, 'la exploración')),
  },
  {
    ruta: '/api/proyectos/:proyectoId/fuentes',
    consulta: 'query.explorations',
    responder: ({ servicios, params }) =>
      servicios.db
        .selectFrom('sources')
        .select(['id', 'name', 'content_hash', 'registered_by', 'created_at'])
        .where('project_id', '=', uuid(params.proyectoId, 'el proyecto'))
        .orderBy('created_at')
        .execute(),
  },
  {
    ruta: '/api/proyectos/:proyectoId/registros/:codigo',
    consulta: 'query.records',
    responder: ({ servicios, params }) =>
      detalleRegistro(servicios.db, uuid(params.proyectoId, 'el proyecto'), params.codigo ?? ''),
  },
  {
    ruta: '/api/proyectos/:proyectoId/versiones/:versionId/readiness',
    consulta: 'query.records',
    responder: ({ servicios, params }) =>
      readinessDeVersion(servicios.db, uuid(params.proyectoId, 'el proyecto'), uuid(params.versionId, 'la versión')),
  },
  {
    ruta: '/api/proyectos/:proyectoId/lotes/:loteId',
    consulta: 'query.batches',
    responder: ({ servicios, params }) =>
      detalleLote(servicios.db, uuid(params.proyectoId, 'el proyecto'), uuid(params.loteId, 'el lote')),
  },
  {
    ruta: '/api/proyectos/:proyectoId/tokens',
    consulta: 'query.tokens',
    responder: ({ servicios, params }) =>
      servicios.db
        .selectFrom('agent_tokens')
        .select(['id', 'name', 'state', 'issued_by', 'created_at', 'revoked_at'])
        .where('project_id', '=', uuid(params.proyectoId, 'el proyecto'))
        .orderBy('created_at')
        .execute(),
  },
]);
