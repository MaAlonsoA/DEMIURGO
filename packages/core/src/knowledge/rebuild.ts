// Reconstrucción del grafo desde la autoridad con las clasificaciones guardadas (I10,
// AC-CON-001-06). Reproduce las actualizaciones aplicadas en el orden en que se aplicaron (su
// evento `knowledge_update.apply` en el diario), con las mismas funciones puras que la
// actualización incremental; los veredictos salen de la caché por input_hash, sin volver a
// llamar al clasificador. Las rechazadas no tuvieron efectos y no cuentan.

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
import { DISCARD_TRIGGER, type AuthorityObject, deriveChange, deriveRetirement } from './derive.ts';
import { loadGraph } from './graph-pg.ts';

const withoutSavedVerdict = (): Promise<never> =>
  Promise.reject(new Error('La reconstrucción no tiene veredictos guardados para una entrada: el grafo ha derivado.'));

/** Clasificador que solo responde desde la caché: si falta algo, la reconstrucción falla. */
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
      plan = removalPlan(g, await deriveRetirement(db, trigger));
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
        throw new Error(`La reconstrucción diverge en la actualización ${u.id}: los candidatos no coinciden.`);
      }
      const reasons = verificationReasons(g, d);
      if (reasons.length > 0) {
        throw new Error(`La reconstrucción diverge en la actualización ${u.id}: ${reasons.join(' ')}`);
      }
      plan = buildPlan(g, change, applicableCategories(d.categories), d.verdicts, g.version + 1);
    }
    if (!isEmptyPlan(plan)) g = applyPlan(g, plan, g.version + 1);
  }
  return g;
}

export type RebuildComparison = {
  alive: string;
  rebuilt: string | null;
  equal: boolean;
  /** Por qué no coinciden (vacío si coinciden). Nunca lanza: informa de la deriva. */
  derivation: string | null;
};

export async function compareRebuild(db: Db, projectId: string): Promise<RebuildComparison> {
  const alive = graphFingerprint(await loadGraph(db, projectId));
  try {
    const rebuilt = graphFingerprint(await rebuildGraph(db, projectId));
    const equal = alive === rebuilt;
    return {
      alive,
      rebuilt,
      equal,
      derivation: equal ? null : 'La huella del grafo reconstruido no coincide con la del grafo vivo.',
    };
  } catch (e) {
    return { alive, rebuilt: null, equal: false, derivation: e instanceof Error ? e.message : String(e) };
  }
}
