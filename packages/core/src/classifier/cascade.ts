// Confidence-based cascade (plan §7.5): the base classifier answers, and whatever comes back
// with medium confidence is reviewed by another classifier (usually a bigger LLM). Whatever is
// still not high-confidence isn't applied on its own: categories go to the person and relations
// are annotated in the update. The id combines both, so the input_hash cache tells the cascade
// apart from the base classifier, and the rebuild reproduces it from the cache.

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
      const mediumConfidence = new Set(
        responses.filter((r) => routeByConfidence(r.confidence, thresholds) === 'review_llm').map((r) => r.id),
      );
      if (mediumConfidence.size === 0) return responses;
      const reviewedById = new Map(
        (await reviewer.choice(items.filter((i) => mediumConfidence.has(i.id)))).map((r) => [r.id, r]),
      );
      return responses.map((r) => {
        const reviewed = mediumConfidence.has(r.id) ? reviewedById.get(r.id) : undefined;
        return reviewed ? { ...reviewed, reviewedBy: reviewer.id } : r;
      });
    },
    score: (items) => base.score(items),
    noul: (items) => base.noul(items),
  };
}
