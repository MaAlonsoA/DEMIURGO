// What «Build the queue» decided and why (salud-del-harness §6.1; mision-comidas/auditoria-cola.md). The plan of a
// tick is turned into one decision per task with its reason; it is stored only when its hash differs from the
// project's latest plan, so the 60 s tick writes nothing while nothing changes. Derived data: no command, no event.
// The idle-capacity helper reproduces the audit's «build-minutes» and «candidate-minutes» from the stored plans.

import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import type { QueueDecisionsTable } from '../db/schema.ts';
import type { Plan } from './auto.ts';
import { enrichModuleWaiting } from './auto.ts';
import type { QueueTask } from './queue.ts';

export type PlanTrigger = 'event' | 'tick' | 'command';
export type DecisionKind = QueueDecisionsTable['decision'];

export type Decision = {
  task_code: string;
  decision: DecisionKind;
  item: string | null;
  with_task: string | null;
  with_source: 'actual' | 'predicted' | null;
  evidence: Record<string, unknown> | null;
};

export type DecisionsInput = {
  /** The ready tasks in queue order (their testability flags explain wait_testability). */
  ready: readonly Pick<QueueTask, 'code' | 'testability'>[];
  limit: number;
  /** Codes of the tasks a person put on hold: the queue skips them. */
  held?: readonly string[];
  /**
   * Tasks built and merged on an earlier version that wait for a person's «Rebuild» or «Satisfied by main».
   * Stored as `wait_hold` with evidence `{reason: 'rebuild_decision'}`: the check constraint of 0060 lists the
   * kinds and a new one would need a migration.
   */
  rebuild?: readonly { code: string; built_on: number; now: number }[];
};

const dec = (task_code: string, decision: DecisionKind, extra: Partial<Omit<Decision, 'task_code' | 'decision'>> = {}): Decision => ({
  task_code,
  decision,
  item: extra.item ?? null,
  with_task: extra.with_task ?? null,
  with_source: extra.with_source ?? null,
  evidence: extra.evidence ?? null,
});

/** One decision per task the plan mentions, with its reason. Pure; decisions come in a stable order. */
export function decisionsOf(plan: Plan, input: DecisionsInput): Decision[] {
  const out: Decision[] = [];
  const seen = new Set<string>();
  const add = (d: Decision) => {
    if (seen.has(d.task_code)) return;
    seen.add(d.task_code);
    out.push(d);
  };
  for (const code of plan.running) add(dec(code, 'running'));
  for (const s of plan.start) add(dec(s.code, 'start', { evidence: { has_request: s.hasRequest } }));
  const waiting = enrichModuleWaiting(plan.moduleWaiting, plan.moduleContext?.actual ?? new Set(), plan.moduleContext?.hotspots ?? []);
  for (const w of waiting) {
    add(dec(w.code, 'wait_module', { item: w.item, with_task: w.with, with_source: w.with_source, evidence: { kind: w.kind, ...(w.hotspot ? { hotspot: w.hotspot } : {}) } }));
  }
  for (const code of plan.schemaWaiting) {
    add(dec(code, 'wait_schema', { with_task: plan.schemaWith[code] ?? null, evidence: { source: plan.schemaEvidence?.get(code) ?? null } }));
  }
  for (const code of plan.testabilityWaiting) {
    const flags = input.ready.find((t) => t.code === code)?.testability ?? [];
    add(dec(code, 'wait_testability', { item: flags[0]?.code ?? null, evidence: { criteria: flags.map((f) => ({ code: f.code, kind: f.kind, probability: f.probability })) } }));
  }
  for (const k of plan.silentSkips) {
    add(dec(k.code, k.reason === 'dependency' ? 'wait_dependency' : 'wait_feature_busy', { with_task: k.with }));
  }
  for (const s of plan.stoppedWaiting) add(dec(s.code, 'stopped', { item: s.kind, evidence: { kind: s.kind, tried: s.tried, ...(s.failure_kind ? { failure_kind: s.failure_kind } : {}) } }));
  for (const code of plan.overLimit) add(dec(code, 'over_limit'));
  for (const code of input.held ?? []) add(dec(code, 'wait_hold'));
  for (const r of input.rebuild ?? []) add(dec(r.code, 'wait_hold', { evidence: { reason: 'rebuild_decision', built_on: r.built_on, now: r.now } }));
  // A ready task the plan did not look at: main red stops the line, or the limit was already reached before choosing.
  const busy = plan.running.length + plan.start.length >= input.limit;
  for (const t of input.ready) {
    if (plan.stopped?.kind === 'main_red' && !seen.has(t.code)) add(dec(t.code, 'stopped', { item: 'main_red', evidence: { kind: 'main_red', task: plan.stopped.code } }));
    else if (!seen.has(t.code)) add(dec(t.code, busy ? 'over_limit' : 'stopped', busy ? {} : { item: plan.stopped?.kind ?? null }));
  }
  return out;
}

