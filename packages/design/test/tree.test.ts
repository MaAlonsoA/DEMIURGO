import { describe, expect, it } from 'vitest';
import { validateTree } from '../src/tree.ts';
import { renderDocument } from '../src/format.ts';
import type { RecordType } from '../src/types.ts';
import { treeWith, criterion, messagesOf, record, pathOf, taxonomy } from './support.ts';

const DECISION = record('decision', 'DEC-BAS-001');
const ADR = record('adr', 'ADR-TST-001', { links: [{ type: 'based_on', target: { code: 'DEC-BAS-001', version: 1 } }] });
const TABLE = 'codigo: DAT-TST-001\nfilas: []\n';

const problems = (tree: ReadonlyMap<string, string>) => messagesOf(validateTree(tree));

/** ADR que enlaza con la versión dada de DEC-BAS-001. */
const linkTo = (version: number) =>
  record('adr', 'ADR-TST-001', { links: [{ type: 'design_of', target: { code: 'DEC-BAS-001', version } }] });

/** ADR con un criterio que deriva del código dado. */
const derivedFrom = (code: string) =>
  record('adr', 'ADR-TST-001', { criteria: [criterion('AC-TST-001-01', { derivedFrom: code })] });

describe('forma canónica del árbol', () => {
  it('AC-FMT-001-01 un árbol canónico y coherente no tiene problemas', () => {
    const report = validateTree(treeWith([DECISION, ADR, taxonomy('TAX-001')]));
    expect(messagesOf(report)).toEqual([]);
    expect(report.records.map((r) => r.code)).toEqual(['ADR-TST-001', 'DEC-BAS-001']);
    expect(report.taxonomies.map((t) => t.code)).toEqual(['TAX-001']);
  });

  it('AC-FMT-001-01 rechaza un documento que no está en forma canónica', () => {
    const tree = treeWith([DECISION]);
    const path = pathOf(DECISION);
    tree.set(path, (tree.get(path) ?? '').replace('\n\n## Decisión', '\n\n\n## Decisión'));
    expect(problems(tree)).toEqual([expect.stringMatching(/No está en formato canónico/)]);
  });

  it('AC-FMT-001-01 rechaza un documento con CRLF o espacios al final de línea', () => {
    const path = pathOf(DECISION);
    const withCrlf = treeWith([DECISION]);
    withCrlf.set(path, (withCrlf.get(path) ?? '').replaceAll('\n', '\r\n'));
    expect(problems(withCrlf)).toEqual([expect.stringMatching(/CRLF/)]);
    const withSpaces = treeWith([DECISION]);
    withSpaces.set(path, (withSpaces.get(path) ?? '').replace('Texto de contexto.', 'Texto de contexto. '));
    expect(problems(withSpaces)).toEqual([expect.stringMatching(/termina con espacios/)]);
  });

  it('AC-FMT-001-01 rechaza un README distinto del texto fijo', () => {
    const tree = treeWith([DECISION]);
    tree.set('README.md', `${tree.get('README.md') ?? ''}\nNota añadida a mano.\n`);
    expect(problems(tree)).toEqual([expect.stringMatching(/README\.md no coincide con el texto fijo/)]);
    tree.delete('README.md');
    expect(problems(tree)).toEqual(['Falta README.md.']);
  });

  it('rechaza archivos fuera de la estructura y documentos en otra carpeta', () => {
    const tree = treeWith([DECISION], {
      'notas.md': 'Notas sueltas.\n',
      'otros/DEC-TST-002.md': renderDocument(record('decision', 'DEC-TST-002')),
      'adr/DEC-TST-003.md': renderDocument(record('decision', 'DEC-TST-003')),
      'data/tabla.txt': 'texto\n',
    });
    const messages = problems(tree);
    expect(messages.filter((m) => m === 'Archivo fuera de la estructura de design/.')).toHaveLength(2);
    expect(messages).toContain('Un documento de tipo «decision» no va en adr/.');
    expect(messages).toContain('En datos/ solo hay archivos .yaml.');
  });
});

