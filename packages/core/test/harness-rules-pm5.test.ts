// Rules added or fixed in pm-5 (revision-salud-build): TDD loops by failure class, the stored RED message, usd and
// non-cached tokens, the testability wait, the guards of the design stage, builder failure classes and test reuse.

import { describe, expect, it } from 'vitest';
import { builderFailureClass, designGuard, testReuseFollow } from '../src/harness/rules/guards.ts';
import { queueTestabilityWait } from '../src/harness/rules/queue.ts';
import { tokensOf } from '../src/harness/rules/builder-detail.ts';
import { redLinesOf, tddGate, tddLoopCost } from '../src/harness/rules/tdd.ts';
import { at, inputs, step, uid } from './support/harness-inputs.ts';

const gateSteps = (tdd: unknown, told?: string[], extra: unknown[] = []) => [step('r', 1, 'builder', 'ok', { tdd, ...(told ? { tdd_told: told } : {}) }, 1), step('r', 1, 'ci', 'ok', { conclusion: 'success' }, 5), ...(extra as never[])];

describe('tdd rule pm-5', () => {
  const loopMessage = ['DEMIURGO ran your tests (loop 1 of at most 15)...', '', 'RED: these tests PASS on main without your change. A test that never failed...:', '- AC-PRO-011-15: `shows the day` in e2e/day.spec.ts', '- … and 2 more.', '', 'Run the tests yourself.'].join('\n');
  it('reads the RED lines of the message the gate actually stores', () => {
    expect(redLinesOf(loopMessage)).toEqual([{ criterion: 'AC-PRO-011-15', test: 'shows the day', path: 'e2e/day.spec.ts' }]);
    const f = tddGate(inputs({ steps: gateSteps({ status: 'passed', red: [], green: null, loops: 1 }, [loopMessage]) }));
    expect(f.find((x) => x.unit === 'tests')).toMatchObject({ class: 'benefit', subject: 'AC-PRO-011-15', value: 1 });
  });
  it('counts only own loops as TP; foreign is fp and environment is info, with their minutes', () => {
    const loop_runs = [
      { loop: 1, duration_ms: 120_000, failure_class: 'own' },
      { loop: 2, duration_ms: 180_000, failure_class: 'foreign' },
      { loop: 3, duration_ms: 60_000, failure_class: 'environment' },
      { loop: 4, duration_ms: 30_000, failure_class: null },
    ];
    const f = tddGate(inputs({ steps: gateSteps({ status: 'passed', red: [], green: null, loops: 4, loop_runs }) }));
    expect(f.filter((x) => x.unit === 'loops').map((x) => [x.class, x.value, (x.evidence as { minutes: number }).minutes])).toEqual([
      ['tp', 1, 2],
      ['fp', 1, 3],
      ['info', 1, 1],
    ]);
  });
  it('old rows: a loop whose green failures are all `database does not exist` is environment, not TP', () => {
    const green = ['DEMIURGO ran your tests...', '', 'GREEN: these tests FAIL with your change. Fix the code:', '- `saves` in e2e/a.spec.ts: error: database "comidas_test_e2e_0" does not exist'].join('\n');
    const f = tddGate(inputs({ steps: gateSteps({ status: 'passed', red: [], green: null, loops: 2 }, [green, loopMessage]) }));
    expect(f.filter((x) => x.unit === 'loops').map((x) => [x.class, x.value])).toEqual([
      ['tp', 1],
      ['info', 1],
    ]);
  });
  it('prices loops in usd and in non-cached tokens, with the cached ones apart', () => {
    const usage = { inputTokens: 1000, cachedInputTokens: 900, outputTokens: 50, declaredCostUsd: 0.1234 };
    expect(tokensOf(usage)).toBe(150);
    expect(tokensOf({ inputTokens: 10, outputTokens: 5 })).toBe(15);
    const f = tddLoopCost(inputs({ steps: gateSteps({ status: 'passed', red: [], green: null, loops: 1, loop_runs: [{ loop: 1, duration_ms: 60_000, usage }] }) }));
    expect(f.map((x) => [x.unit, x.value])).toEqual([['min', 1], ['tokens', 150], ['usd', 0.1234]]);
    expect(f.find((x) => x.unit === 'tokens')!.evidence).toMatchObject({ cached_tokens: 900 });
  });
});

