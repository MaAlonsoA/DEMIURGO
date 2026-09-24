// Ejecuciones de agentes. Una ejecución siempre tiene un context pack de su constructor
// declarado; el reintento reutiliza el mismo pack (I7).

import { ACCIONES_AGENTE, FAILURE_KINDS, formatearActor, sistema, type AccionAgente } from '@demiurgo/domain';
import { z } from 'zod';
import { cadena, campo, registrarGuardas } from '../bus/guardas.ts';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';
import { versionEsquema, VERSION_METODO } from '../agentes/metodos.ts';
import { construirContexto } from '../contexto/construir.ts';
import { grafoAlDia, versionGrafo } from '../contexto/grafo.ts';

const esquemaUso = z
  .object({
    tokensEntrada: z.number().nonnegative(),
    tokensSalida: z.number().nonnegative(),
    duracionMs: z.number().nonnegative(),
    costeDeclaradoUsd: z.number().nonnegative().optional(),
  })
  .strict();

const ahora = (): string => new Date().toISOString();

registrarGuardas({
  async run_original_terminado({ ctx, datos }) {
    const id = cadena(campo(datos, 'run_id'));
    const original = await ctx.trx.selectFrom('ai_runs').select(['state', 'project_id']).where('id', '=', id).executeTakeFirst();
    if (!original || original.project_id !== ctx.proyectoId) return 'La ejecución que se quiere reintentar no existe.';
    if (!['failed', 'interrupted', 'cancelled'].includes(original.state)) {
      return 'Solo se reintenta una ejecución fallida, interrumpida o cancelada.';
    }
    return null;
  },
});

registrarManejadores({
  'run.request': manejador({
    datos: z
      .object({
        accion: z.enum(ACCIONES_AGENTE),
        alcance: z
          .object({ tipo: z.string().min(1), id: z.string().uuid().optional(), version: z.number().int().positive().optional() })
          .strict(),
        entrada: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const accion: AccionAgente = datos.accion;
      const pack = await construirContexto(
        ctx.trx,
        ctx.proyectoId,
        accion,
        datos.alcance,
        datos.entrada,
        await versionGrafo(ctx.trx, ctx.proyectoId),
      );
      const creado = await ctx.ejecutar({ comando: 'context_pack.build', actor: sistema('contexto'), datos: pack });
      const agente = ctx.servicios.agente;
      const { id } = await ctx.trx
        .insertInto('ai_runs')
        .values({
          project_id: ctx.proyectoId,
          action: accion,
          scope: JSON.stringify(datos.alcance),
          method: `${accion}@${VERSION_METODO[accion]}`,
          schema_version: versionEsquema(accion),
          provider: agente.proveedor,
          model: null,
          context_pack_id: creado.entidadId,
          retry_of: null,
          state: hacia,
          requested_by: formatearActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const proyectoId = ctx.proyectoId;
      ctx.despuesDeConfirmar(() => ctx.servicios.motor.iniciarRun(id, proyectoId));
      const hash = (creado.resultado as { hash: string }).hash;
      return {
        entidadId: id,
        despues: { accion, alcance: datos.alcance, context_pack: hash },
        resultado: { runId: id, contextPackId: creado.entidadId, contextPackHash: hash },
      };
    },
  }),

  'run.retry': manejador({
    datos: z.object({ run_id: z.string().uuid() }).strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const o = await ctx.trx.selectFrom('ai_runs').selectAll().where('id', '=', datos.run_id).executeTakeFirstOrThrow();
      const { id } = await ctx.trx
        .insertInto('ai_runs')
        .values({
          project_id: ctx.proyectoId,
          action: o.action,
          scope: JSON.stringify(o.scope),
          method: o.method,
          schema_version: o.schema_version,
          provider: ctx.servicios.agente.proveedor,
          model: null,
          context_pack_id: o.context_pack_id,
          retry_of: o.id,
          state: hacia,
          requested_by: formatearActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const proyectoId = ctx.proyectoId;
      ctx.despuesDeConfirmar(() => ctx.servicios.motor.iniciarRun(id, proyectoId));
      return { entidadId: id, despues: { reintento_de: o.id }, resultado: { runId: id, contextPackId: o.context_pack_id } };
    },
  }),

  'run.begin': manejador({
    datos: z.object({}).strict(),
    async aplicar(ctx, _d, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('ai_runs').set({ started_at: ahora() }).where('id', '=', id).execute();
      return { entidadId: id };
    },
  }),

  'run.complete': manejador({
    datos: z.object({ salida: z.unknown(), uso: esquemaUso.nullable(), modelo: z.string().nullable() }).strict(),
    async aplicar(ctx, datos, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({
          output: JSON.stringify(datos.salida ?? null),
          usage: datos.uso ? JSON.stringify(datos.uso) : null,
          model: datos.modelo,
          finished_at: ahora(),
        })
        .where('id', '=', id)
        .execute();
      return { entidadId: id, despues: { uso: datos.uso, modelo: datos.modelo } };
    },
  }),

  'run.fail': manejador({
    datos: z
      .object({
        failure_kind: z.enum(FAILURE_KINDS),
        error: z.string().max(4000),
        uso: esquemaUso.nullable().default(null),
        modelo: z.string().nullable().default(null),
      })
      .strict(),
    async aplicar(ctx, datos, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({
          failure_kind: datos.failure_kind,
          error: datos.error,
          usage: datos.uso ? JSON.stringify(datos.uso) : null,
          model: datos.modelo,
          finished_at: ahora(),
        })
        .where('id', '=', id)
        .execute();
      return { entidadId: id, despues: { failure_kind: datos.failure_kind, error: datos.error } };
    },
  }),

  'run.cancel': manejador({
    datos: z.object({ motivo: z.string().trim().max(500).optional() }).strict(),
    async aplicar(ctx, datos, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({ failure_kind: 'cancelled', error: datos.motivo ?? 'Cancelada por la persona.', finished_at: ahora() })
        .where('id', '=', id)
        .execute();
      ctx.despuesDeConfirmar(() => ctx.servicios.motor.cancelarRun(id));
      return { entidadId: id, despues: { motivo: datos.motivo ?? null } };
    },
  }),

  'run.interrupt': manejador({
    datos: z.object({ motivo: z.string().max(500) }).strict(),
    async aplicar(ctx, datos, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({ failure_kind: 'infra', error: datos.motivo, finished_at: ahora() })
        .where('id', '=', id)
        .execute();
      return { entidadId: id, despues: { motivo: datos.motivo } };
    },
  }),
});

registrarGuardas({
  async grafo_al_dia({ ctx }) {
    const f = await grafoAlDia(ctx.trx, ctx.proyectoId);
    return f.alDia
      ? null
      : `El conocimiento del proyecto no está al día: faltan ${f.pendientes} actualización(es) por aplicar. Vuelve a intentarlo cuando termine.`;
  },
});
