import { describe, expect, it } from 'vitest';
import { approvedWithFixes, countFixes, fixCommentsOf, waiveReview } from '../src/build/lgtm.ts';

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
