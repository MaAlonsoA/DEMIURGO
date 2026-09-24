import { describe, expect, it } from 'vitest';
import { validarArbol } from '../src/arbol.ts';
import { renderizarDocumento } from '../src/formato.ts';
import type { TipoRegistro } from '../src/tipos.ts';
import { arbolCon, criterio, mensajesDe, registro, rutaDe, taxonomia } from './soporte.ts';

const DECISION = registro('decision', 'DEC-TST-001');
const ADR = registro('adr', 'ADR-TST-001', { enlaces: [{ tipo: 'based_on', destino: { codigo: 'DEC-TST-001', version: 1 } }] });
const TABLA = 'codigo: DAT-TST-001\nfilas: []\n';

const problemas = (arbol: ReadonlyMap<string, string>) => mensajesDe(validarArbol(arbol));

describe('forma canónica del árbol', () => {
  it('AC-FMT-001-01 un árbol canónico y coherente no tiene problemas', () => {
    const informe = validarArbol(arbolCon([DECISION, ADR, taxonomia('TAX-001')]));
    expect(mensajesDe(informe)).toEqual([]);
    expect(informe.registros.map((r) => r.codigo)).toEqual(['ADR-TST-001', 'DEC-TST-001']);
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

  it('AC-FMT-001-02 un enlace apunta a una versión existente', () => {
    const adr = registro('adr', 'ADR-TST-001', {
      enlaces: [{ tipo: 'design_of', destino: { codigo: 'DEC-TST-001', version: 2 } }],
    });
    expect(problemas(arbolCon([DECISION, adr]))).toEqual(['El enlace apunta a DEC-TST-001@2, que no existe.']);
    const segunda = registro('decision', 'DEC-TST-001', { version: 2, notaDeCambio: 'Aclara el contexto.' });
    expect(problemas(arbolCon([segunda, adr]))).toEqual([]);
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
});

describe('criterios verificables', () => {
  const tiposConCriterios: TipoRegistro[] = ['adr', 'fdr', 'bug'];

  it.each(tiposConCriterios)('AC-FMT-001-03 un registro de tipo %s sin criterios se rechaza', (tipo) => {
    const doc = registro(tipo, `${tipo.toUpperCase()}-TST-001`, { criterios: [] });
    expect(problemas(arbolCon([doc]))).toEqual(['Este tipo de registro exige al menos un criterio de aceptación.']);
  });

  it('AC-FMT-001-03 una decisión puede no tener criterios', () => {
    expect(problemas(arbolCon([registro('decision', 'DEC-TST-001', { criterios: [] })]))).toEqual([]);
  });

  it('AC-FMT-001-03 el código de un criterio empieza por el del registro', () => {
    const adr = registro('adr', 'ADR-TST-001', { criterios: [criterio('AC-OTR-001-01')] });
    expect(problemas(arbolCon([adr]))).toEqual([
      'AC-OTR-001-01: el código de un criterio de ADR-TST-001 empieza por AC-TST-001-.',
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
    expect(problemas(arbolCon([registro('decision', 'DEC-TST-001', { version: 2 })]))).toEqual([
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
