// The new version form as data (spec §4.6): a note, the template's sections, and an explicit
// choice for every check of the base version (Keep, Change or Drop) plus the new ones. What is
// missing is said in words; the command carries every choice (record_version.create).

import type { Link, RecordVersion, Section } from '../../api/types.ts';
import type { VersionRef } from '../record/logic.ts';

export type Choice = 'keep' | 'change' | 'drop';
export type Verification = 'automatic' | 'manual';

export type CheckDraft = {
  /** Code of the base check, or "new-n" for an added one. */
  key: string;
  code: string | null;
  choice: Choice | null;
  title: string;
  statement: string;
  verification: Verification;
  check: string;
};

export type VersionForm = { title: string; note: string; sections: Section[]; checks: CheckDraft[]; added: number };

export function initialForm(base: RecordVersion): VersionForm {
  return {
    title: base.title,
    note: '',
    sections: base.sections.map((s) => ({ title: s.title, content: s.content })),
    checks: base.criteria.map((c) => ({
      key: c.code,
      code: c.code,
      choice: null,
      title: c.title,
      statement: c.statement,
      verification: c.verification === 'manual' ? 'manual' : 'automatic',
      check: c.check,
    })),
    added: 0,
  };
}

/** Adds a blank new check (to a new version or to a new record). */
export function addCheck<F extends { checks: CheckDraft[]; added: number }>(form: F): F {
  const added = form.added + 1;
  return {
    ...form,
    added,
    checks: [
      ...form.checks,
      { key: `new-${added}`, code: null, choice: null, title: '', statement: '', verification: 'automatic', check: '' },
    ],
  };
}

const blank = (s: string) => s.trim() === '';
const incomplete = (c: CheckDraft) => blank(c.title) || blank(c.statement) || blank(c.check);

/** What still keeps the draft from being saved, in the person's words (empty when it can be saved). */
export function missing(form: VersionForm): string[] {
  const out: string[] = [];
  if (blank(form.note)) out.push('Say what changed.');
  if (blank(form.title)) out.push('Give the version a title.');
  for (const s of form.sections) if (blank(s.content)) out.push(`Write the ${s.title} section.`);
  const undecided = form.checks.filter((c) => c.code !== null && c.choice === null).length;
  if (undecided > 0) out.push(`Choose Keep, Change or Drop for ${undecided} ${undecided === 1 ? 'check' : 'checks'}.`);
  for (const c of form.checks) {
    if (c.code !== null && c.choice === 'change' && incomplete(c)) {
      out.push(`Give ${c.code} a title, a statement and how it is checked.`);
    }
  }
  const newOnes = form.checks.filter((c) => c.code === null && incomplete(c)).length;
  if (newOnes === 1) out.push('Give the new check a title, a statement and how it is checked.');
  if (newOnes > 1) out.push(`Give the ${newOnes} new checks a title, a statement and how they are checked.`);
  return out;
}

export type LinkInput = { type: string; target: { code: string; version: number } };

/** The base version's links, carried as they are when their target is known. */
export function carriedLinks(links: Link[], index: Map<string, VersionRef>): { carried: LinkInput[]; unknown: Link[] } {
  const carried: LinkInput[] = [];
  const unknown: Link[] = [];
  for (const l of links) {
    const target = index.get(l.to_id);
    if (target && l.state !== 'obsolete') carried.push({ type: l.type, target: { code: target.code, version: target.n } });
    else if (!target) unknown.push(l);
  }
  return { carried, unknown };
}

/** Data of record_version.create with the explicit carry-over of every check. */
export function toCommand(recordId: string, form: VersionForm, links: LinkInput[]) {
  const criteria: Record<string, unknown>[] = [];
  const discarded: string[] = [];
  for (const c of form.checks) {
    const content = { title: c.title.trim(), statement: c.statement.trim(), verification: c.verification, check: c.check.trim() };
    if (c.code === null) criteria.push({ carry: 'new', ...content });
    else if (c.choice === 'keep') criteria.push({ carry: 'kept', code: c.code });
    else if (c.choice === 'change') criteria.push({ carry: 'modified', derived_from: c.code, ...content });
    else if (c.choice === 'drop') discarded.push(c.code);
  }
  return {
    record_id: recordId,
    title: form.title.trim(),
    sections: form.sections.map((s) => ({ title: s.title, content: s.content })),
    change_note: form.note.trim(),
    criteria,
    discarded,
    links,
  };
}

/** Anything written or chosen that the base version doesn't have: leaving would lose it (DESIGN.md §3.6). */
export function versionDirty(form: VersionForm, base: RecordVersion): boolean {
  if (form.note.trim() !== '' || form.title !== base.title) return true;
  if (form.sections.some((s, i) => s.content !== (base.sections[i]?.content ?? ''))) return true;
  return form.checks.some((c) => c.code === null || c.choice !== null);
}
