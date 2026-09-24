import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeWhitespace, parseDocument, renderDocument } from '../src/format.ts';
import {
  DOCUMENT_STATUSES,
  TEMPLATES,
  PREFIXES,
  LINK_TYPES,
  RECORD_TYPES,
  VERIFICATIONS,
  type RecordDocument,
} from '../src/types.ts';
import { criterion, failures, record, taxonomy, value } from './support.ts';

// Texto generado con palabras sueltas: sin marcas de Markdown que cambien la estructura.
const word = fc.constantFrom(
  'dado',
  'cuando',
  'entonces',
  'la',
  'person',
  'aprueba',
  'versión',
  'núcleo',
  'señal',
  '«otra»',
  'AC',
  '403',
  'x',
);
const phrase = fc.array(word, { minLength: 2, maxLength: 8 }).map((p) => p.join(' '));
const line = fc.tuple(fc.constantFrom('', '- ', '1. '), phrase).map(([prefix, f]) => `${prefix}${f}`);
const paragraph = fc.array(line, { minLength: 1, maxLength: 3 }).map((l) => l.join('\n'));
const content = fc.array(paragraph, { minLength: 1, maxLength: 3 }).map((p) => p.join('\n\n'));

const arbitraryRecord: fc.Arbitrary<RecordDocument> = fc
  .record({
    type: fc.constantFrom(...RECORD_TYPES),
    title: phrase,
    version: fc.integer({ min: 1, max: 9 }),
    state: fc.constantFrom(...DOCUMENT_STATUSES),
    domain: fc.constantFrom('core', 'design', 'agent_channel'),
    increment: fc.option(fc.constantFrom('D0', 'S1', 'H1'), { nil: undefined }),
    changeNote: fc.option(phrase, { nil: undefined }),
    links: fc.uniqueArray(
      fc.record({
        type: fc.constantFrom(...LINK_TYPES),
        target: fc.record({
          code: fc.constantFrom('DEC-PLN-001', 'ADR-OTR-001', 'FDR-OTR-002'),
          version: fc.integer({ min: 1, max: 12 }),
        }),
      }),
      { maxLength: 3, selector: (e) => `${e.type} ${e.target.code}` },
    ),
    annexes: fc.uniqueArray(fc.constantFrom('data/uno.yaml', 'data/dos-tres.yaml'), { maxLength: 2 }),
    contents: fc.array(content, { minLength: 4, maxLength: 4 }),
    extra: fc.option(fc.record({ title: fc.constantFrom('Spike', 'Notes'), content }), { nil: undefined }),
    criteria: fc.array(
      fc.record({
        title: phrase,
        verification: fc.constantFrom(...VERIFICATIONS),
        check: phrase,
        statement: content,
        derivedFrom: fc.option(fc.constantFrom('AC-OTR-001-01'), { nil: undefined }),
      }),
      { maxLength: 4 },
    ),
  })
  .map((g) => {
    const doc: RecordDocument = {
      kind: 'record',
      type: g.type,
      code: `${PREFIXES[g.type]}-TST-001`,
      title: g.title,
      version: g.version,
      state: g.state,
      domain: g.domain,
      links: g.links,
      annexes: g.annexes,
      sections: [
        ...TEMPLATES[g.type].sections.map((title, i) => ({ title, content: g.contents[i] ?? 'text' })),
        ...(g.extra ? [g.extra] : []),
      ],
      criteria: g.criteria.map(({ derivedFrom, ...c }, i) => ({
        code: `AC-TST-001-${String(i + 1).padStart(2, '0')}`,
        ...c,
        ...(derivedFrom ? { derivedFrom } : {}),
      })),
    };
    if (g.increment) doc.increment = g.increment;
    if (g.changeNote) doc.changeNote = g.changeNote;
    return doc;
  });

// ADR de referencia en forma canónica; los casos de error parten de su texto.
const BASE = renderDocument(record('adr', 'ADR-TST-001'));
const read = (text: string) => parseDocument(text, 'adr/ADR-TST-001.md');

