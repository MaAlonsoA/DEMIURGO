// Puerto `Classifier` (System One, §7.5 del plan). Tres primitivas tipadas y calibradas:
// Choice (opción de un conjunto cerrado), Score (nivel de una rúbrica ordenada) y Noul
// (probabilidad de que un enunciado sea verdadero). Nunca redacta texto ni decide avances.

export type ClassifierState = string | Readonly<Record<string, unknown>>;

export type ItemChoice = {
  id: string;
  /** Estado pequeño y relevante: solo el par que se evalúa. */
  state: ClassifierState;
  question: string;
  options: readonly string[];
};

export type ChoiceResponse = {
  id: string;
  choice: string;
  distribution: Readonly<Record<string, number>>;
  confidence: number;
  justification: string;
  /** Si la confianza era media y la revisó otro clasificador (la cascada), su id. */
  reviewedBy?: string;
};

export type ItemScore = { id: string; state: ClassifierState; question: string; levels: readonly string[] };
export type ScoreResponse = { id: string; level: number; distribution: readonly number[]; confidence: number };

export type ItemNoul = { id: string; state: ClassifierState; statement: string };
export type NoulResponse = { id: string; probability: number; confidence: number };

export interface Classifier {
  /** nombre@versión: se guarda con cada clasificación y forma parte del `input_hash`. */
  readonly id: string;
  choice(items: readonly ItemChoice[]): Promise<ChoiceResponse[]>;
  score(items: readonly ItemScore[]): Promise<ScoreResponse[]>;
  noul(items: readonly ItemNoul[]): Promise<NoulResponse[]>;
}

export type Thresholds = { validFrom: number; average: number };

export const DEFAULT_THRESHOLDS: Thresholds = { validFrom: 0.8, average: 0.55 };

export type Path = 'apply' | 'review_llm' | 'pending_person';

/** Cascada por confianza: alta → se aplica; media → la revisa un LLM; baja → la persona. */
export function routeByConfidence(confidence: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): Path {
  if (confidence >= thresholds.validFrom) return 'apply';
  if (confidence >= thresholds.average) return 'review_llm';
  return 'pending_person';
}

// Vocabularios cerrados de los usos de §7.5.
export const VERDICTS = ['keep', 'update', 'invalidate', 'add', 'relate', 'other'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const IDEA_FINDINGS = ['relates', 'conflicts', 'inconsistent', 'duplicates', 'none'] as const;
export type IdeaFinding = (typeof IDEA_FINDINGS)[number];

export const RELEVANCE_LEVELS = ['irrelevant', 'poco relevante', 'relevant', 'muy relevante'] as const;
