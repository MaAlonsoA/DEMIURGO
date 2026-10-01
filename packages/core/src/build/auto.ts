// «Build the queue» (VISION.md, Construcción y evidencia): with the project's flag on, the system takes the
// first ready task of the Build page and does what the person's clicks do: record the build request
// (build_request.request) and start the agent build (build.start), both as `system:build`.
// Up to N builds at once (the person's «at once» setting, 1 to 3, 1 by default; our convention: few
// parallel branches keep merge conflicts rare). It takes ready tasks in queue order, skipping one that
// depends on a task being built or belongs to the same feature as one. It is asked after the flag or the
// limit is changed and after a request becomes done; a build that ends needing the
// person stops the queue (it never skips ahead). Idempotent: it decides from the stored state, so asking
// twice starts nothing twice (and build.start refuses a running build and an already merged task).

import { DomainError, formatActor, system } from '@demiurgo/domain';
import { executeCommand } from '../bus/bus.ts';
import { buildRunning } from '../commands/build-steps.ts';
import type { Db, Tx } from '../db/connection.ts';
import type { Services } from '../services.ts';
import { isTransientFailure } from './failure.ts';
import { type BuildQueue, type QueueTask, buildQueue } from './queue.ts';
import { loadTaskDependencies, type TaskDependencyIndex } from '../queries/task-deps.ts';

const BUILD = system('build', '1');

export type AutoStopped = {
  code: string;
  /**
   * needs_you: «DEMIURGO tried N times; it needs you»; ended: the last attempt failed or was cancelled;
   * stale: the request is out of date; manual_review: a pull request pasted by hand is waiting;
   * waiting: the builder hit a transient limit (the subscription's usage limit): the queue is paused, not given up;
   * main_red: CI on the base branch failed after DEMIURGO merged `code` (stop the line: nothing new starts).
   */
  kind: 'needs_you' | 'ended' | 'stale' | 'manual_review' | 'waiting' | 'main_red';
  tried: number | null;
  /** The builder's failure kind (usage_limit, auth, other…) when the last attempt failed in the builder. */
  failure_kind?: string | null;
};

export type AutoStatus = {
  on: boolean;
  /** How many builds run at once at most (1 to 3). */
  parallel: number;
  /** The first task whose agent build is running now. */
  building: string | null;
  /** Every task whose agent build is running now. */
  builds: string[];
  /** The task that starts next, when nothing stops the queue. */
  next: string | null;
  stopped: AutoStopped | null;
  /** Flaky tests the last builds quarantined (they did not block their pull request): someone creates a fix task. Omitted when none. */
  quarantined?: string[];
};

export async function queueAutoOn(db: Db | Tx, projectId: string): Promise<boolean> {
  const row = await db.selectFrom('build_queue_settings').select('auto').where('project_id', '=', projectId).executeTakeFirst();
  return row?.auto === true;
}

type Start = { code: string; hasRequest: boolean };

/**
 * Stop the line (Martin Fowler, "Continuous Integration": fix broken builds immediately): the latest CI result on the
 * base branch of the project (`main` build step, written after each merge) is red. Nothing new starts until the person
 * has fixed main and touches «Build the queue» (turns it off and on, or changes «at once») after that failure:
 * only a person's command changes the flag (capability matrix), so the stop is derived from the stored steps.
 */
async function mainRed(db: Db, projectId: string): Promise<AutoStopped | null> {
  const last = await db
    .selectFrom('build_steps')
    .innerJoin('build_requests', 'build_requests.id', 'build_steps.build_request_id')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select(['build_steps.outcome', 'build_steps.created_at', 'records.code'])
    .where('build_steps.project_id', '=', projectId)
    .where('build_steps.stage', '=', 'main')
    .orderBy('build_steps.created_at', 'desc')
    .orderBy('build_steps.id', 'desc')
    .executeTakeFirst();
  if (!last || last.outcome !== 'failed') return null;
  const settings = await db.selectFrom('build_queue_settings').select('set_at').where('project_id', '=', projectId).executeTakeFirst();
  if (settings && new Date(settings.set_at as unknown as Date).getTime() >= new Date(last.created_at as unknown as Date).getTime()) return null;
  return { code: last.code, kind: 'main_red', tried: null };
}

