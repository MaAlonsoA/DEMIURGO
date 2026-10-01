// The deterministic post-mortem of an ended build request (salud-del-harness §7): it reads what the journal already
// stored and writes classified findings, append-only. No model call. Blameless in the sense of the Google SRE book
// («Postmortem Culture»): it records what each piece decided and cost, not whose fault it was. It runs outside the
// DBOS build workflow (no step is added), from the reconciler in `register.ts` and from the CLI.

import { createHash } from 'node:crypto';
import { DomainError, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { executeCommand } from '../bus/bus.ts';
import { taskFootprints } from '../build/footprint.ts';
import type { Db } from '../db/connection.ts';
import type { Row } from '../db/schema.ts';
import type { Services } from '../services.ts';
import { type JudgmentOutcome, deriveOutcomes } from './outcomes.ts';
import { activeSteps } from './rules/queue.ts';
import { builderEngineOf, reviewerEngineOf } from './rules/builder-detail.ts';
import { type EngineMark, engineMarkOf } from './engine.ts';
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
  /** Other requests of the project whose first-to-last-step window overlaps this one's (queue rules). */
  concurrent?: ConcurrentRequest[];
  /** What the queue decided for this task from its request on (empty until the queue_decisions table exists). */
  queueDecisions?: QueueDecisionRow[];
  /** The queue plans from the request until the task started, oldest first (same table family as the decisions). */
  queuePlans?: QueuePlanRow[];
  /** Real files (merge footprint) of the tasks this one waited for, by task code. */
  waitedFiles?: Record<string, string[]>;
  /** Issues of the task opened after the request was made (review escapes, G10). */
  issues?: Row<'issues'>[];
  /** The `ai_runs` of the request's reviews: usage and time (review cost, waiver). */
  reviewRuns?: Row<'ai_runs'>[];
  /** Jev's size opinion of the task: the latest one made before the request (judgment outcomes). */
  sizeOpinion?: Row<'task_size_opinions'> | null;
  /** Jev's testability opinions of the task made before the request (judgment outcomes). */
  testabilityOpinions?: Row<'task_testability_opinions'>[];
  /** Jev's category of each comment of the request's reviews (judgment outcomes). */
  reviewKinds?: Row<'review_finding_kinds'>[];
};

/** Another build request that ran at the same time: its task and its steps. */
export type ConcurrentRequest = { requestId: string; taskCode: string; state: string; steps: Row<'build_steps'>[] };

/** One row of `queue_decisions` with the time of its plan (salud-del-harness §6.1). */
export type QueueDecisionRow = {
  id: string;
  plan_id: string;
  decided_at: Date | string;
  decision: string;
  item: string | null;
  with_task: string | null;
  with_source: string | null;
  evidence: unknown;
};

/** One row of `queue_plans` (salud-del-harness §6.1). */
export type QueuePlanRow = { id: string; decided_at: Date | string; parallel_limit: number; running: string[]; started: string[]; stopped_kind: string | null };

const undefinedTable = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: string }).code === '42P01';

/** Runs a query on a table that may not exist yet (the queue tables come in their own migration): missing = no rows. */
async function optionalRows<T>(run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run();
  } catch (e) {
    if (undefinedTable(e)) return [];
    throw e;
  }
}

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
  const base: PostmortemInputs = { request, taskCode: task.code, steps, reviews, codeOpinions, layersOpinion, testRuns };
  const issues = await db
    .selectFrom('issues')
    .selectAll()
    .where('project_id', '=', request.project_id)
    .where((eb) => eb.or([eb('build_request_id', '=', requestId), eb('task_id', '=', request.task_id)]))
    .where('opened_at', '>=', request.requested_at)
    .orderBy('opened_at')
    .orderBy('id')
    .execute();
  const runIds = reviews.map((r) => r.run_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const reviewRuns = runIds.length > 0 ? await db.selectFrom('ai_runs').selectAll().where('id', 'in', runIds).execute() : [];
  const sizeOpinion =
    (await db
      .selectFrom('task_size_opinions')
      .selectAll()
      .where('record_id', '=', request.task_id)
      .where('created_at', '<=', request.requested_at)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst()) ?? null;
  const testabilityOpinions = await db
    .selectFrom('task_testability_opinions')
    .selectAll()
    .where('record_id', '=', request.task_id)
    .where('created_at', '<=', request.requested_at)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const reviewIds = reviews.map((r) => r.id);
  const reviewKinds = reviewIds.length > 0 ? await db.selectFrom('review_finding_kinds').selectAll().where('pr_review_id', 'in', reviewIds).orderBy('created_at').orderBy('id').execute() : [];
  return { ...base, issues, reviewRuns, sizeOpinion, testabilityOpinions, reviewKinds, ...(await loadQueueInputs(db, base)) };
}

