import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/api/types.ts';
import {
  addAxis,
  addCategory,
  codeFromName,
  draftFrom,
  missing,
  parseAxes,
  removeCategory,
  toProposal,
  updateCategory,
} from '../../src/screens/knowledge/taxonomy.ts';

const current: Taxonomy = {
  id: 't1',
  code: 'TAX-001',
  version: 1,
  title: 'Taxonomía inicial del producto',
  axes: [
    {
      code: 'area',
      name: 'Área del producto',
      categories: [
        { code: 'diseno', name: 'Diseño', description: 'Decisiones y FDR.' },
        { code: 'other', name: 'Otra', description: 'Ninguna encaja.' },
      ],
    },
  ],
  sections: [{ title: 'Propósito', content: 'Organizar el conocimiento.' }],
  state: 'approved',
  author: 'human:ana',
  created_at: '2026-09-24T10:00:00Z',
  approved_at: '2026-09-24T10:05:00Z',
  approved_by: 'human:ana',
};

describe('proposing a taxonomy from the UI', () => {
  it('AC-INT-001-17 reads the axes of a taxonomy as data, ignoring what is not an axis', () => {
    expect(parseAxes(current.axes).map((a) => [a.code, a.categories.length])).toEqual([['area', 2]]);
    expect(parseAxes(null)).toEqual([]);
    expect(parseAxes([{ code: 'x' }, 'nonsense'])).toEqual([{ code: 'x', name: 'x', categories: [] }]);
  });

  it('AC-INT-001-17 a new version starts from the current one and keeps its code and text', () => {
    const draft = draftFrom(current);
    expect(draft).toMatchObject({ code: 'TAX-001', title: 'Taxonomía inicial del producto' });
    const proposal = toProposal(draft);
    expect(proposal).toEqual({
      code: 'TAX-001',
      title: 'Taxonomía inicial del producto',
      axes: current.axes,
      sections: current.sections,
    });
  });

  it('AC-INT-001-17 without any taxonomy the first one is TAX-001 with one axis and its "other" category', () => {
    const draft = draftFrom(null);
    expect(draft.code).toBe('TAX-001');
    const p = toProposal(draft);
    expect(p.axes).toHaveLength(1);
    expect(p.axes[0]?.categories.map((c) => c.code)).toContain('other');
  });

  it('AC-INT-001-17 editing adds, changes and removes categories and axes without touching the rest', () => {
    let d = draftFrom(current);
    const axis = d.axes[0]?.key ?? '';
    d = addCategory(d, axis);
    const added = d.axes[0]?.categories.at(-1)?.key ?? '';
    d = updateCategory(d, axis, added, { name: 'Interfaz web', description: 'Pantallas y navegación.' });
    expect(d.axes[0]?.categories.at(-1)).toMatchObject({ code: 'interfaz_web', name: 'Interfaz web' });
    // Once the person writes the code, the name no longer changes it.
    d = updateCategory(d, axis, added, { code: 'web' });
    d = updateCategory(d, axis, added, { name: 'Web' });
    expect(d.axes[0]?.categories.at(-1)?.code).toBe('web');
    const other = d.axes[0]?.categories.find((c) => c.code === 'other')?.key ?? '';
    d = removeCategory(d, axis, other);
    d = addAxis(d);
    const p = toProposal(d);
    expect(p.axes[0]?.categories.map((c) => c.code)).toEqual(['diseno', 'web']);
    expect(p.axes).toHaveLength(2);
    expect(current.axes).toHaveLength(1);
  });

  it('AC-INT-001-17 says what is missing before proposing, and leaves the rules to the server', () => {
    const d = draftFrom(current);
    expect(missing(d)).toEqual([]);
    const axis = d.axes[0]?.key ?? '';
    const first = d.axes[0]?.categories[0]?.key ?? '';
    const blank = updateCategory(d, axis, first, { name: '', description: '' });
    expect(missing(blank)).toEqual([
      'A category of "Área del producto" has no name.',
      'A category of "Área del producto" has no description.',
    ]);
    expect(missing({ ...d, title: ' ' })).toEqual(['The title is empty.']);
  });

  it('AC-INT-001-17 codes are derived from names in the format the server accepts', () => {
    expect(codeFromName('Interfaz web')).toBe('interfaz_web');
    expect(codeFromName('Diseño & UX')).toBe('diseno_ux');
    expect(codeFromName('3D')).toBe('c_3d');
    expect(codeFromName('')).toBe('');
  });
});
