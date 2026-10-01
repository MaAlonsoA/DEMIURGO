// «Build the queue» (VISION.md, Construcción y evidencia): with the project's flag on, the system takes the
// first ready task of the Build page and does what the person's clicks do: record the build request
// (build_request.request) and start the agent build (build.start), both as `system:build`.
// One build at a time (our convention: it avoids merge conflicts between parallel branches). It is
// asked after the flag is turned on and after a request becomes done; a build that ends needing the
// person stops the queue (it never skips ahead). Idempotent: it decides from the stored state, so asking
// twice starts nothing twice (and build.start refuses a running build and an already merged task).

import { DomainError, formatActor, system } from '@demiurgo/domain';
import { executeCommand } from '../bus/bus.ts';
import { buildRunning } from '../commands/build-steps.ts';
import type { Db, Tx } from '../db/connection.ts';
import type { Services } from '../services.ts';
import { isTransientFailure } from './failure.ts';
import { type BuildQueue, buildQueue } from './queue.ts';

const BUILD = system('build', '1');

export type AutoStopped = {
  code: string;
  /**
   * needs_you: «DEMIURGO tried N times; it needs you»; ended: the last attempt failed or was cancelled;
   * stale: the request is out of date; manual_review: a pull request pasted by hand is waiting;
   * waiting: the builder hit a transient limit (the subscription's usage limit): the queue is paused, not given up.
   */
  kind: 'needs_you' | 'ended' | 'stale' | 'manual_review' | 'waiting';
  tried: number | null;
  /** The builder's failure kind (usage_limit, auth, other…) when the last attempt failed in the builder. */
  failure_kind?: string | null;
};

export type AutoStatus = {
  on: boolean;
  /** The task whose agent build is running now. */
  building: string | null;
  /** The task that starts next, when nothing stops the queue. */
  next: string | null;
  stopped: AutoStopped | null;
};

export async function queueAutoOn(db: Db | Tx, projectId: string): Promise<boolean> {
  const row = await db.selectFrom('build_queue_settings').select('auto').where('project_id', '=', projectId).executeTakeFirst();
  return row?.auto === true;
}

type Decision =
  | { kind: 'building'; code: string }
  | { kind: 'stopped'; stopped: AutoStopped }
  | { kind: 'start'; code: string; hasRequest: boolean }
  | { kind: 'empty' };

/** What the queue does now, from the stored state only. */
async function decide(db: Db, projectId: string, queue: BuildQueue): Promise<Decision> {
  // Any open request with a running build holds the queue, whether it is on the first ready task or not.
  const open = await db
    .selectFrom('build_requests')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select(['build_requests.id', 'records.code'])
    .where('build_requests.project_id', '=', projectId)
    .where('build_requests.state', 'in', ['requested', 'in_review'])
    .execute();
  for (const o of open) if (await buildRunning(db, o.id)) return { kind: 'building', code: o.code };
  const first = queue.ready[0];
  if (!first) return { kind: 'empty' };
  const request = first.request;
  if (!request) return { kind: 'start', code: first.code, hasRequest: false };
  if (request.stale) return { kind: 'stopped', stopped: { code: first.code, kind: 'stale', tried: null } };
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
      ? { kind: 'start', code: first.code, hasRequest: true }
      : { kind: 'stopped', stopped: { code: first.code, kind: 'manual_review', tried: null } };
  }
  // The builder failed on something transient (a usage limit): the queue waits, it does not give up.
  const d = latest.detail as { failure_kind?: string } | null;
  const failure = latest.stage === 'builder' && latest.outcome === 'failed' ? (d?.failure_kind ?? null) : null;
  if (isTransientFailure(failure)) return { kind: 'stopped', stopped: { code: first.code, kind: 'waiting', tried: null, failure_kind: failure } };
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
    ? { kind: 'stopped', stopped: { code: first.code, kind: 'needs_you', tried: needs.detail.tried ?? null } }
    : { kind: 'stopped', stopped: { code: first.code, kind: 'ended', tried: null, ...(failure ? { failure_kind: failure } : {}) } };
}

/** The state the Build page shows. */
export async function autoStatus(db: Db, projectId: string, queue: BuildQueue): Promise<AutoStatus> {
  const on = await queueAutoOn(db, projectId);
  if (!on) return { on, building: null, next: null, stopped: null };
  const d = await decide(db, projectId, queue);
  switch (d.kind) {
    case 'building':
      return { on, building: d.code, next: queue.ready.find((t) => t.code !== d.code && t.request === null)?.code ?? null, stopped: null };
    case 'stopped':
      return { on, building: null, next: null, stopped: d.stopped };
    case 'start':
      return { on, building: null, next: d.code, stopped: null };
    default:
      return { on, building: null, next: null, stopped: null };
  }
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
 * Starts the next ready task when the flag is on and nothing is running or stopping the queue.
 * Returns the code it started, or null. Never throws: a task that cannot start (GitHub not connected,
 * for instance) leaves the queue where it is and the reason in the log.
 */
export function advanceBuildQueue(services: Services, projectId: string): Promise<string | null> {
  return serialized(projectId, async () => {
    try {
      if (!(await queueAutoOn(services.db, projectId))) return null;
      const queue = await buildQueue(services.db, projectId);
      const d = await decide(services.db, projectId, queue);
      if (d.kind !== 'start') return null;
      if (!d.hasRequest) await executeCommand(services, { command: 'build_request.request', actor: BUILD, projectId, data: { task: d.code } });
      await executeCommand(services, { command: 'build.start', actor: BUILD, projectId, data: { task: d.code } });
      return d.code;
    } catch (e) {
      services.logger.error('«Build the queue» could not start the next task', {
        project: projectId,
        actor: formatActor(BUILD),
        error: e instanceof DomainError ? [e.message, ...e.reasons].join(' ') : String(e),
      });
      return null;
    }
  });
}
