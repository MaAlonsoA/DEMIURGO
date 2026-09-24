// Jev adapter (TypeSafe AI, System One) behind the `Classifier` port. It's deliberately empty:
// there's no early access yet, and sending project content to TypeSafe (a US-hosted API) needs
// an ADR first (plan §7.5). The reference classifier is used in the meantime.
//
// How `@typesafe-ai/sdk` 0.6 (MIT) will fit in once installed, without changing the port:
// - One request per call to `choice`, `score` or `noul`, with all items as independent
//   questions in the same request (Jev solves them in parallel). Nothing multi-hop.
// - `state`: each item's `state` (text or JSON), small and delimited as untrusted data.
//   64k-token context, 32k for `state` plus the question.
// - Choice: `question` and `options` (up to 255). The response carries the chosen option and
//   its probability distribution, which passes through as-is to `ChoiceResponse.distribution`.
// - Score: `question` and ordered `levels` (2 to 10). `level` is the chosen index and
//   `distribution`, the probability per level.
// - Noul: `statement`; `probability` is P(true). Two Nouls aren't combined for a single
//   decision: P(yes) + P(no) may not add up to 1 (a Choice is better for that).
// - Jev's `confidence` routes the cascade (`routeByConfidence`). It's calibrated per group,
//   not per response, and the thresholds are tuned with our own data.
// - The id will become `jev@<model version>` (e.g. `jev@jev-1.13.0`), and is part of each
//   classification's `input_hash`.

import type { Classifier } from '@demiurgo/domain';

export const JEV_CLASSIFIER_ID = 'jev@unavailable';

export const JEV_UNAVAILABLE_MESSAGE =
  'Jev is not available: the adapter is empty until we have access and an ADR about sending data to TypeSafe.';

export function createJevClassifier(): Classifier {
  const notAvailable = async (): Promise<never> => {
    throw new Error(JEV_UNAVAILABLE_MESSAGE);
  };
  return { id: JEV_CLASSIFIER_ID, choice: notAvailable, score: notAvailable, noul: notAvailable };
}
