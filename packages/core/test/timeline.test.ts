import { describe, expect, it } from 'vitest';
import { type TimelineRequestRow, type TimelineStepRow, affectedTestsOf, buildTimeline } from '../src/build/timeline.ts';

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const now = new Date(T0 + 120 * 60_000);
const since = new Date(T0 - 60_000);
const req = (id: string, code: string, state: string, extra: Partial<TimelineRequestRow> = {}): TimelineRequestRow => ({
  id,
  task_code: code,
  state,
  requested_by: 'human:admin',
  requested_at: new Date(T0),
  pr_url: null,
  pr_number: null,
  ...extra,
});
const step = (id: string, attempt: number, stage: string, outcome: string, min: number, detail: unknown = null): TimelineStepRow => ({
  build_request_id: id,
  attempt,
  stage,
  outcome,
  at: new Date(T0 + min * 60_000),
  detail,
});

const clean = (id: string, offset = 0): TimelineStepRow[] => [
  step(id, 1, 'repo', 'started', offset, { started_by: 'human:admin' }),
  step(id, 1, 'repo', 'ok', offset + 0.1),
  step(id, 1, 'environment', 'started', offset + 0.1),
  step(id, 1, 'environment', 'ok', offset + 0.5),
  step(id, 1, 'builder', 'started', offset + 0.5),
  step(id, 1, 'builder', 'ok', offset + 10, {
    model: 'sonnet',
    session: { mode: 'resumed', id: 'secret-session', hostDir: '/secret/dir' },
    code_to_extend: {
      files: ['a.ts', 'b.ts'],
      classifier_id: 'x',
      commit: 'abcdef0123456789',
      section: 'Code\nBefore finishing, run the tests that depend on what you change: a.test.ts, b.test.ts and 3 more; the full suite runs in CI.',
    },
    progress: 'p'.repeat(1000),
    report: { tests: [{}, {}], notes: 'done' },
  }),
  step(id, 1, 'ci', 'started', offset + 11),
  step(id, 1, 'ci', 'waiting', offset + 11, { head_sha: 'deadbeef00112233' }),
  step(id, 1, 'ci', 'ok', offset + 16, { conclusion: 'success', head_sha: 'deadbeef00112233' }),
  step(id, 1, 'pr', 'ok', offset + 11.5, { number: 27 }),
  step(id, 1, 'review', 'started', offset + 16),
  step(id, 1, 'review', 'ok', offset + 17, { verdict: 'approve', comments_count: 0 }),
  step(id, 1, 'merge', 'started', offset + 17),
  step(id, 1, 'merge', 'waiting', offset + 17.1, { behind_by: 0 }),
  step(id, 1, 'merge', 'ok', offset + 18),
  step(id, 1, 'main', 'ok', offset + 24, { conclusion: 'success' }),
];

