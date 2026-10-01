// files.prediction (B07): recall@k and precision for Jev's order and the deterministic order (G01).

import { describe, expect, it } from 'vitest';
import { filesPrediction, scoreOrder } from '../src/harness/rules/files.ts';
import { inputs, mergedSteps, uid } from './support/harness-inputs.ts';

const op = (path: string, deterministic_score: number, rank: number, jev_p: number | null, attempt = 1) =>
  ({ id: uid('co'), build_request_id: 'r', attempt, path, deterministic_score, jev_p, rank }) as never;

// Jev puts the touched files first; the deterministic order puts them last.
const candidates = [
  op('src/a.ts', 0.1, 1, 0.9),
  op('src/b.ts', 0.2, 2, 0.8),
  op('src/c.ts', 0.9, 3, 0.1),
  op('src/d.ts', 0.8, 4, 0.1),
  op('src/e.ts', 0.7, 5, 0.1),
  op('src/f.ts', 0.6, 6, 0.1),
  op('src/g.ts', 0.5, 7, 0.1),
  op('src/h.ts', 0.4, 8, 0.1),
  op('src/i.ts', 0.3, 9, 0.1),
  op('src/j.ts', 0.25, 10, 0.1),
  op('src/k.ts', 0.22, 11, 0.1),
  op('src/l.ts', 0.21, 12, 0.1),
];

function run(files: string[], opts: { footprintAsString?: boolean; technical?: boolean; opinions?: never[] } = {}) {
  const i = inputs({ id: 'r1', technical: opts.technical, steps: mergedSteps('r1', files, { footprintAsString: opts.footprintAsString }), codeOpinions: opts.opinions ?? (candidates as never[]) });
  return filesPrediction(i);
}
const by = (list: ReturnType<typeof run>, subject: string) => list.find((f) => f.subject === subject)!;

describe('scoreOrder', () => {
  it('computes hits, precision and recall of the first k', () => {
    expect(scoreOrder(['a', 'b', 'c'], new Set(['a', 'x']), 2)).toMatchObject({ hits: 1, predicted: 2, actual: 2, precision: 0.5, recall: 0.5 });
  });
});

