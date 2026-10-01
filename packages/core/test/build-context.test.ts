// The builder's earlier context: attempt history on a fresh restart, earlier builds of the task and review
// comments of sibling tasks (pure text builders).

import { describe, expect, it } from 'vitest';
import {
  type StepRow,
  attemptFacts,
  attemptHistoryLines,
  earlierBuildsLines,
  siblingReviewLines,
  HISTORY_MAX_CHARS,
} from '../src/build/context.ts';

const review = (body: string, severity = 'blocking') => ({ path: 'src/a.ts', line: 3, severity, body });
const steps: StepRow[] = [
  { attempt: 1, stage: 'builder', outcome: 'ok', detail: { progress: 'Wrote the parser. '.repeat(100) } },
  { attempt: 1, stage: 'evidence', outcome: 'ok', detail: { failures: [{ code: 'AC-X-001-01', test: 'parses a date', file: 'a.test.ts', message: 'LONG MESSAGE' }] } },
  { attempt: 1, stage: 'review', outcome: 'changes_requested', detail: { run_id: 'r1' } },
  { attempt: 2, stage: 'builder', outcome: 'failed', detail: { error: 'timeout' } },
  { attempt: 3, stage: 'builder', outcome: 'ok', detail: {} },
  { attempt: 3, stage: 'ci', outcome: 'failed', detail: {} },
];
const reviews = [{ run_id: 'r1', comments: [review('Handle the empty string.\nAlso trim.'), review('nit: rename', 'nit')] }];

describe('attempt history', () => {
  const facts = attemptFacts(steps, reviews);
  it('summarises how each attempt ended, the blocking comments, the failing tests and the progress', () => {
    expect(facts[0]).toMatchObject({ attempt: 1, ended: { stage: 'review', outcome: 'changes_requested' }, blocking: ['src/a.ts:3: Handle the empty string. Also trim.'], ciTests: ['AC-X-001-01: parses a date'] });
    expect(facts[1]!.ended).toEqual({ stage: 'builder', outcome: 'failed' });
  });
  it('lists attempts before N-1 only, with short progress and no CI messages', () => {
    const text = attemptHistoryLines(facts, 3, false).join('\n');
    expect(text).toContain('Earlier attempts on this branch');
    expect(text).toContain('Attempt 1: ended at review changes_requested');
    expect(text).not.toContain('Attempt 2');
    expect(text).not.toContain('LONG MESSAGE');
    expect(text).toContain('CI failed: AC-X-001-01: parses a date');
    expect(text.length).toBeLessThan(1200);
  });
  it('is empty when resumed, on attempt 2 or when there is nothing older', () => {
    expect(attemptHistoryLines(facts, 3, true)).toEqual([]);
    expect(attemptHistoryLines(facts, 2, false)).toEqual([]);
    expect(attemptHistoryLines(facts, 1, false)).toEqual([]);
  });
  it('drops the oldest attempts over the cap and says so', () => {
    const many = Array.from({ length: 40 }, (_, i): StepRow => ({ attempt: i + 1, stage: 'builder', outcome: 'ok', detail: { progress: 'x'.repeat(900) } }));
    const lines = attemptHistoryLines(attemptFacts(many, []), 41, false);
    const text = lines.join('\n');
    expect(text.length).toBeLessThanOrEqual(HISTORY_MAX_CHARS + 200);
    expect(text).toMatch(/Attempts 1-\d+ are left out/);
    expect(text).toContain('Attempt 39:');
    expect(text).not.toContain('Attempt 40:');
  });
});

describe('earlier builds', () => {
  const merged = { taskVersion: 1, state: 'done', prUrl: 'https://github.com/a/b/pull/4', mergeCommit: 'abcdef0123456789', why: null, blocking: ['a.ts:1: Fix X'], ciTests: ['AC-1: t'], progress: 'done mostly' };
  it('says plainly that merged code is on main and shows merge data, newest first, at most 3', () => {
    const text = earlierBuildsLines([merged, { ...merged, taskVersion: 2, state: 'withdrawn', why: 'rebuilt', mergeCommit: null }, merged, merged]).join('\n');
    expect(text).toContain('The code of a merged earlier build is already on main: extend it, do not rewrite it');
    expect(text).toContain('merged, pull request https://github.com/a/b/pull/4, merge commit abcdef012345');
    expect(text).toContain('withdrawn: rebuilt');
    expect(text.match(/- Build of task version/g)).toHaveLength(3);
    expect(text).toContain('The reviewer last asked for:');
  });
  it('is empty with no builds', () => expect(earlierBuildsLines([])).toEqual([]));
});

describe('sibling reviews', () => {
  it('deduplicates, caps at 8 and names the task', () => {
    const same = Array.from({ length: 3 }, () => ({ task: 'TSK-A-001', line: 'x.ts:1: Validate input' }));
    const other = Array.from({ length: 12 }, (_, i) => ({ task: 'TSK-A-002', line: `y.ts:${i}: Distinct comment ${i}` }));
    const lines = siblingReviewLines([...same, ...other]);
    expect(lines[0]).toBe('# Review comments on earlier tasks of this feature (avoid repeating them)');
    expect(lines.filter((l) => l.startsWith('- '))).toHaveLength(8);
    expect(lines.filter((l) => l.includes('Validate input'))).toHaveLength(1);
  });
  it('is empty with no comments', () => expect(siblingReviewLines([])).toEqual([]));
});
