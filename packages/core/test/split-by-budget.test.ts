import { describe, expect, it } from 'vitest';
import { splitByBudget } from '../src/context/approved-basis.ts';

describe('splitByBudget', () => {
  it('skips an element that does not fit and keeps trying the next ones', () => {
    const r = splitByBudget(['aaaa', 'b'.repeat(50), 'cc', 'ddd'], (s) => s.length, 10);
    expect(r.chosen).toEqual(['aaaa', 'cc', 'ddd']);
    expect(r.dropped).toEqual(['b'.repeat(50)]);
  });
  it('keeps everything when it fits', () => {
    expect(splitByBudget([1, 2], (n) => n, 10)).toEqual({ chosen: [1, 2], dropped: [] });
  });
});
