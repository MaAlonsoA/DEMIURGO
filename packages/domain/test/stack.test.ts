import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFile(join(ROOT, path), 'utf8');

type Dependencies = Readonly<Record<string, string>>;
type PackageJson = {
  packageManager?: string;
  scripts?: Dependencies;
  dependencies?: Dependencies;
  devDependencies?: Dependencies;
  optionalDependencies?: Dependencies;
};

/** package.json de la raíz y de cada paquete del monorepo, por ruta. */
async function packageJsons(): Promise<Map<string, PackageJson>> {
  const map = new Map<string, PackageJson>([['package.json', JSON.parse(await read('package.json')) as PackageJson]]);
  for (const e of await readdir(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const path = `packages/${e.name}/package.json`;
    const text = await read(path).catch(() => null);
    if (text !== null) map.set(path, JSON.parse(text) as PackageJson);
  }
  return map;
}

const RE_EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isExactVersion(version: string): boolean {
  return version === 'workspace:*' || RE_EXACT_VERSION.test(version);
}

function nonExactVersions(pkg: PackageJson): string[] {
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
  return sections.flatMap((s) =>
    Object.entries(pkg[s] ?? {})
      .filter(([, v]) => !isExactVersion(v))
      .map(([name, v]) => `${s}.${name}: ${v}`),
  );
}

/** Defensas de cadena de suministro que faltan o son débiles en un pnpm-workspace.yaml. */
function defenseProblems(yaml: string): string[] {
  const value = (key: string) => new RegExp(`^${key}:[ \\t]*([^\\s#]+)[ \\t]*(?:#.*)?$`, 'm').exec(yaml)?.[1];
  const problems: string[] = [];
  const age = value('minimumReleaseAge');
  if (!(Number(age) >= 4320))
    problems.push(`minimumReleaseAge debe ser de al menos 4320 minutos, 3 días (ahora: ${age ?? 'sin definir'}).`);
  for (const key of ['strictDepBuilds', 'blockExoticSubdeps']) {
    if (value(key) !== 'true') problems.push(`${key} debe estar activo.`);
  }
  if (value('trustPolicy') !== 'no-downgrade') problems.push('trustPolicy debe ser no-downgrade.');
  if (value('saveExact') !== 'true') problems.push('saveExact debe estar activo.');
  return problems;
}

const RE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;

function importsOf(source: string): string[] {
  return [...source.matchAll(RE_IMPORT)].map((m) => m[2] ?? '');
}

const NODE_IO_MODULES = ['fs', 'fs/promises', 'net', 'child_process', 'http', 'https', 'http2', 'dgram', 'dns', 'tls'];

/** Un import es de E/S si es un módulo de Node con red, ficheros o procesos, o un paquete de infraestructura. */
function isIoImport(specifier: string): boolean {
  if (NODE_IO_MODULES.includes(specifier.replace(/^node:/, ''))) return true;
  return /^(?:pg|pg-[a-z-]+|kysely|fastify)(?:\/|$)/.test(specifier) || /^@(?:dbos-inc|fastify)\//.test(specifier);
}

async function domainSources(): Promise<Map<string, string>> {
  const dir = join(ROOT, 'packages', 'domain', 'src');
  const sources = new Map<string, string>();
  for (const path of await readdir(dir, { recursive: true })) {
    if (path.endsWith('.ts')) sources.set(path.replaceAll('\\', '/'), await readFile(join(dir, path), 'utf8'));
  }
  return sources;
}

describe('tipos estrictos', () => {
  it('AC-STK-001-01 tsconfig.json activa strict, noUncheckedIndexedAccess, erasableSyntaxOnly y verbatimModuleSyntax', async () => {
    const tsconfig = JSON.parse(await read('tsconfig.json')) as { compilerOptions: Record<string, unknown>; include: string[] };
    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      erasableSyntaxOnly: true,
      verbatimModuleSyntax: true,
    });
    expect(tsconfig.include).toEqual(expect.arrayContaining(['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts']));
  });

  it('AC-STK-001-01 gate:types comprueba los tipos sin emitir y forma parte de gate:all', async () => {
    const root = JSON.parse(await read('package.json')) as PackageJson;
    expect(root.scripts?.['gate:types']).toMatch(/^tsc\b.*--noEmit\b/);
    expect(root.scripts?.['gate:all']).toContain('pnpm gate:types');
  });
});

