import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeTree, readTree, replaceTree } from '../src/disk.ts';
import { README_DESIGN } from '../src/readme.ts';

describe('exportar a un directorio', () => {
  it('AC-AUT-001-04 deja exactamente el árbol exportado y no toca un directorio que no es un design/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmg-exportar-'));
    const foreign = await mkdtemp(join(tmpdir(), 'dmg-ajeno-'));
    try {
      await writeTree(
        dir,
        new Map([
          ['README.md', README_DESIGN],
          ['fdr/FDR-OLD-001.md', 'old'],
          ['notas.txt', 'mías'],
        ]),
      );
      const tree = new Map([
        ['README.md', README_DESIGN],
        ['adr/ADR-NUE-001.md', 'new'],
      ]);
      expect(await replaceTree(dir, tree)).toEqual(['fdr/FDR-OLD-001.md']);
      // Solo borra archivos de design/ y las carpetas que quedan vacías.
      expect(await readTree(dir)).toEqual(new Map([...tree, ['notas.txt', 'mías']]));
      expect(await readdir(dir)).not.toContain('fdr');
      await writeFile(join(foreign, 'notas.txt'), 'mías', 'utf8');
      await expect(replaceTree(foreign, tree)).rejects.toThrow(/no está vacío ni es un design/);
      expect([...(await readTree(foreign)).keys()]).toEqual(['notas.txt']);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(foreign, { recursive: true, force: true });
    }
  });
});
