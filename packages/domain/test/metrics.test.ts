import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VERDICTS } from '../src/classifier.ts';
import { loadJsonlCases, evaluateClassification, DEFAULT_CURVE_THRESHOLDS } from '../src/metrics.ts';

// All the expected figures are calculated by hand in each test's comments.

describe('evaluateClassification', () => {
  it('AC-CON-001-11 computes accuracy, precision, recall, F1, macro-averages and confusion matrix', () => {
    // expected → actual: a→a, a→a, a→b, b→b, b→a, c→a
    // a: support 3, predicted 4, hits 2 → P = 1/2, R = 2/3, F1 = 4/7
    // b: support 2, predicted 2, hits 1 → P = 1/2, R = 1/2, F1 = 1/2
    // c: support 1, predicted 0 → P = 0 (no predictions), R = 0, F1 = 0
    const r = evaluateClassification({
      classes: ['a', 'b', 'c'],
      cases: [
        { expected: 'a', actual: 'a' },
        { expected: 'a', actual: 'a' },
        { expected: 'a', actual: 'b' },
        { expected: 'b', actual: 'b' },
        { expected: 'b', actual: 'a' },
        { expected: 'c', actual: 'a' },
      ],
    });

    expect(r.total).toBe(6);
    expect(r.hits).toBe(3);
    expect(r.accuracy).toBeCloseTo(0.5, 12);

    expect(r.byClass.a).toMatchObject({ support: 3, predicted: 4, hits: 2, noPredictions: false, noSupport: false });
    expect(r.byClass.a.precision).toBeCloseTo(1 / 2, 12);
    expect(r.byClass.a.recall).toBeCloseTo(2 / 3, 12);
    expect(r.byClass.a.f1).toBeCloseTo(4 / 7, 12);

    expect(r.byClass.b).toMatchObject({ support: 2, predicted: 2, hits: 1 });
    expect(r.byClass.b.precision).toBeCloseTo(1 / 2, 12);
    expect(r.byClass.b.recall).toBeCloseTo(1 / 2, 12);
    expect(r.byClass.b.f1).toBeCloseTo(1 / 2, 12);

    expect(r.byClass.c).toEqual({
      support: 1,
      predicted: 0,
      hits: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      noPredictions: true,
      noSupport: false,
    });

    // Macro over a, b and c: P = (1/2 + 1/2 + 0)/3 = 1/3; R = (2/3 + 1/2 + 0)/3 = 7/18; F1 = (4/7 + 1/2 + 0)/3 = 5/14
    expect(r.macro.classes).toEqual(['a', 'b', 'c']);
    expect(r.macro.precision).toBeCloseTo(1 / 3, 12);
    expect(r.macro.recall).toBeCloseTo(7 / 18, 12);
    expect(r.macro.f1).toBeCloseTo(5 / 14, 12);

    expect(r.matrix).toEqual({
      a: { a: 2, b: 1, c: 0 },
      b: { a: 1, b: 1, c: 0 },
      c: { a: 1, b: 0, c: 0 },
    });
    expect(r.curve).toBeNull();
  });

  it('AC-CON-001-11 leaves out of the macro-averages the classes that are neither expected nor predicted', () => {
    // x→x, y→x. x: P = 1/2, R = 1, F1 = 2/3. y: no predictions, everything 0. z: does not appear.
    // Macro over x and y: P = 1/4, R = 1/2, F1 = 1/3.
    const r = evaluateClassification({
      classes: ['x', 'y', 'z'],
      cases: [
        { expected: 'x', actual: 'x' },
        { expected: 'y', actual: 'x' },
      ],
    });

    expect(r.byClass.x.precision).toBeCloseTo(1 / 2, 12);
    expect(r.byClass.x.recall).toBe(1);
    expect(r.byClass.x.f1).toBeCloseTo(2 / 3, 12);
    expect(r.byClass.y).toMatchObject({ precision: 0, recall: 0, f1: 0, noPredictions: true, noSupport: false });
    expect(r.byClass.z).toMatchObject({ support: 0, predicted: 0, noPredictions: true, noSupport: true, f1: 0 });

    expect(r.macro.classes).toEqual(['x', 'y']);
    expect(r.macro.precision).toBeCloseTo(1 / 4, 12);
    expect(r.macro.recall).toBeCloseTo(1 / 2, 12);
    expect(r.macro.f1).toBeCloseTo(1 / 3, 12);
  });

  it('AC-CON-001-11 counts in the macro a class predicted without support, with recall 0 by convention', () => {
    // p→q, p→p. p: support 2, predicted 1, hits 1 → P = 1, R = 1/2, F1 = 2/3.
    // q: support 0, predicted 1 → P = 0, R = 0 (no support), F1 = 0.
    // Macro: P = 1/2, R = 1/4, F1 = 1/3.
    const r = evaluateClassification({
      classes: ['p', 'q'],
      cases: [
        { expected: 'p', actual: 'q' },
        { expected: 'p', actual: 'p' },
      ],
    });

    expect(r.byClass.p.precision).toBe(1);
    expect(r.byClass.p.recall).toBeCloseTo(1 / 2, 12);
    expect(r.byClass.p.f1).toBeCloseTo(2 / 3, 12);
    expect(r.byClass.q).toMatchObject({
      support: 0,
      predicted: 1,
      precision: 0,
      recall: 0,
      noPredictions: false,
      noSupport: true,
    });
    expect(r.macro.classes).toEqual(['p', 'q']);
    expect(r.macro.precision).toBeCloseTo(1 / 2, 12);
    expect(r.macro.recall).toBeCloseTo(1 / 4, 12);
    expect(r.macro.f1).toBeCloseTo(1 / 3, 12);
    expect(r.matrix.p).toEqual({ p: 1, q: 1 });
  });

  it('AC-CON-001-11 computes the coverage-precision curve by threshold, sorted and without repeated thresholds', () => {
    // (expected → actual, confidence): a→a 0.9 ✓ · a→b 0.4 ✗ · b→b 0.8 ✓ · b→a 0.95 ✗ · c→c 0.6 ✓
    // ≥ 0    → 5 cases, 3 hits: proportion 1, accuracy 3/5
    // ≥ 0.5  → 4 cases (0.9 0.8 0.95 0.6), 3 hits: proportion 4/5, accuracy 3/4
    // ≥ 0.8  → 3 cases (0.9 0.8 0.95), 2 hits: proportion 3/5, accuracy 2/3 (the exact threshold counts)
    // ≥ 0.99 → no cases: proportion 0, accuracy null
    const r = evaluateClassification({
      classes: ['a', 'b', 'c'],
      cases: [
        { expected: 'a', actual: 'a', confidence: 0.9 },
        { expected: 'a', actual: 'b', confidence: 0.4 },
        { expected: 'b', actual: 'b', confidence: 0.8 },
        { expected: 'b', actual: 'a', confidence: 0.95 },
        { expected: 'c', actual: 'c', confidence: 0.6 },
      ],
      thresholds: [0.8, 0, 0.99, 0.5, 0.5],
    });

    expect(r.accuracy).toBeCloseTo(3 / 5, 12);
    expect(r.curve).not.toBeNull();
    const curve = r.curve ?? [];
    expect(curve.map((p) => p.threshold)).toEqual([0, 0.5, 0.8, 0.99]);
    expect(curve.map((p) => [p.cases, p.hits])).toEqual([
      [5, 3],
      [4, 3],
      [3, 2],
      [0, 0],
    ]);
    expect(curve[0]?.proportion).toBe(1);
    expect(curve[0]?.accuracy).toBeCloseTo(3 / 5, 12);
    expect(curve[1]?.proportion).toBeCloseTo(4 / 5, 12);
    expect(curve[1]?.accuracy).toBeCloseTo(3 / 4, 12);
    expect(curve[2]?.proportion).toBeCloseTo(3 / 5, 12);
    expect(curve[2]?.accuracy).toBeCloseTo(2 / 3, 12);
    expect(curve[3]).toEqual({ threshold: 0.99, cases: 0, proportion: 0, hits: 0, accuracy: null });
  });

  it('AC-CON-001-11 uses the default thresholds when none are given', () => {
    const r = evaluateClassification({
      classes: VERDICTS,
      cases: [
        { expected: 'keep', actual: 'keep', confidence: 0.97 },
        { expected: 'invalidate', actual: 'keep', confidence: 0.52 },
      ],
    });
    expect(r.curve?.map((p) => p.threshold)).toEqual([...DEFAULT_CURVE_THRESHOLDS]);
    expect(r.matrix.invalidate.keep).toBe(1);
    // Classes that don't appear are flagged and left out of the macro.
    expect(r.byClass.other).toMatchObject({ noSupport: true, noPredictions: true });
    expect(r.macro.classes).toEqual(['keep', 'invalidate']);
  });

  it("AC-CON-001-11 rejects inputs that don't allow measuring", () => {
    const classes = ['a', 'b'] as const;
    expect(() => evaluateClassification({ classes, cases: [] })).toThrow(/There are no cases/);
    expect(() => evaluateClassification({ classes: [], cases: [] })).toThrow(/At least one class/);
    expect(() => evaluateClassification({ classes: ['a', 'a'], cases: [{ expected: 'a', actual: 'a' }] })).toThrow(
      /cannot repeat/,
    );
    expect(() => evaluateClassification({ classes: ['a', 'b'] as string[], cases: [{ expected: 'a', actual: 'zeta' }] })).toThrow(
      /Case 1.*"zeta"/,
    );
    expect(() =>
      evaluateClassification({
        classes,
        cases: [
          { expected: 'a', actual: 'a', confidence: 0.7 },
          { expected: 'b', actual: 'b' },
        ],
      }),
    ).toThrow(/Missing confidence values: 1 of 2/);
    expect(() => evaluateClassification({ classes, cases: [{ expected: 'a', actual: 'a', confidence: 1.2 }] })).toThrow(
      /confidence/,
    );
    expect(() =>
      evaluateClassification({ classes, cases: [{ expected: 'a', actual: 'a', confidence: 0.5 }], thresholds: [Number.NaN] }),
    ).toThrow(/Threshold/);
  });
});

describe('loadJsonlCases', () => {
  const schema = z.object({ id: z.string(), n: z.number() }).strict();

  it('AC-CON-001-11 reads one case per line and skips blank lines', () => {
    const cases = loadJsonlCases('{"id":"A","n":1}\r\n\n  \n{"id":"B","n":2}\n', schema);
    expect(cases).toEqual([
      { id: 'A', n: 1 },
      { id: 'B', n: 2 },
    ]);
  });

  it("AC-CON-001-11 reports every line that doesn't match the format, with its line number", () => {
    const text = ['{"id":"A","n":1}', '{"id":"B"', '{"id":"C","n":"tres"}', '{"id":"D","n":4,"extra":true}'].join('\n');
    let message = '';
    try {
      loadJsonlCases(text, schema);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/line 2: invalid JSON/);
    expect(message).toMatch(/line 3: n:/);
    expect(message).toMatch(/line 4:/);
    expect(message).not.toMatch(/line 1:/);
  });
});
