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

// Text generated from loose words: no Markdown marks that would change the structure.
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
    annexes: fc.uniqueArray(fc.constantFrom('data/one.yaml', 'data/two-three.yaml'), { maxLength: 2 }),
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

// Reference ADR in canonical form; the error cases start from its text.
const BASE = renderDocument(record('adr', 'ADR-TST-001'));
const read = (text: string) => parseDocument(text, 'adr/ADR-TST-001.md');

describe('canonical form of a document', () => {
  it('AC-FMT-001-01 a canonical document is rewritten with the same bytes', () => {
    const doc = record('fdr', 'FDR-TST-001', {
      increment: 'S1',
      links: [{ type: 'based_on', target: { code: 'DEC-TST-001', version: 1 } }],
      annexes: ['data/table.yaml'],
    });
    const text = renderDocument(doc);
    const parsed = value(parseDocument(text, 'fdr/FDR-TST-001.md'));
    expect(parsed).toEqual(doc);
    expect(renderDocument(parsed)).toBe(text);
  });

  it('AC-FMT-001-01 parsing and rendering are inverse for any record', () => {
    fc.assert(
      fc.property(arbitraryRecord, (doc) => {
        const text = renderDocument(doc);
        const parsed = value(parseDocument(text, 'x.md'));
        expect(parsed).toEqual(doc);
        expect(renderDocument(parsed)).toBe(text);
      }),
    );
  });

  it('AC-FMT-001-01 a canonical taxonomy is rewritten with the same bytes', () => {
    const text = renderDocument(taxonomy('TAX-001'));
    expect(renderDocument(value(parseDocument(text, 'taxonomy/TAX-001.md')))).toBe(text);
  });

  const rejected = [
    { sample: 'CRLF line endings', change: (t: string) => t.replaceAll('\n', '\r\n'), error: /CRLF/ },
    {
      sample: 'trailing spaces on a line',
      change: (t: string) => t.replace('Text for context.', 'Text for context.  '),
      error: /ends with spaces/,
    },
    {
      sample: 'a blank line with spaces',
      change: (t: string) => t.replace('\n\n## Options', '\n  \n## Options'),
      error: /ends with spaces/,
    },
    { sample: 'an empty section', change: (t: string) => t.replace('Text for options.', ''), error: /"Options" is empty/ },
    {
      sample: 'extra spaces in the title',
      change: (t: string) => t.replace('# ADR-TST-001 · ', '#  ADR-TST-001 · '),
      error: /body's title must be exactly/,
    },
    {
      sample: 'text between the title and the first section',
      change: (t: string) => t.replace('\n\n## Context', '\n\nIntroduction.\n\n## Context'),
      error: /body's title must be exactly/,
    },
    { sample: 'missing frontmatter', change: (t: string) => t.slice(4), error: /Missing frontmatter/ },
    {
      sample: 'a hard space (U+00A0) at the end of a line',
      change: (t: string) => t.replace('Text for context.', 'Text for context. '),
      error: /Line \d+ ends with spaces/,
    },
    {
      sample: 'a tab at the end of a frontmatter line',
      change: (t: string) => t.replace('domain: tests', 'domain: tests\t'),
      error: /Line 7 ends with spaces/,
    },
    {
      sample: 'two blank lines in a row inside a section',
      change: (t: string) => t.replace('Text for context.', 'Text for context.\n\n\nMore context.'),
      error: /The section "Context" has more than one blank line in a row/,
    },
    {
      sample: 'two blank lines in a row inside a criterion',
      change: (t: string) => t.replace('Given something, when it happens,', 'Given something,\n\n\nwhen it happens,'),
      error: /The section "Acceptance criteria" has more than one blank line in a row/,
    },
    {
      sample: 'a repeated section',
      change: (t: string) => t.replace('## Options', '## Context\n\nAgain.\n\n## Options'),
      error: /The section "Context" is repeated/,
    },
    {
      sample: 'a frontmatter that is not valid YAML',
      change: (t: string) => t.replace('title: Record ADR-TST-001', 'title: [broken'),
      error: /^The frontmatter is not valid YAML: syntax error at line \d+, column \d+ \([A-Z_]+\)\.$/,
    },
  ];

  it.each(rejected)('AC-FMT-001-01 rejects $sample', ({ change, error }) => {
    const text = change(BASE);
    expect(text).not.toBe(BASE);
    expect(failures(read(text))).toContainEqual(expect.stringMatching(error));
  });

  it('AC-FMT-001-01 canonicalizing fixes trailing spaces of any kind, CRLF and extra blank lines', () => {
    const broken = BASE.replace('Text for context.', 'Text for context.  \t\n\n\n \nMore context.')
      .replace('\n\n## Options', '\n\n\n\n## Options')
      .replaceAll('\n', '\r\n');
    expect(read(broken).ok).toBe(false);
    const fixed = normalizeWhitespace(broken);
    expect(renderDocument(value(read(fixed)))).toBe(BASE.replace('Text for context.', 'Text for context.\n\nMore context.'));
  });

  const nonCanonical = [
    {
      sample: 'an extra blank line between sections',
      change: (t: string) => t.replace('\n\n## Options', '\n\n\n## Options'),
    },
    {
      sample: 'the frontmatter in another order',
      change: (t: string) => t.replace('code: ADR-TST-001\ntype: adr\n', 'type: adr\ncode: ADR-TST-001\n'),
    },
    { sample: 'extra spaces in the frontmatter', change: (t: string) => t.replace('version: 1', 'version:   1') },
    {
      sample: 'unnecessary quotes in the frontmatter',
      change: (t: string) => t.replace('domain: tests', "domain: 'tests'"),
    },
    { sample: 'a missing final newline', change: (t: string) => t.slice(0, -1) },
    {
      sample: 'a criterion missing the blank line after its header',
      change: (t: string) => t.replace('criterion\n\n- Verification', 'criterion\n- Verification'),
    },
  ];

  it.each(nonCanonical)('AC-FMT-001-01 detects that it is not canonical: $sample', ({ change }) => {
    const text = change(BASE);
    expect(text).not.toBe(BASE);
    const rewritten = renderDocument(value(read(text)));
    expect(rewritten).not.toBe(text);
    expect(rewritten).toBe(BASE);
  });
});

