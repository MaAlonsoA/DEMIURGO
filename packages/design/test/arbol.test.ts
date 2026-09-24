import { describe, expect, it } from 'vitest';
import { validarArbol } from '../src/arbol.ts';
import { renderizarDocumento } from '../src/formato.ts';
import type { TipoRegistro } from '../src/tipos.ts';
import { arbolCon, criterio, mensajesDe, registro, rutaDe, taxonomia } from './soporte.ts';

const DECISION = registro('decision', 'DEC-BAS-001');
const ADR = registro('adr', 'ADR-TST-001', { enlaces: [{ tipo: 'based_on', destino: { codigo: 'DEC-BAS-001', version: 1 } }] });
const TABLA = 'codigo: DAT-TST-001\nfilas: []\n';

const problemas = (arbol: ReadonlyMap<string, string>) => mensajesDe(validarArbol(arbol));

/** ADR que enlaza con la versión dada de DEC-BAS-001. */
const enlaceA = (version: number) =>
  registro('adr', 'ADR-TST-001', { enlaces: [{ tipo: 'design_of', destino: { codigo: 'DEC-BAS-001', version } }] });

/** ADR con un criterio que deriva del código dado. */
const derivaDe = (codigo: string) =>
  registro('adr', 'ADR-TST-001', { criterios: [criterio('AC-TST-001-01', { derivaDe: codigo })] });

describe('forma canónica del árbol', () => {
  it('AC-FMT-001-01 un árbol canónico y coherente no tiene problemas', () => {
    const informe = validarArbol(arbolCon([DECISION, ADR, taxonomia('TAX-001')]));
    expect(mensajesDe(informe)).toEqual([]);
    expect(informe.registros.map((r) => r.codigo)).toEqual(['ADR-TST-001', 'DEC-BAS-001']);
    expect(informe.taxonomias.map((t) => t.codigo)).toEqual(['TAX-001']);
  });

  it('AC-FMT-001-01 rechaza un documento que no está en forma canónica', () => {
    const arbol = arbolCon([DECISION]);
    const ruta = rutaDe(DECISION);
    arbol.set(ruta, (arbol.get(ruta) ?? '').replace('\n\n## Decisión', '\n\n\n## Decisión'));
    expect(problemas(arbol)).toEqual([expect.stringMatching(/No está en formato canónico/)]);
  });

  it('AC-FMT-001-01 rechaza un documento con CRLF o espacios al final de línea', () => {
    const ruta = rutaDe(DECISION);
    const conCrlf = arbolCon([DECISION]);
    conCrlf.set(ruta, (conCrlf.get(ruta) ?? '').replaceAll('\n', '\r\n'));
    expect(problemas(conCrlf)).toEqual([expect.stringMatching(/CRLF/)]);
    const conEspacios = arbolCon([DECISION]);
    conEspacios.set(ruta, (conEspacios.get(ruta) ?? '').replace('Texto de contexto.', 'Texto de contexto. '));
    expect(problemas(conEspacios)).toEqual([expect.stringMatching(/termina con espacios/)]);
  });

  it('AC-FMT-001-01 rechaza un README distinto del texto fijo', () => {
    const arbol = arbolCon([DECISION]);
    arbol.set('README.md', `${arbol.get('README.md') ?? ''}\nNota añadida a mano.\n`);
    expect(problemas(arbol)).toEqual([expect.stringMatching(/README\.md no coincide con el texto fijo/)]);
    arbol.delete('README.md');
    expect(problemas(arbol)).toEqual(['Falta README.md.']);
  });

  it('rechaza archivos fuera de la estructura y documentos en otra carpeta', () => {
    const arbol = arbolCon([DECISION], {
      'notas.md': 'Notas sueltas.\n',
      'otros/DEC-TST-002.md': renderizarDocumento(registro('decision', 'DEC-TST-002')),
      'adr/DEC-TST-003.md': renderizarDocumento(registro('decision', 'DEC-TST-003')),
      'datos/tabla.txt': 'texto\n',
    });
    const mensajes = problemas(arbol);
    expect(mensajes.filter((m) => m === 'Archivo fuera de la estructura de design/.')).toHaveLength(2);
    expect(mensajes).toContain('Un documento de tipo «decision» no va en adr/.');
    expect(mensajes).toContain('En datos/ solo hay archivos .yaml.');
  });
});

