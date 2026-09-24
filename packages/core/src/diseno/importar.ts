// Importación de design/ (H1, AC-CON-001-10): el árbol entero entra como un lote pendiente de
// resolución en paquete, idempotente por la huella del árbol. Nada queda aprobado hasta que una
// persona ratifica el paquete; al ratificar, cada documento se crea con el estado de su archivo.

import { CARPETAS, type DocumentoRegistro, type DocumentoTaxonomia, validarArbol } from '@demiurgo/design';
import { CARGAS, ErrorDominio, formatearActor, huella, sistema } from '@demiurgo/domain';
import { z } from 'zod';
import { campo, registrarGuardas } from '../bus/guardas.ts';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';
import type { ContextoComando } from '../bus/tipos.ts';
import type { Tx } from '../db/conexion.ts';
import { registrarAplicacion } from '../comandos/efectos.ts';

export const IMPORTADOR = sistema('importador');

const ESTADO_VERSION: Record<string, string> = {
  propuesto: 'draft',
  aprobado: 'approved',
  sustituido: 'superseded',
  descartado: 'discarded',
};

export type DocumentoImportado = DocumentoRegistro & { anexosContenido: { ruta: string; contenido: string }[] };

/** Huella del contenido de una versión, igual que la que calcula `record_version.create`. */
export function hashContenidoDocumento(d: DocumentoImportado): string {
  return huella({
    titulo: d.titulo,
    secciones: d.secciones,
    criterios: d.criterios.map((c) => ({
      codigo: c.codigo,
      titulo: c.titulo,
      enunciado: c.enunciado,
      verificacion: c.verificacion === 'automática' ? 'automatic' : 'manual',
      comprobacion: c.comprobacion,
    })),
    anexos: d.anexosContenido,
    incremento: d.incremento ?? null,
  });
}

/** Orden topológico: los destinos de los enlaces antes que quienes los enlazan. */
function ordenar(registros: DocumentoRegistro[]): DocumentoRegistro[] {
  const porCodigo = new Map(registros.map((r) => [r.codigo, r]));
  const hecho = new Set<string>();
  const orden: DocumentoRegistro[] = [];
  const visitar = (r: DocumentoRegistro, pila: Set<string>) => {
    if (hecho.has(r.codigo) || pila.has(r.codigo)) return;
    pila.add(r.codigo);
    for (const e of r.enlaces) {
      const d = porCodigo.get(e.destino.codigo);
      if (d) visitar(d, pila);
    }
    hecho.add(r.codigo);
    orden.push(r);
  };
  for (const r of [...registros].sort((a, b) => (a.codigo < b.codigo ? -1 : 1))) visitar(r, new Set());
  return orden;
}

export type Recuentos = Record<'decision' | 'adr' | 'fdr' | 'bug' | 'criterios' | 'enlaces' | 'taxonomias' | 'anexos', number>;

export function recuentosDelArbol(registros: DocumentoRegistro[], taxonomias: DocumentoTaxonomia[]): Recuentos {
  return {
    decision: registros.filter((r) => r.tipo === 'decision').length,
    adr: registros.filter((r) => r.tipo === 'adr').length,
    fdr: registros.filter((r) => r.tipo === 'fdr').length,
    bug: registros.filter((r) => r.tipo === 'bug').length,
    criterios: registros.reduce((n, r) => n + r.criterios.length, 0),
    enlaces: registros.reduce((n, r) => n + r.enlaces.length, 0),
    taxonomias: taxonomias.length,
    anexos: registros.reduce((n, r) => n + r.anexos.length, 0),
  };
}

registrarGuardas({
  diseno_valido: ({ datos }) => {
    const arbol = campo(datos, 'arbol') as Record<string, string> | undefined;
    if (!arbol || typeof arbol !== 'object') return 'Falta el árbol de design/.';
    const informe = validarArbol(new Map(Object.entries(arbol)));
    if (informe.problemas.length === 0) return null;
    return `design/ no es válido: ${informe.problemas
      .slice(0, 10)
      .map((p) => `${p.ruta}: ${p.mensaje}`)
      .join(' · ')}`;
  },
});

async function versionConContenido(trx: Tx, proyectoId: string, codigo: string, hash: string) {
  return trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.id', 'record_versions.state', 'record_versions.n'])
    .where('records.project_id', '=', proyectoId)
    .where('records.code', '=', codigo)
    .where('record_versions.content_hash', '=', hash)
    .executeTakeFirst();
}

