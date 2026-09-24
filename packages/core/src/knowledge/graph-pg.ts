// Puerto KnowledgeGraph sobre tablas de Postgres (§7.6): nodos y aristas con validez por
// versión del grafo. Cambiar de motor (Memgraph, AGE) es reconstruir desde la autoridad.

import type { Edge, EpistemicStatus, Graph, Node } from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';

const TYPES_WITH_AUTHORITY = new Set(['decision', 'fdr', 'adr', 'bug', 'criterion']);

export async function readGraphVersion(db: Db, projectId: string): Promise<number> {
  const e = await db
    .selectFrom('knowledge_graph_state')
    .select('version')
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  return Number(e?.version ?? 0);
}

/** Carga el grafo completo del proyecto (vigente e histórico) para operar en memoria. */
export async function loadGraph(db: Db, projectId: string): Promise<Graph> {
  const nodes = await db.selectFrom('knowledge_nodes').selectAll().where('project_id', '=', projectId).orderBy('id').execute();
  const byId = new Map(nodes.map((n) => [n.id, n.ref]));
  const edges = await db.selectFrom('knowledge_edges').selectAll().where('project_id', '=', projectId).orderBy('id').execute();
  return {
    version: await readGraphVersion(db, projectId),
    nodes: nodes.map(
      (n): Node => ({
        ref: n.ref,
        type: n.kind,
        label: n.label,
        text: n.body,
        categories: (n.categories ?? {}) as Record<string, string>,
        epistemic: n.epistemic as EpistemicStatus,
        authority: TYPES_WITH_AUTHORITY.has(n.kind),
        origin: { type: n.source_type, id: n.source_id, version: n.source_version },
        from: Number(n.valid_from),
        until: n.valid_to === null ? null : Number(n.valid_to),
      }),
    ),
    edges: edges.map(
      (a): Edge => ({
        type: a.kind,
        from: byId.get(a.from_node) ?? '',
        to: byId.get(a.to_node) ?? '',
        validFrom: Number(a.valid_from),
        validTo: a.valid_to === null ? null : Number(a.valid_to),
      }),
    ),
  };
}

/** Búsqueda de texto (FTS «spanish») sobre el conocimiento vigente. */
export async function searchKnowledge(db: Db, projectId: string, queryName: string, limit = 10) {
  const { rows } = await sql<{ ref: string; kind: string; label: string; body: string; epistemic: string; range: number }>`
    select ref, kind, label, left(body, 600) as body, epistemic, ts_rank(search, q) as rango
    from knowledge_nodes, websearch_to_tsquery('spanish', ${queryName}) q
    where project_id = ${projectId}::uuid and valid_to is null and search @@ q
    order by rango desc, ref
    limit ${limit}`.execute(db);
  return rows.map((r) => ({
    ref: r.ref,
    type: r.kind,
    title: r.label,
    excerpt: r.body,
    epistemic_status: r.epistemic,
    range: r.range,
  }));
}

/** Vecinos de un nodo vigente hasta una distancia (CTE recursiva). */
export async function neighbors(db: Db, projectId: string, ref: string, distance = 2) {
  const { rows } = await sql<{ ref: string; kind: string; label: string; distance: number }>`
    with recursive inicio as (
      select id from knowledge_nodes where project_id = ${projectId}::uuid and ref = ${ref} and valid_to is null
    ), recorrido(id, distancia) as (
      select id, 0 from inicio
      union
      select case when e.from_node = r.id then e.to_node else e.from_node end, r.distancia + 1
      from recorrido r
      join knowledge_edges e on (e.from_node = r.id or e.to_node = r.id) and e.valid_to is null
      where r.distancia < ${distance}
    )
    select n.ref, n.kind, n.label, min(r.distancia)::int as distancia
    from recorrido r join knowledge_nodes n on n.id = r.id
    where n.ref <> ${ref}
    group by n.ref, n.kind, n.label
    order by distancia, n.ref`.execute(db);
  return rows;
}