describe('codes of a document', () => {
  it("AC-FMT-001-02 a record's code matches its type", () => {
    expect(failures(read(BASE.replace('type: adr', 'type: fdr')))).toContainEqual(
      expect.stringMatching(/ADR-TST-001 doesn't match type "fdr"/),
    );
  });

  it('AC-FMT-001-02 codes and references follow their form', () => {
    expect(failures(read(BASE.replace('code: ADR-TST-001', 'code: ADR-TST-1')))).toContainEqual(
      expect.stringMatching(/Frontmatter: code/),
    );
    const withLink = BASE.replace('links: []', 'links:\n  - type: based_on\n    target: DEC-TST-001');
    expect(failures(read(withLink))).toContainEqual(expect.stringMatching(/Reference CODE@version/));
  });

  const withLinks = (...targets: [string, string][]) =>
    BASE.replace(
      'links: []',
      `links:\n${targets.map(([type, d]) => `  - type: ${type}\n    target: ${d}\n`).join('')}`.trimEnd(),
    );

  it.each(['DEC-TST-001@0', 'DEC-TST-001@01', 'TAX-001@1'])('AC-FMT-001-02 rejects the reference %s', (target) => {
    expect(failures(read(withLinks(['based_on', target])))).toContainEqual(expect.stringMatching(/Reference CODE@version/));
  });

  it('AC-FMT-001-02 rejects a repeated link with the same type and target', () => {
    expect(value(read(withLinks(['based_on', 'DEC-TST-001@1'], ['origin', 'DEC-TST-001@1'])))).toMatchObject({
      links: [{ type: 'based_on' }, { type: 'origin' }],
    });
    expect(failures(read(withLinks(['based_on', 'DEC-TST-001@1'], ['based_on', 'DEC-TST-001@1'])))).toEqual([
      'Repeated link: based_on → DEC-TST-001.',
    ]);
    expect(failures(read(withLinks(['based_on', 'DEC-TST-001@1'], ['based_on', 'DEC-TST-001@2'])))).toEqual([
      'Repeated link: based_on → DEC-TST-001.',
    ]);
  });
});

describe('headings with a criterion code', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'AC-FMT-001-03 rejects a level-%i heading that starts with an AC code outside the criteria',
    (level) => {
      const text = BASE.replace(
        'Text for context.',
        `Text for context.\n\n${'#'.repeat(level)} AC-TST-001-09 · Looks like a criterion`,
      );
      expect(failures(read(text))).toContainEqual(
        `The heading "${'#'.repeat(level)} AC-TST-001-09 · Looks like a criterion" starts with a criterion code outside "Acceptance criteria".`,
      );
    },
  );

  it('AC-FMT-001-03 allows a heading that cites an AC code without starting with it', () => {
    const text = BASE.replace('Text for context.', 'Text for context.\n\n### Note about AC-TST-001-01');
    expect(value(read(text)).sections[0]?.content).toBe('Text for context.\n\n### Note about AC-TST-001-01');
  });
});

