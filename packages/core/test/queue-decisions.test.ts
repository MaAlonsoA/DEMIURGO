// «Build the queue» decisions (salud-del-harness §6.1): each branch of selectStarts yields its decision, the same plan
// hash writes nothing, the tables are insert-only and the idle minutes of a plan sequence reproduce the audit's causes.

import { human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { type Plan, type SelectInput, selectStarts } from '../src/build/auto.ts';
import { decisionsOf, idleMinutes, persistPlan, persistQueueOff, planHash, queueDecisionRows, type StoredPlan } from '../src/build/queue-decisions.ts';
import type { QueueTask } from '../src/build/queue.ts';
import type { TaskDependencyIndex } from '../src/queries/task-deps.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const task = (code: string, feature: string, testability: unknown[] = []): QueueTask => ({ code, title: code, feature: { code: feature, title: feature }, testability }) as unknown as QueueTask;
const emptyIndex = (over: Partial<Record<keyof TaskDependencyIndex, unknown>> = {}) =>
  ({ tasks: new Map(), features: new Map(), featureTasks: new Map(), taskFeature: new Map(), titles: new Map(), merged: new Map(), ...over }) as unknown as TaskDependencyIndex;

async function select(ready: QueueTask[], running: string[], over: Partial<SelectInput> = {}): Promise<Plan> {
  const picked = await selectStarts({
    ready,
    running,
    limit: 3,
    index: emptyIndex(),
    featureOf: (c) => ready.find((t) => t.code === c)?.feature?.code ?? null,
    stateOf: async () => ({ kind: 'start', hasRequest: false }),
    schema: new Map(),
    ...over,
  });
  return { running, ...picked };
}
const by = (ds: ReturnType<typeof decisionsOf>, code: string) => ds.find((d) => d.task_code === code);

describe('decisionsOf: one decision per branch of selectStarts', () => {
  it('start and running', async () => {
    const ready = [task('TSK-1', 'F1'), task('TSK-2', 'F2')];
    const ds = decisionsOf(await select(ready, ['TSK-9']), { ready, limit: 3 });
    expect(by(ds, 'TSK-9')?.decision).toBe('running');
    expect(by(ds, 'TSK-1')?.decision).toBe('start');
    expect(by(ds, 'TSK-2')?.decision).toBe('start');
  });

  it('wait_dependency names the busy task it depends on', async () => {
    const ready = [task('TSK-2', 'F2')];
    const index = emptyIndex({ tasks: new Map([['TSK-2', ['TSK-1']]]) });
    const ds = decisionsOf(await select(ready, ['TSK-1'], { index }), { ready, limit: 3 });
    expect(by(ds, 'TSK-2')).toMatchObject({ decision: 'wait_dependency', with_task: 'TSK-1' });
  });

  it('wait_feature_busy names the running task of the same feature', async () => {
    const ready = [task('TSK-2', 'F1')];
    const ds = decisionsOf(await select(ready, ['TSK-1'], { featureOf: (c) => (c === 'TSK-1' || c === 'TSK-2' ? 'F1' : null) }), { ready, limit: 3 });
    expect(by(ds, 'TSK-2')).toMatchObject({ decision: 'wait_feature_busy', with_task: 'TSK-1' });
  });

  it('wait_schema names the running schema task and carries the evidence', async () => {
    const ready = [task('TSK-2', 'F2')];
    const schema = new Map([
      ['TSK-1', 'footprint' as const],
      ['TSK-2', 'jev' as const],
    ]);
    const plan = await select(ready, ['TSK-1'], { schema });
    const ds = decisionsOf(plan, { ready, limit: 3 });
    expect(by(ds, 'TSK-2')).toMatchObject({ decision: 'wait_schema', with_task: 'TSK-1', evidence: { source: 'jev' } });
  });

  it('wait_module has the item, the blocker and where its file set came from', async () => {
    const ready = [task('TSK-2', 'F2')];
    const plan = await select(ready, ['TSK-1'], { predicted: new Map([['TSK-1', ['lib/a.ts']], ['TSK-2', ['lib/a.ts']]]), hotspots: new Set(['lib/a.ts']) });
    plan.moduleContext = { actual: new Set(['TSK-1']), hotspots: [{ path: 'lib/a.ts', tasks: 4, of: 10 }] };
    const ds = decisionsOf(plan, { ready, limit: 3 });
    expect(by(ds, 'TSK-2')).toMatchObject({ decision: 'wait_module', item: 'lib/a.ts', with_task: 'TSK-1', with_source: 'actual', evidence: { kind: 'hotspot', hotspot: { tasks: 4, of: 10 } } });
  });

  it('wait_testability names the first flagged criterion', async () => {
    const ready = [task('TSK-2', 'F2', [{ code: 'AC-1', kind: 'unverifiable', probability: 0.9, needs: null }])];
    const ds = decisionsOf(await select(ready, []), { ready, limit: 3 });
    expect(by(ds, 'TSK-2')).toMatchObject({ decision: 'wait_testability', item: 'AC-1' });
  });

  it('stopped: a task waiting for the person is skipped and the next one starts', async () => {
    const ready = [task('TSK-1', 'F1'), task('TSK-2', 'F2')];
    const plan = await select(ready, [], { stateOf: async (t) => (t.code === 'TSK-1' ? { kind: 'stopped', stopped: { code: 'TSK-1', kind: 'needs_you', tried: 3 } } : { kind: 'start', hasRequest: true }) });
    const ds = decisionsOf(plan, { ready, limit: 3 });
    expect(by(ds, 'TSK-1')).toMatchObject({ decision: 'stopped', item: 'needs_you', evidence: { tried: 3 } });
    expect(by(ds, 'TSK-2')?.decision).toBe('start');
  });

  it('over_limit: the tasks behind the limit', async () => {
    const ready = [task('TSK-1', 'F1'), task('TSK-2', 'F2'), task('TSK-3', 'F3')];
    const plan = await select(ready, [], { limit: 1 });
    const ds = decisionsOf(plan, { ready, limit: 1 });
    expect(by(ds, 'TSK-1')?.decision).toBe('start');
    expect(by(ds, 'TSK-2')?.decision).toBe('over_limit');
    expect(by(ds, 'TSK-3')?.decision).toBe('over_limit');
  });

  it('over_limit when the plan returns early with the limit already reached', () => {
    const ready = [task('TSK-4', 'F4')];
    const plan = { running: ['TSK-1', 'TSK-2'], start: [], stopped: null, stoppedWaiting: [], schemaWaiting: [], moduleWaiting: [], testabilityWaiting: [], silentSkips: [], schemaWith: {}, overLimit: [] } as Plan;
    expect(by(decisionsOf(plan, { ready, limit: 2 }), 'TSK-4')?.decision).toBe('over_limit');
  });

  it('main red stops every ready task', () => {
    const ready = [task('TSK-4', 'F4')];
    const plan = { running: [], start: [], stopped: { code: 'TSK-0', kind: 'main_red', tried: null }, stoppedWaiting: [], schemaWaiting: [], moduleWaiting: [], testabilityWaiting: [], silentSkips: [], schemaWith: {}, overLimit: [] } as Plan;
    expect(by(decisionsOf(plan, { ready, limit: 2 }), 'TSK-4')).toMatchObject({ decision: 'stopped', item: 'main_red' });
  });

  it('a merged task with a newer version waits for a decision: wait_hold with the rebuild_decision reason', async () => {
    const ds = decisionsOf(await select([], []), { ready: [], limit: 3, rebuild: [{ code: 'TSK-8', built_on: 2, now: 3 }] });
    expect(by(ds, 'TSK-8')).toMatchObject({ decision: 'wait_hold', evidence: { reason: 'rebuild_decision', built_on: 2, now: 3 } });
  });

  it('a held task is wait_hold', async () => {
    const ds = decisionsOf(await select([], []), { ready: [], limit: 3, held: ['TSK-7'] });
    expect(by(ds, 'TSK-7')?.decision).toBe('wait_hold');
  });
});

describe('planHash', () => {
  it('is stable for the same plan and changes with a decision', async () => {
    const ready = [task('TSK-1', 'F1')];
    const plan = await select(ready, []);
    const a = planHash(plan, decisionsOf(plan, { ready, limit: 3 }), 3, 1);
    expect(planHash(plan, decisionsOf(plan, { ready, limit: 3 }), 3, 1)).toBe(a);
    const other = await select(ready, ['TSK-9']);
    expect(planHash(other, decisionsOf(other, { ready, limit: 3 }), 3, 1)).not.toBe(a);
  });
});

describe('idleMinutes', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, 0) + min * 60_000);
  const plan = (min: number, limit: number, running: string[], decisions: StoredPlan['decisions'], extra: Partial<StoredPlan> = {}): StoredPlan => ({
    decided_at: at(min),
    parallel_limit: limit,
    running,
    started: [],
    decisions,
    ...extra,
  });

  it('splits free build-minutes per cause and candidate-minutes per task', () => {
    const r = idleMinutes(
      [
        // 10 min, limit 3, one running: 2 free slots, one stopped task: 20 build-minutes of `stopped`.
        plan(0, 3, ['A'], [{ task_code: 'S', decision: 'stopped' }]),
        // 5 min, 2 free slots shared by a module wait and a schema wait: 5 each.
        plan(10, 3, ['A'], [
          { task_code: 'M', decision: 'wait_module' },
          { task_code: 'Q', decision: 'wait_schema' },
        ]),
        // 4 min, 1 free slot, nothing waits.
        plan(15, 2, ['A'], []),
        // 6 min with the queue off, limit 3: 18 build-minutes.
        plan(19, 3, [], [], { stopped_kind: 'queue_off' }),
        // Full: no free slot, nothing counted. Ends at 40 (until).
        plan(25, 1, ['A'], [{ task_code: 'M', decision: 'wait_module' }]),
        plan(30, 3, ['A', 'B'], [{ task_code: 'M', decision: 'wait_module' }]),
      ],
      at(40),
    );
    expect(r.build).toEqual({ stopped: 20, wait_module: 5 + 10, wait_schema: 5, none_ready: 4, queue_off: 18 });
    expect(r.candidate).toEqual(
      expect.arrayContaining([
        { task_code: 'S', decision: 'stopped', minutes: 10 },
        { task_code: 'M', decision: 'wait_module', minutes: 5 + 10 },
        { task_code: 'Q', decision: 'wait_schema', minutes: 5 },
      ]),
    );
  });

  it('counts nothing for the last plan without an end', () => {
    expect(idleMinutes([plan(0, 3, [], [])])).toEqual({ build: {}, candidate: [] });
  });
});