registrarManejadores({
  'design.import': manejador({
    datos: z.object({ arbol: z.record(z.string(), z.string()), origen: z.string().max(200).optional() }).strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const arbol = new Map(Object.entries(datos.arbol).sort(([a], [b]) => (a < b ? -1 : 1)));
      const hashArbol = huella([...arbol.entries()]);
      const previa = await ctx.trx
        .selectFrom('proposal_batches')
        .select(['id', 'state'])
        .where('project_id', '=', ctx.proyectoId)
        .where('kind', '=', 'import')
        .where('tree_hash', '=', hashArbol)
        .where('state', 'in', ['pending', 'accepted'])
        .executeTakeFirst();
      if (previa)
        return { entidadId: previa.id, sinCambios: true, resultado: { loteId: previa.id, repetida: true, estado: previa.state } };
      const informe = validarArbol(arbol);
      const recuentos = recuentosDelArbol(informe.registros, informe.taxonomias);
      const propuestas: { tipo: string; carga: Record<string, unknown> }[] = [];
      for (const r of ordenar(informe.registros)) {
        const documento: DocumentoImportado = {
          ...r,
          anexosContenido: r.anexos.map((ruta) => ({ ruta, contenido: arbol.get(ruta) ?? '' })),
        };
        const existente = await versionConContenido(ctx.trx, ctx.proyectoId, r.codigo, hashContenidoDocumento(documento));
        // Idéntico y en el mismo estado: no hay nada que importar.
        if (existente && existente.state === ESTADO_VERSION[r.estado]) continue;
        propuestas.push({ tipo: 'registro_importado', carga: { documento, ruta: `${CARPETAS[r.tipo]}/${r.codigo}.md` } });
      }
      for (const t of informe.taxonomias) {
        const hash = huella({ titulo: t.titulo, ejes: t.ejes, secciones: t.secciones });
        const existente = await ctx.trx
          .selectFrom('taxonomies')
          .select('state')
          .where('project_id', '=', ctx.proyectoId)
          .where('code', '=', t.codigo)
          .where('content_hash', '=', hash)
          .executeTakeFirst();
        if (existente && existente.state === ESTADO_VERSION[t.estado]) continue;
        propuestas.push({ tipo: 'taxonomia_importada', carga: { documento: t, ruta: `${CARPETAS.taxonomia}/${t.codigo}.md` } });
      }
      if (propuestas.length === 0) {
        throw new ErrorDominio('conflicto', 'design/ ya está importado: no hay nada nuevo que proponer.');
      }
      const { id } = await ctx.trx
        .insertInto('proposal_batches')
        .values({
          project_id: ctx.proyectoId,
          kind: 'import',
          producer: formatearActor(ctx.actor),
          run_id: null,
          context_pack_id: null,
          resolution_mode: 'package',
          dependencies: JSON.stringify([]),
          summary: `Importación de design/${datos.origen ? ` (${datos.origen})` : ''}: ${JSON.stringify(recuentos)}`,
          tree_hash: hashArbol,
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [i, p] of propuestas.entries()) {
        await ctx.ejecutar({
          comando: 'proposal.create',
          actor: ctx.actor,
          datos: { lote_id: id, posicion: i + 1, tipo: p.tipo, carga: p.carga },
        });
      }
      return {
        entidadId: id,
        despues: { recuentos, propuestas: propuestas.length, hash: hashArbol },
        resultado: { loteId: id, recuentos, propuestas: propuestas.length },
      };
    },
  }),
});

async function aplicarEstado(ctx: ContextoComando, versionId: string, estado: string): Promise<void> {
  const v = await ctx.trx.selectFrom('record_versions').select('state').where('id', '=', versionId).executeTakeFirstOrThrow();
  if (estado === 'aprobado' && v.state === 'draft')
    await ctx.ejecutar({ comando: 'record_version.approve', actor: ctx.actor, entidadId: versionId, datos: {} });
  if (estado === 'descartado' && v.state === 'draft')
    await ctx.ejecutar({ comando: 'record_version.discard', actor: ctx.actor, entidadId: versionId, datos: {} });
}

