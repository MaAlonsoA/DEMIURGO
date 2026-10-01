// Proposal payloads by type: the schema used to validate them on creation and on
// accepting with changes. An agent only proposes; accepting is always a person's job.

import { taskSizeSchema } from './sizes.ts';
import { z } from 'zod';
import { composeStatement, practiceSources, proposedCriterion } from './agents.ts';
import { VERSION_LIMITS } from './records.ts';
import { aspectSchema } from './aspects.ts';
import { DEFINITION_SECTION_TITLES, QUOTE_MAX } from './definition.ts';
import { designSystemProblems, designSystemSpec } from './design-system.ts';
import { screenDesignProblems, screenDesignSpec } from './screen-design.ts';

const text = (max: number) => z.string().trim().min(1).max(max);

export const recordReference = z
  .object({ code: z.string().regex(/^[A-Z]{3}-[A-Z]{3}-\d{3}$/), version: z.number().int().positive() })
  .strict();

/**
 * What a proposal rests on, for "Based on": the person's words in a thread (with the quote), the
 * question it answers, a record it builds on or a source. Everything comes from DEMIURGO: the
 * provenance is what it is based on, not who wrote it.
 */
export const basisItem = z
  .object({
    type: z.enum(['message', 'question', 'record', 'source']),
    id: z.string().uuid(),
    quote: text(QUOTE_MAX).optional(),
  })
  .strict();
const basis = z.array(basisItem).max(12).optional();

export const decisionPayload = z
  .object({
    title: text(200),
    context: text(5000),
    decision: text(5000),
    consequences: text(5000),
    domain: z
      .string()
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
    aspect: aspectSchema.optional(),
    basis,
  })
  .strict();

/** A criterion as stored in a payload: `step` may be missing in payloads written before it existed. */
// It may also carry Given/When/Then apart (all three or none); then `statement` may be missing and is composed.
const payloadCriterion = proposedCriterion
  .extend({
    statement: proposedCriterion.shape.statement.optional(),
    step: proposedCriterion.shape.step.optional(),
    given: text(500).optional(),
    when: text(500).optional(),
    then: text(500).optional(),
  })
  .superRefine((c, ctx) => {
    const parts = [c.given, c.when, c.then].filter((p) => p !== undefined).length;
    if (parts !== 0 && parts !== 3) ctx.addIssue({ code: 'custom', message: 'Give all of given, when and then, or none.' });
    if (parts === 0 && !c.statement) ctx.addIssue({ code: 'custom', path: ['statement'], message: 'A criterion needs a statement or given/when/then.' });
  });

/** The statement of a payload criterion: its own, or the one composed from Given/When/Then. */
export function criterionStatement(c: { statement?: string | undefined; given?: string | undefined; when?: string | undefined; then?: string | undefined }): string {
  if (c.statement) return c.statement;
  return composeStatement({ given: c.given ?? '', when: c.when ?? '', then: c.then ?? '' });
}

export const explorationPayload = z.object({ purpose: text(1000) }).strict();

export const fdrPayload = z
  .object({
    title: text(200),
    goal: text(5000),
    scope: text(5000),
    out_of_scope: text(5000),
    behavior: text(10_000),
    criteria: z.array(payloadCriterion).min(1).max(VERSION_LIMITS.criteria),
    based_on: recordReference.optional(),
    /** The practice sources the feature is based on (unverified). */
    sources: practiceSources.optional(),
    /** The feature's T-shirt size. */
    size: taskSizeSchema.optional(),
    domain: z
      .string()
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
    aspect: aspectSchema.optional(),
    basis,
  })
  .strict();

/** A feature an epic lists: its name and one sentence of what it lets the person do. */
export const plannedFeatureInput = z.object({ name: text(120), summary: text(500) }).strict();

