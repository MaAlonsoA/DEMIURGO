import { describe, expect, it } from 'vitest';
import { isE2eFile, testCountsOf, testsInDiff } from '../src/actions/pr-review.ts';

describe('testCountsOf', () => {
  it('counts tests per criterion code and level', () => {
    const counts = testCountsOf([{ code: 'AC-AAA-001-01' }, { code: 'AC-AAA-001-02' }, { code: 'AC-AAA-001-03' }], [
      { name: 'AC-AAA-001-01 adds', file: 'src/a.test.ts' },
      { name: 'AC-AAA-001-01 shows it', file: 'e2e/a.spec.ts' },
      { name: 'AC-AAA-001-01 shows it twice', file: 'web/e2e/a.spec.ts' },
      { name: 'AC-AAA-001-02 validates', file: 'src/b.test.ts' },
      { name: 'unrelated', file: 'src/c.test.ts' },
    ]);
    expect(counts).toEqual({
      'AC-AAA-001-01': { e2e: 2, unit: 1 },
      'AC-AAA-001-02': { e2e: 0, unit: 1 },
      'AC-AAA-001-03': { e2e: 0, unit: 0 },
    });
  });
  it('detects e2e paths', () => {
    expect(isE2eFile('e2e/x.spec.ts')).toBe(true);
    expect(isE2eFile('src/x.spec.ts')).toBe(false);
  });
  it('reads added tests from a diff', () => {
    const diff = ['+++ b/e2e/a.spec.ts', "+test('AC-AAA-001-01 shows', async () => {", " test('old', () => {})", '+++ b/src/a.test.ts', '+  it("AC-AAA-001-02 adds", () => {'].join('\n');
    expect(testsInDiff(diff)).toEqual([
      { name: 'AC-AAA-001-01 shows', file: 'e2e/a.spec.ts' },
      { name: 'AC-AAA-001-02 adds', file: 'src/a.test.ts' },
    ]);
  });
});
