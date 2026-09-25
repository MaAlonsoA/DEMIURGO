// A record written by hand (decision, FDR, ADR or bug): its type's template sections, a title,
// the area it belongs to and, for the types that need them, its checks. What is missing is said in
// words; the command is record.create, which creates version 1 as a draft.

import { RECORD_TEMPLATES, type RecordType } from '../../../../domain/src/records.ts';
import type { Section } from '../../api/types.ts';
import { TYPE_WORDS } from '../../words.ts';
import type { CheckDraft, LinkInput } from '../new-version/form.ts';

export type { RecordType };

export const WRITABLE_TYPES: readonly RecordType[] = ['decision', 'fdr', 'adr', 'bug'];

export type RecordForm = {
  type: RecordType;
  title: string;
  domain: string;
  sections: Section[];
  checks: CheckDraft[];
  added: number;
  /** What it is linked to, born with version 1. */
  links: LinkInput[];
};

export function blankRecord(type: RecordType): RecordForm {
  return {
    type,
    title: '',
    domain: '',
    sections: RECORD_TEMPLATES[type].sections.map((title) => ({ title, content: '' })),
    checks: [],
    added: 0,
    links: [],
  };
}

/** Another type keeps what was written in the sections both templates share. */
export function withType(form: RecordForm, type: RecordType): RecordForm {
  const written = new Map(form.sections.map((s) => [s.title, s.content]));
  return {
    ...form,
    type,
    sections: RECORD_TEMPLATES[type].sections.map((title) => ({ title, content: written.get(title) ?? '' })),
  };
}

const blank = (s: string) => s.trim() === '';
const incomplete = (c: CheckDraft) => blank(c.title) || blank(c.statement) || blank(c.check);
const DOMAIN = /^[a-z][a-z_]*$/;

/** A suggestion for the area from what the person typed: lowercase, spaces as underscores. */
export const domainHint = (domain: string) =>
  domain
    .trim()
    .toLowerCase()
    .replace(/[^a-z_ ]/g, '')
    .replace(/\s+/g, '_') || 'product';

/** What still keeps the record from being saved, in the person's words (empty when it can be saved). */
export function recordMissing(form: RecordForm): string[] {
  const out: string[] = [];
  if (blank(form.title)) out.push('Give it a title.');
  if (blank(form.domain)) out.push('Say which area it belongs to.');
  else if (!DOMAIN.test(form.domain.trim())) {
    out.push(`The area can only have lowercase letters and underscores, like ${domainHint(form.domain)}.`);
  }
  for (const s of form.sections) if (blank(s.content)) out.push(`Write the ${s.title} section.`);
  if (RECORD_TEMPLATES[form.type].requiresCriteria && form.checks.length === 0) {
    out.push(`Add at least one check: a ${TYPE_WORDS[form.type].toLowerCase()} needs them.`);
  }
  const newOnes = form.checks.filter(incomplete).length;
  if (newOnes === 1) out.push('Give the new check a title, a statement and how it is checked.');
  if (newOnes > 1) out.push(`Give the ${newOnes} new checks a title, a statement and how they are checked.`);
  return out;
}

/** Data of record.create: version 1 with its sections and its new checks. */
export function toCreateCommand(form: RecordForm) {
  return {
    type: form.type,
    domain: form.domain.trim(),
    title: form.title.trim(),
    sections: form.sections.map((s) => ({ title: s.title, content: s.content })),
    criteria: form.checks.map((c) => ({
      carry: 'new' as const,
      title: c.title.trim(),
      statement: c.statement.trim(),
      verification: c.verification,
      check: c.check.trim(),
    })),
    links: form.links,
  };
}
