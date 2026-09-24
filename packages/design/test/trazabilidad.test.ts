import { describe, expect, it } from 'vitest';
import { codigosEnNombresDePrueba, mapaTrazabilidad } from '../src/trazabilidad.ts';
import { criterio, registro } from './soporte.ts';

// Las fuentes simuladas se montan con el nombre de la función de prueba en una variable.
// Así el mapa de trazabilidad del propio repositorio no toma estos nombres por pruebas reales.
const IT = 'it';
const TEST = 'test';
const DESCRIBE = 'describe';
const prueba = (funcion: string, nombre: string, comilla = "'") => `${funcion}(${comilla}${nombre}${comilla}, () => {});`;

const ADR = registro('adr', 'ADR-TST-001', {
  incremento: 'D0',
  criterios: [criterio('AC-TST-001-01'), criterio('AC-TST-001-02', { verificacion: 'manual' })],
});

describe('trazabilidad AC → prueba', () => {
  it('AC-FMT-001-05 extrae los códigos del nombre de las pruebas', () => {
    const fuente = [
      prueba(IT, 'AC-TST-001-01 cumple'),
      prueba(TEST, 'AC-TST-001-02 y AC-TST-001-03 a la vez', '"'),
      prueba(DESCRIBE, 'AC-TST-001-04 bloque', '`'),
      `${IT}.each(casos)('AC-TST-001-05 caso %s', () => {});`,
      `${IT}.only(\n  'AC-TST-001-06 solo',\n  () => {},\n);`,
    ].join('\n');
    expect(codigosEnNombresDePrueba(fuente)).toEqual([
      'AC-TST-001-01',
      'AC-TST-001-02',
      'AC-TST-001-03',
      'AC-TST-001-04',
      'AC-TST-001-05',
      'AC-TST-001-06',
    ]);
  });

  it('AC-FMT-001-05 no cuenta códigos fuera del nombre de una prueba ni pruebas saltadas', () => {
    const fuente = [
      '// AC-TST-001-01 en un comentario',
      "const codigo = 'AC-TST-001-02';",
      `${IT}.skip('AC-TST-001-03 saltada', () => {});`,
      `${IT}.todo('AC-TST-001-04 pendiente');`,
      prueba(IT, 'sin código', '"'),
    ].join('\n');
    expect(codigosEnNombresDePrueba(fuente)).toEqual([]);
  });

  it('AC-FMT-001-05 un criterio automático de un incremento implementado necesita una prueba', () => {
    const sinPruebas = mapaTrazabilidad([ADR], new Map(), ['D0']);
    expect(sinPruebas.sinPrueba).toEqual([{ registro: 'ADR-TST-001', ac: 'AC-TST-001-01' }]);
    expect(sinPruebas.desconocidos).toEqual([]);

    const archivos = new Map([['packages/x/test/a.test.ts', prueba(IT, 'AC-TST-001-01 cumple')]]);
    const conPrueba = mapaTrazabilidad([ADR], archivos, ['D0']);
    expect(conPrueba.sinPrueba).toEqual([]);
    expect(conPrueba.pruebasPorAc.get('AC-TST-001-01')).toEqual(new Set(['packages/x/test/a.test.ts']));
  });

  it('AC-FMT-001-05 solo exige prueba a los criterios automáticos vigentes de incrementos implementados', () => {
    const registros = [
      ADR,
      registro('fdr', 'FDR-OTR-001', { incremento: 'S1' }),
      registro('adr', 'ADR-TST-002', { incremento: 'D0', estado: 'descartado' }),
      registro('adr', 'ADR-TST-003', { incremento: 'D0', estado: 'sustituido' }),
      registro('decision', 'DEC-TST-001', { criterios: [criterio('AC-TST-001-09')] }),
    ];
    const archivos = new Map([['a.test.ts', prueba(IT, 'AC-TST-001-01 cumple')]]);
    expect(mapaTrazabilidad(registros, archivos, ['D0']).sinPrueba).toEqual([]);
    expect(mapaTrazabilidad(registros, archivos, ['D0', 'S1']).sinPrueba).toEqual([
      { registro: 'FDR-OTR-001', ac: 'AC-OTR-001-01' },
    ]);
  });

  it('AC-FMT-001-05 una prueba que cita un código inexistente se señala', () => {
    const archivos = new Map([
      ['a.test.ts', prueba(IT, 'AC-TST-001-01 cumple')],
      ['b.test.ts', prueba(IT, 'AC-ZZZ-999-99 no existe')],
    ]);
    const mapa = mapaTrazabilidad([ADR], archivos, ['D0']);
    expect(mapa.desconocidos).toEqual([{ archivo: 'b.test.ts', ac: 'AC-ZZZ-999-99' }]);
    expect(mapa.sinPrueba).toEqual([]);
  });
});
