// Pure parts of the engine fixes of the build-health review (01-10-2026): the failure class of a TDD loop, barrels
// out of the affected criteria, the ownership exception «the branch deletes what it recreates» and the reuse
// candidates of the task's own feature.

import { describe, expect, it } from 'vitest';
import { affectedCriteria } from '../src/build/affected-criteria.ts';
import { type Owners, featureOfName, ownershipViolations } from '../src/build/ownership.ts';
import { type GreenTest, type RedEntry, classifyLoopFailure } from '../src/build/tdd.ts';
import { featureOfCriterion, sameFeatureTests } from '../src/classifier/test-reuse.ts';

const green = (test: string, reason: string, criterion: string | null = null): GreenTest => ({ test, path: 'e2e/x.spec.ts', criterion, outcome: 'failed', reason });
const verdict = (g: GreenTest[], red: RedEntry[] = []) => ({ ok: false, red, green: g });
const OWN = ['AC-WOR-001-01', 'AC-WOR-001-02'];

describe('classifyLoopFailure', () => {
  it('own: a criterion test passes on main, or an own test fails with the change', () => {
    const red: RedEntry = { criterion: 'AC-WOR-001-01', test: 't', path: 'p', outcome: 'passed' };
    expect(classifyLoopFailure(verdict([], [red]), OWN)).toBe('own');
    expect(classifyLoopFailure(verdict([green('AC-WOR-001-02 saves', 'expected 1 to be 2', 'AC-WOR-001-02')]), OWN)).toBe('own');
    expect(classifyLoopFailure(verdict([green('build', 'The build fails with the change')]), OWN)).toBe('own');
  });
  it('environment: every failure is the environment', () => {
    const g = green('AC-WOR-001-01 saves', 'error: database "comidas_test_e2e_0" does not exist', 'AC-WOR-001-01');
    expect(classifyLoopFailure(verdict([g]), OWN)).toBe('environment');
  });
  it('environment mixed with a real own failure stays own', () => {
    const env = green('AC-WOR-001-01 a', 'connect ECONNREFUSED 127.0.0.1:5432', 'AC-WOR-001-01');
    const real = green('AC-WOR-001-02 b', 'expected 1 to be 2', 'AC-WOR-001-02');
    expect(classifyLoopFailure(verdict([env, real]), OWN)).toBe('own');
  });
  it('foreign: all failing tests belong to criteria the task does not cover', () => {
    const g = [green('AC-MEA-005-10 p95 under 200 ms', 'Timeout of 30000ms exceeded', 'AC-MEA-005-10'), green('AC-MEA-004-17 latency', 'Timeout', 'AC-MEA-004-17')];
    expect(classifyLoopFailure(verdict(g), OWN)).toBe('foreign');
  });
  it('null when nothing failed', () => {
    expect(classifyLoopFailure({ ok: true, red: [], green: [] }, OWN)).toBeNull();
  });
});

describe('affectedCriteria and barrels', () => {
  const fp = (code: string, ...paths: string[]) => ({ code, files: paths.map((path) => ({ path })) });
  const input = {
    own: ['AC-A-01'],
    branchFiles: ['src/design-system/index.ts'],
    footprints: [fp('TSK-1', 'src/design-system/index.ts')],
    taskFeature: new Map([['TSK-1', 'FDR-B']]),
    featureCriteria: new Map([['FDR-B', ['AC-B-01', 'AC-B-02']]]),
    all: Array.from({ length: 20 }, (_, i) => `AC-X-${i}`),
  };
  it('a barrel does not make the criteria of everything that touched it affected', () => {
    expect(affectedCriteria({ ...input, barrels: new Set(['src/design-system/index.ts']) })).toEqual(['AC-A-01']);
    expect(affectedCriteria(input)).toEqual(['AC-A-01']); // path heuristic without the set
  });
  it('a real source file still counts, and a non-barrel index when the set says so', () => {
    expect(affectedCriteria({ ...input, branchFiles: ['src/lib/a.ts'], footprints: [fp('TSK-1', 'src/lib/a.ts')] })).toEqual(['AC-A-01', 'AC-B-01', 'AC-B-02']);
    expect(affectedCriteria({ ...input, barrels: new Set() })).toEqual(['AC-A-01', 'AC-B-01', 'AC-B-02']);
  });
});

describe('ownership: the branch deletes what it recreates', () => {
  const SIGN_IN = { code: 'FDR-MEA-002', title: 'Sign in' };
  const owners: Owners = { tables: new Map(), routes: new Map([['/auth/sign-in', { feature: SIGN_IN.code, task: 'TSK-MEA-008' }]]) };
  const check = (deletedRoutes: string[], taskText: string) =>
    ownershipViolations({
      taskFeature: { code: 'FDR-MYA-001', title: 'My account' },
      taskCoveredFeatures: [],
      taskText,
      addedTables: [],
      addedRoutes: ['/auth/sign-in'],
      deletedRoutes,
      owners,
      featureOfName: (n) => featureOfName(n, [SIGN_IN]),
    });
  it('is a violation when the route is recreated and nothing is deleted', () => {
    expect(check([], 'Show the account menu')).toHaveLength(1);
  });
  it('is not when the branch deletes the file that created the route', () => {
    expect(check(['/auth/sign-in'], 'Show the account menu')).toEqual([]);
  });
});

describe('reuse candidates of the same feature', () => {
  it('reads the feature of a criterion code', () => {
    expect(featureOfCriterion('AC-MEA-005-10')).toBe('MEA-005');
    expect(featureOfCriterion('nope')).toBeNull();
  });
  it('keeps only tests of the task features', () => {
    const tests = [{ criterion: 'AC-MEA-001-03' }, { criterion: 'AC-WOR-001-09' }, { criterion: 'AC-WOR-002-01' }];
    expect(sameFeatureTests(['AC-WOR-001-01'], tests)).toEqual([{ criterion: 'AC-WOR-001-09' }]);
    expect(sameFeatureTests([], tests)).toEqual([]);
  });
});
