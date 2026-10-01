// Reads the journal for the builder's earlier context (see `context.ts`). Read-only and best effort: any error gives
// no section. Called from inside the builder step, like `feedbackOf`.

import type { Services } from '../services.ts';
import {
  type ContextSection,
  type EarlierBuild,
  type ReviewRow,
  type SiblingComment,
  type StepRow,
  EARLIER_BUILDS_MAX,
  SIBLING_REVIEWS_MAX,
  attemptFacts,
  attemptHistoryLines,
  blockingLines,
  earlierBuildsLines,
  siblingReviewLines,
} from './context.ts';

type Db = Services['db'];

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function stepsOf(db: Db, requestIds: string[]): Promise<Map<string, StepRow[]>> {
  const out = new Map<string, StepRow[]>(requestIds.map((id) => [id, []]));
  if (requestIds.length === 0) return out;
  const rows = await db
    .selectFrom('build_steps')
    .select(['build_request_id', 'attempt', 'stage', 'outcome', 'detail'])
    .where('build_request_id', 'in', requestIds)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  for (const r of rows) out.get(r.build_request_id)?.push({ attempt: r.attempt, stage: r.stage, outcome: r.outcome, detail: r.detail });
  return out;
}

async function reviewsOf(db: Db, requestIds: string[]): Promise<Map<string, ReviewRow[]>> {
  const out = new Map<string, ReviewRow[]>(requestIds.map((id) => [id, []]));
  if (requestIds.length === 0) return out;
  const rows = await db
    .selectFrom('pr_reviews')
    .select(['build_request_id', 'run_id', 'verdict', 'comments'])
    .where('build_request_id', 'in', requestIds)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  for (const r of rows) out.get(r.build_request_id)?.push({ run_id: r.run_id, verdict: r.verdict, comments: r.comments });
  return out;
}

/** The lines of «Earlier attempts on this branch» for a fresh session after attempt 2. */
export async function attemptHistoryOf(db: Db, requestId: string, attempt: number, resumed: boolean): Promise<string[]> {
  if (resumed || attempt <= 2) return [];
  const steps = (await stepsOf(db, [requestId])).get(requestId) ?? [];
  const reviews = (await reviewsOf(db, [requestId])).get(requestId) ?? [];
  return attemptHistoryLines(attemptFacts(steps, reviews), attempt, resumed);
}

/** The previous build requests of the same task (any version), newest first. */
export async function earlierBuildsOf(db: Db, taskId: string, requestId: string): Promise<EarlierBuild[]> {
  const requests = await db
    .selectFrom('build_requests')
    .select(['id', 'task_version_id', 'state', 'pr_url', 'withdrawn_by'])
    .where('task_id', '=', taskId)
    .where('id', '<>', requestId)
    .orderBy('requested_at', 'desc')
    .orderBy('id', 'desc')
    .limit(EARLIER_BUILDS_MAX)
    .execute();
  if (requests.length === 0) return [];
  const ids = requests.map((r) => r.id);
  const steps = await stepsOf(db, ids);
  const reviews = await reviewsOf(db, ids);
  const versions = await db.selectFrom('record_versions').select(['id', 'n']).where('id', 'in', requests.map((r) => r.task_version_id)).execute();
  const n = new Map(versions.map((v) => [v.id, v.n]));
  return requests.map((r) => {
    const rows = steps.get(r.id) ?? [];
    const facts = attemptFacts(rows, reviews.get(r.id) ?? []);
    // The newest attempt that has something to say (the last one may have died before the review or CI).
    const blocking = [...facts].reverse().find((f) => f.blocking.length > 0)?.blocking ?? [];
    const ciTests = [...facts].reverse().find((f) => f.ciTests.length > 0)?.ciTests ?? [];
    const progress = [...facts].reverse().find((f) => f.progress)?.progress;
    const merged = [...rows].reverse().find((x) => x.stage === 'main' && typeof obj(x.detail).sha === 'string');
    const withdraw = [...rows].reverse().find((x) => x.stage === 'withdraw');
    const last = facts.at(-1)?.ended;
    const failed = [...rows].reverse().find((x) => x.outcome === 'failed' && typeof obj(x.detail).error === 'string');
    const why =
      r.state === 'withdrawn'
        ? ((typeof obj(withdraw?.detail).reason === 'string' ? (obj(withdraw?.detail).reason as string) : null) ?? `withdrawn by ${r.withdrawn_by ?? 'a person'}`)
        : r.state === 'done'
          ? null
          : last
            ? `it stopped at ${last.stage} ${last.outcome}${failed ? ` (${String(obj(failed.detail).error)})` : ''}`
            : null;
    return {
      taskVersion: n.get(r.task_version_id) ?? null,
      state: r.state,
      prUrl: r.pr_url,
      mergeCommit: merged ? String(obj(merged.detail).sha) : null,
      why,
      blocking,
      ciTests,
      ...(progress ? { progress } : {}),
    };
  });
}

