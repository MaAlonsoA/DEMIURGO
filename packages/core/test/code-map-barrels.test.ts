// Barrel files (build/code-map.ts): imports through `index.ts` re-exports follow only the files that
// provide the imported names, so affected tests and the recheck rule are not "everything".

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { affectedTests, buildCodeMap, parseLinks } from '../src/build/code-map.ts';
import { needsRecheck } from '../src/build/recheck.ts';

const root = mkdtempSync(join(tmpdir(), 'dmg-barrels-'));
const sh = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
const put = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

beforeAll(() => {
  sh('init', '-q', '-b', 'main');
  put('ds/button.tsx', 'export function Button() { return null; }\nexport const SIZES = 1;\n');
  put('ds/sheet.tsx', 'export function Sheet() { return null; }\nexport type SheetProps = { open: boolean };\n');
  put('ds/card.tsx', 'export default function Card() { return null; }\n');
  put('ds/icons/index.ts', "export { Plus, Minus as Less } from './glyphs';\n");
  put('ds/icons/glyphs.ts', 'export const Plus = 1;\nexport const Minus = 2;\n');
  put('ds/icons/other.ts', 'export const Other = 3;\n');
  put('ds/index.ts', "export * from './button';\nexport * from './sheet';\nexport { default as Card } from './card';\nexport * from './icons';\nexport * as other from './icons/other';\n");
  put('app/a.tsx', "import { Button } from '../ds';\nexport const A = Button;\n");
  put('app/b.tsx', "import { Sheet } from '../ds';\nexport const B = Sheet;\n");
  put('app/c.tsx', "import * as ds from '../ds';\nexport const C = ds;\n");
  put('app/d.tsx', "import { Card } from '../ds';\nexport const D = Card;\n");
  put('app/e.tsx', "import { Less } from '../ds';\nexport const E = Less;\n");
  put('app/f.tsx', "import { Nothing } from '../ds';\nexport const F = Nothing;\n");
  put('app/g.tsx', "import { other } from '../ds';\nexport const G = other;\n");
  put('app/h.tsx', "import {\n  Sheet,\n  type SheetProps,\n} from '../ds';\nexport const H = Sheet;\n");
  for (const x of 'abcdefgh') put(`test/${x}.test.ts`, `import { ${x.toUpperCase()} } from '../app/${x}';\nexport const t = ${x.toUpperCase()};\n`);
  sh('add', '-A');
  sh('commit', '-q', '-m', 'init');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('parseLinks', () => {
  it('reads named, default, namespace and side-effect imports and the three re-export forms', () => {
    const r = parseLinks(
      "import D, { A, B as C, type T } from './x';\nimport * as N from './y';\nimport './z';\nconst l = () => import('./w');\nexport * from './p';\nexport { M, N2 as O } from './q';\nexport { default as Q } from './r';\nexport * as NS from './s';\n",
    );
    expect(r.uses).toEqual([
      { spec: './x', names: ['A', 'B', 'T', 'default'] },
      { spec: './y', names: null },
      { spec: './z', names: null },
      { spec: './w', names: null },
    ]);
    expect(r.reexports).toEqual([
      { spec: './p', star: true, pairs: [] },
      { spec: './s', star: false, pairs: [['NS', '*']] },
      { spec: './q', star: false, pairs: [['M', 'M'], ['O', 'N2']] },
      { spec: './r', star: false, pairs: [['Q', 'default']] },
    ]);
  });
});

describe('imports through barrels', () => {
  it('a named import depends on the barrel and the providing file only', async () => {
    const map = await buildCodeMap(root, 'main');
    expect(map.byPath.get('app/a.tsx')?.imports.sort()).toEqual(['ds/button.tsx', 'ds/index.ts']);
    expect(map.byPath.get('app/d.tsx')?.imports.sort()).toEqual(['ds/card.tsx', 'ds/index.ts']);
    expect(map.byPath.get('app/e.tsx')?.imports.sort()).toEqual(['ds/icons/glyphs.ts', 'ds/index.ts']);
    expect(map.byPath.get('app/g.tsx')?.imports).toContain('ds/icons/other.ts');
    expect(map.byPath.get('app/h.tsx')?.imports.sort()).toEqual(['ds/index.ts', 'ds/sheet.tsx']);
  });

  it('a namespace import or an unresolved name keeps every re-exported file (fail safe)', async () => {
    const map = await buildCodeMap(root, 'main');
    const all = ['ds/button.tsx', 'ds/card.tsx', 'ds/icons/glyphs.ts', 'ds/icons/index.ts', 'ds/icons/other.ts', 'ds/index.ts', 'ds/sheet.tsx'];
    expect(map.byPath.get('app/c.tsx')?.imports.sort()).toEqual(all);
    expect(map.byPath.get('app/f.tsx')?.imports.sort()).toEqual(all);
  });

  it('the barrel itself no longer depends on what it only re-exports', async () => {
    const map = await buildCodeMap(root, 'main');
    expect(map.byPath.get('ds/index.ts')?.imports).toEqual([]);
  });

  it('a test importing {Button} is affected by button.tsx but not by sheet.tsx', async () => {
    const map = await buildCodeMap(root, 'main');
    expect(affectedTests(map, ['ds/button.tsx'])).toEqual(['test/a.test.ts', 'test/c.test.ts', 'test/f.test.ts']);
    expect(affectedTests(map, ['ds/sheet.tsx'])).toEqual(['test/b.test.ts', 'test/c.test.ts', 'test/f.test.ts', 'test/h.test.ts']);
    expect(affectedTests(map, ['ds/icons/glyphs.ts'])).toEqual(['test/c.test.ts', 'test/e.test.ts', 'test/f.test.ts']);
    expect(affectedTests(map, ['ds/card.tsx'])).toEqual(['test/c.test.ts', 'test/d.test.ts', 'test/f.test.ts']);
  });

  it('changing the barrel itself affects everything that imports it', async () => {
    const map = await buildCodeMap(root, 'main');
    expect(affectedTests(map, ['ds/index.ts'])).toHaveLength(8);
  });

  it('the recheck rule sees disjoint files behind a barrel as disjoint', async () => {
    const map = await buildCodeMap(root, 'main');
    expect(needsRecheck({ taskFiles: ['app/a.tsx'], mainFiles: ['ds/sheet.tsx'], map })).toEqual({ recheck: false, reason: 'disjoint' });
    expect(needsRecheck({ taskFiles: ['app/a.tsx'], mainFiles: ['ds/button.tsx'], map }).recheck).toBe(true);
    expect(needsRecheck({ taskFiles: ['app/a.tsx'], mainFiles: ['ds/index.ts'], map }).recheck).toBe(true);
  });
});
