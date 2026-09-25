import { describe, expect, it } from 'vitest';
import type { ProductRow } from '../../src/api/types.ts';
import { MANUAL_LINK_TYPES, addLink, linkTargets, mergeLinks, removeLink } from '../../src/screens/new-version/links.ts';

const row = (code: string, type: ProductRow['type'], current: number | null, latest: number): ProductRow =>
  ({
    code,
    type,
    title: `Title of ${code}`,
    current,
    latest: { n: latest, state: current === latest ? 'approved' : 'draft' },
  }) as ProductRow;

describe('links written by hand', () => {
  it('offers the link types a person chooses, never the ones DEMIURGO sets itself', () => {
    expect(MANUAL_LINK_TYPES).toEqual(['based_on', 'design_of', 'covers', 'conflicts_with']);
  });

  it('points to the current version of each record, or its latest when none is approved, and never to itself', () => {
    const state = { designs: [row('FDR-CLU-001', 'fdr', 1, 2)], decisions: [row('DEC-CLU-001', 'decision', null, 1)] };
    expect(linkTargets(state, 'FDR-CLU-001')).toEqual([
      { code: 'DEC-CLU-001', version: 1, title: 'Title of DEC-CLU-001', type: 'decision' },
    ]);
    expect(linkTargets(state).map((t) => [t.code, t.version])).toEqual([
      ['DEC-CLU-001', 1],
      ['FDR-CLU-001', 1],
    ]);
  });

  it('adds a link once per type and target, and removes it', () => {
    const one = addLink([], { type: 'based_on', target: { code: 'DEC-CLU-001', version: 1 } });
    expect(addLink(one, { type: 'based_on', target: { code: 'DEC-CLU-001', version: 1 } })).toEqual(one);
    const two = addLink(one, { type: 'conflicts_with', target: { code: 'DEC-CLU-001', version: 1 } });
    expect(two).toHaveLength(2);
    const [based, conflict] = two;
    if (!based) throw new Error('no link');
    expect(removeLink(two, based)).toEqual([conflict]);
  });

  it('a link the person adds replaces the carried one of the same type and record, at the version chosen', () => {
    const carried = [
      { type: 'based_on', target: { code: 'DEC-CLU-001', version: 2 } },
      { type: 'covers', target: { code: 'FDR-CLU-001', version: 1 } },
    ];
    const added = [{ type: 'based_on', target: { code: 'DEC-CLU-001', version: 3 } }];
    expect(mergeLinks(carried, added)).toEqual([
      { type: 'covers', target: { code: 'FDR-CLU-001', version: 1 } },
      { type: 'based_on', target: { code: 'DEC-CLU-001', version: 3 } },
    ]);
  });
});
