// Commands for the knowledge engine. The classifier and the updater (actor system) only write
// derived knowledge, classifications and proposals; never an authority state (I10). The
// taxonomy is authority, though: a person proposes it and approves it.

import { DomainError, formatActor, fingerprint, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { trimmed, field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { CommandContext } from '../bus/types.ts';
import { DISCARD_TRIGGER, registerAuthorityReaction } from '../commands/reactions.ts';

export const UPDATER = system('knowledge');

const axesSchema = z
  .array(
    z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9_]*$/),
        name: z.string().min(1),
        categories: z
          .array(
            z
              .object({
                code: z.string().regex(/^[a-z][a-z0-9_]*$/),
                name: z.string().min(1),
                description: z.string().min(1),
              })
              .strict(),
          )
          .min(2),
      })
      .strict(),
  )
  .min(1);

const nodeSchema = z
  .object({
    ref: z.string().min(1),
    type: z.string().min(1),
    label: z.string(),
    text: z.string(),
    categories: z.record(z.string(), z.string()),
    epistemic: z.enum(['confirmed', 'proposed', 'pending', 'unknown']),
    origin: z.object({ type: z.string(), id: z.string().uuid().nullable(), version: z.number().int().nullable() }).strict(),
    from: z.number().int().nonnegative(),
    update_id: z.string().uuid().nullable(),
  })
  .strict();

registerGuards({
  // As with record versions: approving a draft older than an already-approved version would roll back the current one.
  async taxonomy_without_later_approved({ ctx, entity }) {
    const later = await ctx.trx
      .selectFrom('taxonomies')
      .select('version')
      .where('project_id', '=', ctx.projectId)
      .where('code', '=', trimmed(entity?.row.code))
      .where('state', 'in', ['approved', 'superseded'])
      .where('version', '>', Number(entity?.row.version ?? 0))
      .orderBy('version', 'desc')
      .executeTakeFirst();
    return later ? `A later approved version (v${later.version}) of this taxonomy already exists.` : null;
  },
  valid_taxonomy: ({ data }) => {
    const r = axesSchema.safeParse(field(data, 'axes'));
    if (!r.success) return 'The taxonomy axes are not valid.';
    const reasons: string[] = [];
    for (const axis of r.data) {
      const codes = axis.categories.map((c) => c.code);
      if (!codes.includes('other')) reasons.push(`Axis ${axis.code} has no "other" category.`);
      if (new Set(codes).size !== codes.length) reasons.push(`Axis ${axis.code} has duplicate categories.`);
    }
    return reasons.length ? reasons.join(' ') : null;
  },

  // The taxonomy is a closed set: classification only ever uses the project's approved
  // taxonomy, one of its axes and one of its categories.
  valid_classification: async ({ ctx, data }) => {
    const t = await ctx.trx
      .selectFrom('taxonomies')
      .select(['axes', 'state'])
      .where('id', '=', trimmed(field(data, 'taxonomy_id')))
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    if (!t) return 'The taxonomy does not exist in this project.';
    if (t.state !== 'approved') return 'Classification only uses the approved taxonomy.';
    const axis = (t.axes as { code: string; categories: { code: string }[] }[]).find(
      (e) => e.code === trimmed(field(data, 'axis')),
    );
    if (!axis) return `"${trimmed(field(data, 'axis'))}" is not an axis of the taxonomy.`;
    const category = trimmed(field(data, 'category'));
    return axis.categories.some((c) => c.code === category) ? null : `"${category}" is not a category of axis ${axis.code}.`;
  },

  taxonomy_categories: async ({ ctx, data, entity }) => {
    const t = await ctx.trx
      .selectFrom('taxonomies')
      .select('axes')
      .where('id', '=', trimmed(entity?.row.taxonomy_id))
      .executeTakeFirst();
    const axis = ((t?.axes ?? []) as { code: string; categories: { code: string }[] }[]).find(
      (e) => e.code === trimmed(entity?.row.axis),
    );
    const category = trimmed(field(data, 'category'));
    return axis?.categories.some((c) => c.code === category)
      ? null
      : `"${category}" is not a category of the axis in the taxonomy.`;
  },
});

