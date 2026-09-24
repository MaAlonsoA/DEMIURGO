// Reading and writing of a `design/` tree on disk.

import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { README_DESIGN } from './readme.ts';
import { FOLDERS } from './types.ts';

/** Paths shaped like a design/ file: only these are deleted when the tree is replaced. */
const MD_FOLDERS = Object.values(FOLDERS).join('|');
const DESIGN_PATH = new RegExp(String.raw`^(README\.md|(${MD_FOLDERS})/[^/]+\.md|data/[^/]+\.yaml)$`);

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
 * Leaves the given tree in `dir`: writes its files and deletes the design/ files that don't
 * belong anymore (never other files) and any folders left empty. Only acts on an empty directory
 * or one that is already a design/ (its README is the fixed one); returns what was deleted.
 */
export async function replaceTree(dir: string, tree: ReadonlyMap<string, string>): Promise<string[]> {
  const existing = await readTree(dir).catch(() => new Map<string, string>());
  if (existing.size > 0 && existing.get('README.md') !== README_DESIGN) {
    throw new Error(`${dir}/ is neither empty nor a design/: choose another directory.`);
  }
  const extras = [...existing.keys()].filter((r) => !tree.has(r) && DESIGN_PATH.test(r)).sort();
  for (const r of extras) await rm(join(dir, ...r.split('/')));
  for (const folder of new Set(extras.map((r) => r.split('/')[0] ?? '').filter((c) => c && !c.endsWith('.md')))) {
    await rmdir(join(dir, folder)).catch(() => undefined);
  }
  await writeTree(dir, tree);
  return extras;
}

/** Compares two trees and returns the human-readable differences (empty if identical). */
export function differences(expected: ReadonlyMap<string, string>, real: ReadonlyMap<string, string>): string[] {
  const diffs: string[] = [];
  for (const path of [...new Set([...expected.keys(), ...real.keys()])].sort()) {
    const a = expected.get(path);
    const b = real.get(path);
    if (a === undefined) diffs.push(`extra ${path}`);
    else if (b === undefined) diffs.push(`missing ${path}`);
    else if (a !== b) {
      const linesA = a.split('\n');
      const lb = b.split('\n');
      const i = linesA.findIndex((l, k) => l !== lb[k]);
      diffs.push(`differs ${path} (line ${i + 1}: "${linesA[i] ?? ''}" vs "${lb[i] ?? ''}")`);
    }
  }
  return diffs;
}
