// Batches and proposals: the channel through which the AI (and the importer) propose and the
// person decides. Nothing reaches `accepted` without an event from actor human (I1).

import {
  PAYLOADS,
  DomainError,
  MAX_EXTERNAL_AGENT_PROPOSALS,
  type ProposalType,
  isProposalType,
  dependencySchema,
  formatActor,
  system,
} from '@demiurgo/domain';
import { z } from 'zod';
import { trimmed, field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { CommandContext, LoadedEntity } from '../bus/types.ts';
import type { Db, Tx } from '../db/connection.ts';
import { APPLICATIONS, type Effect } from './effects.ts';
import { onAuthorityEvent } from './reactions.ts';

const uuid = z.string().uuid();

const proposalInputSchema = z
  .object({ type: z.string(), payload: z.record(z.string(), z.unknown()), dependencies: z.array(dependencySchema).default([]) })
  .strict();

type Dependency = z.infer<typeof dependencySchema>;

/**
 * Reasons for obsolescence. A dependency goes stale if its version was discarded or if the record's
 * current version is different; depending on a draft with no approved version does not go stale while it exists.
 */
export async function staleDependencies(trx: Db, deps: readonly Dependency[]): Promise<string[]> {
  const reasons: string[] = [];
  for (const d of deps) {
    const version = await trx
      .selectFrom('record_versions')
      .select('state')
      .where('record_id', '=', d.id)
      .where('n', '=', d.version)
      .executeTakeFirst();
    const current = await trx
      .selectFrom('record_versions')
      .select('n')
      .where('record_id', '=', d.id)
      .where('state', '=', 'approved')
      .orderBy('n', 'desc')
      .executeTakeFirst();
    if (!version || version.state === 'discarded') {
      reasons.push(`The proposal is obsolete: version ${d.version} of ${d.code} was discarded.`);
    } else if (current && current.n !== d.version) {
      reasons.push(
        `The proposal is obsolete: ${d.code} has changed (current: v${current.n}; the proposal was based on v${d.version}).`,
      );
    }
  }
  return reasons;
}

async function batchOf(trx: Tx, entity: LoadedEntity | null) {
  const batchId = trimmed(entity?.row.batch_id) || (entity?.id ?? '');
  return trx.selectFrom('proposal_batches').selectAll().where('id', '=', batchId).executeTakeFirstOrThrow();
}

registerGuards({
  // A proposal is only born within its batch's submission (or the importer), in a pending
  // batch of the same producer: nobody adds proposals to someone else's batch or one already resolved.
  own_open_batch: async ({ ctx, data }) => {
    if (!['batch.submit', 'design.import'].includes(ctx.cause.sourceCommand ?? '')) {
      return 'Proposals are submitted within a batch (batch.submit).';
    }
    const batch = await ctx.trx
      .selectFrom('proposal_batches')
      .select(['producer', 'state'])
      .where('id', '=', trimmed(field(data, 'batch_id')))
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    if (!batch) return 'The batch does not exist.';
    if (batch.state !== 'pending') return 'The batch is already resolved.';
    return batch.producer === formatActor(ctx.actor) ? null : 'Only the batch producer can add proposals to it.';
  },

  external_agent_batch_max_10: ({ ctx, data }) => {
    const n = (field(data, 'proposals') as unknown[] | undefined)?.length ?? 0;
    if (ctx.actor.type === 'agent_external' && n > MAX_EXTERNAL_AGENT_PROPOSALS) {
      return `An external agent can propose at most ${MAX_EXTERNAL_AGENT_PROPOSALS} items per batch (there are ${n}).`;
    }
    return null;
  },

  valid_payload: ({ ctx, data }) => {
    const type = trimmed(field(data, 'type'));
    if (!isProposalType(type)) return `Unknown proposal type: "${type}".`;
    if (ctx.actor.type === 'agent_external' && !['decision', 'exploration', 'fdr', 'design_record'].includes(type)) {
      return `An external agent cannot propose "${type}".`;
    }
    // Only the importer proposes what comes from design/: accepting it creates authority with the file's state.
    if (['imported_record', 'imported_taxonomy'].includes(type) && ctx.cause.sourceCommand !== 'design.import') {
      return `Only the design/ importer proposes "${type}".`;
    }
    const r = PAYLOADS[type].safeParse(field(data, 'payload'));
    return r.success
      ? null
      : `The proposal is invalid: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  },

  valid_edit: async ({ ctx, data, entity }) => {
    const type = trimmed(entity?.row.type) as ProposalType;
    if (!isProposalType(type)) return 'Unknown proposal type.';
    const r = PAYLOADS[type].safeParse(field(data, 'edit'));
    void ctx;
    return r.success ? null : `The edit is invalid: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  },

  per_element_resolution: async ({ ctx, entity }) => {
    const batch = await batchOf(ctx.trx, entity);
    const byPackage = ['batch.accept_package', 'batch.reject_package', 'batch.supersede'].includes(ctx.cause.sourceCommand ?? '');
    if (batch.resolution_mode === 'package' && !byPackage) {
      return ctx.command === 'proposal.supersede'
        ? 'This proposal is part of a package: the whole package becomes obsolete.'
        : 'This proposal is part of a package: the whole package is accepted or rejected together.';
    }
    return null;
  },

  package_resolution: async ({ ctx, entity }) => {
    const batch = await batchOf(ctx.trx, entity);
    return batch.resolution_mode === 'package' ? null : 'This batch is resolved item by item.';
  },

  current_dependencies: async ({ ctx, entity }) => {
    if (!entity) return null;
    const isBatch = ctx.command.startsWith('batch.');
    const batch = await batchOf(ctx.trx, entity);
    const deps = [...((batch.dependencies ?? []) as Dependency[])];
    if (isBatch) {
      const proposals = await ctx.trx
        .selectFrom('proposals')
        .select('dependencies')
        .where('batch_id', '=', batch.id)
        .where('state', '=', 'pending')
        .execute();
      for (const p of proposals) deps.push(...((p.dependencies ?? []) as Dependency[]));
    } else {
      deps.push(...((entity.row.dependencies ?? []) as Dependency[]));
    }
    const reasons = await staleDependencies(ctx.trx, deps);
    return reasons.length ? [...new Set(reasons)].join(' ') : null;
  },

  // A declared dependency points to a version that exists of a record in this project.
  project_dependencies: async ({ ctx, data }) => {
    const deps = [
      ...((field(data, 'dependencies') as Dependency[] | undefined) ?? []),
      ...((field(data, 'proposals') as { dependencies?: Dependency[] }[] | undefined) ?? []).flatMap((p) => p.dependencies ?? []),
    ];
    const reasons = new Set<string>();
    for (const d of deps) {
      const v = await ctx.trx
        .selectFrom('record_versions')
        .innerJoin('records', 'records.id', 'record_versions.record_id')
        .select('records.code')
        .where('records.id', '=', d.id)
        .where('records.project_id', '=', ctx.projectId)
        .where('record_versions.n', '=', d.version)
        .executeTakeFirst();
      if (v?.code !== d.code) reasons.add(`The dependency ${d.code} v${d.version} does not exist in this project.`);
    }
    return reasons.size ? [...reasons].join(' ') : null;
  },

  all_proposals_resolved: async ({ ctx, entity }) => {
    const pending = await ctx.trx
      .selectFrom('proposals')
      .select('id')
      .where('batch_id', '=', entity?.id ?? '')
      .where('state', '=', 'pending')
      .execute();
    return pending.length === 0 ? null : `${pending.length} proposal(s) still pending in the batch.`;
  },
});

/**
 * Marks as obsolete anything pending whose declared dependencies are no longer the current version:
 * the whole batch if the dependency belongs to the batch or if it resolves as a package (no accepting
 * half a package), and otherwise each affected proposal. Reviewed on approving a version and on
 * submitting a batch.
 */
export async function reviewObsolescence(ctx: CommandContext, filter: { record?: string; batch?: string }): Promise<void> {
  const affected = (deps: unknown) => ((deps ?? []) as Dependency[]).filter((d) => !filter.record || d.id === filter.record);
  let query = ctx.trx
    .selectFrom('proposal_batches')
    .select(['id', 'dependencies', 'resolution_mode'])
    .where('project_id', '=', ctx.projectId)
    .where('state', '=', 'pending');
  if (filter.batch) query = query.where('id', '=', filter.batch);
  for (const l of await query.execute()) {
    const ofBatch = await staleDependencies(ctx.trx, affected(l.dependencies));
    const proposals = await ctx.trx
      .selectFrom('proposals')
      .select(['id', 'dependencies'])
      .where('batch_id', '=', l.id)
      .where('state', '=', 'pending')
      .orderBy('position')
      .execute();
    const obsoleteProposals: { id: string; reason: string }[] = [];
    for (const p of proposals) {
      const reasons = await staleDependencies(ctx.trx, affected(p.dependencies));
      if (reasons.length) obsoleteProposals.push({ id: p.id, reason: [...new Set(reasons)].join(' ').slice(0, 2000) });
    }
    if (ofBatch.length || (l.resolution_mode === 'package' && obsoleteProposals.length)) {
      const reason = [...new Set([...ofBatch, ...obsoleteProposals.map((o) => o.reason)])].join(' ').slice(0, 2000);
      await ctx.execute({ command: 'batch.supersede', actor: system('versions'), entityId: l.id, data: { reason } });
      continue;
    }
    for (const o of obsoleteProposals) {
      await ctx.execute({
        command: 'proposal.supersede',
        actor: system('versions'),
        entityId: o.id,
        data: { reason: o.reason },
      });
    }
  }
}

/** References to records inside the payload that count as dependencies even if nobody declares them. */
async function payloadDependencies(ctx: CommandContext, payload: Record<string, unknown>): Promise<Dependency[]> {
  const ref = payload.based_on as { code?: unknown; version?: unknown } | undefined;
  if (typeof ref?.code !== 'string' || typeof ref.version !== 'number') return [];
  const r = await ctx.trx
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', ctx.projectId)
    .where('code', '=', ref.code)
    .executeTakeFirst();
  return r ? [{ type: 'record', id: r.id, code: ref.code, version: ref.version }] : [];
}

/** Closes an item-by-item batch once it has no pending proposals left. */
/** `resolving` is the proposal being resolved right now: its state changes when the command finishes. */
async function closeIfResolved(ctx: CommandContext, batchId: string, resolving: string): Promise<void> {
  // If the resolution comes from the batch itself (package or obsolescence), the batch changes its own state.
  if (['batch.accept_package', 'batch.reject_package', 'batch.supersede'].includes(ctx.cause.sourceCommand ?? '')) return;
  const batch = await ctx.trx
    .selectFrom('proposal_batches')
    .select(['state', 'resolution_mode'])
    .where('id', '=', batchId)
    .executeTakeFirstOrThrow();
  if (batch.state !== 'pending' || batch.resolution_mode !== 'item') return;
  const pending = await ctx.trx
    .selectFrom('proposals')
    .select('id')
    .where('batch_id', '=', batchId)
    .where('state', '=', 'pending')
    .where('id', '<>', resolving)
    .execute();
  if (pending.length === 0) await ctx.execute({ command: 'batch.close', actor: system('inbox'), entityId: batchId, data: {} });
}

async function applyProposal(
  ctx: CommandContext,
  e: LoadedEntity,
  payload: unknown,
  options: { approve: boolean },
): Promise<Effect> {
  const type = trimmed(e.row.type) as ProposalType;
  const apply = APPLICATIONS[type];
  if (!apply) throw new DomainError('not_implemented', `Accepting proposals of type "${type}" is not implemented yet.`);
  // Commands created by the proposal carry the proposal that originated them in their cause.
  const withCause: CommandContext = { ...ctx, execute: (p) => ctx.execute({ ...p, cause: { proposal: e.id, ...p.cause } }) };
  return apply(withCause, { proposalId: e.id, payload, approve: options.approve });
}

registerHandlers({
  'batch.submit': handler({
    data: z
      .object({
        summary: z.string().trim().max(2000).optional(),
        batch_type: z.enum(['agent', 'system_package', 'knowledge']).optional(),
        resolution: z.enum(['item', 'package']).optional(),
        run_id: uuid.optional(),
        context_pack_id: uuid.optional(),
        dependencies: z.array(dependencySchema).default([]),
        proposals: z.array(proposalInputSchema).min(1).max(50),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      // The channel fixes the batch type: an external agent always proposes item by item.
      const external = ctx.actor.type === 'agent_external';
      const batchType = external ? 'agent' : (data.batch_type ?? 'agent');
      const resolution = external ? 'item' : (data.resolution ?? 'item');
      if (batchType === 'agent' && resolution === 'package') {
        throw new DomainError('validation', 'An agent batch is resolved item by item.');
      }
      // The channel fixes the provenance: an external agent cannot attribute its batch to a run.
      const runId = ctx.actor.type === 'agent_run' ? ctx.actor.run : external ? null : (data.run_id ?? null);
      const packId = external ? null : (data.context_pack_id ?? null);
      const { id } = await ctx.trx
        .insertInto('proposal_batches')
        .values({
          project_id: ctx.projectId,
          kind: batchType,
          producer: formatActor(ctx.actor),
          run_id: runId,
          context_pack_id: packId,
          resolution_mode: resolution,
          dependencies: JSON.stringify(data.dependencies),
          summary: data.summary ?? null,
          tree_hash: null,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const ids: string[] = [];
      for (const [i, p] of data.proposals.entries()) {
        const r = await ctx.execute({
          command: 'proposal.create',
          actor: ctx.actor,
          data: { batch_id: id, position: i + 1, type: p.type, payload: p.payload, dependencies: p.dependencies },
        });
        ids.push(r.entityId);
      }
      // Anything created with a dependency that is no longer current becomes obsolete from the start.
      await reviewObsolescence(ctx, { batch: id });
      // Every idea from an agent (external or from a run, including design packages) is
      // assessed against the knowledge base (§7.7), outside the transaction.
      if (batchType === 'agent' || runId !== null) {
        const { services, projectId } = ctx;
        ctx.afterCommit(() => services.engine.startAssessment(id, projectId));
      }
      return {
        entityId: id,
        after: { type: batchType, resolution, proposals: data.proposals.length, producer: formatActor(ctx.actor) },
        result: { batchId: id, proposals: ids },
      };
    },
  }),

  'proposal.create': handler({
    data: z
      .object({
        batch_id: uuid,
        position: z.number().int().positive(),
        type: z.string(),
        payload: z.record(z.string(), z.unknown()),
        dependencies: z.array(dependencySchema).default([]),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const dependencies = [...data.dependencies];
      for (const d of await payloadDependencies(ctx, data.payload)) {
        // A reference to another version of the same record also counts: if they don't match, the proposal is born obsolete.
        if (!dependencies.some((x) => x.id === d.id && x.version === d.version)) dependencies.push(d);
      }
      const { id } = await ctx.trx
        .insertInto('proposals')
        .values({
          project_id: ctx.projectId,
          batch_id: data.batch_id,
          position: data.position,
          type: data.type,
          payload: JSON.stringify(data.payload),
          dependencies: JSON.stringify(dependencies),
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { batch: data.batch_id, type: data.type, dependencies } };
    },
  }),

  'proposal.accept': handler({
    data: z.object({ approve: z.boolean().default(false) }).strict(),
    async apply(ctx, data, e) {
      const entity = e as LoadedEntity;
      const effect = await applyProposal(ctx, entity, entity.row.payload, { approve: data.approve });
      await ctx.trx
        .updateTable('proposals')
        .set({ resolution: JSON.stringify({ effect }), resolved_by: formatActor(ctx.actor), resolved_at: new Date() })
        .where('id', '=', entity.id)
        .execute();
      await onAuthorityEvent(ctx, { type: 'proposal', id: entity.id, version: null });
      await closeIfResolved(ctx, trimmed(entity.row.batch_id), entity.id);
      return { entityId: entity.id, after: { effect, approve: data.approve }, result: effect };
    },
  }),

  'proposal.accept_edited': handler({
    data: z.object({ edit: z.record(z.string(), z.unknown()), approve: z.boolean().default(false) }).strict(),
    async apply(ctx, data, e) {
      const entity = e as LoadedEntity;
      const effect = await applyProposal(ctx, entity, data.edit, { approve: data.approve });
      await ctx.trx
        .updateTable('proposals')
        .set({
          resolution: JSON.stringify({ effect, edit: data.edit }),
          resolved_by: formatActor(ctx.actor),
          resolved_at: new Date(),
        })
        .where('id', '=', entity.id)
        .execute();
      await onAuthorityEvent(ctx, { type: 'proposal', id: entity.id, version: null });
      await closeIfResolved(ctx, trimmed(entity.row.batch_id), entity.id);
      return {
        entityId: entity.id,
        before: { payload: entity.row.payload },
        after: { effect, edit: data.edit },
        result: effect,
      };
    },
  }),

  'proposal.reject': handler({
    data: z.object({ reason: z.string().trim().max(2000).optional() }).strict(),
    async apply(ctx, data, e) {
      const entity = e as LoadedEntity;
      await ctx.trx
        .updateTable('proposals')
        .set({
          resolution: JSON.stringify({ reason: data.reason ?? null }),
          resolved_by: formatActor(ctx.actor),
          resolved_at: new Date(),
        })
        .where('id', '=', entity.id)
        .execute();
      await closeIfResolved(ctx, trimmed(entity.row.batch_id), entity.id);
      return { entityId: entity.id, after: { reason: data.reason ?? null } };
    },
  }),

  'proposal.supersede': handler({
    data: z.object({ reason: z.string().max(2000) }).strict(),
    async apply(ctx, data, e) {
      const entity = e as LoadedEntity;
      await ctx.trx
        .updateTable('proposals')
        .set({
          resolution: JSON.stringify({ obsolete: data.reason }),
          resolved_by: formatActor(ctx.actor),
          resolved_at: new Date(),
        })
        .where('id', '=', entity.id)
        .execute();
      await closeIfResolved(ctx, trimmed(entity.row.batch_id), entity.id);
      return { entityId: entity.id, after: { reason: data.reason } };
    },
  }),

  'batch.accept_package': handler({
    data: z.object({ approve: z.boolean().default(false) }).strict(),
    async apply(ctx, data, e) {
      const batch = e as LoadedEntity;
      const pending = await ctx.trx
        .selectFrom('proposals')
        .select('id')
        .where('batch_id', '=', batch.id)
        .where('state', '=', 'pending')
        .orderBy('position')
        .execute();
      const effects: unknown[] = [];
      for (const p of pending) {
        const r = await ctx.execute({
          command: 'proposal.accept',
          actor: ctx.actor,
          entityId: p.id,
          data: { approve: data.approve },
          cause: { sourceCommand: 'batch.accept_package', batch: batch.id },
        });
        effects.push(r.result);
      }
      await ctx.trx
        .updateTable('proposal_batches')
        .set({ resolved_by: formatActor(ctx.actor), resolved_at: new Date() })
        .where('id', '=', batch.id)
        .execute();
      return { entityId: batch.id, after: { accepted: pending.length, approve: data.approve }, result: { effects } };
    },
  }),

  'batch.reject_package': handler({
    data: z.object({ reason: z.string().trim().max(2000).optional() }).strict(),
    async apply(ctx, data, e) {
      const batch = e as LoadedEntity;
      const pending = await ctx.trx
        .selectFrom('proposals')
        .select('id')
        .where('batch_id', '=', batch.id)
        .where('state', '=', 'pending')
        .execute();
      for (const p of pending) {
        await ctx.execute({
          command: 'proposal.reject',
          actor: ctx.actor,
          entityId: p.id,
          data: data.reason ? { reason: data.reason } : {},
          cause: { sourceCommand: 'batch.reject_package', batch: batch.id },
        });
      }
      await ctx.trx
        .updateTable('proposal_batches')
        .set({ resolved_by: formatActor(ctx.actor), resolved_at: new Date() })
        .where('id', '=', batch.id)
        .execute();
      return { entityId: batch.id, after: { rejected: pending.length, reason: data.reason ?? null } };
    },
  }),

  'batch.close': handler({
    data: z.object({}).strict(),
    async apply(ctx, _d, e) {
      await ctx.trx
        .updateTable('proposal_batches')
        .set({ resolved_at: new Date() })
        .where('id', '=', e?.id ?? '')
        .execute();
      return { entityId: e?.id ?? '' };
    },
  }),

  'batch.supersede': handler({
    data: z.object({ reason: z.string().max(2000) }).strict(),
    async apply(ctx, data, e) {
      const batch = e as LoadedEntity;
      const pending = await ctx.trx
        .selectFrom('proposals')
        .select('id')
        .where('batch_id', '=', batch.id)
        .where('state', '=', 'pending')
        .execute();
      for (const p of pending) {
        await ctx.execute({
          command: 'proposal.supersede',
          actor: ctx.actor,
          entityId: p.id,
          data: { reason: data.reason },
          cause: { sourceCommand: 'batch.supersede', batch: batch.id },
        });
      }
      return { entityId: batch.id, after: { reason: data.reason } };
    },
  }),
});
