// Versión del grafo de conocimiento de un proyecto. Hasta S2 no hay grafo: versión 0.

import { sql } from 'kysely';
import type { Tx } from '../db/connection.ts';

export async function graphVersion(trx: Tx, projectId: string): Promise<number> {
  const exists = await sql<{ t: string | null }>`select to_regclass('public.knowledge_graph_state')::text as t`.execute(trx);
  if (!exists.rows[0]?.t) return 0;
  const { rows } = await sql<{ version: string }>`
    select version::text from knowledge_graph_state where project_id = ${projectId}::uuid`.execute(trx);
  return Number(rows[0]?.version ?? 0);
}

/**
 * Frescura para las acciones del Pilar 1: no hay ninguna actualización de conocimiento en
 * curso (en cola, clasificando o verificando). Una actualización rechazada no bloquea las
 * conversaciones: queda en la bandeja para que la persona la reintente. El gate estricto
 * (también las rechazadas de su alcance) es el de un Change Set al pasar a in_progress (S3).
 */
export async function graphUpToDate(trx: Tx, projectId: string): Promise<{ upToDate: boolean; pending: number }> {
  const exists = await sql<{ t: string | null }>`select to_regclass('public.knowledge_updates')::text as t`.execute(trx);
  if (!exists.rows[0]?.t) return { upToDate: true, pending: 0 };
  const { rows } = await sql<{ n: string }>`
    select count(*)::text as n from knowledge_updates
    where project_id = ${projectId}::uuid and state in ('queued', 'classifying', 'verifying')`.execute(trx);
  const pending = Number(rows[0]?.n ?? 0);
  return { upToDate: pending === 0, pending };
}
