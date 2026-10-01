// «Insisting»: an attempt that goes round in circles. Two signals say so: the attempt ended with a commit that failed
// because the builder changed nothing, or the reviewer's blocking finding of this round is the one of the round before
// (same path, close text). Resuming the same session after either only repeats the conversation that led there, so the
// next automatic attempt starts a fresh session (session.ts); when that fresh session insists again, DEMIURGO stops and
// leaves it to the person.
// Source: Anthropic's companion repository to «Effective harnesses for long-running agents» says to exit when a cycle
// makes no changes. The 0.6 similarity and «two in a row» are our convention (the review.repeat rule of the harness
// post-mortem uses 0.4 plus other signals, to measure; this one acts, so it asks for more).
// When neither fires, Jev is asked (classifier/session-signals.ts): whether the blocking finding asks for the same
// change in other words, and whether the progress notes say the builder is stuck. They only add signals.

import { trigramSimilarity } from '../harness/rules/review.ts';
import { SESSION_SIGNAL_THRESHOLD, type SignalDeps, sameRequestNoul, stuckNoul } from '../classifier/session-signals.ts';
import type { Services } from '../services.ts';
import { accumulateProgress } from './progress.ts';

/** Trigram similarity from which two blocking comments on one path are the same finding (convención nuestra). */
export const SAME_FINDING_SIMILARITY = 0.6;

export type FindingComment = { path: string; severity: string; body: string };

export type InsistedSignal = 'changed_nothing' | 'repeated_finding' | 'jev_repeated_finding' | 'jev_stuck';

/** What Jev answered when it was asked (probabilities, to judge the signals afterwards). */
export type InsistedJev = { same_request_p?: number; stuck_p?: number };

/** The signal that fired (null: none) and what Jev said when it was asked. */
export type InsistedDecision = { signal: InsistedSignal | null; jev?: InsistedJev };

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

type ReviewRow = { verdict: string; comments: unknown };

/** The latest two reviews of the request, newest first. */
async function latestReviews(db: Services['db'], requestId: string): Promise<ReviewRow[]> {
  return db
    .selectFrom('pr_reviews')
    .select(['verdict', 'comments'])
    .where('build_request_id', '=', requestId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(2)
    .execute();
}

/** The comments of the two latest reviews when both asked for changes, or null. */
async function changeRequests(db: Services['db'], requestId: string): Promise<{ current: FindingComment[]; before: FindingComment[] } | null> {
  const [current, before] = await latestReviews(db, requestId);
  if (!current || !before || current.verdict !== 'request_changes' || before.verdict !== 'request_changes') return null;
  return { current: commentsOf(current.comments), before: commentsOf(before.comments) };
}

/** Whether the latest review of the request asked for changes with a blocking finding the one before it already made. */
export async function reviewerRepeated(db: Services['db'], requestId: string): Promise<boolean> {
  const both = await changeRequests(db, requestId);
  return both ? repeatsBlocking(both.before, both.current) : false;
}

const blockingBodies = (comments: readonly FindingComment[]): string[] => comments.filter((c) => c.severity === 'blocking').map((c) => c.body);

const projectOf = async (db: Services['db'], requestId: string): Promise<string | null> =>
  (await db.selectFrom('build_requests').select('project_id').where('id', '=', requestId).executeTakeFirst())?.project_id ?? null;

/** Jev's probability that the blocking comments of the latest review repeat the request of the one before (any path), or null. */
export async function reviewerRepeatedP(services: Services, requestId: string, deps: SignalDeps = {}): Promise<number | null> {
  try {
    const both = await changeRequests(services.db, requestId);
    const projectId = await projectOf(services.db, requestId);
    if (!both || !projectId) return null;
    return await sameRequestNoul(services, projectId, blockingBodies(both.before), blockingBodies(both.current), deps);
  } catch {
    return null;
  }
}

/** Whether the latest review repeats the earlier request: the deterministic test first, then Jev (p >= SESSION_SIGNAL_THRESHOLD). */
export async function reviewerRepeatedAny(services: Services, requestId: string, deps: SignalDeps = {}): Promise<boolean> {
  if (await reviewerRepeated(services.db, requestId)) return true;
  const p = await reviewerRepeatedP(services, requestId, deps);
  return p !== null && p >= SESSION_SIGNAL_THRESHOLD;
}

/** The progress notes the next session would read: the own notes of every earlier attempt, accumulated (progress.ts). */
async function progressBefore(db: Services['db'], requestId: string, attempt: number): Promise<string> {
  const rows = await db
    .selectFrom('build_steps')
    .select(['attempt', 'detail'])
    .where('build_request_id', '=', requestId)
    .where('attempt', '<', attempt)
    .where('stage', '=', 'builder')
    .where('outcome', 'in', ['ok', 'failed'])
    .orderBy('attempt')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const byAttempt = new Map<number, string>();
  for (const row of rows) {
    const text = (row.detail as { progress?: unknown } | null)?.progress;
    if (typeof text === 'string' && text.trim()) byAttempt.set(Number(row.attempt), text);
  }
  return accumulateProgress([...byAttempt].map(([n, text]) => ({ attempt: n, text })));
}

/**
 * What the attempts before `attempt` say about insisting. Deterministic signals first (a commit that changed nothing,
 * a repeated blocking finding on one path); when none fires, Jev: the same request in other words, then stuck progress
 * notes. A missing key or a Jev error leaves the decision as the deterministic one (no signal).
 */
export async function insistedSignalBefore(services: Services, requestId: string, attempt: number, deps: SignalDeps = {}): Promise<InsistedDecision> {
  if (attempt < 2) return { signal: null };
  const db = services.db;
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
  if (commit?.outcome === 'failed' && changedNothing(commit.detail)) return { signal: 'changed_nothing' };
  if (await reviewerRepeated(db, requestId)) return { signal: 'repeated_finding' };
  const jev: InsistedJev = {};
  const same = await reviewerRepeatedP(services, requestId, deps);
  if (same !== null) jev.same_request_p = same;
  if (same !== null && same >= SESSION_SIGNAL_THRESHOLD) return { signal: 'jev_repeated_finding', jev };
  const projectId = await projectOf(db, requestId).catch(() => null);
  const stuck = projectId ? await stuckNoul(services, projectId, await progressBefore(db, requestId, attempt).catch(() => ''), deps) : null;
  if (stuck !== null) jev.stuck_p = stuck;
  const asked = Object.keys(jev).length > 0 ? { jev } : {};
  return stuck !== null && stuck >= SESSION_SIGNAL_THRESHOLD ? { signal: 'jev_stuck', ...asked } : { signal: null, ...asked };
}

/** Whether the build must stop for the person: this attempt insisted again after one that already started fresh because of it. */
export const insistedTwice = (sessionReasonCode: string | undefined, signalNow: boolean): boolean => signalNow && sessionReasonCode === 'insisted';
