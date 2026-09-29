// Effect of accepting each proposal type. Runs with the human actor who accepts, so
// every authority change carries its `human` event (I1).

import {
  DEFINITION_SECTIONS,
  DomainError,
  PAYLOADS,
  type ProposalType,
  type Section,
  definitionChangeNote,
} from '@demiurgo/domain';
import type { CommandContext } from '../bus/types.ts';
import { definitionStageId, proposeDefinitionIfCovered } from '../definition/compose.ts';
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
        ...(c.aspect ? { aspect: c.aspect } : {}),
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
        ...(c.aspect ? { aspect: c.aspect } : {}),
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
        ...(c.aspect ? { aspect: c.aspect } : {}),
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
  // the record; a later one is the next version of it, with its change note. An answer that changed
  // while it waited gets proposed right after, in the next version.
  async product_definition(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.product_definition.parse(payload);
    const origin = { type: 'proposal', id: proposalId };
    const waiting = async () =>
      proposeDefinitionIfCovered(ctx, await definitionStageId(ctx.trx, ctx.projectId), { resolving: proposalId });
    if (!c.record) {
      const created = await createRecord(
        ctx,
        { type: 'product_definition', domain: 'producto', title: c.title, sections: c.sections, origin },
        approve,
      );
      await waiting();
      return created;
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
    await waiting();
    return {
      type: 'record',
      code: res.code,
      recordId: v.recordId,
      versionId: res.versionId,
      version: res.version,
      approved: approve,
    };
  },

  // A change to one section of the definition, proposed in a thread. Accepting it is the person's
  // decision on that section, in one step: its answer changes (the question reopened with the reason
  // and confirmed with the new text) and the next version, the one in force with only this section
  // changed, is created and approved. A definition only means something approved, so it always is.
  // Answers confirmed meanwhile that the definition doesn't have yet are proposed after, as always.
  async definition_change(ctx, { proposalId, payload }) {
    const c = PAYLOADS.definition_change.parse(payload);
    const v = await resolveReference(ctx.trx, ctx.projectId, c.record.code, c.record.version);
    if (!v) throw new DomainError('not_found', `There is no ${c.record.code}@${c.record.version}.`);
    const key = DEFINITION_SECTIONS.find((s) => s.title === c.section)?.key;
    const stageId = await definitionStageId(ctx.trx, ctx.projectId);
    const question =
      stageId && key
        ? await ctx.trx
            .selectFrom('questions')
            .select(['id', 'state'])
            .where('stage_id', '=', stageId)
            .where('stage_key', '=', key)
            .executeTakeFirst()
        : undefined;
    if (!question)
      throw new DomainError('conflict', `${c.section} was never asked in this project, so it can't change from a thread.`);
    if (['confirmed', 'discarded', 'postponed'].includes(question.state)) {
      await ctx.execute({ command: 'question.reopen', actor: ctx.actor, entityId: question.id, data: { reason: c.reason } });
    }
    await ctx.execute({ command: 'question.confirm', actor: ctx.actor, entityId: question.id, data: { conclusion: c.content } });
    const base = await ctx.trx
      .selectFrom('record_versions')
      .select(['title', 'sections'])
      .where('id', '=', v.versionId)
      .executeTakeFirstOrThrow();
    const sections = (base.sections as Section[]).map((s) =>
      s.title === c.section ? { title: s.title, content: c.content } : s,
    );
    const r = await ctx.execute({
      command: 'record_version.create',
      actor: ctx.actor,
      data: {
        record_id: v.recordId,
        title: base.title,
        sections,
        change_note: definitionChangeNote([{ section: c.section, why: c.reason }]),
        origin: { type: 'proposal', id: proposalId },
      },
    });
    const res = r.result as { versionId: string; version: number; code: string };
    await ctx.execute({ command: 'record_version.approve', actor: ctx.actor, entityId: res.versionId, data: {} });
    await proposeDefinitionIfCovered(ctx, stageId, { afterChange: true });
    return {
      type: 'record',
      code: res.code,
      recordId: v.recordId,
      versionId: res.versionId,
      version: res.version,
      approved: true,
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