/** A design-stage record (requirement, quality requirement, threat model, production readiness or ADR). */
export const designRecordPayload = z
  .object({
    record_type: z.enum(['epic', 'fdr', 'task', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'adr']),
    title: text(200),
    sections: z
      .array(z.object({ title: text(120), content: text(10_000) }).strict())
      .min(1)
      .max(8),
    // A task has none of its own: it covers criteria of its feature (`covers`).
    criteria: z.array(payloadCriterion).max(VERSION_LIMITS.criteria),
    /** The practice sources the record is based on (unverified). */
    sources: practiceSources.optional(),
    domain: z
      .string()
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
    /** A task's covered criteria: codes of its feature's criteria it implements. */
    covers: z.array(z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/)).max(VERSION_LIMITS.criteria).optional(),
    /** A feature's epic: the record it rests on. */
    based_on: recordReference.optional(),
    /** A feature's siblings it depends on (approved features): one `based_on` link each, and they have to be built first. */
    needs: z.array(recordReference).max(6).optional(),
    /** An epic's features, in order (the smallest end-to-end walk first): accepting the epic makes each a planned feature. */
    features: z.array(plannedFeatureInput).max(20).optional(),
    /** A feature (fdr) designed from a planned feature of its epic: the code that feature reserved. */
    code: z
      .string()
      .regex(/^FDR-[A-Z]{3}-\d{3}$/)
      .optional(),
    /** A task's effort size (FDR-DEL-006), the one-line reason, and for an XL how it could be split. */
    size: taskSizeSchema.optional(),
    size_reason: text(300).optional(),
    split: text(600).optional(),
    /** A task's dependencies: the titles of the tasks of the same feature that must be done first (it is blocked by them). */
    depends_on_titles: z.array(text(200)).max(19).optional(),
    /** A task's feature dependencies: codes of other features that must be built first (a `depends_on` link each). */
    waits_for_features: z.array(z.string().regex(/^FDR-[A-Z]{3}-\d{3}$/)).max(6).optional(),
    /** A task's dependencies on tasks that already exist (any feature): codes, a `depends_on` link each to the task's latest version. */
    depends_on_tasks: z.array(z.string().regex(/^TSK-[A-Z]{3}-\d{3}$/)).max(6).optional(),
    /** What the deterministic plan checks found about this proposal, for the person to read before accepting (not authority). */
    warnings: z.array(text(400)).max(10).optional(),
    aspect: aspectSchema.optional(),
    basis,
  })
  .strict();

/** Proposal from the knowledge system: review a record with authority (never a direct change). */
export const reviewPayload = z
  .object({
    record: recordReference,
    // contradiction and duplicate come from a coherence review of an epic (FDR-KNO-056).
    verdict: z.enum(['invalidate', 'update', 'add', 'other', 'contradiction', 'duplicate', 'already_designed']),
    reason: text(2000),
    change: z.object({ type: z.string(), id: z.string(), version: z.number().int().nullable() }).strict(),
    confidence: z.number().min(0).max(1),
    // A coherence finding: the other record, a verbatim passage of each (checked by code) and what to change.
    other: recordReference.optional(),
    quotes: z.object({ record: text(300), other: text(300) }).strict().optional(),
    suggestion: text(600).optional(),
    epic: z.string().optional(),
  })
  .strict();

/**
 * The English version of a record that was written in another language (records are always in
 * English). Accepting it creates a new version with the same structure: every criterion carried
 * over as modified, section titles and links kept, only the prose translated.
 */
