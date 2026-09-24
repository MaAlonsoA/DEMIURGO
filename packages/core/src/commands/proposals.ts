// Lotes y propuestas: el canal por el que la IA (y la importación) proponen y la persona
// decide. Nada llega a `accepted` sin un evento de actor human (I1).

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
import { string, field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { CommandContext, LoadedEntity } from '../bus/types.ts';
import type { Db, Tx } from '../db/connection.ts';
import { APPLICATIONS, type Effect } from './effects.ts';
import { onAuthorityEvent } from './reactions.ts';

const uuid = z.string().uuid();

const proposalEntrySchema = z
  .object({ type: z.string(), payload: z.record(z.string(), z.unknown()), dependencies: z.array(dependencySchema).default([]) })
  .strict();

type Dependency = z.infer<typeof dependencySchema>;

/**
 * Motivos de obsolescencia. Una dependencia caduca si su versión se descartó o si la vigente del
 * registro es otra; depender de un borrador sin ninguna versión aprobada no caduca mientras exista.
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
      reasons.push(`La propuesta está obsoleta: la versión ${d.version} de ${d.code} se ha descartado.`);
    } else if (current && current.n !== d.version) {
      reasons.push(
        `La propuesta está obsoleta: ${d.code} ha cambiado (vigente: v${current.n}; la propuesta partía de v${d.version}).`,
      );
    }
  }
  return reasons;
}

async function batchOf(trx: Tx, entity: LoadedEntity | null) {
  const batchId = string(entity?.row.batch_id) || (entity?.id ?? '');
  return trx.selectFrom('proposal_batches').selectAll().where('id', '=', batchId).executeTakeFirstOrThrow();
}

registerGuards({
  // Una propuesta solo nace dentro del envío de su lote (o de la importación), en un lote
  // pendiente del mismo productor: nadie añade propuestas a un lote ajeno o ya resuelto.
  own_open_batch: async ({ ctx, data }) => {
    if (!['batch.submit', 'design.import'].includes(ctx.cause.sourceCommand ?? '')) {
      return 'Las propuestas se envían dentro de un lote (batch.submit).';
    }
    const batch = await ctx.trx
      .selectFrom('proposal_batches')
      .select(['producer', 'state'])
      .where('id', '=', string(field(data, 'batch_id')))
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    if (!batch) return 'El lote no existe.';
    if (batch.state !== 'pending') return 'El lote ya está resuelto.';
    return batch.producer === formatActor(ctx.actor) ? null : 'Solo el productor del lote puede añadirle propuestas.';
  },

  external_agent_batch_max_10: ({ ctx, data }) => {
    const n = (field(data, 'proposals') as unknown[] | undefined)?.length ?? 0;
    if (ctx.actor.type === 'agent_external' && n > MAX_EXTERNAL_AGENT_PROPOSALS) {
      return `Un agente externo propone como máximo ${MAX_EXTERNAL_AGENT_PROPOSALS} elementos por lote (hay ${n}).`;
    }
    return null;
  },

  valid_payload: ({ ctx, data }) => {
    const type = string(field(data, 'type'));
    if (!isProposalType(type)) return `Tipo de propuesta desconocido: «${type}».`;
    if (ctx.actor.type === 'agent_external' && !['decision', 'exploration', 'fdr'].includes(type)) {
      return `Un agente externo no puede proponer «${type}».`;
    }
    // Lo importado de design/ solo lo propone la importación: aceptarlo crea autoridad con el estado del archivo.
    if (['imported_record', 'imported_taxonomy'].includes(type) && ctx.cause.sourceCommand !== 'design.import') {
      return `Solo la importación de design/ propone «${type}».`;
    }
    const r = PAYLOADS[type].safeParse(field(data, 'payload'));
    return r.success
      ? null
      : `La propuesta no es válida: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  },

  valid_edit: async ({ ctx, data, entity }) => {
    const type = string(entity?.row.type) as ProposalType;
    if (!isProposalType(type)) return 'Tipo de propuesta desconocido.';
    const r = PAYLOADS[type].safeParse(field(data, 'edit'));
    void ctx;
    return r.success
      ? null
      : `La edición no es válida: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  },

  per_element_resolution: async ({ ctx, entity }) => {
    const batch = await batchOf(ctx.trx, entity);
    const byPackage = ['batch.accept_package', 'batch.reject_package', 'batch.supersede'].includes(
      ctx.cause.sourceCommand ?? '',
    );
    if (batch.resolution_mode === 'package' && !byPackage) {
      return ctx.command === 'proposal.supersede'
        ? 'Esta propuesta forma parte de un paquete: queda obsoleto el paquete completo.'
        : 'Esta propuesta forma parte de un paquete: se acepta o se rechaza el paquete completo.';
    }
    return null;
  },

  package_resolution: async ({ ctx, entity }) => {
    const batch = await batchOf(ctx.trx, entity);
    return batch.resolution_mode === 'package' ? null : 'Este lote se resuelve elemento a elemento.';
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

  // Una dependencia declarada apunta a una versión que existe de un registro de este proyecto.
  project_dependencies: async ({ ctx, data }) => {
    const deps = [
      ...((field(data, 'dependencies') as Dependency[] | undefined) ?? []),
      ...((field(data, 'proposals') as { dependencies?: Dependency[] }[] | undefined) ?? []).flatMap(
        (p) => p.dependencies ?? [],
      ),
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
      if (v?.code !== d.code) reasons.add(`La dependencia ${d.code} v${d.version} no existe en este proyecto.`);
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
    return pending.length === 0 ? null : `Quedan ${pending.length} propuesta(s) pendiente(s) en el lote.`;
  },
});

/**
 * Deja obsoleto lo pendiente cuyas dependencias declaradas ya no son la versión vigente: el lote
 * entero si la dependencia es del lote o si se resuelve en paquete (no se acepta medio paquete) y,
 * si no, cada propuesta afectada. Se revisa al aprobar una versión y al enviar un lote.
 */
export async function reviewObsolescence(ctx: CommandContext, filter: { record?: string; batch?: string }): Promise<void> {
  const affected = (deps: unknown) =>
    ((deps ?? []) as Dependency[]).filter((d) => !filter.record || d.id === filter.record);
  let queryName = ctx.trx
    .selectFrom('proposal_batches')
    .select(['id', 'dependencies', 'resolution_mode'])
    .where('project_id', '=', ctx.projectId)
    .where('state', '=', 'pending');
  if (filter.batch) queryName = queryName.where('id', '=', filter.batch);
  for (const l of await queryName.execute()) {
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

/** Referencias a registros dentro de la carga que son dependencias aunque nadie las declare. */
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

/** Cierra un lote por elementos cuando ya no le quedan propuestas pendientes. */
/** `resolviendo` es la propuesta que se está resolviendo ahora: su estado cambia al terminar el comando. */
async function closeIfResolved(ctx: CommandContext, batchId: string, resolving: string): Promise<void> {
  // Si la resolución viene del propio lote (paquete u obsolescencia), el lote cambia de estado él mismo.
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
  if (pending.length === 0)
    await ctx.execute({ command: 'batch.close', actor: system('inbox'), entityId: batchId, data: {} });
}

async function applyProposal(
  ctx: CommandContext,
  e: LoadedEntity,
  payload: unknown,
  options: { approve: boolean },
): Promise<Effect> {
  const type = string(e.row.type) as ProposalType;
  const apply = APPLICATIONS[type];
  if (!apply) throw new DomainError('not_implemented', `Aceptar propuestas de tipo «${type}» aún no está implementado.`);
  // Los comandos que crea la propuesta llevan en su causa la propuesta que los originó.
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
        proposals: z.array(proposalEntrySchema).min(1).max(50),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      // El canal fija el tipo de lote: un agente externo siempre propone por elementos.
      const external = ctx.actor.type === 'agent_external';
      const batchType = external ? 'agent' : (data.batch_type ?? 'agent');
      const resolution = external ? 'item' : (data.resolution ?? 'item');
      if (batchType === 'agent' && resolution === 'package') {
        throw new DomainError('validation', 'Un lote de agente se resuelve elemento a elemento.');
      }
      // La procedencia la fija el canal: un agente externo no puede atribuir su lote a una ejecución.
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
      // Lo que nace con una dependencia que ya no es la vigente queda obsoleto desde el principio.
      await reviewObsolescence(ctx, { batch: id });
      // Cada idea de un agente (externo o de una ejecución, también los paquetes de diseño) se
      // evalúa contra el conocimiento (§7.7), fuera de la transacción.
      if (batchType === 'agent' || runId !== null) {
        const { services, projectId } = ctx;
        ctx.afterConfirm(() => services.engine.startEvaluation(id, projectId));
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
        // Una referencia a otra versión del mismo registro también cuenta: si no coinciden, la propuesta nace obsoleta.
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
      await closeIfResolved(ctx, string(entity.row.batch_id), entity.id);
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
      await closeIfResolved(ctx, string(entity.row.batch_id), entity.id);
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
      await closeIfResolved(ctx, string(entity.row.batch_id), entity.id);
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
      await closeIfResolved(ctx, string(entity.row.batch_id), entity.id);
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
