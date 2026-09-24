// Validación de un árbol `design/` completo, expresado como un mapa ruta → texto.
// Es puro: la lectura del disco está en `disco.ts`.

import { VERSION_LIMITS } from '@demiurgo/domain';
import { tableInconsistencies, capabilitiesSchema, transitionsSchema } from '@demiurgo/domain/tables/schemas';
import { readYaml, parseDocument, whitespaceProblems, renderDocument } from './format.ts';
import { README_DESIGN } from './readme.ts';
import { FOLDERS, TEMPLATES, type Document, type RecordDocument, type TaxonomyDocument, type Problem } from './types.ts';

export type DesignTree = ReadonlyMap<string, string>;

export type ValidationReport = {
  problems: Problem[];
  records: RecordDocument[];
  taxonomies: TaxonomyDocument[];
  annexes: Map<string, string>;
};

const FOLDER_TO_CLASS = new Map<string, string>(Object.entries(FOLDERS).map(([type, folder]) => [folder, type]));

export function validateTree(tree: DesignTree): ValidationReport {
  const problems: Problem[] = [];
  const records: RecordDocument[] = [];
  const taxonomies: TaxonomyDocument[] = [];
  const annexes = new Map<string, string>();

  if (!tree.has('README.md')) problems.push({ path: 'README.md', message: 'Falta README.md.' });

  for (const [path, text] of [...tree.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (path === 'README.md') {
      if (text !== README_DESIGN) {
        problems.push({ path, message: 'README.md no coincide con el texto fijo; ejecuta «canonizar».' });
      }
      continue;
    }
    const parts = path.split('/');
    if (parts.length !== 2) {
      problems.push({ path, message: 'Archivo fuera de la estructura de design/.' });
      continue;
    }
    const [folder, name] = parts as [string, string];
    if (folder === 'data') {
      if (!name.endsWith('.yaml')) problems.push({ path, message: 'En datos/ solo hay archivos .yaml.' });
      else annexes.set(path, text);
      continue;
    }
    const type = FOLDER_TO_CLASS.get(folder);
    if (!type || !name.endsWith('.md')) {
      problems.push({ path, message: 'Archivo fuera de la estructura de design/.' });
      continue;
    }
    const r = parseDocument(text, path);
    if (!r.ok) {
      problems.push(...r.problems);
      continue;
    }
    const doc: Document = r.value;
    const docType = doc.kind === 'taxonomy' ? 'taxonomy' : doc.type;
    if (docType !== type) problems.push({ path, message: `Un documento de tipo «${docType}» no va en ${folder}/.` });
    if (name !== `${doc.code}.md`) problems.push({ path, message: `El archivo debe llamarse ${doc.code}.md.` });
    if (renderDocument(doc) !== text) {
      problems.push({ path, message: 'No está en formato canónico; ejecuta «node packages/design/src/cli.ts canonizar».' });
    }
    if (doc.kind === 'taxonomy') taxonomies.push(doc);
    else records.push(doc);
  }

  problems.push(...checkRecords(records, annexes));
  problems.push(...checkTaxonomies(taxonomies));
  problems.push(...checkAnnexes(annexes, records));
  return { problems, records, taxonomies, annexes };
}

function pathOf(doc: Document): string {
  return `${FOLDERS[doc.kind === 'taxonomy' ? 'taxonomy' : doc.type]}/${doc.code}.md`;
}

function checkRecords(records: RecordDocument[], annexes: Map<string, string>): Problem[] {
  const problems: Problem[] = [];
  const byCode = new Map<string, RecordDocument>();
  const byBase = new Map<string, string>();
  const acCodes = new Map<string, string>();
  for (const r of records) {
    const path = pathOf(r);
    if (byCode.has(r.code)) problems.push({ path, message: `Código de registro duplicado: ${r.code}.` });
    byCode.set(r.code, r);
    // La parte DOM-NNN da nombre a los criterios (AC-DOM-NNN-NN): es única entre tipos.
    const base = r.code.slice(4);
    const another = byBase.get(base);
    if (another !== undefined && another !== r.code) {
      problems.push({
        path,
        message: `${r.code} comparte ${base} con ${another}: la parte DOM-NNN de un código es única entre tipos, porque sus criterios compartirían AC-${base}-NN.`,
      });
    }
    byBase.set(base, r.code);
    const template = TEMPLATES[r.type];
    let i = 0;
    for (const s of r.sections) if (s.title === template.sections[i]) i++;
    if (i < template.sections.length) {
      problems.push({
        path,
        message: `Faltan secciones de la plantilla (en orden): ${template.sections.slice(i).join(', ')}.`,
      });
    }
    if (template.requiresCriteria && r.criteria.length === 0) {
      problems.push({ path, message: 'Este tipo de registro exige al menos un criterio de aceptación.' });
    }
    if (r.version > 1 && !r.changeNote) problems.push({ path, message: 'Una versión posterior a la 1 exige nota_de_cambio.' });
    // La v2 guarda estos textos sin espacios al principio ni al final: si los tuvieran, la exportación no coincidiría.
    const texts: [string, string | undefined][] = [
      ['El título', r.title],
      ['La nota de cambio', r.changeNote],
      ...r.criteria.flatMap((c): [string, string][] => [
        [`${c.code}: el título`, c.title],
        [`${c.code}: el enunciado`, c.statement],
        [`${c.code}: la comprobación`, c.check],
      ]),
    ];
    for (const [field, value] of texts) {
      if (value !== undefined && value !== value.trim()) {
        problems.push({ path, message: `${field} empieza o acaba con espacios en blanco.` });
      }
    }
    // Los mismos límites que la v2 aplica al crear la versión: si no, el lote no se podría ratificar.
    const L = VERSION_LIMITS;
    const lengths: [string, string | undefined, number][] = [
      ['El título', r.title, L.title],
      ['La nota de cambio', r.changeNote, L.changeNote],
      ...r.sections.flatMap((s): [string, string, number][] => [
        [`El título de la sección «${s.title.slice(0, 40)}»`, s.title, L.sectionTitle],
        [`La sección «${s.title.slice(0, 40)}»`, s.content, L.section],
      ]),
      ...r.criteria.flatMap((c): [string, string, number][] => [
        [`${c.code}: el título`, c.title, L.criterionTitle],
        [`${c.code}: el enunciado`, c.statement, L.statement],
        [`${c.code}: la comprobación`, c.check, L.check],
      ]),
    ];
    for (const [field, value, max] of lengths) {
      if (value !== undefined && value.length > max) problems.push({ path, message: `${field} supera los ${max} caracteres.` });
    }
    for (const [what, n, max] of [
      ['sections', r.sections.length, L.sections],
      ['criteria', r.criteria.length, L.criteria],
      ['links', r.links.length, L.links],
    ] as const) {
      if (n > max) problems.push({ path, message: `Tiene ${n} ${what}; el máximo es ${max}.` });
    }
    for (const c of r.criteria) {
      if (!c.code.startsWith(`AC-${base}-`)) {
        problems.push({ path, message: `${c.code}: el código de un criterio de ${r.code} empieza por AC-${base}-.` });
      }
      const existing = acCodes.get(c.code);
      if (existing) problems.push({ path, message: `Código de criterio duplicado: ${c.code} (también en ${existing}).` });
      acCodes.set(c.code, r.code);
    }
    for (const a of r.annexes) {
      if (!annexes.has(a)) problems.push({ path, message: `El anexo ${a} no existe.` });
    }
  }
  for (const r of records) {
    for (const e of r.links) {
      const target = byCode.get(e.target.code);
      if (!target) {
        problems.push({ path: pathOf(r), message: `El enlace ${e.type} apunta a ${e.target.code}, que no existe.` });
      } else if (e.target.version > target.version) {
        // Un enlace puede seguir en una versión anterior de su destino (mantenido tras revisarlo);
        // la importación comprueba que esa versión ya está en la v2.
        problems.push({
          path: pathOf(r),
          message: `El enlace ${e.type} apunta a ${e.target.code}@${e.target.version}, posterior a la versión ${target.version} de design/.`,
        });
      }
      if (e.target.code === r.code)
        problems.push({ path: pathOf(r), message: 'Un registro no puede enlazarse a sí mismo.' });
    }
    for (const c of r.criteria) {
      if (c.derivedFrom === undefined) continue;
      if (c.derivedFrom === c.code) {
        problems.push({ path: pathOf(r), message: `${c.code}: un criterio no puede derivar de sí mismo.` });
      } else if (!acCodes.has(c.derivedFrom)) {
        problems.push({ path: pathOf(r), message: `${c.code}: deriva de ${c.derivedFrom}, que no existe en design/.` });
      }
    }
  }
  return problems;
}

function checkTaxonomies(taxonomies: TaxonomyDocument[]): Problem[] {
  const problems: Problem[] = [];
  const codes = new Set<string>();
  for (const t of taxonomies) {
    const path = pathOf(t);
    if (codes.has(t.code)) problems.push({ path, message: `Código de taxonomía duplicado: ${t.code}.` });
    if (t.title !== t.title.trim()) problems.push({ path, message: 'El título empieza o acaba con espacios en blanco.' });
    if (t.title.length < 3 || t.title.length > 200)
      problems.push({ path, message: 'El título tiene entre 3 y 200 caracteres.' });
    codes.add(t.code);
    const axes = new Set<string>();
    for (const axis of t.axes) {
      if (axes.has(axis.code)) problems.push({ path, message: `Eje duplicado: ${axis.code}.` });
      axes.add(axis.code);
      const categories = new Set<string>();
      for (const c of axis.categories) {
        if (categories.has(c.code)) problems.push({ path, message: `Categoría duplicada en ${axis.code}: ${c.code}.` });
        categories.add(c.code);
      }
      if (!categories.has('other')) problems.push({ path, message: `El eje ${axis.code} no tiene la categoría «otra».` });
    }
  }
  return problems;
}

function checkAnnexes(annexes: Map<string, string>, records: RecordDocument[]): Problem[] {
  const problems: Problem[] = [];
  const referenced = new Map<string, number>();
  for (const r of records) for (const a of r.annexes) referenced.set(a, (referenced.get(a) ?? 0) + 1);
  const read = new Map<string, unknown>();
  for (const [path, text] of annexes) {
    const n = referenced.get(path) ?? 0;
    if (n !== 1) problems.push({ path, message: `Un anexo debe pertenecer a exactamente un registro (ahora: ${n}).` });
    problems.push(...whitespaceProblems(text, path));
    const yaml = readYaml(text, path, 'El anexo');
    if (yaml.ok) read.set(path, yaml.value);
    else problems.push(...yaml.problems);
  }
  const cap = read.get('data/capabilities.yaml');
  const trans = read.get('data/transitions.yaml');
  if (cap !== undefined && trans !== undefined) {
    const rc = capabilitiesSchema.safeParse(cap);
    const transitionsResult = transitionsSchema.safeParse(trans);
    if (!rc.success) {
      for (const i of rc.error.issues)
        problems.push({ path: 'data/capabilities.yaml', message: `${i.path.join('.')}: ${i.message}` });
    }
    if (!transitionsResult.success) {
      for (const i of transitionsResult.error.issues)
        problems.push({ path: 'data/transitions.yaml', message: `${i.path.join('.')}: ${i.message}` });
    }
    if (rc.success && transitionsResult.success) {
      for (const m of tableInconsistencies(rc.data, transitionsResult.data)) problems.push({ path: 'data/', message: m });
    }
  }
  return problems;
}
