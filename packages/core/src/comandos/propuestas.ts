// Lotes y propuestas: el canal por el que la IA (y la importación) proponen y la persona
// decide. Nada llega a `accepted` sin un evento de actor human (I1).

import {
  CARGAS,
  ErrorDominio,
  MAX_PROPUESTAS_AGENTE_EXTERNO,
  type TipoPropuesta,
  esTipoPropuesta,
  esquemaDependencia,
  formatearActor,
  sistema,
} from '@demiurgo/domain';
import { z } from 'zod';
import { cadena, campo, registrarGuardas } from '../bus/guardas.ts';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';
import type { ContextoComando, EntidadCargada } from '../bus/tipos.ts';
import type { Bd, Tx } from '../db/conexion.ts';
import { APLICACIONES, type Efecto } from './efectos.ts';
import { alEventoDeAutoridad } from './reacciones.ts';

const uuid = z.string().uuid();

const esquemaPropuestaEntrada = z
  .object({ tipo: z.string(), carga: z.record(z.string(), z.unknown()), dependencias: z.array(esquemaDependencia).default([]) })
  .strict();

type Dependencia = z.infer<typeof esquemaDependencia>;

/** Motivos de obsolescencia: dependencias cuyo registro ya no tiene esa versión vigente. */
export async function dependenciasCaducadas(trx: Bd, deps: readonly Dependencia[]): Promise<string[]> {
  const motivos: string[] = [];
  for (const d of deps) {
    const vigente = await trx
      .selectFrom('record_versions')
      .select('n')
      .where('record_id', '=', d.id)
      .where('state', '=', 'approved')
      .orderBy('n', 'desc')
      .executeTakeFirst();
    if (vigente?.n !== d.version) {
      motivos.push(
        `La propuesta está obsoleta: ${d.codigo} ha cambiado (vigente: ${vigente ? `v${vigente.n}` : 'ninguna'}; la propuesta partía de v${d.version}).`,
      );
    }
  }
  return motivos;
}

async function loteDe(trx: Tx, entidad: EntidadCargada | null) {
  const loteId = cadena(entidad?.fila.batch_id) || (entidad?.id ?? '');
  return trx.selectFrom('proposal_batches').selectAll().where('id', '=', loteId).executeTakeFirstOrThrow();
}

registrarGuardas({
  // Una propuesta solo nace dentro del envío de su lote (o de la importación), en un lote
  // pendiente del mismo productor: nadie añade propuestas a un lote ajeno o ya resuelto.
  lote_propio_abierto: async ({ ctx, datos }) => {
    if (!['batch.submit', 'design.import'].includes(ctx.causa.comandoOrigen ?? '')) {
      return 'Las propuestas se envían dentro de un lote (batch.submit).';
    }
    const lote = await ctx.trx
      .selectFrom('proposal_batches')
      .select(['producer', 'state'])
      .where('id', '=', cadena(campo(datos, 'lote_id')))
      .where('project_id', '=', ctx.proyectoId)
      .executeTakeFirst();
    if (!lote) return 'El lote no existe.';
    if (lote.state !== 'pending') return 'El lote ya está resuelto.';
    return lote.producer === formatearActor(ctx.actor) ? null : 'Solo el productor del lote puede añadirle propuestas.';
  },

  lote_de_agente_externo_max_10: ({ ctx, datos }) => {
    const n = (campo(datos, 'propuestas') as unknown[] | undefined)?.length ?? 0;
    if (ctx.actor.tipo === 'agent_external' && n > MAX_PROPUESTAS_AGENTE_EXTERNO) {
      return `Un agente externo propone como máximo ${MAX_PROPUESTAS_AGENTE_EXTERNO} elementos por lote (hay ${n}).`;
    }
    return null;
  },

  carga_valida: ({ ctx, datos }) => {
    const tipo = cadena(campo(datos, 'tipo'));
    if (!esTipoPropuesta(tipo)) return `Tipo de propuesta desconocido: «${tipo}».`;
    if (ctx.actor.tipo === 'agent_external' && !['decision', 'exploracion', 'fdr'].includes(tipo)) {
      return `Un agente externo no puede proponer «${tipo}».`;
    }
    const r = CARGAS[tipo].safeParse(campo(datos, 'carga'));
    return r.success
      ? null
      : `La propuesta no es válida: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  },

  edicion_valida: async ({ ctx, datos, entidad }) => {
    const tipo = cadena(entidad?.fila.type) as TipoPropuesta;
    if (!esTipoPropuesta(tipo)) return 'Tipo de propuesta desconocido.';
    const r = CARGAS[tipo].safeParse(campo(datos, 'edicion'));
    void ctx;
    return r.success
      ? null
      : `La edición no es válida: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  },

  resolucion_por_elemento: async ({ ctx, entidad }) => {
    const lote = await loteDe(ctx.trx, entidad);
    const porPaquete = ['batch.accept_package', 'batch.reject_package'].includes(ctx.causa.comandoOrigen ?? '');
    if (lote.resolution_mode === 'package' && !porPaquete) {
      return 'Esta propuesta forma parte de un paquete: se acepta o se rechaza el paquete completo.';
    }
    return null;
  },

  resolucion_en_paquete: async ({ ctx, entidad }) => {
    const lote = await loteDe(ctx.trx, entidad);
    return lote.resolution_mode === 'package' ? null : 'Este lote se resuelve elemento a elemento.';
  },

  dependencias_vigentes: async ({ ctx, entidad }) => {
    if (!entidad) return null;
    const esLote = ctx.comando.startsWith('batch.');
    const lote = await loteDe(ctx.trx, entidad);
    const deps = [...((lote.dependencies ?? []) as Dependencia[])];
    if (esLote) {
      const propuestas = await ctx.trx
        .selectFrom('proposals')
        .select('dependencies')
        .where('batch_id', '=', lote.id)
        .where('state', '=', 'pending')
        .execute();
      for (const p of propuestas) deps.push(...((p.dependencies ?? []) as Dependencia[]));
    } else {
      deps.push(...((entidad.fila.dependencies ?? []) as Dependencia[]));
    }
    const motivos = await dependenciasCaducadas(ctx.trx, deps);
    return motivos.length ? [...new Set(motivos)].join(' ') : null;
  },

  todas_las_propuestas_resueltas: async ({ ctx, entidad }) => {
    const pendientes = await ctx.trx
      .selectFrom('proposals')
      .select('id')
      .where('batch_id', '=', entidad?.id ?? '')
      .where('state', '=', 'pending')
      .execute();
    return pendientes.length === 0 ? null : `Quedan ${pendientes.length} propuesta(s) pendiente(s) en el lote.`;
  },
});

