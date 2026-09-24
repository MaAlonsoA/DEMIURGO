// Validation of a full `design/` tree, expressed as a path → text map.
// It's pure: reading from disk lives in `disk.ts`.

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

  if (!tree.has('README.md')) problems.push({ path: 'README.md', message: 'README.md is missing.' });

  for (const [path, text] of [...tree.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (path === 'README.md') {
      if (text !== README_DESIGN) {
        problems.push({ path, message: 'README.md doesn\'t match the fixed text; run "canonicalize".' });
      }
      continue;
    }
    const parts = path.split('/');
    if (parts.length !== 2) {
      problems.push({ path, message: 'File outside the design/ structure.' });
      continue;
    }
    const [folder, name] = parts as [string, string];
    if (folder === 'data') {
      if (!name.endsWith('.yaml')) problems.push({ path, message: 'Only .yaml files belong in data/.' });
      else annexes.set(path, text);
      continue;
    }
    const type = FOLDER_TO_CLASS.get(folder);
    if (!type || !name.endsWith('.md')) {
      problems.push({ path, message: 'File outside the design/ structure.' });
      continue;
    }
    const r = parseDocument(text, path);
    if (!r.ok) {
      problems.push(...r.problems);
      continue;
    }
    const doc: Document = r.value;
    const docType = doc.kind === 'taxonomy' ? 'taxonomy' : doc.type;
    if (docType !== type) problems.push({ path, message: `A "${docType}" document doesn't belong in ${folder}/.` });
    if (name !== `${doc.code}.md`) problems.push({ path, message: `The file must be named ${doc.code}.md.` });
    if (renderDocument(doc) !== text) {
      problems.push({ path, message: 'Not in canonical format; run "node packages/design/src/cli.ts canonicalize".' });
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
    if (byCode.has(r.code)) problems.push({ path, message: `Duplicate record code: ${r.code}.` });
    byCode.set(r.code, r);
    // The DOM-NNN part names the criteria (AC-DOM-NNN-NN): it's unique across types.
    const base = r.code.slice(4);
    const another = byBase.get(base);
    if (another !== undefined && another !== r.code) {
      problems.push({
        path,
        message: `${r.code} shares ${base} with ${another}: the DOM-NNN part of a code is unique across types, because their criteria would share AC-${base}-NN.`,
      });
    }
    byBase.set(base, r.code);
    const template = TEMPLATES[r.type];
    let i = 0;
    for (const s of r.sections) if (s.title === template.sections[i]) i++;
    if (i < template.sections.length) {
      problems.push({
        path,
        message: `Missing template sections (in order): ${template.sections.slice(i).join(', ')}.`,
      });
    }
    if (template.requiresCriteria && r.criteria.length === 0) {
      problems.push({ path, message: 'This record type requires at least one acceptance criterion.' });
    }
    if (r.version > 1 && !r.changeNote) problems.push({ path, message: 'A version after 1 requires change_note.' });
    // v2 stores these texts without leading or trailing whitespace: otherwise export wouldn't match.
    const texts: [string, string | undefined][] = [
      ['The title', r.title],
      ['The change note', r.changeNote],
      ...r.criteria.flatMap((c): [string, string][] => [
        [`${c.code}: the title`, c.title],
        [`${c.code}: the statement`, c.statement],
        [`${c.code}: the check`, c.check],
      ]),
    ];
    for (const [field, value] of texts) {
      if (value !== undefined && value !== value.trim()) {
        problems.push({ path, message: `${field} starts or ends with whitespace.` });
      }
    }
    // The same limits v2 applies when creating the version: otherwise the batch couldn't be ratified.
    const L = VERSION_LIMITS;
    const lengths: [string, string | undefined, number][] = [
      ['The title', r.title, L.title],
      ['The change note', r.changeNote, L.changeNote],
      ...r.sections.flatMap((s): [string, string, number][] => [
        [`The title of section "${s.title.slice(0, 40)}"`, s.title, L.sectionTitle],
        [`Section "${s.title.slice(0, 40)}"`, s.content, L.section],
      ]),
      ...r.criteria.flatMap((c): [string, string, number][] => [
        [`${c.code}: the title`, c.title, L.criterionTitle],
        [`${c.code}: the statement`, c.statement, L.statement],
        [`${c.code}: the check`, c.check, L.check],
      ]),
    ];
    for (const [field, value, max] of lengths) {
      if (value !== undefined && value.length > max) problems.push({ path, message: `${field} exceeds ${max} characters.` });
    }
    for (const [what, n, max] of [
      ['sections', r.sections.length, L.sections],
      ['criteria', r.criteria.length, L.criteria],
      ['links', r.links.length, L.links],
    ] as const) {
      if (n > max) problems.push({ path, message: `Has ${n} ${what}; the maximum is ${max}.` });
    }
    for (const c of r.criteria) {
      if (!c.code.startsWith(`AC-${base}-`)) {
        problems.push({ path, message: `${c.code}: a criterion code of ${r.code} must start with AC-${base}-.` });
      }
      const existing = acCodes.get(c.code);
      if (existing) problems.push({ path, message: `Duplicate criterion code: ${c.code} (also in ${existing}).` });
      acCodes.set(c.code, r.code);
    }
    for (const a of r.annexes) {
      if (!annexes.has(a)) problems.push({ path, message: `Annex ${a} doesn't exist.` });
    }
  }
  for (const r of records) {
    for (const e of r.links) {
      const target = byCode.get(e.target.code);
      if (!target) {
        problems.push({ path: pathOf(r), message: `The ${e.type} link points to ${e.target.code}, which doesn't exist.` });
      } else if (e.target.version > target.version) {
        // A link may still point to an earlier version of its target (kept after review);
        // import checks that version already exists in v2.
        problems.push({
          path: pathOf(r),
          message: `The ${e.type} link points to ${e.target.code}@${e.target.version}, later than version ${target.version} in design/.`,
        });
      }
      if (e.target.code === r.code) problems.push({ path: pathOf(r), message: 'A record cannot link to itself.' });
    }
    for (const c of r.criteria) {
      if (c.derivedFrom === undefined) continue;
      if (c.derivedFrom === c.code) {
        problems.push({ path: pathOf(r), message: `${c.code}: a criterion cannot derive from itself.` });
      } else if (!acCodes.has(c.derivedFrom)) {
        problems.push({ path: pathOf(r), message: `${c.code}: derives from ${c.derivedFrom}, which doesn't exist in design/.` });
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
    if (codes.has(t.code)) problems.push({ path, message: `Duplicate taxonomy code: ${t.code}.` });
    if (t.title !== t.title.trim()) problems.push({ path, message: 'The title starts or ends with whitespace.' });
    if (t.title.length < 3 || t.title.length > 200)
      problems.push({ path, message: 'The title must be between 3 and 200 characters.' });
    codes.add(t.code);
    const axes = new Set<string>();
    for (const axis of t.axes) {
      if (axes.has(axis.code)) problems.push({ path, message: `Duplicate axis: ${axis.code}.` });
      axes.add(axis.code);
      const categories = new Set<string>();
      for (const c of axis.categories) {
        if (categories.has(c.code)) problems.push({ path, message: `Duplicate category in ${axis.code}: ${c.code}.` });
        categories.add(c.code);
      }
      if (!categories.has('other')) problems.push({ path, message: `Axis ${axis.code} doesn't have the "other" category.` });
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
    if (n !== 1) problems.push({ path, message: `An annex must belong to exactly one record (currently: ${n}).` });
    problems.push(...whitespaceProblems(text, path));
    const yaml = readYaml(text, path, 'The annex');
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
