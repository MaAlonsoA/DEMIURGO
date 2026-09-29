// Pages use the whole width of the screen (brand book, layout): a fixed cap on a page or a section
// left half of a big screen empty, again and again. PageBody's wide page has no cap, and no screen
// caps a page or a section with max-w-{3xl…7xl} or a fixed max-w-[…px|rem]; a reading column uses
// READING_COLUMN from components/Page.tsx, text inside a block max-w-prose, and a popover or a bubble a
// width relative to the screen (vw, %).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = fileURLToPath(new URL('../../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const WIDE_CAP = /\bmax-w-(?:[3-7]xl|screen-\w+|\[[^\]%]*(?:px|rem|em|ch)\])/g;

describe('page width', () => {
  it('PageBody caps only the reading column', () => {
    const page = readFileSync(join(web, 'components/Page.tsx'), 'utf8');
    const caps = page.match(WIDE_CAP) ?? [];
    // One fixed width: the reading column, shared as READING_COLUMN.
    expect(caps).toEqual(['max-w-3xl']);
    expect(page).toMatch(/export const READING_COLUMN = 'max-w-3xl'/);
    expect(page).toMatch(/width === 'reading' && READING_COLUMN/);
  });

  it('no screen caps a page or a section at a fixed width', () => {
    const found = files(web)
      .filter((f) => !f.endsWith('components/Page.tsx'))
      .flatMap((f) => {
        const text = readFileSync(f, 'utf8');
        return (text.match(WIDE_CAP) ?? []).map((m) => `${f.slice(web.length + 1)}: ${m}`);
      });
    expect(found).toEqual([]);
  });
});
