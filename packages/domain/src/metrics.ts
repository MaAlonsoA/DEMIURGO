// Métricas del conjunto de evaluación del clasificador (§7.9 del plan y §8 de la investigación de
// stack) y formato de sus casos. Todo es puro: recibe casos ya clasificados (o el texto de un JSONL)
// y devuelve números. Quién llama al clasificador y dónde se registran los resultados queda fuera.

import { z } from 'zod';
import { IDEA_FINDINGS, VERDICTS } from './classifier.ts';

// ─── Métricas ────────────────────────────────────────────────────────────────────────────────────

export type ClassifiedCase<C extends string> = {
  expected: C;
  actual: C;
  /** Confianza que el clasificador da a `obtenido`, en [0, 1]. */
  confidence?: number;
};

export type ClassMetrics = {
  /** Casos cuya clase esperada es esta. */
  support: number;
  /** Casos en los que el clasificador eligió esta clase. */
  predicted: number;
  /** Casos de esta clase que el clasificador acertó. */
  hits: number;
  /** aciertos / predichos; 0 si nadie eligió la clase (ver `sinPredicciones`). */
  precision: number;
  /** Recall: aciertos / soporte; 0 si no hay casos de la clase (ver `sinSoporte`). */
  recall: number;
  /** Media armónica de precisión y cobertura; 0 si las dos son 0. */
  f1: number;
  /** Nadie eligió la clase: la precisión vale 0 por convenio, no porque se equivocara. */
  noPredictions: boolean;
  /** No hay casos esperados de la clase: la cobertura vale 0 por convenio. */
  noSupport: boolean;
};

export type CurvePoint = {
  threshold: number;
  /** Casos con confianza ≥ umbral: los que la cascada aplicaría sin revisión. */
  cases: number;
  /** Cobertura de la curva: casos / total. */
  proportion: number;
  hits: number;
  /** Exactitud sobre esos casos; null si no queda ninguno. */
  accuracy: number | null;
};

export type EvaluationResult<C extends string> = {
  total: number;
  hits: number;
  accuracy: number;
  byClass: Record<C, ClassMetrics>;
  /**
   * Media sin ponderar sobre las clases que aparecen como esperadas u obtenidas. Una clase que
   * ni se espera ni se predice no dice nada del clasificador y se deja fuera.
   */
  macro: { classes: C[]; precision: number; recall: number; f1: number };
  /** `matriz[esperado][obtenido]` = número de casos. */
  matrix: Record<C, Record<C, number>>;
  /** Curva cobertura–precisión por umbral de confianza; null si los casos no traen confianza. */
  curve: CurvePoint[] | null;
};

/** Incluye los umbrales de `UMBRALES_POR_DEFECTO` (0,55 y 0,8) para ver cómo rinde la cascada actual. */
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
  /** Umbrales de la curva; se ordenan y se quitan repetidos. Por defecto, `UMBRALES_CURVA_POR_DEFECTO`. */
  thresholds?: readonly number[];
}): EvaluationResult<C> {
  const { classes, cases } = input;
  if (classes.length === 0) throw new Error('Hace falta al menos una clase.');
  if (new Set(classes).size !== classes.length) throw new Error('Las clases no pueden repetirse.');
  if (cases.length === 0) throw new Error('No hay casos que evaluar.');

  const thresholds = [...new Set(input.thresholds ?? DEFAULT_CURVE_THRESHOLDS)].toSorted((a, b) => a - b);
  for (const u of thresholds) {
    if (!isProbability(u)) throw new Error(`El umbral ${u} no está entre 0 y 1.`);
  }

  // Matriz de conteos por posición de clase: cuenta[esperado][obtenido].
  const position = new Map<string, number>(classes.map((c, i) => [c, i]));
  const counts = classes.map(() => classes.map(() => 0));
  let withConfidence = 0;
  for (const [i, sample] of cases.entries()) {
    const e = position.get(sample.expected);
    const o = position.get(sample.actual);
    if (e === undefined) throw new Error(`El caso ${i + 1} usa una clase desconocida: «${sample.expected}».`);
    if (o === undefined) throw new Error(`El caso ${i + 1} usa una clase desconocida: «${sample.actual}».`);
    if (sample.confidence !== undefined) {
      if (!isProbability(sample.confidence)) throw new Error(`La confianza del caso ${i + 1} no está entre 0 y 1.`);
      withConfidence += 1;
    }
    const row = counts[e];
    if (row) row[o] = (row[o] ?? 0) + 1;
  }
  if (withConfidence > 0 && withConfidence < cases.length) {
    throw new Error(`Faltan confianzas: ${cases.length - withConfidence} de ${cases.length} casos no la traen.`);
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

// ─── Casos en JSONL ──────────────────────────────────────────────────────────────────────────────

/**
 * Lee un JSONL (un caso por línea; las líneas en blanco se ignoran) y valida cada caso con `esquema`.
 * Si alguna línea falla, lanza un único error con todas las líneas y sus motivos.
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
      errors.push(`línea ${i + 1}: JSON no válido (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const r = schema.safeParse(value);
    if (r.success) cases.push(r.data);
    else {
      for (const p of r.error.issues) {
        errors.push(`línea ${i + 1}: ${p.path.map(String).join('.') || '(raíz)'}: ${p.message}`);
      }
    }
  }
  if (errors.length > 0) throw new Error(`El JSONL no cumple el formato:\n${errors.join('\n')}`);
  return cases;
}

// ─── Formato de los conjuntos de evaluación del clasificador (evals/clasificador/v1) ─────────────

export const EVAL_PARTITIONS = ['dev', 'test'] as const;
export type EvalPartition = (typeof EVAL_PARTITIONS)[number];

/** Tipos de artefacto con autoridad que disparan «Actualizar conocimiento». */
export const EVAL_CHANGE_TYPES = ['decision', 'fdr', 'adr', 'criterion'] as const;
/** Tipos de nodo del conocimiento que pueden ser candidatos. */
export const EVAL_NODE_TYPES = ['decision', 'fdr', 'adr', 'criterion', 'idea', 'source'] as const;

/** Marcas opcionales de dificultad, para medir por separado los casos difíciles (ablaciones). */
export const EVAL_CASE_LABELS = [
  'injection',
  'shared_words',
  'implicit_supersession',
  'negation',
  'synonyms',
] as const;

/** `CODIGO@version`, por ejemplo `DEC-USU-002@2` o `AC-CUO-002-01@1`. */
const RE_REF = /^[A-Z]+(?:-[A-Z0-9]+)+@[1-9][0-9]*$/;
const nonEmptyText = z.string().regex(/\S/, 'No puede estar vacío.');

function artifactSchema<const T extends readonly [string, ...string[]]>(types: T) {
  return z
    .object({
      ref: z.string().regex(RE_REF, 'Debe tener la forma CODIGO@version.'),
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

/** Caso de `veredictos.jsonl`: veredicto esperado para el par (cambio, candidato). */
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

/** Caso de `ideas.jsonl`: hallazgo esperado para el par (idea, nodo). */
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
