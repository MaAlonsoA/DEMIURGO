// Efecto de aceptar cada tipo de propuesta. Se ejecuta con el actor humano que acepta, así que
// cada cambio de autoridad lleva su evento `human` (I1).

import { CARGAS, ErrorDominio, type TipoPropuesta } from '@demiurgo/domain';
import type { ContextoComando } from '../bus/tipos.ts';
import { resolverReferencia } from './registros.ts';

export type Efecto = Record<string, unknown>;
export type EntradaEfecto = { propuestaId: string; carga: unknown; aprobar: boolean };
export type Aplicacion = (ctx: ContextoComando, e: EntradaEfecto) => Promise<Efecto>;

async function crearRegistro(ctx: ContextoComando, datos: Record<string, unknown>, aprobar: boolean): Promise<Efecto> {
  const r = await ctx.ejecutar({ comando: 'record.create', actor: ctx.actor, datos });
  const res = r.resultado as { recordId: string; codigo: string; versionId: string };
  if (aprobar) await ctx.ejecutar({ comando: 'record_version.approve', actor: ctx.actor, entidadId: res.versionId, datos: {} });
  return { tipo: 'record', codigo: res.codigo, recordId: res.recordId, versionId: res.versionId, version: 1, aprobada: aprobar };
}

export const APLICACIONES: Partial<Record<TipoPropuesta, Aplicacion>> = {
  async decision(ctx, { propuestaId, carga, aprobar }) {
    const c = CARGAS.decision.parse(carga);
    return crearRegistro(
      ctx,
      {
        tipo: 'decision',
        dominio: c.dominio ?? 'producto',
        titulo: c.titulo,
        secciones: [
          { titulo: 'Contexto', contenido: c.contexto },
          { titulo: 'Decisión', contenido: c.decision },
          { titulo: 'Consecuencias', contenido: c.consecuencias },
        ],
        origen: { tipo: 'proposal', id: propuestaId },
      },
      aprobar,
    );
  },

  async exploracion(ctx, { propuestaId, carga }) {
    const c = CARGAS.exploracion.parse(carga);
    const r = await ctx.ejecutar({
      comando: 'exploration.open',
      actor: ctx.actor,
      datos: { proposito: c.proposito, origen: { tipo: 'proposal', id: propuestaId } },
    });
    return { tipo: 'exploration', id: r.entidadId };
  },

  async fdr(ctx, { propuestaId, carga, aprobar }) {
    const c = CARGAS.fdr.parse(carga);
    return crearRegistro(
      ctx,
      {
        tipo: 'fdr',
        dominio: c.dominio ?? 'producto',
        titulo: c.titulo,
        secciones: [
          { titulo: 'Objetivo', contenido: c.objetivo },
          { titulo: 'Alcance', contenido: c.alcance },
          { titulo: 'Fuera de alcance', contenido: c.fuera_de_alcance },
          { titulo: 'Comportamiento', contenido: c.comportamiento },
        ],
        criterios: c.criterios.map((k) => ({ arrastre: 'new', ...k })),
        enlaces: c.basado_en ? [{ tipo: 'based_on', destino: c.basado_en }] : [],
        origen: { tipo: 'proposal', id: propuestaId },
      },
      aprobar,
    );
  },

  // Aceptar una revisión propuesta por el conocimiento no cambia el registro: abre una
  // exploración para revisarlo, con su origen.
  async revision(ctx, { carga }) {
    const c = CARGAS.revision.parse(carga);
    const v = await resolverReferencia(ctx.trx, ctx.proyectoId, c.registro.codigo, c.registro.version);
    if (!v) throw new ErrorDominio('no_encontrado', `No existe ${c.registro.codigo}@${c.registro.version}.`);
    const r = await ctx.ejecutar({
      comando: 'exploration.open',
      actor: ctx.actor,
      datos: {
        proposito: `Revisar ${c.registro.codigo} v${c.registro.version}: ${c.motivo}`.slice(0, 1000),
        origen: { tipo: 'record_version', id: v.versionId, version: c.registro.version },
      },
    });
    return { tipo: 'exploration', id: r.entidadId };
  },
};

export function registrarAplicacion(tipo: TipoPropuesta, a: Aplicacion): void {
  APLICACIONES[tipo] = a;
}
