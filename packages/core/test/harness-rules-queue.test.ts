// Queue rules (B01–B03) over synthetic inputs: one case per class, plus the old footprint format.

import { describe, expect, it } from 'vitest';
import type { ConcurrentRequest, QueueDecisionRow, QueuePlanRow } from '../src/harness/postmortem.ts';
import { queueParallelConflict, queueSkipVsFootprint, queueSlotIdle } from '../src/harness/rules/queue.ts';
import { at, inputs, mergedSteps, step, uid } from './support/harness-inputs.ts';

const decision = (minute: number, kind: string, over: Partial<QueueDecisionRow> = {}): QueueDecisionRow => ({
  id: uid('dec'),
  plan_id: uid('plan'),
  decided_at: at(minute),
  decision: kind,
  item: null,
  with_task: null,
  with_source: null,
  evidence: null,
  ...over,
});
const wait = (minute: number, withTask: string, item = 'src/design-system/index.ts') => decision(minute, 'wait_module', { item, with_task: withTask, with_source: 'predicted' });

describe('queue.skip_vs_footprint', () => {
  const run = (mine: string[], theirs: string[] | undefined, opts: { asString?: boolean } = {}) =>
    queueSkipVsFootprint(
      inputs({
        id: 'r1',
        steps: mergedSteps('r1', mine, { start: 30, end: 50, footprintAsString: opts.asString }),
        queueDecisions: [wait(0, 'TSK-B-001'), wait(10, 'TSK-B-001'), decision(30, 'start')],
        waitedFiles: theirs ? { 'TSK-B-001': theirs } : {},
      }),
    );

  it('is a tp when the real files of both tasks share a file, and costs the minutes waited', () => {
    const list = run(['src/design-system/index.ts', 'src/a.ts'], ['src/design-system/index.ts']);
    expect(list.map((f) => f.class)).toEqual(['tp', 'cost']);
    expect(list[0]).toMatchObject({ ground_truth: 'G01', subject: 'TSK-A-001~TSK-B-001' });
    expect(list[1]).toMatchObject({ unit: 'min', value: 30 });
  });
  it('is a fp when the real files are disjoint', () => {
    expect(run(['src/a.ts'], ['src/b.ts'])[0]!.class).toBe('fp');
  });
  it('reads the own footprint stored as a JSON string', () => {
    expect(run(['src/x.ts'], ['src/x.ts'], { asString: true })[0]!.class).toBe('tp');
  });
  it('says nothing when the waited task has no real files, or there are no decisions', () => {
    expect(run(['src/a.ts'], undefined)).toEqual([]);
    expect(queueSkipVsFootprint(inputs({ steps: mergedSteps('r', ['a']) }))).toEqual([]);
  });
  it('judges a wait_schema by schema files on both sides', () => {
    const list = queueSkipVsFootprint(
      inputs({
        id: 'r1',
        steps: mergedSteps('r1', ['migrations/0004_a.sql']),
        queueDecisions: [decision(0, 'wait_schema', { with_task: 'TSK-B-001' }), decision(5, 'start')],
        waitedFiles: { 'TSK-B-001': ['migrations/0004_b.sql'] },
      }),
    );
    expect(list[0]!.class).toBe('tp');
  });
});

