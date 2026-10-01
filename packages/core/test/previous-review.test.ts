import { describe, expect, it } from 'vitest';
import { PREVIOUS_REVIEW_CHANGES_MAX, previousReviewInput, shapePreviousReview, truncateChanges } from '../src/build/previous-review.ts';

describe('previous review shaping', () => {
  const row = { summary: 'Needs work', comments: [{ path: 'a.ts', line: 3, severity: 'blocking', body: 'fix', extra: 1 }, { nope: true }] };

  it('keeps well-formed comments and drops malformed ones', () => {
    expect(shapePreviousReview(row, 'abc', 'def')).toEqual({ summary: 'Needs work', head_sha: 'abc', comments: [{ path: 'a.ts', line: 3, severity: 'blocking', body: 'fix' }] });
  });

  it('is null when the sha is unknown or equals the current head', () => {
    expect(shapePreviousReview(row, null, 'def')).toBeNull();
    expect(shapePreviousReview(row, 'def', 'def')).toBeNull();
  });

  it('truncates a long diff with a note', () => {
    const out = truncateChanges('x'.repeat(PREVIOUS_REVIEW_CHANGES_MAX + 10));
    expect(out).toContain('[truncated: 10 more characters not shown]');
    expect(truncateChanges('short')).toBe('short');
  });

  it('ignores malformed pack input', () => {
    expect(previousReviewInput('nope')).toBeNull();
    expect(previousReviewInput({ summary: 's' })).toBeNull();
    expect(previousReviewInput({ summary: 's', head_sha: 'abc', comments: [] })).toEqual({ summary: 's', head_sha: 'abc', comments: [] });
  });
});
