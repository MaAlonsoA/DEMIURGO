// The approved records a plan or a screen design must respect, read in FULL (every section and criterion),
// not as titles: a task planned from a title alone missed the authentication its ADR required. A budget
// keeps the pack bounded: decisions and the threat model go whole first, then the quality requirements;
// what does not fit is cut with a visible «[trimmed]» note or, when nothing is left, listed in `omitted`.
// Nothing is dropped silently: every candidate is on the manifest.

import type { Db } from '../db/connection.ts';
import type { ManifestBuilder } from './manifest.ts';

export const TRIMMED_NOTE = '[trimmed]';

export type BasisKind = 'adr' | 'threat_model' | 'quality_requirement';

export type BasisRecord = {
  code: string;
  type: BasisKind;
  version: number;
  title: string;
  /** Every section as `## Title` plus its text, then the criteria; cut with «[trimmed]» when the budget ran out. */
  text: string;
  trimmed: boolean;
};

export type ApprovedBasis = {
  records: BasisRecord[];
  /** Codes whose text did not fit at all (they are on the manifest as dropped). */
  omitted: string[];
  /** What the pack rests on: the records (and versions) whose later change makes the proposal stale. */
  dependencies: { type: 'record'; id: string; code: string; version: number }[];
};

/** Which kinds enter first: decisions and the threat model before the quality requirements. */
const PRIORITY: Record<BasisKind, number> = { adr: 0, threat_model: 0, quality_requirement: 1 };

type Piece = { id: string; code: string; type: BasisKind; version: number; title: string; text: string };

/** What the budget admits, in order; an element that does not fit is skipped and the next ones are still tried. */
export function splitByBudget<T>(elements: T[], size: (e: T) => number, budget: number): { chosen: T[]; dropped: T[] } {
  const chosen: T[] = [];
  const dropped: T[] = [];
  let used = 0;
  for (const e of elements) {
    const t = size(e);
    if (used + t > budget) dropped.push(e);
    else {
      chosen.push(e);
      used += t;
    }
  }
  return { chosen, dropped };
}

export async function approvedBasis(
  db: Db,
  projectId: string,
  opts: { kinds: readonly BasisKind[]; budget: number; section: string; manifest: ManifestBuilder; qualityFilter?: (r: { title: string; text: string }) => boolean },
): Promise<ApprovedBasis> {
  const rows = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type', 'record_versions.id', 'record_versions.n', 'record_versions.title', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.type', 'in', [...opts.kinds])
    .where('record_versions.state', '=', 'approved')
    .orderBy('records.code')
    .execute();
  const criteria = rows.length
    ? await db
        .selectFrom('criteria')
        .select(['record_version_id', 'code', 'title', 'statement', 'given_text', 'when_text', 'then_text'])
        .where('record_version_id', 'in', rows.map((r) => r.id))
        .orderBy('position')
        .execute()
    : [];
  let pieces: Piece[] = rows.map((r) => {
    const sections = (r.sections as { title: string; content: string }[]).map((s) => `## ${s.title}\n${s.content}`).join('\n\n');
    const crit = criteria
      .filter((c) => c.record_version_id === r.id)
      .map((c) => `- ${c.code}: ${c.title}. ${c.given_text ? `Given ${c.given_text}. When ${c.when_text}. Then ${c.then_text}.` : (c.statement ?? '')}`)
      .join('\n');
    return {
      id: r.recordId,
      code: r.code,
      type: r.type as BasisKind,
      version: r.n,
      title: r.title,
      text: `# ${r.code} v${r.n}: ${r.title}\n${sections}${crit ? `\n\n## Criteria\n${crit}` : ''}`,
    };
  });
  if (opts.qualityFilter) {
    const keep = opts.qualityFilter;
    pieces = pieces.filter((p) => p.type !== 'quality_requirement' || keep(p));
  }
  pieces.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || a.code.localeCompare(b.code));

  const records: BasisRecord[] = [];
  const omitted: string[] = [];
  let remaining = opts.budget;
  for (const p of pieces) {
    const source = { type: 'record', id: p.id, version: p.version, eventSeq: null };
    if (p.text.length <= remaining) {
      records.push({ code: p.code, type: p.type, version: p.version, title: p.title, text: p.text, trimmed: false });
      opts.manifest.entered({ section: opts.section, source, text: p.text, reason: 'approved' });
      remaining -= p.text.length;
      continue;
    }
    const room = remaining - TRIMMED_NOTE.length - 1;
    if (room >= 200) {
      const cut = `${p.text.slice(0, room)}\n${TRIMMED_NOTE}`;
      records.push({ code: p.code, type: p.type, version: p.version, title: p.title, text: cut, trimmed: true });
      opts.manifest.entered({ section: opts.section, source, text: cut, originalChars: p.text.length, reason: 'approved' });
      remaining = 0;
    } else {
      omitted.push(p.code);
      opts.manifest.dropped({ section: opts.section, source, text: p.text, reason: `budget:${opts.section}` });
    }
  }
  return {
    records,
    omitted,
    dependencies: pieces.map((p) => ({ type: 'record', id: p.id, code: p.code, version: p.version })),
  };
}
