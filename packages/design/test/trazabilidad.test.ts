import { describe, expect, it } from 'vitest';
import {
  type CasoJUnit,
  casosDeJUnit,
  codigosCitados,
  decodificarEntidades,
  informeCompleto,
  mapaTrazabilidad,
  tituloPropio,
} from '../src/trazabilidad.ts';
import { criterio, registro } from './soporte.ts';

// Informe JUnit de ejemplo con la forma que escribe Vitest: el nombre de cada `testcase` lleva
// delante los `describe` separados por « > ».
const escapar = (t: string) =>
  t.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

type Ejemplo = { nombre: string; archivo?: string; cuerpo?: string };

function junit(casos: readonly Ejemplo[]): string {
  const lineas = casos.map(
    ({ nombre, archivo = 'packages/x/test/a.test.ts', cuerpo = '' }) =>
      `        <testcase classname="${escapar(archivo)}" name="${escapar(nombre)}" time="0.01">\n${cuerpo}        </testcase>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    `<testsuites name="vitest tests" tests="${casos.length}" failures="0" errors="0" time="0.1">`,
    '    <testsuite name="packages/x/test/a.test.ts" tests="1" failures="0" errors="0" skipped="0" time="0.1">',
    ...lineas,
    '    </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

const FALLO = '            <failure message="expected 1 to be 2" type="AssertionError">\n            </failure>\n';
const ERROR = '            <error message="se rompió" type="Error"/>\n';
const SALTADA = '            <skipped/>\n';

const ADR = registro('adr', 'ADR-TST-001', {
  incremento: 'D0',
  criterios: [criterio('AC-TST-001-01'), criterio('AC-TST-001-02'), criterio('AC-TST-001-03', { verificacion: 'manual' })],
});

const mapaDe = (casos: readonly Ejemplo[], incrementos: readonly string[] = ['D0']) =>
  mapaTrazabilidad([ADR], casosDeJUnit(junit(casos)), incrementos);

describe('lectura de informes JUnit', () => {
  it('AC-FMT-001-05 lee cada testcase con su archivo, su nombre completo y si pasó, falló o se saltó', () => {
    const xml = junit([
      { nombre: 'bloque > AC-TST-001-01 pasa' },
      { nombre: 'bloque > AC-TST-001-01 falla', cuerpo: FALLO },
      { nombre: 'bloque > AC-TST-001-01 da error', cuerpo: ERROR },
      { nombre: 'bloque > AC-TST-001-01 saltada', cuerpo: SALTADA },
      { nombre: 'AC-TST-001-02 con <, >, & y "comillas" \'simples\'', archivo: 'packages/y/test/b.test.ts' },
    ]);
    const casos: CasoJUnit[] = casosDeJUnit(`${xml}<testcase classname="c.test.ts" name="autocerrado"/>\n`);
    expect(casos).toEqual([
      { archivo: 'packages/x/test/a.test.ts', nombre: 'bloque > AC-TST-001-01 pasa', resultado: 'pasada' },
      { archivo: 'packages/x/test/a.test.ts', nombre: 'bloque > AC-TST-001-01 falla', resultado: 'fallida' },
      { archivo: 'packages/x/test/a.test.ts', nombre: 'bloque > AC-TST-001-01 da error', resultado: 'fallida' },
      { archivo: 'packages/x/test/a.test.ts', nombre: 'bloque > AC-TST-001-01 saltada', resultado: 'saltada' },
      { archivo: 'packages/y/test/b.test.ts', nombre: 'AC-TST-001-02 con <, >, & y "comillas" \'simples\'', resultado: 'pasada' },
      { archivo: 'c.test.ts', nombre: 'autocerrado', resultado: 'pasada' },
    ]);
  });

  it('AC-FMT-001-05 un informe vacío o cortado no está completo', () => {
    const xml = junit([{ nombre: 'AC-TST-001-01 pasa' }]);
    expect(informeCompleto(xml)).toBe(true);
    expect(informeCompleto('')).toBe(false);
    expect(informeCompleto(xml.slice(0, xml.indexOf('</testsuites>')))).toBe(false);
  });

  it('AC-FMT-001-05 decodifica las entidades de XML una sola vez', () => {
    expect(decodificarEntidades('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#241; &#xE9;')).toBe(`a & b <c> "d" 'e' ñ é`);
    expect(decodificarEntidades('&amp;lt;')).toBe('&lt;');
  });

  it('AC-FMT-001-05 el título propio es el último segmento del nombre y cita los códigos con los que empieza', () => {
    expect(tituloPropio('uno > dos > AC-TST-001-01 tres')).toBe('AC-TST-001-01 tres');
    expect(tituloPropio('sin bloques')).toBe('sin bloques');
    expect(codigosCitados('bloque > AC-TST-001-01 AC-TST-001-02 texto')).toEqual(['AC-TST-001-01', 'AC-TST-001-02']);
    expect(codigosCitados('AC-TST-001-01')).toEqual(['AC-TST-001-01']);
    expect(codigosCitados('bloque > texto con AC-TST-001-01 en medio')).toEqual([]);
    expect(codigosCitados('AC-TST-001-01 > texto sin código')).toEqual([]);
    expect(codigosCitados('AC-TST-001-01x pegado')).toEqual([]);
    expect(codigosCitados('AC-TST-001-01 y AC-TST-001-02')).toEqual(['AC-TST-001-01']);
  });
});

describe('trazabilidad AC → prueba', () => {
  it('AC-FMT-001-05 un criterio automático de un incremento implementado necesita una prueba pasada', () => {
    const sinPruebas = mapaTrazabilidad([ADR], [], ['D0']);
    expect(sinPruebas.sinPrueba).toEqual([
      { registro: 'ADR-TST-001', ac: 'AC-TST-001-01' },
      { registro: 'ADR-TST-001', ac: 'AC-TST-001-02' },
    ]);

    const mapa = mapaDe([{ nombre: 'bloque > AC-TST-001-01 AC-TST-001-02 cumple los dos' }]);
    expect(mapa.sinPrueba).toEqual([]);
    expect(mapa.desconocidos).toEqual([]);
    expect(mapa.pruebasPorAc.get('AC-TST-001-01')).toEqual(
      new Set(['packages/x/test/a.test.ts > bloque > AC-TST-001-01 AC-TST-001-02 cumple los dos']),
    );
  });

  it('AC-FMT-001-05 una prueba fallida, con error o saltada no cuenta', () => {
    const mapa = mapaDe([
      { nombre: 'AC-TST-001-01 falla', cuerpo: FALLO },
      { nombre: 'AC-TST-001-01 da error', cuerpo: ERROR },
      { nombre: 'AC-TST-001-02 saltada', cuerpo: SALTADA },
    ]);
    expect(mapa.pruebasPorAc.size).toBe(0);
    expect(mapa.sinPrueba.map((s) => s.ac)).toEqual(['AC-TST-001-01', 'AC-TST-001-02']);
  });

  it('AC-FMT-001-05 solo cuenta el código al principio del título propio, no en medio ni en un describe', () => {
    const mapa = mapaDe([
      { nombre: 'bloque > cumple AC-TST-001-01 en medio' },
      { nombre: 'AC-TST-001-02 describe > prueba sin código' },
      { nombre: 'bloque > AC-TST-001-02 al principio' },
    ]);
    expect([...mapa.pruebasPorAc.keys()]).toEqual(['AC-TST-001-02']);
    expect(mapa.sinPrueba).toEqual([{ registro: 'ADR-TST-001', ac: 'AC-TST-001-01' }]);
  });

  it('AC-FMT-001-05 una prueba pasada que cita un código inexistente se señala; si falló o está en medio, no', () => {
    const mapa = mapaDe([
      { nombre: 'AC-TST-001-01 AC-TST-001-02 cumple' },
      { nombre: 'bloque > AC-ZZZ-999-99 no existe', archivo: 'b.test.ts' },
      { nombre: 'AC-ZZZ-999-98 no existe y falla', cuerpo: FALLO },
      { nombre: 'cita AC-ZZZ-999-97 en medio' },
    ]);
    expect(mapa.desconocidos).toEqual([
      { archivo: 'b.test.ts', prueba: 'bloque > AC-ZZZ-999-99 no existe', ac: 'AC-ZZZ-999-99' },
    ]);
    expect(mapa.sinPrueba).toEqual([]);
  });

  it('AC-FMT-001-05 solo exige prueba a los criterios automáticos vigentes de incrementos implementados', () => {
    const registros = [
      ADR,
      registro('fdr', 'FDR-OTR-001', { incremento: 'S1' }),
      registro('adr', 'ADR-TST-002', { incremento: 'D0', estado: 'descartado' }),
      registro('adr', 'ADR-TST-003', { incremento: 'D0', estado: 'sustituido' }),
      registro('decision', 'DEC-TST-001', { criterios: [criterio('AC-TST-001-09')] }),
    ];
    const casos = casosDeJUnit(junit([{ nombre: 'AC-TST-001-01 AC-TST-001-02 cumple' }]));
    expect(mapaTrazabilidad(registros, casos, ['D0']).sinPrueba).toEqual([]);
    expect(mapaTrazabilidad(registros, casos, ['D0', 'S1']).sinPrueba).toEqual([
      { registro: 'FDR-OTR-001', ac: 'AC-OTR-001-01' },
    ]);
  });
});
