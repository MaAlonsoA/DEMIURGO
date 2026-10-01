// Dependencies per task: a task waits only for the unmerged tasks of the needed features that it needs.

import { dependencyReasons, needNotBuiltReason } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import '../src/bus/bus.ts'; // loads the core in its usual order (the modules import each other)
import { TASK_NEED_THRESHOLD, taskNeedsWait } from '../src/classifier/task-needs.ts';
import { type TaskDependencyIndex, pairKey, taskWaitsFrom, waitedTaskCodes } from '../src/queries/task-deps.ts';

describe('taskNeedsWait', () => {
  it('waits without an opinion (conservative, as before)', () => {
    expect(taskNeedsWait(undefined)).toBe(true);
  });
  it('waits from the threshold and not below it', () => {
    expect(taskNeedsWait(TASK_NEED_THRESHOLD)).toBe(true);
    expect(taskNeedsWait(0.49)).toBe(false);
  });
  it('always waits for an explicit link', () => {
    expect(taskNeedsWait(0.01, true)).toBe(true);
  });
});

function index(needs: [string, number][]): TaskDependencyIndex {
  return {
    tasks: new Map(),
    features: new Map(),
    featureTasks: new Map([['FDR-B', ['TSK-B1', 'TSK-B2', 'TSK-B3']], ['FDR-A', ['TSK-A1']]]),
    taskFeature: new Map([['TSK-A1', 'FDR-A']]),
    titles: new Map([['TSK-B1', 'One'], ['TSK-B2', 'Two']]),
    merged: new Map([['TSK-B1', false], ['TSK-B2', false], ['TSK-B3', true]]),
    featureNeeds: new Map([['FDR-A', ['FDR-B']]]),
    needs: new Map(needs.map(([k, p]) => [pairKey('TSK-A1', k), p])),
  };
}

describe('taskWaitsFrom with needed features', () => {
  it('waits for every unmerged task of a needed feature when Jev has no opinion', () => {
    const w = taskWaitsFrom(index([]), 'TSK-A1', 'FDR-A');
    expect(w.needed?.map((t) => t.code)).toEqual(['TSK-B1', 'TSK-B2']);
    expect(w.replacesNeeds).toEqual(['FDR-B']);
    expect(dependencyReasons(w)).toContain('Waits for TSK-B1 One (FDR-B, not merged yet).');
  });
  it('waits only for the tasks Jev says it needs', () => {
    const idx = index([['TSK-B1', 0.9], ['TSK-B2', 0.1]]);
    const w = taskWaitsFrom(idx, 'TSK-A1', 'FDR-A');
    expect(w.needed?.map((t) => t.code)).toEqual(['TSK-B1']);
    expect(waitedTaskCodes(idx, 'TSK-A1', 'FDR-A')).toEqual(['TSK-B1']);
  });
  it('does not wait when no unmerged task is needed, but still replaces the feature-level reason', () => {
    const w = taskWaitsFrom(index([['TSK-B1', 0.1], ['TSK-B2', 0.2]]), 'TSK-A1', 'FDR-A');
    expect(dependencyReasons(w)).toEqual([]);
    expect(w.replacesNeeds).toEqual(['FDR-B']);
    expect(needNotBuiltReason('FDR-B')).toBe('It needs FDR-B, which is not built yet.');
  });
  it('keeps the feature-level reason when the needed feature has no unmerged task', () => {
    const idx = index([]);
    idx.merged.set('TSK-B1', true);
    idx.merged.set('TSK-B2', true);
    expect(taskWaitsFrom(idx, 'TSK-A1', 'FDR-A').replacesNeeds).toEqual([]);
  });
});