describe('códigos, enlaces y anexos', () => {
  it('AC-FMT-001-02 rechaza códigos de registro duplicados', () => {
    const tree = treeWith([DECISION, ADR], { 'adr/ADR-TST-002.md': renderDocument(ADR) });
    const messages = problems(tree);
    expect(messages).toContain('Código de registro duplicado: ADR-TST-001.');
    expect(messages).toContain('El archivo debe llamarse ADR-TST-001.md.');
  });

  it('AC-FMT-001-02 rechaza códigos de taxonomía duplicados', () => {
    const tree = treeWith([taxonomy('TAX-001')], { 'taxonomy/TAX-002.md': renderDocument(taxonomy('TAX-001')) });
    expect(problems(tree)).toContain('Código de taxonomía duplicado: TAX-001.');
  });

  it('AC-FMT-001-02 rechaza códigos de criterio duplicados', () => {
    const adr = record('adr', 'ADR-TST-001', { criteria: [criterion('AC-TST-001-01'), criterion('AC-TST-001-01')] });
    expect(problems(treeWith([adr]))).toEqual([expect.stringMatching(/Código de criterio duplicado: AC-TST-001-01/)]);
  });

  it('AC-FMT-001-02 un enlace apunta a un registro existente', () => {
    const adr = record('adr', 'ADR-TST-001', {
      links: [{ type: 'based_on', target: { code: 'DEC-NOE-001', version: 1 } }],
    });
    expect(problems(treeWith([DECISION, adr]))).toEqual(['El enlace based_on apunta a DEC-NOE-001, que no existe.']);
  });

  it('AC-FMT-001-02 un enlace apunta a la versión de su destino en design/ o a una anterior, nunca a una posterior', () => {
    expect(problems(treeWith([DECISION, linkTo(2)]))).toEqual([
      'El enlace design_of apunta a DEC-BAS-001@2, posterior a la versión 1 de design/.',
    ]);
    const second = record('decision', 'DEC-BAS-001', { version: 2, changeNote: 'Aclara el contexto.' });
    expect(problems(treeWith([second, linkTo(2)]))).toEqual([]);
    // Un enlace mantenido tras revisarlo sigue en la versión 1: la importación comprueba que la v2 la tiene.
    expect(problems(treeWith([second, linkTo(1)]))).toEqual([]);
  });

  it('AC-FMT-001-01 un documento solo está propuesto o aprobado: design/ guarda la versión en curso', () => {
    const text = renderDocument(DECISION).replace('estado: propuesto', 'estado: sustituido');
    const tree = new Map(treeWith([DECISION]));
    tree.set(pathOf(DECISION), text);
    expect(problems(tree).join(' ')).toMatch(/estado/);
  });

  it('AC-FMT-001-01 los textos respetan los mismos límites de longitud que la v2 y el título de una taxonomía no lleva espacios de más', () => {
    const adr = record('adr', 'ADR-TST-001', {
      title: 'T'.repeat(201),
      criteria: [criterion('AC-TST-001-01', { statement: `Cuando pasa, entonces ${'x'.repeat(3000)}` })],
    });
    expect(problems(treeWith([DECISION, adr]))).toEqual([
      'El título supera los 200 caracteres.',
      'AC-TST-001-01: el enunciado supera los 3000 caracteres.',
    ]);
    const tax = taxonomy('TAX-001', { title: ' Taxonomía' });
    expect(problems(treeWith([DECISION, tax]))).toContain('El título empieza o acaba con espacios en blanco.');
  });

  it('AC-FMT-001-01 los títulos, la nota de cambio y los textos de un criterio no empiezan ni acaban con espacios', () => {
    const adr = record('adr', 'ADR-TST-001', {
      criteria: [criterion('AC-TST-001-01', { statement: '    Bloque indentado: cuando pasa, entonces se observa.' })],
    });
    expect(problems(treeWith([DECISION, adr]))).toEqual(['AC-TST-001-01: el enunciado empieza o acaba con espacios en blanco.']);
  });

  it('AC-FMT-001-02 la parte DOM-NNN de un código es única entre tipos', () => {
    const tree = treeWith([record('adr', 'ADR-STK-001'), record('decision', 'DEC-STK-001')]);
    expect(problems(tree)).toEqual([
      'DEC-STK-001 comparte STK-001 con ADR-STK-001: la parte DOM-NNN de un código es única entre tipos, porque sus criterios compartirían AC-STK-001-NN.',
    ]);
  });

  it('AC-FMT-001-02 un registro no se enlaza a sí mismo', () => {
    const adr = record('adr', 'ADR-TST-001', { links: [{ type: 'origin', target: { code: 'ADR-TST-001', version: 1 } }] });
    expect(problems(treeWith([adr]))).toEqual(['Un registro no puede enlazarse a sí mismo.']);
  });

  it('AC-FMT-001-02 un anexo existe y pertenece a un solo registro', () => {
    const withAnnex = record('adr', 'ADR-TST-001', { annexes: ['data/tabla.yaml'] });
    expect(problems(treeWith([withAnnex], { 'data/tabla.yaml': TABLE }))).toEqual([]);

    expect(problems(treeWith([withAnnex]))).toEqual(['El anexo datos/tabla.yaml no existe.']);

    const another = record('adr', 'ADR-TST-002', { annexes: ['data/tabla.yaml'] });
    expect(problems(treeWith([withAnnex, another], { 'data/tabla.yaml': TABLE }))).toEqual([
      'Un anexo debe pertenecer a exactamente un registro (ahora: 2).',
    ]);

    expect(problems(treeWith([DECISION], { 'data/tabla.yaml': TABLE }))).toEqual([
      'Un anexo debe pertenecer a exactamente un registro (ahora: 0).',
    ]);
  });

  const withAnnex = record('adr', 'ADR-TST-001', { annexes: ['data/tabla.yaml'] });

  it.each([
    {
      sample: 'CRLF',
      text: TABLE.replaceAll('\n', '\r\n'),
      message: 'El archivo usa finales de línea CRLF; el formato exige LF.',
    },
    {
      sample: 'espacios finales',
      text: 'codigo: DAT-TST-001 \nfilas: []\n',
      message: 'La línea 1 termina con espacios; el formato no los admite.',
    },
    {
      sample: 'un espacio duro final',
      text: 'codigo: DAT-TST-001\nfilas: [] \n',
      message: 'La línea 2 termina con espacios; el formato no los admite.',
    },
  ])('AC-FMT-001-01 un anexo con $caso se rechaza', ({ text, message }) => {
    expect(problems(treeWith([withAnnex], { 'data/tabla.yaml': text }))).toContain(message);
  });

  it('AC-FMT-001-02 un anexo que no es YAML válido se informa en español y sin traza de pila', () => {
    const report = validateTree(treeWith([withAnnex], { 'data/tabla.yaml': 'codigo: [DAT-TST-001\nfilas: []\n' }));
    expect(report.problems).toEqual([
      {
        path: 'data/tabla.yaml',
        message: 'El anexo no es YAML válido: error de sintaxis en la línea 2, columna 1 (BAD_INDENT).',
      },
    ]);
    const duplicate = validateTree(treeWith([withAnnex], { 'data/tabla.yaml': 'codigo: A\ncodigo: B\n' }));
    expect(messagesOf(duplicate)).toEqual([
      'El anexo no es YAML válido: error de sintaxis en la línea 2, columna 1 (DUPLICATE_KEY).',
    ]);
  });
});

