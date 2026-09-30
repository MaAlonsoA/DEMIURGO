// What DEMIURGO can draft from a thread, for the "Draft" button: an epic, a feature or its tasks, each by
// its own agent. Whether it is offered comes from the records; whether it is suggested, from what the
// thread's agent last said about being ready (`ready_to_draft` of its latest completed answer).

import { sql } from 'kysely';
import { epicProblem } from '../actions/epic-plan.ts';
import { plannedFeatureByCode } from '../actions/exploration-chat.ts';
import type { Db } from '../db/connection.ts';

export type ThreadDraft = {
  kind: 'epic' | 'feature' | 'tasks';
  why: string | null;
  suggested: boolean;
  action: 'epic_plan' | 'feature_design' | 'task_plan';
  scope: { type: string; id: string };
};

type Ready = { kind?: string; why?: string } | null;

/** The current approved version of a feature record, or null while it has none. */
async function approvedVersionOf(db: Db, recordId: string): Promise<string | null> {
  const v = await db
    .selectFrom('record_versions')
    .select('id')
    .where('record_id', '=', recordId)
    .where('state', '=', 'approved')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  return v?.id ?? null;
}

export async function threadDraft(
  db: Db,
  projectId: string,
  thread: { id: string; purpose: string; state: string; origin_type: string | null; origin_id: string | null },
): Promise<ThreadDraft | null> {
  if (thread.state !== 'active') return null;
  const latest = await sql<{ ready: Ready }>`
    select output->'ready_to_draft' as ready
    from ai_runs
    where project_id = ${projectId}::uuid and action = 'exploration_chat' and state = 'completed' and scope->>'id' = ${thread.id}
    order by created_at desc, id desc
    limit 1`.execute(db);
  const ready = latest.rows[0]?.ready ?? null;
  const offer = (kind: ThreadDraft['kind'], action: ThreadDraft['action'], scope: ThreadDraft['scope']): ThreadDraft => {
    const said = ready?.kind === kind;
    return { kind, why: said ? (ready?.why ?? null) : null, suggested: said, action, scope };
  };
  // A feature thread: its planned feature is still to design.
  const code = /\bFDR-[A-Z]{3}-\d{3}\b/.exec(thread.purpose)?.[0];
  const planned = code ? await plannedFeatureByCode(db, projectId, code) : undefined;
  if (planned?.state === 'planned') return offer('feature', 'feature_design', { type: 'exploration', id: thread.id });
  // An approved feature (the thread is about it, or designed it): its tasks.
  const opened =
    thread.origin_type === 'record_version' && thread.origin_id
      ? await db
          .selectFrom('record_versions')
          .innerJoin('records', 'records.id', 'record_versions.record_id')
          .select(['records.id as recordId', 'records.type'])
          .where('record_versions.id', '=', thread.origin_id)
          .where('records.project_id', '=', projectId)
          .executeTakeFirst()
      : undefined;
  const featureRecord = opened?.type === 'fdr' ? opened.recordId : planned?.state === 'designed' ? await recordOfPlanned(db, planned.id) : null;
  const version = featureRecord ? await approvedVersionOf(db, featureRecord) : null;
  if (version) return offer('tasks', 'task_plan', { type: 'record_version', id: version });
  // A thread about a capability that is an epic: only once its agent said it has enough.
  if (ready?.kind === 'epic' && !(await epicProblem(db, projectId, thread.id)))
    return offer('epic', 'epic_plan', { type: 'exploration', id: thread.id });
  return null;
}

async function recordOfPlanned(db: Db, plannedId: string): Promise<string | null> {
  const row = await db.selectFrom('planned_features').select('record_id').where('id', '=', plannedId).executeTakeFirst();
  return row?.record_id ?? null;
}
