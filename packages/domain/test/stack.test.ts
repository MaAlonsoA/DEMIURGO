import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const leer = (ruta: string) => readFile(join(RAIZ, ruta), 'utf8');

type Dependencias = Readonly<Record<string, string>>;
type PackageJson = {
  packageManager?: string;
  scripts?: Dependencias;
  dependencies?: Dependencias;
  devDependencies?: Dependencias;
  optionalDependencies?: Dependencias;
};

/** package.json de la raíz y de cada paquete del monorepo, por ruta. */
async function packageJsons(): Promise<Map<string, PackageJson>> {
  const mapa = new Map<string, PackageJson>([['package.json', JSON.parse(await leer('package.json')) as PackageJson]]);
  for (const e of await readdir(join(RAIZ, 'packages'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const ruta = `packages/${e.name}/package.json`;
    const texto = await leer(ruta).catch(() => null);
    if (texto !== null) mapa.set(ruta, JSON.parse(texto) as PackageJson);
  }
  return mapa;
}

const RE_VERSION_EXACTA = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function esVersionExacta(version: string): boolean {
  return version === 'workspace:*' || RE_VERSION_EXACTA.test(version);
}

function versionesNoExactas(pkg: PackageJson): string[] {
  const secciones = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
  return secciones.flatMap((s) =>
    Object.entries(pkg[s] ?? {})
      .filter(([, v]) => !esVersionExacta(v))
      .map(([nombre, v]) => `${s}.${nombre}: ${v}`),
  );
}

/** Defensas de cadena de suministro que faltan o son débiles en un pnpm-workspace.yaml. */
function problemasDefensas(yaml: string): string[] {
  const valor = (clave: string) => new RegExp(`^${clave}:[ \\t]*([^\\s#]+)[ \\t]*(?:#.*)?$`, 'm').exec(yaml)?.[1];
  const problemas: string[] = [];
  const edad = valor('minimumReleaseAge');
  if (!(Number(edad) >= 4320))
    problemas.push(`minimumReleaseAge debe ser de al menos 4320 minutos, 3 días (ahora: ${edad ?? 'sin definir'}).`);
  for (const clave of ['strictDepBuilds', 'blockExoticSubdeps']) {
    if (valor(clave) !== 'true') problemas.push(`${clave} debe estar activo.`);
  }
  if (valor('trustPolicy') !== 'no-downgrade') problemas.push('trustPolicy debe ser no-downgrade.');
  if (valor('saveExact') !== 'true') problemas.push('saveExact debe estar activo.');
  return problemas;
}

const RE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;

function importsDe(fuente: string): string[] {
  return [...fuente.matchAll(RE_IMPORT)].map((m) => m[2] ?? '');
}

const MODULOS_NODE_DE_ES = ['fs', 'fs/promises', 'net', 'child_process', 'http', 'https', 'http2', 'dgram', 'dns', 'tls'];

/** Un import es de E/S si es un módulo de Node con red, ficheros o procesos, o un paquete de infraestructura. */
function esImportDeES(especificador: string): boolean {
  if (MODULOS_NODE_DE_ES.includes(especificador.replace(/^node:/, ''))) return true;
  return /^(?:pg|pg-[a-z-]+|kysely|fastify)(?:\/|$)/.test(especificador) || /^@(?:dbos-inc|fastify)\//.test(especificador);
}

async function fuentesDelDominio(): Promise<Map<string, string>> {
  const dir = join(RAIZ, 'packages', 'domain', 'src');
  const fuentes = new Map<string, string>();
  for (const ruta of await readdir(dir, { recursive: true })) {
    if (ruta.endsWith('.ts')) fuentes.set(ruta.replaceAll('\\', '/'), await readFile(join(dir, ruta), 'utf8'));
  }
  return fuentes;
}

describe('tipos estrictos', () => {
  it('AC-STK-001-01 tsconfig.json activa strict, noUncheckedIndexedAccess, erasableSyntaxOnly y verbatimModuleSyntax', async () => {
    const tsconfig = JSON.parse(await leer('tsconfig.json')) as { compilerOptions: Record<string, unknown>; include: string[] };
    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      erasableSyntaxOnly: true,
      verbatimModuleSyntax: true,
    });
    expect(tsconfig.include).toEqual(expect.arrayContaining(['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts']));
  });

  it('AC-STK-001-01 gate:types comprueba los tipos sin emitir y forma parte de gate:all', async () => {
    const raiz = JSON.parse(await leer('package.json')) as PackageJson;
    expect(raiz.scripts?.['gate:types']).toMatch(/^tsc\b.*--noEmit\b/);
    expect(raiz.scripts?.['gate:all']).toContain('pnpm gate:types');
  });
});