describe('códigos, enlaces y anexos', () => {
  it('AC-FMT-001-02 rechaza códigos de registro duplicados', () => {
    const arbol = arbolCon([DECISION, ADR], { 'adr/ADR-TST-002.md': renderizarDocumento(ADR) });
    const mensajes = problemas(arbol);
    expect(mensajes).toContain('Código de registro duplicado: ADR-TST-001.');
    expect(mensajes).toContain('El archivo debe llamarse ADR-TST-001.md.');
  });

  it('AC-FMT-001-02 rechaza códigos de taxonomía duplicados', () => {
    const arbol = arbolCon([taxonomia('TAX-001')], { 'taxonomia/TAX-002.md': renderizarDocumento(taxonomia('TAX-001')) });
    expect(problemas(arbol)).toContain('Código de taxonomía duplicado: TAX-001.');
  });

  it('AC-FMT-001-02 rechaza códigos de criterio duplicados', () => {
    const adr = registro('adr', 'ADR-TST-001', { criterios: [criterio('AC-TST-001-01'), criterio('AC-TST-001-01')] });
    expect(problemas(arbolCon([adr]))).toEqual([expect.stringMatching(/Código de criterio duplicado: AC-TST-001-01/)]);
  });

  it('AC-FMT-001-02 un enlace apunta a un registro existente', () => {
    const adr = registro('adr', 'ADR-TST-001', {
      enlaces: [{ tipo: 'based_on', destino: { codigo: 'DEC-NOE-001', version: 1 } }],
    });
    expect(problemas(arbolCon([DECISION, adr]))).toEqual(['El enlace based_on apunta a DEC-NOE-001, que no existe.']);
  });

  it('AC-FMT-001-02 un enlace apunta a la versión de su destino en design/ o a una anterior, nunca a una posterior', () => {
    expect(problemas(arbolCon([DECISION, enlaceA(2)]))).toEqual([
      'El enlace design_of apunta a DEC-BAS-001@2, posterior a la versión 1 de design/.',
    ]);
    const segunda = registro('decision', 'DEC-BAS-001', { version: 2, notaDeCambio: 'Aclara el contexto.' });
    expect(problemas(arbolCon([segunda, enlaceA(2)]))).toEqual([]);
    // Un enlace mantenido tras revisarlo sigue en la versión 1: la importación comprueba que la v2 la tiene.
    expect(problemas(arbolCon([segunda, enlaceA(1)]))).toEqual([]);
  });

  it('AC-FMT-001-01 un documento solo está propuesto o aprobado: design/ guarda la versión en curso', () => {
    const texto = renderizarDocumento(DECISION).replace('estado: propuesto', 'estado: sustituido');
    const arbol = new Map(arbolCon([DECISION]));
    arbol.set(rutaDe(DECISION), texto);
    expect(problemas(arbol).join(' ')).toMatch(/estado/);
  });

  it('AC-FMT-001-01 los títulos, la nota de cambio y los textos de un criterio no empiezan ni acaban con espacios', () => {
    const adr = registro('adr', 'ADR-TST-001', {
      criterios: [criterio('AC-TST-001-01', { enunciado: '    Bloque indentado: cuando pasa, entonces se observa.' })],
    });
    expect(problemas(arbolCon([DECISION, adr]))).toEqual(['AC-TST-001-01: el enunciado empieza o acaba con espacios en blanco.']);
  });

  it('AC-FMT-001-02 la parte DOM-NNN de un código es única entre tipos', () => {
    const arbol = arbolCon([registro('adr', 'ADR-STK-001'), registro('decision', 'DEC-STK-001')]);
    expect(problemas(arbol)).toEqual([
      'DEC-STK-001 comparte STK-001 con ADR-STK-001: la parte DOM-NNN de un código es única entre tipos, porque sus criterios compartirían AC-STK-001-NN.',
    ]);
  });

  it('AC-FMT-001-02 un registro no se enlaza a sí mismo', () => {
    const adr = registro('adr', 'ADR-TST-001', { enlaces: [{ tipo: 'origin', destino: { codigo: 'ADR-TST-001', version: 1 } }] });
    expect(problemas(arbolCon([adr]))).toEqual(['Un registro no puede enlazarse a sí mismo.']);
  });

  it('AC-FMT-001-02 un anexo existe y pertenece a un solo registro', () => {
    const conAnexo = registro('adr', 'ADR-TST-001', { anexos: ['datos/tabla.yaml'] });
    expect(problemas(arbolCon([conAnexo], { 'datos/tabla.yaml': TABLA }))).toEqual([]);

    expect(problemas(arbolCon([conAnexo]))).toEqual(['El anexo datos/tabla.yaml no existe.']);

    const otro = registro('adr', 'ADR-TST-002', { anexos: ['datos/tabla.yaml'] });
    expect(problemas(arbolCon([conAnexo, otro], { 'datos/tabla.yaml': TABLA }))).toEqual([
      'Un anexo debe pertenecer a exactamente un registro (ahora: 2).',
    ]);

    expect(problemas(arbolCon([DECISION], { 'datos/tabla.yaml': TABLA }))).toEqual([
      'Un anexo debe pertenecer a exactamente un registro (ahora: 0).',
    ]);
  });

  const conAnexo = registro('adr', 'ADR-TST-001', { anexos: ['datos/tabla.yaml'] });

  it.each([
    {
      caso: 'CRLF',
      texto: TABLA.replaceAll('\n', '\r\n'),
      mensaje: 'El archivo usa finales de línea CRLF; el formato exige LF.',
    },
    {
      caso: 'espacios finales',
      texto: 'codigo: DAT-TST-001 \nfilas: []\n',
      mensaje: 'La línea 1 termina con espacios; el formato no los admite.',
    },
    {
      caso: 'un espacio duro final',
      texto: 'codigo: DAT-TST-001\nfilas: [] \n',
      mensaje: 'La línea 2 termina con espacios; el formato no los admite.',
    },
  ])('AC-FMT-001-01 un anexo con $caso se rechaza', ({ texto, mensaje }) => {
    expect(problemas(arbolCon([conAnexo], { 'datos/tabla.yaml': texto }))).toContain(mensaje);
  });

  it('AC-FMT-001-02 un anexo que no es YAML válido se informa en español y sin traza de pila', () => {
    const informe = validarArbol(arbolCon([conAnexo], { 'datos/tabla.yaml': 'codigo: [DAT-TST-001\nfilas: []\n' }));
    expect(informe.problemas).toEqual([
      {
        ruta: 'datos/tabla.yaml',
        mensaje: 'El anexo no es YAML válido: error de sintaxis en la línea 2, columna 1 (BAD_INDENT).',
      },
    ]);
    const duplicada = validarArbol(arbolCon([conAnexo], { 'datos/tabla.yaml': 'codigo: A\ncodigo: B\n' }));
    expect(mensajesDe(duplicada)).toEqual([
      'El anexo no es YAML válido: error de sintaxis en la línea 2, columna 1 (DUPLICATE_KEY).',
    ]);
  });
});