async function currentNode(ctx: CommandContext, ref: string): Promise<string> {
  const n = await ctx.trx
    .selectFrom('knowledge_nodes')
    .select('id')
    .where('project_id', '=', ctx.projectId)
    .where('ref', '=', ref)
    .where('valid_to', 'is', null)
    .executeTakeFirst();
  if (!n) throw new DomainError('not_found', `There is no current node ${ref}.`);
  return n.id;
}

registerHandlers({
  'taxonomy.propose': handler({
    data: z
      .object({
        code: z.string().regex(/^TAX-\d{3}$/),
        title: z.string().trim().min(3).max(200),
        axes: z.unknown(),
        sections: z.array(z.object({ title: z.string().min(1), content: z.string() }).strict()).default([]),
        // Explicit version: only for importing design/ while keeping the source's version.
        version: z.number().int().positive().optional(),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const axes = axesSchema.parse(data.axes);
      const prior = await ctx.trx
        .selectFrom('taxonomies')
        .select('version')
        .where('project_id', '=', ctx.projectId)
        .where('code', '=', data.code)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      if (data.version !== undefined && data.version <= (prior?.version ?? 0)) {
        throw new DomainError('validation', `Version ${data.version} of ${data.code} is not later than the last one.`);
      }
      const version = data.version ?? (prior?.version ?? 0) + 1;
      const { id } = await ctx.trx
        .insertInto('taxonomies')
        .values({
          project_id: ctx.projectId,
          code: data.code,
          version,
          title: data.title,
          axes: JSON.stringify(axes),
          sections: JSON.stringify(data.sections),
          content_hash: fingerprint({ title: data.title, axes, sections: data.sections }),
          state: to,
          author: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        version,
        after: { code: data.code, version, axes: axes.map((e) => e.code) },
        result: { taxonomyId: id, version },
      };
    },
  }),

  'taxonomy.approve': handler({
    data: z.object({}).strict(),
    async apply(ctx, _d, e) {
      const id = e?.id ?? '';
      const previous = await ctx.trx
        .selectFrom('taxonomies')
        .select('id')
        .where('project_id', '=', ctx.projectId)
        .where('code', '=', trimmed(e?.row.code))
        .where('state', '=', 'approved')
        .where('id', '<>', id)
        .execute();
      await ctx.trx
        .updateTable('taxonomies')
        .set({ approved_at: new Date(), approved_by: formatActor(ctx.actor) })
        .where('id', '=', id)
        .execute();
      for (const a of previous)
        await ctx.execute({ command: 'taxonomy.supersede', actor: system('taxonomy'), entityId: a.id, data: {} });
      return { entityId: id, version: Number(e?.row.version ?? 0) };
    },
  }),

  'taxonomy.supersede': handler({
    data: z.object({}).strict(),
    async apply(_ctx, _d, e) {
      return { entityId: e?.id ?? '' };
    },
  }),

  'knowledge_update.enqueue': handler({
    data: z
      .object({ object: z.object({ type: z.string(), id: z.string().uuid(), version: z.number().int().nullable() }).strict() })
      .strict(),
    async apply(ctx, data, _e, to) {
      const p = await ctx.trx
        .selectFrom('projects')
        .select('event_seq')
        .where('id', '=', ctx.projectId)
        .executeTakeFirstOrThrow();
      const { id } = await ctx.trx
        .insertInto('knowledge_updates')
        .values({ project_id: ctx.projectId, trigger: JSON.stringify(data.object), trigger_seq: p.event_seq, state: to })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { services, projectId } = ctx;
      ctx.afterCommit(() => services.engine.startUpdate(id, projectId));
      return { entityId: id, after: { object: data.object } };
    },
  }),

  'knowledge_update.classify': handler({
    data: z.object({}).strict(),
    async apply(_ctx, _d, e) {
      return { entityId: e?.id ?? '' };
    },
  }),

  'knowledge_update.verify': handler({
    data: z
      .object({
        change: z.unknown(),
        candidates: z.array(z.unknown()),
        input_hash: z.string(),
        classifier: z.string(),
        verdicts: z.unknown(),
      })
      .strict(),
    async apply(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('knowledge_updates')
        .set({
          change: JSON.stringify(d.change),
          candidates: JSON.stringify(d.candidates),
          candidates_hash: fingerprint(d.candidates),
          input_hash: d.input_hash,
          classifier: d.classifier,
          verdicts: JSON.stringify(d.verdicts),
        })
        .where('id', '=', id)
        .execute();
      return { entityId: id, after: { candidates: d.candidates.length, input_hash: d.input_hash } };
    },
  }),

  'knowledge_update.apply': handler({
    data: z.object({ operations: z.unknown(), version_before: z.number().int(), version_after: z.number().int() }).strict(),
    async apply(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('knowledge_updates')
        .set({
          verification: JSON.stringify({ ok: true }),
          operations: JSON.stringify(d.operations),
          graph_version_before: d.version_before,
          graph_version_after: d.version_after,
          finished_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      await sql`
        insert into knowledge_graph_state (project_id, version, last_update_id) values (${ctx.projectId}::uuid, ${d.version_after}, ${id}::uuid)
        on conflict (project_id) do update set version = excluded.version, last_update_id = excluded.last_update_id`.execute(
        ctx.trx,
      );
      return { entityId: id, after: { version_before: d.version_before, version_after: d.version_after } };
    },
  }),

  'knowledge_update.reject': handler({
    data: z.object({ reasons: z.array(z.string()).min(1) }).strict(),
    async apply(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('knowledge_updates')
        .set({
          verification: JSON.stringify({ ok: false, reasons: d.reasons }),
          failure: d.reasons.join(' '),
          finished_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return { entityId: id, after: { reasons: d.reasons } };
    },
  }),

  'knowledge_update.retry': handler({
    data: z.object({}).strict(),
    async apply(ctx, _d, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('knowledge_updates').set({ failure: null, finished_at: null }).where('id', '=', id).execute();
      const { services, projectId } = ctx;
      ctx.afterCommit(() => services.engine.startUpdate(id, projectId));
      return { entityId: id };
    },
  }),

  'knowledge_node.project': handler({
    data: nodeSchema,
    async apply(ctx, d, _e, to) {
      const { id } = await ctx.trx
        .insertInto('knowledge_nodes')
        .values({
          project_id: ctx.projectId,
          ref: d.ref,
          kind: d.type,
          source_type: d.origin.type,
          source_id: d.origin.id,
          source_version: d.origin.version,
          label: d.label,
          body: d.text,
          categories: JSON.stringify(d.categories),
          epistemic: d.epistemic,
          valid_from: d.from,
          created_by_update: d.update_id,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { ref: d.ref, epistemic: d.epistemic, categories: d.categories, from: d.from } };
    },
  }),

  'knowledge_node.invalidate': handler({
    data: z.object({ until: z.number().int().nonnegative() }).strict(),
    async apply(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('knowledge_nodes').set({ valid_to: d.until }).where('id', '=', id).execute();
      return { entityId: id, after: { ref: e?.row.ref, until: d.until } };
    },
  }),

  'knowledge_edge.project': handler({
    data: z
      .object({
        type: z.string(),
        from: z.string(),
        to: z.string(),
        valid_from: z.number().int().nonnegative(),
        update_id: z.string().uuid().nullable(),
      })
      .strict(),
    async apply(ctx, d, _e, to) {
      const { id } = await ctx.trx
        .insertInto('knowledge_edges')
        .values({
          project_id: ctx.projectId,
          kind: d.type,
          from_node: await currentNode(ctx, d.from),
          to_node: await currentNode(ctx, d.to),
          valid_from: d.valid_from,
          created_by_update: d.update_id,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { type: d.type, from: d.from, to: d.to, valid_from: d.valid_from } };
    },
  }),

  'knowledge_edge.invalidate': handler({
    data: z.object({ until: z.number().int().nonnegative() }).strict(),
    async apply(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('knowledge_edges').set({ valid_to: d.until }).where('id', '=', id).execute();
      return { entityId: id, after: { until: d.until } };
    },
  }),

  'classification.record': handler({ data: classificationSchema(), apply: insertClassification }),
  'classification.hold': handler({ data: classificationSchema(), apply: insertClassification }),

  'classification.resolve': handler({
    data: z.object({ category: z.string(), note: z.string().trim().max(1000).optional() }).strict(),
    async apply(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('classifications')
        .set({
          resolution: JSON.stringify({ category: d.category, note: d.note ?? null }),
          resolved_by: formatActor(ctx.actor),
        })
        .where('id', '=', id)
        .execute();
      return { entityId: id, after: { category: d.category } };
    },
  }),

  'idea_assessment.record': handler({
    data: z
      .object({
        proposal_id: z.string().uuid(),
        findings: z.array(z.unknown()),
        // Classifier responses that were not verified and, if the assessment failed, the reason.
        invalid: z.array(z.unknown()).default([]),
        error: z.string().max(2000).optional(),
        graph_version: z.number().int().nonnegative(),
        classifier: z.string(),
        input_hash: z.string(),
      })
      .strict(),
    async apply(ctx, d, _e, to) {
      const prior = await ctx.trx
        .selectFrom('idea_assessments')
        .select('id')
        .where('proposal_id', '=', d.proposal_id)
        .executeTakeFirst();
      if (prior) return { entityId: prior.id, noChanges: true };
      const { id } = await ctx.trx
        .insertInto('idea_assessments')
        .values({
          project_id: ctx.projectId,
          proposal_id: d.proposal_id,
          findings: JSON.stringify({ findings: d.findings, invalid: d.invalid, error: d.error ?? null }),
          graph_version: d.graph_version,
          classifier: d.classifier,
          input_hash: d.input_hash,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: {
          proposal: d.proposal_id,
          findings: d.findings.length,
          invalid: d.invalid.length,
          error: d.error ?? null,
        },
      };
    },
  }),
});

function classificationSchema() {
  return z
    .object({
      node_ref: z.string(),
      taxonomy_id: z.string().uuid(),
      axis: z.string(),
      category: z.string(),
      confidence: z.number().min(0).max(1),
      justification: z.string(),
      classifier: z.string(),
      input_hash: z.string(),
      update_id: z.string().uuid().nullable(),
    })
    .strict();
}

async function insertClassification(
  ctx: CommandContext,
  d: z.infer<ReturnType<typeof classificationSchema>>,
  _e: unknown,
  to: string,
): Promise<{ entityId: string; after: unknown }> {
  const { id } = await ctx.trx
    .insertInto('classifications')
    .values({
      project_id: ctx.projectId,
      node_ref: d.node_ref,
      taxonomy_id: d.taxonomy_id,
      axis: d.axis,
      category: d.category,
      confidence: d.confidence,
      justification: d.justification,
      classifier: d.classifier,
      input_hash: d.input_hash,
      update_id: d.update_id,
      state: to,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { entityId: id, after: { node: d.node_ref, axis: d.axis, category: d.category, confidence: d.confidence } };
}

// Every authority event (approving a version, accepting a proposal) and discarding a draft
// enqueue "Update knowledge" in the same transaction (§7.3 step 1).
registerAuthorityReaction(async (ctx, object) => {
  if (!['record_version', 'proposal', DISCARD_TRIGGER].includes(object.type)) return;
  if (object.type === 'proposal') {
    // Only proposals whose effect is a record version change the knowledge, and not if that
    // version was already approved in the same step ("Accept and approve", ratify): the
    // approval already enqueued its own update and the proposal would demote it back to proposed.
    const p = await ctx.trx.selectFrom('proposals').select('resolution').where('id', '=', object.id).executeTakeFirst();
    const versionId = (p?.resolution as { effect?: { versionId?: string } } | null)?.effect?.versionId;
    if (!versionId) return;
    const v = await ctx.trx.selectFrom('record_versions').select('state').where('id', '=', versionId).executeTakeFirst();
    if (v?.state !== 'draft') return;
  }
  await ctx.execute({ command: 'knowledge_update.enqueue', actor: UPDATER, data: { object } });
});
