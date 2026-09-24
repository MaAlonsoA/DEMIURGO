// Importación de design/ (H1, AC-CON-001-10): el árbol entero entra como un lote pendiente de
// resolución en paquete, idempotente por la huella del árbol. Nada queda aprobado hasta que una
// persona ratifica el paquete; al ratificar, cada documento se crea con el estado de su archivo.
// Cada documento se compara con lo que ya hay en la v2 renderizándolo igual que la exportación:
// «no hay nada que importar» equivale a «la exportación no tiene diff».

import {
  CARPETAS,
  type DocumentoRegistro,
  type DocumentoTaxonomia,
  type InformeValidacion,
  renderizarDocumento,
  validarArbol,
} from '@demiurgo/design';
import { CARGAS, ErrorDominio, formatearActor, huella, sistema } from '@demiurgo/domain';
import { z } from 'zod';
import { campo, registrarGuardas } from '../bus/guardas.ts';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';
import type { ContextoComando } from '../bus/tipos.ts';
import type { Tx } from '../db/conexion.ts';
import { registrarAplicacion } from '../comandos/efectos.ts';
import { documentoDeTaxonomia, documentoDeVersion } from './exportar.ts';

export const IMPORTADOR = sistema('importador');

const ESTADO_VERSION: Record<string, string> = { propuesto: 'draft', aprobado: 'approved' };
const ESTADO_LEGIBLE: Record<string, string> = {
  draft: 'en borrador',
  approved: 'aprobada',
  superseded: 'sustituida',
  discarded: 'descartada',
};

export type DocumentoImportado = DocumentoRegistro & { anexosContenido: { ruta: string; contenido: string }[] };

/** Orden topológico: los destinos de los enlaces y de «Deriva de» antes que quienes los citan. */
function ordenar(registros: DocumentoRegistro[]): DocumentoRegistro[] {
  const porCodigo = new Map(registros.map((r) => [r.codigo, r]));
  const duenoDeAc = new Map(registros.flatMap((r) => r.criterios.map((c) => [c.codigo, r] as const)));
  const hecho = new Set<string>();
  const orden: DocumentoRegistro[] = [];
  const visitar = (r: DocumentoRegistro, pila: Set<string>) => {
    if (hecho.has(r.codigo) || pila.has(r.codigo)) return;
    pila.add(r.codigo);
    for (const e of r.enlaces) {
      const d = porCodigo.get(e.destino.codigo);
      if (d) visitar(d, pila);
    }
    for (const c of r.criterios) {
      const d = c.derivaDe ? duenoDeAc.get(c.derivaDe) : undefined;
      if (d && d !== r) visitar(d, pila);
    }
    hecho.add(r.codigo);
    orden.push(r);
  };
  for (const r of [...registros].sort((a, b) => (a.codigo < b.codigo ? -1 : 1))) visitar(r, new Set());
  return orden;
}

export type Recuentos = Record<
  'decision' | 'adr' | 'fdr' | 'bug' | 'versiones' | 'criterios' | 'enlaces' | 'taxonomias' | 'anexos',
  number
>;

