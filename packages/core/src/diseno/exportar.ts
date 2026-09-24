// Exportación de design/ desde la v2 (H1): la última versión no descartada de cada registro y
// de cada taxonomía, en el formato canónico, más sus anexos y el README fijo. Justo después de
// ratificar una importación, coincide byte a byte con el árbol importado.

import {
  CARPETAS,
  type DocumentoRegistro,
  type DocumentoTaxonomia,
  type EstadoDocumento,
  README_DISENO,
  type TipoRegistro,
  diferencias,
  renderizarDocumento,
} from '@demiurgo/design';
import type { Selectable } from 'kysely';
import type { Bd } from '../db/conexion.ts';
import type { BD } from '../db/esquema.ts';

// design/ guarda la versión en curso de cada registro, que está en borrador o aprobada.
const ESTADO_DOCUMENTO: Record<string, EstadoDocumento> = { draft: 'propuesto', approved: 'aprobado' };

type Fila<T extends keyof BD> = Selectable<BD[T]>;

/** Documento de design/ de una versión concreta de un registro, tal como se exporta. */
export async function documentoDeVersion(
  db: Bd,
  r: Fila<'records'>,
  v: Fila<'record_versions'>,
): Promise<{ doc: DocumentoRegistro; anexos: { ruta: string; contenido: string }[] }> {
  const criterios = await db
    .selectFrom('criteria')
    .selectAll()
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
  const anexos = (v.annexes ?? []) as { ruta: string; contenido: string }[];
  // «Deriva de» solo se escribe en un criterio nuevo: al mantener o modificar deriva del mismo código.
  const derivaDe = new Map<string, string>();
  for (const c of criterios) {
    if (c.carry !== 'new' || !c.derived_from) continue;
    const origen = await db.selectFrom('criteria').select('code').where('id', '=', c.derived_from).executeTakeFirstOrThrow();
    derivaDe.set(c.id, origen.code);
  }
  const doc: DocumentoRegistro = {
    clase: 'registro',
    tipo: r.type as TipoRegistro,
    codigo: r.code,
    titulo: v.title,
    version: v.n,
    estado: ESTADO_DOCUMENTO[v.state] ?? 'propuesto',
    dominio: r.domain,
    enlaces: enlaces.map((e) => ({
      tipo: e.type as DocumentoRegistro['enlaces'][number]['tipo'],
      destino: { codigo: e.code, version: e.n },
    })),
    anexos: anexos.map((a) => a.ruta),
    secciones: v.sections as { titulo: string; contenido: string }[],
    criterios: criterios.map((c) => ({
      codigo: c.code,
      titulo: c.title,
      verificacion: c.verification === 'automatic' ? 'automática' : 'manual',
      comprobacion: c.check_text,
      enunciado: c.statement,
      ...(derivaDe.has(c.id) ? { derivaDe: derivaDe.get(c.id) } : {}),
    })),
  };
  if (v.increment) doc.incremento = v.increment;
  if (v.change_note) doc.notaDeCambio = v.change_note;
  return { doc, anexos };
}

/** Documento de design/ de una versión concreta de una taxonomía. */
export function documentoDeTaxonomia(t: Fila<'taxonomies'>): DocumentoTaxonomia {
  return {
    clase: 'taxonomia',
    codigo: t.code,
    titulo: t.title,
    version: t.version,
    estado: ESTADO_DOCUMENTO[t.state] ?? 'propuesto',
    ejes: t.axes as DocumentoTaxonomia['ejes'],
    secciones: t.sections as DocumentoTaxonomia['secciones'],
  };
}

export async function exportarDiseno(db: Bd, proyectoId: string): Promise<Map<string, string>> {
  const arbol = new Map<string, string>([['README.md', README_DISENO]]);
  const registros = await db.selectFrom('records').selectAll().where('project_id', '=', proyectoId).orderBy('code').execute();
  for (const r of registros) {
    const v = await db
      .selectFrom('record_versions')
      .selectAll()
      .where('record_id', '=', r.id)
      .where('state', '<>', 'discarded')
      .orderBy('n', 'desc')
      .executeTakeFirst();
    if (!v) continue;
    const { doc, anexos } = await documentoDeVersion(db, r, v);
    arbol.set(`${CARPETAS[doc.tipo]}/${doc.codigo}.md`, renderizarDocumento(doc));
    for (const a of anexos) arbol.set(a.ruta, a.contenido);
  }
  const taxonomias = await db
    .selectFrom('taxonomies')
    .selectAll()
    .where('project_id', '=', proyectoId)
    .where('state', '<>', 'discarded')
    .orderBy('code')
    .orderBy('version', 'desc')
    .execute();
  const vistas = new Set<string>();
  for (const t of taxonomias) {
    if (vistas.has(t.code)) continue;
    vistas.add(t.code);
    arbol.set(`${CARPETAS.taxonomia}/${t.code}.md`, renderizarDocumento(documentoDeTaxonomia(t)));
  }
  return arbol;
}

/** Diferencias entre la exportación y un árbol (vacío si coinciden byte a byte). */
export async function compararExportacion(db: Bd, proyectoId: string, arbol: ReadonlyMap<string, string>): Promise<string[]> {
  return diferencias(arbol, await exportarDiseno(db, proyectoId));
}