describe('queue.parallel_conflict', () => {
  function pair(mine: string[], theirs: string[], extraOther: ConcurrentRequest['steps'] = [], opts: { asString?: boolean } = {}) {
    const other: ConcurrentRequest = {
      requestId: 'r0',
      taskCode: 'TSK-B-001',
      state: 'done',
      steps: [...mergedSteps('r0', theirs, { start: 0, end: 40 }), ...extraOther].sort((a, b) => +a.created_at - +b.created_at),
    };
    return queueParallelConflict(inputs({ id: 'r1', steps: mergedSteps('r1', mine, { start: 10, end: 60, footprintAsString: opts.asString }), concurrent: [other] }));
  }

  it('is a tn when they ran together without a conflict', () => {
    const list = pair(['src/a.ts'], ['src/b.ts']);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ class: 'tn', ground_truth: 'G02', subject: 'TSK-A-001~TSK-B-001' });
  });
  it('is a fn with its latency cost when a real conflict hit them', () => {
    const conflict = step('r1', 1, 'worktree', 'ok', { conflicts: ['e2e/spec.ts'] }, 20);
    const i = inputs({
      id: 'r1',
      steps: [...mergedSteps('r1', ['e2e/spec.ts'], { start: 10, end: 60 }), conflict].sort((a, b) => +a.created_at - +b.created_at),
      concurrent: [{ requestId: 'r0', taskCode: 'TSK-B-001', state: 'done', steps: mergedSteps('r0', ['e2e/spec.ts'], { start: 0, end: 40 }) }],
    });
    const list = queueParallelConflict(i);
    expect(list.map((f) => f.class)).toEqual(['fn', 'cost']);
    expect(list[0]!.evidence).toMatchObject({ shared_files: ['e2e/spec.ts'] });
    expect(list[1]).toMatchObject({ unit: 'min', value: 40 }); // from the conflict (20) to the merge (60)
  });
  it('is a fn for the latent conflict of two migrations with the same number', () => {
    const list = pair(['migrations/0004_cardio.sql'], ['migrations/0004_index.sql']);
    expect(list.map((f) => f.class)).toEqual(['fn']);
    expect(list[0]!.evidence).toMatchObject({ migration_numbers: ['0004'] });
  });
  it('reads real files stored as a JSON string and finds the merge-recheck conflict', () => {
    const recheck = step('r1', 1, 'merge', 'waiting', { recheck: true, reason: 'same_file' }, 30);
    const list = pair(['src/x.ts'], ['src/x.ts'], [], { asString: true });
    expect(list[0]!.class).toBe('tn'); // shared file but nobody met a conflict
    const i = inputs({
      id: 'r1',
      steps: [...mergedSteps('r1', ['src/x.ts'], { start: 10, end: 60, footprintAsString: true }), recheck].sort((a, b) => +a.created_at - +b.created_at),
      concurrent: [{ requestId: 'r0', taskCode: 'TSK-B-001', state: 'done', steps: mergedSteps('r0', ['src/x.ts'], { start: 0, end: 40 }) }],
    });
    expect(queueParallelConflict(i)[0]!.class).toBe('fn');
  });
  it('is judged once, by the request that started later, and ignores requests that did not overlap', () => {
    const earlier = inputs({ id: 'r0', steps: mergedSteps('r0', ['a'], { start: 0, end: 40 }), concurrent: [{ requestId: 'r1', taskCode: 'TSK-B-001', state: 'done', steps: mergedSteps('r1', ['b'], { start: 10, end: 60 }) }] });
    expect(queueParallelConflict(earlier)).toEqual([]);
    const apart = inputs({ id: 'r1', steps: mergedSteps('r1', ['a'], { start: 100, end: 120 }), concurrent: [{ requestId: 'r0', taskCode: 'TSK-B-001', state: 'done', steps: mergedSteps('r0', ['b'], { start: 0, end: 40 }) }] });
    expect(queueParallelConflict(apart)).toEqual([]);
  });
});

