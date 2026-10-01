// Builder session rules (B20): pure, over hand-made steps.

import { describe, expect, it } from 'vitest';
import type { Row } from '../src/db/schema.ts';
import type { PostmortemInputs } from '../src/harness/postmortem.ts';
import { endedBy, sessionMode, sessionOutcome, sessionTddLoops } from '../src/harness/rules/session.ts';
import { sessionCompareOf, sessionVerdictOf } from '../src/queries/harness-health.ts';

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 12, 0, clock++));
const step = (attempt: number, stage: string, outcome: string, detail: unknown = {}, id = `s${clock}`) => ({ id, project_id: 'p', build_request_id: 'r', attempt, stage, outcome, detail, created_at: at() }) as unknown as Row<'build_steps'>;
const inputs = (steps: Row<'build_steps'>[]): PostmortemInputs => ({ request: { id: 'r', state: 'done' }, taskCode: 'TSK-X-001', steps, reviews: [], codeOpinions: [], layersOpinion: null, testRuns: [] }) as unknown as PostmortemInputs;
const builder = (attempt: number, mode: 'resumed' | 'fresh', extra: Record<string, unknown> = {}) =>
  step(attempt, 'builder', 'ok', { session: { mode, id: 'abc', reason: mode === 'fresh' ? 'The previous session files are no longer there.' : 'Same engine' }, duration_ms: 120_000, usage: { inputTokens: 1000, outputTokens: 500 }, ...extra });

describe('session.mode', () => {
  it('one info row per attempt >= 2 with the reason and what ended the previous attempt', () => {
    const f = sessionMode(inputs([builder(1, 'fresh', { tdd: { status: 'red', loops: 3 } }), builder(2, 'resumed'), step(2, 'merge', 'ok')]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ piece: 'B20', finding: 'session.mode', class: 'info', subject: 'resumed', attempt: 2 });
    expect(f[0]!.evidence).toMatchObject({ reason: 'Same engine', attempt: 2, previous_failure: 'tdd_red' });
  });
  it('ignores attempt 1 and attempts without a recorded session', () => {
    expect(sessionMode(inputs([builder(1, 'fresh'), step(2, 'builder', 'ok', {})]))).toEqual([]);
  });
  it('keeps the reason of a fresh session', () => {
    const f = sessionMode(inputs([step(1, 'ci', 'failed', { conclusion: 'failure' }), builder(2, 'fresh')]));
    expect(f[0]).toMatchObject({ subject: 'fresh' });
    expect(f[0]!.evidence).toMatchObject({ reason: 'The previous session files are no longer there.', previous_failure: 'ci_red' });
  });
});

describe('endedBy', () => {
  it('names what ended an attempt', () => {
    expect(endedBy([step(1, 'builder', 'failed', { failure_kind: 'timeout' })])).toBe('timeout');
    expect(endedBy([step(1, 'design', 'failed')])).toBe('design');
    expect(endedBy([step(1, 'builder', 'ok'), step(1, 'review', 'changes_requested')])).toBe('review_changes');
    expect(endedBy([step(1, 'builder', 'ok')])).toBe('unknown');
  });
});

describe('session.outcome', () => {
  it('benefit with minutes and tokens when the attempt reached merge', () => {
    const f = sessionOutcome(inputs([builder(1, 'fresh'), step(1, 'review', 'changes_requested'), builder(2, 'resumed'), step(2, 'merge', 'ok')]));
    expect(f.map((x) => [x.finding, x.class, x.value, x.unit, x.subject])).toEqual([
      ['session.outcome', 'benefit', 2, 'min', 'resumed'],
      ['session.outcome_tokens', 'benefit', 1500, 'tokens', 'resumed'],
    ]);
  });
  it('cost when another attempt was needed; the last unmerged attempt is not judged', () => {
    const f = sessionOutcome(inputs([builder(1, 'fresh'), builder(2, 'fresh'), step(2, 'ci', 'failed'), builder(3, 'resumed'), step(3, 'merge', 'waiting')]));
    expect(f.filter((x) => x.finding === 'session.outcome').map((x) => [x.attempt, x.class, x.subject])).toEqual([[2, 'cost', 'fresh']]);
  });
  it('a row without minutes when the step stored no duration, and no tokens row without usage', () => {
    const f = sessionOutcome(inputs([step(1, 'builder', 'ok', {}), step(2, 'builder', 'ok', { session: { mode: 'resumed' } }), step(2, 'merge', 'ok')]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ value: null, unit: null });
  });
});

describe('session.tdd_loops', () => {
  it('counts the loops of the attempt', () => {
    const f = sessionTddLoops(inputs([builder(2, 'resumed', { tdd: { status: 'passed', loops: 2 } })]));
    expect(f[0]).toMatchObject({ finding: 'session.tdd_loops', value: 2, unit: 'loops', subject: 'resumed' });
  });
});

describe('B20 comparison', () => {
  const fact = (finding: string, cls: 'benefit' | 'cost', subject: string, value: number, unit: string) => ({ piece: 'B20', finding, class: cls, ground_truth: null, value, unit, subject });
  it('compares success rate, minutes and tokens, and needs 10 of each for a verdict', () => {
    const facts = [fact('session.outcome', 'benefit', 'resumed', 2, 'min'), fact('session.outcome', 'cost', 'resumed', 4, 'min'), fact('session.outcome', 'benefit', 'fresh', 6, 'min'), fact('session.outcome_tokens', 'benefit', 'fresh', 900, 'tokens')];
    const c = sessionCompareOf(facts);
    expect(c.resumed).toMatchObject({ n: 2, merged: 1, success_rate: 0.5, mean_minutes: 3, mean_tokens: null });
    expect(c.fresh).toMatchObject({ n: 1, success_rate: 1, mean_minutes: 6, mean_tokens: 900 });
    expect(sessionVerdictOf(c)).toBe('no_data');
    const many = (subject: string, ok: number, length = 30) => Array.from({ length }, (_, i) => fact('session.outcome', i < ok ? 'benefit' : 'cost', subject, 1, 'min'));
    // pm-8: a verdict only when the Wilson intervals do not overlap (Brown, Cai and DasGupta 2001).
    expect(sessionVerdictOf(sessionCompareOf([...many('resumed', 29), ...many('fresh', 15)]))).toBe('helps');
    expect(sessionVerdictOf(sessionCompareOf([...many('resumed', 3), ...many('fresh', 15)]))).toBe('hurts');
    // 8/10 against 5/10: a higher rate, but the intervals overlap: neutral, not «ayuda».
    expect(sessionVerdictOf(sessionCompareOf([...many('resumed', 8, 10), ...many('fresh', 5, 10)]))).toBe('neutral');
  });
});