describe('versiones exactas', () => {
  it('AC-STK-001-02 toda dependencia directa de cada package.json está fijada a una versión exacta', async () => {
    const paquetes = await packageJsons();
    expect(paquetes.size).toBeGreaterThan(1);
    const noExactas = [...paquetes].flatMap(([ruta, pkg]) => versionesNoExactas(pkg).map((v) => `${ruta}: ${v}`));
    expect(noExactas).toEqual([]);
  });

  it('AC-STK-001-02 packageManager fija pnpm con su hash', async () => {
    const raiz = JSON.parse(await leer('package.json')) as PackageJson;
    expect(raiz.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha(?:224|256|384|512)\.[0-9a-f]{56,128}$/);
  });

  it('AC-STK-001-02 la comprobación distingue versiones exactas de rangos', () => {
    const exactas = ['1.2.3', '0.29.6', '5.0.0-beta.1', '7.0.2002', 'workspace:*'];
    expect(exactas.filter((v) => !esVersionExacta(v))).toEqual([]);
    const rangos = [
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
    expect(rangos.filter(esVersionExacta)).toEqual([]);
    expect(versionesNoExactas({ dependencies: { a: '1.0.0', b: '^2.0.0' }, devDependencies: { c: '~3.0.0' } })).toEqual([
      'dependencies.b: ^2.0.0',
      'devDependencies.c: ~3.0.0',
    ]);
  });
});

describe('defensas de pnpm', () => {
  it('AC-STK-001-03 pnpm-workspace.yaml activa minimumReleaseAge de 3 días, strictDepBuilds, blockExoticSubdeps, trustPolicy y saveExact', async () => {
    expect(problemasDefensas(await leer('pnpm-workspace.yaml'))).toEqual([]);
  });

  it('AC-STK-001-03 la comprobación detecta defensas ausentes, débiles o comentadas', () => {
    const debil = [
      'minimumReleaseAge: 1440',
      'strictDepBuilds: false',
      '# blockExoticSubdeps: true',
      'trustPolicy: off',
      'saveExact: false',
    ].join('\n');
    expect(problemasDefensas(debil)).toEqual([
      'minimumReleaseAge debe ser de al menos 4320 minutos, 3 días (ahora: 1440).',
      'strictDepBuilds debe estar activo.',
      'blockExoticSubdeps debe estar activo.',
      'trustPolicy debe ser no-downgrade.',
      'saveExact debe estar activo.',
    ]);
    expect(problemasDefensas('')).toHaveLength(5);
    expect(
      problemasDefensas('minimumReleaseAge: 4320\nstrictDepBuilds: true\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade'),
    ).toEqual(['saveExact debe estar activo.']);
  });
});

describe('dominio puro', () => {
  it('AC-STK-001-05 packages/domain/src no importa módulos de E/S', async () => {
    const fuentes = await fuentesDelDominio();
    expect([...fuentes.keys()]).toContain('tablas.ts');
    expect([...fuentes.values()].flatMap(importsDe)).toContain('zod');
    const infracciones = [...fuentes].flatMap(([ruta, texto]) =>
      importsDe(texto)
        .filter(esImportDeES)
        .map((i) => `${ruta}: ${i}`),
    );
    expect(infracciones).toEqual([]);
  });

  it('AC-STK-001-05 la comprobación detecta imports de E/S', () => {
    const fuente = [
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
    expect(importsDe(fuente).filter(esImportDeES)).toEqual([
      'pg',
      'kysely',
      'node:fs/promises',
      'node:child_process',
      '@dbos-inc/dbos-sdk',
      'http',
    ]);
  });
});
