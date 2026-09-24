// Ejecuciones de agentes. Una ejecución siempre tiene un context pack de su constructor
// declarado; el reintento reutiliza el mismo pack (I7).

import { AGENT_ACTIONS, FAILURE_KINDS, formatActor, system, type AgentAction } from '@demiurgo/domain';
import { z } from 'zod';
import { string, field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import { schemaVersion, METHOD_VERSION } from '../agents/methods.ts';
import { buildContext } from '../context/build.ts';
import { graphUpToDate, graphVersion } from '../context/graph.ts';

const usageSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    durationMs: z.number().nonnegative(),
    declaredCostUsd: z.number().nonnegative().optional(),
  })
  .strict();

const now = (): string => new Date().toISOString();

registerGuards({
  async original_run_finished({ ctx, data }) {
    const id = string(field(data, 'run_id'));
    const original = await ctx.trx.selectFrom('ai_runs').select(['state', 'project_id']).where('id', '=', id).executeTakeFirst();
    if (!original || original.project_id !== ctx.projectId) return 'La ejecución que se quiere reintentar no existe.';
    if (!['failed', 'interrupted', 'cancelled'].includes(original.state)) {
      return 'Solo se reintenta una ejecución fallida, interrumpida o cancelada.';
    }
    return null;
  },
});

registerHandlers({
  'run.request': handler({
    data: z
      .object({
        action: z.enum(AGENT_ACTIONS),
        scope: z
          .object({ type: z.string().min(1), id: z.string().uuid().optional(), version: z.number().int().positive().optional() })
          .strict(),
        input: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const action: AgentAction = data.action;
      const pack = await buildContext(
        ctx.trx,
        ctx.projectId,
        action,
        data.scope,
        data.input,
        await graphVersion(ctx.trx, ctx.projectId),
      );
      const created = await ctx.execute({ command: 'context_pack.build', actor: system('context'), data: pack });
      const agent = ctx.services.agent;
      const { id } = await ctx.trx
        .insertInto('ai_runs')
        .values({
          project_id: ctx.projectId,
          action: action,
          scope: JSON.stringify(data.scope),
          method: `${action}@${METHOD_VERSION[action]}`,
          schema_version: schemaVersion(action),
          provider: agent.provider,
          model: null,
          context_pack_id: created.entityId,
          retry_of: null,
          state: to,
          requested_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const projectId = ctx.projectId;
      ctx.afterConfirm(() => ctx.services.engine.startRun(id, projectId));
      const hash = (created.result as { hash: string }).hash;
      return {
        entityId: id,
        after: { action, scope: data.scope, context_pack: hash },
        result: { runId: id, contextPackId: created.entityId, contextPackHash: hash },
      };
    },
  }),

  'run.retry': handler({
    data: z.object({ run_id: z.string().uuid() }).strict(),
    async apply(ctx, data, _e, to) {
      const o = await ctx.trx.selectFrom('ai_runs').selectAll().where('id', '=', data.run_id).executeTakeFirstOrThrow();
      const { id } = await ctx.trx
        .insertInto('ai_runs')
        .values({
          project_id: ctx.projectId,
          action: o.action,
          scope: JSON.stringify(o.scope),
          method: o.method,
          schema_version: o.schema_version,
          provider: ctx.services.agent.provider,
          model: null,
          context_pack_id: o.context_pack_id,
          retry_of: o.id,
          state: to,
          requested_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const projectId = ctx.projectId;
      ctx.afterConfirm(() => ctx.services.engine.startRun(id, projectId));
      return { entityId: id, after: { retry_of: o.id }, result: { runId: id, contextPackId: o.context_pack_id } };
    },
  }),

  'run.begin': handler({
    data: z.object({}).strict(),
    async apply(ctx, _d, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('ai_runs').set({ started_at: now() }).where('id', '=', id).execute();
      return { entityId: id };
    },
  }),

  'run.complete': handler({
    data: z.object({ output: z.unknown(), usage: usageSchema.nullable(), model: z.string().nullable() }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({
          output: JSON.stringify(data.output ?? null),
          usage: data.usage ? JSON.stringify(data.usage) : null,
          model: data.model,
          finished_at: now(),
        })
        .where('id', '=', id)
        .execute();
      return { entityId: id, after: { usage: data.usage, model: data.model } };
    },
  }),

  'run.fail': handler({
    data: z
      .object({
        failure_kind: z.enum(FAILURE_KINDS),
        error: z.string().max(4000),
        usage: usageSchema.nullable().default(null),
        model: z.string().nullable().default(null),
      })
      .strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({
          failure_kind: data.failure_kind,
          error: data.error,
          usage: data.usage ? JSON.stringify(data.usage) : null,
          model: data.model,
          finished_at: now(),
        })
        .where('id', '=', id)
        .execute();
      return { entityId: id, after: { failure_kind: data.failure_kind, error: data.error } };
    },
  }),

  'run.cancel': handler({
    data: z.object({ reason: z.string().trim().max(500).optional() }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({ failure_kind: 'cancelled', error: data.reason ?? 'Cancelada por la persona.', finished_at: now() })
        .where('id', '=', id)
        .execute();
      ctx.afterConfirm(() => ctx.services.engine.cancelRun(id));
      return { entityId: id, after: { reason: data.reason ?? null } };
    },
  }),

  'run.interrupt': handler({
    data: z.object({ reason: z.string().max(500) }).strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({ failure_kind: 'infra', error: data.reason, finished_at: now() })
        .where('id', '=', id)
        .execute();
      return { entityId: id, after: { reason: data.reason } };
    },
  }),
});

registerGuards({
  async graph_up_to_date({ ctx }) {
    const f = await graphUpToDate(ctx.trx, ctx.projectId);
    return f.upToDate
      ? null
      : `El conocimiento del proyecto no está al día: faltan ${f.pending} actualización(es) por aplicar. Vuelve a intentarlo cuando termine.`;
  },
});