describe('files.prediction', () => {
  it('reports the Jev and the deterministic order as benefit findings', () => {
    // Real: two files in Jev's top 2, one file of the PR not in the list, a test and a lockfile (both excluded).
    const list = run(['src/a.ts', 'src/b.ts', 'src/other.ts', 'src/a.test.ts', 'pnpm-lock.yaml']).filter((f) => f.finding === 'files.prediction');
    expect(list).toHaveLength(2);
    expect(list.every((f) => f.class === 'benefit' && f.unit === 'files' && f.ground_truth === 'G01')).toBe(true);
    const jev = by(list, 'jev');
    expect(jev.value).toBe(2);
    expect(jev.evidence).toMatchObject({ k: 10, hits: 2, actual: 3, recall: 0.667, precision: 0.2 });
    // Deterministic top 10 by score: c, d, e, f, g, h, i, j, k, l; a and b are not in it.
    expect(by(list, 'deterministic').evidence).toMatchObject({ hits: 0, recall: 0, precision: 0 });
  });
  it('emits per-file tp/fp/fn rows for the Jev strong set (p >= 0.5), not for the whole top 10 (pm-5)', () => {
    const list = run(['src/a.ts', 'src/b.ts', 'src/other.ts']);
    const rows = list.filter((f) => f.finding === 'files.prediction_file');
    expect(rows.filter((f) => f.class === 'tp').map((f) => f.subject)).toEqual(['jev:src/a.ts', 'jev:src/b.ts']);
    expect(rows.filter((f) => f.class === 'fp')).toHaveLength(0); // only a (0.9) and b (0.8) have p >= 0.5
    const fn = rows.filter((f) => f.class === 'fn');
    expect(fn.map((f) => f.subject)).toEqual(['jev:src/other.ts']);
    expect(fn[0]!.evidence).toMatchObject({ outside_candidates: true }); // not among the 12 candidates of the map
    expect(rows.every((f) => f.subject!.startsWith('jev:') && f.piece === 'B07')).toBe(true);
    expect(list.filter((f) => f.class === 'benefit')).toHaveLength(2); // the aggregate rows stay
  });
  it('marks a miss that was a candidate but low as inside the candidates, and reports R-precision and recall@10 (pm-5)', () => {
    // c is a candidate with p 0.1: a real file Jev lowered, not one the map missed. Actual = {a, c}: R = 2, top 2 = a, b.
    const list = run(['src/a.ts', 'src/c.ts']);
    const fn = list.filter((f) => f.finding === 'files.prediction_file' && f.class === 'fn');
    expect(fn.map((f) => [f.subject, (f.evidence as { outside_candidates: boolean }).outside_candidates])).toEqual([['jev:src/c.ts', false]]);
    const jev = by(list.filter((f) => f.finding === 'files.prediction'), 'jev');
    expect(jev.evidence).toMatchObject({ r_precision: 0.5, recall: 1, strong_size: 2, strong_hits: 1, strong_precision: 0.5, strong_recall: 0.5, outside_candidates: [] });
    expect(list.find((f) => f.finding === 'files.r_precision' && f.subject === 'jev')).toMatchObject({ class: 'info', value: 0.5 });
    expect(list.find((f) => f.finding === 'files.recall_at_k' && f.subject === 'jev')).toMatchObject({ class: 'info', value: 1 });
  });
  it('reads the footprint stored as a JSON string (old format) when there is no commit list', () => {
    const i = inputs({ id: 'r3', steps: mergedSteps('r3', ['src/a.ts'], { footprintAsString: true }).filter((s) => s.stage !== 'commit'), codeOpinions: candidates as never[] });
    expect(by(filesPrediction(i), 'jev').value).toBe(1);
  });
  it('judges the FIRST attempt: files the PR itself created in an earlier attempt are not hits of a later one (TSK-WOR-008)', () => {
    // Attempt 1 offered a and b (existing files); the builder created src/new.ts; attempt 2 now sees it and offers it first.
    const opinions = [op('src/new.ts', 0.99, 1, 0.9, 2), op('src/a.ts', 0.5, 2, 0.5, 2), op('src/a.ts', 0.5, 1, 0.9, 1), op('src/b.ts', 0.4, 2, 0.8, 1)];
    const i = inputs({ id: 'r4', steps: mergedSteps('r4', ['src/a.ts', 'src/b.ts', 'src/new.ts'], { added: ['src/new.ts'] }), codeOpinions: opinions as never[] });
    const jev = by(filesPrediction(i), 'jev');
    expect(jev.attempt).toBe(1);
    expect(jev.evidence).toMatchObject({ actual: 2, hits: 2, hit_paths: ['src/a.ts', 'src/b.ts'] });
  });
  it('files created by the merged PR are not part of the real files to predict', () => {
    const i = inputs({ id: 'r5', steps: mergedSteps('r5', ['src/a.ts', 'src/created.ts'], { added: ['src/created.ts'] }), codeOpinions: [op('src/created.ts', 1, 1, 0.9), op('src/a.ts', 0.5, 2, 0.5)] as never[] });
    expect(by(filesPrediction(i), 'jev').evidence).toMatchObject({ actual: 1, hits: 1 });
  });
  it('marks a technical task as info and does not judge it', () => {
    const list = run(['src/a.ts'], { technical: true });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ finding: 'files.technical_task', class: 'info', unit: 'files' });
  });
  it('says nothing without opinions, without real source files or when not merged', () => {
    expect(run(['src/a.ts'], { opinions: [] })).toEqual([]);
    expect(run(['pnpm-lock.yaml', 'e2e/x.spec.ts'])).toEqual([]);
  });
});