describe('forma canónica de un documento', () => {
  it('AC-FMT-001-01 un documento canónico se reescribe con los mismos bytes', () => {
    const doc = record('fdr', 'FDR-TST-001', {
      increment: 'S1',
      links: [{ type: 'based_on', target: { code: 'DEC-TST-001', version: 1 } }],
      annexes: ['data/tabla.yaml'],
    });
    const text = renderDocument(doc);
    const parsed = value(parseDocument(text, 'fdr/FDR-TST-001.md'));
    expect(parsed).toEqual(doc);
    expect(renderDocument(parsed)).toBe(text);
  });

  it('AC-FMT-001-01 parsear y renderizar son inversos para cualquier registro', () => {
    fc.assert(
      fc.property(arbitraryRecord, (doc) => {
        const text = renderDocument(doc);
        const parsed = value(parseDocument(text, 'x.md'));
        expect(parsed).toEqual(doc);
        expect(renderDocument(parsed)).toBe(text);
      }),
    );
  });

  it('AC-FMT-001-01 una taxonomía canónica se reescribe con los mismos bytes', () => {
    const text = renderDocument(taxonomy('TAX-001'));
    expect(renderDocument(value(parseDocument(text, 'taxonomy/TAX-001.md')))).toBe(text);
  });

  const rejected = [
    { sample: 'finales de línea CRLF', change: (t: string) => t.replaceAll('\n', '\r\n'), error: /CRLF/ },
    {
      sample: 'espacios al final de una línea',
      change: (t: string) => t.replace('Texto de contexto.', 'Texto de contexto.  '),
      error: /espacios/,
    },
    {
      sample: 'una línea en blanco con espacios',
      change: (t: string) => t.replace('\n\n## Opciones', '\n  \n## Opciones'),
      error: /espacios/,
    },
    { sample: 'una sección vacía', change: (t: string) => t.replace('Texto de opciones.', ''), error: /«Opciones» está vacía/ },
    {
      sample: 'espacios de más en el título',
      change: (t: string) => t.replace('# ADR-TST-001 · ', '#  ADR-TST-001 · '),
      error: /título del cuerpo/,
    },
    {
      sample: 'texto entre el título y la primera sección',
      change: (t: string) => t.replace('\n\n## Contexto', '\n\nIntroducción.\n\n## Contexto'),
      error: /título del cuerpo/,
    },
    { sample: 'la falta de frontmatter', change: (t: string) => t.slice(4), error: /Falta el frontmatter/ },
    {
      sample: 'un espacio duro (U+00A0) al final de una línea',
      change: (t: string) => t.replace('Texto de contexto.', 'Texto de contexto. '),
      error: /La línea \d+ termina con espacios/,
    },
    {
      sample: 'un tabulador al final de una línea del frontmatter',
      change: (t: string) => t.replace('dominio: pruebas', 'dominio: pruebas\t'),
      error: /La línea 7 termina con espacios/,
    },
    {
      sample: 'dos líneas en blanco seguidas dentro de una sección',
      change: (t: string) => t.replace('Texto de contexto.', 'Texto de contexto.\n\n\nMás contexto.'),
      error: /La sección «Contexto» tiene más de una línea en blanco seguida/,
    },
    {
      sample: 'dos líneas en blanco seguidas dentro de un criterio',
      change: (t: string) => t.replace('Dado algo, cuando pasa,', 'Dado algo,\n\n\ncuando pasa,'),
      error: /La sección «Criterios de aceptación» tiene más de una línea en blanco seguida/,
    },
    {
      sample: 'una sección repetida',
      change: (t: string) => t.replace('## Opciones', '## Contexto\n\nOtra vez.\n\n## Opciones'),
      error: /La sección «Contexto» está repetida/,
    },
    {
      sample: 'un frontmatter que no es YAML válido',
      change: (t: string) => t.replace('titulo: Registro ADR-TST-001', 'titulo: [roto'),
      error: /^El frontmatter no es YAML válido: error de sintaxis en la línea \d+, columna \d+ \([A-Z_]+\)\.$/,
    },
  ];

  it.each(rejected)('AC-FMT-001-01 rechaza $caso', ({ change, error }) => {
    const text = change(BASE);
    expect(text).not.toBe(BASE);
    expect(failures(read(text))).toContainEqual(expect.stringMatching(error));
  });

  it('AC-FMT-001-01 canonizar arregla los espacios finales de cualquier tipo, el CRLF y las líneas en blanco de más', () => {
    const broken = BASE.replace('Texto de contexto.', 'Texto de contexto.  \t\n\n\n \nMás contexto.')
      .replace('\n\n## Opciones', '\n\n\n\n## Opciones')
      .replaceAll('\n', '\r\n');
    expect(read(broken).ok).toBe(false);
    const fixed = normalizeWhitespace(broken);
    expect(renderDocument(value(read(fixed)))).toBe(
      BASE.replace('Texto de contexto.', 'Texto de contexto.\n\nMás contexto.'),
    );
  });

  const nonCanonical = [
    {
      sample: 'una línea en blanco de más entre secciones',
      change: (t: string) => t.replace('\n\n## Opciones', '\n\n\n## Opciones'),
    },
    {
      sample: 'el frontmatter en otro orden',
      change: (t: string) => t.replace('codigo: ADR-TST-001\ntipo: adr\n', 'tipo: adr\ncodigo: ADR-TST-001\n'),
    },
    { sample: 'espacios de más en el frontmatter', change: (t: string) => t.replace('version: 1', 'version:   1') },
    {
      sample: 'comillas innecesarias en el frontmatter',
      change: (t: string) => t.replace('dominio: pruebas', "dominio: 'pruebas'"),
    },
    { sample: 'la falta del salto de línea final', change: (t: string) => t.slice(0, -1) },
    {
      sample: 'un criterio sin la línea en blanco tras su cabecera',
      change: (t: string) => t.replace('prueba\n\n- Verificación', 'prueba\n- Verificación'),
    },
  ];

  it.each(nonCanonical)('AC-FMT-001-01 detecta que no es canónico: $caso', ({ change }) => {
    const text = change(BASE);
    expect(text).not.toBe(BASE);
    const rewritten = renderDocument(value(read(text)));
    expect(rewritten).not.toBe(text);
    expect(rewritten).toBe(BASE);
  });
});

