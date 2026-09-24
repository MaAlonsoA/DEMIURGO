import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VEREDICTOS } from '../src/clasificador.ts';
import { cargarCasosJsonl, evaluarClasificacion, UMBRALES_CURVA_POR_DEFECTO } from '../src/metricas.ts';

// Todas las cifras esperadas están calculadas a mano en los comentarios de cada prueba.

describe('evaluarClasificacion', () => {
  it('AC-CON-001-11 calcula exactitud, precisión, cobertura, F1, macro-promedios y matriz de confusión', () => {
    // esperado → obtenido: a→a, a→a, a→b, b→b, b→a, c→a
    // a: soporte 3, predichos 4, aciertos 2 → P = 1/2, C = 2/3, F1 = 4/7
    // b: soporte 2, predichos 2, aciertos 1 → P = 1/2, C = 1/2, F1 = 1/2
    // c: soporte 1, predichos 0 → P = 0 (sin predicciones), C = 0, F1 = 0
    const r = evaluarClasificacion({
      clases: ['a', 'b', 'c'],
      casos: [
        { esperado: 'a', obtenido: 'a' },
        { esperado: 'a', obtenido: 'a' },
        { esperado: 'a', obtenido: 'b' },
        { esperado: 'b', obtenido: 'b' },
        { esperado: 'b', obtenido: 'a' },
        { esperado: 'c', obtenido: 'a' },
      ],
    });

    expect(r.total).toBe(6);
    expect(r.aciertos).toBe(3);
    expect(r.exactitud).toBeCloseTo(0.5, 12);

    expect(r.porClase.a).toMatchObject({ soporte: 3, predichos: 4, aciertos: 2, sinPredicciones: false, sinSoporte: false });
    expect(r.porClase.a.precision).toBeCloseTo(1 / 2, 12);
    expect(r.porClase.a.cobertura).toBeCloseTo(2 / 3, 12);
    expect(r.porClase.a.f1).toBeCloseTo(4 / 7, 12);

    expect(r.porClase.b).toMatchObject({ soporte: 2, predichos: 2, aciertos: 1 });
    expect(r.porClase.b.precision).toBeCloseTo(1 / 2, 12);
    expect(r.porClase.b.cobertura).toBeCloseTo(1 / 2, 12);
    expect(r.porClase.b.f1).toBeCloseTo(1 / 2, 12);

    expect(r.porClase.c).toEqual({
      soporte: 1,
      predichos: 0,
      aciertos: 0,
      precision: 0,
      cobertura: 0,
      f1: 0,
      sinPredicciones: true,
      sinSoporte: false,
    });

    // Macro sobre a, b y c: P = (1/2 + 1/2 + 0)/3 = 1/3; C = (2/3 + 1/2 + 0)/3 = 7/18; F1 = (4/7 + 1/2 + 0)/3 = 5/14
    expect(r.macro.clases).toEqual(['a', 'b', 'c']);
    expect(r.macro.precision).toBeCloseTo(1 / 3, 12);
    expect(r.macro.cobertura).toBeCloseTo(7 / 18, 12);
    expect(r.macro.f1).toBeCloseTo(5 / 14, 12);

    expect(r.matriz).toEqual({
      a: { a: 2, b: 1, c: 0 },
      b: { a: 1, b: 1, c: 0 },
      c: { a: 1, b: 0, c: 0 },
    });
    expect(r.curva).toBeNull();
  });

  it('AC-CON-001-11 deja fuera de los macro-promedios las clases que ni se esperan ni se predicen', () => {
    // x→x, y→x. x: P = 1/2, C = 1, F1 = 2/3. y: sin predicciones, todo 0. z: no aparece.
    // Macro sobre x e y: P = 1/4, C = 1/2, F1 = 1/3.
    const r = evaluarClasificacion({
      clases: ['x', 'y', 'z'],
      casos: [
        { esperado: 'x', obtenido: 'x' },
        { esperado: 'y', obtenido: 'x' },
      ],
    });

    expect(r.porClase.x.precision).toBeCloseTo(1 / 2, 12);
    expect(r.porClase.x.cobertura).toBe(1);
    expect(r.porClase.x.f1).toBeCloseTo(2 / 3, 12);
    expect(r.porClase.y).toMatchObject({ precision: 0, cobertura: 0, f1: 0, sinPredicciones: true, sinSoporte: false });
    expect(r.porClase.z).toMatchObject({ soporte: 0, predichos: 0, sinPredicciones: true, sinSoporte: true, f1: 0 });

    expect(r.macro.clases).toEqual(['x', 'y']);
    expect(r.macro.precision).toBeCloseTo(1 / 4, 12);
    expect(r.macro.cobertura).toBeCloseTo(1 / 2, 12);
    expect(r.macro.f1).toBeCloseTo(1 / 3, 12);
  });

  it('AC-CON-001-11 cuenta en el macro una clase predicha sin soporte, con cobertura 0 por convenio', () => {
    // p→q, p→p. p: soporte 2, predichos 1, aciertos 1 → P = 1, C = 1/2, F1 = 2/3.
    // q: soporte 0, predichos 1 → P = 0, C = 0 (sin soporte), F1 = 0.
    // Macro: P = 1/2, C = 1/4, F1 = 1/3.
    const r = evaluarClasificacion({
      clases: ['p', 'q'],
      casos: [
        { esperado: 'p', obtenido: 'q' },
        { esperado: 'p', obtenido: 'p' },
      ],
    });

    expect(r.porClase.p.precision).toBe(1);
    expect(r.porClase.p.cobertura).toBeCloseTo(1 / 2, 12);
    expect(r.porClase.p.f1).toBeCloseTo(2 / 3, 12);
    expect(r.porClase.q).toMatchObject({
      soporte: 0,
      predichos: 1,
      precision: 0,
      cobertura: 0,
      sinPredicciones: false,
      sinSoporte: true,
    });
    expect(r.macro.clases).toEqual(['p', 'q']);
    expect(r.macro.precision).toBeCloseTo(1 / 2, 12);
    expect(r.macro.cobertura).toBeCloseTo(1 / 4, 12);
    expect(r.macro.f1).toBeCloseTo(1 / 3, 12);
    expect(r.matriz.p).toEqual({ p: 1, q: 1 });
  });

  it('AC-CON-001-11 calcula la curva cobertura–precisión por umbral, ordenada y sin umbrales repetidos', () => {
    // (esperado → obtenido, confianza): a→a 0,9 ✓ · a→b 0,4 ✗ · b→b 0,8 ✓ · b→a 0,95 ✗ · c→c 0,6 ✓
    // ≥ 0    → 5 casos, 3 aciertos: proporción 1, exactitud 3/5
    // ≥ 0,5  → 4 casos (0,9 0,8 0,95 0,6), 3 aciertos: proporción 4/5, exactitud 3/4
    // ≥ 0,8  → 3 casos (0,9 0,8 0,95), 2 aciertos: proporción 3/5, exactitud 2/3 (el umbral exacto cuenta)
    // ≥ 0,99 → ningún caso: proporción 0, exactitud null
    const r = evaluarClasificacion({
      clases: ['a', 'b', 'c'],
      casos: [
        { esperado: 'a', obtenido: 'a', confianza: 0.9 },
        { esperado: 'a', obtenido: 'b', confianza: 0.4 },
        { esperado: 'b', obtenido: 'b', confianza: 0.8 },
        { esperado: 'b', obtenido: 'a', confianza: 0.95 },
        { esperado: 'c', obtenido: 'c', confianza: 0.6 },
      ],
      umbrales: [0.8, 0, 0.99, 0.5, 0.5],
    });

    expect(r.exactitud).toBeCloseTo(3 / 5, 12);
    expect(r.curva).not.toBeNull();
    const curva = r.curva ?? [];
    expect(curva.map((p) => p.umbral)).toEqual([0, 0.5, 0.8, 0.99]);
    expect(curva.map((p) => [p.casos, p.aciertos])).toEqual([
      [5, 3],
      [4, 3],
      [3, 2],
      [0, 0],
    ]);
    expect(curva[0]?.proporcion).toBe(1);
    expect(curva[0]?.exactitud).toBeCloseTo(3 / 5, 12);
    expect(curva[1]?.proporcion).toBeCloseTo(4 / 5, 12);
    expect(curva[1]?.exactitud).toBeCloseTo(3 / 4, 12);
    expect(curva[2]?.proporcion).toBeCloseTo(3 / 5, 12);
    expect(curva[2]?.exactitud).toBeCloseTo(2 / 3, 12);
    expect(curva[3]).toEqual({ umbral: 0.99, casos: 0, proporcion: 0, aciertos: 0, exactitud: null });
  });

  it('AC-CON-001-11 usa los umbrales por defecto cuando no se indican', () => {
    const r = evaluarClasificacion({
      clases: VEREDICTOS,
      casos: [
        { esperado: 'keep', obtenido: 'keep', confianza: 0.97 },
        { esperado: 'invalidate', obtenido: 'keep', confianza: 0.52 },
      ],
    });
    expect(r.curva?.map((p) => p.umbral)).toEqual([...UMBRALES_CURVA_POR_DEFECTO]);
    expect(r.matriz.invalidate.keep).toBe(1);
    // Las clases que no aparecen quedan marcadas y fuera del macro.
    expect(r.porClase.other).toMatchObject({ sinSoporte: true, sinPredicciones: true });
    expect(r.macro.clases).toEqual(['keep', 'invalidate']);
  });

  it('AC-CON-001-11 rechaza entradas que no permiten medir', () => {
    const clases = ['a', 'b'] as const;
    expect(() => evaluarClasificacion({ clases, casos: [] })).toThrow(/No hay casos/);
    expect(() => evaluarClasificacion({ clases: [], casos: [] })).toThrow(/al menos una clase/);
    expect(() => evaluarClasificacion({ clases: ['a', 'a'], casos: [{ esperado: 'a', obtenido: 'a' }] })).toThrow(/repetirse/);
    expect(() => evaluarClasificacion({ clases: ['a', 'b'] as string[], casos: [{ esperado: 'a', obtenido: 'zeta' }] })).toThrow(
      /caso 1.*«zeta»/,
    );
    expect(() =>
      evaluarClasificacion({
        clases,
        casos: [
          { esperado: 'a', obtenido: 'a', confianza: 0.7 },
          { esperado: 'b', obtenido: 'b' },
        ],
      }),
    ).toThrow(/Faltan confianzas: 1 de 2/);
    expect(() => evaluarClasificacion({ clases, casos: [{ esperado: 'a', obtenido: 'a', confianza: 1.2 }] })).toThrow(
      /confianza/,
    );
    expect(() =>
      evaluarClasificacion({ clases, casos: [{ esperado: 'a', obtenido: 'a', confianza: 0.5 }], umbrales: [Number.NaN] }),
    ).toThrow(/umbral/);
  });
});

describe('cargarCasosJsonl', () => {
  const esquema = z.object({ id: z.string(), n: z.number() }).strict();

  it('AC-CON-001-11 lee un caso por línea y salta las líneas en blanco', () => {
    const casos = cargarCasosJsonl('{"id":"A","n":1}\r\n\n  \n{"id":"B","n":2}\n', esquema);
    expect(casos).toEqual([
      { id: 'A', n: 1 },
      { id: 'B', n: 2 },
    ]);
  });

  it('AC-CON-001-11 informa de todas las líneas que no cumplen el formato con su número', () => {
    const texto = ['{"id":"A","n":1}', '{"id":"B"', '{"id":"C","n":"tres"}', '{"id":"D","n":4,"extra":true}'].join('\n');
    let mensaje = '';
    try {
      cargarCasosJsonl(texto, esquema);
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    }
    expect(mensaje).toMatch(/línea 2: JSON no válido/);
    expect(mensaje).toMatch(/línea 3: n:/);
    expect(mensaje).toMatch(/línea 4:/);
    expect(mensaje).not.toMatch(/línea 1:/);
  });
});
