// What DEMIURGO can draft from a thread, for the "Draft" button: an epic, a feature or its tasks, each by
// its own agent. Whether it is offered comes from the records; whether it is suggested, from what the
// thread's agent last said about being ready (`ready_to_draft` of its latest completed answer).

import { sql } from 'kysely';
import { designSystemPathOf } from '@demiurgo/domain';
import { chosenDirection } from '../actions/design-directions.ts';
import { epicProblem } from '../actions/epic-plan.ts';
import { approvedDesignSystem, hasApprovedScreens } from '../actions/screen-design.ts';
import { standaloneOfThread } from '../actions/feature-design.ts';
import { plannedFeatureByCode } from '../actions/exploration-chat.ts';
import { type PendingDraft, pendingDraft } from '../actions/pending-draft.ts';
import type { Db } from '../db/connection.ts';

export type ThreadDraft = {
  kind: 'epic' | 'feature' | 'tasks' | 'design_directions' | 'design_system' | 'screens';
  why: string | null;
  suggested: boolean;
  action: 'epic_plan' | 'feature_design' | 'task_plan' | 'design_directions' | 'design_system_plan' | 'screen_design';
  scope: { type: string; id: string };
  /** A draft of this action for this scope is already in flight: a run working or a proposal waiting (`batchId`). */
  pending: PendingDraft | null;
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
  const offer = async (
    kind: ThreadDraft['kind'],
    action: ThreadDraft['action'],
    scope: ThreadDraft['scope'],
  ): Promise<ThreadDraft> => {
    const said = ready?.kind === kind;
    const pending = await pendingDraft(db, projectId, action, scope.id);
    return { kind, why: said ? (ready?.why ?? null) : null, suggested: said, action, scope, pending };
  };
  // A design-system thread (its purpose starts with `Design system:`): visual directions once its agent
  // says it has the principles, and the system itself after the person chose a direction.
  if (designSystemPathOf(thread.purpose)) {
    const scope = { type: 'exploration', id: thread.id };
    if (await chosenDirection(db, projectId, thread.id)) {
      const pending = await pendingDraft(db, projectId, 'design_system_plan', scope.id);
      return { kind: 'design_system', why: null, suggested: true, action: 'design_system_plan', scope, pending };
    }
    return ready?.kind === 'design_directions' ? offer('design_directions', 'design_directions', scope) : null;
  }
  // A feature thread: its planned feature is still to design.
  const code = /\bFDR-[A-Z]{3}-\d{3}\b/.exec(thread.purpose)?.[0];
  const planned = code ? await plannedFeatureByCode(db, projectId, code) : undefined;
  if (planned?.state === 'planned') return await offer('feature', 'feature_design', { type: 'exploration', id: thread.id });
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
  const featureRecord =
    opened?.type === 'fdr'
      ? opened.recordId
      : planned?.state === 'designed'
        ? await recordOfPlanned(db, planned.id)
        : code
          ? null
          : await standaloneRecordOf(db, projectId, thread.id);
  const version = featureRecord ? await approvedVersionOf(db, featureRecord) : null;
  if (version) {
    // With an approved design system, the screens come first (design goes one step ahead of delivery: Cagan and
    // Patton, SVPG): the tasks are offered once the current version has approved screens. Without a design
    // system nothing changes: the tasks are offered right away.
    if ((await approvedDesignSystem(db, projectId)) && !(await hasApprovedScreens(db, projectId, version)))
      return await offer('screens', 'screen_design', { type: 'record_version', id: version });
    return await offer('tasks', 'task_plan', { type: 'record_version', id: version });
  }
  // A standalone feature (no epic lists it): once its agent said it has enough, it rests on the definition.
  if (!code && ready?.kind === 'feature' && !(await standaloneOfThread(db, projectId, thread.id)).problem)
    return await offer('feature', 'feature_design', { type: 'exploration', id: thread.id });
  // A thread about a capability that is an epic: only once its agent said it has enough.
  if (ready?.kind === 'epic' && !(await epicProblem(db, projectId, thread.id)))
    return await offer('epic', 'epic_plan', { type: 'exploration', id: thread.id });
  return null;
}

async function recordOfPlanned(db: Db, plannedId: string): Promise<string | null> {
  const row = await db.selectFrom('planned_features').select('record_id').where('id', '=', plannedId).executeTakeFirst();
  return row?.record_id ?? null;
}

/** The feature record born from a standalone thread: its accepted `design_record` proposal is the origin of the record's first version. */
async function standaloneRecordOf(db: Db, projectId: string, threadId: string): Promise<string | null> {
  const row = await sql<{ record_id: string }>`
    select rv.record_id
    from proposals p
    join proposal_batches b on b.id = p.batch_id
    join ai_runs r on r.id = b.run_id
    join record_versions rv on rv.origin->>'type' = 'proposal' and rv.origin->>'id' = p.id::text
    join records rec on rec.id = rv.record_id and rec.type = 'fdr'
    where p.project_id = ${projectId}::uuid and p.type = 'design_record' and p.payload->>'record_type' = 'fdr'
      and p.state = 'accepted' and r.action = 'feature_design' and r.scope->>'id' = ${threadId}
    order by p.created_at desc
    limit 1`.execute(db);
  return row.rows[0]?.record_id ?? null;
}
