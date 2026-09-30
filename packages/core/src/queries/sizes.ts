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
