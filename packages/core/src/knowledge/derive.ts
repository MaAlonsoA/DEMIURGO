// Derivación determinista de un cambio de autoridad a nodos y aristas (sin clasificador).
// La autoridad es inmutable por versión (contenido, criterios y enlaces nacen con ella), así que
// derivar el mismo disparo da el mismo cambio ahora y en una reconstrucción: nunca se mira el
// estado actual de la versión.

import type { Change } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';

export type AuthorityObject = { type: string; id: string; version: number | null };

export { DISCARD_TRIGGER } from '../commands/reactions.ts';

/** Refs que retira el descarte de una versión (el nodo del borrador; sus criterios van con él). */
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
  // Independiente del momento en que se derive: una aprobación proyecta la versión aprobada y
  // una propuesta aceptada, la versión que creó tal como nació (en borrador).
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
      text: `${c.statement}\nComprobación: ${c.check_text}`.slice(0, MAX_TEXT),
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