describe('códigos de un documento', () => {
  it('AC-FMT-001-02 el código de un registro corresponde a su tipo', () => {
    expect(failures(read(BASE.replace('tipo: adr', 'tipo: fdr')))).toContainEqual(
      expect.stringMatching(/ADR-TST-001 no corresponde al tipo «fdr»/),
    );
  });

  it('AC-FMT-001-02 los códigos y las referencias siguen su forma', () => {
    expect(failures(read(BASE.replace('codigo: ADR-TST-001', 'codigo: ADR-TST-1')))).toContainEqual(
      expect.stringMatching(/Frontmatter: codigo/),
    );
    const withLink = BASE.replace('enlaces: []', 'enlaces:\n  - tipo: based_on\n    destino: DEC-TST-001');
    expect(failures(read(withLink))).toContainEqual(expect.stringMatching(/Referencia CODIGO@version/));
  });

  const withLinks = (...targets: [string, string][]) =>
    BASE.replace(
      'enlaces: []',
      `enlaces:\n${targets.map(([type, d]) => `  - tipo: ${type}\n    destino: ${d}\n`).join('')}`.trimEnd(),
    );

  it.each(['DEC-TST-001@0', 'DEC-TST-001@01', 'TAX-001@1'])('AC-FMT-001-02 rechaza la referencia %s', (target) => {
    expect(failures(read(withLinks(['based_on', target])))).toContainEqual(expect.stringMatching(/Referencia CODIGO@version/));
  });

  it('AC-FMT-001-02 rechaza un enlace repetido con el mismo tipo y destino', () => {
    expect(value(read(withLinks(['based_on', 'DEC-TST-001@1'], ['origin', 'DEC-TST-001@1'])))).toMatchObject({
      links: [{ type: 'based_on' }, { type: 'origin' }],
    });
    expect(failures(read(withLinks(['based_on', 'DEC-TST-001@1'], ['based_on', 'DEC-TST-001@1'])))).toEqual([
      'Enlace repetido: based_on → DEC-TST-001.',
    ]);
    expect(failures(read(withLinks(['based_on', 'DEC-TST-001@1'], ['based_on', 'DEC-TST-001@2'])))).toEqual([
      'Enlace repetido: based_on → DEC-TST-001.',
    ]);
  });
});