describe('criterios verificables', () => {
  const tiposConCriterios: TipoRegistro[] = ['adr', 'fdr', 'bug'];

  it.each(tiposConCriterios)('AC-FMT-001-03 un registro de tipo %s sin criterios se rechaza', (tipo) => {
    const doc = registro(tipo, `${tipo.toUpperCase()}-TST-001`, { criterios: [] });
    expect(problemas(arbolCon([doc]))).toEqual(['Este tipo de registro exige al menos un criterio de aceptación.']);
  });

  it('AC-FMT-001-03 una decisión puede no tener criterios', () => {
    expect(problemas(arbolCon([registro('decision', 'DEC-BAS-001', { criterios: [] })]))).toEqual([]);
  });

  it('AC-FMT-001-03 el código de un criterio empieza por el del registro', () => {
    const adr = registro('adr', 'ADR-TST-001', { criterios: [criterio('AC-OTR-001-01')] });
    expect(problemas(arbolCon([adr]))).toEqual([
      'AC-OTR-001-01: el código de un criterio de ADR-TST-001 empieza por AC-TST-001-.',
    ]);
  });

  it('AC-FMT-001-03 «Deriva de» apunta a un criterio que existe en design/', () => {
    const origen = registro('fdr', 'FDR-ORI-001');
    expect(problemas(arbolCon([origen, derivaDe('AC-ORI-001-01')]))).toEqual([]);
    expect(problemas(arbolCon([origen, derivaDe('AC-ORI-001-02')]))).toEqual([
      'AC-TST-001-01: deriva de AC-ORI-001-02, que no existe en design/.',
    ]);
    expect(problemas(arbolCon([origen, derivaDe('AC-TST-001-01')]))).toEqual([
      'AC-TST-001-01: un criterio no puede derivar de sí mismo.',
    ]);
  });

  it('exige las secciones de la plantilla en orden', () => {
    const base = registro('adr', 'ADR-TST-001');
    const desordenado = registro('adr', 'ADR-TST-001', { secciones: base.secciones.toReversed() });
    expect(problemas(arbolCon([desordenado]))).toEqual([expect.stringMatching(/^Faltan secciones de la plantilla/)]);
    const conExtra = registro('adr', 'ADR-TST-001', {
      secciones: [...base.secciones, { titulo: 'Spike', contenido: 'Resultado.' }],
    });
    expect(problemas(arbolCon([conExtra]))).toEqual([]);
  });

  it('exige nota de cambio a partir de la versión 2', () => {
    expect(problemas(arbolCon([registro('decision', 'DEC-BAS-001', { version: 2 })]))).toEqual([
      'Una versión posterior a la 1 exige nota_de_cambio.',
    ]);
  });
});

