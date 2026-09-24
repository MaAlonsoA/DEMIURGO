// Design format CLI.
//   node packages/design/src/cli.ts validate [dir]
//   node packages/design/src/cli.ts canonicalize [dir]
//   node packages/design/src/cli.ts derive --check | --write
//   node packages/design/src/cli.ts traceability   (reads reports/junit-*.xml)
//   node packages/design/src/cli.ts ac-status      (Markdown table of each AC's status)

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateTree } from './tree.ts';
import { TABLES_MODULE_PATH, generateTablesModule } from './derive.ts';
import { readTree } from './disk.ts';
import { normalizeWhitespace, parseDocument, renderDocument } from './format.ts';
import { README_DESIGN } from './readme.ts';
import { casesFromJUnit, citedCodes, completeReport, traceabilityMap } from './traceability.ts';

const [command, ...args] = process.argv.slice(2);
const DIR = args.find((a) => !a.startsWith('--')) ?? 'design';

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

async function validate(): Promise<number> {
  const report = validateTree(await readTree(DIR));
  if (report.problems.length > 0) {
    for (const p of report.problems) console.error(`✗ ${p.path}: ${p.message}`);
    console.error(`\n${report.problems.length} problem(s) in ${DIR}/.`);
    return 1;
  }
  const acs = report.records.reduce((n, r) => n + r.criteria.length, 0);
  console.log(
    `✓ ${DIR}/ is valid: ${count(report.records.length, 'record', 'records')}, ${count(acs, 'criterion', 'criteria')}, ${count(report.taxonomies.length, 'taxonomy', 'taxonomies')}, ${count(report.annexes.size, 'annex', 'annexes')}.`,
  );
  return 0;
}

async function canonicalize(): Promise<number> {
  const tree = await readTree(DIR);
  let n = 0;
  let code = 0;
  for (const [path, text] of tree) {
    let canonical: string;
    if (path.endsWith('.yaml')) {
      // In an annex, only fix line endings and trailing whitespace.
      canonical = text.replaceAll('\r\n', '\n').replace(/[^\S\n]+$/gm, '');
    } else if (path.endsWith('.md') && path !== 'README.md') {
      const r = parseDocument(normalizeWhitespace(text), path);
      if (!r.ok) {
        for (const p of r.problems) console.error(`✗ ${p.path}: ${p.message}`);
        code = 1;
        continue;
      }
      canonical = renderDocument(r.value);
    } else {
      continue;
    }
    if (canonical !== text) {
      await writeFile(join(DIR, ...path.split('/')), canonical, 'utf8');
      n++;
    }
  }
  await writeFile(join(DIR, 'README.md'), README_DESIGN, 'utf8');
  console.log(`Rewrote ${n} file(s) and README.md.`);
  return code;
}

async function derive(): Promise<number> {
  const cap = await readFile(join(DIR, 'data', 'capabilities.yaml'), 'utf8');
  const trans = await readFile(join(DIR, 'data', 'transitions.yaml'), 'utf8');
  const generated = generateTablesModule(cap, trans);
  if (args.includes('--write')) {
    await writeFile(TABLES_MODULE_PATH, generated, 'utf8');
    console.log(`Wrote ${TABLES_MODULE_PATH}.`);
    return 0;
  }
  const current = await readFile(TABLES_MODULE_PATH, 'utf8').catch(() => '');
  if (current !== generated) {
    console.error(`✗ ${TABLES_MODULE_PATH} doesn't match design/data/. Run "pnpm gen".`);
    return 1;
  }
  console.log('✓ Domain tables match design/data/.');
  return 0;
}

const REPORTS_DIR = 'reports';

/** Reads all `reports/junit-*.xml` files: each test stage writes its own. */
async function junitReports(): Promise<Map<string, string>> {
  const reports = new Map<string, string>();
  const names = await readdir(REPORTS_DIR).catch(() => [] as string[]);
  for (const name of names.filter((n) => /^junit-.+\.xml$/.test(n)).sort()) {
    reports.set(`${REPORTS_DIR}/${name}`, await readFile(join(REPORTS_DIR, name), 'utf8'));
  }
  return reports;
}

