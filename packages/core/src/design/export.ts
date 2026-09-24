// design/ export from the v2 (H1): the latest non-discarded version of each record and each
// taxonomy, in the canonical format, plus their annexes and the fixed README. Right after
// ratifying an import, it matches the imported tree byte for byte.

import {
  FOLDERS,
  type RecordDocument,
  type TaxonomyDocument,
  type DocumentStatus,
  README_DESIGN,
  type RecordType,
  differences,
  renderDocument,
} from '@demiurgo/design';
import type { Selectable } from 'kysely';
import type { Db } from '../db/connection.ts';
import type { DB } from '../db/schema.ts';

// design/ keeps the version in progress of each record, which is either draft or approved.
const DOCUMENT_STATUS: Record<string, DocumentStatus> = { draft: 'proposed', approved: 'approved' };

type Row<T extends keyof DB> = Selectable<DB[T]>;

/**
 * A criterion's "Derived from": its origin's, following the carry-over (kept or modified derives
 * from the same code in the previous version) up to the criterion that was born; null if it was
 * born without deriving.
 */
export async function derivationOf(db: Db, criterionId: string): Promise<string | null> {
  let cursor: string | null = criterionId;
  for (let i = 0; cursor && i < 1000; i++) {
    const c = await db
      .selectFrom('criteria')
      .select(['carry', 'derived_from'])
      .where('id', '=', cursor)
      .executeTakeFirstOrThrow();
    if (c.carry === 'new') {
      if (!c.derived_from) return null;
      return (await db.selectFrom('criteria').select('code').where('id', '=', c.derived_from).executeTakeFirstOrThrow()).code;
    }
    cursor = c.derived_from;
  }
  return null;
}

/** The design/ document of a specific version of a record, as it is exported. */
export async function versionDocument(
  db: Db,
  r: Row<'records'>,
  v: Row<'record_versions'>,
): Promise<{ doc: RecordDocument; annexes: { path: string; content: string }[] }> {
  const criteria = await db
    .selectFrom('criteria')
    .selectAll()
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
  const annexes = (v.annexes ?? []) as { path: string; content: string }[];
  const derivedFrom = new Map<string, string>();
  for (const c of criteria) {
    const origin = await derivationOf(db, c.id);
    if (origin) derivedFrom.set(c.id, origin);
  }
  const doc: RecordDocument = {
    kind: 'record',
    type: r.type as RecordType,
    code: r.code,
    title: v.title,
    version: v.n,
    state: DOCUMENT_STATUS[v.state] ?? 'proposed',
    domain: r.domain,
    links: links.map((e) => ({
      type: e.type as RecordDocument['links'][number]['type'],
      target: { code: e.code, version: e.n },
    })),
    annexes: annexes.map((a) => a.path),
    sections: v.sections as { title: string; content: string }[],
    criteria: criteria.map((c) => ({
      code: c.code,
      title: c.title,
      verification: c.verification === 'automatic' ? 'automatic' : 'manual',
      check: c.check_text,
      statement: c.statement,
      ...(derivedFrom.has(c.id) ? { derivedFrom: derivedFrom.get(c.id) } : {}),
    })),
  };
  if (v.increment) doc.increment = v.increment;
  if (v.change_note) doc.changeNote = v.change_note;
  return { doc, annexes };
}

/** The design/ document of a specific version of a taxonomy. */
export function taxonomyDocument(t: Row<'taxonomies'>): TaxonomyDocument {
  return {
    kind: 'taxonomy',
    code: t.code,
    title: t.title,
    version: t.version,
    state: DOCUMENT_STATUS[t.state] ?? 'proposed',
    axes: t.axes as TaxonomyDocument['axes'],
    sections: t.sections as TaxonomyDocument['sections'],
  };
}

export async function exportDesign(db: Db, projectId: string): Promise<Map<string, string>> {
  const tree = new Map<string, string>([['README.md', README_DESIGN]]);
  const records = await db.selectFrom('records').selectAll().where('project_id', '=', projectId).orderBy('code').execute();
  for (const r of records) {
    const v = await db
      .selectFrom('record_versions')
      .selectAll()
      .where('record_id', '=', r.id)
      .where('state', '<>', 'discarded')
      .orderBy('n', 'desc')
      .executeTakeFirst();
    if (!v) continue;
    const { doc, annexes } = await versionDocument(db, r, v);
    tree.set(`${FOLDERS[doc.type]}/${doc.code}.md`, renderDocument(doc));
    for (const a of annexes) tree.set(a.path, a.content);
  }
  const taxonomies = await db
    .selectFrom('taxonomies')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('state', '<>', 'discarded')
    .orderBy('code')
    .orderBy('version', 'desc')
    .execute();
  const visited = new Set<string>();
  for (const t of taxonomies) {
    if (visited.has(t.code)) continue;
    visited.add(t.code);
    tree.set(`${FOLDERS.taxonomy}/${t.code}.md`, renderDocument(taxonomyDocument(t)));
  }
  return tree;
}

/** Differences between the export and a tree (empty if they match byte for byte). */
export async function compareExport(db: Db, projectId: string, tree: ReadonlyMap<string, string>): Promise<string[]> {
  return differences(tree, await exportDesign(db, projectId));
}