describe('taxonomías', () => {
  it('AC-FMT-001-04 una taxonomía con «otra» en cada eje es válida', () => {
    expect(problemas(arbolCon([taxonomia('TAX-001')]))).toEqual([]);
  });

  it('AC-FMT-001-04 un eje sin la categoría «otra» se rechaza', () => {
    const tax = taxonomia('TAX-001');
    const sinOtra = taxonomia('TAX-001', {
      ejes: [
        ...tax.ejes,
        {
          codigo: 'calidad',
          nombre: 'Calidad',
          categorias: [
            { codigo: 'seguridad', nombre: 'Seguridad', descripcion: 'Autoridad y aislamiento.' },
            { codigo: 'fiabilidad', nombre: 'Fiabilidad', descripcion: 'Durabilidad.' },
          ],
        },
      ],
    });
    expect(problemas(arbolCon([sinOtra]))).toEqual(['El eje calidad no tiene la categoría «otra».']);
  });

  it('AC-FMT-001-04 un eje necesita al menos dos categorías', () => {
    const soloOtra = taxonomia('TAX-001', {
      ejes: [{ codigo: 'area', nombre: 'Área', categorias: [{ codigo: 'otra', nombre: 'Otra', descripcion: 'Todo.' }] }],
    });
    expect(problemas(arbolCon([soloOtra]))).toEqual([expect.stringMatching(/^Frontmatter: ejes\.0\.categorias/)]);
  });

  it('rechaza categorías y ejes duplicados', () => {
    const nucleo = { codigo: 'nucleo', nombre: 'Núcleo', descripcion: 'El núcleo del sistema.' };
    const otra = { codigo: 'otra', nombre: 'Otra', descripcion: 'Ninguna encaja sin forzarla.' };
    const duplicada = taxonomia('TAX-001', {
      ejes: [
        { codigo: 'area', nombre: 'Área', categorias: [nucleo, otra, nucleo] },
        { codigo: 'area', nombre: 'Área', categorias: [nucleo, otra] },
      ],
    });
    const mensajes = problemas(arbolCon([duplicada]));
    expect(mensajes).toContain('Categoría duplicada en area: nucleo.');
    expect(mensajes).toContain('Eje duplicado: area.');
  });
});
