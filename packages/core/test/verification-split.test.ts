// Only `automatic` criteria expect a CI test; manual and release ones are never reported as uncovered or not run.

import { describe, expect, it } from 'vitest';
import { splitByVerification } from '../src/queries/sizes.ts';

describe('splitByVerification', () => {
  const rows = [
    { code: 'AC-X-001-01', verification: 'automatic' },
    { code: 'AC-X-001-02', verification: 'manual' },
    { code: 'AC-X-001-03', verification: 'release' },
  ];

  it('keeps automatic criteria and lists manual and release ones apart, in order', () => {
    expect(splitByVerification(rows, ['AC-X-001-03', 'AC-X-001-01', 'AC-X-001-02'])).toEqual({
      automatic: ['AC-X-001-01'],
      notAutomated: ['AC-X-001-03', 'AC-X-001-02'],
    });
  });

  it('treats a code with no approved version as automatic (the previous behaviour)', () => {
    expect(splitByVerification(rows, ['AC-X-009-01'])).toEqual({ automatic: ['AC-X-009-01'], notAutomated: [] });
  });

  it('a task covering only manual criteria expects no test', () => {
    expect(splitByVerification(rows, ['AC-X-001-02', 'AC-X-001-03']).automatic).toEqual([]);
  });
});
