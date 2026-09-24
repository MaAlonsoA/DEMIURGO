import { describe, expect, it } from 'vitest';
import { validateTree } from '../src/tree.ts';
import { renderDocument } from '../src/format.ts';
import type { RecordType } from '../src/types.ts';
import { treeWith, criterion, messagesOf, record, pathOf, taxonomy } from './support.ts';

const DECISION = record('decision', 'DEC-BAS-001');
const ADR = record('adr', 'ADR-TST-001', { links: [{ type: 'based_on', target: { code: 'DEC-BAS-001', version: 1 } }] });
const TABLE = 'code: DAT-TST-001\nrows: []\n';

const problems = (tree: ReadonlyMap<string, string>) => messagesOf(validateTree(tree));

/** ADR that links to the given version of DEC-BAS-001. */
const linkTo = (version: number) =>
  record('adr', 'ADR-TST-001', { links: [{ type: 'design_of', target: { code: 'DEC-BAS-001', version } }] });

/** ADR with a criterion that derives from the given code. */
const derivedFrom = (code: string) =>
  record('adr', 'ADR-TST-001', { criteria: [criterion('AC-TST-001-01', { derivedFrom: code })] });

describe('canonical form of the tree', () => {
  it('AC-FMT-001-01 a canonical, consistent tree has no problems', () => {
    const report = validateTree(treeWith([DECISION, ADR, taxonomy('TAX-001')]));
    expect(messagesOf(report)).toEqual([]);
    expect(report.records.map((r) => r.code)).toEqual(['ADR-TST-001', 'DEC-BAS-001']);
    expect(report.taxonomies.map((t) => t.code)).toEqual(['TAX-001']);
  });

  it('AC-FMT-001-01 rejects a document that is not in canonical form', () => {
    const tree = treeWith([DECISION]);
    const path = pathOf(DECISION);
    tree.set(path, (tree.get(path) ?? '').replace('\n\n## Decision', '\n\n\n## Decision'));
    expect(problems(tree)).toEqual([expect.stringMatching(/Not in canonical format/)]);
  });

  it('AC-FMT-001-01 rejects a document with CRLF or trailing spaces', () => {
    const path = pathOf(DECISION);
    const withCrlf = treeWith([DECISION]);
    withCrlf.set(path, (withCrlf.get(path) ?? '').replaceAll('\n', '\r\n'));
    expect(problems(withCrlf)).toEqual([expect.stringMatching(/CRLF/)]);
    const withSpaces = treeWith([DECISION]);
    withSpaces.set(path, (withSpaces.get(path) ?? '').replace('Text for context.', 'Text for context. '));
    expect(problems(withSpaces)).toEqual([expect.stringMatching(/ends with spaces/)]);
  });

  it('AC-FMT-001-01 rejects a README that differs from the fixed text', () => {
    const tree = treeWith([DECISION]);
    tree.set('README.md', `${tree.get('README.md') ?? ''}\nNote added by hand.\n`);
    expect(problems(tree)).toEqual([expect.stringMatching(/README\.md doesn't match the fixed text/)]);
    tree.delete('README.md');
    expect(problems(tree)).toEqual(['README.md is missing.']);
  });

  it('rejects files outside the structure and documents in another folder', () => {
    const tree = treeWith([DECISION], {
      'notes.md': 'Loose notes.\n',
      'other/DEC-TST-002.md': renderDocument(record('decision', 'DEC-TST-002')),
      'adr/DEC-TST-003.md': renderDocument(record('decision', 'DEC-TST-003')),
      'data/table.txt': 'text\n',
    });
    const messages = problems(tree);
    expect(messages.filter((m) => m === 'File outside the design/ structure.')).toHaveLength(2);
    expect(messages).toContain('A "decision" document doesn\'t belong in adr/.');
    expect(messages).toContain('Only .yaml files belong in data/.');
  });
});

describe('codes, links and annexes', () => {
  it('AC-FMT-001-02 rejects duplicate record codes', () => {
    const tree = treeWith([DECISION, ADR], { 'adr/ADR-TST-002.md': renderDocument(ADR) });
    const messages = problems(tree);
    expect(messages).toContain('Duplicate record code: ADR-TST-001.');
    expect(messages).toContain('The file must be named ADR-TST-001.md.');
  });

  it('AC-FMT-001-02 rejects duplicate taxonomy codes', () => {
    const tree = treeWith([taxonomy('TAX-001')], { 'taxonomy/TAX-002.md': renderDocument(taxonomy('TAX-001')) });
    expect(problems(tree)).toContain('Duplicate taxonomy code: TAX-001.');
  });

  it('AC-FMT-001-02 rejects duplicate criterion codes', () => {
    const adr = record('adr', 'ADR-TST-001', { criteria: [criterion('AC-TST-001-01'), criterion('AC-TST-001-01')] });
    expect(problems(treeWith([adr]))).toEqual([expect.stringMatching(/Duplicate criterion code: AC-TST-001-01/)]);
  });

  it('AC-FMT-001-02 a link points to an existing record', () => {
    const adr = record('adr', 'ADR-TST-001', {
      links: [{ type: 'based_on', target: { code: 'DEC-NOE-001', version: 1 } }],
    });
    expect(problems(treeWith([DECISION, adr]))).toEqual(["The based_on link points to DEC-NOE-001, which doesn't exist."]);
  });

  it("AC-FMT-001-02 a link points to its target's version in design/ or an earlier one, never a later one", () => {
    expect(problems(treeWith([DECISION, linkTo(2)]))).toEqual([
      'The design_of link points to DEC-BAS-001@2, later than version 1 in design/.',
    ]);
    const second = record('decision', 'DEC-BAS-001', { version: 2, changeNote: 'Clarifies the context.' });
    expect(problems(treeWith([second, linkTo(2)]))).toEqual([]);
    // A link kept after review still points to version 1: import checks that v2 already has it.
    expect(problems(treeWith([second, linkTo(1)]))).toEqual([]);
  });

  it('AC-FMT-001-01 a document is only proposed or approved: design/ keeps the current version', () => {
    const text = renderDocument(DECISION).replace('state: proposed', 'state: superseded');
    const tree = new Map(treeWith([DECISION]));
    tree.set(pathOf(DECISION), text);
    expect(problems(tree).join(' ')).toMatch(/state/);
  });

  it("AC-FMT-001-01 texts respect the same length limits as v2, and a taxonomy's title has no extra spaces", () => {
    const adr = record('adr', 'ADR-TST-001', {
      title: 'T'.repeat(201),
      criteria: [criterion('AC-TST-001-01', { statement: `When it happens, then ${'x'.repeat(3000)}` })],
    });
    expect(problems(treeWith([DECISION, adr]))).toEqual([
      'The title exceeds 200 characters.',
      'AC-TST-001-01: the statement exceeds 3000 characters.',
    ]);
    const tax = taxonomy('TAX-001', { title: ' Test taxonomy' });
    expect(problems(treeWith([DECISION, tax]))).toContain('The title starts or ends with whitespace.');
  });

  it("AC-FMT-001-01 titles, the change note and a criterion's texts don't start or end with spaces", () => {
    const adr = record('adr', 'ADR-TST-001', {
      criteria: [criterion('AC-TST-001-01', { statement: '    Indented block: when it happens, then it is observed.' })],
    });
    expect(problems(treeWith([DECISION, adr]))).toEqual(['AC-TST-001-01: the statement starts or ends with whitespace.']);
  });

  it('AC-FMT-001-02 the DOM-NNN part of a code is unique across types', () => {
    const tree = treeWith([record('adr', 'ADR-STK-001'), record('decision', 'DEC-STK-001')]);
    expect(problems(tree)).toEqual([
      'DEC-STK-001 shares STK-001 with ADR-STK-001: the DOM-NNN part of a code is unique across types, because their criteria would share AC-STK-001-NN.',
    ]);
  });

  it('AC-FMT-001-02 a record does not link to itself', () => {
    const adr = record('adr', 'ADR-TST-001', { links: [{ type: 'origin', target: { code: 'ADR-TST-001', version: 1 } }] });
    expect(problems(treeWith([adr]))).toEqual(['A record cannot link to itself.']);
  });

  it('AC-FMT-001-02 an annex exists and belongs to exactly one record', () => {
    const withAnnex = record('adr', 'ADR-TST-001', { annexes: ['data/table.yaml'] });
    expect(problems(treeWith([withAnnex], { 'data/table.yaml': TABLE }))).toEqual([]);

    expect(problems(treeWith([withAnnex]))).toEqual(["Annex data/table.yaml doesn't exist."]);

    const another = record('adr', 'ADR-TST-002', { annexes: ['data/table.yaml'] });
    expect(problems(treeWith([withAnnex, another], { 'data/table.yaml': TABLE }))).toEqual([
      'An annex must belong to exactly one record (currently: 2).',
    ]);

    expect(problems(treeWith([DECISION], { 'data/table.yaml': TABLE }))).toEqual([
      'An annex must belong to exactly one record (currently: 0).',
    ]);
  });

  const withAnnex = record('adr', 'ADR-TST-001', { annexes: ['data/table.yaml'] });

  it.each([
    {
      sample: 'CRLF',
      text: TABLE.replaceAll('\n', '\r\n'),
      message: 'The file uses CRLF line endings; the format requires LF.',
    },
    {
      sample: 'trailing spaces',
      text: 'code: DAT-TST-001 \nrows: []\n',
      message: "Line 1 ends with spaces; the format doesn't allow them.",
    },
    {
      sample: 'a final hard space',
      text: 'code: DAT-TST-001\nrows: [] \n',
      message: "Line 2 ends with spaces; the format doesn't allow them.",
    },
  ])('AC-FMT-001-01 an annex with $sample is rejected', ({ text, message }) => {
    expect(problems(treeWith([withAnnex], { 'data/table.yaml': text }))).toContain(message);
  });

  it('AC-FMT-001-02 an annex that is not valid YAML is reported in plain text, without a stack trace', () => {
    const report = validateTree(treeWith([withAnnex], { 'data/table.yaml': 'code: [DAT-TST-001\nrows: []\n' }));
    expect(report.problems).toEqual([
      {
        path: 'data/table.yaml',
        message: 'The annex is not valid YAML: syntax error at line 2, column 1 (BAD_INDENT).',
      },
    ]);
    const duplicate = validateTree(treeWith([withAnnex], { 'data/table.yaml': 'code: A\ncode: B\n' }));
    expect(messagesOf(duplicate)).toEqual(['The annex is not valid YAML: syntax error at line 2, column 1 (DUPLICATE_KEY).']);
  });
});

describe('verifiable criteria', () => {
  const typesWithCriteria: RecordType[] = ['adr', 'fdr', 'bug'];

  it.each(typesWithCriteria)('AC-FMT-001-03 a record of type %s without criteria is rejected', (type) => {
    const doc = record(type, `${type.toUpperCase()}-TST-001`, { criteria: [] });
    expect(problems(treeWith([doc]))).toEqual(['This record type requires at least one acceptance criterion.']);
  });

  it('AC-FMT-001-03 a decision may have no criteria', () => {
    expect(problems(treeWith([record('decision', 'DEC-BAS-001', { criteria: [] })]))).toEqual([]);
  });

  it("AC-FMT-001-03 a criterion's code starts with its record's", () => {
    const adr = record('adr', 'ADR-TST-001', { criteria: [criterion('AC-OTR-001-01')] });
    expect(problems(treeWith([adr]))).toEqual(['AC-OTR-001-01: a criterion code of ADR-TST-001 must start with AC-TST-001-.']);
  });

  it('AC-FMT-001-03 "Derived from" points to a criterion that exists in design/', () => {
    const origin = record('fdr', 'FDR-ORI-001');
    expect(problems(treeWith([origin, derivedFrom('AC-ORI-001-01')]))).toEqual([]);
    expect(problems(treeWith([origin, derivedFrom('AC-ORI-001-02')]))).toEqual([
      "AC-TST-001-01: derives from AC-ORI-001-02, which doesn't exist in design/.",
    ]);
    expect(problems(treeWith([origin, derivedFrom('AC-TST-001-01')]))).toEqual([
      'AC-TST-001-01: a criterion cannot derive from itself.',
    ]);
  });

  it('requires template sections in order', () => {
    const base = record('adr', 'ADR-TST-001');
    const unordered = record('adr', 'ADR-TST-001', { sections: base.sections.toReversed() });
    expect(problems(treeWith([unordered]))).toEqual([expect.stringMatching(/^Missing template sections/)]);
    const withExtra = record('adr', 'ADR-TST-001', {
      sections: [...base.sections, { title: 'Spike', content: 'Result.' }],
    });
    expect(problems(treeWith([withExtra]))).toEqual([]);
  });

  it('requires a change note from version 2 onward', () => {
    expect(problems(treeWith([record('decision', 'DEC-BAS-001', { version: 2 })]))).toEqual([
      'A version after 1 requires change_note.',
    ]);
  });
});

describe('taxonomies', () => {
  it('AC-FMT-001-04 a taxonomy with "other" on every axis is valid', () => {
    expect(problems(treeWith([taxonomy('TAX-001')]))).toEqual([]);
  });

  it('AC-FMT-001-04 an axis without the "other" category is rejected', () => {
    const tax = taxonomy('TAX-001');
    const withoutOther = taxonomy('TAX-001', {
      axes: [
        ...tax.axes,
        {
          code: 'quality',
          name: 'Quality',
          categories: [
            { code: 'security', name: 'Security', description: 'Authority and isolation.' },
            { code: 'reliability', name: 'Reliability', description: 'Durability.' },
          ],
        },
      ],
    });
    expect(problems(treeWith([withoutOther]))).toEqual(['Axis quality doesn\'t have the "other" category.']);
  });

  it('AC-FMT-001-04 an axis needs at least two categories', () => {
    const onlyOther = taxonomy('TAX-001', {
      axes: [{ code: 'area', name: 'Area', categories: [{ code: 'other', name: 'Other', description: 'Everything.' }] }],
    });
    expect(problems(treeWith([onlyOther]))).toEqual([expect.stringMatching(/^Frontmatter: axes\.0\.categories/)]);
  });

  it('rejects duplicate categories and axes', () => {
    const core = { code: 'core', name: 'Core', description: 'The core of the system.' };
    const other = { code: 'other', name: 'Other', description: 'None fits without forcing it.' };
    const duplicate = taxonomy('TAX-001', {
      axes: [
        { code: 'area', name: 'Area', categories: [core, other, core] },
        { code: 'area', name: 'Area', categories: [core, other] },
      ],
    });
    const messages = problems(treeWith([duplicate]));
    expect(messages).toContain('Duplicate category in area: core.');
    expect(messages).toContain('Duplicate axis: area.');
  });
});
