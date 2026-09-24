// Builders of `design/` documents and trees for the format tests.

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
    title: 'Test criterion',
    verification: 'automatic',
    check: 'Checked with a test.',
    statement: 'Given something, when it happens, then it is observed.',
    ...partial,
  };
}

/** A valid record of the given type: its template's sections and, if it requires one, a criterion. */
export function record(type: RecordType, code: string, partial: Partial<RecordDocument> = {}): RecordDocument {
  const template = TEMPLATES[type];
  return {
    kind: 'record',
    type,
    code,
    title: `Record ${code}`,
    version: 1,
    state: 'proposed',
    domain: 'tests',
    links: [],
    annexes: [],
    sections: template.sections.map((title) => ({ title, content: `Text for ${title.toLowerCase()}.` })),
    criteria: template.requiresCriteria ? [criterion(`AC-${code.slice(4)}-01`)] : [],
    ...partial,
  };
}

export function taxonomy(code: string, partial: Partial<TaxonomyDocument> = {}): TaxonomyDocument {
  return {
    kind: 'taxonomy',
    code,
    title: 'Test taxonomy',
    version: 1,
    state: 'proposed',
    axes: [
      {
        code: 'area',
        name: 'Area',
        categories: [
          { code: 'core', name: 'Core', description: 'The core of the system.' },
          { code: 'other', name: 'Other', description: 'None fits without forcing it.' },
        ],
      },
    ],
    sections: [{ title: 'Purpose', content: 'Organize the knowledge.' }],
    ...partial,
  };
}

export function pathOf(doc: Document): string {
  return `${FOLDERS[doc.kind === 'taxonomy' ? 'taxonomy' : doc.type]}/${doc.code}.md`;
}

/** A tree with the fixed README, the documents rendered at their path and extra files. */
export function treeWith(docs: readonly Document[], extra: Readonly<Record<string, string>> = {}): Map<string, string> {
  const tree = new Map<string, string>([['README.md', README_DESIGN]]);
  for (const d of docs) tree.set(pathOf(d), renderDocument(d));
  for (const [path, text] of Object.entries(extra)) tree.set(path, text);
  return tree;
}

export function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`Expected a valid result: ${JSON.stringify(r.problems)}`);
  return r.value;
}

/** Messages of a failed result; the test fails if the result is valid. */
export function failures(r: Result<unknown>): string[] {
  if (r.ok) throw new Error('Expected a result with problems.');
  return r.problems.map((p) => p.message);
}

export function messagesOf(report: { problems: readonly Problem[] }): string[] {
  return report.problems.map((p) => p.message);
}
