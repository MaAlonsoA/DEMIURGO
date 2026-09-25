// Agent runs. A run always has a context pack from its declared builder and runs a DEMIURGO agent
// on the engine resolved when it is requested (FDR-AGE-002); a retry reuses the same pack (I7).

import {
  AGENT_ACTIONS,
  DomainError,
  FAILURE_KINDS,
  type AgentAction,
  composeSystem,
  formatActor,
  system,
} from '@demiurgo/domain';
import { z } from 'zod';
import { DEFAULT_AGENTS, type LoadedAgent, loadAgentCatalog, schemaVersion } from '../agents/catalog.ts';
import { type Engine, resolutionProblem, resolveEngine } from '../assignments/assignments.ts';
import { trimmed, field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { CommandContext } from '../bus/types.ts';
import { buildContext } from '../context/build.ts';
import { graphUpToDate, graphVersion } from '../context/graph.ts';

const count = z.number().nonnegative();

const usageSchema = z
  .object({
    inputTokens: count,
    outputTokens: count,
    durationMs: count,
    declaredCostUsd: count.optional(),
    cachedInputTokens: count.optional(),
    reasoningTokens: count.optional(),
    turns: count.optional(),
    provenance: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/** How the run talked to its provider: the mode, the provider's session id and the delta sent. */
const sessionSchema = z
  .object({
    mode: z.enum(['none', 'fresh', 'resumed']),
    provider_session_id: z.string().nullable(),
    delta_hash: z.string().nullable(),
  })
  .strict();

const engineSchema = z
  .object({ provider: z.string().min(1), model: z.string().min(1), effort: z.string().min(1).nullable() })
  .strict();

/** The agent that serves the action: the one the web section names, or the action's default. */
async function agentFor(action: AgentAction, requested: string | undefined): Promise<LoadedAgent> {
  const catalog = await loadAgentCatalog();
  const agent = catalog.get(requested ?? DEFAULT_AGENTS[action]);
  if (!agent) throw new DomainError('validation', `There is no agent "${requested}".`);
  if (agent.action !== action) {
    throw new DomainError('validation', `The agent "${agent.id}" serves ${agent.action}, not ${action}.`);
  }
  return agent;
}

/**
 * The engine this run uses (override → project → global), or a 409 that tells the person what to
 * do: the run is not created. An override outside the catalog is a 422, like an assignment.
 */
async function engineFor(ctx: CommandContext, agent: LoadedAgent, override?: Engine): Promise<Engine> {
  const r = await resolveEngine(ctx.trx, ctx.services.providers, {
    projectId: ctx.projectId,
    agent: agent.id,
    ...(override ? { override } : {}),
  });
  const problem = resolutionProblem(agent.id, r);
  if (problem || r.status !== 'ok') {
    if (override) throw new DomainError('validation', 'That engine is not available.', [problem ?? '']);
    throw new DomainError('guard', `The conditions for "${ctx.command}" are not met.`, [problem ?? '']);
  }
  return { provider: r.provider, model: r.model, effort: r.effort };
}

/** Throws the visible 409 when an agent has no engine: used before posting a message that asks for an answer. */
export async function requireEngine(ctx: CommandContext, agentId: string): Promise<void> {
  const catalog = await loadAgentCatalog();
  const agent = catalog.get(agentId);
  if (!agent) throw new DomainError('validation', `There is no agent "${agentId}".`);
  await engineFor(ctx, agent);
}

/** What a run records about how it will run: agent@version, engine and the system prompt's fingerprint. */
function runAgentColumns(agent: LoadedAgent, engine: Engine) {
  return {
    agent: agent.id,
    method: `${agent.id}@${agent.version}`,
    provider: engine.provider,
    requested_model: engine.model,
    effort: engine.effort,
    prompt_hash: composeSystem(agent, agent.skillDefinitions).promptHash,
  };
}

const now = (): string => new Date().toISOString();

function sessionColumns(session: z.infer<typeof sessionSchema> | null) {
  return session
    ? { session_mode: session.mode, provider_session_id: session.provider_session_id, delta_hash: session.delta_hash }
    : {};
}

registerGuards({
  async original_run_finished({ ctx, data }) {
    const id = trimmed(field(data, 'run_id'));
    const original = await ctx.trx.selectFrom('ai_runs').select(['state', 'project_id']).where('id', '=', id).executeTakeFirst();
    if (!original || original.project_id !== ctx.projectId) return 'The run you want to retry does not exist.';
    if (!['failed', 'interrupted', 'cancelled'].includes(original.state)) {
      return 'Only a failed, interrupted or cancelled run can be retried.';
    }
    return null;
  },
});

registerHandlers({
  'run.request': handler({
    data: z
      .object({
        action: z.enum(AGENT_ACTIONS),
        agent: z.string().min(1).optional(),
        scope: z
          .object({ type: z.string().min(1), id: z.string().uuid().optional(), version: z.number().int().positive().optional() })
          .strict(),
        input: z.record(z.string(), z.unknown()).default({}),
        // The person's message this run answers (the durable response): the message links to it.
        answers_message: z.string().uuid().optional(),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const action: AgentAction = data.action;
      const agent = await agentFor(action, data.agent);
      const engine = await engineFor(ctx, agent);
      const pack = await buildContext(
        ctx.trx,
        ctx.projectId,
        action,
        data.scope,
        data.input,
        await graphVersion(ctx.trx, ctx.projectId),
      );
      const created = await ctx.execute({ command: 'context_pack.build', actor: system('context'), data: pack });
      const { id } = await ctx.trx
        .insertInto('ai_runs')
        .values({
          project_id: ctx.projectId,
          action: action,
          scope: JSON.stringify(data.scope),
          ...runAgentColumns(agent, engine),
          schema_version: schemaVersion(action),
          model: null,
          context_pack_id: created.entityId,
          retry_of: null,
          state: to,
          requested_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (data.answers_message) {
        await ctx.trx
          .updateTable('messages')
          .set({ response: 'requested', response_run: id })
          .where('id', '=', data.answers_message)
          .where('project_id', '=', ctx.projectId)
          .execute();
      }
      const projectId = ctx.projectId;
      ctx.afterCommit(() => ctx.services.engine.startRun(id, projectId));
      const hash = (created.result as { hash: string }).hash;
      return {
        entityId: id,
        after: { action, agent: agent.id, engine, scope: data.scope, context_pack: hash },
        result: { runId: id, contextPackId: created.entityId, contextPackHash: hash },
      };
    },
  }),

  'run.retry': handler({
    // Retry with…: `override` runs this retry only on another engine, chosen from the catalog.
    data: z.object({ run_id: z.string().uuid(), override: engineSchema.optional() }).strict(),
    async apply(ctx, data, _e, to) {
      const o = await ctx.trx.selectFrom('ai_runs').selectAll().where('id', '=', data.run_id).executeTakeFirstOrThrow();
      const action = o.action as AgentAction;
      // Runs from before the agents had none: they retry with the action's default agent.
      const agent = await agentFor(action, o.agent ?? undefined);
      const engine = await engineFor(ctx, agent, data.override);
      const { id } = await ctx.trx
        .insertInto('ai_runs')
        .values({
          project_id: ctx.projectId,
          action: o.action,
          scope: JSON.stringify(o.scope),
          ...runAgentColumns(agent, engine),
          schema_version: o.schema_version,
          model: null,
          context_pack_id: o.context_pack_id,
          retry_of: o.id,
          state: to,
          requested_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const projectId = ctx.projectId;
      ctx.afterCommit(() => ctx.services.engine.startRun(id, projectId));
      return {
        entityId: id,
        after: { retry_of: o.id, engine, override: data.override ?? null },
        result: { runId: id, contextPackId: o.context_pack_id },
      };
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
    data: z
      .object({
        output: z.unknown(),
        usage: usageSchema.nullable(),
        model: z.string().nullable(),
        session: sessionSchema.nullable().default(null),
      })
      .strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('ai_runs')
        .set({
          output: JSON.stringify(data.output ?? null),
          usage: data.usage ? JSON.stringify(data.usage) : null,
          model: data.model,
          ...sessionColumns(data.session),
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
        session: sessionSchema.nullable().default(null),
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
          ...sessionColumns(data.session),
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
        .set({ failure_kind: 'cancelled', error: data.reason ?? 'Cancelled by the person.', finished_at: now() })
        .where('id', '=', id)
        .execute();
      ctx.afterCommit(() => ctx.services.engine.cancelRun(id));
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
      : `The project's knowledge is not up to date: ${f.pending} update(s) are still pending. Try again once it finishes.`;
  },
});