const environment = useEnvironment();
const ana = human('ana');

describe('persistPlan (database)', () => {
  it('writes a plan once, nothing when the hash repeats, and a new one when it changes', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Queue decisions' } });
    const ready = [task('TSK-1', 'F1'), task('TSK-2', 'F1')];
    const plan = await select(ready, [], { featureOf: () => 'F1' });
    const opts = { ready, limit: 3, trigger: 'tick' as const };
    const first = await persistPlan(s.db, projectId, plan, opts);
    expect(first).not.toBeNull();
    expect(await persistPlan(s.db, projectId, plan, { ...opts, trigger: 'event' })).toBeNull();
    const rows = await queueDecisionRows(s.db, projectId);
    expect(rows.map((r) => [r.task_code, r.decision, r.with_task])).toEqual([
      ['TSK-1', 'start', null],
      ['TSK-2', 'wait_feature_busy', 'TSK-1'],
    ]);
    const changed = await select(ready, ['TSK-1'], { featureOf: () => 'F1' });
    expect(await persistPlan(s.db, projectId, changed, opts)).not.toBeNull();
    expect(await persistQueueOff(s.db, projectId, 'event', 3)).not.toBeNull();
    expect(await persistQueueOff(s.db, projectId, 'event', 3)).toBeNull();
    const all = await queueDecisionRows(s.db, projectId);
    expect(new Set(all.map((r) => r.plan_id)).size).toBe(3);
    expect(all.at(-1)).toMatchObject({ stopped_kind: 'queue_off', task_code: null });
    expect(await queueDecisionRows(s.db, projectId, { since: new Date(Date.now() + 60_000) })).toEqual([]);
  });

  it('the tables only admit INSERT', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Queue insert-only' } });
    await persistQueueOff(s.db, projectId, 'event', 1);
    await expect(sql`update queue_plans set parallel_limit = 2`.execute(s.db)).rejects.toThrow(/only admits INSERT/);
    await expect(sql`delete from queue_plans`.execute(s.db)).rejects.toThrow(/only admits INSERT/);
    await expect(sql`truncate queue_decisions`.execute(s.db)).rejects.toThrow(/only admits INSERT/);
  });
});
