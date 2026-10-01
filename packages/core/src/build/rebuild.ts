// «Rebuild or satisfied by main»: a task that was built and merged and then got a newer approved version does not
// start work by itself. A change to a finished work item goes through triage first (Kanban: explicit policies for
// re-entry; Scrum: the Product Owner orders the backlog), and a person decides whether it needs work or is already
// satisfied by what is shipped. Convención nuestra, inspired by those: a version bump alone never triggers work.

import type { Db, Tx } from '../db/connection.ts';
import { effectiveTaskVersionSql } from './basis.ts';

/** The merged version and the current approved one of a task waiting for that decision. */
export type RebuildDecision = { built_on: number; now: number };

/**
 * Tasks of the project with a done build request on an earlier version than the current approved one and no open
 * request (a person who chose «Rebuild» has an open request: the task is then being built, not waiting). By task id.
 */
export async function rebuildDecisions(db: Db | Tx, projectId: string): Promise<Map<string, RebuildDecision>> {
  const done = await db
    .selectFrom('build_requests')
    .innerJoin('record_versions', (join) => join.on('record_versions.id', '=', effectiveTaskVersionSql()))
    .select(['build_requests.task_id', 'record_versions.n'])
    .where('build_requests.project_id', '=', projectId)
    .where('build_requests.state', '=', 'done')
    .execute();
  const out = new Map<string, RebuildDecision>();
  if (done.length === 0) return out;
  const builtOn = new Map<string, number>();
  for (const r of done) builtOn.set(r.task_id, Math.max(builtOn.get(r.task_id) ?? 0, Number(r.n)));
  const ids = [...builtOn.keys()];
  const current = await db
    .selectFrom('record_versions')
    .select(['record_id', (e) => e.fn.max('n').as('n')])
    .where('record_id', 'in', ids)
    .where('state', '=', 'approved')
    .groupBy('record_id')
    .execute();
  const open = new Set(
    (
      await db
        .selectFrom('build_requests')
        .select('task_id')
        .where('task_id', 'in', ids)
        .where('state', 'in', ['requested', 'in_review'])
        .execute()
    ).map((r) => r.task_id),
  );
  for (const c of current) {
    const built = builtOn.get(c.record_id);
    const now = Number(c.n);
    if (built !== undefined && built < now && !open.has(c.record_id)) out.set(c.record_id, { built_on: built, now });
  }
  return out;
}
