// Mapa AC → prueba a partir de los informes JUnit de Vitest: cada criterio automático de un
// incremento implementado tiene al menos una prueba que pasó y cuyo título empieza por su
// código. Se basa en lo que se ejecutó, no en el texto de las pruebas: un comentario, una
// cadena, un `describe` o una prueba saltada o fallida no cuentan. Es la versión provisional
// del mapa AC → comprobación → prueba del Pilar 2 (§6 del plan).

import type { RecordDocument } from './types.ts';

export type CaseResult = 'passed' | 'failed' | 'skipped';

/** Un `testcase` de un informe JUnit: archivo (classname), nombre completo y resultado. */
export type JUnitCase = { file: string; name: string; result: CaseResult };

export type TraceabilityMap = {
  /** Código de AC → pruebas que pasaron y lo citan, como «archivo > nombre». */
  testsByAc: Map<string, Set<string>>;
  withoutTest: { record: string; ac: string }[];
  unknown: { file: string; test: string; ac: string }[];
};

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodifica las entidades de XML en una sola pasada (así «&amp;lt;» queda «&lt;»). */
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
 * Un informe está completo si cierra `<testsuites>`: Vitest abre el archivo al empezar y solo
 * escribe el informe al terminar, así que una ejecución cortada deja un archivo vacío.
 */
export function completeReport(xml: string): boolean {
  return /<testsuites\b[\s\S]*<\/testsuites>\s*$/.test(xml);
}

/** Lee los `testcase` de un informe JUnit como el que escribe Vitest (XML simple, sin CDATA). */
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

/** Título propio de una prueba: Vitest antepone los `describe` separados por « > ». */
export function ownTitle(name: string): string {
  const i = name.lastIndexOf(' > ');
  return i < 0 ? name : name.slice(i + 3);
}

const RE_INITIAL_CODES = /^AC-[A-Z]{3}-\d{3}-\d{2}(?:\s+AC-[A-Z]{3}-\d{3}-\d{2})*(?=\s|$)/;

/** Códigos de AC con los que empieza el título propio de una prueba (uno o varios seguidos). */
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
      if (c.verification === 'automática' && !testsByAc.has(c.code)) withoutTest.push({ record: r.code, ac: c.code });
    }
  }
  return { testsByAc, withoutTest, unknown };
}
