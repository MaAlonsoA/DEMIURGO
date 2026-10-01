// Registry of the post-mortem rules. A rule is a pure function of the stored inputs of one ended build request:
// it reads, it never writes and it never calls a model. Adding a rule is one import and one entry in `RULES`.
// A change to any rule (or to a threshold) must bump `RULES_VERSION`, so old post-mortems are kept and two versions
// can be compared over the same builds (salud-del-harness §7.3).

import type { PostmortemInputs } from '../postmortem.ts';
import { reviewCost, reviewEscape, reviewFindingOutcome, reviewRepeat, reviewWaiver } from './review.ts';
import { filesPrediction } from './files.ts';
import { queueParallelConflict, queueSkipVsFootprint, queueSlotIdle } from './queue.ts';
import { schemaPrediction } from './schema.ts';
import { requestShape } from './shape.ts';
import { tddGate, tddLoopCost, tddSkipped } from './tdd.ts';

export const FINDING_CLASSES = ['tp', 'fp', 'fn', 'tn', 'benefit', 'cost', 'info'] as const;
export type FindingClass = (typeof FINDING_CLASSES)[number];
export const FINDING_UNITS = ['min', 'ci_runs', 'tokens', 'usd', 'person_actions', 'files', 'tests', 'loops', 'attempts'] as const;
export type FindingUnit = (typeof FINDING_UNITS)[number];

/** One classified fact: what a piece of the harness decided, what really happened, or what it cost. */
export type Finding = {
  /** B01…B27 (building) or D01…D11 (design): the piece of the harness (design doc §2). */
  piece: string;
  /** Stable code of the rule, for example `queue.skip_vs_footprint`. */
  finding: string;
  class: FindingClass;
  /** The later fact that decides it: G01…G14 (design doc §1.1). */
  ground_truth?: string | null;
  value?: number | null;
  unit?: FindingUnit | null;
  /** File, test, criterion or task the finding is about. */
  subject?: string | null;
  /** The attempt it belongs to; omitted for the whole request. */
  attempt?: number | null;
  /** Ids of the rows that prove it (build_steps.id, pr_reviews.id + comment_index, test_runs.id…). */
  evidence: unknown;
};

export type Rule = (inputs: PostmortemInputs) => Finding[];

export const RULES_VERSION = 'pm-2';

/** Rules 1.3 (queue, schema, files) and 1.4 (tdd, review) are added here, each from its own file. */
export const RULES: readonly Rule[] = [requestShape, queueSkipVsFootprint, queueParallelConflict, queueSlotIdle, schemaPrediction, filesPrediction, tddGate, tddSkipped, tddLoopCost, reviewFindingOutcome, reviewRepeat, reviewEscape, reviewWaiver, reviewCost];
