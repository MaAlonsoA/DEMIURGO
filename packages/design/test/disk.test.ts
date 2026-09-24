import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { escribirArbol, leerArbol, reemplazarArbol } from '../src/disco.ts';
import { README_DISENO } from '../src/readme.ts';

describe('exportar a un directorio', () => {
  it('AC-AUT-001-04 deja exactamente el árbol exportado y no toca un directorio que no es un design/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmg-exportar-'));
    const ajeno = await mkdtemp(join(tmpdir(), 'dmg-ajeno-'));
    try {
      await escribirArbol(
        dir,
        new Map([
          ['README.md', README_DISENO],
          ['fdr/FDR-OLD-001.md', 'viejo'],
          ['notas.txt', 'mías'],
        ]),
      );
      const arbol = new Map([
        ['README.md', README_DISENO],
        ['adr/ADR-NUE-001.md', 'nuevo'],
      ]);
      expect(await reemplazarArbol(dir, arbol)).toEqual(['fdr/FDR-OLD-001.md']);
      // Solo borra archivos de design/ y las carpetas que quedan vacías.
      expect(await leerArbol(dir)).toEqual(new Map([...arbol, ['notas.txt', 'mías']]));
      expect(await readdir(dir)).not.toContain('fdr');
      await writeFile(join(ajeno, 'notas.txt'), 'mías', 'utf8');
      await expect(reemplazarArbol(ajeno, arbol)).rejects.toThrow(/no está vacío ni es un design/);
      expect([...(await leerArbol(ajeno)).keys()]).toEqual(['notas.txt']);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(ajeno, { recursive: true, force: true });
    }
  });
});
