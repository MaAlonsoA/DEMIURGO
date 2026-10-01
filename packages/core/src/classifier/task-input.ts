// A task as Jev reads it: a JSON object with its title, Goal, Scope and the acceptance criteria it
// covers (the A/B audit of 01-10-2026 found structured input beats one long text for sizes and layers).
// A task has no criteria of its own: it covers criteria of its feature, so those are the ones shown.

import type { Db } from '../db/connection.ts';
import { taskCoversOf } from '../queries/sizes.ts';

const MAX_TEXT = 3000;
const MAX_CRITERIA = 40;

export type TaskObject = { title: string; goal: string; scope: string; acceptance_criteria: string[] };

const section = (sections: { title: string; content: string }[], name: string): string =>
  (sections.find((s) => s.title.trim().toLowerCase() === name)?.content ?? '').slice(0, MAX_TEXT);

/** The task version as Jev reads it; null when the version does not exist. */
export async function loadTaskObject(db: Db, recordId: string, versionId: string): Promise<TaskObject | null> {
  const v = await db.selectFrom('record_versions').select(['title', 'sections']).where('id', '=', versionId).executeTakeFirst();
  if (!v) return null;
  const sections = v.sections as { title: string; content: string }[];
  const covers = await taskCoversOf(db, recordId);
  let criteria: string[] = [];
  if (covers.length > 0) {
    const feature = await db
      .selectFrom('links')
      .select('links.to_id')
      .where('links.from_id', '=', versionId)
      .where('links.type', '=', 'based_on')
      .execute();
    for (const f of feature) {
      const rows = await db
        .selectFrom('criteria')
        .select(['statement'])
        .where('record_version_id', '=', f.to_id)
        .where('code', 'in', covers)
        .orderBy('position')
        .execute();
      if (rows.length > 0) {
        criteria = rows.map((r) => r.statement);
        break;
      }
    }
  }
  if (criteria.length === 0) {
    const own = await db.selectFrom('criteria').select('statement').where('record_version_id', '=', versionId).orderBy('position').execute();
    criteria = own.map((r) => r.statement);
  }
  return { title: v.title, goal: section(sections, 'goal'), scope: section(sections, 'scope'), acceptance_criteria: criteria.slice(0, MAX_CRITERIA) };
}
