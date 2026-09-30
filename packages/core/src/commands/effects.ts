// Effect of accepting each proposal type. Runs with the human actor who accepts, so
// every authority change carries its `human` event (I1).

import {
  DEFINITION_SECTIONS,
  DESIGN_SYSTEM_SECTION_TITLES,
  DomainError,
  PAYLOADS,
  type ProposalType,
  type Section,
  behaviorSteps,
  criterionStatement,
  definitionChangeNote,
  recordChangeSections,
} from '@demiurgo/domain';
import type { CommandContext } from '../bus/types.ts';
import { definitionStageId, proposeDefinitionIfCovered } from '../definition/compose.ts';
import { proposeCoveredPrinciples } from '../definition/principles.ts';
import { type CriterionInput, resolveReference } from './records.ts';

/** A feature criterion that names a Behavior step that doesn't exist is invalid output: nothing is applied. */
function assertStepsInRange(behavior: string, criteria: readonly { step?: number | null }[]): void {
  const n = behaviorSteps(behavior).length;
  for (const k of criteria)
    if (k.step != null && k.step > n)
      throw new DomainError('validation', `A criterion checks Behavior step ${k.step}, but the Behavior has ${n} steps.`);
}

export type Effect = Record<string, unknown>;
export type EffectInput = { proposalId: string; payload: unknown; approve: boolean };
export type Application = (ctx: CommandContext, e: EffectInput) => Promise<Effect>;

/**
 * The tasks of the same feature a task waits for, by title: one `depends_on` link each, to the task's
 * latest version. A dependency that is still a draft has no record yet: nothing is linked (the task
 * pages read the title from the proposal until it is there).
 */
async function dependencyLinks(ctx: CommandContext, feature: { code: string }, titles: readonly string[]) {
  if (titles.length === 0) return [];
  const rows = await ctx.trx
    .selectFrom('links')
    .innerJoin('record_versions as tv', 'tv.id', 'links.from_id')
    .innerJoin('records as task', 'task.id', 'tv.record_id')
    .innerJoin('record_versions as fv', 'fv.id', 'links.to_id')
    .innerJoin('records as f', 'f.id', 'fv.record_id')
    .select(['task.code', 'tv.n', 'tv.title'])
    .where('links.type', '=', 'based_on')
    .where('f.code', '=', feature.code)
    .where('task.type', '=', 'task')
    .where('task.project_id', '=', ctx.projectId)
    .orderBy('tv.n')
    .execute();
  const latest = new Map<string, { code: string; n: number }>();
  for (const r of rows) latest.set(r.code, { code: r.code, n: r.n });
  const byTitle = new Map<string, { code: string; n: number }>();
  for (const r of rows) if (latest.get(r.code)?.n === r.n) byTitle.set(r.title.trim().toLowerCase(), { code: r.code, n: r.n });
  const out: { type: string; target: { code: string; version: number } }[] = [];
  for (const t of titles) {
    const hit = byTitle.get(t.trim().toLowerCase());
    if (hit) out.push({ type: 'depends_on', target: { code: hit.code, version: hit.n } });
  }
  return out;
}

async function createRecord(ctx: CommandContext, data: Record<string, unknown>, approve: boolean): Promise<Effect> {
  const r = await ctx.execute({ command: 'record.create', actor: ctx.actor, data });
  const res = r.result as { recordId: string; code: string; versionId: string };
  if (approve) await ctx.execute({ command: 'record_version.approve', actor: ctx.actor, entityId: res.versionId, data: {} });
  return { type: 'record', code: res.code, recordId: res.recordId, versionId: res.versionId, version: 1, approved: approve };
}

/**
 * The planned feature a feature record is designed from, by its reserved code: it has to be still planned;
 * its epic's domain is the one its code was reserved with.
 */
