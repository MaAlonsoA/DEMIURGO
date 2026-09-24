// Rebuilds the graph from authority with the saved classifications (I10,
// AC-CON-001-06). Replays the applied updates in the order they were applied (their
// `knowledge_update.apply` event in the event log), with the same pure functions as the
// incremental update; verdicts come from the cache by input_hash, without calling the
// classifier again. Rejected updates had no effects and don't count.

import {
  type Classifier,
  type Graph,
  type Plan,
  applyPlan,
  emptyGraph,
  graphFingerprint,
  removalPlan,
  isEmptyPlan,
  buildPlan,
} from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { type Axis, applicableCategories, classifyChange, verificationReasons } from './update.ts';
import { DISCARD_TRIGGER, type AuthorityObject, deriveChange, deriveRemoval } from './derive.ts';
import { loadGraph } from './graph-pg.ts';

const withoutSavedVerdict = (): Promise<never> =>
  Promise.reject(new Error('Rebuilding has no saved verdicts for an input: the graph has drifted.'));

/** A classifier that only answers from the cache: if something's missing, the rebuild fails. */
const cacheOnly = (id: string): Classifier => ({
  id,
  choice: withoutSavedVerdict,
  score: withoutSavedVerdict,
  noul: withoutSavedVerdict,
});

type SavedTaxonomy = { id: string; code: string; version: number; content?: string } | null;

export async function rebuildGraph(db: Db, projectId: string): Promise<Graph> {
  const updates = await db
    .selectFrom('knowledge_updates as u')
    .innerJoin('events as e', (j) => j.onRef('e.entity_id', '=', 'u.id').on('e.command', '=', 'knowledge_update.apply'))
    .select(['u.id', 'u.trigger', 'u.classifier', 'u.verdicts', 'u.input_hash', 'e.seq'])
    .where('u.project_id', '=', projectId)
    .where('e.project_id', '=', projectId)
    .where('u.state', '=', 'applied')
    .orderBy('e.seq')
    .execute();
  let g = emptyGraph();
  for (const u of updates) {
    const trigger = u.trigger as AuthorityObject;
    let plan: Plan;
    if (trigger.type === DISCARD_TRIGGER) {
      plan = removalPlan(g, await deriveRemoval(db, trigger));
    } else {
      const change = await deriveChange(db, trigger);
      if (!change || !u.classifier) continue;
      const saved = ((u.verdicts ?? {}) as { taxonomy?: SavedTaxonomy }).taxonomy ?? null;
      let taxonomy = null;
      if (saved) {
        const t = await db
          .selectFrom('taxonomies')
          .select(['axes', 'content_hash'])
          .where('id', '=', saved.id)
          .executeTakeFirstOrThrow();
        taxonomy = { ...saved, content: t.content_hash, axes: t.axes as Axis[] };
      }
      const d = await classifyChange(db, cacheOnly(u.classifier), g, change, taxonomy);
      if (d.verdictsHash !== u.input_hash) {
        throw new Error(`Rebuild diverges at update ${u.id}: the candidates don't match.`);
      }
      const reasons = verificationReasons(g, d);
      if (reasons.length > 0) {
        throw new Error(`Rebuild diverges at update ${u.id}: ${reasons.join(' ')}`);
      }
      plan = buildPlan(g, change, applicableCategories(d.categories), d.verdicts, g.version + 1);
    }
    if (!isEmptyPlan(plan)) g = applyPlan(g, plan, g.version + 1);
  }
  return g;
}

export type RebuildComparison = {
  live: string;
  rebuilt: string | null;
  equal: boolean;
  /** Why they don't match (empty if they do). Never throws: it reports the drift. */
  drift: string | null;
};

export async function compareRebuild(db: Db, projectId: string): Promise<RebuildComparison> {
  const live = graphFingerprint(await loadGraph(db, projectId));
  try {
    const rebuilt = graphFingerprint(await rebuildGraph(db, projectId));
    const equal = live === rebuilt;
    return {
      live: live,
      rebuilt,
      equal,
      drift: equal ? null : "The rebuilt graph's fingerprint doesn't match the live graph's.",
    };
  } catch (e) {
    return { live: live, rebuilt: null, equal: false, drift: e instanceof Error ? e.message : String(e) };
  }
}
