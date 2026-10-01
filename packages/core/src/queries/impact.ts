// Deterministic impact (suspect links): every record whose current version rests on an older version
// of another record than that record's current one. Computed on read from the links and the current
// versions (domain/impact.ts); nothing about it is stored except «Still valid» (links.checked_against).

import { SUSPECT_LINK_TYPES, type Suspect, suspectLinks } from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';

export type SuspectRecord = {
  link_id: string;
  link_type: string;
  from_code: string;
  from_type: string;
  from_n: number;
  from_title: string;
  from_version_id: string;
  upstream_title: string;
  suspect: Suspect;
};

/** The current (last approved) version of every record of the project, by code. */
export async function currentVersions(db: Db, projectId: string): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.code', sql<number>`max(record_versions.n)`.as('n')])
    .where('records.project_id', '=', projectId)
    .where('record_versions.state', '=', 'approved')
    .groupBy('records.code')
    .execute();
  return new Map(rows.map((r) => [r.code, Number(r.n)]));
}

/** All the suspect records of the project, one per link, ordered by code. */
export async function suspectRecords(db: Db, projectId: string): Promise<SuspectRecord[]> {
  const rows = await db
    .selectFrom('links')
    .innerJoin('record_versions as f', 'f.id', 'links.from_id')
    .innerJoin('records as fr', 'fr.id', 'f.record_id')
    .innerJoin('record_versions as t', 't.id', 'links.to_id')
    .innerJoin('records as tr', 'tr.id', 't.record_id')
    .select([
      'links.id as link_id',
      'links.type',
      'links.checked_against',
      'f.id as from_version_id',
      'f.n as from_n',
      'f.title as from_title',
      'fr.code as from_code',
      'fr.type as from_type',
      't.n as to_n',
      'tr.code as to_code',
    ])
    .where('links.project_id', '=', projectId)
    .where('links.from_type', '=', 'record_version')
    .where('links.to_type', '=', 'record_version')
    .where('links.type', 'in', [...SUSPECT_LINK_TYPES])
    .where('links.state', '!=', 'obsolete')
    .orderBy('fr.code')
    .orderBy('links.id')
    .execute();
  const current = await currentVersions(db, projectId);
  const found = suspectLinks(
    rows.map((r) => ({ ...r, from: { code: r.from_code, n: r.from_n }, to: { code: r.to_code, n: r.to_n }, checkedAgainst: r.checked_against })),
    current,
  );
  if (found.length === 0) return [];
  // The upstream's title, as its current version says it.
  const titles = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.code', 'record_versions.n', 'record_versions.title'])
    .where('records.project_id', '=', projectId)
    .where('records.code', 'in', [...new Set(found.map((f) => f.suspect.upstream))])
    .execute();
  const titleOf = new Map(titles.map((t) => [`${t.code}@${t.n}`, t.title]));
  return found.map((f) => ({
    link_id: f.link_id,
    link_type: f.type,
    from_code: f.from_code,
    from_type: f.from_type,
    from_n: f.from_n,
    from_title: f.from_title,
    from_version_id: f.from_version_id,
    upstream_title: titleOf.get(`${f.suspect.upstream}@${f.suspect.to}`) ?? f.suspect.upstream,
    suspect: f.suspect,
  }));
}
