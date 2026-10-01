// TDD gate rules (salud-del-harness 1.4): one case per class, over synthetic post-mortem inputs (pure, no database).

import { describe, expect, it } from 'vitest';
import type { PostmortemInputs } from '../src/harness/postmortem.ts';
import { tddGate, tddLoopCost, tddSkipped } from '../src/harness/rules/tdd.ts';

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 12, 0, clock++));
const step = (attempt: number, stage: string, outcome: string, detail: unknown, id = `s${clock}`) => ({ id, project_id: 'p', build_request_id: 'r', attempt, stage, outcome, detail, created_at: at() });
const inputs = (steps: ReturnType<typeof step>[], testRuns: unknown[] = []): PostmortemInputs =>
  ({ request: { id: 'r', state: 'done' }, taskCode: 'TSK-X-001', steps, reviews: [], codeOpinions: [], layersOpinion: null, testRuns }) as unknown as PostmortemInputs;
const builder = (tdd: unknown, attempt = 1) => step(attempt, 'builder', 'ok', { tdd });
const ci = (outcome: 'ok' | 'failed', attempt = 1) => step(attempt, 'ci', outcome, { conclusion: outcome === 'ok' ? 'success' : 'failure' });
const classes = (f: { class: string }[]) => f.map((x) => x.class);

describe('tdd.gate', () => {
  it('benefit: the gate looped once and the first CI was green (a red CI avoided)', () => {
    const f = tddGate(inputs([builder({ status: 'passed', red: [{ outcome: 'failed', criterion: 'AC-X-001-01' }], green: null, loops: 1 }), ci('ok')]));
    expect(classes(f)).toEqual(['tp', 'benefit']);
    expect(f.find((x) => x.class === 'benefit')).toMatchObject({ value: 1, unit: 'ci_runs', ground_truth: 'G05' });
  });
  it('benefit in tests: a criterion test that passed on main without the change', () => {
    const f = tddGate(inputs([builder({ status: 'red', red: [{ outcome: 'passed', criterion: 'AC-X-001-02', test: 't', path: 'a.spec.ts' }, { outcome: 'already_green_on_main', criterion: 'AC-X-001-03' }], green: null, loops: 15, stopped: 'cap' })]));
    expect(f.find((x) => x.class === 'benefit')).toMatchObject({ value: 1, unit: 'tests', subject: 'AC-X-001-02' });
  });
  it('fp: the red was explained by the environment', () => {
    const f = tddGate(inputs([builder({ status: 'passed', red: [{ outcome: 'not_run', criterion: 'AC-X-001-01' }], green: null, loops: 1, notes: ['Main did not build'] }), ci('ok')]));
    expect(classes(f)).toEqual(['fp']);
  });
  it('fn: passed and the CI of the attempt failed in a criterion test', () => {
    const f = tddGate(inputs([builder({ status: 'passed', red: [], green: null, loops: 0 }), ci('failed')], [{ attempt: 1, outcome: 'fail', criterion_code: 'AC-X-001-01' }]));
    expect(classes(f)).toEqual(['fn']);
  });
  it('tn: passed at once and the CI was green', () => {
    expect(classes(tddGate(inputs([builder({ status: 'passed', red: [], green: null, loops: 0 }), ci('ok')])))).toEqual(['tn']);
  });
  it('info: passed and a CI red that is not a criterion test, or stopped red', () => {
    expect(classes(tddGate(inputs([builder({ status: 'passed', red: [], green: null, loops: 0 }), ci('failed')])))).toEqual(['info']);
    expect(classes(tddGate(inputs([builder({ status: 'red', red: [], green: null, loops: 2, stopped: 'builder_failed' })])))).toEqual(['info']);
  });
  it('ignores a cancelled CI when looking for the first decisive one', () => {
    const cancelled = step(1, 'ci', 'failed', { conclusion: 'cancelled', cancelled: true });
    expect(classes(tddGate(inputs([builder({ status: 'passed', red: [], green: null, loops: 0 }), cancelled, ci('ok')])))).toEqual(['tn']);
  });
});

describe('tdd.skipped', () => {
  it('records why the gate concluded nothing', () => {
    const f = tddSkipped(inputs([builder({ status: 'skipped', red: [], green: null, loops: 0, skipped: 'The task covers no criterion.' })]));
    expect(f).toMatchObject([{ finding: 'tdd.skipped', class: 'info', subject: 'The task covers no criterion.' }]);
    expect(tddGate(inputs([builder({ status: 'skipped', red: [], green: null, loops: 0, skipped: 'x' })]))).toEqual([]);
  });
});

describe('tdd.loop_cost', () => {
  it('prices each loop in minutes and tokens', () => {
    const f = tddLoopCost(inputs([builder({ status: 'passed', red: [], green: null, loops: 2, loop_runs: [{ loop: 1, duration_ms: 120_000, usage: { inputTokens: 100, outputTokens: 20, durationMs: 1 } }, { loop: 2, duration_ms: 30_000 }] })]));
    expect(f.map((x) => [x.subject, x.unit, x.value])).toEqual([
      ['loop 1', 'min', 2],
      ['loop 1', 'tokens', 120],
      ['loop 2', 'min', 0.5],
    ]);
    expect(f.every((x) => x.class === 'cost')).toBe(true);
  });
  it('reads a detail stored as a JSON string and finds nothing without loop_runs', () => {
    const s = step(1, 'builder', 'ok', JSON.stringify({ tdd: { status: 'passed', loops: 0 } }));
    expect(tddLoopCost(inputs([s]))).toEqual([]);
  });
});
