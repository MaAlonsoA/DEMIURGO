import { describe, expect, it } from 'vitest';
import {
  type JUnitCase,
  casesFromJUnit,
  citedCodes,
  decodeEntities,
  completeReport,
  traceabilityMap,
  ownTitle,
} from '../src/traceability.ts';
import { criterion, record } from './support.ts';

// Informe JUnit de ejemplo con la forma que escribe Vitest: el nombre de cada `testcase` lleva
// delante los `describe` separados por « > ».
const escape = (t: string) =>
  t.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

type Example = { name: string; file?: string; body?: string };

function junit(cases: readonly Example[]): string {
  const lines = cases.map(
    ({ name, file = 'packages/x/test/a.test.ts', body = '' }) =>
      `        <testcase classname="${escape(file)}" name="${escape(name)}" time="0.01">\n${body}        </testcase>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    `<testsuites name="vitest tests" tests="${cases.length}" failures="0" errors="0" time="0.1">`,
    '    <testsuite name="packages/x/test/a.test.ts" tests="1" failures="0" errors="0" skipped="0" time="0.1">',
    ...lines,
    '    </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

const FAILURE = '            <failure message="expected 1 to be 2" type="AssertionError">\n            </failure>\n';
const ERROR = '            <error message="se rompió" type="Error"/>\n';
const SKIPPED = '            <skipped/>\n';

const ADR = record('adr', 'ADR-TST-001', {
  increment: 'D0',
  criteria: [criterion('AC-TST-001-01'), criterion('AC-TST-001-02'), criterion('AC-TST-001-03', { verification: 'manual' })],
});

const mapOf = (cases: readonly Example[], increments: readonly string[] = ['D0']) =>
  traceabilityMap([ADR], casesFromJUnit(junit(cases)), increments);

describe('lectura de informes JUnit', () => {
  it('AC-FMT-001-05 lee cada testcase con su archivo, su nombre completo y si pasó, falló o se saltó', () => {
    const xml = junit([
      { name: 'bloque > AC-TST-001-01 pasa' },
      { name: 'bloque > AC-TST-001-01 falla', body: FAILURE },
      { name: 'bloque > AC-TST-001-01 da error', body: ERROR },
      { name: 'bloque > AC-TST-001-01 saltada', body: SKIPPED },
      { name: 'AC-TST-001-02 con <, >, & y "comillas" \'simples\'', file: 'packages/y/test/b.test.ts' },
    ]);
    const cases: JUnitCase[] = casesFromJUnit(`${xml}<testcase classname="c.test.ts" name="autocerrado"/>\n`);
    expect(cases).toEqual([
      { file: 'packages/x/test/a.test.ts', name: 'bloque > AC-TST-001-01 pasa', result: 'passed' },
      { file: 'packages/x/test/a.test.ts', name: 'bloque > AC-TST-001-01 falla', result: 'failed' },
      { file: 'packages/x/test/a.test.ts', name: 'bloque > AC-TST-001-01 da error', result: 'failed' },
      { file: 'packages/x/test/a.test.ts', name: 'bloque > AC-TST-001-01 saltada', result: 'skipped' },
      { file: 'packages/y/test/b.test.ts', name: 'AC-TST-001-02 con <, >, & y "comillas" \'simples\'', result: 'passed' },
      { file: 'c.test.ts', name: 'selfClosed', result: 'passed' },
    ]);
  });

  it('AC-FMT-001-05 un informe vacío o cortado no está completo', () => {
    const xml = junit([{ name: 'AC-TST-001-01 pasa' }]);
    expect(completeReport(xml)).toBe(true);
    expect(completeReport('')).toBe(false);
    expect(completeReport(xml.slice(0, xml.indexOf('</testsuites>')))).toBe(false);
  });

  it('AC-FMT-001-05 decodifica las entidades de XML una sola vez', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#241; &#xE9;')).toBe(`a & b <c> "d" 'e' ñ é`);
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });

  it('AC-FMT-001-05 el título propio es el último segmento del nombre y cita los códigos con los que empieza', () => {
    expect(ownTitle('uno > dos > AC-TST-001-01 tres')).toBe('AC-TST-001-01 tres');
    expect(ownTitle('sin bloques')).toBe('sin bloques');
    expect(citedCodes('bloque > AC-TST-001-01 AC-TST-001-02 texto')).toEqual(['AC-TST-001-01', 'AC-TST-001-02']);
    expect(citedCodes('AC-TST-001-01')).toEqual(['AC-TST-001-01']);
    expect(citedCodes('bloque > texto con AC-TST-001-01 en medio')).toEqual([]);
    expect(citedCodes('AC-TST-001-01 > texto sin código')).toEqual([]);
    expect(citedCodes('AC-TST-001-01x pegado')).toEqual([]);
    expect(citedCodes('AC-TST-001-01 y AC-TST-001-02')).toEqual(['AC-TST-001-01']);
  });
});

describe('trazabilidad AC → prueba', () => {
  it('AC-FMT-001-05 un criterio automático de un incremento implementado necesita una prueba pasada', () => {
    const withoutTests = traceabilityMap([ADR], [], ['D0']);
    expect(withoutTests.withoutTest).toEqual([
      { record: 'ADR-TST-001', ac: 'AC-TST-001-01' },
      { record: 'ADR-TST-001', ac: 'AC-TST-001-02' },
    ]);

    const map = mapOf([{ name: 'bloque > AC-TST-001-01 AC-TST-001-02 cumple los dos' }]);
    expect(map.withoutTest).toEqual([]);
    expect(map.unknown).toEqual([]);
    expect(map.testsByAc.get('AC-TST-001-01')).toEqual(
      new Set(['packages/x/test/a.test.ts > bloque > AC-TST-001-01 AC-TST-001-02 cumple los dos']),
    );
  });

  it('AC-FMT-001-05 una prueba fallida, con error o saltada no cuenta', () => {
    const map = mapOf([
      { name: 'AC-TST-001-01 falla', body: FAILURE },
      { name: 'AC-TST-001-01 da error', body: ERROR },
      { name: 'AC-TST-001-02 saltada', body: SKIPPED },
    ]);
    expect(map.testsByAc.size).toBe(0);
    expect(map.withoutTest.map((s) => s.ac)).toEqual(['AC-TST-001-01', 'AC-TST-001-02']);
  });

  it('AC-FMT-001-05 solo cuenta el código al principio del título propio, no en medio ni en un describe', () => {
    const map = mapOf([
      { name: 'bloque > cumple AC-TST-001-01 en medio' },
      { name: 'AC-TST-001-02 describe > prueba sin código' },
      { name: 'bloque > AC-TST-001-02 al principio' },
    ]);
    expect([...map.testsByAc.keys()]).toEqual(['AC-TST-001-02']);
    expect(map.withoutTest).toEqual([{ record: 'ADR-TST-001', ac: 'AC-TST-001-01' }]);
  });

  it('AC-FMT-001-05 una prueba pasada que cita un código inexistente se señala; si falló o está en medio, no', () => {
    const map = mapOf([
      { name: 'AC-TST-001-01 AC-TST-001-02 cumple' },
      { name: 'bloque > AC-ZZZ-999-99 no existe', file: 'b.test.ts' },
      { name: 'AC-ZZZ-999-98 no existe y falla', body: FAILURE },
      { name: 'cita AC-ZZZ-999-97 en medio' },
    ]);
    expect(map.unknown).toEqual([
      { file: 'b.test.ts', test: 'bloque > AC-ZZZ-999-99 no existe', ac: 'AC-ZZZ-999-99' },
    ]);
    expect(map.withoutTest).toEqual([]);
  });

  it('AC-FMT-001-05 solo exige prueba a los criterios automáticos de incrementos implementados', () => {
    const records = [
      ADR,
      record('fdr', 'FDR-OTR-001', { increment: 'S1' }),
      record('decision', 'DEC-TST-001', { criteria: [criterion('AC-TST-001-09')] }),
    ];
    const cases = casesFromJUnit(junit([{ name: 'AC-TST-001-01 AC-TST-001-02 cumple' }]));
    expect(traceabilityMap(records, cases, ['D0']).withoutTest).toEqual([]);
    expect(traceabilityMap(records, cases, ['D0', 'S1']).withoutTest).toEqual([
      { record: 'FDR-OTR-001', ac: 'AC-OTR-001-01' },
    ]);
  });
});
