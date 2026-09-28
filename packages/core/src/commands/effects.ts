// Effect of accepting each proposal type. Runs with the human actor who accepts, so
// every authority change carries its `human` event (I1).

import { PAYLOADS, DomainError, type ProposalType } from '@demiurgo/domain';
import type { CommandContext } from '../bus/types.ts';
import { resolveReference } from './records.ts';

export type Effect = Record<string, unknown>;
export type EffectInput = { proposalId: string; payload: unknown; approve: boolean };
export type Application = (ctx: CommandContext, e: EffectInput) => Promise<Effect>;

async function createRecord(ctx: CommandContext, data: Record<string, unknown>, approve: boolean): Promise<Effect> {
  const r = await ctx.execute({ command: 'record.create', actor: ctx.actor, data });
  const res = r.result as { recordId: string; code: string; versionId: string };
  if (approve) await ctx.execute({ command: 'record_version.approve', actor: ctx.actor, entityId: res.versionId, data: {} });
  return { type: 'record', code: res.code, recordId: res.recordId, versionId: res.versionId, version: 1, approved: approve };
}

export const APPLICATIONS: Partial<Record<ProposalType, Application>> = {
  async decision(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.decision.parse(payload);
    return createRecord(
      ctx,
      {
        type: 'decision',
        domain: c.domain ?? 'producto',
        title: c.title,
        sections: [
          { title: 'Context', content: c.context },
          { title: 'Decision', content: c.decision },
          { title: 'Consequences', content: c.consequences },
        ],
        origin: { type: 'proposal', id: proposalId },
      },
      approve,
    );
  },

  async exploration(ctx, { proposalId, payload }) {
    const c = PAYLOADS.exploration.parse(payload);
    // A fork: when DEMIURGO proposed it from a thread, the new thread hangs from that thread.
    const from = await ctx.trx
      .selectFrom('proposals')
      .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
      .innerJoin('ai_runs', 'ai_runs.id', 'proposal_batches.run_id')
      .select('ai_runs.scope')
      .where('proposals.id', '=', proposalId)
      .executeTakeFirst();
    const scope = from?.scope as { type?: string; id?: string } | undefined;
    const parent = scope?.type === 'exploration' && scope.id ? scope.id : undefined;
    const r = await ctx.execute({
      command: 'exploration.open',
      actor: ctx.actor,
      data: { purpose: c.purpose, ...(parent ? { parent_id: parent } : {}), origin: { type: 'proposal', id: proposalId } },
    });
    return { type: 'exploration', id: r.entityId };
  },

  async fdr(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.fdr.parse(payload);
    return createRecord(
      ctx,
      {
        type: 'fdr',
        domain: c.domain ?? 'producto',
        title: c.title,
        sections: [
          { title: 'Goal', content: c.goal },
          { title: 'Scope', content: c.scope },
          { title: 'Out of scope', content: c.out_of_scope },
          { title: 'Behavior', content: c.behavior },
        ],
        criteria: c.criteria.map((k) => ({ carry: 'new', ...k })),
        links: c.based_on ? [{ type: 'based_on', target: c.based_on }] : [],
        origin: { type: 'proposal', id: proposalId },
      },
      approve,
    );
  },

  async design_record(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.design_record.parse(payload);
    return createRecord(
      ctx,
      {
        type: c.record_type,
        domain: c.domain ?? 'producto',
        title: c.title,
        sections: c.sections,
        criteria: c.criteria.map((k) => ({ carry: 'new', ...k })),
        origin: { type: 'proposal', id: proposalId },
      },
      approve,
    );
  },

  // The English version of a record written in another language: a new version with the same
  // structure. Criteria are carried over as modified (same verification), section titles and the
  // current links are kept; only the prose changes. Approving it (Accept and approve) supersedes the
  // version it translates, like any new version.
  async record_translation(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.record_translation.parse(payload);
    const v = await resolveReference(ctx.trx, ctx.projectId, c.record.code, c.record.version);
    if (!v) throw new DomainError('not_found', `There is no ${c.record.code}@${c.record.version}.`);
    const source = await ctx.trx
      .selectFrom('criteria')
      .select(['code', 'verification'])
      .where('record_version_id', '=', v.versionId)
      .orderBy('position')
      .execute();
    const translated = new Map(c.criteria.map((k) => [k.code, k]));
    const criteria = source.map((k) => {
      const t = translated.get(k.code);
      if (!t) throw new DomainError('validation', `The English version is missing the criterion ${k.code}.`);
      return {
        carry: 'modified' as const,
        derived_from: k.code,
        title: t.title,
        statement: t.statement,
        verification: k.verification,
        check: t.check,
      };
    });
    const links = await ctx.trx
      .selectFrom('links')
      .innerJoin('record_versions as target', 'target.id', 'links.to_id')
      .innerJoin('records', 'records.id', 'target.record_id')
      .select(['links.type', 'records.code', 'target.n'])
      .where('links.from_id', '=', v.versionId)
      .where('links.to_type', '=', 'record_version')
      .where('links.state', 'in', ['current', 'kept', 'changed'])
      .execute();
    const r = await ctx.execute({
      command: 'record_version.create',
      actor: ctx.actor,
      data: {
        record_id: v.recordId,
        title: c.title,
        sections: c.sections,
        criteria,
        links: links.map((l) => ({ type: l.type, target: { code: l.code, version: l.n } })),
        change_note: `English version of v${c.record.version}: the same content, translated (records are kept in English).`,
        origin: { type: 'proposal', id: proposalId },
      },
    });
    const res = r.result as { versionId: string; version: number; code: string };
    if (approve) await ctx.execute({ command: 'record_version.approve', actor: ctx.actor, entityId: res.versionId, data: {} });
    return {
      type: 'record',
      code: res.code,
      recordId: v.recordId,
      versionId: res.versionId,
      version: res.version,
      approved: approve,
    };
  },

  // The product definition the system composed from the stage's answers: the first version creates
  // the record; a later one is the next version of it, with its change note.
  async product_definition(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.product_definition.parse(payload);
    const origin = { type: 'proposal', id: proposalId };
    if (!c.record) {
      return createRecord(
        ctx,
        { type: 'product_definition', domain: 'producto', title: c.title, sections: c.sections, origin },
        approve,
      );
    }
    const v = await resolveReference(ctx.trx, ctx.projectId, c.record.code, c.record.version);
    if (!v) throw new DomainError('not_found', `There is no ${c.record.code}@${c.record.version}.`);
    const r = await ctx.execute({
      command: 'record_version.create',
      actor: ctx.actor,
      data: {
        record_id: v.recordId,
        title: c.title,
        sections: c.sections,
        change_note: c.change_note ?? 'The product definition changed.',
        origin,
      },
    });
    const res = r.result as { versionId: string; version: number; code: string };
    if (approve) await ctx.execute({ command: 'record_version.approve', actor: ctx.actor, entityId: res.versionId, data: {} });
    return {
      type: 'record',
      code: res.code,
      recordId: v.recordId,
      versionId: res.versionId,
      version: res.version,
      approved: approve,
    };
  },

  // Accepting a review proposed by knowledge doesn't change the record: it opens an
  // exploration to review it, with its origin.
  async review(ctx, { payload }) {
    const c = PAYLOADS.review.parse(payload);
    const v = await resolveReference(ctx.trx, ctx.projectId, c.record.code, c.record.version);
    if (!v) throw new DomainError('not_found', `There is no ${c.record.code}@${c.record.version}.`);
    const r = await ctx.execute({
      command: 'exploration.open',
      actor: ctx.actor,
      data: {
        purpose: `Review ${c.record.code} v${c.record.version}: ${c.reason}`.slice(0, 1000),
        origin: { type: 'record_version', id: v.versionId, version: c.record.version },
      },
    });
    return { type: 'exploration', id: r.entityId };
  },
};

export function registerApplication(type: ProposalType, a: Application): void {
  APPLICATIONS[type] = a;
}
