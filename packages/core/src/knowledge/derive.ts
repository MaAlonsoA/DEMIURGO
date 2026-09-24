// Deterministic derivation of an authority change into nodes and edges (no classifier).
// Authority is immutable per version (content, criteria and links are born with it), so
// deriving the same trigger gives the same change now and during a rebuild: the version's
// current state is never looked at.

import type { Change } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';

export type AuthorityObject = { type: string; id: string; version: number | null };

export { DISCARD_TRIGGER } from '../commands/reactions.ts';

/** Refs withdrawn by discarding a version (the draft's node; its criteria go with it). */
export async function deriveRetirement(db: Db, object: AuthorityObject): Promise<string[]> {
  const v = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.n', 'records.code'])
    .where('record_versions.id', '=', object.id)
    .executeTakeFirst();
  return v ? [`${v.code}@${v.n}`] : [];
}

const MAX_TEXT = 4000;

export async function deriveChange(db: Db, object: AuthorityObject): Promise<Change | null> {
  let versionId: string | null = null;
  if (object.type === 'record_version') versionId = object.id;
  if (object.type === 'proposal') {
    const p = await db.selectFrom('proposals').select(['state', 'resolution']).where('id', '=', object.id).executeTakeFirst();
    const effect = (p?.resolution as { effect?: { versionId?: string } } | null)?.effect;
    versionId = effect?.versionId ?? null;
  }
  if (!versionId) return null;
  const v = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select([
      'record_versions.id',
      'record_versions.n',
      'record_versions.title',
      'record_versions.sections',
      'records.id as recordId',
      'records.code',
      'records.type',
    ])
    .where('record_versions.id', '=', versionId)
    .executeTakeFirst();
  if (!v) return null;
  // Independent of when it's derived: an approval projects the approved version, and an
  // accepted proposal, the version it created as it was born (as a draft).
  const approved = object.type === 'record_version';
  const sections = v.sections as { title: string; content: string }[];
  const ref = `${v.code}@${v.n}`;
  const criteria = await db
    .selectFrom('criteria')
    .select(['code', 'title', 'statement', 'check_text'])
    .where('record_version_id', '=', v.id)
    .orderBy('position')
    .execute();
  const links = await db
    .selectFrom('links')
    .innerJoin('record_versions as target', 'target.id', 'links.to_id')
    .innerJoin('records as rd', 'rd.id', 'target.record_id')
    .select(['links.type', 'rd.code', 'target.n'])
    .where('links.from_id', '=', v.id)
    .orderBy('links.id')
    .execute();
  const other = approved
    ? (
        await db
          .selectFrom('record_versions')
          .select('n')
          .where('record_id', '=', v.recordId)
          .where('n', '<', v.n)
          .orderBy('n')
          .execute()
      ).map((o) => `${v.code}@${o.n}`)
    : [];
  const epistemic = approved ? 'confirmed' : 'proposed';
  return {
    main: {
      ref,
      type: v.type,
      label: v.title,
      text: sections
        .map((s) => `${s.title}: ${s.content}`)
        .join('\n')
        .slice(0, MAX_TEXT),
      epistemic,
      authority: true,
      origin: { type: 'record_version', id: v.id, version: v.n },
    },
    companions: criteria.map((c) => ({
      ref: `${c.code}@${v.n}`,
      type: 'criterion',
      label: c.title,
      text: `${c.statement}\nCheck: ${c.check_text}`.slice(0, MAX_TEXT),
      epistemic,
      authority: true,
      origin: { type: 'record_version', id: v.id, version: v.n },
    })),
    edges: [
      ...criteria.map((c) => ({ type: 'contains', from: ref, to: `${c.code}@${v.n}` })),
      ...links.map((e) => ({ type: e.type, from: ref, to: `${e.code}@${e.n}` })),
    ],
    supersedes: other,
  };
}