/** The flaky tests quarantined by the project's latest builds (see flaky.ts), without repeats. */
async function quarantinedTests(db: Db, projectId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('build_steps')
    .select('detail')
    .where('project_id', '=', projectId)
    .where('stage', '=', 'evidence')
    .where('outcome', '=', 'ok')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(20)
    .execute();
  const tests = rows.flatMap((x) => (x.detail as { quarantined?: string[] } | null)?.quarantined ?? []);
  return [...new Set(tests)];
}

/** One ready task, from the stored state only: it starts, or the queue stops at it. */
async function taskState(db: Db, t: QueueTask): Promise<{ kind: 'start'; hasRequest: boolean } | { kind: 'stopped'; stopped: AutoStopped }> {
  const request = t.request;
  if (!request) return { kind: 'start', hasRequest: false };
  if (request.stale) return { kind: 'stopped', stopped: { code: t.code, kind: 'stale', tried: null } };
  const latest = await db
    .selectFrom('build_steps')
    .select(['attempt', 'stage', 'outcome', 'detail'])
    .where('build_request_id', '=', request.id)
    .orderBy('attempt', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!latest) {
    // Requested by the person and never started: the queue starts it. A pull request pasted by hand is the person's.
    return request.state === 'requested'
      ? { kind: 'start', hasRequest: true }
      : { kind: 'stopped', stopped: { code: t.code, kind: 'manual_review', tried: null } };
  }
  // The builder failed on something transient (a usage limit): the queue waits, it does not give up.
  const d = latest.detail as { failure_kind?: string } | null;
  const failure = latest.stage === 'builder' && latest.outcome === 'failed' ? (d?.failure_kind ?? null) : null;
  if (isTransientFailure(failure)) return { kind: 'stopped', stopped: { code: t.code, kind: 'waiting', tried: null, failure_kind: failure } };
  // The attempt that ended needing the person says so in its last step; any other ended attempt also stops
  // the queue (it never skips ahead).
  const needs = (await db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', request.id)
    .where('attempt', '=', latest.attempt)
    .where('stage', '=', 'merge')
    .where('outcome', '=', 'changes_requested')
    .orderBy('created_at', 'desc')
    .executeTakeFirst()) as { detail: { needs_you?: boolean; tried?: number } | null } | undefined;
  return needs?.detail?.needs_you === true
    ? { kind: 'stopped', stopped: { code: t.code, kind: 'needs_you', tried: needs.detail.tried ?? null } }
    : { kind: 'stopped', stopped: { code: t.code, kind: 'ended', tried: null, ...(failure ? { failure_kind: failure } : {}) } };
}

/** The project's «at once» limit (1 to 3; 1 when never set). */
export async function queueParallelOf(db: Db | Tx, projectId: string): Promise<number> {
  const row = await db.selectFrom('build_queue_settings').select('parallel').where('project_id', '=', projectId).executeTakeFirst();
  return row?.parallel ?? 1;
}

/** True when the task depends, directly or through other tasks and the tasks of features it waits for, on a busy task. */
export function dependsOnBusy(index: TaskDependencyIndex, code: string, busy: Set<string>): boolean {
  const seen = new Set<string>([code]);
  const stack = [code];
  while (stack.length) {
    const current = stack.pop() as string;
    const direct = [...(index.tasks.get(current) ?? []), ...(index.features.get(current) ?? []).flatMap((f) => index.featureTasks.get(f) ?? [])];
    for (const d of direct) {
      if (busy.has(d)) return true;
      if (!seen.has(d)) {
        seen.add(d);
        stack.push(d);
      }
    }
  }
  return false;
}

type Plan = {
  /** The tasks whose agent build is running now. */
  running: string[];
  /** The tasks to start now, in queue order. */
  start: Start[];
  stopped: AutoStopped | null;
};

/**
 * What the queue does now, from the stored state only. Up to `limit` builds run at once: ready tasks are taken
 * in queue order, skipping one that depends on a task being built or belongs to the same feature as one
 * (our convention: tasks of one feature touch the same files). A task that stopped needing the person stops
 * the queue: it never skips ahead.
 */
