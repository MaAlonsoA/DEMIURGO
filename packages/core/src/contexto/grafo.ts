// Versión del grafo de conocimiento de un proyecto. Hasta S2 no hay grafo: versión 0.

import { sql } from 'kysely';
import type { Tx } from '../db/conexion.ts';

export async function versionGrafo(trx: Tx, proyectoId: string): Promise<number> {
  const existe = await sql<{ t: string | null }>`select to_regclass('public.knowledge_graph_state')::text as t`.execute(trx);
  if (!existe.rows[0]?.t) return 0;
  const { rows } = await sql<{ version: string }>`
    select version::text from knowledge_graph_state where project_id = ${proyectoId}::uuid`.execute(trx);
  return Number(rows[0]?.version ?? 0);
}

/** Frescura: el grafo ha proyectado todos los eventos de autoridad del proyecto. */
export async function grafoAlDia(trx: Tx, proyectoId: string): Promise<{ alDia: boolean; pendientes: number }> {
  const existe = await sql<{ t: string | null }>`select to_regclass('public.knowledge_updates')::text as t`.execute(trx);
  if (!existe.rows[0]?.t) return { alDia: true, pendientes: 0 };
  const { rows } = await sql<{ n: string }>`
    select count(*)::text as n from knowledge_updates
    where project_id = ${proyectoId}::uuid and state <> 'applied'`.execute(trx);
  const pendientes = Number(rows[0]?.n ?? 0);
  return { alDia: pendientes === 0, pendientes };
}
