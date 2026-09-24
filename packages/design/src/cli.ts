// CLI del formato de diseño.
//   node packages/design/src/cli.ts validar [dir]
//   node packages/design/src/cli.ts canonizar [dir]
//   node packages/design/src/cli.ts derivar --comprobar | --escribir
//   node packages/design/src/cli.ts trazabilidad   (lee reports/junit-*.xml)
//   node packages/design/src/cli.ts estado-ac      (tabla Markdown del estado de cada AC)

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

async function validate(): Promise<number> {
  const report = validateTree(await readTree(DIR));
  if (report.problems.length > 0) {
    for (const p of report.problems) console.error(`✗ ${p.path}: ${p.message}`);
    console.error(`\n${report.problems.length} problema(s) en ${DIR}/.`);
    return 1;
  }
  const acs = report.records.reduce((n, r) => n + r.criteria.length, 0);
  console.log(
    `✓ ${DIR}/ válido: ${report.records.length} registros, ${acs} criterios, ${report.taxonomies.length} taxonomía(s), ${report.annexes.size} anexo(s).`,
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
      // En un anexo solo se arreglan los finales de línea y los espacios finales.
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
  console.log(`Reescritos ${n} archivo(s) y README.md.`);
  return code;
}

async function derive(): Promise<number> {
  const cap = await readFile(join(DIR, 'data', 'capabilities.yaml'), 'utf8');
  const trans = await readFile(join(DIR, 'data', 'transitions.yaml'), 'utf8');
  const generated = generateTablesModule(cap, trans);
  if (args.includes('--write')) {
    await writeFile(TABLES_MODULE_PATH, generated, 'utf8');
    console.log(`Escrito ${TABLES_MODULE_PATH}.`);
    return 0;
  }
  const cursor = await readFile(TABLES_MODULE_PATH, 'utf8').catch(() => '');
  if (cursor !== generated) {
    console.error(`✗ ${TABLES_MODULE_PATH} no coincide con design/data/. Ejecuta «pnpm gen».`);
    return 1;
  }
  console.log('✓ Las tablas del dominio coinciden con design/data/.');
  return 0;
}

const REPORTS_DIR = 'reports';

/** Lee todos los `reports/junit-*.xml`: cada etapa de pruebas escribe el suyo. */
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
    console.error(`✗ ${DIR}/ no es válido: ejecuta antes «pnpm gate:design».`);
    return 1;
  }
  const reports = await junitReports();
  if (reports.size === 0) {
    console.error(
      `✗ No hay informes JUnit en ${REPORTS_DIR}/ (junit-*.xml): ejecuta antes pnpm gate:test y pnpm gate:invariantes.`,
    );
    return 1;
  }
  const incomplete = [...reports].filter(([, xml]) => !completeReport(xml)).map(([path]) => path);
  if (incomplete.length > 0) {
    for (const path of incomplete) console.error(`✗ ${path} está vacío o incompleto: vuelve a ejecutar sus pruebas.`);
    return 1;
  }
  const cases = [...reports.values()].flatMap(casesFromJUnit);
  const root = JSON.parse(await readFile('package.json', 'utf8')) as { demiurgo?: { implementedIncrements?: string[] } };
  const implemented = root.demiurgo?.implementedIncrements ?? [];
  const map = traceabilityMap(report.records, cases, implemented);
  const passed = cases.filter((c) => c.result === 'passed').length;
  console.log(`Informes leídos: ${[...reports.keys()].join(', ')} (${cases.length} pruebas, ${passed} pasadas).`);
  let code = 0;
  for (const d of map.unknown) {
    console.error(`✗ ${d.file}: la prueba «${d.test}» cita ${d.ac}, que no existe en ${DIR}/.`);
    code = 1;
  }
  for (const s of map.withoutTest) {
    console.error(`✗ ${s.ac} (${s.record}): criterio automático sin ninguna prueba pasada que empiece por su código.`);
    code = 1;
  }
  if (code === 0) {
    console.log(
      `✓ Trazabilidad AC → prueba completa para ${implemented.join(', ') || '(ningún incremento)'}: ${map.testsByAc.size} criterios con prueba pasada.`,
    );
  }
  return code;
}

/** Tabla Markdown con el estado de cada AC: verde, rojo, manual o no implementado. */
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
  const rows = ['| AC | Registro | Título | Verificación | Estado | Pruebas |', '|---|---|---|---|---|---|'];
  for (const r of report.records) {
    for (const c of r.criteria) {
      const e = byAc.get(c.code) ?? { passed: 0, failed: 0 };
      let state: string;
      if (c.verification === 'manual') state = 'manual';
      else if (!r.increment || !implemented.includes(r.increment)) state = 'no implementado';
      else if (e.failed > 0) state = 'red';
      else if (e.passed > 0) state = 'green';
      else state = 'rojo (sin prueba)';
      rows.push(
        `| ${c.code} | ${r.code} | ${c.title.replaceAll('|', '/')} | ${c.verification} | ${state} | ${e.passed} pasadas${e.failed ? `, ${e.failed} fallidas` : ''} |`,
      );
    }
  }
  console.log(rows.join(String.fromCharCode(10)));
  return 0;
}

const commands: Record<string, () => Promise<number>> = { validate, canonicalize, derive, traceability, 'ac-status': acStatus };
const action = command ? commands[command] : undefined;
if (!action) {
  console.error('Uso: cli.ts validar|canonizar|derivar|trazabilidad|estado-ac [dir] [--comprobar|--escribir]');
  process.exitCode = 2;
} else {
  process.exitCode = await action();
}
