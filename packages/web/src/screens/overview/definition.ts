// The product definition as the Product page shows it (pure): which version is in force, what
// changed from the one before and why, and how each section was settled. The server gives the
// versions and their sources (GET …/definition); this only arranges them.

import type { DefinitionSource, DefinitionVersion, ProductDefinition, Section } from '../../api/types.ts';

/** The stage keys of the definition's sections, in order: the words of each one are keyed by them. */
export const DEFINITION_KEYS = [
  'purpose',
  'outcomes',
  'principles',
  'stakeholders',
  'problem',
  'features',
  'scope_out',
  'constraints',
] as const;
export type DefinitionKey = (typeof DEFINITION_KEYS)[number];

const KEY_OF_TITLE: Record<string, DefinitionKey> = {
  Purpose: 'purpose',
  Outcomes: 'outcomes',
  Principles: 'principles',
  Users: 'stakeholders',
  Problem: 'problem',
  'First version': 'features',
  'Out of scope': 'scope_out',
  Constraints: 'constraints',
};

/** The key of a section by its (English) title; null for a section the template doesn't have. */
export function keyOfSection(title: string): DefinitionKey | null {
  return KEY_OF_TITLE[title] ?? null;
}

/** The version in force: the latest approved one. */
export function currentVersion(d: ProductDefinition | undefined): DefinitionVersion | null {
  return d?.versions.find((v) => v.state === 'approved') ?? null;
}

/** The version before a given one (discarded drafts don't count), or null for the first. */
export function previousVersion(d: ProductDefinition, v: DefinitionVersion): DefinitionVersion | null {
  return d.versions.find((x) => x.n < v.n && x.state !== 'discarded') ?? null;
}

export type SectionChange = { title: string; content: string; before: string | null; changed: boolean };

/** Each section next to what it said before; a section is changed when its text differs. */
export function sectionChanges(before: readonly Section[] | null, after: readonly Section[]): SectionChange[] {
  const old = new Map((before ?? []).map((s) => [s.title, s.content]));
  return after.map((s) => {
    const was = old.get(s.title) ?? null;
    return {
      title: s.title,
      content: s.content,
      before: was,
      changed: before !== null && (was ?? '').trim() !== s.content.trim(),
    };
  });
}

/**
 * The reason a change note gives for each section. The system writes it as "Changed: A, B." and
 * then one "Section: why" line per changed section.
 */
export function reasonsOf(changeNote: string | null): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const line of (changeNote ?? '').split('\n')) {
    const m = /^([^:]+):\s*(.+)$/.exec(line.trim());
    if (m?.[1] && m[2] && m[1] !== 'Changed') reasons.set(m[1].trim(), m[2].trim());
  }
  return reasons;
}

/** The source of a section, by its title. */
export function sourceOf(sources: readonly DefinitionSource[], title: string): DefinitionSource | null {
  return sources.find((s) => s.section === title) ?? null;
}
