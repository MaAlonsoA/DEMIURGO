// The trace context of an entity (spec §5.2): the W3C traceparent of the command that created it,
// written by the bus in the creating transaction. The engine is its only reader, at the start of
// each durable step, so a step that resumes in another process still hangs from that command.

import type { Db, Tx } from '../db/connection.ts';

export async function traceParentOf(db: Db | Tx, entityType: string, entityId: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('trace_contexts')
    .select('trace_parent')
    .where('entity_type', '=', entityType)
    .where('entity_id', '=', entityId)
    .executeTakeFirst();
  return row?.trace_parent;
}