async function traceability(): Promise<number> {
  const report = validateTree(await readTree(DIR));
  if (report.problems.length > 0) {
    console.error(`✗ ${DIR}/ is not valid: run "pnpm gate:design" first.`);
    return 1;
  }
  const reports = await junitReports();
  if (reports.size === 0) {
    console.error(
      `✗ No JUnit reports found in ${REPORTS_DIR}/ (junit-*.xml): run pnpm gate:test and pnpm gate:invariants first.`,
    );
    return 1;
  }
  const incomplete = [...reports].filter(([, xml]) => !completeReport(xml)).map(([path]) => path);
  if (incomplete.length > 0) {
    for (const path of incomplete) console.error(`✗ ${path} is empty or incomplete: re-run its tests.`);
    return 1;
  }
  const cases = [...reports.values()].flatMap(casesFromJUnit);
  const root = JSON.parse(await readFile('package.json', 'utf8')) as { demiurgo?: { implementedIncrements?: string[] } };
  const implemented = root.demiurgo?.implementedIncrements ?? [];
  const map = traceabilityMap(report.records, cases, implemented);
  const passed = cases.filter((c) => c.result === 'passed').length;
  console.log(`Reports read: ${[...reports.keys()].join(', ')} (${cases.length} tests, ${passed} passed).`);
  let code = 0;
  for (const d of map.unknown) {
    console.error(`✗ ${d.file}: test "${d.test}" cites ${d.ac}, which doesn't exist in ${DIR}/.`);
    code = 1;
  }
  for (const s of map.withoutTest) {
    console.error(`✗ ${s.ac} (${s.record}): automatic criterion with no passed test whose title starts with its code.`);
    code = 1;
  }
  if (code === 0) {
    console.log(
      `✓ AC → test traceability complete for ${implemented.join(', ') || '(no increments)'}: ${map.testsByAc.size} criteria with a passed test.`,
    );
  }
  return code;
}

/** Markdown table with each AC's status: green, red, manual or not implemented. */
async function acStatus(): Promise<number> {
  const report = validateTree(await readTree(DIR));
  const cases = [...(await junitReports()).values()].flatMap(casesFromJUnit);
  const root = JSON.parse(await readFile('package.json', 'utf8')) as { demiurgo?: { implementedIncrements?: string[] } };
  const implemented = root.demiurgo?.implementedIncrements ?? [];
  const byAc = new Map<string, { passed: number; failed: number }>();
  for (const c of cases) {
    for (const ac of citedCodes(c.name)) {
      const e = byAc.get(ac) ?? { passed: 0, failed: 0 };
      if (c.result === 'passed') e.passed++;
      if (c.result === 'failed') e.failed++;
      byAc.set(ac, e);
    }
  }
  const rows = ['| AC | Record | Title | Verification | Status | Tests |', '|---|---|---|---|---|---|'];
  for (const r of report.records) {
    for (const c of r.criteria) {
      const e = byAc.get(c.code) ?? { passed: 0, failed: 0 };
      let state: string;
      if (c.verification === 'manual') state = 'manual';
      else if (!r.increment || !implemented.includes(r.increment)) state = 'not implemented';
      else if (e.failed > 0) state = 'red';
      else if (e.passed > 0) state = 'green';
      else state = 'red (no test)';
      rows.push(
        `| ${c.code} | ${r.code} | ${c.title.replaceAll('|', '/')} | ${c.verification} | ${state} | ${e.passed} passed${e.failed ? `, ${e.failed} failed` : ''} |`,
      );
    }
  }
  console.log(rows.join(String.fromCharCode(10)));
  return 0;
}

const commands: Record<string, () => Promise<number>> = { validate, canonicalize, derive, traceability, 'ac-status': acStatus };
const action = command ? commands[command] : undefined;
if (!action) {
  console.error('Usage: cli.ts validate|canonicalize|derive|traceability|ac-status [dir] [--check|--write]');
  process.exitCode = 2;
} else {
  process.exitCode = await action();
}
