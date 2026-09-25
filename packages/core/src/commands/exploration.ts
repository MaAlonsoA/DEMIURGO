// Agent tokens, explorations, conversation, sources and questions (Pillar 1).

import { DomainError, VALID_AGENT_NAME, formatActor, fingerprint, questionOption } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { trimmed, field, registerGuards } from '../bus/guards.ts';
import { DEFAULT_AGENTS } from '../agents/catalog.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import { requireEngine } from './runs.ts';
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
    const name = trimmed(field(data, 'name'));
    // "run" is reserved: agent:run:<id> is the actor for DEMIURGO's runs.
    if (name === 'run') return 'The name "run" is reserved for DEMIURGO runs.';
    return VALID_AGENT_NAME.test(name)
      ? null
      : 'The agent name only allows lowercase letters, numbers and hyphens (2 to 40 characters).';
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
      if (!p) return 'The parent exploration does not exist.';
    }
    if (!origin) return null;
    const { rows } = await sql<{ id: string }>`
      select id from ${sql.table(ORIGINS[origin.type])} where id = ${origin.id}::uuid and project_id = ${ctx.projectId}::uuid`.execute(
      ctx.trx,
    );
    return rows.length > 0 ? null : 'The given origin does not exist in this project.';
  },

  async exploration_active({ ctx, data }) {
    const id = trimmed(field(data, 'exploration_id'));
    const e = await ctx.trx
      .selectFrom('explorations')
      .select('state')
      .where('id', '=', id)
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    if (!e) return 'The exploration does not exist.';
    return e.state === 'active' ? null : 'The exploration is not active: resume it before continuing.';
  },

  conclusion_present: ({ data, entity }) => {
    const incoming = trimmed(field(data, 'conclusion'));
    const prior = trimmed(entity?.row.conclusion);
    return incoming || prior ? null : 'A conclusion is required.';
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
      // The token only appears in the response; the event carries the name, never the secret.
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

  'exploration.revise_purpose': handler({
    data: z.object({ purpose: text(1000) }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('explorations').set({ purpose: data.purpose }).where('id', '=', id).execute();
      return { entityId: id, before: { purpose: e?.row.purpose ?? null }, after: { purpose: data.purpose } };
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
        // The agent that answers (the web section's): onboarding on Day 1, explorer by default.
        agent: z.string().min(1).optional(),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const answers = ctx.actor.type === 'human' && data.respond;
      // Asking for an answer from an agent without an engine is a visible 409, before posting anything.
      if (answers) await requireEngine(ctx, data.agent ?? DEFAULT_AGENTS.exploration_chat);
      if (data.question_id) {
        const q = await ctx.trx
          .selectFrom('questions')
          .select('exploration_id')
          .where('id', '=', data.question_id)
          .executeTakeFirst();
        if (q?.exploration_id !== data.exploration_id)
          throw new DomainError('validation', 'The question does not belong to that exploration.');
      }
      const isRun = ctx.actor.type === 'agent_run';
      if (data.type && !isRun) throw new DomainError('validation', 'Only agent output carries an observation type.');
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
          response: answers ? 'waiting' : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (answers) {
        // The response is a durable workflow: it waits for the knowledge base to be up to date and requests the run.
        const { services, projectId } = ctx;
        ctx.afterCommit(() => services.engine.startResponse(id, projectId, data.exploration_id, data.question_id, data.agent));
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

  'message.abandon_response': handler({
    data: z.object({ reason: text(2000) }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('messages')
        .set({ response: 'abandoned' })
        .where('id', '=', id)
        .where('response', '=', 'waiting')
        .execute();
      return { entityId: id, after: { response: 'abandoned', reason: data.reason } };
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
        // A design stage's mandatory question: only the system raises them, when the stage opens.
        stage_id: uuid.optional(),
        stage_key: text(60).optional(),
        options: z.array(questionOption).max(4).optional(),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      if ((data.stage_id || data.stage_key) && ctx.actor.type !== 'system')
        throw new DomainError('validation', 'Only the system raises the mandatory questions of a stage.');
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
          stage_id: data.stage_id ?? null,
          stage_key: data.stage_key ?? null,
          options: JSON.stringify(data.options ?? []),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: { question: data.question, impact: data.impact ?? null, stage_key: data.stage_key ?? null },
      };
    },
  }),

  'question.suggest_options': handler({
    data: z
      .object({
        options: z.array(questionOption).max(4),
        // The same question in the person's language; the stage key keeps which one it is.
        question: text(1000).optional(),
        reason: z.string().trim().max(1000).optional(),
      })
      .strict(),
    async apply(ctx, data, e) {
      await ctx.trx
        .updateTable('questions')
        .set({
          options: JSON.stringify(data.options),
          ...(data.question ? { question: data.question } : {}),
          ...(data.reason ? { reason: data.reason } : {}),
        })
        .where('id', '=', e?.id ?? '')
        .execute();
      return {
        entityId: e?.id ?? '',
        before: { options: e?.row.options ?? [], question: e?.row.question, reason: e?.row.reason },
        after: data,
      };
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
      const conclusion = data.conclusion || trimmed(e?.row.conclusion);
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
      // The history (prior conclusion and reasons) stays in the event log; the question goes back to
      // pending with no conclusion: confirming it again requires a new one.
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
