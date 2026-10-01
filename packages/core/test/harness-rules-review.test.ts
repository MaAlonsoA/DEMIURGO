// Reviewer rules (salud-del-harness 1.4): one case per class, over synthetic post-mortem inputs (pure, no database).

import { describe, expect, it } from 'vitest';
import type { PostmortemInputs } from '../src/harness/postmortem.ts';
import { reviewCost, reviewEscape, reviewFindingOutcome, reviewRepeat, reviewWaiver, trigramSimilarity } from '../src/harness/rules/review.ts';

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 12, 0, clock++));
const step = (attempt: number, stage: string, outcome: string, detail: unknown) => ({ id: `s${clock}`, project_id: 'p', build_request_id: 'r', attempt, stage, outcome, detail, created_at: at() });
const review = (runId: string, verdict: string, comments: unknown[]) => ({ id: `rv-${runId}`, run_id: runId, verdict, summary: '', comments, criteria: [], created_at: at() });
const comment = (path: string, severity: string, body = 'Handle the empty list case here.', extra: object = {}) => ({ path, line: 1, severity, body, ...extra });
const inputs = (o: { steps: ReturnType<typeof step>[]; reviews?: unknown; issues?: unknown; reviewRuns?: unknown }, state = 'done'): PostmortemInputs =>
  ({ request: { id: 'r', state, done_at: new Date(Date.UTC(2026, 9, 1, 13)) }, taskCode: 'TSK-X-001', reviews: [], codeOpinions: [], layersOpinion: null, testRuns: [], ...o }) as unknown as PostmortemInputs;
const classes = (f: { class: string }[]) => f.map((x) => x.class);

describe('review.finding_outcome', () => {
  it('tp: a blocking comment, then a builder commit that touches its path', () => {
    const steps = [step(1, 'review', 'changes_requested', { run_id: 'a' })];
    const rv = review('a', 'request_changes', [comment('src/a.ts', 'blocking')]);
    const next = [step(2, 'commit', 'ok', { files: ['./src/a.ts', 'src/b.ts'] })];
    const f = reviewFindingOutcome(inputs({ steps: [...steps, ...next], reviews: [rv] as never }));
    expect(f).toMatchObject([{ class: 'tp', ground_truth: 'G04', subject: 'src/a.ts' }]);
  });
  it('fp: the path was not touched and a later review approved anyway', () => {
    const steps = [step(1, 'review', 'changes_requested', { run_id: 'a' }), step(2, 'commit', 'ok', { files: ['src/z.ts'] }), step(2, 'review', 'ok', { run_id: 'b' })];
    const reviews = [review('a', 'request_changes', [comment('src/a.ts', 'blocking')]), review('b', 'approve', [])];
    expect(classes(reviewFindingOutcome(inputs({ steps, reviews: reviews as never })))).toEqual(['fp']);
  });
  it('unresolved (info): no later review, the path was never touched; a nit is info too', () => {
    const steps = [step(1, 'review', 'changes_requested', { run_id: 'a' })];
    const rv = review('a', 'request_changes', [comment('src/a.ts', 'blocking'), comment('src/n.ts', 'nit')]);
    const f = reviewFindingOutcome(inputs({ steps, reviews: [rv] as never }, 'withdrawn'));
    expect(classes(f)).toEqual(['info', 'info']);
    expect(f[0]!.evidence).toMatchObject({ unresolved: true });
  });
  it('reads a commit file list stored as a JSON string (older rows)', () => {
    const first = step(1, 'review', 'changes_requested', { run_id: 'a' });
    const rv = review('a', 'request_changes', [comment('src/a.ts', 'blocking')]);
    const steps = [first, step(2, 'commit', 'ok', JSON.stringify({ files: ['src/a.ts'] }))];
    expect(classes(reviewFindingOutcome(inputs({ steps, reviews: [rv] as never })))).toEqual(['tp']);
  });
});