export const recordTranslationPayload = z
  .object({
    record: recordReference,
    title: text(200),
    sections: z
      .array(z.object({ title: text(120), content: z.string().max(10_000) }).strict())
      .min(1)
      .max(12),
    criteria: z
      .array(
        z
          .object({
            code: z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/),
            title: text(200),
            statement: text(5000),
            check: text(2000),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();

/**
 * The product definition composed by the system from the stage's confirmed answers (never by an
 * agent). Without `record` it is the first version; with it, the next version of that one, with its
 * change note. `sources` keeps, per section, the question it comes from.
 */
export const productDefinitionPayload = z
  .object({
    record: recordReference.optional(),
    title: text(200),
    sections: z
      .array(z.object({ title: text(120), content: text(10_000) }).strict())
      .min(1)
      .max(12),
    sources: z
      .array(
        z
          .object({
            section: text(120),
            key: text(60),
            question_id: z.string().uuid().nullable(),
            state: z.enum(['confirmed', 'discarded', 'missing']),
          })
          .strict(),
      )
      // One per section, and one per answer in the sections of principles.
      .max(40),
    change_note: z.string().trim().max(2000).optional(),
  })
  .strict();

/** The sections of a design system, in order (RECORD_TEMPLATES.design_system). */
export const DESIGN_SYSTEM_SECTION_TITLES = [
  'Principles',
  'Visual direction',
  'Tokens',
  'Components',
  'Patterns',
  'Motion',
  'Accessibility',
  'Governance',
] as const;

/**
 * The project's design system, proposed by the design system agent. Sections are English prose (Tokens
 * and Components are human summaries); the machine part is `spec`, which must pass the deterministic
 * checks (`designSystemProblems`). Accepting it creates the DSY record, or its next version.
 */
export const designSystemPayload = z
  .object({
    title: text(200),
    sections: z
      .object({
        Principles: text(10_000),
        'Visual direction': text(10_000),
        Tokens: text(10_000),
        Components: text(10_000),
        Patterns: text(10_000),
        Motion: text(10_000),
        Accessibility: text(10_000),
        Governance: text(10_000),
      })
      .strict(),
    spec: designSystemSpec,
    change_note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const problem of designSystemProblems(c.spec)) {
      ctx.addIssue({ code: 'custom', path: ['spec'], message: problem });
    }
  });

/**
 * The screens of a feature, proposed by the screens agent. Sections are English prose; the machine part
 * is `spec`, checked here without the feature's step count and again against it where the feature is
 * known (the proposal guard and the applier). Accepting it creates the SCR record, or its next version.
 */
export const screenDesignPayload = z
  .object({
    title: text(200),
    sections: z
      .object({ Flow: text(10_000), Screens: text(10_000), States: text(10_000), Components: text(10_000) })
      .strict(),
    spec: screenDesignSpec,
    change_note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const problem of screenDesignProblems(c.spec, null)) ctx.addIssue({ code: 'custom', path: ['spec'], message: problem });
  });

/**
 * A change to one section of the approved product definition, proposed by an agent from what the
 * person decided in a thread, on their own words there (`evidence`, checked by the server). Accepting
 * it changes that section's answer (its question reopened with the reason and confirmed with the new
 * text) and approves the next version of the definition; `record` is the version it changes.
 */
export const definitionChangePayload = z
  .object({
    record: recordReference,
    section: z.enum(DEFINITION_SECTION_TITLES),
    content: text(3000),
    reason: text(1000),
    evidence: z
      .array(z.object({ message_id: z.string().uuid(), quote: text(QUOTE_MAX) }).strict())
      .min(1)
      .max(3),
  })
  .strict();

/**
 * A change to one section of an approved record, proposed by an agent
 * from what the person decided in the thread that is about that record, on their own words there
 * (`evidence`, checked by the server). Accepting it makes the next version of the record: the one
 * in force with only that section replaced; `record` is the version it changes.
 */
const acCode = z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/);
const criterionText = {
  title: text(160),
  statement: text(1500),
  verification: z.enum(['automatic', 'manual', 'release']),
  check: text(600),
  step: z.number().int().min(1).nullable().optional(),
};

/** A change to one criterion of a record: a new one, the whole new content of one, or one dropped. */
export const criterionChange = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), ...criterionText }).strict(),
  z.object({ action: z.literal('modify'), code: acCode, ...criterionText }).strict(),
  z.object({ action: z.literal('drop'), code: acCode }).strict(),
]);
export type CriterionChange = z.infer<typeof criterionChange>;

/**
 * A change to a record decided in the thread about it: whole sections replaced and criteria added,
 * modified or dropped, all in one new version. `section` and `content` are the older one-section form.
 */
export const recordChangePayload = z
  .object({
    record: recordReference,
    section: text(120).optional(),
    content: text(10_000).optional(),
    sections: z
      .array(z.object({ section: text(120), content: text(10_000) }).strict())
      .max(12)
      .optional(),
    criteria: z.array(criterionChange).max(24).optional(),
    /** A task's whole new list of covered criteria (only for a task): it is stored apart from the version, as a new row. */
    covers: z.array(acCode).min(1).max(VERSION_LIMITS.criteria).optional(),
    reason: text(1000),
    evidence: z
      .array(z.object({ message_id: z.string().uuid(), quote: text(QUOTE_MAX) }).strict())
      .min(1)
      .max(3),
  })
  .strict()
  .superRefine((c, ctx) => {
    if ((c.section === undefined) !== (c.content === undefined))
      ctx.addIssue({ code: 'custom', message: 'A section needs its content, and content its section.' });
    if (recordChangeSections(c).length === 0 && (c.criteria ?? []).length === 0 && !c.covers)
      ctx.addIssue({ code: 'custom', message: 'A record change changes at least one section or criterion.' });
  });
