// Whether a drafting action already has work in flight for a scope: a run queued or running, or a proposal
// batch of that action's run still waiting for the person. Asking again would spend another model run and
// produce a second, competing draft, so the thread stops offering it and `run.request` refuses it.

import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';

/** The actions that draft something for the person to review (one draft per scope at a time). */
export const DRAFTING_ACTIONS: readonly string[] = [
  'epic_plan',
  'feature_design',
  'task_plan',
  'design_directions',
  'design_system_plan',
  'screen_design',
];

export type PendingDraft = { runId: string | null; batchId: string | null };

/** The draft of `action` for the scope (its `id`) that is still in flight, or null when a new one may be asked. */
export async function pendingDraft(db: Db, projectId: string, action: string, scopeId: string): Promise<PendingDraft | null> {
  const batch = await db
    .selectFrom('proposal_batches')
    .innerJoin('ai_runs', 'ai_runs.id', 'proposal_batches.run_id')
    .select(['proposal_batches.id as batchId', 'ai_runs.id as runId'])
    .where('proposal_batches.project_id', '=', projectId)
    .where('proposal_batches.state', '=', 'pending')
    .where('ai_runs.action', '=', action)
    .where(sql<boolean>`${sql.ref('ai_runs.scope')}->>'id' = ${scopeId}`)
    .orderBy('proposal_batches.created_at', 'desc')
    .executeTakeFirst();
  if (batch) return { runId: batch.runId, batchId: batch.batchId };
  const run = await db
    .selectFrom('ai_runs')
    .select('id')
    .where('project_id', '=', projectId)
    .where('action', '=', action)
    .where('state', 'in', ['queued', 'running'])
    .where(sql<boolean>`${sql.ref('scope')}->>'id' = ${scopeId}`)
    .executeTakeFirst();
  return run ? { runId: run.id, batchId: null } : null;
}
