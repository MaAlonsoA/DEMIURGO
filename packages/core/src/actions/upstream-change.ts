// The context of a review thread about a suspect record (it rests on version X of an upstream record
// whose current version is Y): what changed between X and Y, section by section and criterion by
// criterion, so the explorer compares the record against that change instead of guessing.

import type { Db } from '../db/connection.ts';
import { suspectRecords } from '../queries/impact.ts';
import { taskCoversOf } from '../queries/sizes.ts';

const SECTION_CHARS = 1500;
const BUDGET_CHARS = 9000;

type Section = { title: string; content: string };
type CriterionRow = {
  code: string;
  title: string;
  statement: string;
  verification: string;
  check_text: string;
  given_text: string | null;
  when_text: string | null;
  then_text: string | null;
};

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}… [truncated, ${text.length - max} more characters]`);

const criterionOut = (c: CriterionRow) => ({
  code: c.code,
  title: c.title,
  statement: c.statement,
  given: c.given_text,
  when: c.when_text,
  then: c.then_text,
  verification: c.verification,
  check: c.check_text,
});

const criterionKey = (c: CriterionRow) => JSON.stringify(criterionOut(c));

/** The versions of a record's upstream change, by number, with their criteria. */
async function versionOf(db: Db, projectId: string, code: string, n: number) {
  const v = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.id', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.code', '=', code)
    .where('record_versions.n', '=', n)
    .executeTakeFirst();
  if (!v) return null;
  const criteria = await db
    .selectFrom('criteria')
    .select(['code', 'title', 'statement', 'verification', 'check_text', 'given_text', 'when_text', 'then_text'])
    .where('record_version_id', '=', v.id)
    .orderBy('position')
    .execute();
  return { sections: v.sections as Section[], criteria };
}

/** Pure: the difference between two versions' sections and criteria. */
export function diffVersions(before: { sections: Section[]; criteria: CriterionRow[] }, after: { sections: Section[]; criteria: CriterionRow[] }) {
  let budget = BUDGET_CHARS;
  const take = (text: string) => {
    const out = cut(text, Math.max(200, Math.min(SECTION_CHARS, budget)));
    budget -= out.length;
    return out;
  };
  const beforeSection = new Map(before.sections.map((s) => [s.title, s.content]));
  const afterSection = new Map(after.sections.map((s) => [s.title, s.content]));
  const changed_sections: { title: string; change: 'modified' | 'added' | 'dropped'; before: string | null; after: string | null }[] = [];
  for (const s of after.sections) {
    const was = beforeSection.get(s.title);
    if (was === s.content) continue;
    changed_sections.push({ title: s.title, change: was === undefined ? 'added' : 'modified', before: was === undefined ? null : take(was), after: take(s.content) });
  }
  for (const s of before.sections)
    if (!afterSection.has(s.title)) changed_sections.push({ title: s.title, change: 'dropped', before: take(s.content), after: null });

  const was = new Map(before.criteria.map((c) => [c.code, c]));
  const now = new Map(after.criteria.map((c) => [c.code, c]));
  const criteria: { change: 'added' | 'modified' | 'dropped'; before?: ReturnType<typeof criterionOut>; after?: ReturnType<typeof criterionOut> }[] = [];
  for (const c of after.criteria) {
    const old = was.get(c.code);
    if (!old) criteria.push({ change: 'added', after: criterionOut(c) });
    else if (criterionKey(old) !== criterionKey(c)) criteria.push({ change: 'modified', before: criterionOut(old), after: criterionOut(c) });
  }
  for (const c of before.criteria) if (!now.has(c.code)) criteria.push({ change: 'dropped', before: criterionOut(c) });
  return { changed_sections, changed_criteria: criteria };
}

/**
 * The `upstream_change` of a record that is suspect: the upstream code, the versions it moved between
 * and the diff, plus which criteria codes the record itself covers. Null when it is not suspect.
 */
export async function upstreamChangeOf(
  db: Db,
  projectId: string,
  about: { recordId: string; code: string },
  purpose: string,
) {
  const suspects = (await suspectRecords(db, projectId)).filter((s) => s.from_code === about.code);
  if (suspects.length === 0) return null;
  const s = suspects.find((x) => purpose.includes(x.suspect.upstream)) ?? suspects[0]!;
  const { upstream, from, to } = s.suspect;
  const [before, after] = await Promise.all([versionOf(db, projectId, upstream, from), versionOf(db, projectId, upstream, to)]);
  const covers = await taskCoversOf(db, about.recordId);
  return {
    upstream,
    from_version: from,
    to_version: to,
    link_type: s.link_type,
    ...(before && after ? diffVersions(before, after) : {}),
    covered_criteria: covers,
  };
}