/** Cierra un lote por elementos cuando ya no le quedan propuestas pendientes. */
/** `resolviendo` es la propuesta que se está resolviendo ahora: su estado cambia al terminar el comando. */
async function cerrarSiResuelto(ctx: ContextoComando, loteId: string, resolviendo: string): Promise<void> {
  // Si la resolución viene del propio lote (paquete u obsolescencia), el lote cambia de estado él mismo.
  if (['batch.accept_package', 'batch.reject_package', 'batch.supersede'].includes(ctx.causa.comandoOrigen ?? '')) return;
  const lote = await ctx.trx
    .selectFrom('proposal_batches')
    .select(['state', 'resolution_mode'])
    .where('id', '=', loteId)
    .executeTakeFirstOrThrow();
  if (lote.state !== 'pending' || lote.resolution_mode !== 'item') return;
  const pendientes = await ctx.trx
    .selectFrom('proposals')
    .select('id')
    .where('batch_id', '=', loteId)
    .where('state', '=', 'pending')
    .where('id', '<>', resolviendo)
    .execute();
  if (pendientes.length === 0)
    await ctx.ejecutar({ comando: 'batch.close', actor: sistema('bandeja'), entidadId: loteId, datos: {} });
}

async function aplicarPropuesta(
  ctx: ContextoComando,
  e: EntidadCargada,
  carga: unknown,
  opciones: { aprobar: boolean },
): Promise<Efecto> {
  const tipo = cadena(e.fila.type) as TipoPropuesta;
  const aplicar = APLICACIONES[tipo];
  if (!aplicar) throw new ErrorDominio('no_implementado', `Aceptar propuestas de tipo «${tipo}» aún no está implementado.`);
  // Los comandos que crea la propuesta llevan en su causa la propuesta que los originó.
  const conCausa: ContextoComando = { ...ctx, ejecutar: (p) => ctx.ejecutar({ ...p, causa: { propuesta: e.id, ...p.causa } }) };
  return aplicar(conCausa, { propuestaId: e.id, carga, aprobar: opciones.aprobar });
}

