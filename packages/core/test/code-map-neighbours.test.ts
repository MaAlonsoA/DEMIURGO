// pm-7: a barrel lists no exports, and the import neighbours of the best files survive the candidate cap.

import { describe, expect, it } from 'vitest';
import { assemble, rankCodeMap } from '../src/build/code-map.ts';

const f = (path: string, imports: string[] = [], extra: Record<string, unknown> = {}) => ({
  path,
  kind: 'lib' as const,
  modules: [],
  symbols: [{ name: `sym${path.replace(/\W/g, '')}`, kind: 'function' as const, exported: true }],
  imports,
  ...extra,
});

describe('code map candidates', () => {
  it('lists no exports for a barrel', () => {
    const map = assemble('c', [f('src/ds/index.ts', [], { barrel: true }), f('src/ds/user.ts', ['src/ds/index.ts'])]);
    const ranked = rankCodeMap(map, 'symsrcdsindexts symsrcdsuserts');
    expect(ranked.find((r) => r.file.path === 'src/ds/index.ts')?.symbols).toEqual([]);
    expect(ranked.find((r) => r.file.path === 'src/ds/user.ts')?.symbols.length).toBeGreaterThan(0);
  });

  it('keeps an import neighbour of the best files among the candidates when the cap would cut it', () => {
    // 12 files match the task by name; the best one imports a file that matches nothing.
    const matched = Array.from({ length: 12 }, (_, i) => f(`src/meal-${String(i).padStart(2, '0')}.ts`, i === 0 ? ['src/hidden.ts'] : []));
    const map = assemble('c', [...matched, f('src/hidden.ts')]);
    const ranked = rankCodeMap(map, 'meal', { limit: 10 });
    expect(ranked).toHaveLength(10);
    expect(ranked.map((r) => r.file.path)).toContain('src/hidden.ts');
  });
});