/** The hash of what the queue decided: running, started, stop and every decision. The same hash is not stored twice in a row. */
export function planHash(plan: Pick<Plan, 'running' | 'start' | 'stopped'>, decisions: readonly Decision[], limit: number, readyCount: number): string {
  const body = JSON.stringify([
    limit,
    readyCount,
    [...plan.running].sort(),
    plan.start.map((s) => s.code),
    plan.stopped ? [plan.stopped.kind, plan.stopped.code] : null,
    decisions.map((d) => [d.task_code, d.decision, d.item, d.with_task, d.with_source, d.evidence]),
  ]);
  return createHash('sha256').update(body).digest('hex');
}

async function lastHash(db: Db, projectId: string): Promise<string | null> {
  const row = await db
    .selectFrom('queue_plans')
    .select('plan_hash')
    .where('project_id', '=', projectId)
    .orderBy('decided_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.plan_hash ?? null;
}

async function write(
  db: Db,
  projectId: string,
  head: { trigger: PlanTrigger; limit: number; running: string[]; started: string[]; readyCount: number; stoppedKind: string | null; stoppedCode: string | null; hash: string },
  decisions: readonly Decision[],
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const plan = await trx
      .insertInto('queue_plans')
      .values({
        project_id: projectId,
        trigger: head.trigger,
        parallel_limit: head.limit,
        running: head.running,
        started: head.started,
        ready_count: head.readyCount,
        stopped_kind: head.stoppedKind,
        stopped_code: head.stoppedCode,
        plan_hash: head.hash,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (decisions.length > 0) {
      await trx
        .insertInto('queue_decisions')
        .values(
          decisions.map((d) => ({
            project_id: projectId,
            plan_id: plan.id,
            task_code: d.task_code,
            decision: d.decision,
            item: d.item,
            with_task: d.with_task,
            with_source: d.with_source,
            evidence: d.evidence ? JSON.stringify(d.evidence) : null,
          })),
        )
        .execute();
    }
    return plan.id;
  });
}

/** Stores the plan and its decisions unless the project's latest plan has the same hash. Returns the plan id, or null when nothing was written. */
export async function persistPlan(db: Db, projectId: string, plan: Plan, opts: DecisionsInput & { trigger: PlanTrigger }): Promise<string | null> {
  const decisions = decisionsOf(plan, opts);
  const hash = planHash(plan, decisions, opts.limit, opts.ready.length);
  if ((await lastHash(db, projectId)) === hash) return null;
  return write(
    db,
    projectId,
    {
      trigger: opts.trigger,
      limit: opts.limit,
      running: plan.running,
      started: plan.start.map((s) => s.code),
      readyCount: opts.ready.length,
      stoppedKind: plan.stopped?.kind ?? null,
      stoppedCode: plan.stopped?.code ?? null,
      hash,
    },
    decisions,
  );
}

/** The queue is off: one plan marked `queue_off` (no decisions), written only when the latest plan is not already that. */
export async function persistQueueOff(db: Db, projectId: string, trigger: PlanTrigger, limit: number): Promise<string | null> {
  const hash = createHash('sha256').update(JSON.stringify(['queue_off', limit])).digest('hex');
  if ((await lastHash(db, projectId)) === hash) return null;
  return write(db, projectId, { trigger, limit, running: [], started: [], readyCount: 0, stoppedKind: 'queue_off', stoppedCode: null, hash }, []);
}

/** A stored plan with its decisions, as `idleMinutes` reads it. */
export type StoredPlan = {
  decided_at: Date | string;
  parallel_limit: number;
  running: readonly string[];
  started: readonly string[];
  stopped_kind?: string | null;
  decisions: readonly { task_code: string; decision: DecisionKind }[];
};

export type IdleCause = 'stopped' | 'wait_module' | 'wait_schema' | 'wait_feature_busy' | 'wait_dependency' | 'wait_testability' | 'none_ready' | 'main_red' | 'queue_off';

export type IdleMinutes = {
  /** Build-minutes per cause: minutes × free slots (limit − running − started) of a plan, shared equally among its waits. */
  build: Partial<Record<IdleCause, number>>;
  /** Candidate-minutes: minutes a ready task spent blocked while a slot was free, by task and decision. */
  candidate: { task_code: string; decision: DecisionKind; minutes: number }[];
};

const WAITS: ReadonlySet<DecisionKind> = new Set(['stopped', 'wait_module', 'wait_schema', 'wait_feature_busy', 'wait_dependency', 'wait_testability']);

/**
 * Idle capacity from a sequence of stored plans (the audit's table, without rebuilding it by hand). A plan holds
 * from its `decided_at` to the next plan's (the last one to `until`, or not at all). While slots are free, the
 * build-minutes go to the plan's cause: queue off, main red, or its waiting tasks (shared equally: convención nuestra),
 * and `none_ready` when nothing waits. Not derivable from plans alone: the sleep between a change and the next tick
 * (plans are written only on change). Pure.
 */
export function idleMinutes(plans: readonly StoredPlan[], until?: Date | string): IdleMinutes {
  const build: Partial<Record<IdleCause, number>> = {};
  const cand = new Map<string, { task_code: string; decision: DecisionKind; minutes: number }>();
  const sorted = [...plans].sort((a, b) => new Date(a.decided_at).getTime() - new Date(b.decided_at).getTime());
  sorted.forEach((p, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1]?.decided_at : until;
    if (end === undefined) return;
    const minutes = Math.max(0, (new Date(end).getTime() - new Date(p.decided_at).getTime()) / 60_000);
    const free = Math.max(0, p.parallel_limit - p.running.length - p.started.length);
    if (minutes === 0 || free === 0) return;
    const slotMinutes = minutes * free;
    const addBuild = (cause: IdleCause, v: number) => void (build[cause] = (build[cause] ?? 0) + v);
    if (p.stopped_kind === 'queue_off') return addBuild('queue_off', slotMinutes);
    const waits = p.decisions.filter((d) => WAITS.has(d.decision));
    if (p.stopped_kind === 'main_red') addBuild('main_red', slotMinutes);
    else if (waits.length === 0) addBuild('none_ready', slotMinutes);
    else for (const w of waits) addBuild(w.decision === 'stopped' ? 'stopped' : (w.decision as IdleCause), slotMinutes / waits.length);
    for (const w of waits) {
      const key = `${w.task_code}|${w.decision}`;
      const prev = cand.get(key) ?? { task_code: w.task_code, decision: w.decision, minutes: 0 };
      prev.minutes += minutes;
      cand.set(key, prev);
    }
  });
  return { build, candidate: [...cand.values()] };
}

