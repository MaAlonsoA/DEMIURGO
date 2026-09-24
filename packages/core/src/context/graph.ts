// Knowledge graph version of a project. Until S2 there is no graph: version 0.

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
 * Freshness for Pillar 1 actions: no knowledge update is currently in progress
 * (queued, classifying or verifying). A rejected update does not block conversations:
 * it stays in the inbox for the person to retry. The strict gate (which also covers
 * rejected updates within its scope) is the one for a Change Set moving to in_progress (S3).
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
