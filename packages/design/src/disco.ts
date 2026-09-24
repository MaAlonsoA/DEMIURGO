// Lectura y escritura de un árbol `design/` en disco.

import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { README_DISENO } from './readme.ts';
import { CARPETAS } from './tipos.ts';

/** Rutas con la forma de un archivo de design/: solo esas se borran al reemplazar el árbol. */
const CARPETAS_MD = Object.values(CARPETAS).join('|');
const RUTA_DE_DISENO = new RegExp(String.raw`^(README\.md|(${CARPETAS_MD})/[^/]+\.md|datos/[^/]+\.yaml)$`);

export async function leerArbol(dir: string): Promise<Map<string, string>> {
  const arbol = new Map<string, string>();
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const e of entradas) {
    if (!e.isFile()) continue;
    const absoluta = join(e.parentPath, e.name);
    const ruta = relative(dir, absoluta).split(sep).join('/');
    arbol.set(ruta, await readFile(absoluta, 'utf8'));
  }
  return arbol;
}

export async function escribirArbol(dir: string, arbol: ReadonlyMap<string, string>): Promise<void> {
  for (const [ruta, texto] of arbol) {
    const destino = join(dir, ...ruta.split('/'));
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, texto, 'utf8');
  }
}

/**
 * Deja en `dir` el árbol dado: escribe sus archivos y borra los de design/ que sobran (nunca otros
 * archivos) y las carpetas que queden vacías. Solo actúa sobre un directorio vacío o que ya es un
 * design/ (su README es el fijo); devuelve lo borrado.
 */
export async function reemplazarArbol(dir: string, arbol: ReadonlyMap<string, string>): Promise<string[]> {
  const previo = await leerArbol(dir).catch(() => new Map<string, string>());
  if (previo.size > 0 && previo.get('README.md') !== README_DISENO) {
    throw new Error(`${dir}/ no está vacío ni es un design/: elige otro directorio.`);
  }
  const sobran = [...previo.keys()].filter((r) => !arbol.has(r) && RUTA_DE_DISENO.test(r)).sort();
  for (const r of sobran) await rm(join(dir, ...r.split('/')));
  for (const carpeta of new Set(sobran.map((r) => r.split('/')[0] ?? '').filter((c) => c && !c.endsWith('.md')))) {
    await rmdir(join(dir, carpeta)).catch(() => undefined);
  }
  await escribirArbol(dir, arbol);
  return sobran;
}

/** Compara dos árboles y devuelve las diferencias legibles (vacío si son idénticos). */
export function diferencias(esperado: ReadonlyMap<string, string>, real: ReadonlyMap<string, string>): string[] {
  const difs: string[] = [];
  for (const ruta of [...new Set([...esperado.keys(), ...real.keys()])].sort()) {
    const a = esperado.get(ruta);
    const b = real.get(ruta);
    if (a === undefined) difs.push(`sobra ${ruta}`);
    else if (b === undefined) difs.push(`falta ${ruta}`);
    else if (a !== b) {
      const la = a.split('\n');
      const lb = b.split('\n');
      const i = la.findIndex((l, k) => l !== lb[k]);
      difs.push(`difiere ${ruta} (línea ${i + 1}: «${la[i] ?? ''}» frente a «${lb[i] ?? ''}»)`);
    }
  }
  return difs;
}
