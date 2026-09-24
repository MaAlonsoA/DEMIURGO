// Cascada por confianza (§7.5 del plan): el clasificador base responde y lo que queda con
// confianza media lo revisa otro clasificador (normalmente un LLM mayor). Lo que siga sin
// confianza alta no se aplica solo: las categorías van a la persona y las relaciones quedan
// anotadas en la actualización. El id combina los dos, así que la caché por input_hash
// distingue la cascada del clasificador base y la reconstrucción la reproduce desde la caché.

import { type Classifier, DEFAULT_THRESHOLDS, type Thresholds, routeByConfidence } from '@demiurgo/domain';

export function createCascadeClassifier(
  base: Classifier,
  reviewer: Classifier,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Classifier {
  return {
    id: `${base.id}>${reviewer.id}`,
    async choice(items) {
      const responses = await base.choice(items);
      const averages = new Set(
        responses.filter((r) => routeByConfidence(r.confidence, thresholds) === 'review_llm').map((r) => r.id),
      );
      if (averages.size === 0) return responses;
      const reviewedById = new Map((await reviewer.choice(items.filter((i) => averages.has(i.id)))).map((r) => [r.id, r]));
      return responses.map((r) => {
        const reviewed = averages.has(r.id) ? reviewedById.get(r.id) : undefined;
        return reviewed ? { ...reviewed, reviewedBy: reviewer.id } : r;
      });
    },
    score: (items) => base.score(items),
    noul: (items) => base.noul(items),
  };
}