describe('build timeline', () => {
  it('turns a clean merged request into stage segments, a merge and a main line', () => {
    const t = buildTimeline([req('a', 'TSK-A-001', 'done')], clean('a', 5), { now, since });
    const r = t.requests[0]!;
    const a = r.attempts[0]!;
    expect(r.running).toBe(false);
    expect(a.result).toBe('merged');
    expect(a.segments.map((s) => s.kind)).toEqual(expect.arrayContaining(['prep', 'builder', 'wait', 'review', 'main']));
    expect(a.segments.find((s) => s.kind === 'builder')).toMatchObject({ start: new Date(T0 + 5.5 * 60_000).toISOString(), end: new Date(T0 + 15 * 60_000).toISOString() });
    expect(t.merges).toEqual([{ task_code: 'TSK-A-001', at: new Date(T0 + 23 * 60_000).toISOString(), pr_number: null }]);
    expect(a.out).toMatchObject({ pr_number: 27, head_sha: 'deadbeef', ci: 'success', review: { verdict: 'approve', comments: 0 } });
    expect(a.out.main?.conclusion).toBe('success');
  });

  it('keeps only what the view needs of the builder: no session id, no host dir, cut texts', () => {
    const a = buildTimeline([req('a', 'TSK-A-001', 'done')], clean('a'), { now, since }).requests[0]!.attempts[0]!;
    expect(a.builder?.session).toEqual({ mode: 'resumed', reason: null });
    expect(a.builder?.code_to_extend).toMatchObject({ files: 2, first_files: ['a.ts', 'b.ts'], ordered_by_jev: true, commit: 'abcdef01' });
    expect(a.builder?.affected_tests).toEqual({ count: 5, first: ['a.test.ts', 'b.test.ts'] });
    expect(a.builder?.progress?.length).toBeLessThanOrEqual(320);
    expect(a.builder?.progress_chars).toBe(1000);
    expect(a.builder?.tests_written).toBe(2);
    expect(JSON.stringify(a)).not.toMatch(/secret/);
  });

  it('shows retries with who started them, the gap between attempts and what ended the first', () => {
    const id = 'b';
    const rows = [
      step(id, 1, 'repo', 'started', 0, { started_by: 'human:admin' }),
      step(id, 1, 'builder', 'started', 1),
      step(id, 1, 'builder', 'failed', 3, { error: 'boom', failure_kind: 'timeout', model: 'opus' }),
      step(id, 2, 'repo', 'started', 10, { started_by: 'system:build@1', automatic: true, reason: 'The reviewer asked for changes.' }),
      step(id, 2, 'builder', 'started', 11),
      step(id, 2, 'builder', 'ok', 15, { model: 'opus' }),
      step(id, 2, 'review', 'changes_requested', 16, { comments_count: 3 }),
      step(id, 2, 'merge', 'changes_requested', 16.5, { reason: 'The reviewer asked for changes.', blocking: 2, next_attempt: 3 }),
    ];
    const r = buildTimeline([req(id, 'TSK-B-001', 'in_review')], rows, { now, since }).requests[0]!;
    const [first, second] = r.attempts;
    expect(first).toMatchObject({ n: 1, result: 'failed', gap_before_ms: null });
    expect(first!.ended_by).toMatchObject({ stage: 'builder', outcome: 'failed', failure_kind: 'timeout', reason: 'boom' });
    expect(second).toMatchObject({ n: 2, automatic: true, start_reason: 'The reviewer asked for changes.', result: 'changes_requested' });
    expect(second!.gap_before_ms).toBe(7 * 60_000);
  });

  it('closes a retry attempt that changes were requested on, and runs the open one up to now', () => {
    const id = 'c';
    const closed = [
      step(id, 1, 'repo', 'started', 0),
      step(id, 1, 'review', 'changes_requested', 5, { comments_count: 1 }),
      step(id, 1, 'merge', 'changes_requested', 6, { blocking: 1, reason: 'The reviewer asked for changes.' }),
    ];
    const a = buildTimeline([req(id, 'TSK-C-001', 'in_review')], closed, { now, since }).requests[0]!.attempts[0]!;
    // The only attempt of an open request is the one in progress unless it ended.
    expect(a.result).toBe('changes_requested');
    expect(a.ended_by).toMatchObject({ stage: 'merge', blocking: 1 });
    const live = [step(id, 1, 'repo', 'started', 100), step(id, 1, 'builder', 'started', 101)];
    const l = buildTimeline([req(id, 'TSK-C-001', 'requested')], live, { now, since }).requests[0]!;
    expect(l.running).toBe(true);
    const seg = l.attempts[0]!.segments.at(-1)!;
    expect(seg).toMatchObject({ stage: 'builder', kind: 'builder', outcome: 'running', end: now.toISOString() });
  });

  it('a withdrawn request is cancelled, never running; empty input gives an empty timeline', () => {
    const id = 'd';
    const rows = [step(id, 1, 'repo', 'started', 0), step(id, 1, 'builder', 'started', 1), step(id, 1, 'withdraw', 'cancelled', 4, { reason: 'x' })];
    const r = buildTimeline([req(id, 'TSK-D-001', 'withdrawn')], rows, { now, since }).requests[0]!;
    expect(r.attempts[0]!.result).toBe('cancelled');
    expect(r.running).toBe(false);
    expect(buildTimeline([], [], { now, since })).toMatchObject({ requests: [], merges: [], truncated: false });
  });

  it('collapses repo, workspace and environment into one «prepare» segment and leaves mechanical stages out of the bars', () => {
    const a = buildTimeline([req('a', 'TSK-A-001', 'done')], clean('a'), { now, since }).requests[0]!.attempts[0]!;
    const stages = a.segments.map((s) => s.stage);
    expect(stages.filter((s) => s === 'prepare')).toHaveLength(1);
    for (const mech of ['repo', 'worktree', 'commit', 'design', 'push', 'pr', 'status', 'evidence', 'publish']) expect(stages).not.toContain(mech);
    expect(a.checkpoint).toEqual({ reached: true, problems: [] });
  });

  it('names the mechanical stage that failed with its error, and the merge decision', () => {
    const id = 'e';
    const rows = [
      step(id, 1, 'repo', 'started', 0),
      step(id, 1, 'builder', 'ok', 5, { test_reuse: [{ criterion: 'AC-1', path: 'a.test.ts', title: 't', p: 0.9 }] }),
      step(id, 1, 'design', 'started', 6),
      step(id, 1, 'design', 'failed', 6.1, { violations: [{}, {}], ownership: [], test_guard: { violations: 1 } }),
    ];
    const a = buildTimeline([req(id, 'TSK-E-001', 'in_review')], rows, { now, since }).requests[0]!.attempts[0]!;
    expect(a.checkpoint.reached).toBe(false);
    expect(a.checkpoint.problems).toEqual([{ stage: 'design', outcome: 'failed', error: '2 design violations, 1 duplicate tests' }]);
    expect(a.builder?.test_reuse).toEqual({ count: 1, first: [{ criterion: 'AC-1', path: 'a.test.ts' }] });
    const m = [step(id, 1, 'merge', 'waiting', 1, { recheck: false, reason: 'disjoint', behind_by: 2 }), step(id, 1, 'merge', 'ok', 2)];
    const b = buildTimeline([req('m', 'TSK-M-001', 'done')], m.map((x) => ({ ...x, build_request_id: 'm' })), { now, since }).requests[0]!.attempts[0]!;
    expect(b.out.merge).toEqual({ behind_by: 2, recheck: false, reason: 'disjoint', updated_from_base: false });
  });

  it('parses the affected tests line and ignores text without it', () => {
    expect(affectedTestsOf('Before finishing, run the tests that depend on what you change: x.spec.ts; the full suite runs in CI.')).toEqual({ count: 1, first: ['x.spec.ts'] });
    expect(affectedTestsOf('nothing')).toBeNull();
    expect(affectedTestsOf(null)).toBeNull();
  });
});
