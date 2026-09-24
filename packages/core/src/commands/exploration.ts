// Tokens de agentes, exploraciones, conversación, fuentes y preguntas (Pilar 1).

import { ErrorDominio, NOMBRE_AGENTE_VALIDO, formatearActor, huella } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { cadena, campo, registrarGuardas } from '../bus/guardas.ts';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';
import { PREFIJO_TOKEN_AGENTE, huellaSecreto, nuevoSecreto } from '../secretos.ts';

const texto = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();

const ORIGENES = {
  exploration: 'explorations',
  question: 'questions',
  record_version: 'record_versions',
  proposal: 'proposals',
} as const;

const esquemaOrigen = z
  .object({
    tipo: z.enum(['exploration', 'question', 'record_version', 'proposal']),
    id: uuid,
    version: z.number().int().optional(),
  })
  .strict();

registrarGuardas({
  nombre_de_agente_valido: ({ datos }) => {
    const nombre = cadena(campo(datos, 'nombre'));
    // «run» está reservado: agent:run:<id> es el actor de las ejecuciones de DEMIURGO.
    if (nombre === 'run') return 'El nombre «run» está reservado a las ejecuciones de DEMIURGO.';
    return NOMBRE_AGENTE_VALIDO.test(nombre)
      ? null
      : 'El nombre del agente solo admite minúsculas, números y guiones (2 a 40 caracteres).';
  },

  async origen_existente({ ctx, datos }) {
    const origen = campo(datos, 'origen') as { tipo: keyof typeof ORIGENES; id: string } | undefined;
    const padre = campo(datos, 'padre_id');
    if (typeof padre === 'string') {
      const p = await ctx.trx
        .selectFrom('explorations')
        .select('id')
        .where('id', '=', padre)
        .where('project_id', '=', ctx.proyectoId)
        .executeTakeFirst();
      if (!p) return 'La exploración padre no existe.';
    }
    if (!origen) return null;
    const { rows } = await sql<{ id: string }>`
      select id from ${sql.table(ORIGENES[origen.tipo])} where id = ${origen.id}::uuid and project_id = ${ctx.proyectoId}::uuid`.execute(
      ctx.trx,
    );
    return rows.length > 0 ? null : 'El origen indicado no existe en este proyecto.';
  },

  async exploracion_activa({ ctx, datos }) {
    const id = cadena(campo(datos, 'exploracion_id'));
    const e = await ctx.trx
      .selectFrom('explorations')
      .select('state')
      .where('id', '=', id)
      .where('project_id', '=', ctx.proyectoId)
      .executeTakeFirst();
    if (!e) return 'La exploración no existe.';
    return e.state === 'active' ? null : 'La exploración no está activa: retómala antes de continuar.';
  },

  conclusion_presente: ({ datos, entidad }) => {
    const nueva = cadena(campo(datos, 'conclusion'));
    const previa = cadena(entidad?.fila.conclusion);
    return nueva || previa ? null : 'Hace falta una conclusión.';
  },
});