describe('criteria of a document', () => {
  it('AC-FMT-001-03 reads a criterion with verification, check, derivation and statement', () => {
    const c = criterion('AC-TST-001-02', {
      title: 'Manual criterion',
      verification: 'manual',
      check: 'A person reviews it.',
      derivedFrom: 'AC-OTR-001-01',
      statement: 'Given something,\nwhen it happens,\nthen it is seen.\n\nAnd it is seen twice.',
    });
    const doc = record('adr', 'ADR-TST-001', { criteria: [criterion('AC-TST-001-01'), c] });
    expect(value(parseDocument(renderDocument(doc), 'adr/ADR-TST-001.md'))).toEqual(doc);
  });

  const invalid = [
    {
      sample: 'a verification that is neither automatic nor manual',
      change: (t: string) => t.replace('- Verification: automatic', '- Verification: sometimes'),
      error: /verification must be "automatic" or "manual"/,
    },
    {
      sample: 'a criterion without verification',
      change: (t: string) => t.replace('- Verification: automatic\n', ''),
      error: /missing "- Verification:" and "- Check:"/,
    },
    {
      sample: 'a criterion without a check',
      change: (t: string) => t.replace('\n- Check: Checked with a test.', ''),
      error: /missing "- Verification:" and "- Check:"/,
    },
    {
      sample: 'a criterion without a statement',
      change: (t: string) => t.replace('\n\nGiven something, when it happens, then it is observed.', ''),
      error: /missing the observable statement/,
    },
    {
      sample: 'a header without a valid criterion code',
      change: (t: string) => t.replace('### AC-TST-001-01 · ', '### AC-TST-1 · '),
      error: /Invalid criterion header/,
    },
    {
      sample: 'a derivation that is not a criterion code',
      change: (t: string) => t.replace('a test.\n\nGiven', 'a test.\n- Derived from: nothing\n\nGiven'),
      error: /"Derived from" must be a criterion code/,
    },
    {
      sample: 'text before the first criterion',
      change: (t: string) => t.replace('## Acceptance criteria\n\n', '## Acceptance criteria\n\nIntroduction.\n\n'),
      error: /before the first criterion/,
    },
    {
      sample: 'a section after the criteria',
      change: (t: string) => `${t}\n## Notes\n\nMore text.\n`,
      error: /must be the last section/,
    },
    {
      sample: 'criteria in a taxonomy',
      change: () => `${renderDocument(taxonomy('TAX-001'))}\n## Acceptance criteria\n\n### AC-TAX-001-01 · Nothing\n`,
      error: /A taxonomy has no acceptance criteria/,
    },
  ];

  it.each(invalid)('AC-FMT-001-03 rejects $sample', ({ change, error }) => {
    const text = change(BASE);
    expect(text).not.toBe(BASE);
    expect(failures(read(text))).toContainEqual(expect.stringMatching(error));
  });
});
