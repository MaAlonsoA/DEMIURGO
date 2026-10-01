import { describe, expect, it } from 'vitest';
import { typicalDuration } from '../src/typical-duration.ts';

describe('typicalDuration', () => {
  it('is null without durations', () => {
    expect(typicalDuration([])).toBeNull();
    expect(typicalDuration([Number.NaN, -3])).toBeNull();
  });

  it('takes the median and the 80th percentile (nearest rank)', () => {
    expect(typicalDuration([10, 20, 30, 40, 50])).toEqual({ median_s: 30, p80_s: 40, n: 5 });
    expect(typicalDuration([5, 15])).toEqual({ median_s: 10, p80_s: 15, n: 2 });
    expect(typicalDuration([300])).toEqual({ median_s: 300, p80_s: 300, n: 1 });
  });

  it('does not depend on the order and ignores invalid values', () => {
    expect(typicalDuration([50, 10, 40, -1, 30, 20])).toEqual({ median_s: 30, p80_s: 40, n: 5 });
  });
});
