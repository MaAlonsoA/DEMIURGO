import { describe, expect, it } from 'vitest';
import { approvedWithFixes, countFixes, countTestMarkers, fixCommentsOf, minorChange, parseHunks, parseNameStatus, parseNumstat, waiveReview, type MinorChangeInput } from '../src/build/lgtm.ts';

describe('LGTM with comments', () => {
  const comments = [
    { path: 'a.ts', severity: 'fix' },
    { path: 'b.ts', severity: 'nit' },
    { path: 'c.ts', severity: 'fix' },
  ];
  it('counts and lists the fix comments', () => {
    expect(countFixes(comments)).toBe(2);
    expect(fixCommentsOf(comments).map((c) => c.path)).toEqual(['a.ts', 'c.ts']);
  });
  it('only an approval with fixes ends the attempt for them', () => {
    expect(approvedWithFixes('approve', comments)).toBe(true);
    const nitOnly = [{ path: 'b.ts', severity: 'nit' }];
    expect(approvedWithFixes('approve', nitOnly)).toBe(false);
    expect(approvedWithFixes('request_changes', comments)).toBe(false);
  });
  it('waives the new review when the change stays inside the fixed files, or is empty', () => {
    expect(waiveReview({ fixPaths: ['a.ts', 'c.ts'], changedFiles: ['a.ts'] })).toEqual({ waive: true, outside: [] });
    expect(waiveReview({ fixPaths: ['a.ts'], changedFiles: [] }).waive).toBe(true);
    expect(waiveReview({ fixPaths: ['./a.ts'], changedFiles: ['a.ts'] }).waive).toBe(true);
  });
  it('refuses to waive when files outside the fixes changed', () => {
    expect(waiveReview({ fixPaths: ['a.ts'], changedFiles: ['a.ts', 'z.ts'] })).toEqual({ waive: false, outside: ['z.ts'] });
  });
});

