// `files.prediction` (B07): the files «Code to extend» offered the builder against the files the merged pull
// request really changed (G01, without tests, lockfiles and generated files, as in flow.ts). Recall@k and
// precision@k are reported for Jev's final order (`rank`) and for the deterministic order
// (`deterministic_score`), which is stored so the counterfactual can be recomputed. `files.technical_task` marks
// a technical task (an enabler without a feature), where predicting `src/` files is pure cost.

import { isTestFile } from '../../build/flow.ts';
import { isReusableFile } from '../../build/footprint.ts';
import type { Finding, Rule } from './index.ts';
import { realFilesOf } from './common.ts';

/** k of recall@k: the number of files the queue takes (`PREDICTED_FILES` in build/predicted-files.ts, not imported to keep the rules light). */
const PREDICTED_FILES = 10;

type Opinion = { path: string; deterministic_score: number; jev_p: number | null; rank: number };

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Hits, precision and recall of the first `k` candidates (already ordered) against the real files. Pure. */
export function scoreOrder(order: readonly string[], actual: ReadonlySet<string>, k: number) {
  const predicted = order.slice(0, k);
  const hits = predicted.filter((p) => actual.has(p));
  return {
    k,
    predicted: predicted.length,
    actual: actual.size,
    hits: hits.length,
    hit_paths: hits,
    precision: predicted.length === 0 ? 0 : round(hits.length / predicted.length),
    recall: actual.size === 0 ? 0 : round(hits.length / actual.size),
  };
}

const byRank = (a: Opinion, b: Opinion) => a.rank - b.rank || (a.path < b.path ? -1 : 1);
const byScore = (a: Opinion, b: Opinion) => b.deterministic_score - a.deterministic_score || (a.path < b.path ? -1 : 1);

export const filesPrediction: Rule = (inputs) => {
  if (inputs.request.state !== 'done') return [];
  const real = realFilesOf(inputs.steps);
  if (!real) return [];
  const actual = new Set(real.filter((f) => isReusableFile(f) && !isTestFile(f)));
  if (actual.size === 0) return [];
  // The merged attempt: the one whose merge step is ok; else the latest attempt that has opinions.
  const merged = inputs.steps.filter((s) => s.stage === 'merge' && s.outcome === 'ok').at(-1)?.attempt;
  const attempt = merged !== undefined && inputs.codeOpinions.some((o) => o.attempt === merged) ? merged : Math.max(0, ...inputs.codeOpinions.map((o) => o.attempt));
  const opinions = inputs.codeOpinions.filter((o) => o.attempt === attempt && isReusableFile(o.path) && !isTestFile(o.path));
  if (opinions.length === 0) return [];
  const technical = inputs.request.feature_version_id === null;
  const ids = opinions.map((o) => o.id);
  const jevTookPart = opinions.some((o) => o.jev_p !== null);
  const orders: { name: string; order: string[] }[] = [
    ...(jevTookPart ? [{ name: 'jev', order: [...opinions].sort(byRank).map((o) => o.path) }] : []),
    { name: 'deterministic', order: [...opinions].sort(byScore).map((o) => o.path) },
  ];
  const scored = orders.map((o) => ({ name: o.name, ...scoreOrder(o.order, actual, PREDICTED_FILES) }));
  if (technical) {
    // A technical task is not a feature: the prediction is reported, not judged.
    const best = scored.find((s) => s.name === 'jev') ?? scored[0]!;
    return [
      {
        piece: 'B07',
        finding: 'files.technical_task',
        class: 'info',
        ground_truth: 'G01',
        value: best.hits,
        unit: 'files',
        subject: inputs.taskCode,
        attempt,
        evidence: { code_opinions: ids, scores: scored.map(({ hit_paths: _h, ...rest }) => rest) },
      },
    ];
  }
  return scored.map(
    (s): Finding => ({
      piece: 'B07',
      finding: 'files.prediction',
      class: 'benefit',
      ground_truth: 'G01',
      value: s.hits,
      unit: 'files',
      subject: s.name,
      attempt,
      evidence: { order: s.name, k: s.k, predicted: s.predicted, actual: s.actual, hits: s.hits, precision: s.precision, recall: s.recall, hit_paths: s.hit_paths, code_opinions: ids },
    }),
  );
};
