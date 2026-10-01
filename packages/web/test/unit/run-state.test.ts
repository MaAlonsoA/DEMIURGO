// How a run's state reads (DESIGN.md §4.2, D-011): Late after a minute in the queue, Stalled after
// 90 s without a sign from the engine, failures in the last day that nobody retried.

import { describe, expect, it } from 'vitest';
import { attemptOf, runView, unresolvedFailures } from '../../src/components/runState.tsx';
import type { RunListItem } from '../../src/api/types.ts';

const t0 = Date.parse('2026-09-25T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

function run(p: Partial<RunListItem>): RunListItem {
  return {
    id: 'r1',
    state: 'running',
    action: 'exploration_chat',
    scope: { type: 'exploration', id: 'e1' },
    provider: 'simulated',
    model: null,
    retry_of: null,
    failure_kind: null,
    error: null,
    requested_by: 'human:ana',
    created_at: iso(t0),
    started_at: iso(t0),
    finished_at: null,
    context_pack_hash: null,
    exploration_id: 'e1',
    batch_id: null,
    ...p,
  };
}

describe('the state of a run as the person reads it', () => {
  it('a queued run is Queued, and Late after a minute, saying how long it waited', () => {
    const r = run({ state: 'queued', started_at: null });
    expect(runView(r, { now: t0 + 30_000, lastProgress: null, since: t0 }).kind).toBe('queued');
    const late = runView(r, { now: t0 + 125_000, lastProgress: null, since: t0 });
    expect(late).toMatchObject({ kind: 'late', word: 'Late', mark: 'stale', active: true });
    expect(late.detail).toBe('Queued for 2:05');
  });

  it('with history, a quiet counter reads «Writing the result…» within p80, and Stalled waits for p80 x 1.5', () => {
    const r = run({ typical: { median_s: 480, p80_s: 600, n: 5 } });
    const at = (ms: number, lastProgress: number | null) => runView(r, { now: t0 + ms, lastProgress, lastTokenMove: t0 + 5_000, since: t0 });
    const quiet = at(200_000, t0 + 5_000);
    expect(quiet).toMatchObject({ kind: 'working', writing: 'Writing the result…', usually: 'Usually takes about 8 min', detail: null });
    // 90 s of silence before p80 x 1.5 (900 s) is not Stalled.
    expect(at(700_000, t0 + 5_000)).toMatchObject({ kind: 'working', writing: null, detail: null });
    const slow = at(950_000, t0 + 5_000);
    expect(slow).toMatchObject({ kind: 'stalled', detail: 'Taking longer than usual (usually about 8 min)' });
    // Counter still talking after p80 x 1.5: Working, with the slow note.
    expect(at(950_000, t0 + 940_000)).toMatchObject({ kind: 'working', detail: 'Taking longer than usual (usually about 8 min)' });
  });

  it('with fewer than 3 completed runs the history is ignored', () => {
    const r = run({ typical: { median_s: 480, p80_s: 600, n: 2 } });
    const v = runView(r, { now: t0 + 200_000, lastProgress: t0 + 60_000, since: t0 });
    expect(v).toMatchObject({ kind: 'stalled', usually: null, writing: null });
  });

  it('a running run is Working while its engine speaks, and Stalled after 90 s of silence', () => {
    const r = run({});
    expect(runView(r, { now: t0 + 80_000, lastProgress: null, since: t0 }).kind).toBe('working');
    expect(runView(r, { now: t0 + 200_000, lastProgress: t0 + 150_000, since: t0 }).kind).toBe('working');
    const stalled = runView(r, { now: t0 + 200_000, lastProgress: t0 + 60_000, since: t0 });
    expect(stalled).toMatchObject({ kind: 'stalled', word: 'Stalled', mark: 'stale' });
    expect(stalled.detail).toBe('No sign of activity for 2:20');
  });

  it('silence counts from when the tab started listening, not from before it', () => {
    const r = run({ started_at: iso(t0 - 600_000) });
    expect(runView(r, { now: t0 + 30_000, lastProgress: null, since: t0 }).kind).toBe('working');
  });

  it('finished runs keep the words of the tables: Failed and Interrupted stay apart', () => {
    expect(runView(run({ state: 'failed' }), { now: t0, lastProgress: null })).toMatchObject({
      kind: 'failed',
      word: 'Failed',
      active: false,
    });
    expect(runView(run({ state: 'interrupted' }), { now: t0, lastProgress: null })).toMatchObject({
      kind: 'interrupted',
      word: 'Interrupted',
    });
    expect(runView(run({ state: 'completed' }), { now: t0, lastProgress: null })).toMatchObject({
      kind: 'completed',
      mark: 'done',
    });
    expect(runView(run({ state: 'cancelled' }), { now: t0, lastProgress: null })).toMatchObject({
      kind: 'cancelled',
      mark: 'inactive',
    });
  });

  it('the sidebar counts failures of the last 24 h that nobody retried', () => {
    const runs = [
      run({ id: 'a', state: 'failed', finished_at: iso(t0 - 3_600_000) }),
      run({ id: 'b', state: 'interrupted', finished_at: iso(t0 - 60_000) }),
      run({ id: 'c', state: 'running', retry_of: 'b' }),
      run({ id: 'd', state: 'failed', finished_at: iso(t0 - 30 * 3_600_000) }),
      run({ id: 'e', state: 'completed', finished_at: iso(t0 - 60_000) }),
    ];
    expect(unresolvedFailures(runs, t0).map((r) => r.id)).toEqual(['a']);
  });

  it('a retry is attempt n of its chain', () => {
    const a = run({ id: 'a' });
    const c = run({ id: 'c', retry_of: 'b' });
    const runs = [a, run({ id: 'b', retry_of: 'a' }), c];
    expect(attemptOf(a, runs)).toBe(1);
    expect(attemptOf(c, runs)).toBe(3);
  });
});
