// "LGTM with comments" (Google eng-practices, "Speed of Code Reviews": the reviewer approves while leaving comments when
// the remaining suggestions are minor and trusts the author to address them, with no new review round). Here a `fix`
// comment is such a suggestion: the reviewer approves, the builder applies exactly the fixes in a cheap next attempt
// and that attempt does not ask for a new review. Pure decisions only; the orchestrator does the I/O.
// Waiving the new review only when the fix attempt touches files the fixes name is «convención nuestra».

export type LgtmComment = { path: string; severity: string };

/** The comments of the `fix` severity. */
export function fixCommentsOf<T extends { severity: string }>(comments: readonly T[]): T[] {
  return comments.filter((c) => c.severity === 'fix');
}

export const countFixes = (comments: readonly { severity: string }[]): number => fixCommentsOf(comments).length;

/** An approval with at least one fix: the attempt ends for the fixes instead of merging. */
export function approvedWithFixes(verdict: string, comments: readonly { severity: string }[]): boolean {
  return verdict === 'approve' && countFixes(comments) > 0;
}

const norm = (p: string): string => p.replace(/^\.\//, '').replace(/\\/g, '/');

/**
 * Whether the fix attempt may skip a new review: every file it changed (between the approved head and the new head)
 * is named by some fix comment. A fix comment on a directory-less path such as `tests` names nothing in particular, so it
 * allows only that exact path. No changed file waives (the builder changed nothing: nothing new to review).
 */
export function waiveReview(input: { fixPaths: readonly string[]; changedFiles: readonly string[] }): { waive: boolean; outside: string[] } {
  const allowed = new Set(input.fixPaths.map(norm));
  const outside = input.changedFiles.map(norm).filter((f) => !allowed.has(f));
  return { waive: outside.length === 0, outside };
}
