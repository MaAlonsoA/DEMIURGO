// «On hold» (Kanban «blocked» item with its stated blocker): a task a person put on hold with a reason is not
// ready to build. The queue skips it, and no build request or build starts on it, until the person releases it.

import type { Db, Tx } from '../db/connection.ts';

export type TaskHold = { reason: string; held_by: string; held_at: string };

/** The open hold of a task, or null. */
export async function openHoldOf(db: Db | Tx, taskId: string): Promise<TaskHold | null> {
  const row = await db
    .selectFrom('task_holds')
    .select(['reason', 'held_by', 'held_at'])
    .where('task_id', '=', taskId)
    .where('released_at', 'is', null)
    .executeTakeFirst();
  return row ? { reason: row.reason, held_by: row.held_by, held_at: new Date(row.held_at as unknown as Date).toISOString() } : null;
}

/** The open holds of a project by task code. */
export async function openHolds(db: Db | Tx, projectId: string): Promise<Map<string, TaskHold>> {
  const rows = await db
    .selectFrom('task_holds')
    .innerJoin('records', 'records.id', 'task_holds.task_id')
    .select(['records.code', 'task_holds.reason', 'task_holds.held_by', 'task_holds.held_at'])
    .where('task_holds.project_id', '=', projectId)
    .where('task_holds.released_at', 'is', null)
    .execute();
  return new Map(
    rows.map((r): [string, TaskHold] => [r.code, { reason: r.reason, held_by: r.held_by, held_at: new Date(r.held_at as unknown as Date).toISOString() }]),
  );
}