describe('encabezados con código de criterio', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'AC-FMT-001-03 rechaza un encabezado de nivel %i que empieza por un código de AC fuera de los criterios',
    (level) => {
      const text = BASE.replace(
        'Texto de contexto.',
        `Texto de contexto.\n\n${'#'.repeat(level)} AC-TST-001-09 · Parece un criterio`,
      );
      expect(failures(read(text))).toContainEqual(
        `El encabezado «${'#'.repeat(level)} AC-TST-001-09 · Parece un criterio» empieza por un código de criterio fuera de «Criterios de aceptación».`,
      );
    },
  );

  it('AC-FMT-001-03 admite un encabezado que cita un código de AC sin empezar por él', () => {
    const text = BASE.replace('Texto de contexto.', 'Texto de contexto.\n\n### Nota sobre AC-TST-001-01');
    expect(value(read(text)).sections[0]?.content).toBe('Texto de contexto.\n\n### Nota sobre AC-TST-001-01');
  });
});

describe('criterios de un documento', () => {
  it('AC-FMT-001-03 lee un criterio con verificación, comprobación, derivación y enunciado', () => {
    const c = criterion('AC-TST-001-02', {
      title: 'Criterio manual',
      verification: 'manual',
      check: 'La persona lo revisa.',
      derivedFrom: 'AC-OTR-001-01',
      statement: 'Dado algo,\ncuando pasa,\nentonces se ve.\n\nY se ve dos veces.',
    });
    const doc = record('adr', 'ADR-TST-001', { criteria: [criterion('AC-TST-001-01'), c] });
    expect(value(parseDocument(renderDocument(doc), 'adr/ADR-TST-001.md'))).toEqual(doc);
  });

  const invalid = [
    {
      sample: 'una verificación que no es automática ni manual',
      change: (t: string) => t.replace('- Verificación: automática', '- Verificación: a veces'),
      error: /la verificación debe ser «automática» o «manual»/,
    },
    {
      sample: 'un criterio sin verificación',
      change: (t: string) => t.replace('- Verificación: automática\n', ''),
      error: /faltan «- Verificación:» y «- Comprobación:»/,
    },
    {
      sample: 'un criterio sin comprobación',
      change: (t: string) => t.replace('\n- Comprobación: Se comprueba con una prueba.', ''),
      error: /faltan «- Verificación:» y «- Comprobación:»/,
    },
    {
      sample: 'un criterio sin enunciado',
      change: (t: string) => t.replace('\n\nDado algo, cuando pasa, entonces se observa.', ''),
      error: /falta el enunciado observable/,
    },
    {
      sample: 'una cabecera sin un código de criterio válido',
      change: (t: string) => t.replace('### AC-TST-001-01 · ', '### AC-TST-1 · '),
      error: /Cabecera de criterio inválida/,
    },
    {
      sample: 'una derivación que no es un código de criterio',
      change: (t: string) => t.replace('una prueba.\n\nDado', 'una prueba.\n- Deriva de: nada\n\nDado'),
      error: /«Deriva de» debe ser un código de criterio/,
    },
    {
      sample: 'texto antes del primer criterio',
      change: (t: string) => t.replace('## Criterios de aceptación\n\n', '## Criterios de aceptación\n\nIntroducción.\n\n'),
      error: /antes del primer criterio/,
    },
    {
      sample: 'una sección después de los criterios',
      change: (t: string) => `${t}\n## Notas\n\nMás texto.\n`,
      error: /debe ser la última sección/,
    },
    {
      sample: 'criterios en una taxonomía',
      change: () => `${renderDocument(taxonomy('TAX-001'))}\n## Criterios de aceptación\n\n### AC-TAX-001-01 · Nada\n`,
      error: /Una taxonomía no lleva criterios/,
    },
  ];

  it.each(invalid)('AC-FMT-001-03 rechaza $caso', ({ change, error }) => {
    const text = change(BASE);
    expect(text).not.toBe(BASE);
    expect(failures(read(text))).toContainEqual(expect.stringMatching(error));
  });
});
