// Delivery states, always computed from what is recorded (evidence, build requests, covers) and never stored.

/** How far a criterion is: from nothing started to verified by a passing check. */
export const CRITERION_STATES = ['verified', 'failing', 'in_pr', 'no_evidence', 'check_by_hand', 'check_at_release', 'not_started'] as const;
export type CriterionState = (typeof CRITERION_STATES)[number];

/** Where a task is in its build: from open to merged. */
export const TASK_BUILD_STATES = ['to_do', 'requested', 'in_pr', 'merged', 'failing'] as const;
export type TaskBuildState = (typeof TASK_BUILD_STATES)[number];

/** Latest evidence result wins: fail shows failing; pass (or no result, the old default) is verified. */
export function criterionState(input: {
  verification: string;
  evidence: { result: 'pass' | 'fail' | null } | null;
  tasks: readonly TaskBuildState[];
}): CriterionState {
  if (input.evidence?.result === 'fail') return 'failing';
  if (input.evidence) return 'verified';
  if (input.tasks.some((t) => t === 'in_pr' || t === 'requested')) return 'in_pr';
  if (input.verification === 'manual') return 'check_by_hand';
  // A release criterion is checked automatically against the deployed candidate, after the merge.
  if (input.verification === 'release') return 'check_at_release';
  // Built but no passing test recorded yet.
  if (input.tasks.some((t) => t === 'merged')) return 'no_evidence';
  return 'not_started';
}

/** An open request (requested, in review) or a done one gives the state; a legacy implemented task is merged. */
export function taskBuildState(input: {
  request: { state: string } | null;
  implemented: boolean;
  coveredFailing: boolean;
}): TaskBuildState {
  const s = input.request?.state;
  let state: TaskBuildState = s === 'requested' ? 'requested' : s === 'in_review' ? 'in_pr' : s === 'done' || input.implemented ? 'merged' : 'to_do';
  if ((state === 'in_pr' || state === 'merged') && input.coveredFailing) state = 'failing';
  return state;
}

/**
 * Our Definition of Done for a feature (convention nuestra): every criterion verified, at least one
 * task and every task merged. The Scrum Guide 2020 makes a Definition of Done mandatory but lets each
 * team set its content.
 */
export function featureDone(input: {
  criteria: readonly { code: string; state: CriterionState }[];
  tasks: readonly { code: string; state: TaskBuildState }[];
  /** Criterion codes no task covers. */
  uncovered?: readonly string[];
}): { done: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const c of input.criteria) if (c.state !== 'verified') missing.push(`${c.code} is not verified yet`);
  if (input.tasks.length === 0) missing.push('It has no tasks');
  for (const code of input.uncovered ?? []) missing.push(`${code} is covered by no task`);
  for (const t of input.tasks) if (t.state !== 'merged') missing.push(`${t.code} is not merged`);
  return { done: missing.length === 0, missing };
}