describe('criterios verificables', () => {
  const typesWithCriteria: RecordType[] = ['adr', 'fdr', 'bug'];

  it.each(typesWithCriteria)('AC-FMT-001-03 un registro de tipo %s sin criterios se rechaza', (type) => {
    const doc = record(type, `${type.toUpperCase()}-TST-001`, { criteria: [] });
    expect(problems(treeWith([doc]))).toEqual(['Este tipo de registro exige al menos un criterio de aceptación.']);
  });

  it('AC-FMT-001-03 una decisión puede no tener criterios', () => {
    expect(problems(treeWith([record('decision', 'DEC-BAS-001', { criteria: [] })]))).toEqual([]);
  });

  it('AC-FMT-001-03 el código de un criterio empieza por el del registro', () => {
    const adr = record('adr', 'ADR-TST-001', { criteria: [criterion('AC-OTR-001-01')] });
    expect(problems(treeWith([adr]))).toEqual([
      'AC-OTR-001-01: el código de un criterio de ADR-TST-001 empieza por AC-TST-001-.',
    ]);
  });

  it('AC-FMT-001-03 «Deriva de» apunta a un criterio que existe en design/', () => {
    const origin = record('fdr', 'FDR-ORI-001');
    expect(problems(treeWith([origin, derivedFrom('AC-ORI-001-01')]))).toEqual([]);
    expect(problems(treeWith([origin, derivedFrom('AC-ORI-001-02')]))).toEqual([
      'AC-TST-001-01: deriva de AC-ORI-001-02, que no existe en design/.',
    ]);
    expect(problems(treeWith([origin, derivedFrom('AC-TST-001-01')]))).toEqual([
      'AC-TST-001-01: un criterio no puede derivar de sí mismo.',
    ]);
  });

  it('exige las secciones de la plantilla en orden', () => {
    const base = record('adr', 'ADR-TST-001');
    const unordered = record('adr', 'ADR-TST-001', { sections: base.sections.toReversed() });
    expect(problems(treeWith([unordered]))).toEqual([expect.stringMatching(/^Faltan secciones de la plantilla/)]);
    const withExtra = record('adr', 'ADR-TST-001', {
      sections: [...base.sections, { title: 'Spike', content: 'Result.' }],
    });
    expect(problems(treeWith([withExtra]))).toEqual([]);
  });

  it('exige nota de cambio a partir de la versión 2', () => {
    expect(problems(treeWith([record('decision', 'DEC-BAS-001', { version: 2 })]))).toEqual([
      'Una versión posterior a la 1 exige nota_de_cambio.',
    ]);
  });
});

