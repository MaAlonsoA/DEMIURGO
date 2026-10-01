// Records (decision, FDR, ADR, bug), immutable versions, criteria and links.
// Identity, version, approval and implementation are four different things: approving doesn't
// create a version (I4), and a new version requires explicitly carrying over every criterion.

import {
  aspectOfType,
  COVERED_QUESTION_STATES,
  STAGES,
  designSystemSpec,
  screenDesignSpec,
  missingComponents,
  missingComponentsReason,
  aspectSchema,
  DomainError,
  VERSION_LIMITS,
  practiceSources,
  RECORD_PREFIX,
  RECORD_TYPES,
  type RecordType,
  verifiabilityWarnings,
  templateGaps,
  formatActor,
  fingerprint,
  system,
  taskSizeSchema,
} from '@demiurgo/domain';
import { z } from 'zod';
import { trimmed, field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { CommandContext } from '../bus/types.ts';
import type { Tx } from '../db/connection.ts';
import { approvedDesignSystem, screenDesignChecks } from '../design/screens.ts';
import { reviewObsolescence } from './proposals.ts';
import { appendSize } from './sizes.ts';
import { jevAllowed } from '../classifier/aspect.ts';
import { classifyTaskSize } from '../classifier/size.ts';
import { classifyTaskTestability } from '../classifier/testability.ts';
import { DISCARD_TRIGGER, onAuthorityEvent } from './reactions.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();
const RE_CODE = /^(DEC|FDR|ADR|BUG)-[A-Z]{3}-\d{3}$/;
// What a link points to: any record, an epic (EPC) or the definition (DEF) too.
const RE_TARGET = /^[A-Z]{3}-[A-Z]{3}-\d{3}$/;
const LINK_TYPES = ['based_on', 'design_of', 'covers', 'origin', 'conflicts_with', 'derived_from', 'depends_on'] as const;

const L = VERSION_LIMITS;
const sectionSchema = z.object({ title: text(L.sectionTitle), content: z.string().max(L.section) }).strict();
const criterionContent = {
  title: text(L.criterionTitle),
  statement: text(L.statement),
  verification: z.enum(['automatic', 'manual']),
  check: text(L.check),
  step: z.number().int().min(1).nullable().optional(),
  // Given/When/Then apart (all three or none); `statement` stays the composed sentence.
  given: text(L.check).nullable().optional(),
  when: text(L.check).nullable().optional(),
  then: text(L.check).nullable().optional(),
};
export const criterionInputSchema = z.discriminatedUnion('carry', [
  z
    .object({
      carry: z.literal('new'),
      code: z
        .string()
        .regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/)
        .optional(),
      // A new criterion may derive from another one in the project with a different code.
      derived_from: z
        .string()
        .regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/)
        .optional(),
      ...criterionContent,
    })
    .strict(),
  z.object({ carry: z.literal('kept'), code: z.string() }).strict(),
  z.object({ carry: z.literal('modified'), derived_from: z.string(), ...criterionContent }).strict(),
]);
export type CriterionInput = z.infer<typeof criterionInputSchema>;

export const linkInputSchema = z
  .object({
    type: z.enum(LINK_TYPES),
    target: z.object({ code: z.string().regex(RE_TARGET), version: z.number().int().positive() }).strict(),
  })
  .strict();

const originSchema = z.object({ type: z.string(), id: z.string(), version: z.number().int().nullable().optional() }).strict();

const versionContentSchema = {
  title: text(L.title),
  sections: z.array(sectionSchema).min(1).max(L.sections),
  criteria: z.array(criterionInputSchema).max(L.criteria).default([]),
  // The practice sources (unverified) the version was based on.
  practice_sources: practiceSources.optional(),
  // A design system's machine-readable part (tokens, components, patterns): part of the immutable content.
  spec: z.union([designSystemSpec, screenDesignSpec]).optional(),
  discarded: z.array(z.string()).default([]),
  links: z.array(linkInputSchema).max(L.links).default([]),
  // Annexes in order (tables as data): stored and exported as-is.
  annexes: z.array(z.object({ path: z.string().regex(/^data\/[a-z0-9-]+\.yaml$/), content: z.string() }).strict()).default([]),
  // Explicit version number: only for importing design/ while respecting the origin's version.
  number: z.number().int().positive().optional(),
  increment: z
    .string()
    .regex(/^(D|S|H)\d+$/)
    .optional(),
  change_note: z.string().trim().max(L.changeNote).optional(),
  origin: originSchema.optional(),
};

