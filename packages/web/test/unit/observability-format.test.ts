import { describe, expect, it } from 'vitest';
import { correlationReading, costSeries, costText, costTrend, minutesText, num, outcomeCounts, shareText, tokensText } from '../../src/screens/observability/format.ts';
import { OBSERVABILITY } from '../../src/screens/observability/words.i18n.ts';

describe('observability formatting', () => {
  it('shows a dash for a missing number and units for the rest', () => {
    expect(num('en', null)).toBe('—');
    expect(minutesText('en', 45.25)).toBe('45.3 min');
    expect(minutesText('en', 125)).toBe('2 h 5 min');
    expect(tokensText('en', 1234)).toBe('1.2k');
    expect(tokensText('en', 2_500_000)).toBe('2.5M');
    expect(tokensText('en', 90)).toBe('90');
    expect(costText('en', 0.2534)).toBe('$0.253');
    expect(costText('en', 12.5)).toBe('$12.5');
    expect(costText('en', null)).toBe('—');
    expect(shareText('en', 0.5)).toBe('50%');
  });

  it('reads a correlation in bands and refuses to read a handful of tasks', () => {
    expect(correlationReading(null)).toEqual({ kind: 'none' });
    expect(correlationReading({ rho: 0.9, n: 5 })).toEqual({ kind: 'few', n: 5 });
    expect(correlationReading({ rho: 0.1, n: 20 })).toMatchObject({ kind: 'weak', direction: 'up' });
    expect(correlationReading({ rho: -0.45, n: 20 })).toMatchObject({ kind: 'moderate', direction: 'down' });
    expect(correlationReading({ rho: 0.8, n: 20 })).toMatchObject({ kind: 'strong' });
  });

  it('has the same sentences in both languages', () => {
    for (const locale of ['en', 'es'] as const) {
      const t = OBSERVABILITY[locale];
      expect(t.reading({ kind: 'strong', direction: 'up', rho: 0.8, n: 20 }, 'X')).toContain('0.80');
      expect(t.outcome('merged')).not.toBe('merged');
    }
  });
});

describe('observability chart data', () => {
  const fact = (task: string, ended: string, cost: number | null, outcome = 'merged') =>
    ({ task_code: task, ended_at: ended, outcome, builder_usage: cost === null ? null : { cost_usd: cost }, reviewer_usage: null }) as never;
  it('sums the cost per task and orders tasks by when they ended', () => {
    const s = costSeries([fact('B', '2026-01-02', 1), fact('A', '2026-01-01', 0.5), fact('A', '2026-01-03', 0.25), fact('C', '2026-01-04', null)]);
    expect(s.map((x) => [x.task, x.cost])).toEqual([['B', 1], ['A', 0.75]]);
  });
  it('compares the latest tasks with the ones before, and needs enough of them', () => {
    expect(costTrend([1, 1, 1])).toBeNull();
    expect(costTrend([1, 1, 1, 1, 1, 2, 2, 2, 2, 2])).toBe(1);
  });
  it('counts attempts per outcome', () => {
    expect(outcomeCounts([fact('A', 'x', 1), fact('B', 'x', 1, 'failed')]).failed).toBe(1);
  });
});
