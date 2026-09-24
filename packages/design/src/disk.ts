// Lectura y escritura de un árbol `design/` en disco.

import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { README_DESIGN } from './readme.ts';
import { FOLDERS } from './types.ts';

/** Rutas con la forma de un archivo de design/: solo esas se borran al reemplazar el árbol. */
const MD_FOLDERS = Object.values(FOLDERS).join('|');
const DESIGN_PATH = new RegExp(String.raw`^(README\.md|(${MD_FOLDERS})/[^/]+\.md|datos/[^/]+\.yaml)$`);

export async function readTree(dir: string): Promise<Map<string, string>> {
  const tree = new Map<string, string>();
  const inputs = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const e of inputs) {
    if (!e.isFile()) continue;
    const absolute = join(e.parentPath, e.name);
    const path = relative(dir, absolute).split(sep).join('/');
    tree.set(path, await readFile(absolute, 'utf8'));
  }
  return tree;
}

export async function writeTree(dir: string, tree: ReadonlyMap<string, string>): Promise<void> {
  for (const [path, text] of tree) {
    const target = join(dir, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
}

/**
 * Deja en `dir` el árbol dado: escribe sus archivos y borra los de design/ que sobran (nunca otros
 * archivos) y las carpetas que queden vacías. Solo actúa sobre un directorio vacío o que ya es un
 * design/ (su README es el fijo); devuelve lo borrado.
 */
export async function replaceTree(dir: string, tree: ReadonlyMap<string, string>): Promise<string[]> {
  const existing = await readTree(dir).catch(() => new Map<string, string>());
  if (existing.size > 0 && existing.get('README.md') !== README_DESIGN) {
    throw new Error(`${dir}/ no está vacío ni es un design/: elige otro directorio.`);
  }
  const extras = [...existing.keys()].filter((r) => !tree.has(r) && DESIGN_PATH.test(r)).sort();
  for (const r of extras) await rm(join(dir, ...r.split('/')));
  for (const folder of new Set(extras.map((r) => r.split('/')[0] ?? '').filter((c) => c && !c.endsWith('.md')))) {
    await rmdir(join(dir, folder)).catch(() => undefined);
  }
  await writeTree(dir, tree);
  return extras;
}

/** Compara dos árboles y devuelve las diferencias legibles (vacío si son idénticos). */
export function differences(expected: ReadonlyMap<string, string>, real: ReadonlyMap<string, string>): string[] {
  const diffs: string[] = [];
  for (const path of [...new Set([...expected.keys(), ...real.keys()])].sort()) {
    const a = expected.get(path);
    const b = real.get(path);
    if (a === undefined) diffs.push(`sobra ${path}`);
    else if (b === undefined) diffs.push(`falta ${path}`);
    else if (a !== b) {
      const linesA = a.split('\n');
      const lb = b.split('\n');
      const i = linesA.findIndex((l, k) => l !== lb[k]);
      diffs.push(`difiere ${path} (línea ${i + 1}: «${linesA[i] ?? ''}» frente a «${lb[i] ?? ''}»)`);
    }
  }
  return diffs;
}
