// Metrics for the classifier's evaluation set (§7.9 of the plan and §8 of the stack
// research) and the format of its cases. Everything is pure: it takes already-classified cases
// (or the text of a JSONL) and returns numbers. Who calls the classifier and where results are recorded stays out of scope.

import { z } from 'zod';
import { IDEA_FINDINGS, VERDICTS } from './classifier.ts';

// ─── Metrics ────────────────────────────────────────────────────────────────────────────────────

export type ClassifiedCase<C extends string> = {
  expected: C;
  actual: C;
  /** Confidence the classifier assigns to `actual`, in [0, 1]. */
  confidence?: number;
};

export type ClassMetrics = {
  /** Cases whose expected class is this one. */
  support: number;
  /** Cases where the classifier chose this class. */
  predicted: number;
  /** Cases of this class the classifier got right. */
  hits: number;
  /** hits / predicted; 0 if nobody chose the class (see `noPredictions`). */
  precision: number;
  /** Recall: hits / support; 0 if there are no cases of the class (see `noSupport`). */
  recall: number;
  /** Harmonic mean of precision and recall; 0 if both are 0. */
  f1: number;
  /** Nobody chose the class: precision is 0 by convention, not because it got it wrong. */
  noPredictions: boolean;
  /** There are no expected cases of the class: recall is 0 by convention. */
  noSupport: boolean;
};

export type CurvePoint = {
  threshold: number;
  /** Cases with confidence ≥ threshold: the ones the cascade would apply without review. */
  cases: number;
  /** Curve coverage: cases / total. */
  proportion: number;
  hits: number;
  /** Accuracy over those cases; null if none remain. */
  accuracy: number | null;
};

export type EvaluationResult<C extends string> = {
  total: number;
  hits: number;
  accuracy: number;
  byClass: Record<C, ClassMetrics>;
  /**
   * Unweighted mean over the classes that appear as expected or actual. A class that
   * is neither expected nor predicted says nothing about the classifier and is left out.
   */
  macro: { classes: C[]; precision: number; recall: number; f1: number };
  /** `matrix[expected][actual]` = number of cases. */
  matrix: Record<C, Record<C, number>>;
  /** Coverage–precision curve by confidence threshold; null if the cases don't carry confidence. */
  curve: CurvePoint[] | null;
};

