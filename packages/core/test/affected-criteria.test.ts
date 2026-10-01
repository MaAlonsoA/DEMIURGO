// Pure: the criteria a task's PR affects and the commit trailer that carries them.

import { describe, expect, it } from 'vitest';
import { affectedCriteria, affectedTrailer, withAffectedTrailer } from '../src/build/affected-criteria.ts';

const fp = (code: string, ...paths: string[]) => ({ code, files: paths.map((path) => ({ path })) });
const base = {
  own: ['AC-A-01'],
  branchFiles: ['src/shared.ts'],
  footprints: [fp('TSK-1', 'src/shared.ts'), fp('TSK-2', 'src/other.ts')],
  taskFeature: new Map([['TSK-1', 'FDR-B'], ['TSK-2', 'FDR-C']]),
  featureCriteria: new Map([['FDR-A', ['AC-A-01', 'AC-A-02']], ['FDR-B', ['AC-B-01', 'AC-B-02']], ['FDR-C', ['AC-C-01']]]),
  all: Array.from({ length: 20 }, (_, i) => `AC-X-${i}`),
};

describe('affectedCriteria', () => {
  it('adds the criteria of features whose merged tasks changed the same source files', () => {
    expect(affectedCriteria(base)).toEqual(['AC-A-01', 'AC-B-01', 'AC-B-02']);
  });
  it('ignores docs, lockfiles and tests', () => {
    expect(affectedCriteria({ ...base, branchFiles: ['README.md', 'pnpm-lock.yaml', 'a.test.ts'], footprints: [fp('TSK-1', 'README.md', 'pnpm-lock.yaml', 'a.test.ts')] })).toEqual(['AC-A-01']);
  });
  it('says all above 60 % of the project criteria', () => {
    const many = new Map([['FDR-B', Array.from({ length: 13 }, (_, i) => `AC-B-${i}`)]]);
    expect(affectedCriteria({ ...base, featureCriteria: many })).toBe('all');
    expect(affectedCriteria({ ...base, featureCriteria: new Map([['FDR-B', Array.from({ length: 11 }, (_, i) => `AC-B-${i}`)]]) })).toHaveLength(12);
  });
  it('gives null with no data', () => {
    expect(affectedCriteria({ ...base, own: [], footprints: [], all: [] })).toBeNull();
  });
});

describe('trailer', () => {
  it('is a final paragraph with space-separated codes', () => {
    expect(affectedTrailer(['A', 'B'])).toBe('Affected-criteria: A B');
    expect(affectedTrailer('all')).toBe('Affected-criteria: all');
    expect(affectedTrailer(null)).toBe('');
    expect(withAffectedTrailer('TSK-9: Title', ['A', 'B'])).toBe('TSK-9: Title\n\nAffected-criteria: A B\n');
    expect(withAffectedTrailer('TSK-9: Title', null)).toBe('TSK-9: Title');
  });
});