describe('queue.testability_wait', () => {
  it('sums the minutes held for testability while a slot was free', () => {
    const plan = (minute: number, running: string[]) => ({ id: `p${minute}`, decided_at: at(minute), parallel_limit: 3, running, started: [] as string[], stopped_kind: null });
    const dec = (minute: number) => ({ id: uid('d'), plan_id: `p${minute}`, decided_at: at(minute), decision: 'wait_testability', item: 'AC-X-001-01', with_task: null, with_source: null, evidence: null });
    const f = queueTestabilityWait(
      inputs({ steps: [step('r', 1, 'repo', 'started', null, 40)], queuePlans: [plan(0, ['a']), plan(20, ['a', 'b', 'c']), plan(30, ['a'])], queueDecisions: [dec(0), dec(20), dec(30)] }),
    );
    expect(f).toHaveLength(1);
    // 0-20 and 30-40 have free slots (20 + 10); 20-30 is full.
    expect(f[0]).toMatchObject({ piece: 'B04', class: 'cost', unit: 'min', value: 30, subject: 'TSK-A-001' });
    expect(f[0]!.evidence).toMatchObject({ waited_min: 40, free_slot_min: 30, criteria: ['AC-X-001-01'] });
    expect(queueTestabilityWait(inputs({ steps: [], queuePlans: [], queueDecisions: [] }))).toEqual([]);
  });
});

describe('design.guard', () => {
  const failed = (detail: unknown) => step('r', 1, 'design', 'failed', detail, 10);
  it('is a tp when a later commit changed the flagged file and the task merged, with the minutes stopped', () => {
    const steps = [failed({ violations: [{ rule: 1, path: 'src/a.tsx', line: 3, message: 'x' }], ownership: [] }), step('r', 2, 'repo', 'started', { automatic: true }, 12), step('r', 2, 'commit', 'ok', { files: ['src/a.tsx'] }, 20)];
    const f = designGuard(inputs({ steps }));
    expect(f.map((x) => [x.piece, x.class, x.unit])).toEqual([['B13', 'tp', null], ['B13', 'cost', 'min']]);
    expect(f[1]!.value).toBe(2);
  });
  it('is a fp when it merged and nothing flagged was changed (ownership kept), and info when it did not merge', () => {
    const steps = [failed({ violations: [], ownership: [{ kind: 'route', name: '/auth/sign-in', message: 'm' }] }), step('r', 2, 'repo', 'started', { automatic: true }, 12)];
    expect(designGuard(inputs({ steps })).map((x) => [x.piece, x.class])).toEqual([['B14', 'fp'], ['B14', 'cost']]);
    const open = inputs({ steps, request: { id: 'r', state: 'requested', feature_version_id: 'fv' } as never });
    expect(designGuard(open).filter((x) => x.class !== 'cost').map((x) => [x.piece, x.class])).toEqual([['B14', 'info']]);
  });
  it('reports duplicate tests as B15', () => {
    expect(designGuard(inputs({ steps: [failed({ violations: [], ownership: [], test_guard: { violations: 2 } })] }))[0]).toMatchObject({ piece: 'B15', finding: 'design.guard' });
  });
});

describe('builder.failure_class and test_reuse.follow', () => {
  it('records the class and who started the next attempt, with the minutes the person took', () => {
    const steps = [
      step('r', 1, 'builder', 'failed', { failure_kind: 'infra' }, 5),
      step('r', 2, 'repo', 'started', { started_by: 'human:ana' }, 19),
      step('r', 2, 'builder', 'ok', {}, 25),
      step('r', 3, 'builder', 'failed', { failure_kind: 'other' }, 30),
      step('r', 4, 'repo', 'started', { automatic: true }, 31),
    ];
    const f = builderFailureClass(inputs({ steps }));
    expect(f.map((x) => [x.subject, x.class, x.value, (x.evidence as { next: string }).next, (x.evidence as { next_ok: boolean | null }).next_ok])).toEqual([
      ['infra', 'cost', 14, 'person', true],
      ['other', 'info', null, 'automatic', false],
    ]);
  });
  it('B08: a suggested test is followed when a commit of the attempt touched it', () => {
    const steps = [step('r', 1, 'builder', 'ok', { test_reuse: [{ path: 'e2e/a.spec.ts', criterion: 'AC-1', p: 0.7 }, { path: 'e2e/b.spec.ts', criterion: 'AC-2', p: 0.6 }] }, 1), step('r', 1, 'commit', 'ok', { files: ['e2e/a.spec.ts'] }, 5)];
    expect(testReuseFollow(inputs({ steps })).map((x) => [x.subject, x.class])).toEqual([['e2e/a.spec.ts', 'tp'], ['e2e/b.spec.ts', 'fp']]);
  });
});
