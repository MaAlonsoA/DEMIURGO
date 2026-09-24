// Puerto KnowledgeGraph sobre tablas de Postgres (§7.6): nodos y aristas con validez por
// versión del grafo. Cambiar de motor (Memgraph, AGE) es reconstruir desde la autoridad.

import type { Arista, EstadoEpistemico, Grafo, Nodo } from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Bd } from '../db/conexion.ts';

const TIPOS_CON_AUTORIDAD = new Set(['decision', 'fdr', 'adr', 'bug', 'criterio']);

export async function versionDelGrafo(db: Bd, proyectoId: string): Promise<number> {
  const e = await db
    .selectFrom('knowledge_graph_state')
    .select('version')
    .where('project_id', '=', proyectoId)
    .executeTakeFirst();
  return Number(e?.version ?? 0);
}

/** Carga el grafo completo del proyecto (vigente e histórico) para operar en memoria. */
export async function cargarGrafo(db: Bd, proyectoId: string): Promise<Grafo> {
  const nodos = await db.selectFrom('knowledge_nodes').selectAll().where('project_id', '=', proyectoId).orderBy('id').execute();
  const porId = new Map(nodos.map((n) => [n.id, n.ref]));
  const aristas = await db.selectFrom('knowledge_edges').selectAll().where('project_id', '=', proyectoId).orderBy('id').execute();
  return {
    version: await versionDelGrafo(db, proyectoId),
    nodos: nodos.map(
      (n): Nodo => ({
        ref: n.ref,
        tipo: n.kind,
        etiqueta: n.label,
        texto: n.body,
        categorias: (n.categories ?? {}) as Record<string, string>,
        epistemico: n.epistemic as EstadoEpistemico,
        autoridad: TIPOS_CON_AUTORIDAD.has(n.kind),
        origen: { tipo: n.source_type, id: n.source_id, version: n.source_version },
        desde: Number(n.valid_from),
        hasta: n.valid_to === null ? null : Number(n.valid_to),
      }),
    ),
    aristas: aristas.map(
      (a): Arista => ({
        tipo: a.kind,
        desde: porId.get(a.from_node) ?? '',
        hacia: porId.get(a.to_node) ?? '',
        alta: Number(a.valid_from),
        baja: a.valid_to === null ? null : Number(a.valid_to),
      }),
    ),
  };
}

/** Búsqueda de texto (FTS «spanish») sobre el conocimiento vigente. */
export async function buscarConocimiento(db: Bd, proyectoId: string, consulta: string, limite = 10) {
  const { rows } = await sql<{ ref: string; kind: string; label: string; body: string; epistemic: string; rango: number }>`
    select ref, kind, label, left(body, 600) as body, epistemic, ts_rank(search, q) as rango
    from knowledge_nodes, websearch_to_tsquery('spanish', ${consulta}) q
    where project_id = ${proyectoId}::uuid and valid_to is null and search @@ q
    order by rango desc, ref
    limit ${limite}`.execute(db);
  return rows.map((r) => ({
    ref: r.ref,
    tipo: r.kind,
    titulo: r.label,
    extracto: r.body,
    estado_epistemico: r.epistemic,
    rango: r.rango,
  }));
}

/** Vecinos de un nodo vigente hasta una distancia (CTE recursiva). */
export async function vecinos(db: Bd, proyectoId: string, ref: string, distancia = 2) {
  const { rows } = await sql<{ ref: string; kind: string; label: string; distancia: number }>`
    with recursive inicio as (
      select id from knowledge_nodes where project_id = ${proyectoId}::uuid and ref = ${ref} and valid_to is null
    ), recorrido(id, distancia) as (
      select id, 0 from inicio
      union
      select case when e.from_node = r.id then e.to_node else e.from_node end, r.distancia + 1
      from recorrido r
      join knowledge_edges e on (e.from_node = r.id or e.to_node = r.id) and e.valid_to is null
      where r.distancia < ${distancia}
    )
    select n.ref, n.kind, n.label, min(r.distancia)::int as distancia
    from recorrido r join knowledge_nodes n on n.id = r.id
    where n.ref <> ${ref}
    group by n.ref, n.kind, n.label
    order by distancia, n.ref`.execute(db);
  return rows;
}
