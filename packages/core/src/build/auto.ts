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
import { type SchemaEvidence, schemaChangingTasks } from './schema-risk.ts';
import { type CodeMap, moduleOverlap } from './code-map.ts';
import { hotspotsOf, isHotspot } from './hotspots.ts';
import { predictedFiles } from './predicted-files.ts';
import { ensureTaskLayers } from '../classifier/layers.ts';

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

/** A task that waits, the shared file or module and the task being built that shares it. */
export type ModuleWaiting = { code: string; item: string; with: string };

export type ModuleItemKind = 'hotspot' | 'table' | 'route' | 'page' | 'server_action';

/** A waiting task with what the page needs to explain it: the kind of item, where the blocker's set came from and the hotspot counts. */
export type ModuleWaitingInfo = ModuleWaiting & {
  kind: ModuleItemKind;
  /** «actual»: the blocking task's files are the ones it committed; «predicted»: the prediction. */
  with_source: 'actual' | 'predicted';
  /** For a hotspot file: how many of the merged tasks changed it. */
  hotspot?: { tasks: number; of: number };
};

/** The kind of a shared item: a module id has its kind as prefix, a plain path is a hotspot file. Pure. */
export function moduleKindOf(item: string): ModuleItemKind {
  const m = /^(table|route|page|server_action):/.exec(item);
  return m ? (m[1] as ModuleItemKind) : 'hotspot';
}

/** Adds kind, source of the blocker's file set and hotspot counts to each waiting entry. Pure. */
export function enrichModuleWaiting(
  waiting: readonly ModuleWaiting[],
  actual: ReadonlySet<string>,
  hotspots: readonly { path: string; tasks: number; of: number }[],
): ModuleWaitingInfo[] {
  return waiting.map((w) => {
    const kind = moduleKindOf(w.item);
    const h = kind === 'hotspot' ? hotspots.find((x) => x.path === w.item) : undefined;
    return { ...w, kind, with_source: actual.has(w.with) ? 'actual' : 'predicted', ...(h ? { hotspot: { tasks: h.tasks, of: h.of } } : {}) };
  });
}

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
  /** Ready tasks that wait because they are predicted to change the database schema while another such task builds. Omitted when none. */
  schema_waiting?: string[];
  /** Ready tasks that wait because they are predicted to change a hotspot file or a table, route, page or server action that a task being built changes too. Omitted when none. */
  module_waiting?: ModuleWaitingInfo[];
  /** Ready tasks the queue does not start by itself because Jev flagged a criterion that CI cannot check: the person decides (mark it manual, move it or start it). Omitted when none. */
  testability_waiting?: string[];
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
  /** Tasks skipped this round because a running task is predicted to change the database schema too. */
  schemaWaiting: string[];
  /** Tasks skipped this round because they share a hotspot or module with a task being built. */
  moduleWaiting: ModuleWaiting[];
  /** Tasks skipped because Jev flagged a criterion that CI cannot check and nobody requested them. */
  testabilityWaiting: string[];
  /** What the page needs to explain moduleWaiting: running tasks whose set is their committed files, and the merged-task counts per file. */
  moduleContext?: { actual: Set<string>; hotspots: { path: string; tasks: number; of: number }[] };
};

export type SelectInput = {
  ready: QueueTask[];
  running: string[];
  limit: number;
  index: TaskDependencyIndex;
  featureOf: (code: string) => string | null;
  /** The stored state of a ready task: it starts, or the queue stops at it. */
  stateOf: (t: QueueTask) => Promise<{ kind: 'start'; hasRequest: boolean } | { kind: 'stopped'; stopped: AutoStopped }>;
  /** Tasks predicted to change the database schema (running or ready). */
  schema: Map<string, SchemaEvidence>;
  /** Files each task is predicted to change (running or ready); see predicted-files.ts. Without it the module rule does nothing. */
  predicted?: Map<string, string[]>;
  /** Paths that are hotspots of the project (see hotspots.ts). */
  hotspots?: ReadonlySet<string>;
  /** The code map the predictions were ranked in: names the table, route, page or server action a file belongs to. */
  map?: CodeMap | null;
};

