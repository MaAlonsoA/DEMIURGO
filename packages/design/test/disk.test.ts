import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeTree, readTree, replaceTree } from '../src/disk.ts';
import { README_DESIGN } from '../src/readme.ts';

describe('export to a directory', () => {
  it("AC-AUT-001-04 leaves exactly the exported tree and doesn't touch a directory that isn't a design/", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmg-export-'));
    const foreign = await mkdtemp(join(tmpdir(), 'dmg-foreign-'));
    try {
      await writeTree(
        dir,
        new Map([
          ['README.md', README_DESIGN],
          ['fdr/FDR-OLD-001.md', 'old'],
          ['notes.txt', 'mine'],
        ]),
      );
      const tree = new Map([
        ['README.md', README_DESIGN],
        ['adr/ADR-NEW-001.md', 'new'],
      ]);
      expect(await replaceTree(dir, tree)).toEqual(['fdr/FDR-OLD-001.md']);
      // Only deletes design/ files and folders left empty.
      expect(await readTree(dir)).toEqual(new Map([...tree, ['notes.txt', 'mine']]));
      expect(await readdir(dir)).not.toContain('fdr');
      await writeFile(join(foreign, 'notes.txt'), 'mine', 'utf8');
      await expect(replaceTree(foreign, tree)).rejects.toThrow(/is neither empty nor a design\//);
      expect([...(await readTree(foreign)).keys()]).toEqual(['notes.txt']);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(foreign, { recursive: true, force: true });
    }
  });
});
