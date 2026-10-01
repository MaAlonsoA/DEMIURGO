// The product definition as the Product page shows it (pure): which version is in force, what
// changed from the one before and why, and how each section was settled. The server gives the
// versions and their sources (GET …/definition); this only arranges them.

import type { DefinitionReason, DefinitionSource, DefinitionVersion, ProductDefinition, Section } from '../../api/types.ts';

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

/** A version accepted but not approved yet, newer than the one in force. */
export function draftVersion(d: ProductDefinition | undefined): DefinitionVersion | null {
  const latest = d?.versions[0];
  return latest && latest.state === 'draft' ? latest : null;
}

/** The version in force: the latest approved one. */
export function currentVersion(d: ProductDefinition | undefined): DefinitionVersion | null {
  return d?.versions.find((v) => v.state === 'approved') ?? null;
}

/** The version before a given one (discarded drafts don't count), or null for the first. */
export function previousVersion(d: ProductDefinition, v: DefinitionVersion): DefinitionVersion | null {
  return d.versions.find((x) => x.n < v.n && x.state !== 'discarded') ?? null;
}

export type SectionChange = {
  title: string;
  content: string;
  before: string | null;
  changed: boolean;
};

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
 * Why a section changed, as the person reads it: in their own words when they wrote it in another
 * language and read DEMIURGO in theirs, else as recorded (in English).
 */
export function reasonFor(reasons: readonly DefinitionReason[], title: string, locale: string): string | null {
  const r = reasons.find((x) => x.section === title);
  if (!r) return null;
  return locale !== 'en' && r.own_words ? r.own_words : r.why;
}

/** The source of a section, by its title. */
export function sourceOf(sources: readonly DefinitionSource[], title: string): DefinitionSource | null {
  return sources.find((s) => s.section === title) ?? null;
}

/** The approved versions that introduced or changed a section's text, newest first. */
export function sectionTrace(versions: readonly DefinitionVersion[], title: string): DefinitionVersion[] {
  const approved = versions.filter((v) => v.state === 'approved');
  const text = (v: DefinitionVersion | undefined) => v?.sections.find((s) => s.title === title)?.content.trim() ?? null;
  return approved.filter((v, i) => {
    const now = text(v);
    return now !== null && now !== text(approved[i + 1]);
  });
}

/** Pending changes to the definition in the order of its sections (then by age), so they read as one list. */
export function orderedChanges<T extends { section: string; created_at: string }>(changes: readonly T[]): T[] {
  const rank = (c: T) => {
    const key = keyOfSection(c.section);
    const i = key ? DEFINITION_KEYS.indexOf(key) : -1;
    return i < 0 ? DEFINITION_KEYS.length : i;
  };
  return changes.toSorted((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at));
}
