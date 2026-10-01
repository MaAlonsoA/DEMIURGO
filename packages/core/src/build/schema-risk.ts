// Which tasks are predicted to change the database schema (H101). The app numbers migrations in
// sequence (migrations/0001_…, 0002_…), so two tasks built at once that both add a migration would both
// create the next number and collide. «Build the queue» therefore never runs two of them together
// (our convention; practice: serialise changes to a shared resource, as Nx "affected" and module
// boundaries identify what a change touches).
//
// Layered prediction: deterministic evidence first (the footprint of an earlier merged version of the
// task, i.e. a rebuild), then Jev's `schema` probability for tasks that were never built.

import type { Db } from '../db/connection.ts';
import { SCHEMA_THRESHOLD, type TaskLayers, taskLayersOf } from '../classifier/layers.ts';
import { type TaskFootprint, taskFootprints } from './footprint.ts';

/** A file that defines or changes the database structure: anything under a migrations folder or a .sql file. */
export const isSchemaFile = (path: string): boolean => /(^|\/)migrations\//.test(path) || /\.sql$/i.test(path);

export type SchemaEvidence = 'footprint' | 'jev';

/** Pure policy: the footprint of the task's earlier merge wins; otherwise Jev's probability at the threshold. */
export function schemaEvidence(footprint: Pick<TaskFootprint, 'files'> | undefined, layers: Pick<TaskLayers, 'schema'> | undefined): SchemaEvidence | null {
  if (footprint?.files.some((f) => isSchemaFile(f.path))) return 'footprint';
  if (layers && layers.schema >= SCHEMA_THRESHOLD) return 'jev';
  return null;
}

export type SchemaDeps = {
  footprints?: (db: Db, projectId: string) => Promise<Pick<TaskFootprint, 'code' | 'files'>[]>;
  layers?: (db: Db, recordIds: string[]) => Promise<Map<string, Pick<TaskLayers, 'schema'>>>;
};

/** The tasks among `codes` predicted to change the schema, with the evidence for each. */
export async function schemaChangingTasks(db: Db, projectId: string, codes: string[], deps: SchemaDeps = {}): Promise<Map<string, SchemaEvidence>> {
  const out = new Map<string, SchemaEvidence>();
  if (codes.length === 0) return out;
  const footprints = new Map((await (deps.footprints ?? taskFootprints)(db, projectId)).map((f) => [f.code, f]));
  const records = await db.selectFrom('records').select(['id', 'code']).where('project_id', '=', projectId).where('code', 'in', codes).execute();
  const layers = await (deps.layers ?? taskLayersOf)(
    db,
    records.map((r) => r.id),
  );
  for (const r of records) {
    const e = schemaEvidence(footprints.get(r.code), layers.get(r.id));
    if (e) out.set(r.code, e);
  }
  return out;
}
