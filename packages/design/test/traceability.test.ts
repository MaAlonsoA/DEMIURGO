import { describe, expect, it } from 'vitest';
import {
  type JUnitCase,
  casesFromJUnit,
  citedCodes,
  decodeEntities,
  completeReport,
  traceabilityMap,
  ownTitle,
} from '../src/traceability.ts';
import { criterion, record } from './support.ts';

// Sample JUnit report shaped the way Vitest writes it: each `testcase` name is prefixed
// by its `describe` blocks separated by " > ".
const escape = (t: string) =>
  t.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

type Example = { name: string; file?: string; body?: string };

function junit(cases: readonly Example[]): string {
  const lines = cases.map(
    ({ name, file = 'packages/x/test/a.test.ts', body = '' }) =>
      `        <testcase classname="${escape(file)}" name="${escape(name)}" time="0.01">\n${body}        </testcase>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    `<testsuites name="vitest tests" tests="${cases.length}" failures="0" errors="0" time="0.1">`,
    '    <testsuite name="packages/x/test/a.test.ts" tests="1" failures="0" errors="0" skipped="0" time="0.1">',
    ...lines,
    '    </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

const FAILURE = '            <failure message="expected 1 to be 2" type="AssertionError">\n            </failure>\n';
const ERROR = '            <error message="it broke" type="Error"/>\n';
const SKIPPED = '            <skipped/>\n';

const ADR = record('adr', 'ADR-TST-001', {
  increment: 'D0',
  criteria: [criterion('AC-TST-001-01'), criterion('AC-TST-001-02'), criterion('AC-TST-001-03', { verification: 'manual' })],
});

const mapOf = (cases: readonly Example[], increments: readonly string[] = ['D0']) =>
  traceabilityMap([ADR], casesFromJUnit(junit(cases)), increments);

describe('reading JUnit reports', () => {
  it('AC-FMT-001-05 reads each testcase with its file, its full name and whether it passed, failed or was skipped', () => {
    const xml = junit([
      { name: 'block > AC-TST-001-01 passes' },
      { name: 'block > AC-TST-001-01 fails', body: FAILURE },
      { name: 'block > AC-TST-001-01 errors', body: ERROR },
      { name: 'block > AC-TST-001-01 skipped', body: SKIPPED },
      { name: 'AC-TST-001-02 with <, >, & and "double" \'single\' quotes', file: 'packages/y/test/b.test.ts' },
    ]);
    const cases: JUnitCase[] = casesFromJUnit(`${xml}<testcase classname="c.test.ts" name="selfClosed"/>\n`);
    expect(cases).toEqual([
      { file: 'packages/x/test/a.test.ts', name: 'block > AC-TST-001-01 passes', result: 'passed' },
      { file: 'packages/x/test/a.test.ts', name: 'block > AC-TST-001-01 fails', result: 'failed' },
      { file: 'packages/x/test/a.test.ts', name: 'block > AC-TST-001-01 errors', result: 'failed' },
      { file: 'packages/x/test/a.test.ts', name: 'block > AC-TST-001-01 skipped', result: 'skipped' },
      { file: 'packages/y/test/b.test.ts', name: 'AC-TST-001-02 with <, >, & and "double" \'single\' quotes', result: 'passed' },
      { file: 'c.test.ts', name: 'selfClosed', result: 'passed' },
    ]);
  });

  it('AC-FMT-001-05 an empty or truncated report is not complete', () => {
    const xml = junit([{ name: 'AC-TST-001-01 passes' }]);
    expect(completeReport(xml)).toBe(true);
    expect(completeReport('')).toBe(false);
    expect(completeReport(xml.slice(0, xml.indexOf('</testsuites>')))).toBe(false);
  });

  it('AC-FMT-001-05 decodes XML entities only once', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#241; &#xE9;')).toBe(`a & b <c> "d" 'e' ñ é`);
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });

  it('AC-FMT-001-05 the own title is the last segment of the name and cites the codes it starts with', () => {
    expect(ownTitle('one > two > AC-TST-001-01 three')).toBe('AC-TST-001-01 three');
    expect(ownTitle('without blocks')).toBe('without blocks');
    expect(citedCodes('block > AC-TST-001-01 AC-TST-001-02 text')).toEqual(['AC-TST-001-01', 'AC-TST-001-02']);
    expect(citedCodes('AC-TST-001-01')).toEqual(['AC-TST-001-01']);
    expect(citedCodes('block > text with AC-TST-001-01 in the middle')).toEqual([]);
    expect(citedCodes('AC-TST-001-01 > text without a code')).toEqual([]);
    expect(citedCodes('AC-TST-001-01x glued on')).toEqual([]);
    expect(citedCodes('AC-TST-001-01 and AC-TST-001-02')).toEqual(['AC-TST-001-01']);
  });
});

describe('AC → test traceability', () => {
  it('AC-FMT-001-05 an automatic criterion of an implemented increment needs a passed test', () => {
    const withoutTests = traceabilityMap([ADR], [], ['D0']);
    expect(withoutTests.withoutTest).toEqual([
      { record: 'ADR-TST-001', ac: 'AC-TST-001-01' },
      { record: 'ADR-TST-001', ac: 'AC-TST-001-02' },
    ]);

    const map = mapOf([{ name: 'block > AC-TST-001-01 AC-TST-001-02 satisfies both' }]);
    expect(map.withoutTest).toEqual([]);
    expect(map.unknown).toEqual([]);
    expect(map.testsByAc.get('AC-TST-001-01')).toEqual(
      new Set(['packages/x/test/a.test.ts > block > AC-TST-001-01 AC-TST-001-02 satisfies both']),
    );
  });

  it('AC-FMT-001-05 a failed, errored or skipped test does not count', () => {
    const map = mapOf([
      { name: 'AC-TST-001-01 fails', body: FAILURE },
      { name: 'AC-TST-001-01 errors', body: ERROR },
      { name: 'AC-TST-001-02 skipped', body: SKIPPED },
    ]);
    expect(map.testsByAc.size).toBe(0);
    expect(map.withoutTest.map((s) => s.ac)).toEqual(['AC-TST-001-01', 'AC-TST-001-02']);
  });

  it('AC-FMT-001-05 only counts the code at the start of the own title, not in the middle nor in a describe', () => {
    const map = mapOf([
      { name: 'block > satisfies AC-TST-001-01 in the middle' },
      { name: 'AC-TST-001-02 describe > test without a code' },
      { name: 'block > AC-TST-001-02 at the start' },
    ]);
    expect([...map.testsByAc.keys()]).toEqual(['AC-TST-001-02']);
    expect(map.withoutTest).toEqual([{ record: 'ADR-TST-001', ac: 'AC-TST-001-01' }]);
  });

  it('AC-FMT-001-05 a passed test that cites a nonexistent code is flagged; not if it failed or the code is in the middle', () => {
    const map = mapOf([
      { name: 'AC-TST-001-01 AC-TST-001-02 passes' },
      { name: 'block > AC-ZZZ-999-99 does not exist', file: 'b.test.ts' },
      { name: 'AC-ZZZ-999-98 does not exist and fails', body: FAILURE },
      { name: 'cites AC-ZZZ-999-97 in the middle' },
    ]);
    expect(map.unknown).toEqual([{ file: 'b.test.ts', test: 'block > AC-ZZZ-999-99 does not exist', ac: 'AC-ZZZ-999-99' }]);
    expect(map.withoutTest).toEqual([]);
  });

  it('AC-FMT-001-05 only requires a test for automatic criteria of implemented increments', () => {
    const records = [
      ADR,
      record('fdr', 'FDR-OTR-001', { increment: 'S1' }),
      record('decision', 'DEC-TST-001', { criteria: [criterion('AC-TST-001-09')] }),
    ];
    const cases = casesFromJUnit(junit([{ name: 'AC-TST-001-01 AC-TST-001-02 passes' }]));
    expect(traceabilityMap(records, cases, ['D0']).withoutTest).toEqual([]);
    expect(traceabilityMap(records, cases, ['D0', 'S1']).withoutTest).toEqual([{ record: 'FDR-OTR-001', ac: 'AC-OTR-001-01' }]);
  });
});