registrarManejadores({
  'batch.submit': manejador({
    datos: z
      .object({
        resumen: z.string().trim().max(2000).optional(),
        tipo_lote: z.enum(['agent', 'system_package', 'knowledge']).optional(),
        resolucion: z.enum(['item', 'package']).optional(),
        run_id: uuid.optional(),
        context_pack_id: uuid.optional(),
        dependencias: z.array(esquemaDependencia).default([]),
        propuestas: z.array(esquemaPropuestaEntrada).min(1).max(50),
      })
      .strict(),
    async aplicar(ctx, datos, _e, hacia) {
      // El canal fija el tipo de lote: un agente externo siempre propone por elementos.
      const externo = ctx.actor.tipo === 'agent_external';
      const tipoLote = externo ? 'agent' : (datos.tipo_lote ?? 'agent');
      const resolucion = externo ? 'item' : (datos.resolucion ?? 'item');
      if (tipoLote === 'agent' && resolucion === 'package') {
        throw new ErrorDominio('validacion', 'Un lote de agente se resuelve elemento a elemento.');
      }
      // La procedencia la fija el canal: un agente externo no puede atribuir su lote a una ejecución.
      const runId = ctx.actor.tipo === 'agent_run' ? ctx.actor.run : externo ? null : (datos.run_id ?? null);
      const packId = externo ? null : (datos.context_pack_id ?? null);
      const { id } = await ctx.trx
        .insertInto('proposal_batches')
        .values({
          project_id: ctx.proyectoId,
          kind: tipoLote,
          producer: formatearActor(ctx.actor),
          run_id: runId,
          context_pack_id: packId,
          resolution_mode: resolucion,
          dependencies: JSON.stringify(datos.dependencias),
          summary: datos.resumen ?? null,
          tree_hash: null,
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const ids: string[] = [];
      for (const [i, p] of datos.propuestas.entries()) {
        const r = await ctx.ejecutar({
          comando: 'proposal.create',
          actor: ctx.actor,
          datos: { lote_id: id, posicion: i + 1, tipo: p.tipo, carga: p.carga, dependencias: p.dependencias },
        });
        ids.push(r.entidadId);
      }
      return {
        entidadId: id,
        despues: { tipo: tipoLote, resolucion, propuestas: datos.propuestas.length, productor: formatearActor(ctx.actor) },
        resultado: { loteId: id, propuestas: ids },
      };
    },
  }),

  'proposal.create': manejador({
    datos: z
      .object({
        lote_id: uuid,
        posicion: z.number().int().positive(),
        tipo: z.string(),
        carga: z.record(z.string(), z.unknown()),
        dependencias: z.array(esquemaDependencia).default([]),
      })
      .strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const { id } = await ctx.trx
        .insertInto('proposals')
        .values({
          project_id: ctx.proyectoId,
          batch_id: datos.lote_id,
          position: datos.posicion,
          type: datos.tipo,
          payload: JSON.stringify(datos.carga),
          dependencies: JSON.stringify(datos.dependencias),
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { lote: datos.lote_id, tipo: datos.tipo } };
    },
  }),

  'proposal.accept': manejador({
    datos: z.object({ aprobar: z.boolean().default(false) }).strict(),
    async aplicar(ctx, datos, e) {
      const entidad = e as EntidadCargada;
      const efecto = await aplicarPropuesta(ctx, entidad, entidad.fila.payload, { aprobar: datos.aprobar });
      await ctx.trx
        .updateTable('proposals')
        .set({ resolution: JSON.stringify({ efecto }), resolved_by: formatearActor(ctx.actor), resolved_at: new Date() })
        .where('id', '=', entidad.id)
        .execute();
      await alEventoDeAutoridad(ctx, { tipo: 'proposal', id: entidad.id, version: null });
      await cerrarSiResuelto(ctx, cadena(entidad.fila.batch_id), entidad.id);
      return { entidadId: entidad.id, despues: { efecto, aprobar: datos.aprobar }, resultado: efecto };
    },
  }),

  'proposal.accept_edited': manejador({
    datos: z.object({ edicion: z.record(z.string(), z.unknown()), aprobar: z.boolean().default(false) }).strict(),
    async aplicar(ctx, datos, e) {
      const entidad = e as EntidadCargada;
      const efecto = await aplicarPropuesta(ctx, entidad, datos.edicion, { aprobar: datos.aprobar });
      await ctx.trx
        .updateTable('proposals')
        .set({
          resolution: JSON.stringify({ efecto, edicion: datos.edicion }),
          resolved_by: formatearActor(ctx.actor),
          resolved_at: new Date(),
        })
        .where('id', '=', entidad.id)
        .execute();
      await alEventoDeAutoridad(ctx, { tipo: 'proposal', id: entidad.id, version: null });
      await cerrarSiResuelto(ctx, cadena(entidad.fila.batch_id), entidad.id);
      return {
        entidadId: entidad.id,
        antes: { carga: entidad.fila.payload },
        despues: { efecto, edicion: datos.edicion },
        resultado: efecto,
      };
    },
  }),

  'proposal.reject': manejador({
    datos: z.object({ motivo: z.string().trim().max(2000).optional() }).strict(),
    async aplicar(ctx, datos, e) {
      const entidad = e as EntidadCargada;
      await ctx.trx
        .updateTable('proposals')
        .set({
          resolution: JSON.stringify({ motivo: datos.motivo ?? null }),
          resolved_by: formatearActor(ctx.actor),
          resolved_at: new Date(),
        })
        .where('id', '=', entidad.id)
        .execute();
      await cerrarSiResuelto(ctx, cadena(entidad.fila.batch_id), entidad.id);
      return { entidadId: entidad.id, despues: { motivo: datos.motivo ?? null } };
    },
  }),

  'proposal.supersede': manejador({
    datos: z.object({ motivo: z.string().max(2000) }).strict(),
    async aplicar(ctx, datos, e) {
      const entidad = e as EntidadCargada;
      await ctx.trx
        .updateTable('proposals')
        .set({
          resolution: JSON.stringify({ obsoleta: datos.motivo }),
          resolved_by: formatearActor(ctx.actor),
          resolved_at: new Date(),
        })
        .where('id', '=', entidad.id)
        .execute();
      await cerrarSiResuelto(ctx, cadena(entidad.fila.batch_id), entidad.id);
      return { entidadId: entidad.id, despues: { motivo: datos.motivo } };
    },
  }),

  'batch.accept_package': manejador({
    datos: z.object({ aprobar: z.boolean().default(false) }).strict(),
    async aplicar(ctx, datos, e) {
      const lote = e as EntidadCargada;
      const pendientes = await ctx.trx
        .selectFrom('proposals')
        .select('id')
        .where('batch_id', '=', lote.id)
        .where('state', '=', 'pending')
        .orderBy('position')
        .execute();
      const efectos: unknown[] = [];
      for (const p of pendientes) {
        const r = await ctx.ejecutar({
          comando: 'proposal.accept',
          actor: ctx.actor,
          entidadId: p.id,
          datos: { aprobar: datos.aprobar },
          causa: { comandoOrigen: 'batch.accept_package', lote: lote.id },
        });
        efectos.push(r.resultado);
      }
      await ctx.trx
        .updateTable('proposal_batches')
        .set({ resolved_by: formatearActor(ctx.actor), resolved_at: new Date() })
        .where('id', '=', lote.id)
        .execute();
      return { entidadId: lote.id, despues: { aceptadas: pendientes.length, aprobar: datos.aprobar }, resultado: { efectos } };
    },
  }),

  'batch.reject_package': manejador({
    datos: z.object({ motivo: z.string().trim().max(2000).optional() }).strict(),
    async aplicar(ctx, datos, e) {
      const lote = e as EntidadCargada;
      const pendientes = await ctx.trx
        .selectFrom('proposals')
        .select('id')
        .where('batch_id', '=', lote.id)
        .where('state', '=', 'pending')
        .execute();
      for (const p of pendientes) {
        await ctx.ejecutar({
          comando: 'proposal.reject',
          actor: ctx.actor,
          entidadId: p.id,
          datos: datos.motivo ? { motivo: datos.motivo } : {},
          causa: { comandoOrigen: 'batch.reject_package', lote: lote.id },
        });
      }
      await ctx.trx
        .updateTable('proposal_batches')
        .set({ resolved_by: formatearActor(ctx.actor), resolved_at: new Date() })
        .where('id', '=', lote.id)
        .execute();
      return { entidadId: lote.id, despues: { rechazadas: pendientes.length, motivo: datos.motivo ?? null } };
    },
  }),

  'batch.close': manejador({
    datos: z.object({}).strict(),
    async aplicar(ctx, _d, e) {
      await ctx.trx
        .updateTable('proposal_batches')
        .set({ resolved_at: new Date() })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '' };
    },
  }),

  'batch.supersede': manejador({
    datos: z.object({ motivo: z.string().max(2000) }).strict(),
    async aplicar(ctx, datos, e) {
      const lote = e as EntidadCargada;
      const pendientes = await ctx.trx
        .selectFrom('proposals')
        .select('id')
        .where('batch_id', '=', lote.id)
        .where('state', '=', 'pending')
        .execute();
      for (const p of pendientes) {
        await ctx.ejecutar({ comando: 'proposal.supersede', actor: ctx.actor, entidadId: p.id, datos: { motivo: datos.motivo } });
      }
      return { entidadId: lote.id, despues: { motivo: datos.motivo } };
    },
  }),
});
