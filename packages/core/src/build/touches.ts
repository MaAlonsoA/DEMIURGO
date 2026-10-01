// What each task touches, in one line for the Build page and the task page, so the person sees why tasks
// wait for each other. Layered as predicted-files.ts: the footprint of the task's merged pull request when
// it exists ('footprint'), otherwise the code map ranking ('predicted'). Display only: it never changes
// the order or what the queue builds. Our convention: at most MAX_TOUCH_MODULES modules are listed.

import type { Db } from '../db/connection.ts';
import { type TaskLayers, taskLayersOf } from '../classifier/layers.ts';
import type { CodeMap } from './code-map.ts';
import { taskFootprints } from './footprint.ts';
import { isHotspot, isHotspotCandidate, hotspotsOf } from './hotspots.ts';
import { predictedFiles } from './predicted-files.ts';
import { type SchemaEvidence, schemaEvidence } from './schema-risk.ts';

export const MAX_TOUCH_MODULES = 6;
const SHOWN_KINDS = ['table:', 'route:', 'page:', 'server_action:'];

export type Touches = {
  source: 'footprint' | 'predicted';
  /** Table, route, page and server action ids of the map (`table:meals`), at most MAX_TOUCH_MODULES. */
  modules: string[];
  /** Files that many merged tasks changed (hotspots.ts) among the task's files. */
  hotspots: string[];
  schema: { by: SchemaEvidence; p?: number } | null;
};

/** Pure: the touches of a task from its files, the code map, the project's hotspots and its schema evidence. */
export function touchesOf(
  source: Touches['source'],
  files: readonly string[],
  map: Pick<CodeMap, 'byPath'> | null,
  hotspots: readonly { path: string; tasks: number; of: number }[],
  schema: Touches['schema'],
): Touches {
  const modules = new Set<string>();
  if (map) {
    for (const p of files) {
      const f = map.byPath.get(p);
      if (!f || f.kind === 'test' || f.kind === 'config') continue;
      for (const id of f.modules) if (SHOWN_KINDS.some((k) => id.startsWith(k))) modules.add(id);
    }
  }
  const hot = new Set(hotspots.filter((h) => isHotspot(h) && isHotspotCandidate(h.path)).map((h) => h.path));
  return {
    source,
    modules: [...modules].slice(0, MAX_TOUCH_MODULES),
    hotspots: [...new Set(files)].filter((p) => hot.has(p)),
    schema,
  };
}

/** The touches of each task among `codes`; tasks with nothing to show are absent. Never throws. */
export async function touchesFor(db: Db, projectId: string, codes: string[]): Promise<Map<string, Touches>> {
  const out = new Map<string, Touches>();
  try {
    if (codes.length === 0) return out;
    const footprints = new Map((await taskFootprints(db, projectId)).map((f) => [f.code, f]));
    const { files, map } = await predictedFiles(db, projectId, codes);
    const hotspots = await hotspotsOf(db, projectId);
    const records = await db.selectFrom('records').select(['id', 'code']).where('project_id', '=', projectId).where('code', 'in', codes).execute();
    const layers: Map<string, Pick<TaskLayers, 'schema'>> = await taskLayersOf(db, records.map((r) => r.id)).catch(() => new Map());
    const idOf = new Map(records.map((r) => [r.code, r.id]));
    for (const code of codes) {
      const mine = files.get(code);
      if (!mine) continue;
      const fp = footprints.get(code);
      const jev = layers.get(idOf.get(code) ?? '');
      const by = schemaEvidence(fp, jev);
      const schema = by ? { by, ...(by === 'jev' && jev ? { p: Number(jev.schema.toFixed(2)) } : {}) } : null;
      const t = touchesOf(fp ? 'footprint' : 'predicted', mine, map, hotspots, schema);
      if (t.modules.length > 0 || t.hotspots.length > 0 || t.schema) out.set(code, t);
    }
  } catch {
    // display only: the queue answers without it
  }
  return out;
}
