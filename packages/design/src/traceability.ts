// AC → test map built from Vitest's JUnit reports: every automatic criterion of an
// implemented increment has at least one test that passed and whose title starts with
// its code. It's based on what actually ran, not on test text: a comment, a
// string, a `describe`, or a skipped or failed test don't count. This is the provisional
// version of the AC → check → test map from Pillar 2 (plan §6).

import type { RecordDocument } from './types.ts';

export type CaseResult = 'passed' | 'failed' | 'skipped';

/** A JUnit report's `testcase`: file (classname), full name and result. */
export type JUnitCase = { file: string; name: string; result: CaseResult };

export type TraceabilityMap = {
  /** AC code → passed tests that cite it, as "file > name". */
  testsByAc: Map<string, Set<string>>;
  withoutTest: { record: string; ac: string }[];
  unknown: { file: string; test: string; ac: string }[];
};

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes XML entities in a single pass (so "&amp;lt;" becomes "&lt;"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (match, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name] ?? match;
  });
}

const RE_TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const RE_ATTRIBUTE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

function attributes(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of text.matchAll(RE_ATTRIBUTE)) map.set(m[1] ?? '', decodeEntities(m[2] ?? ''));
  return map;
}

/**
 * A report is complete if it closes `<testsuites>`: Vitest opens the file at the start and only
 * writes the report when it finishes, so an interrupted run leaves an empty file.
 */
export function completeReport(xml: string): boolean {
  return /<testsuites\b[\s\S]*<\/testsuites>\s*$/.test(xml);
}

/** Reads the `testcase` entries of a JUnit report as Vitest writes them (simple XML, no CDATA). */
export function casesFromJUnit(xml: string): JUnitCase[] {
  const cases: JUnitCase[] = [];
  for (const m of xml.matchAll(RE_TESTCASE)) {
    const attrs = attributes(m[1] ?? '');
    const body = m[2] ?? '';
    let result: CaseResult = 'passed';
    if (/<(?:failure|error)\b/.test(body)) result = 'failed';
    else if (/<skipped\b/.test(body)) result = 'skipped';
    cases.push({ file: attrs.get('classname') ?? attrs.get('file') ?? '', name: attrs.get('name') ?? '', result });
  }
  return cases;
}

/** A test's own title: Vitest prefixes the `describe` blocks separated by " > ". */
export function ownTitle(name: string): string {
  const i = name.lastIndexOf(' > ');
  return i < 0 ? name : name.slice(i + 3);
}

const RE_INITIAL_CODES = /^AC-[A-Z]{3}-\d{3}-\d{2}(?:\s+AC-[A-Z]{3}-\d{3}-\d{2})*(?=\s|$)/;

/** AC codes that a test's own title starts with (one or several in a row). */
export function citedCodes(name: string): string[] {
  const m = RE_INITIAL_CODES.exec(ownTitle(name).trimStart());
  return m ? m[0].split(/\s+/) : [];
}

export function traceabilityMap(
  records: readonly RecordDocument[],
  cases: readonly JUnitCase[],
  implementedIncrements: readonly string[],
): TraceabilityMap {
  const testsByAc = new Map<string, Set<string>>();
  const known = new Set(records.flatMap((r) => r.criteria.map((c) => c.code)));
  const unknown: TraceabilityMap['unknown'] = [];
  for (const sample of cases) {
    if (sample.result !== 'passed') continue;
    for (const ac of citedCodes(sample.name)) {
      if (!known.has(ac)) {
        unknown.push({ file: sample.file, test: sample.name, ac });
        continue;
      }
      const s = testsByAc.get(ac) ?? new Set<string>();
      s.add(`${sample.file} > ${sample.name}`);
      testsByAc.set(ac, s);
    }
  }
  const withoutTest: TraceabilityMap['withoutTest'] = [];
  for (const r of records) {
    if (!r.increment || !implementedIncrements.includes(r.increment)) continue;
    for (const c of r.criteria) {
      if (c.verification === 'automatic' && !testsByAc.has(c.code)) withoutTest.push({ record: r.code, ac: c.code });
    }
  }
  return { testsByAc, withoutTest, unknown };
}
