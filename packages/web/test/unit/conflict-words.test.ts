import { describe, expect, it } from 'vitest';
import { buildFact, changeCodeOf, olderFirst, prNumberOf, quotesOf, sentencesOf, surenessOf } from '../../src/screens/needs-you/conflict.ts';
import { conflictTitle } from '../../src/screens/needs-you/titles.ts';
import type { NeedItem } from '../../src/screens/needs-you/order.ts';
import type { ProductRow } from '../../src/api/types.ts';

const reason = 'Differ. Change: "meals repeat every week" Candidate: "meals repeat every day"';
const rows = [
  { code: 'TSK-MEA-038', title: 'Daily plan', latest_id: 'v38', current_id: 'v38' },
  { code: 'TSK-MEA-040', title: 'Weekly plan', latest_id: 'v40', current_id: 'v40' },
] as unknown as ProductRow[];

describe('conflict in plain words', () => {
  it('reads the two sentences: A is the record to review (candidate), B the change', () => {
    expect(quotesOf(reason)).toEqual({ change: 'meals repeat every week', candidate: 'meals repeat every day' });
    expect(sentencesOf({ reason })).toEqual({ a: 'meals repeat every day', b: 'meals repeat every week' });
    expect(sentencesOf({ quotes: { record: 'x'.repeat(9), other: 'y'.repeat(9) } }).b).toBe('y'.repeat(9));
    expect(sentencesOf({ reason: 'no quotes' })).toEqual({ a: null, b: null });
  });
  it('gives a probability except for coherence findings', () => {
    expect(surenessOf({ confidence: 0.99 })).toBe(99);
    expect(surenessOf({ confidence: 1, quotes: { record: 'a', other: 'b' } })).toBeNull();
  });
  it('puts the older side first, and keeps the record to review first when unknown', () => {
    const a = { code: 'A', when: '2026-10-01T10:00:00Z' };
    const b = { code: 'B', when: '2026-09-30T10:00:00Z' };
    expect(olderFirst(a, b).map((s) => s.code)).toEqual(['B', 'A']);
    expect(olderFirst(b, a).map((s) => s.code)).toEqual(['B', 'A']);
    expect(olderFirst(a, { code: 'B', when: null }).map((s) => s.code)).toEqual(['A', 'B']);
  });
  it('says the build state only for a merged or open pull request', () => {
    expect(prNumberOf('https://github.com/o/r/pull/30')).toBe(30);
    expect(buildFact('merged', 'https://github.com/o/r/pull/30')).toEqual({ kind: 'merged', pr: 30 });
    expect(buildFact('in_pr', null)).toEqual({ kind: 'open', pr: null });
    expect(buildFact('to_do', null)).toBeNull();
    expect(buildFact(undefined, null)).toBeNull();
  });
  it('names the list row «B vs A: topic»', () => {
    const review = { record: { code: 'TSK-MEA-038', version: 1 }, change: { id: 'v40', version: 1 }, verdict: 'update' };
    expect(changeCodeOf(review, rows)).toBe('TSK-MEA-040');
    const item = { kind: 'conflict', proposal: { payload: review } } as unknown as Extract<NeedItem, { kind: 'conflict' }>;
    expect(conflictTitle(item, rows)).toBe('TSK-MEA-040 vs TSK-MEA-038: Daily plan');
  });
});