describe('minorChange', () => {
  const base = (over: Partial<MinorChangeInput> = {}): MinorChangeInput => ({
    fixes: [{ path: 'src/a.ts', line: 50 }],
    numstat: [{ path: 'src/a.ts', added: 3, deleted: 2, binary: false }],
    nameStatus: [{ status: 'M', path: 'src/a.ts' }],
    hunks: { 'src/a.ts': [{ oldStart: 48, oldCount: 2 }] },
    testCounts: {},
    ...over,
  });
  it('accepts a small local edit of a commented file, and an empty change', () => {
    expect(minorChange(base())).toEqual({ minor: true, failed: [] });
    expect(minorChange(base({ numstat: [], nameStatus: [], hunks: {} })).minor).toBe(true);
  });
  it('rule 1: files outside the fixes', () => {
    const r = minorChange(base({ numstat: [{ path: 'z.ts', added: 1, deleted: 0, binary: false }], nameStatus: [{ status: 'M', path: 'z.ts' }], hunks: {} }));
    expect(r.failed).toEqual(['files_outside_fixes']);
  });
  it('rule 2: more than 20 lines per fix comment, and binary files', () => {
    const big = { path: 'src/a.ts', added: 15, deleted: 6, binary: false };
    expect(minorChange(base({ numstat: [big] })).failed).toEqual(['too_many_lines']);
    expect(minorChange(base({ numstat: [big], fixes: [{ path: 'src/a.ts', line: 50 }, { path: 'src/a.ts', line: 51 }] })).minor).toBe(true);
    expect(minorChange(base({ numstat: [{ path: 'src/a.ts', added: 0, deleted: 0, binary: true }] })).failed).toEqual(['binary_change']);
  });
  it('rule 3: only modifications', () => {
    expect(minorChange(base({ nameStatus: [{ status: 'A', path: 'src/a.ts' }] })).failed).toEqual(['files_added_or_deleted']);
    expect(minorChange(base({ nameStatus: [{ status: 'D', path: 'src/a.ts' }] })).failed).toEqual(['files_added_or_deleted']);
  });
  it('rule 4: migrations and manifests (unless a fix names the manifest)', () => {
    const mig = (path: string) => base({ fixes: [{ path, line: null }], numstat: [{ path, added: 1, deleted: 0, binary: false }], nameStatus: [{ status: 'M', path }], hunks: {} });
    expect(minorChange(mig('db/migrations/001.sql')).failed).toEqual(['migration_changed']);
    expect(minorChange(mig('seed.sql')).failed).toEqual(['migration_changed']);
    expect(minorChange(mig('package.json')).minor).toBe(true);
    const outside = base({ numstat: [{ path: 'pnpm-lock.yaml', added: 1, deleted: 0, binary: false }], nameStatus: [{ status: 'M', path: 'pnpm-lock.yaml' }], hunks: {} });
    expect(minorChange(outside).failed).toEqual(['files_outside_fixes', 'manifest_changed']);
  });
  it('rule 5: a test file may not lose cases or assertions', () => {
    const t = (before: { cases: number; asserts: number }, after: { cases: number; asserts: number }) =>
      base({ fixes: [{ path: 'a.test.ts', line: null }], numstat: [{ path: 'a.test.ts', added: 1, deleted: 1, binary: false }], nameStatus: [{ status: 'M', path: 'a.test.ts' }], hunks: {}, testCounts: { 'a.test.ts': { before, after } } });
    expect(minorChange(t({ cases: 2, asserts: 5 }, { cases: 2, asserts: 4 })).failed).toEqual(['tests_lost_coverage']);
    expect(minorChange(t({ cases: 2, asserts: 5 }, { cases: 1, asserts: 5 })).failed).toEqual(['tests_lost_coverage']);
    expect(minorChange(t({ cases: 2, asserts: 5 }, { cases: 2, asserts: 6 })).minor).toBe(true);
  });
  it('rule 6: every hunk within 15 lines of a commented line', () => {
    expect(minorChange(base({ hunks: { 'src/a.ts': [{ oldStart: 66, oldCount: 1 }] } })).failed).toEqual(['hunk_far_from_comment']);
    expect(minorChange(base({ hunks: { 'src/a.ts': [{ oldStart: 65, oldCount: 1 }] } })).minor).toBe(true);
    expect(minorChange(base({ hunks: { 'src/a.ts': [{ oldStart: 48, oldCount: 1 }, { oldStart: 200, oldCount: 0 }] } })).failed).toEqual(['hunk_far_from_comment']);
    // a comment without a line is about the whole file
    expect(minorChange(base({ fixes: [{ path: 'src/a.ts', line: null }], hunks: { 'src/a.ts': [{ oldStart: 500, oldCount: 1 }] } })).minor).toBe(true);
  });
  it('reports several failed rules in order', () => {
    const r = minorChange(base({ nameStatus: [{ status: 'A', path: 'src/a.ts' }], hunks: { 'src/a.ts': [{ oldStart: 900, oldCount: 1 }] } }));
    expect(r.failed).toEqual(['files_added_or_deleted', 'hunk_far_from_comment']);
  });
});

describe('git output parsers', () => {
  it('parses numstat, including binary files', () => {
    expect(parseNumstat('3\t2\tsrc/a.ts\n-\t-\timg.png\n')).toEqual([
      { path: 'src/a.ts', added: 3, deleted: 2, binary: false },
      { path: 'img.png', added: 0, deleted: 0, binary: true },
    ]);
  });
  it('parses name-status', () => {
    expect(parseNameStatus('M\tsrc/a.ts\nA\tb.ts\nR100\told.ts\tnew.ts\n')).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'A', path: 'b.ts' },
      { status: 'R', path: 'new.ts' },
    ]);
  });
  it('parses -U0 hunk headers by file', () => {
    const out = ['diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -10 +10,2 @@ fn', '+x', '@@ -20,3 +21,0 @@', '-y', 'diff --git a/b.ts b/b.ts', '@@ -5,0 +6 @@', '+z'].join('\n');
    expect(parseHunks(out)).toEqual({
      'src/a.ts': [{ oldStart: 10, oldCount: 1 }, { oldStart: 20, oldCount: 3 }],
      'b.ts': [{ oldStart: 5, oldCount: 0 }],
    });
  });
  it('counts test cases and assertions', () => {
    expect(countTestMarkers("it('a', () => { expect(1).toBe(1); expect(2) });\ntest.skip('b', () => {});\nwait(1)")).toEqual({ cases: 2, asserts: 2 });
    expect(countTestMarkers(null)).toEqual({ cases: 0, asserts: 0 });
  });
});