describe('taxonomías', () => {
  it('AC-FMT-001-04 una taxonomía con «otra» en cada eje es válida', () => {
    expect(problems(treeWith([taxonomy('TAX-001')]))).toEqual([]);
  });

  it('AC-FMT-001-04 un eje sin la categoría «otra» se rechaza', () => {
    const tax = taxonomy('TAX-001');
    const withoutOther = taxonomy('TAX-001', {
      axes: [
        ...tax.axes,
        {
          code: 'quality',
          name: 'Quality',
          categories: [
            { code: 'security', name: 'Security', description: 'Autoridad y aislamiento.' },
            { code: 'reliability', name: 'Reliability', description: 'Durabilidad.' },
          ],
        },
      ],
    });
    expect(problems(treeWith([withoutOther]))).toEqual(['El eje calidad no tiene la categoría «otra».']);
  });

  it('AC-FMT-001-04 un eje necesita al menos dos categorías', () => {
    const onlyOther = taxonomy('TAX-001', {
      axes: [{ code: 'area', name: 'Área', categories: [{ code: 'other', name: 'Other', description: 'Todo.' }] }],
    });
    expect(problems(treeWith([onlyOther]))).toEqual([expect.stringMatching(/^Frontmatter: ejes\.0\.categorias/)]);
  });

  it('rechaza categorías y ejes duplicados', () => {
    const core = { code: 'core', name: 'Núcleo', description: 'El núcleo del sistema.' };
    const other = { code: 'other', name: 'Other', description: 'Ninguna encaja sin forzarla.' };
    const duplicate = taxonomy('TAX-001', {
      axes: [
        { code: 'area', name: 'Área', categories: [core, other, core] },
        { code: 'area', name: 'Área', categories: [core, other] },
      ],
    });
    const messages = problems(treeWith([duplicate]));
    expect(messages).toContain('Categoría duplicada en area: nucleo.');
    expect(messages).toContain('Eje duplicado: area.');
  });
});