describe('queue.parallel_conflict: windows, tasks and attribution (pm-2)', () => {
  const other = (requestId: string, taskCode: string, steps: ConcurrentRequest['steps']): ConcurrentRequest => ({ requestId, taskCode, state: 'done', steps });

  it('footprint and main steps written after the merge do not stretch the window (270 of 295 TN were artefacts)', () => {
    const early = [...mergedSteps('r0', ['src/a.ts'], { start: 0, end: 40 }), step('r0', 1, 'footprint', 'ok', null, 300), step('r0', 1, 'main', 'ok', null, 310)];
    // r1 starts at minute 100, long after r0 merged: they never ran together.
    expect(queueParallelConflict(inputs({ id: 'r1', steps: mergedSteps('r1', ['src/b.ts'], { start: 100, end: 120 }), concurrent: [other('r0', 'TSK-B-001', early)] }))).toEqual([]);
  });
  it('never pairs a request with another request of the same task', () => {
    const list = queueParallelConflict(inputs({ id: 'r1', steps: mergedSteps('r1', ['src/b.ts'], { start: 10, end: 60 }), concurrent: [other('r0', 'TSK-A-001', mergedSteps('r0', ['src/b.ts'], { start: 0, end: 40 }))] }));
    expect(list).toEqual([]);
  });
  it('never pairs a request with itself', () => {
    expect(queueParallelConflict(inputs({ id: 'r1', steps: mergedSteps('r1', ['a'], { start: 10, end: 60 }), concurrent: [other('r1', 'TSK-B-001', mergedSteps('r1', ['a'], { start: 0, end: 40 }))] }))).toEqual([]);
  });
  it('catches the conflict met after the other request merged (TSK-WOR-008 ~ TSK-MEA-032), naming files through the worktree step', () => {
    const files = ['src/app/page.tsx', 'src/design-system/index.ts'];
    const merged = mergedSteps('rMEA', files, { start: 0, end: 50 }); // merges at minute 50
    const mine = [
      ...mergedSteps('rWOR', files, { start: 10, end: 90 }),
      step('rWOR', 2, 'merge', 'changes_requested', { conflict: true }, 70), // no conflict_files
      step('rWOR', 2, 'worktree', 'ok', { conflicts: ['src/design-system/index.ts'] }, 71),
    ].sort((a, b) => +a.created_at - +b.created_at);
    const list = queueParallelConflict(inputs({ id: 'rWOR', taskCode: 'TSK-WOR-008', steps: mine, concurrent: [other('rMEA', 'TSK-MEA-032', merged)] }));
    expect(list.map((f) => f.class)).toEqual(['fn', 'cost']);
    expect(list[0]).toMatchObject({ subject: 'TSK-WOR-008~TSK-MEA-032' });
    expect(list[1]).toMatchObject({ unit: 'min', value: 20 }); // from the conflict (70) to the merge (90)
  });
  it('a conflict after the other withdrew (no merge) is not that pair\'s', () => {
    const gone = [step('rX', 1, 'repo', 'started', null, 0), step('rX', 1, 'commit', 'ok', { files: ['src/a.ts'] }, 10), step('rX', 1, 'merge', 'failed', null, 20)];
    const mine = [...mergedSteps('rY', ['src/a.ts'], { start: 5, end: 90 }), step('rY', 1, 'worktree', 'ok', { conflicts: ['src/a.ts'] }, 60)].sort((a, b) => +a.created_at - +b.created_at);
    expect(queueParallelConflict(inputs({ id: 'rY', steps: mine, concurrent: [other('rX', 'TSK-B-001', gone)] })).map((f) => f.class)).toEqual(['tn']);
  });
  it('a conflict step is attributed to one pair only: the request merged most recently before it', () => {
    const f = ['src/shared.ts'];
    const early = other('r0', 'TSK-B-001', mergedSteps('r0', f, { start: 0, end: 30 }));
    const late = other('r2', 'TSK-C-001', mergedSteps('r2', f, { start: 5, end: 50 }));
    const mine = [...mergedSteps('r1', f, { start: 10, end: 90 }), step('r1', 1, 'worktree', 'ok', { conflicts: f }, 60)].sort((a, b) => +a.created_at - +b.created_at);
    const list = queueParallelConflict(inputs({ id: 'r1', steps: mine, concurrent: [early, late] }));
    const fns = list.filter((x) => x.class === 'fn');
    const costs = list.filter((x) => x.class === 'cost');
    expect(fns).toHaveLength(1);
    expect(fns[0]!.subject).toBe('TSK-A-001~TSK-C-001');
    expect(costs).toHaveLength(1); // the cost of the conflict is counted once
    expect(list.filter((x) => x.class === 'tn').map((x) => x.subject)).toEqual(['TSK-A-001~TSK-B-001']);
  });
});

describe('queue.slot_idle', () => {
  const plan = (minute: number, over: Partial<QueuePlanRow> = {}): QueuePlanRow => ({ id: uid('plan'), decided_at: at(minute), parallel_limit: 3, running: ['TSK-X-001'], started: [], stopped_kind: null, ...over });

  it('adds the minutes a slot stood free while the task waited, by cause', () => {
    const p1 = plan(0);
    const p2 = plan(10, { stopped_kind: 'needs_you' });
    const p3 = plan(25, { running: ['a', 'b', 'c'] }); // no free slot
    const p4 = plan(40, { running: [], started: ['TSK-A-001'] });
    const list = queueSlotIdle(
      inputs({ queuePlans: [p1, p2, p3, p4], queueDecisions: [decision(0, 'wait_module', { plan_id: p1.id, with_task: 'TSK-B-001' }), decision(10, 'wait_module', { plan_id: p2.id, with_task: 'TSK-B-001' })] }),
    );
    const v = (subject: string) => list.find((f) => f.subject === subject)?.value;
    expect(v('wait_module/candidate_min')).toBe(10);
    expect(v('wait_module/build_min')).toBe(20); // 10 min x 2 free slots
    expect(v('stopped/candidate_min')).toBe(15);
    expect(v('stopped/build_min')).toBe(30);
    expect(list.every((f) => f.class === 'cost' && f.unit === 'min')).toBe(true);
  });
  it('says nothing without two plans or without an explanation', () => {
    expect(queueSlotIdle(inputs({ queuePlans: [plan(0)] }))).toEqual([]);
    expect(queueSlotIdle(inputs({ queuePlans: [plan(0), plan(10)] }))).toEqual([]);
  });
});