/** The window of a request in the queue rules: from its first step to its last. */
async function loadQueueInputs(db: Db, inputs: PostmortemInputs): Promise<Pick<PostmortemInputs, 'concurrent' | 'queueDecisions' | 'queuePlans' | 'waitedFiles'>> {
  const { request, steps } = inputs;
  const first = steps[0];
  // The window ends at the merge and leaves out `footprint` and `main` steps (written after it, hours later).
  const last = activeSteps(steps).at(-1);
  // One query: every step of the other requests whose own window overlaps this one's.
  const others = first && last
    ? await sql<Row<'build_steps'> & { code: string; request_state: string }>`
        select s.*, r.code, b.state as request_state
        from build_steps s
        join build_requests b on b.id = s.build_request_id
        join records r on r.id = b.task_id
        where s.build_request_id in (
          select s2.build_request_id from build_steps s2
          where s2.project_id = ${request.project_id} and s2.build_request_id <> ${request.id}
            and s2.stage not in ('footprint', 'main')
          group by s2.build_request_id
          having min(s2.created_at) <= ${last.created_at} and max(s2.created_at) >= ${first.created_at})
        order by s.created_at, s.id`.execute(db)
    : { rows: [] };
  const byRequest = new Map<string, ConcurrentRequest>();
  for (const { code, request_state, ...step } of others.rows) {
    const entry = byRequest.get(step.build_request_id) ?? { requestId: step.build_request_id, taskCode: code, state: request_state, steps: [] };
    entry.steps.push(step as Row<'build_steps'>);
    byRequest.set(step.build_request_id, entry);
  }
  // The waits of a task belong to the time between «ready» and «started», not to the request: 44 of 57 requests are made by
  // the queue itself when the task starts, so a window from `requested_at` held nothing (pm-5). The window opens when the
  // previous request of the task ended (a relaunch or a retry after a withdrawal) and has no floor for the first request:
  // the decisions only exist since the queue did. It closes at the first step.
  const previous = await sql<{ ended: Date | string | null }>`
    select greatest(
      b.requested_at, coalesce(b.done_at, 'epoch'), coalesce(b.withdrawn_at, 'epoch'),
      coalesce((select max(s.created_at) from build_steps s where s.build_request_id = b.id and s.stage not in ('footprint', 'main')), 'epoch')) as ended
    from build_requests b
    where b.task_id = ${request.task_id} and b.id <> ${request.id} and b.requested_at < ${request.requested_at}
    order by b.requested_at desc, b.id desc limit 1`.execute(db);
  const floor = previous.rows[0]?.ended ?? null;
  const ceiling = first?.created_at ?? request.requested_at;
  const queueDecisions = await optionalRows(
    async () =>
      (
        await sql<QueueDecisionRow>`
          select d.id, d.plan_id, p.decided_at, d.decision, d.item, d.with_task, d.with_source, d.evidence
          from queue_decisions d join queue_plans p on p.id = d.plan_id
          where d.project_id = ${request.project_id} and d.task_code = ${inputs.taskCode}
            and p.decided_at <= ${ceiling} and (${floor}::timestamptz is null or p.decided_at >= ${floor}::timestamptz)
          order by p.decided_at, d.id`.execute(db)
      ).rows,
  );
  // The plans of the same window: from the first decision about the task (or the end of its previous request).
  const plansFrom = floor ?? queueDecisions[0]?.decided_at ?? request.requested_at;
  const queuePlans = await optionalRows(
    async () =>
      (
        await sql<QueuePlanRow>`
          select id, decided_at, parallel_limit, running, started, stopped_kind from queue_plans
          where project_id = ${request.project_id} and decided_at >= ${plansFrom} and decided_at <= ${ceiling}
          order by decided_at, id`.execute(db)
      ).rows,
  );
  const waited = [...new Set(queueDecisions.map((d) => d.with_task).filter((c): c is string => !!c))];
  const waitedFiles: Record<string, string[]> = {};
  if (waited.length > 0) {
    for (const f of await taskFootprints(db, request.project_id)) if (waited.includes(f.code)) waitedFiles[f.code] = f.files.map((x) => x.path);
  }
  return { concurrent: [...byRequest.values()], queueDecisions, queuePlans, waitedFiles };
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
    ...(inputs.concurrent ?? []).map((c) => `concurrent:${c.requestId}:${c.state}:${c.steps.map((x) => `${x.id}@${iso(x.created_at)}`).join(',')}`),
    ...(inputs.issues ?? []).map((x) => `issue:${x.id}:${iso(x.opened_at)}`),
    ...(inputs.queueDecisions ?? []).map((x) => `decision:${x.id}:${iso(x.decided_at)}`),
    ...(inputs.queuePlans ?? []).map((x) => `plan:${x.id}:${iso(x.decided_at)}`),
    ...Object.entries(inputs.waitedFiles ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([code, files]) => `waited:${code}:${files.length}`),
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
export function serialized<T>(key: string, job: () => Promise<T>): Promise<T> {
  const next = (tails.get(key) ?? Promise.resolve()).then(job);
  const tail = next.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return next;
}

/** The outcomes whose (table, key, outcome) is not stored yet for this rules version. */
async function missingOutcomes(db: Db, projectId: string, rulesVersion: string, outcomes: readonly JudgmentOutcome[]): Promise<JudgmentOutcome[]> {
  if (outcomes.length === 0) return [];
  const stored = await db
    .selectFrom('judgment_outcomes')
    .select(['judgment_table', 'judgment_key', 'outcome_name'])
    .where('project_id', '=', projectId)
    .where('rules_version', '=', rulesVersion)
    .where('judgment_key', 'in', outcomes.map((o) => o.judgment_key))
    .execute();
  const have = new Set(stored.map((s) => `${s.judgment_table}|${s.judgment_key}|${s.outcome_name}`));
  return outcomes.filter((o) => !have.has(`${o.judgment_table}|${o.judgment_key}|${o.outcome_name}`));
}

/** The rule families that read a builder step, the reviewer's run and Jev's schema opinion (the others read no engine). */
const BUILDER_RULES = ['tdd.', 'session.', 'builder.', 'environment.'];

/** The engine behind a finding: the builder's, the reviewer's or Jev's, by the family of its rule; null when it reads none. */
export function engineOfFinding(inputs: PostmortemInputs, f: Finding): EngineMark | null {
  if (BUILDER_RULES.some((p) => f.finding.startsWith(p))) return builderEngineOf(inputs, f.attempt);
  if (f.finding.startsWith('review.')) return reviewerEngineOf(inputs, f.attempt);
  if (f.finding.startsWith('schema.')) {
    const id = inputs.layersOpinion?.classifier_id;
    const model = typeof id === 'string' ? id.replace(/^jev@/, '') : '';
    return model ? engineMarkOf({ provider: 'jev', model, jev_model: model }) : null;
  }
  return null;
}

/** Adds `evidence.engine` (the engine the finding's step ran on) to the findings with an object as evidence, so a later reading can split by engine version. */
export function withEngineEvidence(inputs: PostmortemInputs, findings: readonly Finding[]): Finding[] {
  return findings.map((f) => {
    const ev = f.evidence;
    if (!ev || typeof ev !== 'object' || Array.isArray(ev) || 'engine' in ev) return f;
    const engine = engineOfFinding(inputs, f);
    return engine ? { ...f, evidence: { ...ev, engine } } : f;
  });
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
    const findings: Finding[] = withEngineEvidence(inputs, rules.flatMap((rule) => rule(inputs)));
    const outcomes = deriveOutcomes(inputs, findings);
    const exists = await services.db
      .selectFrom('harness_postmortems')
      .select('id')
      .where('build_request_id', '=', requestId)
      .where('rules_version', '=', rulesVersion)
      .where('inputs_hash', '=', inputsHash)
      .executeTakeFirst();
    const data = { build_request_id: requestId, rules_version: rulesVersion, inputs_hash: inputsHash, attempts: attemptsOf(inputs), outcome, findings };
    if (exists) {
      // The post-mortem is there; outcomes it did not have yet (written before judgment outcomes existed) go in alone.
      const missing = await missingOutcomes(services.db, request.project_id, rulesVersion, outcomes);
      if (missing.length === 0) return { status: 'unchanged' };
      await executeCommand(services, { command: 'harness.postmortem', actor: HARNESS, projectId: request.project_id, data: { ...data, outcomes: missing } });
      return { status: 'unchanged' };
    }
    const done = await executeCommand(services, { command: 'harness.postmortem', actor: HARNESS, projectId: request.project_id, data: { ...data, outcomes } });
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
