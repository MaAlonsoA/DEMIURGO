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

/** package.json of the root and of each package in the monorepo, by path. */
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

/** Supply-chain defenses that are missing or weak in a pnpm-workspace.yaml. */
function defenseProblems(yaml: string): string[] {
  const value = (key: string) => new RegExp(`^${key}:[ \\t]*([^\\s#]+)[ \\t]*(?:#.*)?$`, 'm').exec(yaml)?.[1];
  const problems: string[] = [];
  const age = value('minimumReleaseAge');
  if (!(Number(age) >= 4320))
    problems.push(`minimumReleaseAge must be at least 4320 minutes, 3 days (now: ${age ?? 'not set'}).`);
  for (const key of ['strictDepBuilds', 'blockExoticSubdeps']) {
    if (value(key) !== 'true') problems.push(`${key} must be turned on.`);
  }
  if (value('trustPolicy') !== 'no-downgrade') problems.push('trustPolicy must be no-downgrade.');
  if (value('saveExact') !== 'true') problems.push('saveExact must be turned on.');
  return problems;
}

const RE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;

function importsOf(source: string): string[] {
  return [...source.matchAll(RE_IMPORT)].map((m) => m[2] ?? '');
}

const NODE_IO_MODULES = ['fs', 'fs/promises', 'net', 'child_process', 'http', 'https', 'http2', 'dgram', 'dns', 'tls'];

/** An import is I/O if it's a Node module with network, files or processes, or an infrastructure package. */
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

describe('strict types', () => {
  it('AC-STK-001-01 tsconfig.json turns on strict, noUncheckedIndexedAccess, erasableSyntaxOnly and verbatimModuleSyntax', async () => {
    const tsconfig = JSON.parse(await read('tsconfig.json')) as { compilerOptions: Record<string, unknown>; include: string[] };
    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      erasableSyntaxOnly: true,
      verbatimModuleSyntax: true,
    });
    expect(tsconfig.include).toEqual(expect.arrayContaining(['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts']));
  });

  it('AC-STK-001-01 gate:types checks types without emitting and is part of gate:all', async () => {
    const root = JSON.parse(await read('package.json')) as PackageJson;
    expect(root.scripts?.['gate:types']).toMatch(/^tsc\b.*--noEmit\b/);
    expect(root.scripts?.['gate:all']).toContain('pnpm gate:types');
  });
});

describe('exact versions', () => {
  it('AC-STK-001-02 every direct dependency of each package.json is pinned to an exact version', async () => {
    const packages = await packageJsons();
    expect(packages.size).toBeGreaterThan(1);
    const notExact = [...packages].flatMap(([path, pkg]) => nonExactVersions(pkg).map((v) => `${path}: ${v}`));
    expect(notExact).toEqual([]);
  });

  it('AC-STK-001-02 packageManager pins pnpm with its hash', async () => {
    const root = JSON.parse(await read('package.json')) as PackageJson;
    expect(root.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha(?:224|256|384|512)\.[0-9a-f]{56,128}$/);
  });

  it('AC-STK-001-02 the check tells exact versions apart from ranges', () => {
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

describe('pnpm defenses', () => {
  it('AC-STK-001-03 pnpm-workspace.yaml turns on a 3-day minimumReleaseAge, strictDepBuilds, blockExoticSubdeps, trustPolicy and saveExact', async () => {
    expect(defenseProblems(await read('pnpm-workspace.yaml'))).toEqual([]);
  });

  it('AC-STK-001-03 the check detects defenses that are missing, weak or commented out', () => {
    const weak = [
      'minimumReleaseAge: 1440',
      'strictDepBuilds: false',
      '# blockExoticSubdeps: true',
      'trustPolicy: off',
      'saveExact: false',
    ].join('\n');
    expect(defenseProblems(weak)).toEqual([
      'minimumReleaseAge must be at least 4320 minutes, 3 days (now: 1440).',
      'strictDepBuilds must be turned on.',
      'blockExoticSubdeps must be turned on.',
      'trustPolicy must be no-downgrade.',
      'saveExact must be turned on.',
    ]);
    expect(defenseProblems('')).toHaveLength(5);
    expect(
      defenseProblems('minimumReleaseAge: 4320\nstrictDepBuilds: true\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade'),
    ).toEqual(['saveExact must be turned on.']);
  });
});

describe('pure domain', () => {
  it('AC-STK-001-05 packages/domain/src imports no I/O modules', async () => {
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

  it('AC-STK-001-05 the check detects I/O imports', () => {
    const source = [
      "import { Pool } from 'pg';",
      "import type { Kysely } from 'kysely';",
      'export { readFile } from "node:fs/promises";',
      "const child = await import('node:child_process');",
      "import '@dbos-inc/dbos-sdk';",
      "import { createServer } from 'http';",
      "import { createHash } from 'node:crypto';",
      "import { z } from 'zod';",
      "import { fingerprint } from './fingerprint.ts';",
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
