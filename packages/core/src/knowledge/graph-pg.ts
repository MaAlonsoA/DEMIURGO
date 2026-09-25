// KnowledgeGraph port over Postgres tables (§7.6): nodes and edges with validity by
// graph version. Switching engines (Memgraph, AGE) means rebuilding from authority.

import type { Edge, EpistemicStatus, Graph, Node } from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';

const TYPES_WITH_AUTHORITY = new Set(['decision', 'fdr', 'adr', 'bug', 'criterion']);

export async function readGraphVersion(db: Db, projectId: string): Promise<number> {
  const e = await db.selectFrom('knowledge_graph_state').select('version').where('project_id', '=', projectId).executeTakeFirst();
  return Number(e?.version ?? 0);
}

/** Loads the project's full graph (current and historical) to operate on in memory. */
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

/**
 * Text search over the current knowledge and the project's threads and parked ideas (by their
 * purpose): the words as written and stemmed in English and in Spanish, most relevant first.
 */
export async function searchKnowledge(db: Db, projectId: string, queryText: string, limit = 10) {
  const { rows } = await sql<{ ref: string; kind: string; label: string; body: string; epistemic: string; rank: number }>`
    with q as (
      select websearch_to_tsquery('simple', ${queryText})
        || websearch_to_tsquery('english', ${queryText})
        || websearch_to_tsquery('spanish', ${queryText}) as q
    ), threads as (
      select id, state, purpose,
        to_tsvector('simple', purpose) || to_tsvector('english', purpose) || to_tsvector('spanish', purpose) as search
      from explorations
      where project_id = ${projectId}::uuid and state <> 'concluded'
    )
    select ref, kind, label, left(body, 600) as body, epistemic, ts_rank(search, q.q) as rank
    from knowledge_nodes, q
    where project_id = ${projectId}::uuid and valid_to is null and search @@ q.q
    union all
    select 'exploration:' || id, case when state = 'set_aside' then 'idea' else 'thread' end, purpose, left(purpose, 600),
      'proposed', ts_rank(search, q.q)
    from threads, q
    where search @@ q.q
    order by rank desc, ref
    limit ${limit}`.execute(db);
  return rows.map((r) => ({
    ref: r.ref,
    type: r.kind,
    title: r.label,
    excerpt: r.body,
    epistemic_status: r.epistemic,
    rank: r.rank,
  }));
}

/** Neighbors of a current node up to a distance (recursive CTE). */
export async function neighbors(db: Db, projectId: string, ref: string, distance = 2) {
  const { rows } = await sql<{ ref: string; kind: string; label: string; distance: number }>`
    with recursive start as (
      select id from knowledge_nodes where project_id = ${projectId}::uuid and ref = ${ref} and valid_to is null
    ), walk(id, distance) as (
      select id, 0 from start
      union
      select case when e.from_node = r.id then e.to_node else e.from_node end, r.distance + 1
      from walk r
      join knowledge_edges e on (e.from_node = r.id or e.to_node = r.id) and e.valid_to is null
      where r.distance < ${distance}
    )
    select n.ref, n.kind, n.label, min(r.distance)::int as distance
    from walk r join knowledge_nodes n on n.id = r.id
    where n.ref <> ${ref}
    group by n.ref, n.kind, n.label
    order by distance, n.ref`.execute(db);
  return rows;
}
