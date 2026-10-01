// Jev learns why pull requests bounce: each comment of a stored review is put in one category (Choice) and
// asked whether a standing instruction to the builder would have avoided it (Noul). One System One request
// per review (speculative fan-out, https://docs.typesafe.ai/patterns/fan-out): every comment shares the
// review's state, so all questions go together. Measured on 22 real comments (01-10-2026): 7 manual or
// production evidence, 5 tests that do not exercise the criterion, 3 defects, 3 CI, 2 nits; 7 of 22
// avoidable with an instruction. Practice: Google measures the «effective false positive» rate of review
// findings and retires what developers reject (Sadowski et al., CACM 2018); Reflexion keeps verbal lessons of
// failures for the next attempt (Shinn et al., 2023). Derived data: Delivery counts the categories and the
// person decides which recurring one becomes an instruction. After the commit; never throws; without
// TYPESAFE_API_KEY it does nothing.

import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk';
import type { Db } from '../db/connection.ts';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';

type Client = Pick<TypeSafeClient, 'systemOne'>;

export const REVIEW_CATEGORIES = ['manual_evidence', 'test_gap', 'defect', 'ci_failure', 'nit', 'environment_doc', 'conflict_markers', 'other'] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];
export const isReviewCategory = (v: unknown): v is ReviewCategory => typeof v === 'string' && (REVIEW_CATEGORIES as readonly string[]).includes(v);

/** From this probability a comment counts as avoidable with an instruction (convención nuestra). */
export const AVOIDABLE_THRESHOLD = 0.5;
/** Window of «Why pull requests bounce», in days (convención nuestra). */
export const BOUNCE_WINDOW_DAYS = 30;
const MAX_COMMENTS = 40;
const MAX_BODY = 1200;

export type ReviewComment = { path: string; line: number | null; severity: string; body: string };
export type ReviewCriterion = { code: string; covered?: boolean; note?: string };
export type ReviewFinding = { category: ReviewCategory; p: number; avoidable_p: number; input_hash: string };

const CATEGORY_HELP: Record<ReviewCategory, { what: string; examples?: string[] }> = {
  manual_evidence: {
    what: 'The reviewer asks for evidence that a diff cannot hold: a manual audit, a production or device measurement, or a result that is pending.',
    examples: ['VoiceOver audit has no result', 'RESULTS_PENDING is committed', 'Cold start on Vercel is not measured'],
  },
  test_gap: {
    what: 'A test does not exercise the criterion it claims: skipped or fixme, missing the Given, When or Then, or checks a stand-in.',
    examples: ['The test never logs the 400 kcal workout', 'test.fixme leaves the criterion uncovered'],
  },
  defect: {
    what: 'A real defect in the production code: wrong behaviour, a security gap, a race, a broken state.',
    examples: ['The cookie has no Secure flag', 'Refresh after the timeout drops the entry'],
  },
  ci_failure: { what: 'A required check is red and the comment asks to fix it.', examples: ['AC-MEA-003-13 fails in CI'] },
  nit: { what: 'A small style, wording or documentation remark that does not block.', examples: ['README typo'] },
  environment_doc: { what: 'Environment setup, configuration or documentation is missing or wrong.', examples: ['DATABASE_URL is not in the README'] },
  conflict_markers: { what: 'Merge conflict markers were left in a file.', examples: ['<<<<<<< in a spec'] },
  other: { what: 'None of the other categories fits.' },
};

/** The request of a review: the shared state and, per comment, `c<i>_kind` (Choice) and `c<i>_avoid` (Noul). Pure. */
export function buildFindingsRequest(comments: readonly ReviewComment[], criteria: readonly ReviewCriterion[] = []) {
  const list = comments.slice(0, MAX_COMMENTS);
  const state = {
    comments: list.map((c) => ({ path: c.path, line: c.line, severity: c.severity, body: c.body.slice(0, MAX_BODY) })),
    task_criteria: criteria.map((c) => ({ code: c.code, covered: c.covered ?? null, note: (c.note ?? '').slice(0, 300) })),
  };
  const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
  list.forEach((_, i) => {
    questions[`c${i}_kind`] = choice(`What kind of finding is \`comments[${i}]\`, a pull request reviewer's comment on a builder agent's work?`, CATEGORY_HELP);
    questions[`c${i}_avoid`] = noul(
      `Would a standing instruction to the builder, written once as a project convention and not specific to this change, have avoided \`comments[${i}]\`?`,
      {
        true: 'The comment repeats a generic habit a one-line instruction can fix (such as «a test performs the criterion\'s Given, When and Then» or «record the evidence before asking for review»).',
        false: 'The comment is about this specific change: a particular bug, a missing piece or a one-off decision.',
      },
    );
  });
  return { state, questions, comments: list };
}

const hashOf = (state: unknown, i: number, model: string): string => createHash('sha256').update(JSON.stringify({ state, i, model })).digest('hex');

/** Parses Jev's answers into one finding per comment; comments without a valid answer are left out. Pure. */
export function parseFindings(answers: Record<string, unknown>, state: unknown, count: number, model: string): (ReviewFinding & { index: number })[] {
  const out: (ReviewFinding & { index: number })[] = [];
  for (let i = 0; i < count; i++) {
    const k = answers[`c${i}_kind`] as { choice?: unknown; probabilities?: Record<string, number> } | undefined;
    const a = answers[`c${i}_avoid`] as { noul?: unknown } | undefined;
    if (!k || !isReviewCategory(k.choice) || typeof a?.noul !== 'number' || Number.isNaN(a.noul)) continue;
    const p = k.probabilities?.[k.choice];
    out.push({
      index: i,
      category: k.choice,
      p: typeof p === 'number' && !Number.isNaN(p) ? p : 1,
      avoidable_p: Math.min(1, Math.max(0, a.noul)),
      input_hash: hashOf(state, i, model),
    });
  }
  return out;
}

