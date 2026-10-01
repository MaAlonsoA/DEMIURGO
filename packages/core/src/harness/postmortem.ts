// The deterministic post-mortem of an ended build request (salud-del-harness §7): it reads what the journal already
// stored and writes classified findings, append-only. No model call. Blameless in the sense of the Google SRE book
// («Postmortem Culture»): it records what each piece decided and cost, not whose fault it was. It runs outside the
// DBOS build workflow (no step is added), from the reconciler in `register.ts` and from the CLI.

import { createHash } from 'node:crypto';
import { DomainError, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { executeCommand } from '../bus/bus.ts';
import type { Db } from '../db/connection.ts';
import type { Row } from '../db/schema.ts';
import type { Services } from '../services.ts';
import { RULES, RULES_VERSION, type Finding, type Rule } from './rules/index.ts';

export type { Finding, Rule } from './rules/index.ts';

export const HARNESS = system('harness', '1');

export type PostmortemOutcome = 'merged' | 'withdrawn' | 'failed' | 'needs_you';

/** Everything the rules may read about one build request: stored rows only. */
export type PostmortemInputs = {
  request: Row<'build_requests'>;
  /** Code of the task (TSK-…) the request builds. */
  taskCode: string;
  /** Every step of every attempt, oldest first. */
  steps: Row<'build_steps'>[];
  reviews: Row<'pr_reviews'>[];
  /** What «Code to extend» showed the builder, per attempt. */
  codeOpinions: Row<'task_code_opinions'>[];
  /** Jev's schema opinion of the task: the latest one made before the request, if any. */
  layersOpinion: Row<'task_layers_opinions'> | null;
  testRuns: Row<'test_runs'>[];
};

export async function loadInputs(db: Db, requestId: string): Promise<PostmortemInputs> {
  const request = await db.selectFrom('build_requests').selectAll().where('id', '=', requestId).executeTakeFirst();
  if (!request) throw new DomainError('not_found', 'The build request does not exist.');
  const task = await db.selectFrom('records').select('code').where('id', '=', request.task_id).executeTakeFirstOrThrow();
  const steps = await db
    .selectFrom('build_steps')
    .selectAll()
    .where('build_request_id', '=', requestId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const reviews = await db.selectFrom('pr_reviews').selectAll().where('build_request_id', '=', requestId).orderBy('created_at').orderBy('id').execute();
  const codeOpinions = await db
    .selectFrom('task_code_opinions')
    .selectAll()
    .where('build_request_id', '=', requestId)
    .orderBy('attempt')
    .orderBy('rank')
    .orderBy('id')
    .execute();
  const layersOpinion =
    (await db
      .selectFrom('task_layers_opinions')
      .selectAll()
      .where('record_id', '=', request.task_id)
      .where('created_at', '<=', request.requested_at)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst()) ?? null;
  const testRuns = await db.selectFrom('test_runs').selectAll().where('build_request_id', '=', requestId).orderBy('recorded_at').orderBy('id').execute();
  return { request, taskCode: task.code, steps, reviews, codeOpinions, layersOpinion, testRuns };
}

const iso = (d: unknown): string => (d === null || d === undefined ? '' : new Date(d as Date | string).toISOString());

/**
 * Fingerprint of the rows read: ids and timestamps, not their JSON (cheap). The same rows give the same hash, so
 * computing twice writes nothing; a late row (a main step, a test run) changes it and a new post-mortem is written.
 */
export function inputsHashOf(inputs: PostmortemInputs): string {
  const r = inputs.request;
  const lines = [
    `request:${r.id}:${r.state}:${iso(r.in_review_at)}:${iso(r.done_at)}:${iso(r.withdrawn_at)}:${r.head_sha ?? ''}`,
    ...inputs.steps.map((x) => `step:${x.id}:${iso(x.created_at)}`),
    ...inputs.reviews.map((x) => `review:${x.id}:${iso(x.created_at)}`),
    ...inputs.codeOpinions.map((x) => `code:${x.id}:${iso(x.created_at)}`),
    `layers:${inputs.layersOpinion ? `${inputs.layersOpinion.id}:${iso(inputs.layersOpinion.created_at)}` : ''}`,
    ...inputs.testRuns.map((x) => `test:${x.id}:${iso(x.recorded_at)}`),
  ];
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** How many attempts the request had: the highest attempt number of its steps. */
export function attemptsOf(inputs: PostmortemInputs): number {
  return inputs.steps.reduce((n, s) => Math.max(n, s.attempt), 0);
}

const detailOf = (s: { detail: unknown }): Record<string, unknown> => {
  const d = typeof s.detail === 'string' ? safeParse(s.detail) : s.detail;
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
};
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The outcome of an ended request, or null while it is not ended. Ended: done (merged) or withdrawn; or the latest
 * attempt ended without a follow-up, either failed or cancelled («failed») or stopped at merge needing the person
 * («needs_you»). A red CI or a review asking for changes is not the end of an attempt: it goes on (same reading as
 * `buildRunning` in commands/build-steps.ts).
 */
export function endedOutcome(inputs: PostmortemInputs): PostmortemOutcome | null {
  if (inputs.request.state === 'done') return 'merged';
  if (inputs.request.state === 'withdrawn') return 'withdrawn';
  const attempt = attemptsOf(inputs);
  if (attempt === 0) return null;
  const last = inputs.steps.filter((s) => s.attempt === attempt);
  if (last.some((s) => s.stage === 'merge' && s.outcome === 'changes_requested' && detailOf(s).escalated === 'needs_person')) return 'needs_you';
  const failed = last.some(
    (s) =>
      s.outcome === 'cancelled' ||
      (s.outcome === 'failed' &&
        !(s.stage === 'ci' && detailOf(s).conclusion != null) &&
        !(s.stage === 'review' && detailOf(s).verdict != null)),
  );
  return failed ? 'failed' : null;
}

export type PostmortemResult =
  | { status: 'recorded'; postmortemId: string; findings: number }
  | { status: 'unchanged' }
  | { status: 'not_ended' };

// One post-mortem job at a time per project: the reconciler tick and the CLI never write the same rows twice.
const tails = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, job: () => Promise<T>): Promise<T> {
  const next = (tails.get(key) ?? Promise.resolve()).then(job);
  const tail = next.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return next;
}

/**
 * Computes and stores the post-mortem of one request for a rules version. Idempotent: the same inputs and version
 * write nothing. `rules` is only for tests (a different rule set under another version label).
 */
export async function runPostmortem(
  services: Services,
  requestId: string,
  rulesVersion: string = RULES_VERSION,
  rules: readonly Rule[] = RULES,
): Promise<PostmortemResult> {
  const request = await services.db.selectFrom('build_requests').select('project_id').where('id', '=', requestId).executeTakeFirst();
  if (!request) throw new DomainError('not_found', 'The build request does not exist.');
  return serialized(request.project_id, async () => {
    const inputs = await loadInputs(services.db, requestId);
    const outcome = endedOutcome(inputs);
    if (!outcome) return { status: 'not_ended' };
    const inputsHash = inputsHashOf(inputs);
    const exists = await services.db
      .selectFrom('harness_postmortems')
      .select('id')
      .where('build_request_id', '=', requestId)
      .where('rules_version', '=', rulesVersion)
      .where('inputs_hash', '=', inputsHash)
      .executeTakeFirst();
    if (exists) return { status: 'unchanged' };
    const findings: Finding[] = rules.flatMap((rule) => rule(inputs));
    const done = await executeCommand(services, {
      command: 'harness.postmortem',
      actor: HARNESS,
      projectId: request.project_id,
      data: { build_request_id: requestId, rules_version: rulesVersion, inputs_hash: inputsHash, attempts: attemptsOf(inputs), outcome, findings },
    });
    return { status: 'recorded', postmortemId: done.entityId, findings: findings.length };
  });
}

/**
 * Ended requests whose post-mortem is missing for the version, or older than the request's last activity (a retry
 * after a failed attempt, a late step): candidates are cheap to find in SQL, then confirmed as ended from the rows.
 */
export async function pendingPostmortems(db: Db, rulesVersion: string = RULES_VERSION): Promise<{ project_id: string; id: string }[]> {
  const candidates = await sql<{ project_id: string; id: string }>`
    select b.project_id, b.id
    from build_requests b
    where (b.state in ('done', 'withdrawn') or exists (select 1 from build_steps s where s.build_request_id = b.id))
      and not exists (
        select 1 from harness_postmortems p
        where p.build_request_id = b.id and p.rules_version = ${rulesVersion}
          and p.computed_at >= greatest(
            coalesce((select max(s.created_at) from build_steps s where s.build_request_id = b.id), 'epoch'),
            coalesce((select max(r.created_at) from pr_reviews r where r.build_request_id = b.id), 'epoch'),
            coalesce((select max(t.recorded_at) from test_runs t where t.build_request_id = b.id), 'epoch'),
            coalesce(b.done_at, b.withdrawn_at, 'epoch')))
    order by b.requested_at, b.id`.execute(db);
  const pending: { project_id: string; id: string }[] = [];
  for (const c of candidates.rows) {
    if (endedOutcome(await loadInputs(db, c.id))) pending.push(c);
  }
  return pending;
}

/** Computes every pending post-mortem (optionally of one project). Never throws: a failure is logged and the next one goes on. */
export async function computePendingPostmortems(services: Services, projectId?: string): Promise<number> {
  let written = 0;
  for (const p of await pendingPostmortems(services.db)) {
    if (projectId && p.project_id !== projectId) continue;
    try {
      if ((await runPostmortem(services, p.id)).status === 'recorded') written++;
    } catch (e) {
      services.logger.error('The harness post-mortem could not be computed', { request: p.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return written;
}