// Ratificar: cada documento se crea (o se versiona) con la persona como actor y el estado de su archivo.
registrarAplicacion('registro_importado', async (ctx, { propuestaId, carga }) => {
  const d = CARGAS.registro_importado.parse(carga).documento as unknown as DocumentoImportado;
  const contenido = {
    titulo: d.titulo,
    secciones: d.secciones,
    enlaces: d.enlaces.map((e) => ({ tipo: e.tipo, destino: e.destino })),
    anexos: d.anexosContenido,
    ...(d.incremento ? { incremento: d.incremento } : {}),
    ...(d.notaDeCambio ? { nota_de_cambio: d.notaDeCambio } : {}),
    origen: { tipo: 'proposal', id: propuestaId },
    numero: d.version,
  };
  const criteriosNuevos = d.criterios.map((c) => ({
    arrastre: 'new' as const,
    codigo: c.codigo,
    titulo: c.titulo,
    enunciado: c.enunciado,
    verificacion: c.verificacion === 'automática' ? 'automatic' : 'manual',
    comprobacion: c.comprobacion,
  }));
  const registro = await ctx.trx
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', ctx.proyectoId)
    .where('code', '=', d.codigo)
    .executeTakeFirst();
  let versionId: string;
  const existente = await versionConContenido(ctx.trx, ctx.proyectoId, d.codigo, hashContenidoDocumento(d));
  if (existente) {
    versionId = existente.id;
  } else if (!registro) {
    const r = await ctx.ejecutar({
      comando: 'record.create',
      actor: ctx.actor,
      datos: { tipo: d.tipo, codigo: d.codigo, dominio: d.dominio, criterios: criteriosNuevos, ...contenido },
    });
    versionId = (r.resultado as { versionId: string }).versionId;
  } else {
    // Versión nueva: los criterios que siguen se mantienen o modifican por su código; el resto se descarta.
    const base = await ctx.trx
      .selectFrom('record_versions')
      .select('id')
      .where('record_id', '=', registro.id)
      .where('state', '<>', 'discarded')
      .orderBy('n', 'desc')
      .executeTakeFirstOrThrow();
    const previos = await ctx.trx.selectFrom('criteria').selectAll().where('record_version_id', '=', base.id).execute();
    const porCodigo = new Map(previos.map((p) => [p.code, p]));
    const criterios = criteriosNuevos.map((c) => {
      const p = porCodigo.get(c.codigo);
      if (!p) return c;
      const igual =
        p.title === c.titulo &&
        p.statement === c.enunciado &&
        p.verification === c.verificacion &&
        p.check_text === c.comprobacion;
      return igual
        ? { arrastre: 'kept' as const, codigo: c.codigo }
        : {
            arrastre: 'modified' as const,
            deriva_de: c.codigo,
            titulo: c.titulo,
            enunciado: c.enunciado,
            verificacion: c.verificacion,
            comprobacion: c.comprobacion,
          };
    });
    const codigos = new Set(d.criterios.map((c) => c.codigo));
    const r = await ctx.ejecutar({
      comando: 'record_version.create',
      actor: ctx.actor,
      datos: {
        record_id: registro.id,
        criterios,
        descartados: previos.map((p) => p.code).filter((c) => !codigos.has(c)),
        ...contenido,
        nota_de_cambio: d.notaDeCambio ?? 'Importado de design/.',
      },
    });
    versionId = r.entidadId;
  }
  await aplicarEstado(ctx, versionId, d.estado);
  const v = await ctx.trx
    .selectFrom('record_versions')
    .select(['n', 'state'])
    .where('id', '=', versionId)
    .executeTakeFirstOrThrow();
  return { tipo: 'record', codigo: d.codigo, recordId: registro?.id ?? null, versionId, version: v.n, estado: v.state };
});

registrarAplicacion('taxonomia_importada', async (ctx, { carga }) => {
  const t = CARGAS.taxonomia_importada.parse(carga).documento as unknown as DocumentoTaxonomia;
  const r = await ctx.ejecutar({
    comando: 'taxonomy.propose',
    actor: ctx.actor,
    datos: { codigo: t.codigo, titulo: t.titulo, ejes: t.ejes, secciones: t.secciones, version: t.version },
  });
  if (t.estado === 'aprobado')
    await ctx.ejecutar({ comando: 'taxonomy.approve', actor: ctx.actor, entidadId: r.entidadId, datos: {} });
  return { tipo: 'taxonomy', codigo: t.codigo, taxonomiaId: r.entidadId, version: t.version };
});