export const newRecordSchema = z
  .object({
    type: z.enum(RECORD_TYPES),
    code: z.string().regex(RE_CODE).optional(),
    // Letters only: the domain names the code (DEC-DOM-NNN), and a code is letters (ADR-FMT-001).
    domain: z.string().regex(/^[a-z][a-z_]*$/, 'The domain can only contain lowercase letters and underscores.'),
    // The aspect of the product it is about; by default, the one its type fixes (domain/aspects.ts).
    aspect: aspectSchema.optional(),
    // A task's effort size (FDR-DEL-006): required for a new task; null only for one brought in from
    // design/ without it (legacy, "No size"). Kept outside the versioned content.
    size: taskSizeSchema.nullable().optional(),
    // A task's covered feature criteria (codes), outside its versioned content.
    covers: z.array(z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/)).max(L.criteria).optional(),
    ...versionContentSchema,
  })
  .strict();

const newVersionSchema = z.object({ record_id: uuid, ...versionContentSchema }).strict();

/** Last non-discarded version of a record: the basis for carrying over criteria. */
async function baseVersion(trx: Tx, recordId: string) {
  return trx
    .selectFrom('record_versions')
    .selectAll()
    .where('record_id', '=', recordId)
    .where('state', '<>', 'discarded')
    .orderBy('n', 'desc')
    .executeTakeFirst();
}

export async function currentVersion(trx: Tx, recordId: string) {
  return trx
    .selectFrom('record_versions')
    .selectAll()
    .where('record_id', '=', recordId)
    .where('state', '=', 'approved')
    .orderBy('n', 'desc')
    .executeTakeFirst();
}

export async function resolveReference(trx: Tx, projectId: string, code: string, version: number) {
  return trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.id as versionId', 'record_versions.state', 'records.id as recordId', 'records.type'])
    .where('records.project_id', '=', projectId)
    .where('records.code', '=', code)
    .where('record_versions.n', '=', version)
    .executeTakeFirst();
}

// The DOM-NNN part of a code is unique across types: its criteria are named AC-DOM-NNN-NN. The codes an
// epic's planned features reserve count too.
export async function nextCode(trx: Tx, projectId: string, type: RecordType, domain: string): Promise<string> {
  const dom = domain.replaceAll('_', '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const rows = [
    ...(await trx
      .selectFrom('records')
      .select('code')
      .where('project_id', '=', projectId)
      .where('code', 'like', `___-${dom}-___`)
      .execute()),
    ...(await trx
      .selectFrom('planned_features')
      .select('code')
      .where('project_id', '=', projectId)
      .where('code', 'like', `___-${dom}-___`)
      .execute()),
  ];
  const max = rows.reduce((m, f) => Math.max(m, Number(f.code.slice(-3))), 0);
  return `${RECORD_PREFIX[type]}-${dom}-${String(max + 1).padStart(3, '0')}`;
}

