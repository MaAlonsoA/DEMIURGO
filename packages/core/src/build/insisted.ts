// «Insisting»: an attempt that goes round in circles. Two signals say so: the attempt ended with a commit that failed
// because the builder changed nothing, or the reviewer's blocking finding of this round is the one of the round before
// (same path, close text). Resuming the same session after either only repeats the conversation that led there, so the
// next automatic attempt starts a fresh session (session.ts); when that fresh session insists again, DEMIURGO stops and
// leaves it to the person.
// Source: Anthropic's companion repository to «Effective harnesses for long-running agents» says to exit when a cycle
// makes no changes. The 0.6 similarity and «two in a row» are our convention (the review.repeat rule of the harness
// post-mortem uses 0.4 plus other signals, to measure; this one acts, so it asks for more).

import { trigramSimilarity } from '../harness/rules/review.ts';
import type { Services } from '../services.ts';

/** Trigram similarity from which two blocking comments on one path are the same finding (convención nuestra). */
export const SAME_FINDING_SIMILARITY = 0.6;

export type FindingComment = { path: string; severity: string; body: string };

export type InsistedSignal = 'changed_nothing' | 'repeated_finding';

const CHANGED_NOTHING = /changed nothing/i;

const normal = (path: string): string => path.trim().replace(/^\.\//, '');

/** Whether a blocking comment of `current` is the same finding as one of `previous` (same path, similarity >= 0.6). */
export function repeatsBlocking(previous: readonly FindingComment[], current: readonly FindingComment[]): boolean {
  const before = previous.filter((c) => c.severity === 'blocking');
  return current.some((c) => c.severity === 'blocking' && before.some((p) => normal(p.path) === normal(c.path) && trigramSimilarity(p.body, c.body) >= SAME_FINDING_SIMILARITY));
}

const commentsOf = (raw: unknown): FindingComment[] =>
  (Array.isArray(raw) ? raw : [])
    .map((c) => (typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : {}))
    .filter((c) => typeof c.path === 'string' && typeof c.severity === 'string' && typeof c.body === 'string')
    .map((c) => ({ path: c.path as string, severity: c.severity as string, body: c.body as string }));

/** Whether the error of a failed commit step says the builder changed nothing. */
export const changedNothing = (detail: unknown): boolean => CHANGED_NOTHING.test(String((detail as { error?: unknown } | null | undefined)?.error ?? ''));

/** Whether the latest review of the request asked for changes with a blocking finding the one before it already made. */
export async function reviewerRepeated(db: Services['db'], requestId: string): Promise<boolean> {
  const rows = await db
    .selectFrom('pr_reviews')
    .select(['verdict', 'comments'])
    .where('build_request_id', '=', requestId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(2)
    .execute();
  const [current, before] = rows;
  if (!current || !before || current.verdict !== 'request_changes' || before.verdict !== 'request_changes') return false;
  return repeatsBlocking(commentsOf(before.comments), commentsOf(current.comments));
}

/** What the attempts before `attempt` say about insisting: a commit that changed nothing, or a repeated blocking finding. */
export async function insistedSignalBefore(db: Services['db'], requestId: string, attempt: number): Promise<InsistedSignal | null> {
  if (attempt < 2) return null;
  const commit = await db
    .selectFrom('build_steps')
    .select(['outcome', 'detail'])
    .where('build_request_id', '=', requestId)
    .where('attempt', '=', attempt - 1)
    .where('stage', '=', 'commit')
    .where('outcome', '<>', 'started')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (commit?.outcome === 'failed' && changedNothing(commit.detail)) return 'changed_nothing';
  return (await reviewerRepeated(db, requestId)) ? 'repeated_finding' : null;
}

/** Whether the build must stop for the person: this attempt insisted again after one that already started fresh because of it. */
export const insistedTwice = (sessionReasonCode: string | undefined, signalNow: boolean): boolean => signalNow && sessionReasonCode === 'insisted';
