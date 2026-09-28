// Jev adapter (TypeSafe AI, System One) behind the `Classifier` port, over `@typesafe-ai/sdk`.
// Sending project content to TypeSafe (a US-hosted API, no zero data retention outside enterprise)
// needs an accepted ADR (plan §7.5): until then it only classifies evaluation sets, never a real
// project. It only works when it is given a key (or a client): it never reads the environment by
// itself, so nothing reaches TypeSafe by accident. Without one, every call fails without effects.
//
// - One request per item: every item carries its own `state`, and System One takes one `state`
//   per request. Items go out in parallel, a few at a time (limit: 1,200 requests/min).
// - `state`: the item's text or JSON, as it is. 64k-token context.
// - Choice: the options become `criteria` (labels with no description). The answer carries the
//   label, its probabilities (passed through as `distribution`) and Jev's confidence.
// - Score: ordered `levels`; the level is the most probable one and `distribution` its probabilities.
// - Noul: `probability` is P(yes). Jev reports no confidence for it, so the confidence is how far
//   the probability is from a coin toss (max(p, 1 − p)).
// - The id is `jev@<model>`, and is part of each classification's `input_hash`.
// - Jev never writes text: `justification` stays empty.

import type { ChoiceResponse, Classifier, ItemChoice, ItemNoul, ItemScore, NoulResponse, ScoreResponse } from '@demiurgo/domain';
import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';

export const JEV_DEFAULT_MODEL = 'jev-latest';
/** Price per million input tokens; output is free (TypeSafe pricing, September 2026). */
export const JEV_USD_PER_MILLION_INPUT_TOKENS = 0.042;

export const JEV_UNAVAILABLE_ID = 'jev@unavailable';
export const JEV_UNAVAILABLE_MESSAGE =
  'Jev is not available: it needs a TypeSafe key, and an accepted ADR about sending data to TypeSafe.';

export type JevUsage = { model: string; input_tokens: number; output_tokens: number };

export type JevOptions = {
  model?: string;
  /** The TypeSafe key. Without it (or a `client`) the classifier is unavailable. */
  apiKey?: string;
  /** Tests pass one over a fake `fetch`. */
  client?: Pick<TypeSafeClient, 'systemOne'>;
  /** Each request's usage, to measure the real cost. */
  onUsage?: (usage: JevUsage) => void;
  /** Requests in flight at once. */
  concurrency?: number;
};

const QUESTION = 'q';

/** Runs `fn` over the items keeping the order, `limit` at a time. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = Array.from<R>({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const indexOfMax = (values: readonly number[]): number => values.reduce((best, v, i) => (v > (values[best] ?? -1) ? i : best), 0);

export function createJevClassifier(options: JevOptions = {}): Classifier {
  const model = options.model ?? JEV_DEFAULT_MODEL;
  const client = options.client ?? (options.apiKey ? new TypeSafeClient({ apiKey: options.apiKey, defaultModel: model }) : null);
  if (!client) {
    const notAvailable = async (): Promise<never> => {
      throw new Error(JEV_UNAVAILABLE_MESSAGE);
    };
    return { id: JEV_UNAVAILABLE_ID, choice: notAvailable, score: notAvailable, noul: notAvailable };
  }
  const limit = options.concurrency ?? 8;

  const track = (usage: { input_tokens: number; output_tokens: number }, used: string): void =>
    options.onUsage?.({ model: used, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });

  return {
    id: `jev@${model}`,

    choice: (items: readonly ItemChoice[]) =>
      mapLimited(items, limit, async (item): Promise<ChoiceResponse> => {
        const criteria = Object.fromEntries(item.options.map((o) => [o, null]));
        const r = await client.systemOne({
          state: item.state as string,
          questions: { [QUESTION]: choice(item.question, criteria) },
          model,
        });
        track(r.usage, r.model);
        const a = r.answers[QUESTION];
        if (!a || !item.options.includes(a.choice)) {
          throw new Error(`Jev: item ${item.id} came back with an invalid choice.`);
        }
        return {
          id: item.id,
          choice: a.choice,
          distribution: { ...a.probabilities },
          confidence: a.confidence,
          justification: '',
        };
      }),

    score: (items: readonly ItemScore[]) =>
      mapLimited(items, limit, async (item): Promise<ScoreResponse> => {
        const [first = '', second = '', ...rest] = item.levels;
        const r = await client.systemOne({
          state: item.state as string,
          questions: { [QUESTION]: score(item.question, [first, second, ...rest]) },
          model,
        });
        track(r.usage, r.model);
        const a = r.answers[QUESTION];
        if (!a) throw new Error(`Jev: item ${item.id} came back without an answer.`);
        const distribution = item.levels.map((_, i) => (a.probabilities as Record<string, number>)[String(i)] ?? 0);
        return { id: item.id, level: indexOfMax(distribution), distribution, confidence: a.confidence };
      }),

    noul: (items: readonly ItemNoul[]) =>
      mapLimited(items, limit, async (item): Promise<NoulResponse> => {
        const r = await client.systemOne({
          state: item.state as string,
          questions: { [QUESTION]: noul(item.statement) },
          model,
        });
        track(r.usage, r.model);
        const a = r.answers[QUESTION];
        if (!a) throw new Error(`Jev: item ${item.id} came back without an answer.`);
        return { id: item.id, probability: a.noul, confidence: Math.max(a.noul, 1 - a.noul) };
      }),
  };
}

/** What the input tokens cost, in dollars. */
export function jevCostUsd(inputTokens: number): number {
  return (inputTokens * JEV_USD_PER_MILLION_INPUT_TOKENS) / 1_000_000;
}
