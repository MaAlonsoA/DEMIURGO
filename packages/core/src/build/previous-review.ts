// Incremental re-review: when an earlier review of the same build request asked for changes, the next reviewer
// gets that review and only what changed since it (Software Engineering at Google, ch. 19 "Critique": reviewers
// compare snapshots between review rounds). Pure shaping helpers plus one thin lookup.

import { sql } from 'kysely';
import type { Services } from '../services.ts';

export const PREVIOUS_REVIEW_CHANGES_MAX = 150_000;

export type PreviousReview = {
  summary: string;
  comments: { path: string; line: number | null; severity: string; body: string }[];
  head_sha: string;
};

/** Shapes a stored review row into the pack input; null when the head is unknown or is the current head. */
export function shapePreviousReview(row: { summary: string; comments: unknown }, sha: string | null, currentHeadSha: string): PreviousReview | null {
  if (!sha || sha === currentHeadSha) return null;
  const list = Array.isArray(row.comments) ? row.comments : [];
  const comments = list
    .map((c) => (typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : {}))
    .filter((c) => typeof c.path === 'string' && typeof c.severity === 'string' && typeof c.body === 'string')
    .map((c) => ({ path: c.path as string, line: typeof c.line === 'number' ? c.line : null, severity: c.severity as string, body: c.body as string }));
  return { summary: row.summary, comments, head_sha: sha };
}

/** Truncates a diff to the budget with a note saying how much was left out. */
export function truncateChanges(diff: string, max: number = PREVIOUS_REVIEW_CHANGES_MAX): string {
  return diff.length > max ? `${diff.slice(0, max)}\n[truncated: ${diff.length - max} more characters not shown]` : diff;
}

/** Loosely validates the pack inputs; anything malformed is ignored. */
export function previousReviewInput(value: unknown): PreviousReview | null {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (typeof v.summary !== 'string' || typeof v.head_sha !== 'string' || v.head_sha.length === 0) return null;
  return shapePreviousReview({ summary: v.summary, comments: v.comments }, v.head_sha, '');
}

/**
 * The latest earlier review of the request that asked for changes, with the head it reviewed. pr_reviews has no sha:
 * it comes from the `review` step of the run (its attempt) and that attempt's ok `commit` step.
 */
export async function previousReviewOf(db: Services['db'], requestId: string, currentHeadSha: string): Promise<PreviousReview | null> {
  const row = await db
    .selectFrom('pr_reviews')
    .select(['summary', 'comments', 'run_id'])
    .where('build_request_id', '=', requestId)
    .where('verdict', '=', 'request_changes')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!row) return null;
  const review = await db
    .selectFrom('build_steps')
    .select('attempt')
    .where('build_request_id', '=', requestId)
    .where('stage', '=', 'review')
    .where(sql<boolean>`detail->>'run_id' = ${row.run_id}`)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (!review) return null;
  const commit = await db
    .selectFrom('build_steps')
    .select(sql<string | null>`detail->>'sha'`.as('sha'))
    .where('build_request_id', '=', requestId)
    .where('stage', '=', 'commit')
    .where('outcome', '=', 'ok')
    .where('attempt', '=', review.attempt)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return shapePreviousReview(row, commit?.sha ?? null, currentHeadSha);
}
