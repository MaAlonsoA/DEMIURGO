// `Classifier` port (System One, plan §7.5). Three typed, calibrated primitives:
// Choice (an option from a closed set), Score (a level on an ordered rubric) and Noul
// (the probability that a statement is true). It never drafts text or decides progress.

export type ClassifierState = string | Readonly<Record<string, unknown>>;

export type ItemChoice = {
  id: string;
  /** Small, relevant state: only the pair being evaluated. */
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
  /** If confidence was medium and another classifier reviewed it (the cascade), its id. */
  reviewedBy?: string;
};

export type ItemScore = { id: string; state: ClassifierState; question: string; levels: readonly string[] };
export type ScoreResponse = { id: string; level: number; distribution: readonly number[]; confidence: number };

export type ItemNoul = { id: string; state: ClassifierState; statement: string };
export type NoulResponse = { id: string; probability: number; confidence: number };

export interface Classifier {
  /** name@version: stored with every classification and part of the `input_hash`. */
  readonly id: string;
  choice(items: readonly ItemChoice[]): Promise<ChoiceResponse[]>;
  score(items: readonly ItemScore[]): Promise<ScoreResponse[]>;
  noul(items: readonly ItemNoul[]): Promise<NoulResponse[]>;
}

export type Thresholds = { high: number; medium: number };

export const DEFAULT_THRESHOLDS: Thresholds = { high: 0.8, medium: 0.55 };

export type Path = 'apply' | 'review_llm' | 'pending_person';

/** Confidence cascade: high → applied; medium → reviewed by an LLM; low → a person. */
export function routeByConfidence(confidence: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): Path {
  if (confidence >= thresholds.high) return 'apply';
  if (confidence >= thresholds.medium) return 'review_llm';
  return 'pending_person';
}

// Closed vocabularies for the use cases in §7.5.
export const VERDICTS = ['keep', 'update', 'invalidate', 'add', 'relate', 'other'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const IDEA_FINDINGS = ['relates', 'conflicts', 'inconsistent', 'duplicates', 'none'] as const;
export type IdeaFinding = (typeof IDEA_FINDINGS)[number];

export const RELEVANCE_LEVELS = ['irrelevant', 'somewhat relevant', 'relevant', 'very relevant'] as const;

/** Question of each verdict item: the same text in production and in the classifier evaluation. */
export const VERDICT_QUESTION =
  'With this change approved, what happens to the candidate: does it stay the same, is it related, does it need updating, is it invalidated, does something need to be added, or something else?';

/** Question of each idea item: the same text in production and in the classifier evaluation. */
export const IDEA_QUESTION =
  'What relation does the idea have to this knowledge: does it duplicate it, contradict it, is it incoherent, is it related, or none?';