/** Modules whose kind makes two tasks collide even on different files (a table, a route, a page, a server action). */
const SHARED_MODULE = /^(table|route|page|server_action):/;

/**
 * What two predicted file sets share that would make parallel builds collide: a hotspot file, or a table, route,
 * page or server action module. Components and libs only count file by file (their module is a whole folder).
 * Null when nothing. Pure.
 */
export function sharedItem(a: readonly string[], b: readonly string[], hotspots: ReadonlySet<string>, map: CodeMap | null): string | null {
  const bs = new Set(b);
  const both = a.filter((p) => bs.has(p));
  const hot = both.find((p) => hotspots.has(p));
  if (hot) return hot;
  if (!map) return null;
  const overlap = moduleOverlap(a, b, map);
  return overlap.modules.find((id) => SHARED_MODULE.test(id)) ?? null;
}

/**
 * The selection loop of the plan, with its inputs given: ready tasks in queue order, skipping one that depends
 * on a busy task, belongs to the same feature as a busy one, or is predicted to change the database schema
 * while another such task is busy (the app numbers migrations in sequence: two at once would collide). A
 * skipped task waits and does not block the ones behind it; a task that stopped needing the person stops the queue.
 */
export async function selectStarts(input: SelectInput): Promise<Omit<Plan, 'running'>> {
  const { ready, running, limit, index, featureOf, stateOf, schema, predicted, hotspots, map } = input;
  const result: Omit<Plan, 'running'> = { start: [], stopped: null, schemaWaiting: [], moduleWaiting: [], testabilityWaiting: [] };
  // Skipped after the schema rule: a hotspot or module shared with a busy task (Google LSC: more files in flight, more merge conflicts).
  const collision = (code: string): { item: string; with: string } | null => {
    const mine = predicted?.get(code);
    if (!mine || mine.length === 0) return null;
    for (const other of busy) {
      const theirs = predicted?.get(other);
      if (!theirs || theirs.length === 0) continue;
      const item = sharedItem(mine, theirs, hotspots ?? new Set(), map ?? null);
      if (item) return { item, with: other };
    }
    return null;
  };
  const busy = new Set(running);
  const busyFeatures = new Set(running.map(featureOf).filter((f): f is string => f !== null));
  let schemaBusy = running.some((c) => schema.has(c));
  for (const t of ready) {
    if (running.length + result.start.length >= limit) break;
    if (busy.has(t.code)) continue;
    const state = await stateOf(t);
    if (state.kind === 'stopped') {
      // Reported only when nothing runs: a running build is what the page shows then.
      if (running.length === 0) result.stopped = state.stopped;
      break;
    }
    // A Jev testability flag asks the person to decide before building: the queue never decides for them, it
    // leaves the task waiting (it does not stop the ones behind it). A request the person made still starts.
    if (!state.hasRequest && (t.testability?.length ?? 0) > 0) {
      result.testabilityWaiting.push(t.code);
      continue;
    }
    const feature = featureOf(t.code);
    if (dependsOnBusy(index, t.code, busy) || (feature !== null && busyFeatures.has(feature))) continue;
    const changesSchema = schema.has(t.code);
    if (changesSchema && schemaBusy) {
      result.schemaWaiting.push(t.code);
      continue;
    }
    const shared = collision(t.code);
    if (shared) {
      result.moduleWaiting.push({ code: t.code, ...shared });
      continue;
    }
    result.start.push({ code: t.code, hasRequest: state.hasRequest });
    busy.add(t.code);
    if (feature !== null) busyFeatures.add(feature);
    if (changesSchema) schemaBusy = true;
  }
  return result;
}