describe('versiones exactas', () => {
  it('AC-STK-001-02 toda dependencia directa de cada package.json está fijada a una versión exacta', async () => {
    const packages = await packageJsons();
    expect(packages.size).toBeGreaterThan(1);
    const notExact = [...packages].flatMap(([path, pkg]) => nonExactVersions(pkg).map((v) => `${path}: ${v}`));
    expect(notExact).toEqual([]);
  });

  it('AC-STK-001-02 packageManager fija pnpm con su hash', async () => {
    const root = JSON.parse(await read('package.json')) as PackageJson;
    expect(root.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha(?:224|256|384|512)\.[0-9a-f]{56,128}$/);
  });

  it('AC-STK-001-02 la comprobación distingue versiones exactas de rangos', () => {
    const exact = ['1.2.3', '0.29.6', '5.0.0-beta.1', '7.0.2002', 'workspace:*'];
    expect(exact.filter((v) => !isExactVersion(v))).toEqual([]);
    const ranges = [
      '^1.2.3',
      '~1.2.3',
      '>=1.0.0',
      '1.x',
      '1.2',
      '*',
      'latest',
      'workspace:^',
      'npm:otro@1.2.3',
      'github:a/b',
      '',
    ];
    expect(ranges.filter(isExactVersion)).toEqual([]);
    expect(nonExactVersions({ dependencies: { a: '1.0.0', b: '^2.0.0' }, devDependencies: { c: '~3.0.0' } })).toEqual([
      'dependencies.b: ^2.0.0',
      'devDependencies.c: ~3.0.0',
    ]);
  });
});

describe('defensas de pnpm', () => {
  it('AC-STK-001-03 pnpm-workspace.yaml activa minimumReleaseAge de 3 días, strictDepBuilds, blockExoticSubdeps, trustPolicy y saveExact', async () => {
    expect(defenseProblems(await read('pnpm-workspace.yaml'))).toEqual([]);
  });

  it('AC-STK-001-03 la comprobación detecta defensas ausentes, débiles o comentadas', () => {
    const weak = [
      'minimumReleaseAge: 1440',
      'strictDepBuilds: false',
      '# blockExoticSubdeps: true',
      'trustPolicy: off',
      'saveExact: false',
    ].join('\n');
    expect(defenseProblems(weak)).toEqual([
      'minimumReleaseAge debe ser de al menos 4320 minutos, 3 días (ahora: 1440).',
      'strictDepBuilds debe estar activo.',
      'blockExoticSubdeps debe estar activo.',
      'trustPolicy debe ser no-downgrade.',
      'saveExact debe estar activo.',
    ]);
    expect(defenseProblems('')).toHaveLength(5);
    expect(
      defenseProblems('minimumReleaseAge: 4320\nstrictDepBuilds: true\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade'),
    ).toEqual(['saveExact debe estar activo.']);
  });
});

describe('dominio puro', () => {
  it('AC-STK-001-05 packages/domain/src no importa módulos de E/S', async () => {
    const sources = await domainSources();
    expect([...sources.keys()]).toContain('tables.ts');
    expect([...sources.values()].flatMap(importsOf)).toContain('zod');
    const violations = [...sources].flatMap(([path, text]) =>
      importsOf(text)
        .filter(isIoImport)
        .map((i) => `${path}: ${i}`),
    );
    expect(violations).toEqual([]);
  });

  it('AC-STK-001-05 la comprobación detecta imports de E/S', () => {
    const source = [
      "import { Pool } from 'pg';",
      "import type { Kysely } from 'kysely';",
      'export { readFile } from "node:fs/promises";',
      "const hijo = await import('node:child_process');",
      "import '@dbos-inc/dbos-sdk';",
      "import { createServer } from 'http';",
      "import { createHash } from 'node:crypto';",
      "import { z } from 'zod';",
      "import { huella } from './huella.ts';",
    ].join('\n');
    expect(importsOf(source).filter(isIoImport)).toEqual([
      'pg',
      'kysely',
      'node:fs/promises',
      'node:child_process',
      '@dbos-inc/dbos-sdk',
      'http',
    ]);
  });
});
