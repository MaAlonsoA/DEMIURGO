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
        domain: c.domain ?? 'product',
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
    const r = await ctx.execute({
      command: 'exploration.open',
      actor: ctx.actor,
      data: { purpose: c.purpose, origin: { type: 'proposal', id: proposalId } },
    });
    return { type: 'exploration', id: r.entityId };
  },

  async fdr(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.fdr.parse(payload);
    return createRecord(
      ctx,
      {
        type: 'fdr',
        domain: c.domain ?? 'product',
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
