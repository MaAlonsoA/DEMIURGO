// Derivación determinista de un cambio de autoridad a nodos y aristas (sin clasificador).
// La autoridad es inmutable por versión (contenido, criterios y enlaces nacen con ella), así que
// derivar el mismo disparo da el mismo cambio ahora y en una reconstrucción: nunca se mira el
// estado actual de la versión.

import type { Cambio } from '@demiurgo/domain';
import type { Bd } from '../db/conexion.ts';

export type ObjetoAutoridad = { tipo: string; id: string; version: number | null };

export { DISPARO_DESCARTE } from '../comandos/reacciones.ts';

/** Refs que retira el descarte de una versión (el nodo del borrador; sus criterios van con él). */
export async function derivarRetirada(db: Bd, objeto: ObjetoAutoridad): Promise<string[]> {
  const v = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.n', 'records.code'])
    .where('record_versions.id', '=', objeto.id)
    .executeTakeFirst();
  return v ? [`${v.code}@${v.n}`] : [];
}

const TEXTO_MAX = 4000;

export async function derivarCambio(db: Bd, objeto: ObjetoAutoridad): Promise<Cambio | null> {
  let versionId: string | null = null;
  if (objeto.tipo === 'record_version') versionId = objeto.id;
  if (objeto.tipo === 'proposal') {
    const p = await db.selectFrom('proposals').select(['state', 'resolution']).where('id', '=', objeto.id).executeTakeFirst();
    const efecto = (p?.resolution as { efecto?: { versionId?: string } } | null)?.efecto;
    versionId = efecto?.versionId ?? null;
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
  const aprobada = objeto.tipo === 'record_version';
  const secciones = v.sections as { titulo: string; contenido: string }[];
  const ref = `${v.code}@${v.n}`;
  const criterios = await db
    .selectFrom('criteria')
    .select(['code', 'title', 'statement', 'check_text'])
    .where('record_version_id', '=', v.id)
    .orderBy('position')
    .execute();
  const enlaces = await db
    .selectFrom('links')
    .innerJoin('record_versions as destino', 'destino.id', 'links.to_id')
    .innerJoin('records as rd', 'rd.id', 'destino.record_id')
    .select(['links.type', 'rd.code', 'destino.n'])
    .where('links.from_id', '=', v.id)
    .orderBy('links.id')
    .execute();
  const otras = aprobada
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
  const epistemico = aprobada ? 'confirmado' : 'propuesto';
  return {
    principal: {
      ref,
      tipo: v.type,
      etiqueta: v.title,
      texto: secciones
        .map((s) => `${s.titulo}: ${s.contenido}`)
        .join('\n')
        .slice(0, TEXTO_MAX),
      epistemico,
      autoridad: true,
      origen: { tipo: 'record_version', id: v.id, version: v.n },
    },
    acompañantes: criterios.map((c) => ({
      ref: `${c.code}@${v.n}`,
      tipo: 'criterio',
      etiqueta: c.title,
      texto: `${c.statement}\nComprobación: ${c.check_text}`.slice(0, TEXTO_MAX),
      epistemico,
      autoridad: true,
      origen: { tipo: 'record_version', id: v.id, version: v.n },
    })),
    aristas: [
      ...criterios.map((c) => ({ tipo: 'contiene', desde: ref, hacia: `${c.code}@${v.n}` })),
      ...enlaces.map((e) => ({ tipo: e.type, desde: ref, hacia: `${e.code}@${e.n}` })),
    ],
    sustituye: otras,
  };
}
