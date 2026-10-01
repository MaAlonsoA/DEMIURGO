// The decision of the parallel gate: CI and the pull request review run at the same time, and the first
// rejection ends the attempt.
//
// Practice: presubmit tests and analyzers run when the change is sent for review and their results show
// beside the review, while the reviewers read (Winters, Manshreck and Wright, "Software Engineering at Google",
// ch. 19 "Critique": abseil.io/resources/swe-book/html/ch19.html); GitHub's pull request flow runs checks on
// open while reviewers review. The ordering below (review rejection cancels CI; a red CI still waits for the
// review already running, so the next attempt gets both findings) is «convención nuestra».

export type GateCi = 'pending' | 'green' | 'red';
/** `rejected`: the reviewer asked for changes. `failed`: its run ended without a verdict (or timed out). */
export type GateReview = 'pending' | 'approved' | 'rejected' | 'failed';
export type GateDecision = 'wait' | 'reject_review' | 'review_failed' | 'reject_ci' | 'pass';

export function decideGate(s: { ci: GateCi; review: GateReview }): GateDecision {
  // The review speaking first, against the change, ends the attempt without waiting for CI.
  if (s.review === 'rejected') return 'reject_review';
  if (s.review === 'failed') return 'review_failed';
  if (s.review === 'pending') return 'wait';
  // The review approved: CI decides.
  if (s.ci === 'pending') return 'wait';
  return s.ci === 'green' ? 'pass' : 'reject_ci';
}