async function plannedToDesign(ctx: CommandContext, code: string) {
  const f = await ctx.trx
    .selectFrom('planned_features')
    .innerJoin('records as epic', 'epic.id', 'planned_features.epic_id')
    .select(['planned_features.id', 'planned_features.code', 'planned_features.state', 'epic.domain'])
    .where('planned_features.project_id', '=', ctx.projectId)
    .where('planned_features.code', '=', code)
    .executeTakeFirst();
  if (f?.state !== 'planned')
    throw new DomainError('conflict', `${code} is not a planned feature any more: it may be designed or dropped already.`);
  return f;
}

/**
 * The links a version has going out (the ones that count), as a new version takes them over. A change
 * written now against the current basis (`rebase`) keeps even a link pending review and points each one
 * to its target's current approved version.
 */
async function outgoingLinks(ctx: CommandContext, versionId: string, rebase = false) {
  const links = await ctx.trx
    .selectFrom('links')
    .innerJoin('record_versions as target', 'target.id', 'links.to_id')
    .innerJoin('records', 'records.id', 'target.record_id')
    .select(['links.type', 'records.id as recordId', 'records.code', 'target.n'])
    .where('links.from_id', '=', versionId)
    .where('links.to_type', '=', 'record_version')
    .where('links.state', 'in', rebase ? ['current', 'kept', 'changed', 'needs_review'] : ['current', 'kept', 'changed'])
    .execute();
  const out: { type: string; target: { code: string; version: number } }[] = [];
  for (const l of links) {
    const current = rebase
      ? await ctx.trx
          .selectFrom('record_versions')
          .select('n')
          .where('record_id', '=', l.recordId)
          .where('state', '=', 'approved')
          .orderBy('n', 'desc')
          .executeTakeFirst()
      : undefined;
    out.push({ type: l.type, target: { code: l.code, version: current?.n ?? l.n } });
  }
  return out;
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
    assertStepsInRange(c.behavior, c.criteria);
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
        criteria: c.criteria.map((k) => ({ carry: 'new', ...k, statement: criterionStatement(k) })),
        ...(c.size ? { size: c.size } : {}),
        ...(c.sources?.length ? { practice_sources: c.sources } : {}),
        links: c.based_on ? [{ type: 'based_on', target: c.based_on }] : [],
        origin: { type: 'proposal', id: proposalId },
      },
      approve,
    );
  },

  // A design-stage record. A feature (fdr) that names the planned feature it designs takes its reserved code
  // (and its epic's domain) and ties that planned feature to the record; an epic lists its features in order,
  // and each becomes a planned feature of its own, reserving its code.
  async design_record(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.design_record.parse(payload);
    // A task comes with its size and why (FDR-DEL-006); an XL one also says how it could be split.
    if (c.record_type === 'task') {
      if (!c.size || !c.size_reason)
        throw new DomainError('validation', 'A task proposal needs its size (XS, S, M, L or XL) and a one-line reason.');
      if (c.size === 'XL' && !c.split)
        throw new DomainError('validation', 'An XL task proposal has to say how the task could be split.');
    }
    if (c.record_type === 'fdr')
      assertStepsInRange(c.sections.find((s) => s.title === 'Behavior')?.content ?? '', c.criteria);
    const planned = c.record_type === 'fdr' && c.code ? await plannedToDesign(ctx, c.code) : null;
    // A task is in its feature's area, whatever the proposal said.
    const feature =
      c.record_type === 'task' && c.based_on
        ? await ctx.trx
            .selectFrom('records')
            .select('domain')
            .where('project_id', '=', ctx.projectId)
            .where('code', '=', c.based_on.code)
            .executeTakeFirst()
        : undefined;
    const created = await createRecord(
      ctx,
      {
        type: c.record_type,
        ...(planned ? { code: planned.code } : {}),
        domain: planned?.domain ?? feature?.domain ?? c.domain ?? 'producto',
        ...(c.aspect ? { aspect: c.aspect } : {}),
        ...(c.record_type === 'task' ? { size: c.size, ...(c.covers?.length ? { covers: c.covers } : {}) } : {}),
        ...(c.record_type === 'fdr' && c.size ? { size: c.size } : {}),
        ...(c.sources?.length ? { practice_sources: c.sources } : {}),
        title: c.title,
        sections: c.sections,
        criteria: c.criteria.map((k) => ({ carry: 'new', ...k, statement: criterionStatement(k) })),
        // What it rests on, then the features it needs (a `based_on` link each: the map reads them as "needs").
        links: [
          ...[...(c.based_on ? [c.based_on] : []), ...(c.needs ?? [])].map((target) => ({ type: 'based_on', target })),
          ...(c.record_type === 'task' && c.based_on ? await dependencyLinks(ctx, c.based_on, c.depends_on_titles ?? []) : []),
        ],
        origin: { type: 'proposal', id: proposalId },
      },
      approve,
    );
    if (planned)
      await ctx.execute({
        command: 'planned_feature.design',
        actor: ctx.actor,
        entityId: planned.id,
        data: { record_id: String(created.recordId) },
      });
    if (c.record_type !== 'epic' || !c.features?.length) return created;
    const features: string[] = [];
    for (const f of c.features) {
      const r = await ctx.execute({
        command: 'planned_feature.add',
        actor: ctx.actor,
        data: { epic_id: created.recordId, name: f.name, summary: f.summary },
      });
      features.push((r.result as { code: string }).code);
    }
    return { ...created, features };
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
      .select(['code', 'verification', 'step'])
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
        step: k.step,
      };
    });
    const r = await ctx.execute({
      command: 'record_version.create',
      actor: ctx.actor,
      data: {
        record_id: v.recordId,
        title: c.title,
        sections: c.sections,
        criteria,
        links: await outgoingLinks(ctx, v.versionId),
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
    const waiting = async () => {
      await proposeDefinitionIfCovered(ctx, await definitionStageId(ctx.trx, ctx.projectId), { resolving: proposalId });
      await proposeCoveredPrinciples(ctx, proposalId);
    };
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

  // The project's design system: the first accepted proposal creates the DSY record (one per
  // project), a later one adds its next version. `spec` is stored with the version.
  async design_system(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.design_system.parse(payload);
    const origin = { type: 'proposal', id: proposalId };
    const sections = DESIGN_SYSTEM_SECTION_TITLES.map((title) => ({ title, content: c.sections[title] }));
    const existing = await ctx.trx
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', ctx.projectId)
      .where('type', '=', 'design_system')
      .executeTakeFirst();
    if (!existing) {
      return createRecord(
        ctx,
        { type: 'design_system', domain: 'design', title: c.title, sections, spec: c.spec, origin },
        approve,
      );
    }
    const r = await ctx.execute({
      command: 'record_version.create',
      actor: ctx.actor,
      data: {
        record_id: existing.id,
        title: c.title,
        sections,
        spec: c.spec,
        change_note: c.change_note ?? 'The design system changed.',
        origin,
      },
    });
    const res = r.result as { versionId: string; version: number; code: string };
    if (approve) await ctx.execute({ command: 'record_version.approve', actor: ctx.actor, entityId: res.versionId, data: {} });
    return {
      type: 'record',
      code: res.code,
      recordId: existing.id,
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

  // A change to a record, proposed in the thread that is about it (an epic's features, for one): the
  // next version is the one it changes with those sections replaced, those criteria added, modified or
  // dropped, the rest kept, and the links it had. Accepting it makes the version (a draft); approving
  // it puts it in force.
  async record_change(ctx, { proposalId, payload, approve }) {
    const c = PAYLOADS.record_change.parse(payload);
    const v = await resolveReference(ctx.trx, ctx.projectId, c.record.code, c.record.version);
    if (!v) throw new DomainError('not_found', `There is no ${c.record.code}@${c.record.version}.`);
    const base = await ctx.trx
      .selectFrom('record_versions')
      .select(['title', 'sections'])
      .where('id', '=', v.versionId)
      .executeTakeFirstOrThrow();
    const changed = new Map(recordChangeSections(c).map((x) => [x.section, x.content]));
    for (const title of changed.keys())
      if (!(base.sections as Section[]).some((s) => s.title === title))
        throw new DomainError('conflict', `${c.record.code} v${c.record.version} has no section "${title}".`);
    const sections = (base.sections as Section[]).map((s) => ({ title: s.title, content: changed.get(s.title) ?? s.content }));
    const priors = await ctx.trx
      .selectFrom('criteria')
      .select('code')
      .where('record_version_id', '=', v.versionId)
      .orderBy('position')
      .execute();
    const byCode = new Map((c.criteria ?? []).flatMap((k) => (k.action === 'add' ? [] : [[k.code, k] as const])));
    for (const code of byCode.keys())
      if (!priors.some((p) => p.code === code))
        throw new DomainError('conflict', `${c.record.code} v${c.record.version} has no criterion ${code}.`);
    const criteria: CriterionInput[] = [
      ...priors.flatMap((p): CriterionInput[] => {
        const k = byCode.get(p.code);
        if (!k) return [{ carry: 'kept' as const, code: p.code }];
        if (k.action === 'drop') return [];
        const { action: _, code, ...content } = k;
        return [{ carry: 'modified' as const, derived_from: code, ...content }];
      }),
      ...(c.criteria ?? []).flatMap((k): CriterionInput[] => {
        if (k.action !== 'add') return [];
        const { action: _, ...content } = k;
        return [{ carry: 'new' as const, ...content }];
      }),
    ];
    const discarded = (c.criteria ?? []).flatMap((k) => (k.action === 'drop' ? [k.code] : []));
    const r = await ctx.execute({
      command: 'record_version.create',
      actor: ctx.actor,
      data: {
        record_id: v.recordId,
        title: base.title,
        sections,
        criteria,
        discarded,
        links: await outgoingLinks(ctx, v.versionId, true),
        change_note: c.reason,
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

  // A change to the list of features of an epic, decided in its thread: one planned feature added, dropped
  // or moved. The list is not a version, so there is nothing to approve.
  async feature_plan(ctx, { payload }) {
    const c = PAYLOADS.feature_plan.parse(payload);
    const epic = await ctx.trx
      .selectFrom('records')
      .select(['id', 'type'])
      .where('project_id', '=', ctx.projectId)
      .where('code', '=', c.epic.code)
      .executeTakeFirst();
    if (epic?.type !== 'epic') throw new DomainError('not_found', `There is no epic ${c.epic.code}.`);
    if (c.action === 'add') {
      const r = await ctx.execute({
        command: 'planned_feature.add',
        actor: ctx.actor,
        data: { epic_id: epic.id, name: c.name, summary: c.summary, ...(c.position ? { position: c.position } : {}) },
      });
      return { type: 'planned_feature', action: c.action, code: (r.result as { code: string }).code };
    }
    const feature = c.code
      ? await ctx.trx
          .selectFrom('planned_features')
          .select(['id', 'state'])
          .where('project_id', '=', ctx.projectId)
          .where('epic_id', '=', epic.id)
          .where('code', '=', c.code)
          .executeTakeFirst()
      : undefined;
    if (!c.code || !feature || feature.state === 'dropped')
      throw new DomainError('conflict', `${c.code ?? 'The feature'} is not in the list of ${c.epic.code} any more.`);
    if (c.action === 'drop') {
      if (feature.state !== 'planned')
        throw new DomainError('conflict', `${c.code} is already designed, so it can't be dropped from the list.`);
      await ctx.execute({ command: 'planned_feature.drop', actor: ctx.actor, entityId: feature.id, data: { reason: c.reason } });
    } else {
      await ctx.execute({
        command: 'planned_feature.move',
        actor: ctx.actor,
        entityId: feature.id,
        data: { position: c.position ?? 1 },
      });
    }
    return { type: 'planned_feature', action: c.action, code: c.code };
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
