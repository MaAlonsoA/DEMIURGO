// Test guard (build/test-guard.ts): the pure parts.

import { describe, expect, it } from 'vitest';
import { duplicateTests, existingTestsLines, testGuardFeedback, testsByCriterion, testsFromSources } from '../src/build/test-guard.ts';

const src = (path: string, ...titles: string[]) => ({ path, content: titles.map((t) => `  test('${t}', async () => {});`).join('\n') });
const tests = (...files: Array<ReturnType<typeof src>>) => testsByCriterion(testsFromSources(files));
const OWNER = 'AC-PRO-009-02';

describe('test guard', () => {
  it('reads criterion titles and the level from the path or Playwright', () => {
    const entries = testsFromSources(
      [
        src('e2e/a.spec.ts', `${OWNER} only the owner sees it`),
        src('src/lib/access.test.ts', `${OWNER} owner check`),
        src('tests/b.spec.ts', 'AC-MEA-001-01 logs a meal'),
        { path: 'x.test.ts', content: "it(`AC-MEA-002-01 uses ${x}`, () => {})\ntest('not a criterion', () => {})\ntest.describe('AC-MEA-003-01 group', () => {})" },
      ],
      new Set(['tests/b.spec.ts']),
    );
    expect(entries.map((e) => [e.criterion, e.level])).toEqual([[OWNER, 'e2e'], [OWNER, 'unit'], ['AC-MEA-001-01', 'e2e'], ['AC-MEA-002-01', 'unit']]);
    expect(entries[0]?.title).toBe(`${OWNER} only the owner sees it`);
  });

  it(`${OWNER} re-tested by a later task is a violation, with feedback`, () => {
    const before = tests(src('e2e/projects.spec.ts', `${OWNER} owner-only access`));
    const after = tests(src('e2e/projects.spec.ts', `${OWNER} owner-only access`), src('e2e/meals.spec.ts', `${OWNER} meals are owner-only`));
    const v = duplicateTests(before, after, [OWNER]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ criterion: OWNER, kind: 'duplicate' });
    const [line] = testGuardFeedback(v);
    expect(line).toContain(`${OWNER} already has \`${OWNER} owner-only access\` in \`e2e/projects.spec.ts\` (e2e)`);
    expect(line).toContain('Extend that test instead of adding `AC-PRO-009-02 meals are owner-only`');
    expect(line).toContain('[example: …]');
  });

  it('a unit test counts as lower than e2e: a new e2e test is a duplicate, a new unit test under an e2e one is not', () => {
    const unitBefore = tests(src('src/a.test.ts', 'AC-X-001-01 rule'));
    expect(duplicateTests(unitBefore, tests(src('src/a.test.ts', 'AC-X-001-01 rule'), src('e2e/a.spec.ts', 'AC-X-001-01 screen')))).toHaveLength(1);
    const e2eBefore = tests(src('e2e/a.spec.ts', 'AC-X-001-01 screen'));
    expect(duplicateTests(e2eBefore, tests(src('e2e/a.spec.ts', 'AC-X-001-01 screen'), src('src/a.test.ts', 'AC-X-001-01 rule')))).toEqual([]);
  });

  it(`new unit tests of a broad criterion are never a violation (${OWNER}: session expiry next to the callback tests)`, () => {
    const before = tests(src('src/app/auth/callback/route.test.ts', `${OWNER} another account's sign-in clears the session`));
    const after = tests(
      src('src/app/auth/callback/route.test.ts', `${OWNER} another account's sign-in clears the session`),
      src('src/server/auth/owner.test.ts', `${OWNER} keeps a session used every 30 days`, `${OWNER} stores only a digest of the session id`),
    );
    expect(duplicateTests(before, after)).toEqual([]);
  });

  it('the [example: …] marker allows a second test', () => {
    const before = tests(src('e2e/a.spec.ts', `${OWNER} owner-only access`));
    const after = tests(src('e2e/a.spec.ts', `${OWNER} owner-only access`, `${OWNER} [example: a guest gets 403] guest`));
    expect(duplicateTests(before, after)).toEqual([]);
  });

  it('more than one new test for a criterion in one attempt is a violation unless marked', () => {
    const after = tests(src('e2e/a.spec.ts', 'AC-X-002-01 one', 'AC-X-002-01 two', 'AC-X-002-01 [example: empty] three'));
    const v = duplicateTests(new Map(), after);
    expect(v.map((x) => [x.kind, x.added.title])).toEqual([['several_new', 'AC-X-002-01 two']]);
  });

  it('a renamed test replaces the old one and is not a duplicate; criteria can restrict the check', () => {
    const before = tests(src('e2e/a.spec.ts', 'AC-X-003-01 old name'));
    expect(duplicateTests(before, tests(src('e2e/a.spec.ts', 'AC-X-003-01 new name')))).toEqual([]);
    const dup = tests(src('e2e/a.spec.ts', 'AC-X-003-01 old name'), src('e2e/b.spec.ts', 'AC-X-003-01 again'));
    expect(duplicateTests(before, dup, ['AC-OTHER-001-01'])).toEqual([]);
  });

  it('a retitled test in the same file, next to another test of the criterion, is a rename and not a duplicate', () => {
    const before = tests(src('e2e/save.spec.ts', 'AC-X-004-01 saved once confirmed', 'AC-X-004-01 when ${name}, an error is shown'));
    const after = tests(src('e2e/save.spec.ts', 'AC-X-004-01 saved once confirmed', 'AC-X-004-01 when the server rejects the save, an error is shown'));
    expect(duplicateTests(before, after)).toEqual([]);
    const plusOne = tests(src('e2e/save.spec.ts', 'AC-X-004-01 saved once confirmed', 'AC-X-004-01 when the server rejects the save, an error is shown', 'AC-X-004-01 one more'));
    expect(duplicateTests(before, plusOne)).toHaveLength(1);
  });

  it('a release check against the deployed candidate is a different stage from a CI test of the same criterion', () => {
    const after = tests(src('e2e/perf.spec.ts', 'AC-X-005-01 p95 under 2 s locally'), src('release/perf.spec.ts', 'AC-X-005-01 deployed candidate p95 under 2 s'));
    expect(duplicateTests(new Map(), after)).toEqual([]);
    const twoReleases = tests(src('release/perf.spec.ts', 'AC-X-005-01 deployed one', 'AC-X-005-01 deployed two'));
    expect(duplicateTests(new Map(), twoReleases)).toHaveLength(1);
  });

  it('lists the existing tests per criterion, says when none, and caps the lines', () => {
    const t = tests(src('e2e/a.spec.ts', `${OWNER} owner-only access`));
    expect(existingTestsLines(t, [OWNER, 'AC-X-009-01'])).toEqual([
      expect.stringContaining('Existing tests for this task'),
      `- ${OWNER}: \`${OWNER} owner-only access\` in e2e/a.spec.ts (e2e)`,
      '- AC-X-009-01: no test yet — write one at the lowest level that checks it.',
    ]);
    expect(existingTestsLines(t, [])).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `AC-X-${String(i).padStart(3, '0')}-01`);
    const out = existingTestsLines(t, many);
    expect(out.length).toBe(1 + 20 + 1);
    expect(out.at(-1)).toBe('- … and 10 more.');
  });
});
