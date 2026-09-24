// The taxonomy as data (design/taxonomy/TAX-001.md): axes with their categories. A new version is
// proposed from the current one (taxonomy.propose); its rules (an "other" category per axis, no
// duplicates) are the server's guard, whose reasons the form shows.

import type { Section, Taxonomy } from '../../api/types.ts';

export type Category = { code: string; name: string; description: string };
export type Axis = { code: string; name: string; categories: Category[] };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Axes of a taxonomy as the API gives them (JSON): whatever is not an axis is left out. */
export function parseAxes(value: unknown): Axis[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) => {
    if (typeof a !== 'object' || a === null) return [];
    const o = a as Record<string, unknown>;
    const code = str(o.code);
    if (!code) return [];
    const categories = (Array.isArray(o.categories) ? o.categories : []).flatMap((c) => {
      if (typeof c !== 'object' || c === null) return [];
      const k = c as Record<string, unknown>;
      return str(k.code) ? [{ code: str(k.code), name: str(k.name) || str(k.code), description: str(k.description) }] : [];
    });
    return [{ code, name: str(o.name) || code, categories }];
  });
}

// The draft being edited: every axis and category has a key of its own, so rows keep their identity
// while their code changes; `codeTouched` stops deriving the code from the name.
export type DraftCategory = Category & { key: string; codeTouched: boolean };
export type DraftAxis = Omit<Axis, 'categories'> & { key: string; codeTouched: boolean; categories: DraftCategory[] };
export type TaxonomyDraft = { code: string; title: string; sections: Section[]; axes: DraftAxis[] };

let seq = 0;
const key = () => `k${++seq}`;

const OTHER: Category = { code: 'other', name: 'Other', description: 'Nothing else fits without forcing it.' };

export function draftFrom(base: Taxonomy | null): TaxonomyDraft {
  const axes = base ? parseAxes(base.axes) : [{ code: 'area', name: 'Area', categories: [OTHER] }];
  return {
    code: base?.code ?? 'TAX-001',
    title: base?.title ?? '',
    sections: base?.sections ?? [],
    axes: axes.map((a) => ({
      key: key(),
      code: a.code,
      name: a.name,
      codeTouched: true,
      categories: a.categories.map((c) => ({ ...c, key: key(), codeTouched: true })),
    })),
  };
}

/** The data of taxonomy.propose. */
export function toProposal(d: TaxonomyDraft): { code: string; title: string; axes: Axis[]; sections: Section[] } {
  return {
    code: d.code,
    title: d.title.trim(),
    axes: d.axes.map((a) => ({
      code: a.code.trim(),
      name: a.name.trim(),
      categories: a.categories.map((c) => ({ code: c.code.trim(), name: c.name.trim(), description: c.description.trim() })),
    })),
    sections: d.sections,
  };
}

/** A code in the server's format (lowercase letters, digits and "_", starting with a letter). */
export function codeFromName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return '';
  return /^[a-z]/.test(base) ? base : `c_${base}`;
}

const mapAxis = (d: TaxonomyDraft, axisKey: string, f: (a: DraftAxis) => DraftAxis): TaxonomyDraft => ({
  ...d,
  axes: d.axes.map((a) => (a.key === axisKey ? f(a) : a)),
});

export function updateAxis(d: TaxonomyDraft, axisKey: string, change: Partial<Pick<Axis, 'code' | 'name'>>): TaxonomyDraft {
  return mapAxis(d, axisKey, (a) => {
    const touched = a.codeTouched || change.code !== undefined;
    const next = { ...a, ...change, codeTouched: touched };
    if (!touched && change.name !== undefined) next.code = codeFromName(change.name);
    return next;
  });
}

export function updateCategory(d: TaxonomyDraft, axisKey: string, categoryKey: string, change: Partial<Category>): TaxonomyDraft {
  return mapAxis(d, axisKey, (a) => ({
    ...a,
    categories: a.categories.map((c) => {
      if (c.key !== categoryKey) return c;
      const touched = c.codeTouched || change.code !== undefined;
      const next = { ...c, ...change, codeTouched: touched };
      if (!touched && change.name !== undefined) next.code = codeFromName(change.name);
      return next;
    }),
  }));
}

export function addCategory(d: TaxonomyDraft, axisKey: string): TaxonomyDraft {
  return mapAxis(d, axisKey, (a) => ({
    ...a,
    categories: [...a.categories, { key: key(), code: '', name: '', description: '', codeTouched: false }],
  }));
}

export function removeCategory(d: TaxonomyDraft, axisKey: string, categoryKey: string): TaxonomyDraft {
  return mapAxis(d, axisKey, (a) => ({ ...a, categories: a.categories.filter((c) => c.key !== categoryKey) }));
}

export function addAxis(d: TaxonomyDraft): TaxonomyDraft {
  return {
    ...d,
    axes: [
      ...d.axes,
      { key: key(), code: '', name: '', codeTouched: false, categories: [{ ...OTHER, key: key(), codeTouched: true }] },
    ],
  };
}

export function removeAxis(d: TaxonomyDraft, axisKey: string): TaxonomyDraft {
  return { ...d, axes: d.axes.filter((a) => a.key !== axisKey) };
}

/** What has to be written before proposing. The rules of the taxonomy itself are the server's. */
export function missing(d: TaxonomyDraft): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push('The title is empty.');
  if (d.axes.length === 0) out.push('There is no axis.');
  for (const a of d.axes) {
    const name = a.name.trim() || 'an axis';
    if (!a.name.trim()) out.push('An axis has no name.');
    if (!a.code.trim()) out.push(`The axis "${name}" has no code.`);
    const categories = a.categories;
    if (categories.some((c) => !c.name.trim())) out.push(`A category of "${name}" has no name.`);
    if (categories.some((c) => !c.code.trim() && c.name.trim())) out.push(`A category of "${name}" has no code.`);
    if (categories.some((c) => !c.description.trim())) out.push(`A category of "${name}" has no description.`);
  }
  return [...new Set(out)];
}