/** Includes the `DEFAULT_THRESHOLDS` thresholds (0.55 and 0.8) to see how the current cascade performs. */
export const DEFAULT_CURVE_THRESHOLDS: readonly number[] = [0, 0.5, 0.55, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

function quotient(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function average(values: readonly number[]): number {
  return quotient(
    values.reduce((s, v) => s + v, 0),
    values.length,
  );
}

function isProbability(x: number): boolean {
  return Number.isFinite(x) && x >= 0 && x <= 1;
}

export function evaluateClassification<C extends string>(input: {
  classes: readonly C[];
  cases: readonly ClassifiedCase<C>[];
  /** Curve thresholds; sorted and de-duplicated. Defaults to `DEFAULT_CURVE_THRESHOLDS`. */
  thresholds?: readonly number[];
}): EvaluationResult<C> {
  const { classes, cases } = input;
  if (classes.length === 0) throw new Error('At least one class is required.');
  if (new Set(classes).size !== classes.length) throw new Error('Classes cannot repeat.');
  if (cases.length === 0) throw new Error('There are no cases to evaluate.');

  const thresholds = [...new Set(input.thresholds ?? DEFAULT_CURVE_THRESHOLDS)].toSorted((a, b) => a - b);
  for (const u of thresholds) {
    if (!isProbability(u)) throw new Error(`Threshold ${u} is not between 0 and 1.`);
  }

  // Count matrix by class position: counts[expected][actual].
  const position = new Map<string, number>(classes.map((c, i) => [c, i]));
  const counts = classes.map(() => classes.map(() => 0));
  let withConfidence = 0;
  for (const [i, sample] of cases.entries()) {
    const e = position.get(sample.expected);
    const o = position.get(sample.actual);
    if (e === undefined) throw new Error(`Case ${i + 1} uses an unknown class: "${sample.expected}".`);
    if (o === undefined) throw new Error(`Case ${i + 1} uses an unknown class: "${sample.actual}".`);
    if (sample.confidence !== undefined) {
      if (!isProbability(sample.confidence)) throw new Error(`Case ${i + 1}'s confidence is not between 0 and 1.`);
      withConfidence += 1;
    }
    const row = counts[e];
    if (row) row[o] = (row[o] ?? 0) + 1;
  }
  if (withConfidence > 0 && withConfidence < cases.length) {
    throw new Error(`Missing confidence values: ${cases.length - withConfidence} of ${cases.length} cases don't have one.`);
  }

  const cell = (e: number, o: number): number => counts[e]?.[o] ?? 0;
  const byClass = {} as Record<C, ClassMetrics>;
  const matrix = {} as Record<C, Record<C, number>>;
  let hits = 0;
  for (const [e, kind] of classes.entries()) {
    const correct = cell(e, e);
    const support = classes.reduce((s, _, o) => s + cell(e, o), 0);
    const predicted = classes.reduce((s, _, f) => s + cell(f, e), 0);
    const precision = quotient(correct, predicted);
    const recall = quotient(correct, support);
    byClass[kind] = {
      support,
      predicted,
      hits: correct,
      precision,
      recall,
      f1: quotient(2 * precision * recall, precision + recall),
      noPredictions: predicted === 0,
      noSupport: support === 0,
    };
    matrix[kind] = Object.fromEntries(classes.map((o, j) => [o, cell(e, j)])) as Record<C, number>;
    hits += correct;
  }

  const present = classes.filter((c) => !(byClass[c].noSupport && byClass[c].noPredictions));
  const macro = {
    classes: present,
    precision: average(present.map((c) => byClass[c].precision)),
    recall: average(present.map((c) => byClass[c].recall)),
    f1: average(present.map((c) => byClass[c].f1)),
  };

  const curve =
    withConfidence === 0
      ? null
      : thresholds.map((threshold): CurvePoint => {
          const covered = cases.filter((c) => (c.confidence ?? 0) >= threshold);
          const correct = covered.filter((c) => c.expected === c.actual).length;
          return {
            threshold,
            cases: covered.length,
            proportion: covered.length / cases.length,
            hits: correct,
            accuracy: covered.length === 0 ? null : correct / covered.length,
          };
        });

  return { total: cases.length, hits, accuracy: hits / cases.length, byClass, macro, matrix, curve };
}

// ─── Cases in JSONL ──────────────────────────────────────────────────────────────────────────────

/**
 * Reads a JSONL (one case per line; blank lines are ignored) and validates each case with `schema`.
 * If any line fails, throws a single error with all the lines and their reasons.
 */
export function loadJsonlCases<E extends z.ZodType>(text: string, schema: E): z.output<E>[] {
  const cases: z.output<E>[] = [];
  const errors: string[] = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (e) {
      errors.push(`line ${i + 1}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const r = schema.safeParse(value);
    if (r.success) cases.push(r.data);
    else {
      for (const p of r.error.issues) {
        errors.push(`line ${i + 1}: ${p.path.map(String).join('.') || '(root)'}: ${p.message}`);
      }
    }
  }
  if (errors.length > 0) throw new Error(`The JSONL doesn't match the format:\n${errors.join('\n')}`);
  return cases;
}

// ─── Format of the classifier's evaluation sets (evals/classifier/v1) ─────────────

export const EVAL_PARTITIONS = ['dev', 'test'] as const;
export type EvalPartition = (typeof EVAL_PARTITIONS)[number];

/** Artifact types with authority that trigger "Update knowledge". */
export const EVAL_CHANGE_TYPES = ['decision', 'fdr', 'adr', 'criterion'] as const;
/** Knowledge node types that can be candidates. */
export const EVAL_NODE_TYPES = ['decision', 'fdr', 'adr', 'criterion', 'idea', 'source'] as const;

/** Optional difficulty labels, to measure hard cases separately (ablations). */
export const EVAL_CASE_LABELS = ['injection', 'shared_words', 'implicit_supersession', 'negation', 'synonyms'] as const;

/** `CODE@version`, e.g. `DEC-USU-002@2` or `AC-CUO-002-01@1`. */
const RE_REF = /^[A-Z]+(?:-[A-Z0-9]+)+@[1-9][0-9]*$/;
const nonEmptyText = z.string().regex(/\S/, 'Cannot be empty.');

function artifactSchema<const T extends readonly [string, ...string[]]>(types: T) {
  return z
    .object({
      ref: z.string().regex(RE_REF, 'Must have the form CODE@version.'),
      type: z.enum(types),
      title: nonEmptyText,
      text: nonEmptyText,
    })
    .strict();
}

const common = {
  partition: z.enum(EVAL_PARTITIONS),
  note: nonEmptyText,
  labels: z.array(z.enum(EVAL_CASE_LABELS)).min(1).optional(),
};

/** Case from `verdicts.jsonl`: expected verdict for the (change, candidate) pair. */
export const verdictCaseSchema = z
  .object({
    id: z.string().regex(/^V[0-9]{3,}$/),
    partition: common.partition,
    change: artifactSchema(EVAL_CHANGE_TYPES),
    candidate: artifactSchema(EVAL_NODE_TYPES),
    expected: z.enum(VERDICTS),
    note: common.note,
    labels: common.labels,
  })
  .strict();
export type VerdictCase = z.infer<typeof verdictCaseSchema>;

/** Case from `ideas.jsonl`: expected finding for the (idea, node) pair. */
export const ideaCaseSchema = z
  .object({
    id: z.string().regex(/^I[0-9]{3,}$/),
    partition: common.partition,
    idea: z.object({ text: nonEmptyText }).strict(),
    node: artifactSchema(EVAL_NODE_TYPES),
    expected: z.enum(IDEA_FINDINGS),
    note: common.note,
    labels: common.labels,
  })
  .strict();
export type IdeaCase = z.infer<typeof ideaCaseSchema>;