export type QueueDecisionRow = {
  plan_id: string;
  decided_at: string;
  trigger: PlanTrigger;
  parallel_limit: number;
  running: string[];
  started: string[];
  ready_count: number;
  stopped_kind: string | null;
  stopped_code: string | null;
  task_code: string | null;
  decision: DecisionKind | null;
  item: string | null;
  with_task: string | null;
  with_source: 'actual' | 'predicted' | null;
  evidence: unknown;
};

/** Every stored plan of the project, oldest first, one row per decision (a plan without decisions gives one row with null task fields). For the CSV export. */
export async function queueDecisionRows(db: Db, projectId: string, opts: { since?: Date | string } = {}): Promise<QueueDecisionRow[]> {
  let q = db
    .selectFrom('queue_plans as p')
    .leftJoin('queue_decisions as d', 'd.plan_id', 'p.id')
    .select([
      'p.id as plan_id',
      'p.decided_at',
      'p.trigger',
      'p.parallel_limit',
      'p.running',
      'p.started',
      'p.ready_count',
      'p.stopped_kind',
      'p.stopped_code',
      'd.task_code',
      'd.decision',
      'd.item',
      'd.with_task',
      'd.with_source',
      'd.evidence',
    ])
    .where('p.project_id', '=', projectId);
  if (opts.since !== undefined) q = q.where(sql<boolean>`p.decided_at >= ${new Date(opts.since).toISOString()}::timestamptz`);
  const rows = await q.orderBy('p.decided_at', 'asc').orderBy('p.id', 'asc').orderBy('d.task_code', 'asc').execute();
  return rows.map((r) => ({ ...r, decided_at: new Date(r.decided_at as unknown as Date).toISOString() }));
}

/** The API is draining for a restart: one plan marked `draining` (no decisions), written only when the latest plan is not already that. */
export async function persistDraining(db: Db, projectId: string, trigger: PlanTrigger, limit: number): Promise<string | null> {
  const hash = createHash('sha256').update(JSON.stringify(['draining', limit])).digest('hex');
  if ((await lastHash(db, projectId)) === hash) return null;
  return write(db, projectId, { trigger, limit, running: [], started: [], readyCount: 0, stoppedKind: 'draining', stoppedCode: null, hash }, []);
}
