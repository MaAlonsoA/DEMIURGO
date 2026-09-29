// Proposal payloads by type: the schema used to validate them on creation and on
// accepting with changes. An agent only proposes; accepting is always a person's job.

import { z } from 'zod';
import { proposedCriterion } from './agents.ts';
import { aspectSchema } from './aspects.ts';
import { DEFINITION_SECTION_TITLES, QUOTE_MAX } from './definition.ts';

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

export const explorationPayload = z.object({ purpose: text(1000) }).strict();

export const fdrPayload = z
  .object({
    title: text(200),
    goal: text(5000),
    scope: text(5000),
    out_of_scope: text(5000),
    behavior: text(10_000),
    criteria: z.array(proposedCriterion).min(1).max(12),
    based_on: recordReference.optional(),
    domain: z
      .string()
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
    aspect: aspectSchema.optional(),
    basis,
  })
  .strict();

/** A design-stage record (requirement, quality requirement, threat model, production readiness or ADR). */
export const designRecordPayload = z
  .object({
    record_type: z.enum(['epic', 'fdr', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'adr']),
    title: text(200),
    sections: z
      .array(z.object({ title: text(120), content: text(10_000) }).strict())
      .min(1)
      .max(8),
    criteria: z.array(proposedCriterion).min(1).max(12),
    domain: z
      .string()
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
    /** A feature's epic: the record it rests on. */
    based_on: recordReference.optional(),
    aspect: aspectSchema.optional(),
    basis,
  })
  .strict();

/** Proposal from the knowledge system: review a record with authority (never a direct change). */
export const reviewPayload = z
  .object({
    record: recordReference,
    verdict: z.enum(['invalidate', 'update', 'add', 'other']),
    reason: text(2000),
    change: z.object({ type: z.string(), id: z.string(), version: z.number().int().nullable() }).strict(),
    confidence: z.number().min(0).max(1),
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
 * A change to one section of an approved record (an epic's features, for one), proposed by an agent
 * from what the person decided in the thread that is about that record, on their own words there
 * (`evidence`, checked by the server). Accepting it makes the next version of the record: the one
 * in force with only that section replaced; `record` is the version it changes.
 */
export const recordChangePayload = z
  .object({
    record: recordReference,
    section: text(120),
    content: text(10_000),
    reason: text(1000),
    evidence: z
      .array(z.object({ message_id: z.string().uuid(), quote: text(QUOTE_MAX) }).strict())
      .min(1)
      .max(3),
  })
  .strict();

export const AGENT_PROPOSAL_TYPES = ['decision', 'exploration', 'fdr', 'design_record'] as const;

/**
 * Proposal types. `imported_record` and `imported_taxonomy` are only created by the design/ import;
 * `record_translation` and `product_definition`, by the system; `definition_change` and `record_change`, by DEMIURGO's
 * agents in a thread.
 */
export const PAYLOADS = {
  decision: decisionPayload,
  exploration: explorationPayload,
  fdr: fdrPayload,
  design_record: designRecordPayload,
  review: reviewPayload,
  record_translation: recordTranslationPayload,
  product_definition: productDefinitionPayload,
  definition_change: definitionChangePayload,
  record_change: recordChangePayload,
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
