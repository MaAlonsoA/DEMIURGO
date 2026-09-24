import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VERDICTS } from '../src/classifier.ts';
import { loadJsonlCases, evaluateClassification, DEFAULT_CURVE_THRESHOLDS } from '../src/metrics.ts';

// Todas las cifras esperadas están calculadas a mano en los comentarios de cada prueba.

describe('evaluateClassification', () => {
  it('AC-CON-001-11 calcula exactitud, precisión, cobertura, F1, macro-promedios y matriz de confusión', () => {
    // esperado → obtenido: a→a, a→a, a→b, b→b, b→a, c→a
    // a: soporte 3, predichos 4, aciertos 2 → P = 1/2, C = 2/3, F1 = 4/7
    // b: soporte 2, predichos 2, aciertos 1 → P = 1/2, C = 1/2, F1 = 1/2
    // c: soporte 1, predichos 0 → P = 0 (sin predicciones), C = 0, F1 = 0
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

    // Macro sobre a, b y c: P = (1/2 + 1/2 + 0)/3 = 1/3; C = (2/3 + 1/2 + 0)/3 = 7/18; F1 = (4/7 + 1/2 + 0)/3 = 5/14
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

  it('AC-CON-001-11 deja fuera de los macro-promedios las clases que ni se esperan ni se predicen', () => {
    // x→x, y→x. x: P = 1/2, C = 1, F1 = 2/3. y: sin predicciones, todo 0. z: no aparece.
    // Macro sobre x e y: P = 1/4, C = 1/2, F1 = 1/3.
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

  it('AC-CON-001-11 cuenta en el macro una clase predicha sin soporte, con cobertura 0 por convenio', () => {
    // p→q, p→p. p: soporte 2, predichos 1, aciertos 1 → P = 1, C = 1/2, F1 = 2/3.
    // q: soporte 0, predichos 1 → P = 0, C = 0 (sin soporte), F1 = 0.
    // Macro: P = 1/2, C = 1/4, F1 = 1/3.
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

  it('AC-CON-001-11 calcula la curva cobertura–precisión por umbral, ordenada y sin umbrales repetidos', () => {
    // (esperado → obtenido, confianza): a→a 0,9 ✓ · a→b 0,4 ✗ · b→b 0,8 ✓ · b→a 0,95 ✗ · c→c 0,6 ✓
    // ≥ 0    → 5 casos, 3 aciertos: proporción 1, exactitud 3/5
    // ≥ 0,5  → 4 casos (0,9 0,8 0,95 0,6), 3 aciertos: proporción 4/5, exactitud 3/4
    // ≥ 0,8  → 3 casos (0,9 0,8 0,95), 2 aciertos: proporción 3/5, exactitud 2/3 (el umbral exacto cuenta)
    // ≥ 0,99 → ningún caso: proporción 0, exactitud null
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

  it('AC-CON-001-11 usa los umbrales por defecto cuando no se indican', () => {
    const r = evaluateClassification({
      classes: VERDICTS,
      cases: [
        { expected: 'keep', actual: 'keep', confidence: 0.97 },
        { expected: 'invalidate', actual: 'keep', confidence: 0.52 },
      ],
    });
    expect(r.curve?.map((p) => p.threshold)).toEqual([...DEFAULT_CURVE_THRESHOLDS]);
    expect(r.matrix.invalidate.keep).toBe(1);
    // Las clases que no aparecen quedan marcadas y fuera del macro.
    expect(r.byClass.other).toMatchObject({ noSupport: true, noPredictions: true });
    expect(r.macro.classes).toEqual(['keep', 'invalidate']);
  });

  it('AC-CON-001-11 rechaza entradas que no permiten medir', () => {
    const classes = ['a', 'b'] as const;
    expect(() => evaluateClassification({ classes, cases: [] })).toThrow(/No hay casos/);
    expect(() => evaluateClassification({ classes: [], cases: [] })).toThrow(/al menos una clase/);
    expect(() => evaluateClassification({ classes: ['a', 'a'], cases: [{ expected: 'a', actual: 'a' }] })).toThrow(/repetirse/);
    expect(() => evaluateClassification({ classes: ['a', 'b'] as string[], cases: [{ expected: 'a', actual: 'zeta' }] })).toThrow(
      /caso 1.*«zeta»/,
    );
    expect(() =>
      evaluateClassification({
        classes,
        cases: [
          { expected: 'a', actual: 'a', confidence: 0.7 },
          { expected: 'b', actual: 'b' },
        ],
      }),
    ).toThrow(/Faltan confianzas: 1 de 2/);
    expect(() => evaluateClassification({ classes, cases: [{ expected: 'a', actual: 'a', confidence: 1.2 }] })).toThrow(
      /confianza/,
    );
    expect(() =>
      evaluateClassification({ classes, cases: [{ expected: 'a', actual: 'a', confidence: 0.5 }], thresholds: [Number.NaN] }),
    ).toThrow(/umbral/);
  });
});

describe('loadJsonlCases', () => {
  const schema = z.object({ id: z.string(), n: z.number() }).strict();

  it('AC-CON-001-11 lee un caso por línea y salta las líneas en blanco', () => {
    const cases = loadJsonlCases('{"id":"A","n":1}\r\n\n  \n{"id":"B","n":2}\n', schema);
    expect(cases).toEqual([
      { id: 'A', n: 1 },
      { id: 'B', n: 2 },
    ]);
  });

  it('AC-CON-001-11 informa de todas las líneas que no cumplen el formato con su número', () => {
    const text = ['{"id":"A","n":1}', '{"id":"B"', '{"id":"C","n":"tres"}', '{"id":"D","n":4,"extra":true}'].join('\n');
    let message = '';
    try {
      loadJsonlCases(text, schema);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/línea 2: JSON no válido/);
    expect(message).toMatch(/línea 3: n:/);
    expect(message).toMatch(/línea 4:/);
    expect(message).not.toMatch(/línea 1:/);
  });
});