describe('review.repeat', () => {
  it('fn: the same blocking comment on the same path in the next round', () => {
    const steps = [step(1, 'review', 'changes_requested', { run_id: 'a' }), step(2, 'review', 'changes_requested', { run_id: 'b' })];
    const reviews = [review('a', 'request_changes', [comment('src/a.ts', 'blocking', 'The empty list case is not handled here.')]), review('b', 'request_changes', [comment('src/a.ts', 'blocking', 'The empty list case is still not handled here.')])];
    const f = reviewRepeat(inputs({ steps, reviews: reviews as never }));
    expect(f).toMatchObject([{ class: 'fn', subject: 'src/a.ts', attempt: 2 }]);
  });
  it('nothing for another path or a different text', () => {
    const steps = [step(1, 'review', 'changes_requested', { run_id: 'a' }), step(2, 'review', 'changes_requested', { run_id: 'b' })];
    const reviews = [review('a', 'request_changes', [comment('src/a.ts', 'blocking', 'Missing null check on the user.')]), review('b', 'request_changes', [comment('src/a.ts', 'blocking', 'Rename the exported constant to upper case.'), comment('src/b.ts', 'blocking', 'Missing null check on the user.')])];
    expect(reviewRepeat(inputs({ steps, reviews: reviews as never }))).toEqual([]);
  });
  it('trigram similarity is 1 for equal text and low for unrelated text', () => {
    expect(trigramSimilarity('Missing null check', 'missing NULL check')).toBe(1);
    expect(trigramSimilarity('Missing null check', 'Rename the constant')).toBeLessThan(0.3);
  });
});

describe('review.escape', () => {
  const approved = () => ({ steps: [step(1, 'review', 'ok', { run_id: 'a' })], reviews: [review('a', 'approve', [])] as never });
  it('fn: main failed after the merge, and an issue opened after it', () => {
    const o = approved();
    o.steps.push(step(1, 'main', 'failed', { sha: 'abc', conclusion: 'failure' }));
    const issues = [{ id: 'i1', code: 'ISS-001', kind: 'bug', source_key: null, opened_at: new Date(Date.UTC(2026, 9, 1, 14)) }];
    const f = reviewEscape(inputs({ ...o, issues: issues as never }));
    expect(f.map((x) => [x.class, x.ground_truth])).toEqual([['fn', 'G03'], ['fn', 'G10']]);
  });
  it('tn: main was seen green and nothing opened; a superseded red does not count', () => {
    const o = approved();
    o.steps.push(step(1, 'main', 'failed', { superseded: true }), step(1, 'main', 'ok', {}));
    expect(classes(reviewEscape(inputs(o)))).toEqual(['tn']);
  });
  it('nothing while main was not seen, or when the request did not merge', () => {
    expect(reviewEscape(inputs(approved()))).toEqual([]);
    expect(reviewEscape(inputs(approved(), 'withdrawn'))).toEqual([]);
  });
});

describe('review.waiver', () => {
  it('tp: waived and merged without main red; fp: waived and main went red', () => {
    const waived = step(2, 'review', 'ok', { waived: 'lgtm_with_comments', waiver: { rules_failed: [], jev: 'ok' } });
    expect(classes(reviewWaiver(inputs({ steps: [waived] })))).toEqual(['tp']);
    expect(classes(reviewWaiver(inputs({ steps: [waived, step(2, 'main', 'failed', {})] })))).toEqual(['fp']);
  });
  it('fn: refused and the next review approved with no comments; tn: it found something', () => {
    const refused = step(2, 'review', 'waiting', { run_id: 'b', waiver_refused: 'files_outside_fixes' });
    const runs = [{ id: 'b', usage: { inputTokens: 1000, outputTokens: 50 }, started_at: null, finished_at: null }];
    const idle = reviewWaiver(inputs({ steps: [refused], reviews: [review('b', 'approve', [])] as never, reviewRuns: runs as never }));
    expect(idle).toMatchObject([{ class: 'fn', value: 1050, unit: 'tokens' }]);
    const found = reviewWaiver(inputs({ steps: [refused], reviews: [review('b', 'request_changes', [comment('a', 'blocking')])] as never }));
    expect(classes(found)).toEqual(['tn']);
  });
});

describe('review.cost', () => {
  it('tokens and minutes of each review run', () => {
    const rv = review('a', 'approve', []);
    const runs = [{ id: 'a', usage: { inputTokens: 900, outputTokens: 100 }, started_at: new Date(Date.UTC(2026, 9, 1, 12)), finished_at: new Date(Date.UTC(2026, 9, 1, 12, 3)) }];
    const f = reviewCost(inputs({ steps: [step(1, 'review', 'ok', { run_id: 'a' })], reviews: [rv] as never, reviewRuns: runs as never }));
    expect(f.map((x) => [x.unit, x.value])).toEqual([['tokens', 1000], ['min', 3]]);
  });
  it('nothing without the run row', () => {
    expect(reviewCost(inputs({ steps: [], reviews: [review('a', 'approve', [])] as never }))).toEqual([]);
  });
});
