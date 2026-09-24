// Constructores de documentos y árboles de `design/` para las pruebas del formato.

import { renderDocument } from '../src/format.ts';
import { README_DESIGN } from '../src/readme.ts';
import {
  FOLDERS,
  TEMPLATES,
  type Criterion,
  type Document,
  type RecordDocument,
  type TaxonomyDocument,
  type Problem,
  type Result,
  type RecordType,
} from '../src/types.ts';

export function criterion(code: string, partial: Partial<Criterion> = {}): Criterion {
  return {
    code,
    title: 'Criterio de prueba',
    verification: 'automática',
    check: 'Se comprueba con una prueba.',
    statement: 'Dado algo, cuando pasa, entonces se observa.',
    ...partial,
  };
}

/** Registro válido del tipo dado: secciones de su plantilla y, si las exige, un criterio. */
export function record(type: RecordType, code: string, partial: Partial<RecordDocument> = {}): RecordDocument {
  const template = TEMPLATES[type];
  return {
    kind: 'record',
    type,
    code,
    title: `Registro ${code}`,
    version: 1,
    state: 'proposed',
    domain: 'tests',
    links: [],
    annexes: [],
    sections: template.sections.map((title) => ({ title, content: `Texto de ${title.toLowerCase()}.` })),
    criteria: template.requiresCriteria ? [criterion(`AC-${code.slice(4)}-01`)] : [],
    ...partial,
  };
}

export function taxonomy(code: string, partial: Partial<TaxonomyDocument> = {}): TaxonomyDocument {
  return {
    kind: 'taxonomy',
    code,
    title: 'Taxonomía de prueba',
    version: 1,
    state: 'proposed',
    axes: [
      {
        code: 'area',
        name: 'Área',
        categories: [
          { code: 'core', name: 'Núcleo', description: 'El núcleo del sistema.' },
          { code: 'other', name: 'Other', description: 'Ninguna encaja sin forzarla.' },
        ],
      },
    ],
    sections: [{ title: 'Propósito', content: 'Organizar el conocimiento.' }],
    ...partial,
  };
}

export function pathOf(doc: Document): string {
  return `${FOLDERS[doc.kind === 'taxonomy' ? 'taxonomy' : doc.type]}/${doc.code}.md`;
}

/** Árbol con el README fijo, los documentos renderizados en su ruta y archivos extra. */
export function treeWith(docs: readonly Document[], extra: Readonly<Record<string, string>> = {}): Map<string, string> {
  const tree = new Map<string, string>([['README.md', README_DESIGN]]);
  for (const d of docs) tree.set(pathOf(d), renderDocument(d));
  for (const [path, text] of Object.entries(extra)) tree.set(path, text);
  return tree;
}

export function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`Se esperaba un resultado válido: ${JSON.stringify(r.problems)}`);
  return r.value;
}

/** Mensajes de un resultado fallido; si el resultado es válido, la prueba falla. */
export function failures(r: Result<unknown>): string[] {
  if (r.ok) throw new Error('Se esperaba un resultado con problemas.');
  return r.problems.map((p) => p.message);
}

export function messagesOf(report: { problems: readonly Problem[] }): string[] {
  return report.problems.map((p) => p.message);
}
