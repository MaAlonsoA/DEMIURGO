// Lectura y escritura de un árbol `design/` en disco.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

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
