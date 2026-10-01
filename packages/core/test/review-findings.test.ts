import { describe, expect, it } from 'vitest';
import { type BounceRow, aggregateBounces, buildFindingsRequest, parseFindings } from '../src/classifier/review-findings.ts';

const comments = [
  { path: 'a.ts', line: 3, severity: 'blocking', body: 'test.fixme leaves the criterion uncovered' },
  { path: 'README.md', line: null, severity: 'nit', body: 'typo' },
];

describe('review findings', () => {
  it('builds one Choice and one Noul per comment over a shared state', () => {
    const r = buildFindingsRequest(comments, [{ code: 'AC-1', covered: false, note: 'no test' }]);
    expect(Object.keys(r.questions)).toEqual(['c0_kind', 'c0_avoid', 'c1_kind', 'c1_avoid']);
    expect((r.state as { comments: unknown[] }).comments).toHaveLength(2);
    expect((r.state as { task_criteria: { code: string }[] }).task_criteria[0]?.code).toBe('AC-1');
  });

  it('parses answers and skips invalid ones', () => {
    const state = { s: 1 };
    const f = parseFindings(
      { c0_kind: { choice: 'test_gap', probabilities: { test_gap: 0.8 } }, c0_avoid: { noul: 0.7 }, c1_kind: { choice: 'bogus' }, c1_avoid: { noul: 0.1 } },
      state,
      2,
      'm',
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ index: 0, category: 'test_gap', p: 0.8, avoidable_p: 0.7 });
  });

  it('aggregates the latest opinion per comment with counts, avoidable and latest example', () => {
    const row = (review: string, i: number, category: string, avoidable_p: number, at: number, body = 'x'): BounceRow => ({
      pr_review_id: review, comment_index: i, category, avoidable_p, created_at: new Date(at), path: 'f.ts', body,
    });
    const out = aggregateBounces([
      row('r1', 0, 'defect', 0.9, 1),
      row('r1', 0, 'test_gap', 0.8, 2, 'old'),
      row('r2', 0, 'test_gap', 0.2, 3, 'newer'),
      row('r2', 1, 'test_gap', 0.6, 1),
      row('r3', 0, 'nit', 0.1, 5),
    ]);
    expect(out.map((b) => [b.category, b.count, b.avoidable])).toEqual([['test_gap', 3, 2], ['nit', 1, 0]]);
    expect(out[0]?.example.body).toBe('newer');
  });
});
