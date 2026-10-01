// A task's effort size as the pages read it (FDR-DEL-006): the current size (null: "No size"), its
// points, Jev's active second opinion (only while Jev is on) and the dispute state.

import { SIZE_POINTS, type SizeDispute, type TaskSize, sizeDisputeOf } from '@demiurgo/domain';
import { jevAllowed } from '../classifier/aspect.ts';
import type { Db } from '../db/connection.ts';

export type SizeOpinion = { id: string; size: TaskSize; confidence: number; classifier_id: string; created_at: Date };

export type TaskSizeView = {
  size: TaskSize | null;
  points: number | null;
  opinion: SizeOpinion | null;
  dispute: SizeDispute;
};

export async function taskSizeView(db: Db, recordId: string): Promise<TaskSizeView> {
  const row = await db
    .selectFrom('task_sizes')
    .select('size')
    .where('record_id', '=', recordId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const size = (row?.size as TaskSize | undefined) ?? null;
  // Without the key there is no active second opinion, even if one was stored before.
  const opinion = jevAllowed()
    ? ((await db
        .selectFrom('task_size_opinions')
        .select(['id', 'size', 'confidence', 'classifier_id', 'created_at'])
        .where('record_id', '=', recordId)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst()) as SizeOpinion | undefined) ?? null
    : null;
  const dismissed = opinion
    ? !!(await db.selectFrom('task_size_dismissals').select('id').where('opinion_id', '=', opinion.id).executeTakeFirst())
    : false;
  return {
    size,
    points: size ? SIZE_POINTS[size] : null,
    opinion,
    dispute: sizeDisputeOf(size, opinion?.size ?? null, dismissed),
  };
}

/** The feature criterion codes a task covers (its latest row); empty for a task without any. */
export async function taskCoversOf(db: Db, recordId: string): Promise<string[]> {
  const row = await db
    .selectFrom('task_covers')
    .select('codes')
    .where('record_id', '=', recordId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return row?.codes ?? [];
}

/**
 * Splits criterion codes by how they are verified. Only `automatic` criteria expect a CI test; `manual` (a person
 * judges) and `release` (checked against the deployed candidate; Humble & Farley, Continuous Delivery) never do.
 * The verification is read from the current approved version of the criterion's record; a code with no approved
 * version stays `automatic` (the previous behaviour).
 */
export function splitByVerification(
  rows: readonly { code: string; verification: string }[],
  codes: readonly string[],
): { automatic: string[]; notAutomated: string[] } {
  const kind = new Map(rows.map((r) => [r.code, r.verification]));
  const automatic: string[] = [];
  const notAutomated: string[] = [];
  for (const c of codes) {
    const v = kind.get(c);
    (v === 'manual' || v === 'release' ? notAutomated : automatic).push(c);
  }
  return { automatic, notAutomated };
}

export async function automaticCriteriaOf(
  db: Db,
  projectId: string,
  codes: readonly string[],
): Promise<{ automatic: string[]; notAutomated: string[] }> {
  if (codes.length === 0) return { automatic: [], notAutomated: [] };
  const rows = await db
    .selectFrom('criteria')
    .innerJoin('record_versions as v', 'v.id', 'criteria.record_version_id')
    .select(['criteria.code', 'criteria.verification', 'v.n'])
    .where('criteria.project_id', '=', projectId)
    .where('criteria.code', 'in', [...codes])
    .where('v.state', '=', 'approved')
    .orderBy('v.n', 'asc')
    .execute();
  return splitByVerification(rows, codes);
}