export async function judgeReviewFindings(
  client: Client,
  comments: readonly ReviewComment[],
  criteria: readonly ReviewCriterion[] = [],
  model: string = JEV_DEFAULT_MODEL,
  onUsage?: (inputTokens: number) => void,
): Promise<(ReviewFinding & { index: number })[]> {
  if (comments.length === 0) return [];
  const { state, questions, comments: list } = buildFindingsRequest(comments, criteria);
  const r = await client.systemOne({ state: state as never, questions, model });
  onUsage?.(r.usage.input_tokens);
  return parseFindings(r.answers as Record<string, unknown>, state, list.length, r.model || model);
}

const asComments = (v: unknown): ReviewComment[] =>
  (Array.isArray(v) ? v : []).filter((c): c is ReviewComment => !!c && typeof c === 'object' && typeof (c as ReviewComment).body === 'string');
const asCriteria = (v: unknown): ReviewCriterion[] =>
  (Array.isArray(v) ? v : []).filter((c): c is ReviewCriterion => !!c && typeof c === 'object' && typeof (c as ReviewCriterion).code === 'string');

export type FindingsDeps = { client?: Client };

/** Classifies the comments of a stored review and stores Jev's opinion. After the commit; never throws. */
export async function classifyReviewFindings(services: Pick<Services, 'db' | 'logger'>, projectId: string, prReviewId: string, deps: FindingsDeps = {}): Promise<number> {
  if (!deps.client && !jevAllowed()) return 0;
  try {
    const review = await services.db.selectFrom('pr_reviews').select(['comments', 'criteria']).where('id', '=', prReviewId).where('project_id', '=', projectId).executeTakeFirst();
    if (!review) return 0;
    const comments = asComments(review.comments);
    if (comments.length === 0) return 0;
    let tokens = 0;
    const model = JEV_DEFAULT_MODEL;
    const client = deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const findings = await judgeReviewFindings(client, comments, asCriteria(review.criteria), model, (n) => (tokens += n));
    if (findings.length > 0) {
      await services.db
        .insertInto('review_finding_kinds')
        .values(
          findings.map((f) => ({
            project_id: projectId,
            pr_review_id: prReviewId,
            comment_index: f.index,
            category: f.category,
            p: f.p,
            avoidable_p: f.avoidable_p,
            classifier_id: `jev@${model}`,
            input_hash: f.input_hash,
          })),
        )
        .execute();
    }
    services.logger.info('Jev classified the comments of a review', { projectId, prReviewId, comments: findings.length, input_tokens: tokens, usd: jevCostUsd(tokens) });
    return findings.length;
  } catch (err) {
    services.logger.error('Jev could not classify the comments of a review', { prReviewId, error: String(err) });
    return 0;
  }
}

export type BounceRow = { pr_review_id: string; comment_index: number; category: string; avoidable_p: number; created_at: Date | string; path: string; body: string };
export type Bounce = { category: string; count: number; avoidable: number; example: { body: string; path: string } };

/** Counts per category (the latest opinion of each comment), avoidable ones and the latest example, most frequent first. Pure. */
export function aggregateBounces(rows: readonly BounceRow[]): Bounce[] {
  const t = (r: BounceRow) => new Date(r.created_at).getTime();
  const latest = new Map<string, BounceRow>();
  for (const r of rows) {
    const key = `${r.pr_review_id}:${r.comment_index}`;
    const cur = latest.get(key);
    if (!cur || t(r) >= t(cur)) latest.set(key, r);
  }
  const groups = new Map<string, BounceRow[]>();
  for (const r of latest.values()) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);
  return [...groups.entries()]
    .map(([category, list]) => {
      const last = list.reduce((a, b) => (t(b) > t(a) ? b : a));
      return {
        category,
        count: list.length,
        avoidable: list.filter((r) => r.avoidable_p >= AVOIDABLE_THRESHOLD).length,
        example: { body: last.body, path: last.path },
      };
    })
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));
}

/** Why pull requests bounce: the opinions of the last `BOUNCE_WINDOW_DAYS` days, aggregated. */
export async function bounceReasonsOf(db: Db, projectId: string, now: Date = new Date()): Promise<Bounce[]> {
  const since = new Date(now.getTime() - BOUNCE_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .selectFrom('review_finding_kinds as k')
    .innerJoin('pr_reviews as r', 'r.id', 'k.pr_review_id')
    .select(['k.pr_review_id', 'k.comment_index', 'k.category', 'k.avoidable_p', 'k.created_at', 'r.comments'])
    .where('k.project_id', '=', projectId)
    .where(sql<boolean>`r.created_at >= ${since}`)
    .execute();
  return aggregateBounces(
    rows.map((r) => {
      const c = asComments(r.comments)[r.comment_index];
      return { pr_review_id: r.pr_review_id, comment_index: r.comment_index, category: r.category, avoidable_p: r.avoidable_p, created_at: String(r.created_at), path: c?.path ?? '', body: c?.body ?? '' };
    }),
  );
}