/** Blocking comments raised on any attempt of merged build requests of the other tasks of the same feature. */
export async function siblingReviewsOf(db: Db, taskId: string): Promise<SiblingComment[]> {
  const mine = await db
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .innerJoin('records as fr', 'fr.id', 'tv.record_id')
    .select('fr.id')
    .where('fv.record_id', '=', taskId)
    .where('links.type', '=', 'based_on')
    .where('fr.type', '=', 'fdr')
    .orderBy('fv.n', 'desc')
    .executeTakeFirst();
  if (!mine) return [];
  const siblings = await db
    .selectFrom('links')
    .innerJoin('record_versions as fv', 'fv.id', 'links.from_id')
    .innerJoin('records as tr', 'tr.id', 'fv.record_id')
    .innerJoin('record_versions as tv', 'tv.id', 'links.to_id')
    .select(['tr.id', 'tr.code'])
    .distinct()
    .where('tv.record_id', '=', mine.id)
    .where('links.type', '=', 'based_on')
    .where('tr.type', '=', 'task')
    .where('tr.id', '<>', taskId)
    .execute();
  if (siblings.length === 0) return [];
  const codes = new Map(siblings.map((s) => [s.id, s.code]));
  const merged = await db
    .selectFrom('build_requests')
    .select(['id', 'task_id'])
    .where('task_id', 'in', siblings.map((s) => s.id))
    .where('state', '=', 'done')
    .orderBy('done_at', 'desc')
    .orderBy('id', 'desc')
    .limit(SIBLING_REVIEWS_MAX * 2)
    .execute();
  if (merged.length === 0) return [];
  const rows = await db
    .selectFrom('pr_reviews')
    .select(['build_request_id', 'comments'])
    .where('build_request_id', 'in', merged.map((m) => m.id))
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const order = new Map(merged.map((m, i) => [m.id, i]));
  const taskOf = new Map(merged.map((m) => [m.id, m.task_id]));
  rows.sort((a, b) => (order.get(a.build_request_id) ?? 0) - (order.get(b.build_request_id) ?? 0));
  const out: SiblingComment[] = [];
  for (const r of rows) for (const line of blockingLines(r.comments)) out.push({ task: codes.get(taskOf.get(r.build_request_id) ?? '') ?? '?', line });
  return out;
}

export type BuilderContext = { history: string[]; fresh: string[]; sections: ContextSection[] };

/**
 * All the earlier context of one attempt. `history` goes in the feedback block (a fresh session after attempt 2);
 * `fresh` (earlier builds, sibling reviews) goes after the brief of a fresh session only: a resumed one has had
 * them in its own conversation. Best effort: a failing read leaves its section out.
 */
export async function builderContextOf(db: Db, input: { requestId: string; taskId: string; attempt: number; resumed: boolean }): Promise<BuilderContext> {
  const sections: ContextSection[] = [];
  const history = await attemptHistoryOf(db, input.requestId, input.attempt, input.resumed).catch(() => []);
  if (history.length > 0) sections.push('attempt_history');
  const fresh: string[] = [];
  if (!input.resumed) {
    const earlier = earlierBuildsLines(await earlierBuildsOf(db, input.taskId, input.requestId).catch(() => []));
    if (earlier.length > 0) {
      fresh.push(...earlier);
      sections.push('earlier_builds');
    }
    const sibling = siblingReviewLines(await siblingReviewsOf(db, input.taskId).catch(() => []));
    if (sibling.length > 0) {
      if (fresh.length > 0) fresh.push('');
      fresh.push(...sibling);
      sections.push('sibling_reviews');
    }
  }
  return { history, fresh, sections };
}
