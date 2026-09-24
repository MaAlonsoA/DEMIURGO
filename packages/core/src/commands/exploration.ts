// Tokens de agentes, exploraciones, conversación, fuentes y preguntas (Pilar 1).

import { DomainError, VALID_AGENT_NAME, formatActor, fingerprint } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { string, field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import { AGENT_TOKEN_PREFIX, secretFingerprint, newSecret } from '../secrets.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();

const ORIGINS = {
  exploration: 'explorations',
  question: 'questions',
  record_version: 'record_versions',
  proposal: 'proposals',
} as const;

const originSchema = z
  .object({
    type: z.enum(['exploration', 'question', 'record_version', 'proposal']),
    id: uuid,
    version: z.number().int().optional(),
  })
  .strict();

registerGuards({
  valid_agent_name: ({ data }) => {
    const name = string(field(data, 'name'));
    // «run» está reservado: agent:run:<id> es el actor de las ejecuciones de DEMIURGO.
    if (name === 'run') return 'El nombre «run» está reservado a las ejecuciones de DEMIURGO.';
    return VALID_AGENT_NAME.test(name)
      ? null
      : 'El nombre del agente solo admite minúsculas, números y guiones (2 a 40 caracteres).';
  },

  async existing_origin({ ctx, data }) {
    const origin = field(data, 'origin') as { type: keyof typeof ORIGINS; id: string } | undefined;
    const parent = field(data, 'parent_id');
    if (typeof parent === 'string') {
      const p = await ctx.trx
        .selectFrom('explorations')
        .select('id')
        .where('id', '=', parent)
        .where('project_id', '=', ctx.projectId)
        .executeTakeFirst();
      if (!p) return 'La exploración padre no existe.';
    }
    if (!origin) return null;
    const { rows } = await sql<{ id: string }>`
      select id from ${sql.table(ORIGINS[origin.type])} where id = ${origin.id}::uuid and project_id = ${ctx.projectId}::uuid`.execute(
      ctx.trx,
    );
    return rows.length > 0 ? null : 'El origen indicado no existe en este proyecto.';
  },

  async exploration_active({ ctx, data }) {
    const id = string(field(data, 'exploration_id'));
    const e = await ctx.trx
      .selectFrom('explorations')
      .select('state')
      .where('id', '=', id)
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    if (!e) return 'La exploración no existe.';
    return e.state === 'active' ? null : 'La exploración no está activa: retómala antes de continuar.';
  },

  conclusion_present: ({ data, entity }) => {
    const incoming = string(field(data, 'conclusion'));
    const prior = string(entity?.row.conclusion);
    return incoming || prior ? null : 'Hace falta una conclusión.';
  },
});

registerHandlers({
  'agent_token.issue': handler({
    data: z.object({ name: z.string() }).strict(),
    async apply(ctx, data, _e, to) {
      const token = newSecret(AGENT_TOKEN_PREFIX);
      const { id } = await ctx.trx
        .insertInto('agent_tokens')
        .values({
          project_id: ctx.projectId,
          name: data.name,
          token_hash: secretFingerprint(token),
          state: to,
          issued_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // El token solo aparece en la respuesta; el evento lleva el nombre, nunca el secreto.
      return { entityId: id, after: { name: data.name }, result: { token, actor: `agent:${data.name}:${id}` } };
    },
  }),

  'agent_token.revoke': handler({
    data: z.object({ reason: z.string().trim().max(500).optional() }).strict(),
    async apply(ctx, data, e) {
      await ctx.trx
        .updateTable('agent_tokens')
        .set({ revoked_at: new Date() })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '', after: { reason: data.reason ?? null } };
    },
  }),

  'exploration.open': handler({
    data: z.object({ purpose: text(1000), parent_id: uuid.optional(), origin: originSchema.optional() }).strict(),
    async apply(ctx, data, _e, to) {
      const { id } = await ctx.trx
        .insertInto('explorations')
        .values({
          project_id: ctx.projectId,
          parent_id: data.parent_id ?? null,
          purpose: data.purpose,
          origin_type: data.origin?.type ?? null,
          origin_id: data.origin?.id ?? null,
          origin_version: data.origin?.version ?? null,
          state: to,
          opened_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: { purpose: data.purpose, origin: data.origin ?? null, parent: data.parent_id ?? null },
      };
    },
  }),

  'exploration.conclude': handler({
    data: z.object({ reason: z.string().trim().max(1000).optional() }).strict(),
    async apply(ctx, data, e) {
      await ctx.trx
        .updateTable('explorations')
        .set({ state_reason: data.reason ?? null })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '', after: { reason: data.reason ?? null } };
    },
  }),

  'exploration.set_aside': handler({
    data: z.object({ reason: z.string().max(1000).default('') }).strict(),
    async apply(ctx, data, e) {
      await ctx.trx
        .updateTable('explorations')
        .set({ state_reason: data.reason })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '', after: { reason: data.reason } };
    },
  }),

  'exploration.resume': handler({
    data: z.object({}).strict(),
    async apply(ctx, _d, e) {
      await ctx.trx
        .updateTable('explorations')
        .set({ state_reason: null })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '' };
    },
  }),

  'message.post': handler({
    data: z
      .object({
        exploration_id: uuid,
        question_id: uuid.optional(),
        text: text(20_000),
        type: z.enum(['claim', 'hypothesis', 'unknown']).optional(),
        respond: z.boolean().default(true),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      if (data.question_id) {
        const q = await ctx.trx
          .selectFrom('questions')
          .select('exploration_id')
          .where('id', '=', data.question_id)
          .executeTakeFirst();
        if (q?.exploration_id !== data.exploration_id)
          throw new DomainError('validation', 'La pregunta no pertenece a esa exploración.');
      }
      const isRun = ctx.actor.type === 'agent_run';
      if (data.type && !isRun) throw new DomainError('validation', 'Solo la salida de un agente lleva tipo de observación.');
      const { id } = await ctx.trx
        .insertInto('messages')
        .values({
          project_id: ctx.projectId,
          exploration_id: data.exploration_id,
          question_id: data.question_id ?? null,
          author: formatActor(ctx.actor),
          run_id: ctx.actor.type === 'agent_run' ? ctx.actor.run : null,
          kind: data.type ?? null,
          body: data.text,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (ctx.actor.type === 'human' && data.respond) {
        // La respuesta es un flujo durable: espera a que el conocimiento esté al día y pide la ejecución.
        const { services, projectId } = ctx;
        ctx.afterConfirm(() => services.engine.startResponse(id, projectId, data.exploration_id, data.question_id));
      }
      return {
        entityId: id,
        after: {
          exploration: data.exploration_id,
          question: data.question_id ?? null,
          type: data.type ?? null,
          length: data.text.length,
        },
      };
    },
  }),

  'source.register': handler({
    data: z.object({ name: text(200), content: z.string().min(1).max(200_000) }).strict(),
    async apply(ctx, data, _e, to) {
      const hash = fingerprint(data.content);
      const { id } = await ctx.trx
        .insertInto('sources')
        .values({
          project_id: ctx.projectId,
          name: data.name,
          content: data.content,
          content_hash: hash,
          registered_by: formatActor(ctx.actor),
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { name: data.name, hash } };
    },
  }),

  'question.raise': handler({
    data: z
      .object({
        exploration_id: uuid,
        question: text(1000),
        reason: z.string().trim().max(1000).optional(),
        impact: z.enum(['high', 'medium', 'low']).optional(),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const { id } = await ctx.trx
        .insertInto('questions')
        .values({
          project_id: ctx.projectId,
          exploration_id: data.exploration_id,
          question: data.question,
          reason: data.reason ?? null,
          impact: data.impact ?? null,
          state: to,
          raised_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { question: data.question, impact: data.impact ?? null } };
    },
  }),

  'question.infer': handler({
    data: z.object({ conclusion: text(3000), reasoning: z.string().trim().max(3000).default('') }).strict(),
    async apply(ctx, data, e) {
      await ctx.trx
        .updateTable('questions')
        .set({ conclusion: data.conclusion, reasoning: data.reasoning })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '', before: { conclusion: e?.row.conclusion ?? null }, after: data };
    },
  }),

  'question.confirm': handler({
    data: z.object({ conclusion: z.string().trim().max(3000).optional() }).strict(),
    async apply(ctx, data, e) {
      const conclusion = data.conclusion || string(e?.row.conclusion);
      await ctx.trx
        .updateTable('questions')
        .set({ conclusion, state_reason: null })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '', before: { conclusion: e?.row.conclusion ?? null }, after: { conclusion } };
    },
  }),

  'question.postpone': handler({
    data: z.object({ reason: z.string().max(1000).default('') }).strict(),
    async apply(ctx, data, e) {
      await ctx.trx
        .updateTable('questions')
        .set({ state_reason: data.reason })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '', after: { reason: data.reason } };
    },
  }),

  'question.discard': handler({
    data: z.object({ reason: z.string().max(1000).default('') }).strict(),
    async apply(ctx, data, e) {
      await ctx.trx
        .updateTable('questions')
        .set({ state_reason: data.reason })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '', after: { reason: data.reason } };
    },
  }),

  'question.reopen': handler({
    data: z.object({ reason: z.string().trim().max(1000).optional() }).strict(),
    async apply(ctx, data, e) {
      // El historial (conclusión y motivos anteriores) queda en el diario; la pregunta vuelve a pendiente
      // sin conclusión: confirmarla otra vez exige una nueva.
      await ctx.trx
        .updateTable('questions')
        .set({ state_reason: data.reason ?? null, conclusion: null })
        .where('id', '=', e?.id ?? '')
        .execute();
      return {
        entityId: e?.id ?? '',
        before: { conclusion: e?.row.conclusion ?? null, reason: e?.row.state_reason ?? null },
        after: { reason: data.reason ?? null },
      };
    },
  }),
});
