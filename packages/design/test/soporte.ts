// Constructores de documentos y árboles de `design/` para las pruebas del formato.

import { renderizarDocumento } from '../src/formato.ts';
import { README_DISENO } from '../src/readme.ts';
import {
  CARPETAS,
  PLANTILLAS,
  type Criterio,
  type Documento,
  type DocumentoRegistro,
  type DocumentoTaxonomia,
  type Problema,
  type Resultado,
  type TipoRegistro,
} from '../src/tipos.ts';

export function criterio(codigo: string, parcial: Partial<Criterio> = {}): Criterio {
  return {
    codigo,
    titulo: 'Criterio de prueba',
    verificacion: 'automática',
    comprobacion: 'Se comprueba con una prueba.',
    enunciado: 'Dado algo, cuando pasa, entonces se observa.',
    ...parcial,
  };
}

/** Registro válido del tipo dado: secciones de su plantilla y, si las exige, un criterio. */
export function registro(tipo: TipoRegistro, codigo: string, parcial: Partial<DocumentoRegistro> = {}): DocumentoRegistro {
  const plantilla = PLANTILLAS[tipo];
  return {
    clase: 'registro',
    tipo,
    codigo,
    titulo: `Registro ${codigo}`,
    version: 1,
    estado: 'propuesto',
    dominio: 'pruebas',
    enlaces: [],
    anexos: [],
    secciones: plantilla.secciones.map((titulo) => ({ titulo, contenido: `Texto de ${titulo.toLowerCase()}.` })),
    criterios: plantilla.exigeCriterios ? [criterio(`AC-${codigo.slice(4)}-01`)] : [],
    ...parcial,
  };
}

export function taxonomia(codigo: string, parcial: Partial<DocumentoTaxonomia> = {}): DocumentoTaxonomia {
  return {
    clase: 'taxonomia',
    codigo,
    titulo: 'Taxonomía de prueba',
    version: 1,
    estado: 'propuesto',
    ejes: [
      {
        codigo: 'area',
        nombre: 'Área',
        categorias: [
          { codigo: 'nucleo', nombre: 'Núcleo', descripcion: 'El núcleo del sistema.' },
          { codigo: 'otra', nombre: 'Otra', descripcion: 'Ninguna encaja sin forzarla.' },
        ],
      },
    ],
    secciones: [{ titulo: 'Propósito', contenido: 'Organizar el conocimiento.' }],
    ...parcial,
  };
}

export function rutaDe(doc: Documento): string {
  return `${CARPETAS[doc.clase === 'taxonomia' ? 'taxonomia' : doc.tipo]}/${doc.codigo}.md`;
}

/** Árbol con el README fijo, los documentos renderizados en su ruta y archivos extra. */
export function arbolCon(docs: readonly Documento[], extra: Readonly<Record<string, string>> = {}): Map<string, string> {
  const arbol = new Map<string, string>([['README.md', README_DISENO]]);
  for (const d of docs) arbol.set(rutaDe(d), renderizarDocumento(d));
  for (const [ruta, texto] of Object.entries(extra)) arbol.set(ruta, texto);
  return arbol;
}

export function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Se esperaba un resultado válido: ${JSON.stringify(r.problemas)}`);
  return r.valor;
}

/** Mensajes de un resultado fallido; si el resultado es válido, la prueba falla. */
export function fallos(r: Resultado<unknown>): string[] {
  if (r.ok) throw new Error('Se esperaba un resultado con problemas.');
  return r.problemas.map((p) => p.mensaje);
}

export function mensajesDe(informe: { problemas: readonly Problema[] }): string[] {
  return informe.problemas.map((p) => p.mensaje);
}
