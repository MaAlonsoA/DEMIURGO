// Proposal payloads by type: the schema used to validate them on creation and on
// accepting with changes. An agent only proposes; accepting is always a person's job.

import { z } from 'zod';
import { proposedCriterion } from './agents.ts';

const text = (max: number) => z.string().trim().min(1).max(max);

export const recordReference = z
  .object({ code: z.string().regex(/^[A-Z]{3}-[A-Z]{3}-\d{3}$/), version: z.number().int().positive() })
  .strict();

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
  })
  .strict();

/** Proposal from the knowledge system: review a record with authority (never a direct change). */
export const revisionPayload = z
  .object({
    record: recordReference,
    verdict: z.enum(['invalidate', 'update', 'add', 'other']),
    reason: text(2000),
    change: z.object({ type: z.string(), id: z.string(), version: z.number().int().nullable() }).strict(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const AGENT_PROPOSAL_TYPES = ['decision', 'exploration', 'fdr'] as const;

/** Proposal types. `imported_record` and `imported_taxonomy` are only created by the design/ import. */
export const PAYLOADS = {
  decision: decisionPayload,
  exploration: explorationPayload,
  fdr: fdrPayload,
  review: revisionPayload,
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
