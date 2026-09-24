import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parsearDocumento, renderizarDocumento } from '../src/formato.ts';
import {
  ESTADOS_DOCUMENTO,
  PLANTILLAS,
  PREFIJOS,
  TIPOS_ENLACE,
  TIPOS_REGISTRO,
  VERIFICACIONES,
  type DocumentoRegistro,
} from '../src/tipos.ts';
import { criterio, fallos, registro, taxonomia, valor } from './soporte.ts';

// Texto generado con palabras sueltas: sin marcas de Markdown que cambien la estructura.
const palabra = fc.constantFrom(
  'dado',
  'cuando',
  'entonces',
  'la',
  'persona',
  'aprueba',
  'versión',
  'núcleo',
  'señal',
  '«otra»',
  'AC',
  '403',
  'x',
);
const frase = fc.array(palabra, { minLength: 2, maxLength: 8 }).map((p) => p.join(' '));
const linea = fc.tuple(fc.constantFrom('', '- ', '1. '), frase).map(([prefijo, f]) => `${prefijo}${f}`);
const parrafo = fc.array(linea, { minLength: 1, maxLength: 3 }).map((l) => l.join('\n'));
const contenido = fc.array(parrafo, { minLength: 1, maxLength: 3 }).map((p) => p.join('\n\n'));

const registroArbitrario: fc.Arbitrary<DocumentoRegistro> = fc
  .record({
    tipo: fc.constantFrom(...TIPOS_REGISTRO),
    titulo: frase,
    version: fc.integer({ min: 1, max: 9 }),
    estado: fc.constantFrom(...ESTADOS_DOCUMENTO),
    dominio: fc.constantFrom('nucleo', 'diseno', 'canal_agentes'),
    incremento: fc.option(fc.constantFrom('D0', 'S1', 'H1'), { nil: undefined }),
    notaDeCambio: fc.option(frase, { nil: undefined }),
    enlaces: fc.array(
      fc.record({
        tipo: fc.constantFrom(...TIPOS_ENLACE),
        destino: fc.record({ codigo: fc.constantFrom('DEC-PLN-001', 'TAX-001'), version: fc.integer({ min: 1, max: 5 }) }),
      }),
      { maxLength: 3 },
    ),
    anexos: fc.uniqueArray(fc.constantFrom('datos/uno.yaml', 'datos/dos-tres.yaml'), { maxLength: 2 }),
    contenidos: fc.array(contenido, { minLength: 4, maxLength: 4 }),
    extra: fc.option(fc.record({ titulo: fc.constantFrom('Spike', 'Notas'), contenido }), { nil: undefined }),
    criterios: fc.array(
      fc.record({
        titulo: frase,
        verificacion: fc.constantFrom(...VERIFICACIONES),
        comprobacion: frase,
        enunciado: contenido,
        derivaDe: fc.option(fc.constantFrom('AC-OTR-001-01'), { nil: undefined }),
      }),
      { maxLength: 4 },
    ),
  })
  .map((g) => {
    const doc: DocumentoRegistro = {
      clase: 'registro',
      tipo: g.tipo,
      codigo: `${PREFIJOS[g.tipo]}-TST-001`,
      titulo: g.titulo,
      version: g.version,
      estado: g.estado,
      dominio: g.dominio,
      enlaces: g.enlaces,
      anexos: g.anexos,
      secciones: [
        ...PLANTILLAS[g.tipo].secciones.map((titulo, i) => ({ titulo, contenido: g.contenidos[i] ?? 'texto' })),
        ...(g.extra ? [g.extra] : []),
      ],
      criterios: g.criterios.map(({ derivaDe, ...c }, i) => ({
        codigo: `AC-TST-001-${String(i + 1).padStart(2, '0')}`,
        ...c,
        ...(derivaDe ? { derivaDe } : {}),
      })),
    };
    if (g.incremento) doc.incremento = g.incremento;
    if (g.notaDeCambio) doc.notaDeCambio = g.notaDeCambio;
    return doc;
  });

// ADR de referencia en forma canónica; los casos de error parten de su texto.
const BASE = renderizarDocumento(registro('adr', 'ADR-TST-001'));
const leer = (texto: string) => parsearDocumento(texto, 'adr/ADR-TST-001.md');