registrarManejadores({
  'agent_token.issue': manejador({
    datos: z.object({ nombre: z.string() }).strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const token = nuevoSecreto(PREFIJO_TOKEN_AGENTE);
      const { id } = await ctx.trx
        .insertInto('agent_tokens')
        .values({
          project_id: ctx.proyectoId,
          name: datos.nombre,
          token_hash: huellaSecreto(token),
          state: hacia,
          issued_by: formatearActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // El token solo aparece en la respuesta; el evento lleva el nombre, nunca el secreto.
      return { entidadId: id, despues: { nombre: datos.nombre }, resultado: { token, actor: `agent:${datos.nombre}:${id}` } };
    },
  }),

  'agent_token.revoke': manejador({
    datos: z.object({ motivo: z.string().trim().max(500).optional() }).strict(),
    async aplicar(ctx, datos, e) {
      await ctx.trx
        .updateTable('agent_tokens')
        .set({ revoked_at: new Date() })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '', despues: { motivo: datos.motivo ?? null } };
    },
  }),

  'exploration.open': manejador({
    datos: z.object({ proposito: texto(1000), padre_id: uuid.optional(), origen: esquemaOrigen.optional() }).strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const { id } = await ctx.trx
        .insertInto('explorations')
        .values({
          project_id: ctx.proyectoId,
          parent_id: datos.padre_id ?? null,
          purpose: datos.proposito,
          origin_type: datos.origen?.tipo ?? null,
          origin_id: datos.origen?.id ?? null,
          origin_version: datos.origen?.version ?? null,
          state: hacia,
          opened_by: formatearActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entidadId: id,
        despues: { proposito: datos.proposito, origen: datos.origen ?? null, padre: datos.padre_id ?? null },
      };
    },
  }),

  'exploration.conclude': manejador({
    datos: z.object({ motivo: z.string().trim().max(1000).optional() }).strict(),
    async aplicar(ctx, datos, e) {
      await ctx.trx
        .updateTable('explorations')
        .set({ state_reason: datos.motivo ?? null })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '', despues: { motivo: datos.motivo ?? null } };
    },
  }),

  'exploration.set_aside': manejador({
    datos: z.object({ motivo: z.string().max(1000).default('') }).strict(),
    async aplicar(ctx, datos, e) {
      await ctx.trx
        .updateTable('explorations')
        .set({ state_reason: datos.motivo })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '', despues: { motivo: datos.motivo } };
    },
  }),

  'exploration.resume': manejador({
    datos: z.object({}).strict(),
    async aplicar(ctx, _d, e) {
      await ctx.trx
        .updateTable('explorations')
        .set({ state_reason: null })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '' };
    },
  }),

  'message.post': manejador({
    datos: z
      .object({
        exploracion_id: uuid,
        pregunta_id: uuid.optional(),
        texto: texto(20_000),
        tipo: z.enum(['claim', 'hypothesis', 'unknown']).optional(),
        responder: z.boolean().default(true),
      })
      .strict(),
    async aplicar(ctx, datos, _e, hacia) {
      if (datos.pregunta_id) {
        const q = await ctx.trx
          .selectFrom('questions')
          .select('exploration_id')
          .where('id', '=', datos.pregunta_id)
          .executeTakeFirst();
        if (q?.exploration_id !== datos.exploracion_id)
          throw new ErrorDominio('validacion', 'La pregunta no pertenece a esa exploración.');
      }
      const esRun = ctx.actor.tipo === 'agent_run';
      if (datos.tipo && !esRun) throw new ErrorDominio('validacion', 'Solo la salida de un agente lleva tipo de observación.');
      const { id } = await ctx.trx
        .insertInto('messages')
        .values({
          project_id: ctx.proyectoId,
          exploration_id: datos.exploracion_id,
          question_id: datos.pregunta_id ?? null,
          author: formatearActor(ctx.actor),
          run_id: ctx.actor.tipo === 'agent_run' ? ctx.actor.run : null,
          kind: datos.tipo ?? null,
          body: datos.texto,
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (ctx.actor.tipo === 'human' && datos.responder) {
        // La respuesta es un flujo durable: espera a que el conocimiento esté al día y pide la ejecución.
        const { servicios, proyectoId } = ctx;
        ctx.despuesDeConfirmar(() => servicios.motor.iniciarRespuesta(id, proyectoId, datos.exploracion_id, datos.pregunta_id));
      }
      return {
        entidadId: id,
        despues: {
          exploracion: datos.exploracion_id,
          pregunta: datos.pregunta_id ?? null,
          tipo: datos.tipo ?? null,
          longitud: datos.texto.length,
        },
      };
    },
  }),

  'source.register': manejador({
    datos: z.object({ nombre: texto(200), contenido: z.string().min(1).max(200_000) }).strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const hash = huella(datos.contenido);
      const { id } = await ctx.trx
        .insertInto('sources')
        .values({
          project_id: ctx.proyectoId,
          name: datos.nombre,
          content: datos.contenido,
          content_hash: hash,
          registered_by: formatearActor(ctx.actor),
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { nombre: datos.nombre, hash } };
    },
  }),

  'question.raise': manejador({
    datos: z
      .object({
        exploracion_id: uuid,
        pregunta: texto(1000),
        motivo: z.string().trim().max(1000).optional(),
        impacto: z.enum(['alto', 'medio', 'bajo']).optional(),
      })
      .strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const { id } = await ctx.trx
        .insertInto('questions')
        .values({
          project_id: ctx.proyectoId,
          exploration_id: datos.exploracion_id,
          question: datos.pregunta,
          reason: datos.motivo ?? null,
          impact: datos.impacto ?? null,
          state: hacia,
          raised_by: formatearActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { pregunta: datos.pregunta, impacto: datos.impacto ?? null } };
    },
  }),

  'question.infer': manejador({
    datos: z.object({ conclusion: texto(3000), razonamiento: z.string().trim().max(3000).default('') }).strict(),
    async aplicar(ctx, datos, e) {
      await ctx.trx
        .updateTable('questions')
        .set({ conclusion: datos.conclusion, reasoning: datos.razonamiento })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '', antes: { conclusion: e?.fila.conclusion ?? null }, despues: datos };
    },
  }),

  'question.confirm': manejador({
    datos: z.object({ conclusion: z.string().trim().max(3000).optional() }).strict(),
    async aplicar(ctx, datos, e) {
      const conclusion = datos.conclusion || cadena(e?.fila.conclusion);
      await ctx.trx
        .updateTable('questions')
        .set({ conclusion, state_reason: null })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '', antes: { conclusion: e?.fila.conclusion ?? null }, despues: { conclusion } };
    },
  }),

  'question.postpone': manejador({
    datos: z.object({ motivo: z.string().max(1000).default('') }).strict(),
    async aplicar(ctx, datos, e) {
      await ctx.trx
        .updateTable('questions')
        .set({ state_reason: datos.motivo })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '', despues: { motivo: datos.motivo } };
    },
  }),

  'question.discard': manejador({
    datos: z.object({ motivo: z.string().max(1000).default('') }).strict(),
    async aplicar(ctx, datos, e) {
      await ctx.trx
        .updateTable('questions')
        .set({ state_reason: datos.motivo })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entidadId: e?.id ?? '', despues: { motivo: datos.motivo } };
    },
  }),

  'question.reopen': manejador({
    datos: z.object({ motivo: z.string().trim().max(1000).optional() }).strict(),
    async aplicar(ctx, datos, e) {
      // El historial (conclusión y motivos anteriores) queda en el diario; la pregunta vuelve a pendiente
      // sin conclusión: confirmarla otra vez exige una nueva.
      await ctx.trx
        .updateTable('questions')
        .set({ state_reason: datos.motivo ?? null, conclusion: null })
        .where('id', '=', e?.id ?? '')
        .execute();
      return {
        entidadId: e?.id ?? '',
        antes: { conclusion: e?.fila.conclusion ?? null, motivo: e?.fila.state_reason ?? null },
        despues: { motivo: datos.motivo ?? null },
      };
    },
  }),
});