export type RecordChange = z.infer<typeof recordChangePayload>;

/** The sections a record change replaces, whichever form it came in. */
export function recordChangeSections(c: {
  section?: string | undefined;
  content?: string | undefined;
  sections?: readonly { section: string; content: string }[] | undefined;
}): { section: string; content: string }[] {
  return [...(c.section !== undefined && c.content !== undefined ? [{ section: c.section, content: c.content }] : []), ...(c.sections ?? [])];
}

/**
 * A change to the list of features of an epic, proposed by an agent from what the person decided in
 * the thread that is about the epic (draft or approved), on their own words there (`evidence`,
 * checked by the server). Accepting it adds, drops or moves one planned feature: there is no version
 * to approve.
 */
export const featurePlanPayload = z
  .object({
    epic: z.object({ code: z.string().regex(/^EPC-[A-Z]{3}-\d{3}$/) }).strict(),
    action: z.enum(['add', 'drop', 'move']),
    /** The feature dropped or moved (its reserved FDR code). */
    code: z
      .string()
      .regex(/^FDR-[A-Z]{3}-\d{3}$/)
      .nullish(),
    /** The feature added: its name and one sentence. */
    name: text(120).nullish(),
    summary: text(500).nullish(),
    /** Where the feature goes (add: at the end when absent) or its new place (move); 1-based. */
    position: z.number().int().positive().nullish(),
    reason: text(1000),
    /** The person's words the change rests on; may be empty only in a split proposed by the feature_design agent. */
    evidence: z
      .array(z.object({ message_id: z.string().uuid(), quote: text(QUOTE_MAX) }).strict())
      .max(3),
    /** True in the drop and adds of a feature the agent says is too big (kind `split`): no quote from the person is needed. */
    split_by_agent: z.boolean().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.evidence.length === 0 && !c.split_by_agent)
      ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'A change needs at least one quote from the person.' });
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (c.action === 'add') {
      need(!!c.name, 'name', 'An added feature needs a name.');
      need(!!c.summary, 'summary', 'An added feature needs a sentence saying what it does.');
    } else need(!!c.code, 'code', `A ${c.action} needs the code of the feature.`);
    if (c.action === 'move') need(c.position != null, 'position', 'A move needs the new place.');
  });

export const AGENT_PROPOSAL_TYPES = ['decision', 'exploration', 'fdr', 'design_record'] as const;

/**
 * Proposal types. `imported_record` and `imported_taxonomy` are only created by the design/ import;
 * `record_translation` and `product_definition`, by the system; `definition_change`, `record_change` and
 * `feature_plan`, by DEMIURGO's agents in a thread.
 */
export const PAYLOADS = {
  decision: decisionPayload,
  exploration: explorationPayload,
  fdr: fdrPayload,
  design_record: designRecordPayload,
  review: reviewPayload,
  record_translation: recordTranslationPayload,
  product_definition: productDefinitionPayload,
  design_system: designSystemPayload,
  screen_design: screenDesignPayload,
  definition_change: definitionChangePayload,
  record_change: recordChangePayload,
  feature_plan: featurePlanPayload,
  imported_record: z.object({ document: z.record(z.string(), z.unknown()), path: z.string() }).strict(),
  imported_taxonomy: z.object({ document: z.record(z.string(), z.unknown()), path: z.string() }).strict(),
} as const;

export type ProposalType = keyof typeof PAYLOADS;
export const PROPOSAL_TYPES = Object.keys(PAYLOADS) as ProposalType[];

export function isProposalType(t: string): t is ProposalType {
  return Object.hasOwn(PAYLOADS, t);
}

/** Declared dependency: the record is still on the same current version. */
export const dependencySchema = z
  .object({ type: z.literal('record'), id: z.string().uuid(), code: z.string(), version: z.number().int().positive() })
  .strict();

export type Dependency = z.infer<typeof dependencySchema>;

export const MAX_EXTERNAL_AGENT_PROPOSALS = 10;
