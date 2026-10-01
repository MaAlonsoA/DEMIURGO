import { describe, expect, it } from 'vitest';
import { containmentOf, containmentSeries, PCE_MIN_N, PCE_TARGET, type ContainmentRow } from '../src/harness/containment.ts';

const contained = (phase: string, occurred_at: string | null = null) => ({ introduced_phase: phase, found_phase: phase, evidence: { contained: true }, occurred_at });
const escaped = (phase: string, occurred_at: string | null = null) => ({ introduced_phase: phase, found_phase: 'P9', evidence: {}, occurred_at });
const many = (n: number, make: () => ContainmentRow) => Array.from({ length: n }, make);

describe('phase containment (pure)', () => {
  it('has the person target of 0.9 and the n >= 10 rule', () => {
    expect(PCE_TARGET).toBe(0.9);
    expect(PCE_MIN_N).toBe(10);
  });

  it('says nothing about the target below n = 10 and judges it from 10', () => {
    const nine = containmentOf(many(9, () => contained('P5')));
    expect(nine).toEqual([{ phase: 'P5', contained: 9, escaped: 0, pce: 1, n: 9, target_met: null }]);
    const ten = containmentOf([...many(9, () => contained('P5')), escaped('P5')]);
    expect(ten[0]).toMatchObject({ n: 10, pce: 0.9, target_met: true });
    const below = containmentOf([...many(8, () => contained('P5')), ...many(2, () => escaped('P5'))]);
    expect(below[0]).toMatchObject({ n: 10, pce: 0.8, target_met: false });
  });

  it('counts only the design phases P1-P7', () => {
    expect(containmentOf([escaped('P9'), escaped('P0'), escaped('P10'), escaped('P7')]).map((p) => p.phase)).toEqual(['P7']);
  });

  it('does not count an unmarked same-phase row as contained', () => {
    expect(containmentOf([{ introduced_phase: 'P5', found_phase: 'P5', evidence: {} }])).toEqual([]);
  });
});

describe('containment series (pure)', () => {
  const checks = [
    { id: 'b', computed_at: '2026-09-20T00:00:00Z', window_from: '2026-09-13T00:00:00Z', window_to: '2026-09-20T00:00:00Z' },
    { id: 'a', computed_at: '2026-09-13T00:00:00Z', window_from: '2026-09-06T00:00:00Z', window_to: '2026-09-13T00:00:00Z' },
  ];

  it('is oldest first and cuts each window by when the fact happened', () => {
    const s = containmentSeries([contained('P5', '2026-09-10T00:00:00Z'), escaped('P5', '2026-09-15T00:00:00Z')], checks);
    expect(s.map((p) => p.id)).toEqual(['a', 'b']);
    expect(s[0]!.phases).toEqual([{ phase: 'P5', contained: 1, escaped: 0, pce: 1, n: 1, target_met: null }]);
    expect(s[1]!.phases).toEqual([{ phase: 'P5', contained: 1, escaped: 1, pce: 0.5, n: 2, target_met: null }]);
  });

  it('recomputes history: an escape found later lowers the past window', () => {
    const known = many(10, () => contained('P5', '2026-09-10T00:00:00Z'));
    expect(containmentSeries(known, checks)[0]!.phases[0]).toMatchObject({ pce: 1, target_met: true });
    const later = [...known, ...many(5, () => escaped('P5', '2026-09-11T00:00:00Z'))];
    expect(containmentSeries(later, checks)[0]!.phases[0]).toMatchObject({ n: 15, pce: 0.667, target_met: false });
  });

  it('counts a row without a date in every window', () => {
    expect(containmentSeries([escaped('P7')], checks).map((p) => p.phases[0]!.escaped)).toEqual([1, 1]);
  });
});
