// `files.prediction` (B07): the files «Code to extend» offered the builder against the files the merged pull
// request really changed (G01, without tests, lockfiles and generated files, as in flow.ts). Recall@k and
// precision@k are reported for Jev's final order (`rank`) and for the deterministic order
// (`deterministic_score`), which is stored so the counterfactual can be recomputed. `files.technical_task` marks
// a technical task (an enabler without a feature), where predicting `src/` files is pure cost.
// pm-5: precision@10 is capped by the size of the truth (a task touches 3.6 existing files: ceiling 0.36), so the
// measures are R-precision (precision in the first |actual| places) and recall@10 (Manning, Raghavan and Schütze,
// Introduction to Information Retrieval, ch. 8), and the tp/fp/fn rows are those of the set the queue really uses:
// the files with Jev's p >= 0.5 (`STRONG_FILE_P` in build/predicted-files.ts, convención nuestra). A real file that was
// not among the candidates of the map at all is marked `outside_candidates` (the map's ceiling, not Jev's miss).

import { isTestFile } from '../../build/flow.ts';
import { isReusableFile } from '../../build/footprint.ts';
import type { Finding, Rule } from './index.ts';
import { objectOf, realFilesOf } from './common.ts';

/** k of recall@k: the number of files the queue takes (`PREDICTED_FILES` in build/predicted-files.ts, not imported to keep the rules light). */
const PREDICTED_FILES = 10;
/** Jev's cut of the strong set the queue uses (`STRONG_FILE_P` in build/predicted-files.ts). */
const STRONG_P = 0.5;

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
    /** Precision in the first |actual| places: it does not depend on the list length (IIR §8.4). */
    r_precision: actual.size === 0 ? 0 : round(order.slice(0, actual.size).filter((p) => actual.has(p)).length / actual.size),
  };
}

const byRank = (a: Opinion, b: Opinion) => a.rank - b.rank || (a.path < b.path ? -1 : 1);
const byScore = (a: Opinion, b: Opinion) => b.deterministic_score - a.deterministic_score || (a.path < b.path ? -1 : 1);

/** Files the merged pull request created (footprint status `added`): «Code to extend» can only offer files that exist. */
function addedFilesOf(steps: readonly { stage: string; outcome: string; detail: unknown }[]): Set<string> {
  const merge = steps.filter((s) => s.stage === 'merge' && s.outcome === 'ok').at(-1);
  const files = merge ? objectOf(objectOf(merge.detail).footprint).files : undefined;
  const added = new Set<string>();
  if (!Array.isArray(files)) return added;
  for (const f of files) {
    const o = objectOf(f);
    if (o.status === 'added' && typeof o.path === 'string') added.add(o.path);
  }
  return added;
}

export const filesPrediction: Rule = (inputs) => {
  if (inputs.request.state !== 'done') return [];
  const real = realFilesOf(inputs.steps);
  if (!real) return [];
  const created = addedFilesOf(inputs.steps);
  const actual = new Set(real.filter((f) => isReusableFile(f) && !isTestFile(f) && !created.has(f)));
  if (actual.size === 0) return [];
  // The FIRST attempt with opinions: the prediction the queue planned with. A later attempt already sees the files the
  // builder created in earlier ones («Code to extend» reads the branch), which would count as hits (information leak).
  const attempt = inputs.codeOpinions.length === 0 ? 0 : Math.min(...inputs.codeOpinions.map((o) => o.attempt));
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
  // The candidates of the map (all the opinions of the attempt, tests included): a real file outside them was never offered.
  const candidatePaths = new Set(inputs.codeOpinions.filter((o) => o.attempt === attempt).map((o) => o.path));
  const strong = opinions.filter((o) => o.jev_p !== null && o.jev_p >= STRONG_P).sort(byRank).map((o) => o.path);
  const pOf = new Map(opinions.map((o) => [o.path, o.jev_p]));
  return scored.flatMap((s): Finding[] => {
    const row = (path: string, cls: 'tp' | 'fp' | 'fn'): Finding => {
      const outside = cls === 'fn' && !candidatePaths.has(path);
      return {
        piece: 'B07',
        finding: 'files.prediction_file',
        class: cls,
        ground_truth: 'G01',
        subject: `${s.name}:${path}`,
        attempt,
        evidence: { order: s.name, path, set: `p>=${STRONG_P}`, p: pOf.get(path) ?? null, ...(cls === 'fn' ? { outside_candidates: outside } : {}), code_opinions: ids },
      };
    };
    // Per file, for Jev's strong set (p >= 0.5) only: precision and recall of the piece come from these rows.
    const perFile =
      s.name === 'jev'
        ? [...strong.filter((f) => actual.has(f)).sort().map((f) => row(f, 'tp')), ...strong.filter((f) => !actual.has(f)).sort().map((f) => row(f, 'fp')), ...[...actual].filter((f) => !strong.includes(f)).sort().map((f) => row(f, 'fn'))]
        : [];
    const strongHits = strong.filter((f) => actual.has(f)).length;
    const setMeasures =
      s.name === 'jev'
        ? { strong_size: strong.length, strong_hits: strongHits, strong_precision: strong.length === 0 ? null : round(strongHits / strong.length), strong_recall: round(strongHits / actual.size), outside_candidates: [...actual].filter((f) => !candidatePaths.has(f)).sort() }
        : {};
    return [
      {
        piece: 'B07',
        finding: 'files.prediction',
        class: 'benefit',
        ground_truth: 'G01',
        value: s.hits,
        unit: 'files',
        subject: s.name,
        attempt,
        evidence: { order: s.name, k: s.k, predicted: s.predicted, actual: s.actual, hits: s.hits, precision: s.precision, recall: s.recall, r_precision: s.r_precision, hit_paths: s.hit_paths, ...setMeasures, code_opinions: ids },
      },
      // The two measures that read well, as rows of their own so a scorecard can show them.
      { piece: 'B07', finding: 'files.r_precision', class: 'info', ground_truth: 'G01', value: s.r_precision, unit: null, subject: s.name, attempt, evidence: { order: s.name, r: s.actual, code_opinions: ids } },
      { piece: 'B07', finding: 'files.recall_at_k', class: 'info', ground_truth: 'G01', value: s.recall, unit: null, subject: s.name, attempt, evidence: { order: s.name, k: s.k, code_opinions: ids } },
      ...perFile,
    ];
  });
};