describe('forma canónica de un documento', () => {
  it('AC-FMT-001-01 un documento canónico se reescribe con los mismos bytes', () => {
    const doc = registro('fdr', 'FDR-TST-001', {
      incremento: 'S1',
      enlaces: [{ tipo: 'based_on', destino: { codigo: 'DEC-TST-001', version: 1 } }],
      anexos: ['datos/tabla.yaml'],
    });
    const texto = renderizarDocumento(doc);
    const leido = valor(parsearDocumento(texto, 'fdr/FDR-TST-001.md'));
    expect(leido).toEqual(doc);
    expect(renderizarDocumento(leido)).toBe(texto);
  });

  it('AC-FMT-001-01 parsear y renderizar son inversos para cualquier registro', () => {
    fc.assert(
      fc.property(registroArbitrario, (doc) => {
        const texto = renderizarDocumento(doc);
        const leido = valor(parsearDocumento(texto, 'x.md'));
        expect(leido).toEqual(doc);
        expect(renderizarDocumento(leido)).toBe(texto);
      }),
    );
  });

  it('AC-FMT-001-01 una taxonomía canónica se reescribe con los mismos bytes', () => {
    const texto = renderizarDocumento(taxonomia('TAX-001'));
    expect(renderizarDocumento(valor(parsearDocumento(texto, 'taxonomia/TAX-001.md')))).toBe(texto);
  });

  const rechazados = [
    { caso: 'finales de línea CRLF', cambiar: (t: string) => t.replaceAll('\n', '\r\n'), error: /CRLF/ },
    {
      caso: 'espacios al final de una línea',
      cambiar: (t: string) => t.replace('Texto de contexto.', 'Texto de contexto.  '),
      error: /espacios/,
    },
    {
      caso: 'una línea en blanco con espacios',
      cambiar: (t: string) => t.replace('\n\n## Opciones', '\n  \n## Opciones'),
      error: /espacios/,
    },
    { caso: 'una sección vacía', cambiar: (t: string) => t.replace('Texto de opciones.', ''), error: /«Opciones» está vacía/ },
    {
      caso: 'espacios de más en el título',
      cambiar: (t: string) => t.replace('# ADR-TST-001 · ', '#  ADR-TST-001 · '),
      error: /título del cuerpo/,
    },
    {
      caso: 'texto entre el título y la primera sección',
      cambiar: (t: string) => t.replace('\n\n## Contexto', '\n\nIntroducción.\n\n## Contexto'),
      error: /título del cuerpo/,
    },
    { caso: 'la falta de frontmatter', cambiar: (t: string) => t.slice(4), error: /Falta el frontmatter/ },
  ];

  it.each(rechazados)('AC-FMT-001-01 rechaza $caso', ({ cambiar, error }) => {
    const texto = cambiar(BASE);
    expect(texto).not.toBe(BASE);
    expect(fallos(leer(texto))).toContainEqual(expect.stringMatching(error));
  });

  const noCanonicos = [
    {
      caso: 'una línea en blanco de más entre secciones',
      cambiar: (t: string) => t.replace('\n\n## Opciones', '\n\n\n## Opciones'),
    },
    {
      caso: 'el frontmatter en otro orden',
      cambiar: (t: string) => t.replace('codigo: ADR-TST-001\ntipo: adr\n', 'tipo: adr\ncodigo: ADR-TST-001\n'),
    },
    { caso: 'espacios de más en el frontmatter', cambiar: (t: string) => t.replace('version: 1', 'version:   1') },
    {
      caso: 'comillas innecesarias en el frontmatter',
      cambiar: (t: string) => t.replace('dominio: pruebas', "dominio: 'pruebas'"),
    },
    { caso: 'la falta del salto de línea final', cambiar: (t: string) => t.slice(0, -1) },
    {
      caso: 'un criterio sin la línea en blanco tras su cabecera',
      cambiar: (t: string) => t.replace('prueba\n\n- Verificación', 'prueba\n- Verificación'),
    },
  ];

  it.each(noCanonicos)('AC-FMT-001-01 detecta que no es canónico: $caso', ({ cambiar }) => {
    const texto = cambiar(BASE);
    expect(texto).not.toBe(BASE);
    const reescrito = renderizarDocumento(valor(leer(texto)));
    expect(reescrito).not.toBe(texto);
    expect(reescrito).toBe(BASE);
  });
});

