import type { Tx } from '../db/connection.ts';

type Section = { title: string; content: string };

export type KnownQualityRequirement = { title: string; attribute: string; where: 'pending' | 'record' };

// Words that don't identify a quality attribute («Performance and user control» vs «Performance»).
const STOP = new Set(['and', 'of', 'the', 'a', 'an', 'to', 'for', 'in', 'on', 'with', 'user', 'users', 'control', 'personal', 'data']);

/** The quality attribute a quality requirement declares in its «Quality attribute» section. */
export function qualityAttributeOf(sections: readonly Section[], title = ''): string {
  const s = sections.find((x) => /quality attribute/i.test(x.title));
  return (s?.content ?? title).trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      // «recoverability» / «recovery» / «recover»: a shared stem of 6 letters.
      .map((w) => w.slice(0, 6)),
  );
}

/** Two quality attributes name the same concern when they share a significant word. */
export function sameQualityAttribute(a: string, b: string): boolean {
  const ta = tokens(a);
  for (const w of tokens(b)) if (ta.has(w)) return true;
  return false;
}

/** The quality requirements of a project that already exist: pending as a proposal, or as a record. */
export async function knownQualityRequirements(trx: Tx, projectId: string): Promise<KnownQualityRequirement[]> {
  const pending = await trx
    .selectFrom('proposals')
    .select('payload')
    .where('project_id', '=', projectId)
    .where('type', '=', 'design_record')
    .where('state', '=', 'pending')
    .execute();
  const known: KnownQualityRequirement[] = [];
  for (const p of pending) {
    const payload = p.payload as { record_type?: string; title?: string; sections?: Section[] };
    if (payload.record_type !== 'quality_requirement') continue;
    known.push({ title: payload.title ?? '', attribute: qualityAttributeOf(payload.sections ?? [], payload.title), where: 'pending' });
  }
  const records = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.record_id', 'record_versions.title', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'quality_requirement')
    .where('record_versions.state', 'in', ['approved', 'draft'])
    .orderBy('record_versions.n', 'desc')
    .execute();
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.record_id)) continue;
    seen.add(r.record_id);
    known.push({ title: r.title, attribute: qualityAttributeOf(r.sections as Section[], r.title), where: 'record' });
  }
  return known;
}