/** The files the latest successful commit step of a request recorded (what the branch really changes); null when none. */
export async function committedFiles(db: Db, requestId: string): Promise<string[] | null> {
  const row = await db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', requestId)
    .where('stage', '=', 'commit')
    .where('outcome', '=', 'ok')
    .orderBy('attempt', 'desc')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  const files = (row?.detail as { files?: unknown } | null | undefined)?.files;
  return Array.isArray(files) && files.length > 0 ? files.filter((f): f is string => typeof f === 'string') : null;
}

/**
 * What the queue does now, from the stored state only. Up to `limit` builds run at once: ready tasks are taken
 * in queue order, skipping one that depends on a task being built or belongs to the same feature as one
 * (our convention: tasks of one feature touch the same files) or changes the database schema while another such task builds. A task that stopped needing the person stops
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
  const result: Plan = { running, start: [], stopped: null, schemaWaiting: [], moduleWaiting: [], testabilityWaiting: [] };
  // A red main stops the line even while builds run: they finish, and nothing new starts.
  const red = await mainRed(db, projectId);
  if (red) return { ...result, stopped: red };
  if (running.length >= limit) return result;
  const index = await loadTaskDependencies(db, projectId);
  const featureOf = (code: string) => index.taskFeature.get(code) ?? queue.ready.find((t) => t.code === code)?.feature?.code ?? null;
  // Schema prediction only matters when two tasks can build together.
  const schema = limit > 1 ? await schemaChangingTasks(db, projectId, [...new Set([...running, ...queue.ready.map((t) => t.code)])]) : new Map<string, SchemaEvidence>();
  // Hotspots and predicted files matter for the same reason: only when two tasks can build together.
  const codes = [...new Set([...running, ...queue.ready.map((t) => t.code)])];
  let module: Pick<SelectInput, 'predicted' | 'hotspots' | 'map'> = {};
  let moduleContext: Plan['moduleContext'];
  if (limit > 1) {
    try {
      const predictions = await predictedFiles(db, projectId, codes);
      const counts = await hotspotsOf(db, projectId);
      const hotspots = new Set(counts.filter((h, _i, all) => isHotspot(h, all[0]?.of ?? 0)).map((h) => h.path));
      const actual = new Set<string>();
      // A build that already committed collides by the files it really changes, not by the prediction.
      const predicted = new Map(predictions.files);
      for (const o of open) {
        if (!running.includes(o.code)) continue;
        const real = await committedFiles(db, o.id);
        if (real) {
          predicted.set(o.code, real);
          actual.add(o.code);
        }
      }
      module = { predicted, hotspots, map: predictions.map };
      moduleContext = { actual, hotspots: counts };
    } catch {
      // a prediction that cannot be made never stops the queue
    }
  }
  const picked = await selectStarts({ ready: queue.ready, running, limit, index, featureOf, stateOf: (t) => taskState(db, t), schema, ...module });
  return { ...result, ...picked, ...(moduleContext ? { moduleContext } : {}) };
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
  const waiting = p.schemaWaiting.length > 0 ? { schema_waiting: p.schemaWaiting } : {};
  const moduleWait = p.moduleWaiting.length > 0 ? { module_waiting: enrichModuleWaiting(p.moduleWaiting, p.moduleContext?.actual ?? new Set(), p.moduleContext?.hotspots ?? []) } : {};
  const testWait = p.testabilityWaiting.length > 0 ? { testability_waiting: p.testabilityWaiting } : {};
  return { on, parallel, building: p.running[0] ?? null, builds: p.running, next, stopped: p.stopped, ...waiting, ...moduleWait, ...testWait, ...flaky };
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
      const limit = await queueParallelOf(services.db, projectId);
      // The schema rule needs Jev's prediction for every candidate: tasks written before it have none (H101 gap).
      if (limit > 1) await ensureTaskLayers(services, projectId, queue.ready.map((t) => t.code));
      const p = await plan(services.db, projectId, queue, limit);
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