registerGuards({
  async free_code({ ctx, data }) {
    const code = trimmed(field(data, 'code'));
    if (!code) return null;
    const existing = await ctx.trx
      .selectFrom('records')
      .select('code')
      .where('project_id', '=', ctx.projectId)
      .where('code', 'like', `___-${code.slice(4)}`)
      .executeTakeFirst();
    // A planned feature's reserved code: free only for the record that designs it.
    const reserved = await ctx.trx
      .selectFrom('planned_features')
      .select(['code', 'state'])
      .where('project_id', '=', ctx.projectId)
      .where('code', 'like', `___-${code.slice(4)}`)
      .executeTakeFirst();
    if (reserved && !existing)
      return reserved.code === code && reserved.state === 'planned' && field(data, 'type') === 'fdr'
        ? null
        : `${code} is reserved for the planned feature ${reserved.code}.`;
    if (!existing) return null;
    return existing.code === code
      ? `Code ${code} already exists in this project.`
      : `${code} shares ${code.slice(4)} with ${existing.code}: the DOM-NNN part of a code is unique across types.`;
  },

  async valid_template({ ctx, data, entity }) {
    if (ctx.command === 'record_version.approve') {
      const v = entity?.row as { record_id: string; sections: { title: string; content: string }[] } | undefined;
      const r = await ctx.trx
        .selectFrom('records')
        .select('type')
        .where('id', '=', v?.record_id ?? '')
        .executeTakeFirstOrThrow();
      const gaps = templateGaps(r.type as RecordType, v?.sections ?? [], true);
      return gaps.length ? gaps.join(' ') : null;
    }
    let type = field(data, 'type') as RecordType | undefined;
    if (!type) {
      const r = await ctx.trx
        .selectFrom('records')
        .select('type')
        .where('id', '=', trimmed(field(data, 'record_id')))
        .executeTakeFirst();
      type = r?.type as RecordType | undefined;
    }
    if (!type) return 'The record does not exist.';
    const gaps = templateGaps(type, (field(data, 'sections') as { title: string; content: string }[] | undefined) ?? []);
    return gaps.length ? gaps.join(' ') : null;
  },

  async criteria_carry_complete({ ctx, data }) {
    const recordId = trimmed(field(data, 'record_id'));
    const base = await baseVersion(ctx.trx, recordId);
    if (!base) return null;
    const criteria = (field(data, 'criteria') as CriterionInput[] | undefined) ?? [];
    const discarded = new Set((field(data, 'discarded') as string[] | undefined) ?? []);
    const covered = new Set<string>(discarded);
    for (const c of criteria) {
      if (c.carry === 'kept') covered.add(c.code);
      if (c.carry === 'modified') covered.add(c.derived_from);
    }
    const priors = await ctx.trx.selectFrom('criteria').select('code').where('record_version_id', '=', base.id).execute();
    const missing = priors.map((p) => p.code).filter((c) => !covered.has(c));
    const reasons: string[] = [];
    if (missing.length) reasons.push(`Still need to decide what to do with ${missing.join(', ')}: keep, modify or discard.`);
    if (!trimmed(field(data, 'change_note'))) reasons.push('A new version requires a change note.');
    const unknown = [...covered].filter((c) => !priors.some((p) => p.code === c));
    if (unknown.length) reasons.push(`${unknown.join(', ')} is not in version ${base.n}.`);
    return reasons.length ? reasons.join(' ') : null;
  },

  async record_of_project({ ctx, data }) {
    const r = await ctx.trx
      .selectFrom('records')
      .select('id')
      .where('id', '=', trimmed(field(data, 'record_id')))
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    return r ? null : 'The record does not exist in this project.';
  },

  // The most recent approved version is the current one: approving an earlier one would leave two approved.
  async without_later_approved({ ctx, entity }) {
    const v = entity?.row as { record_id: string; n: number } | undefined;
    const later = await ctx.trx
      .selectFrom('record_versions')
      .select('n')
      .where('record_id', '=', v?.record_id ?? '')
      .where('state', 'in', ['approved', 'superseded'])
      .where('n', '>', v?.n ?? 0)
      .orderBy('n', 'desc')
      .executeTakeFirst();
    return later ? `There is already a later approved version (v${later.n}): discard this draft or create a new version.` : null;
  },

  // A version's criteria and links are only created together with it: afterwards its content doesn't change (I4).
  within_its_version({ ctx, data }) {
    const versionId = trimmed(field(data, 'version_id')) || trimmed(field(field(data, 'from'), 'id'));
    return ctx.cause.versionBeingCreated === versionId
      ? null
      : 'Criteria and links are created with their version: create a new version of the record.';
  },

  async version_in_draft({ ctx, data }) {
    const v = await ctx.trx
      .selectFrom('record_versions')
      .select('state')
      .where('id', '=', trimmed(field(data, 'version_id')))
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    return v?.state === 'draft' ? null : 'Criteria can only be added to a draft version.';
  },

  // An approved version is only superseded when there is another later approved version of the same record.
  async has_later_approved({ ctx, entity }) {
    const v = entity?.row as { record_id: string; n: number } | undefined;
    const later = await ctx.trx
      .selectFrom('record_versions')
      .select('id')
      .where('record_id', '=', v?.record_id ?? '')
      .where('state', '=', 'approved')
      .where('n', '>', v?.n ?? 0)
      .executeTakeFirst();
    return later ? null : 'An approved version is only superseded when a later one is approved.';
  },

  async endpoints_exist({ ctx, data }) {
    for (const endpoint of ['from', 'to']) {
      const id = trimmed(field(field(data, endpoint), 'id'));
      const v = await ctx.trx
        .selectFrom('record_versions')
        .select('id')
        .where('id', '=', id)
        .where('project_id', '=', ctx.projectId)
        .executeTakeFirst();
      if (!v) return `The "${endpoint}" endpoint of the link does not exist.`;
    }
    return null;
  },
});