async function plan(db: Db, projectId: string, queue: BuildQueue, limit: number): Promise<Plan> {
  // Any open request with a running build counts, whether it is on a ready task or not.
  const open = await db
    .selectFrom('build_requests')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select(['build_requests.id', 'records.code'])
    .where('build_requests.project_id', '=', projectId)
    .where('build_requests.state', 'in', ['requested', 'in_review'])
    .execute();
  const running: string[] = [];
  for (const o of open) if (await buildRunning(db, o.id)) running.push(o.code);
  const result: Plan = { running, start: [], stopped: null };
  // A red main stops the line even while builds run: they finish, and nothing new starts.
  const red = await mainRed(db, projectId);
  if (red) return { ...result, stopped: red };
  if (running.length >= limit) return result;
  const index = await loadTaskDependencies(db, projectId);
  const busy = new Set(running);
  const featureOf = (code: string) => index.taskFeature.get(code) ?? queue.ready.find((t) => t.code === code)?.feature?.code ?? null;
  const busyFeatures = new Set(running.map(featureOf).filter((f): f is string => f !== null));
  for (const t of queue.ready) {
    if (running.length + result.start.length >= limit) break;
    if (busy.has(t.code)) continue;
    const state = await taskState(db, t);
    if (state.kind === 'stopped') {
      // Reported only when nothing runs: a running build is what the page shows then.
      if (running.length === 0) result.stopped = state.stopped;
      break;
    }
    const feature = featureOf(t.code);
    if (dependsOnBusy(index, t.code, busy) || (feature !== null && busyFeatures.has(feature))) continue;
    result.start.push({ code: t.code, hasRequest: state.hasRequest });
    busy.add(t.code);
    if (feature !== null) busyFeatures.add(feature);
  }
  return result;
}

/** The state the Build page shows. */
export async function autoStatus(db: Db, projectId: string, queue: BuildQueue): Promise<AutoStatus> {
  const on = await queueAutoOn(db, projectId);
  const parallel = await queueParallelOf(db, projectId);
  const quarantined = await quarantinedTests(db, projectId);
  const flaky = quarantined.length > 0 ? { quarantined } : {};
  if (!on) return { on, parallel, building: null, builds: [], next: null, stopped: null, ...flaky };
  const p = await plan(db, projectId, queue, parallel);
  const next = p.start[0]?.code ?? (p.running.length ? (queue.ready.find((t) => !p.running.includes(t.code) && t.request === null)?.code ?? null) : null);
  return { on, parallel, building: p.running[0] ?? null, builds: p.running, next, stopped: p.stopped, ...flaky };
}

const tails = new Map<string, Promise<unknown>>();

/** Runs the jobs of a project one after the other (one API process): two triggers never start the same task twice. */
function serialized<T>(projectId: string, job: () => Promise<T>): Promise<T> {
  const next = (tails.get(projectId) ?? Promise.resolve()).then(job);
  const tail = next.catch(() => undefined);
  tails.set(projectId, tail);
  void tail.then(() => {
    if (tails.get(projectId) === tail) tails.delete(projectId);
  });
  return next;
}

/**
 * Starts the next ready tasks when the flag is on, up to the number of builds allowed at once.
 * Returns the codes it started. Never throws: a task that cannot start (GitHub not connected,
 * for instance) leaves the queue where it is and the reason in the log.
 */
export function advanceBuildQueue(services: Services, projectId: string): Promise<string[]> {
  return serialized(projectId, async () => {
    const started: string[] = [];
    try {
      if (!(await queueAutoOn(services.db, projectId))) return started;
      const queue = await buildQueue(services.db, projectId);
      const p = await plan(services.db, projectId, queue, await queueParallelOf(services.db, projectId));
      for (const s of p.start) {
        if (!s.hasRequest) await executeCommand(services, { command: 'build_request.request', actor: BUILD, projectId, data: { task: s.code } });
        await executeCommand(services, { command: 'build.start', actor: BUILD, projectId, data: { task: s.code } });
        started.push(s.code);
      }
    } catch (e) {
      services.logger.error('«Build the queue» could not start the next task', {
        project: projectId,
        actor: formatActor(BUILD),
        error: e instanceof DomainError ? [e.message, ...e.reasons].join(' ') : String(e),
      });
    }
    return started;
  });
}