export function recuentosDelArbol(registros: DocumentoRegistro[], taxonomias: DocumentoTaxonomia[]): Recuentos {
  return {
    decision: registros.filter((r) => r.tipo === 'decision').length,
    adr: registros.filter((r) => r.tipo === 'adr').length,
    fdr: registros.filter((r) => r.tipo === 'fdr').length,
    bug: registros.filter((r) => r.tipo === 'bug').length,
    // design/ guarda una versión por registro: la que está en curso.
    versiones: registros.length,
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

/** El texto de una versión de la v2 con otro estado: sirve para comparar solo el contenido. */
const contenidoDe = (doc: DocumentoRegistro | DocumentoTaxonomia) => renderizarDocumento({ ...doc, estado: 'propuesto' });

async function registroDe(trx: Tx, proyectoId: string, codigo: string) {
  return trx.selectFrom('records').selectAll().where('project_id', '=', proyectoId).where('code', '=', codigo).executeTakeFirst();
}

async function ultimaVersion(trx: Tx, recordId: string): Promise<number> {
  const v = await trx
    .selectFrom('record_versions')
    .select('n')
    .where('record_id', '=', recordId)
    .orderBy('n', 'desc')
    .executeTakeFirst();
  return v?.n ?? 0;
}

type Plan = { propuestas: { tipo: string; carga: Record<string, unknown> }[]; problemas: string[] };

/**
 * Qué proponer de cada documento según lo que ya hay en la v2: nada si coincide (contenido y
 * estado), la aprobación si solo cambia el estado de propuesto a aprobado, o una versión nueva.
 * Una versión que ya existe con otro contenido, o anterior a la última, es un problema.
 */
async function planificar(ctx: ContextoComando, arbol: Map<string, string>, informe: InformeValidacion): Promise<Plan> {
  const plan: Plan = { propuestas: [], problemas: [] };
  const versionEnDiseno = new Map(informe.registros.map((r) => [r.codigo, r.version]));
  for (const r of ordenar(informe.registros)) {
    const ruta = `${CARPETAS[r.tipo]}/${r.codigo}.md`;
    // Un enlace a una versión anterior de su destino exige que esa versión ya esté en la v2.
    for (const e of r.enlaces) {
      if (e.destino.version >= (versionEnDiseno.get(e.destino.codigo) ?? 0)) continue;
      const destino = await registroDe(ctx.trx, ctx.proyectoId, e.destino.codigo);
      const existe =
        destino &&
        (await ctx.trx
          .selectFrom('record_versions')
          .select('id')
          .where('record_id', '=', destino.id)
          .where('n', '=', e.destino.version)
          .executeTakeFirst());
      if (!existe) {
        plan.problemas.push(
          `${ruta}: el enlace a ${e.destino.codigo}@${e.destino.version} apunta a una versión que no está en design/ ni en la v2.`,
        );
      }
    }
    const documento: DocumentoImportado = {
      ...r,
      anexosContenido: r.anexos.map((a) => ({ ruta: a, contenido: arbol.get(a) ?? '' })),
    };
    const registro = await registroDe(ctx.trx, ctx.proyectoId, r.codigo);
    if (registro) {
      const v = await ctx.trx
        .selectFrom('record_versions')
        .selectAll()
        .where('record_id', '=', registro.id)
        .where('n', '=', r.version)
        .executeTakeFirst();
      if (v) {
        const enLaV2 = await documentoDeVersion(ctx.trx, registro, v);
        const anexosIguales = JSON.stringify(enLaV2.anexos) === JSON.stringify(documento.anexosContenido);
        if (contenidoDe(enLaV2.doc) !== contenidoDe(r) || !anexosIguales) {
          plan.problemas.push(
            `${ruta}: la versión ${r.version} ya está en la v2 con otro contenido; sube la versión y añade nota_de_cambio.`,
          );
          continue;
        }
        if (v.state === ESTADO_VERSION[r.estado]) continue;
        if (!(v.state === 'draft' && r.estado === 'aprobado')) {
          plan.problemas.push(
            `${ruta}: la versión ${r.version} está ${ESTADO_LEGIBLE[v.state] ?? v.state} en la v2 y no puede pasar a «${r.estado}».`,
          );
          continue;
        }
      } else {
        const ultima = await ultimaVersion(ctx.trx, registro.id);
        if (r.version < ultima) {
          plan.problemas.push(`${ruta}: la versión ${r.version} es anterior a la última de la v2 (${ultima}).`);
          continue;
        }
      }
    }
    plan.propuestas.push({ tipo: 'registro_importado', carga: { documento, ruta } });
  }
  for (const t of informe.taxonomias) {
    const ruta = `${CARPETAS.taxonomia}/${t.codigo}.md`;
    const existente = await ctx.trx
      .selectFrom('taxonomies')
      .selectAll()
      .where('project_id', '=', ctx.proyectoId)
      .where('code', '=', t.codigo)
      .where('version', '=', t.version)
      .executeTakeFirst();
    if (existente) {
      if (contenidoDe(documentoDeTaxonomia(existente)) !== contenidoDe(t)) {
        plan.problemas.push(`${ruta}: la versión ${t.version} ya está en la v2 con otro contenido; sube la versión.`);
        continue;
      }
      if (existente.state === ESTADO_VERSION[t.estado]) continue;
      if (!(existente.state === 'draft' && t.estado === 'aprobado')) {
        plan.problemas.push(
          `${ruta}: la versión ${t.version} está ${ESTADO_LEGIBLE[existente.state] ?? existente.state} en la v2 y no puede pasar a «${t.estado}».`,
        );
        continue;
      }
    } else {
      const ultima = await ctx.trx
        .selectFrom('taxonomies')
        .select('version')
        .where('project_id', '=', ctx.proyectoId)
        .where('code', '=', t.codigo)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      if (ultima && t.version < ultima.version) {
        plan.problemas.push(`${ruta}: la versión ${t.version} es anterior a la última de la v2 (${ultima.version}).`);
        continue;
      }
    }
    plan.propuestas.push({ tipo: 'taxonomia_importada', carga: { documento: t, ruta } });
  }
  return plan;
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
      const { propuestas, problemas } = await planificar(ctx, arbol, informe);
      if (problemas.length > 0) {
        throw new ErrorDominio('guarda', 'design/ no se puede importar sobre lo que ya hay en la v2.', problemas);
      }
      if (propuestas.length === 0) {
        throw new ErrorDominio('conflicto', 'design/ ya está importado: no hay nada nuevo que proponer.');
      }
      // Una importación nueva deja obsoleta la que siguiera pendiente: solo se ratifica la última.
      const pendientes = await ctx.trx
        .selectFrom('proposal_batches')
        .select('id')
        .where('project_id', '=', ctx.proyectoId)
        .where('kind', '=', 'import')
        .where('state', '=', 'pending')
        .execute();
      for (const p of pendientes) {
        await ctx.ejecutar({
          comando: 'batch.supersede',
          actor: IMPORTADOR,
          entidadId: p.id,
          datos: { motivo: 'Hay una importación más reciente de design/.' },
        });
      }
      // El importador produce las propuestas; quien importa (persona o CLI) queda en el evento de la importación.
      const { id } = await ctx.trx
        .insertInto('proposal_batches')
        .values({
          project_id: ctx.proyectoId,
          kind: 'import',
          producer: formatearActor(IMPORTADOR),
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
          actor: IMPORTADOR,
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

function sinCambiosDesdeLaImportacion(codigo: string, version: number): ErrorDominio {
  return new ErrorDominio('conflicto', `${codigo} v${version} cambió en la v2 después de importar: vuelve a importar design/.`);
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
    ...(c.derivaDe ? { deriva_de: c.derivaDe } : {}),
  }));
  let registro = await registroDe(ctx.trx, ctx.proyectoId, d.codigo);
  const existente = registro
    ? await ctx.trx
        .selectFrom('record_versions')
        .selectAll()
        .where('record_id', '=', registro.id)
        .where('n', '=', d.version)
        .executeTakeFirst()
    : undefined;
  let versionId: string;
  if (registro && existente) {
    // Solo cambia el estado: se comprueba que el contenido sigue siendo el importado.
    if (contenidoDe((await documentoDeVersion(ctx.trx, registro, existente)).doc) !== contenidoDe(d)) {
      throw sinCambiosDesdeLaImportacion(d.codigo, d.version);
    }
    versionId = existente.id;
  } else if (!registro) {
    const r = await ctx.ejecutar({
      comando: 'record.create',
      actor: ctx.actor,
      datos: { tipo: d.tipo, codigo: d.codigo, dominio: d.dominio, criterios: criteriosNuevos, ...contenido },
    });
    versionId = (r.resultado as { versionId: string }).versionId;
    registro = await registroDe(ctx.trx, ctx.proyectoId, d.codigo);
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
  const v = await ctx.trx
    .selectFrom('record_versions')
    .select(['n', 'state'])
    .where('id', '=', versionId)
    .executeTakeFirstOrThrow();
  if (d.estado === 'aprobado' && v.state === 'draft') {
    await ctx.ejecutar({ comando: 'record_version.approve', actor: ctx.actor, entidadId: versionId, datos: {} });
  }
  const estado = d.estado === 'aprobado' ? 'approved' : v.state;
  return { tipo: 'record', codigo: d.codigo, recordId: registro?.id ?? null, versionId, version: v.n, estado };
});

registrarAplicacion('taxonomia_importada', async (ctx, { carga }) => {
  const t = CARGAS.taxonomia_importada.parse(carga).documento as unknown as DocumentoTaxonomia;
  const existente = await ctx.trx
    .selectFrom('taxonomies')
    .selectAll()
    .where('project_id', '=', ctx.proyectoId)
    .where('code', '=', t.codigo)
    .where('version', '=', t.version)
    .executeTakeFirst();
  let id: string;
  let estado: string;
  if (existente) {
    // Solo cambia el estado (propuesto → aprobado): se aprueba la versión que ya está.
    if (contenidoDe(documentoDeTaxonomia(existente)) !== contenidoDe(t)) throw sinCambiosDesdeLaImportacion(t.codigo, t.version);
    id = existente.id;
    estado = existente.state;
  } else {
    const r = await ctx.ejecutar({
      comando: 'taxonomy.propose',
      actor: ctx.actor,
      datos: { codigo: t.codigo, titulo: t.titulo, ejes: t.ejes, secciones: t.secciones, version: t.version },
    });
    id = r.entidadId;
    estado = r.estado;
  }
  if (t.estado === 'aprobado' && estado === 'draft') {
    await ctx.ejecutar({ comando: 'taxonomy.approve', actor: ctx.actor, entidadId: id, datos: {} });
  }
  return { tipo: 'taxonomy', codigo: t.codigo, taxonomiaId: id, version: t.version };
});