/** Creates the version along with its criteria and links via nested commands from the same actor. */
async function createVersion(
  ctx: CommandContext,
  recordId: string,
  data: z.infer<typeof newVersionSchema>,
  to: string,
): Promise<{ id: string; n: number; code: string; warnings: string[] }> {
  const record = await ctx.trx.selectFrom('records').selectAll().where('id', '=', recordId).executeTakeFirstOrThrow();
  const base = await baseVersion(ctx.trx, recordId);
  const n =
    (
      await ctx.trx
        .selectFrom('record_versions')
        .select('n')
        .where('record_id', '=', recordId)
        .orderBy('n', 'desc')
        .executeTakeFirst()
    )?.n ?? 0;
  if (data.number !== undefined && data.number <= n) {
    throw new DomainError('validation', `Version ${data.number} is not later than the last one (${n}).`);
  }
  const number = data.number ?? n + 1;
  // A design system's machine-readable spec travels with its text: a version made without one (a
  // record_change edits sections only) keeps the previous version's.
  const spec = data.spec ?? (record.type === 'design_system' ? ((base?.spec as typeof data.spec | null) ?? undefined) : undefined);
  const priors = base
    ? await ctx.trx.selectFrom('criteria').selectAll().where('record_version_id', '=', base.id).orderBy('position').execute()
    : [];
  const byCode = new Map(priors.map((p) => [p.code, p]));
  const acPrefix = `AC-${record.code.slice(4)}-`;
  // An AC code is never reused, not even one from a criterion discarded in an earlier version.
  const used = new Set(
    (
      await ctx.trx
        .selectFrom('criteria')
        .innerJoin('record_versions', 'record_versions.id', 'criteria.record_version_id')
        .select('criteria.code')
        .where('record_versions.record_id', '=', recordId)
        .execute()
    ).map((c) => c.code),
  );
  let next = [...used].reduce((m, c) => Math.max(m, Number(c.slice(-2))), 0);
  // New criteria that derive from another: the one with that code in the latest version that contains it.
  const derived = new Map<string, string>();
  for (const c of data.criteria) {
    if (c.carry !== 'new' || !c.derived_from) continue;
    const origin = await ctx.trx
      .selectFrom('criteria')
      .innerJoin('record_versions', 'record_versions.id', 'criteria.record_version_id')
      .select('criteria.id')
      .where('criteria.project_id', '=', ctx.projectId)
      .where('criteria.code', '=', c.derived_from)
      .orderBy('record_versions.n', 'desc')
      .executeTakeFirst();
    if (!origin) throw new DomainError('validation', `${c.derived_from}, which a new criterion derives from, does not exist.`);
    derived.set(c.derived_from, origin.id);
  }
  const criteria = data.criteria.map((c) => {
    if (c.carry === 'kept') {
      const p = byCode.get(c.code);
      if (!p) throw new DomainError('validation', `${c.code} is not in the previous version.`);
      return {
        code: p.code,
        title: p.title,
        statement: p.statement,
        verification: p.verification,
        check: p.check_text,
        step: p.step,
        given: p.given_text,
        when: p.when_text,
        then: p.then_text,
        carry: 'kept',
        derivation: p.id,
      };
    }
    if (c.carry === 'modified') {
      const p = byCode.get(c.derived_from);
      if (!p) throw new DomainError('validation', `${c.derived_from} is not in the previous version.`);
      return {
        code: p.code,
        title: c.title,
        statement: c.statement,
        verification: c.verification,
        check: c.check,
        step: c.step === undefined ? p.step : c.step,
        given: c.given ?? null,
        when: c.when ?? null,
        then: c.then ?? null,
        carry: 'modified',
        derivation: p.id,
      };
    }
    const code = c.code ?? `${acPrefix}${String(++next).padStart(2, '0')}`;
    if (!code.startsWith(acPrefix)) throw new DomainError('validation', `Code ${code} must start with ${acPrefix}.`);
    if (used.has(code)) {
      throw new DomainError(
        'validation',
        `Code ${code} was already used in a previous version: a new criterion needs a new code.`,
      );
    }
    return {
      code,
      title: c.title,
      statement: c.statement,
      verification: c.verification,
      check: c.check,
      step: c.step ?? null,
      given: c.given ?? null,
      when: c.when ?? null,
      then: c.then ?? null,
      carry: 'new',
      derivation: c.derived_from ? (derived.get(c.derived_from) ?? null) : null,
    };
  });
  const codes = criteria.map((c) => c.code);
  if (new Set(codes).size !== codes.length) throw new DomainError('validation', 'There are criteria with the same code.');
  const content = {
    title: data.title,
    sections: data.sections,
    criteria: criteria.map(({ code, title, statement, verification, check, step }) => ({
      code,
      title,
      statement,
      verification,
      check,
      ...(step == null ? {} : { step }),
    })),
    annexes: data.annexes,
    increment: data.increment ?? null,
    ...(spec ? { spec } : {}),
  };
  const { id } = await ctx.trx
    .insertInto('record_versions')
    .values({
      project_id: ctx.projectId,
      record_id: recordId,
      n: number,
      title: data.title,
      sections: JSON.stringify(data.sections),
      annexes: JSON.stringify(data.annexes),
      increment: data.increment ?? null,
      change_note: data.change_note ?? null,
      origin: data.origin ? JSON.stringify(data.origin) : null,
      author: formatActor(ctx.actor),
      content_hash: fingerprint(content),
      practice_sources: data.practice_sources?.length ? JSON.stringify(data.practice_sources) : null,
      spec: spec ? JSON.stringify(spec) : null,
      state: to,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const [i, c] of criteria.entries()) {
    await ctx.execute({
      command: 'criterion.record',
      actor: ctx.actor,
      data: {
        version_id: id,
        code: c.code,
        title: c.title,
        statement: c.statement,
        verification: c.verification,
        check: c.check,
        step: c.step,
        given: c.given,
        when: c.when,
        then: c.then,
        carry: c.carry,
        derived_from_id: c.derivation,
        position: i + 1,
      },
      cause: { versionBeingCreated: id },
    });
  }
  for (const e of data.links) {
    const target = await resolveReference(ctx.trx, ctx.projectId, e.target.code, e.target.version);
    if (!target)
      throw new DomainError('validation', `The link points to ${e.target.code}@${e.target.version}, which does not exist.`);
    await ctx.execute({
      command: 'link.create',
      actor: ctx.actor,
      data: { type: e.type, from: { type: 'record_version', id }, to: { type: 'record_version', id: target.versionId } },
      cause: { versionBeingCreated: id },
    });
  }
  // The verifiability check never blocks: the warning comes back with the created version (AC-DIS-001-14).
  const warnings = criteria.flatMap((c) => verifiabilityWarnings(c.code, c.statement));
  return { id, n: number, code: record.code, warnings };
}

/**
 * The design handoff (a person pastes the screens designed in Claude Design): the screen design created
 * or approved by a person passes the same checks as one proposed by an agent. Its spec must be valid
 * against the feature version it rests on (422) and use only components the approved design system has (409).
 */
async function assertScreenDesign(trx: Tx, projectId: string, spec: unknown, missingOnly = false): Promise<void> {
  const parsed = screenDesignSpec.safeParse(spec);
  if (!parsed.success) throw new DomainError('validation', 'A screen design needs its machine-readable spec (feature, screens and flow).');
  if (!missingOnly) {
    const problems = await screenDesignChecks(trx, projectId, parsed.data);
    if (problems.length > 0) throw new DomainError('validation', problems.join(' '));
  }
  const dsy = await approvedDesignSystem(trx, projectId);
  const reason = missingComponentsReason(missingComponents(parsed.data, dsy?.components ?? []));
  if (reason) throw new DomainError('conflict', reason);
}

/**
 * Pass the open onboarding stages whose mandatory questions are all covered, in order: approving
 * the definition (or the change that adds a stage's section to it) is the person's decision on
 * those stages, so they need not hunt for «Pass stage».
 */
async function passDefinitionStage(ctx: CommandContext): Promise<void> {
  for (const key of STAGES.filter((s) => s.moment === 'onboarding').map((s) => s.key)) {
    const stage = await ctx.trx
      .selectFrom('stages')
      .select('id')
      .where('project_id', '=', ctx.projectId)
      .where('stage', '=', key)
      .where('state', '=', 'open')
      .executeTakeFirst();
    if (!stage) continue;
    const uncovered = await ctx.trx
      .selectFrom('questions')
      .select('id')
      .where('stage_id', '=', stage.id)
      .where('stage_key', 'is not', null)
      .where('state', 'not in', [...COVERED_QUESTION_STATES])
      .executeTakeFirst();
    if (uncovered) return;
    await ctx.execute({ command: 'stage.pass', actor: ctx.actor, projectId: ctx.projectId, entityId: stage.id, data: {} });
  }
}

registerHandlers({
  'record.create': handler({
    data: newRecordSchema,
    async apply(ctx, data, _e, to) {
      if (data.type === 'screen_design') await assertScreenDesign(ctx.trx, ctx.projectId, data.spec);
      if (data.type === 'product_definition') {
        const existing = await ctx.trx
          .selectFrom('records')
          .select('code')
          .where('project_id', '=', ctx.projectId)
          .where('type', '=', 'product_definition')
          .executeTakeFirst();
        if (existing)
          throw new DomainError(
            'validation',
            `The project already has its product definition, ${existing.code}: change it with a new version.`,
          );
      }
      if (data.type === 'design_system') {
        const existing = await ctx.trx
          .selectFrom('records')
          .select('code')
          .where('project_id', '=', ctx.projectId)
          .where('type', '=', 'design_system')
          .executeTakeFirst();
        if (existing)
          throw new DomainError(
            'validation',
            `The project already has its design system, ${existing.code}: change it with a new version.`,
          );
      }
      if (data.type === 'task' && data.size === undefined)
        throw new DomainError('validation', 'A new task needs its effort size: XS, S, M, L or XL.');
      if (data.type !== 'task' && data.type !== 'fdr' && data.size)
        throw new DomainError('validation', 'Only a task or a feature has an effort size.');
      const code = data.code ?? (await nextCode(ctx.trx, ctx.projectId, data.type, data.domain));
      if (!code.startsWith(`${RECORD_PREFIX[data.type]}-`)) {
        throw new DomainError('validation', `Code ${code} does not match a record of type "${data.type}".`);
      }
      const { id } = await ctx.trx
        .insertInto('records')
        .values({
          project_id: ctx.projectId,
          code: code,
          type: data.type,
          domain: data.domain,
          aspect: data.aspect ?? aspectOfType(data.type),
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if ((data.type === 'task' || data.type === 'fdr') && data.size) await appendSize(ctx, id, data.size, null);
      if (data.type !== 'task' && data.covers?.length) throw new DomainError('validation', 'Only a task covers criteria.');
      if (data.type === 'task' && data.covers?.length)
        await ctx.trx
          .insertInto('task_covers')
          .values({ project_id: ctx.projectId, record_id: id, codes: [...new Set(data.covers)], set_by: formatActor(ctx.actor) })
          .execute();
      const { type: _t, code: _c, domain: _d, aspect: _a, size: _s, covers: _cv, ...content } = data;
      const v = await ctx.execute({
        command: 'record_version.create',
        actor: ctx.actor,
        data: { record_id: id, ...content },
      });
      return {
        entityId: id,
        after: { code, type: data.type, domain: data.domain, ...(data.type === 'task' ? { size: data.size ?? null } : {}) },
        result: {
          recordId: id,
          code,
          versionId: v.entityId,
          version: (v.result as { version: number }).version,
          warnings: (v.result as { warnings: string[] }).warnings,
        },
      };
    },
  }),

  'record_version.create': handler({
    data: newVersionSchema,
    async apply(ctx, data, _e, to) {
      const kind = await ctx.trx.selectFrom('records').select('type').where('id', '=', data.record_id).executeTakeFirst();
      if (kind?.type === 'screen_design') await assertScreenDesign(ctx.trx, ctx.projectId, data.spec);
      const v = await createVersion(ctx, data.record_id, data, to);
      // A task's new content (its first version or a later one): Jev's size opinion, after the commit (FDR-DEL-006).
      const rec = await ctx.trx.selectFrom('records').select('type').where('id', '=', data.record_id).executeTakeFirst();
      if (rec?.type === 'task' && jevAllowed()) {
        const services = ctx.services;
        const projectId = ctx.projectId;
        ctx.afterCommit(() => void classifyTaskSize(services, projectId, data.record_id, v.id));
        // And its criteria the builder cannot satisfy with a CI test (H97): a warning, never a block.
        ctx.afterCommit(() => void classifyTaskTestability(services, projectId, data.record_id, v.id));
      }
      return {
        entityId: v.id,
        version: v.n,
        after: { code: v.code, n: v.n, title: data.title, change_note: data.change_note ?? null },
        result: { versionId: v.id, version: v.n, code: v.code, warnings: v.warnings },
      };
    },
  }),

  'record_version.approve': handler({
    data: z.object({ note: z.string().trim().max(2000).optional() }).strict(),
    async apply(ctx, data, e) {
      const v = e?.row as { id: string; record_id: string; n: number; spec?: unknown };
      const kind = await ctx.trx.selectFrom('records').select('type').where('id', '=', v.record_id).executeTakeFirst();
      if (kind?.type === 'screen_design') await assertScreenDesign(ctx.trx, ctx.projectId, v.spec, true);
      const previous = await ctx.trx
        .selectFrom('record_versions')
        .selectAll()
        .where('record_id', '=', v.record_id)
        .where('state', '=', 'approved')
        .where('id', '<>', v.id)
        .orderBy('n', 'desc')
        .executeTakeFirst();
      await ctx.trx
        .updateTable('record_versions')
        .set({ approved_at: new Date(), approved_by: formatActor(ctx.actor) })
        .where('id', '=', v.id)
        .execute();
      if (previous && previous.n < v.n) {
        await ctx.execute({
          command: 'record_version.supersede',
          actor: system('versions'),
          entityId: previous.id,
          data: {},
        });
        // What rested on the previous version is not flagged wholesale: the knowledge update of this
        // version compares every one of them and returns as a review only what it contradicts, quoted.
      }
      // Earlier drafts of the same record can no longer be approved (a later version is): close them.
      const earlierDrafts = await ctx.trx
        .selectFrom('record_versions')
        .select('id')
        .where('record_id', '=', v.record_id)
        .where('state', '=', 'draft')
        .where('n', '<', v.n)
        .orderBy('n')
        .execute();
      for (const d of earlierDrafts) {
        await ctx.execute({
          command: 'record_version.discard',
          actor: system('versions'),
          entityId: d.id,
          data: { reason: `Superseded by v${v.n}, which was approved.` },
        });
      }
      await reviewObsolescence(ctx, { record: v.record_id });
      await onAuthorityEvent(ctx, { type: 'record_version', id: v.id, version: v.n });
      // Approving the product definition for the first time passes stage 1 (Product definition) when
      // its questions are all covered: the person's approval is the decision, so they need not hunt
      // for «Pass stage». Stage 2 opens as it does whenever a stage passes.
      if (kind?.type === 'product_definition' && ctx.actor.type === 'human') await passDefinitionStage(ctx);
      return { entityId: v.id, version: v.n, after: { note: data.note ?? null, supersedes: previous?.n ?? null } };
    },
  }),

  'record_version.supersede': handler({
    data: z.object({}).strict(),
    async apply(_ctx, _d, e) {
      return { entityId: e?.id ?? '', version: Number(e?.row.n ?? 0) };
    },
  }),

  'record_version.discard': handler({
    data: z.object({ reason: z.string().trim().max(1000).optional() }).strict(),
    async apply(ctx, data, e) {
      const n = Number(e?.row.n ?? 0);
      // Anything that linked to this draft is left pending review, and anything that depended on it becomes obsolete.
      const links = await ctx.trx
        .selectFrom('links')
        .select('id')
        .where('to_id', '=', e?.id ?? '')
        .where('state', 'in', ['current', 'kept', 'changed'])
        .execute();
      for (const l of links) {
        await ctx.execute({
          command: 'link.flag_review',
          actor: system('versions'),
          entityId: l.id,
          data: { reason: `The linked version (v${n}) has been discarded.` },
        });
      }
      await reviewObsolescence(ctx, { record: trimmed(e?.row.record_id) });
      // Anything the draft projected into the knowledge graph (if it came from an accepted proposal) is withdrawn.
      await onAuthorityEvent(ctx, { type: DISCARD_TRIGGER, id: e?.id ?? '', version: n });
      return { entityId: e?.id ?? '', version: n, after: { reason: data.reason ?? null } };
    },
  }),

  'criterion.record': handler({
    data: z
      .object({
        version_id: uuid,
        code: z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/),
        ...criterionContent,
        carry: z.enum(['new', 'kept', 'modified']),
        derived_from_id: uuid.nullable(),
        position: z.number().int().positive(),
      })
      .strict(),
    async apply(ctx, d, _e, to) {
      const record = await ctx.trx
        .selectFrom('record_versions')
        .innerJoin('records', 'records.id', 'record_versions.record_id')
        .select('records.code')
        .where('record_versions.id', '=', d.version_id)
        .executeTakeFirstOrThrow();
      if (!d.code.startsWith(`AC-${record.code.slice(4)}-`)) {
        throw new DomainError('validation', `Code ${d.code} does not match ${record.code}.`);
      }
      const { id } = await ctx.trx
        .insertInto('criteria')
        .values({
          project_id: ctx.projectId,
          record_version_id: d.version_id,
          code: d.code,
          title: d.title,
          statement: d.statement,
          verification: d.verification,
          check_text: d.check,
          step: d.step ?? null,
          given_text: d.given ?? null,
          when_text: d.when ?? null,
          then_text: d.then ?? null,
          derived_from: d.derived_from_id,
          carry: d.carry,
          position: d.position,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { code: d.code, version: d.version_id, carry: d.carry } };
    },
  }),

  'link.create': handler({
    data: z
      .object({
        type: z.enum(LINK_TYPES),
        from: z.object({ type: z.literal('record_version'), id: uuid }).strict(),
        to: z.object({ type: z.literal('record_version'), id: uuid }).strict(),
      })
      .strict(),
    async apply(ctx, d, _e, to) {
      const n = async (id: string) =>
        (await ctx.trx.selectFrom('record_versions').select('n').where('id', '=', id).executeTakeFirstOrThrow()).n;
      const { id } = await ctx.trx
        .insertInto('links')
        .values({
          project_id: ctx.projectId,
          type: d.type,
          from_type: d.from.type,
          from_id: d.from.id,
          from_version: await n(d.from.id),
          to_type: d.to.type,
          to_id: d.to.id,
          to_version: await n(d.to.id),
          state: to,
          created_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { type: d.type, from: d.from.id, to: d.to.id } };
    },
  }),

  'link.flag_review': handler({
    data: z.object({ reason: z.string().max(1000) }).strict(),
    async apply(_ctx, d, e) {
      return { entityId: e?.id ?? '', after: { reason: d.reason } };
    },
  }),
  'link.keep': handler({
    data: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
    async apply(_ctx, d, e) {
      return { entityId: e?.id ?? '', after: { note: d.note ?? null } };
    },
  }),
  'link.change': handler({
    data: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
    async apply(_ctx, d, e) {
      return { entityId: e?.id ?? '', after: { note: d.note ?? null } };
    },
  }),
  // «Still valid»: the person confirms what rests on an older version still holds against the current
  // one. The link keeps pointing at the version it was written against; it records the one it was confirmed against.
  'link.revalidate': handler({
    data: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
    async apply(ctx, d, e) {
      const row = e?.row as { id: string; to_id: string; to_version: number | null; checked_against: number | null } | undefined;
      const target = await ctx.trx
        .selectFrom('record_versions')
        .select('record_id')
        .where('id', '=', row?.to_id ?? '')
        .executeTakeFirst();
      const current = target
        ? await ctx.trx
            .selectFrom('record_versions')
            .select('n')
            .where('record_id', '=', target.record_id)
            .where('state', '=', 'approved')
            .orderBy('n', 'desc')
            .executeTakeFirst()
        : undefined;
      if (!current || current.n <= Math.max(row?.to_version ?? 0, row?.checked_against ?? 0))
        throw new DomainError('conflict', 'What it rests on has no newer approved version: there is nothing to confirm.');
      await ctx.trx.updateTable('links').set({ checked_against: current.n }).where('id', '=', row?.id ?? '').execute();
      return { entityId: row?.id ?? '', after: { checked_against: current.n, note: d.note ?? null } };
    },
  }),
  'link.obsolete': handler({
    data: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
    async apply(_ctx, d, e) {
      return { entityId: e?.id ?? '', after: { note: d.note ?? null } };
    },
  }),
});