describe('códigos de un documento', () => {
  it('AC-FMT-001-02 el código de un registro corresponde a su tipo', () => {
    expect(fallos(leer(BASE.replace('tipo: adr', 'tipo: fdr')))).toContainEqual(
      expect.stringMatching(/ADR-TST-001 no corresponde al tipo «fdr»/),
    );
  });

  it('AC-FMT-001-02 los códigos y las referencias siguen su forma', () => {
    expect(fallos(leer(BASE.replace('codigo: ADR-TST-001', 'codigo: ADR-TST-1')))).toContainEqual(
      expect.stringMatching(/Frontmatter: codigo/),
    );
    const conEnlace = BASE.replace('enlaces: []', 'enlaces:\n  - tipo: based_on\n    destino: DEC-TST-001');
    expect(fallos(leer(conEnlace))).toContainEqual(expect.stringMatching(/Referencia CODIGO@version/));
  });
});

describe('criterios de un documento', () => {
  it('AC-FMT-001-03 lee un criterio con verificación, comprobación, derivación y enunciado', () => {
    const c = criterio('AC-TST-001-02', {
      titulo: 'Criterio manual',
      verificacion: 'manual',
      comprobacion: 'La persona lo revisa.',
      derivaDe: 'AC-OTR-001-01',
      enunciado: 'Dado algo,\ncuando pasa,\nentonces se ve.\n\nY se ve dos veces.',
    });
    const doc = registro('adr', 'ADR-TST-001', { criterios: [criterio('AC-TST-001-01'), c] });
    expect(valor(parsearDocumento(renderizarDocumento(doc), 'adr/ADR-TST-001.md'))).toEqual(doc);
  });

  const invalidos = [
    {
      caso: 'una verificación que no es automática ni manual',
      cambiar: (t: string) => t.replace('- Verificación: automática', '- Verificación: a veces'),
      error: /la verificación debe ser «automática» o «manual»/,
    },
    {
      caso: 'un criterio sin verificación',
      cambiar: (t: string) => t.replace('- Verificación: automática\n', ''),
      error: /faltan «- Verificación:» y «- Comprobación:»/,
    },
    {
      caso: 'un criterio sin comprobación',
      cambiar: (t: string) => t.replace('\n- Comprobación: Se comprueba con una prueba.', ''),
      error: /faltan «- Verificación:» y «- Comprobación:»/,
    },
    {
      caso: 'un criterio sin enunciado',
      cambiar: (t: string) => t.replace('\n\nDado algo, cuando pasa, entonces se observa.', ''),
      error: /falta el enunciado observable/,
    },
    {
      caso: 'una cabecera sin un código de criterio válido',
      cambiar: (t: string) => t.replace('### AC-TST-001-01 · ', '### AC-TST-1 · '),
      error: /Cabecera de criterio inválida/,
    },
    {
      caso: 'una derivación que no es un código de criterio',
      cambiar: (t: string) => t.replace('una prueba.\n\nDado', 'una prueba.\n- Deriva de: nada\n\nDado'),
      error: /«Deriva de» debe ser un código de criterio/,
    },
    {
      caso: 'texto antes del primer criterio',
      cambiar: (t: string) => t.replace('## Criterios de aceptación\n\n', '## Criterios de aceptación\n\nIntroducción.\n\n'),
      error: /antes del primer criterio/,
    },
    {
      caso: 'una sección después de los criterios',
      cambiar: (t: string) => `${t}\n## Notas\n\nMás texto.\n`,
      error: /debe ser la última sección/,
    },
    {
      caso: 'criterios en una taxonomía',
      cambiar: () => `${renderizarDocumento(taxonomia('TAX-001'))}\n## Criterios de aceptación\n\n### AC-TAX-001-01 · Nada\n`,
      error: /Una taxonomía no lleva criterios/,
    },
  ];

  it.each(invalidos)('AC-FMT-001-03 rechaza $caso', ({ cambiar, error }) => {
    const texto = cambiar(BASE);
    expect(texto).not.toBe(BASE);
    expect(fallos(leer(texto))).toContainEqual(expect.stringMatching(error));
  });
});
