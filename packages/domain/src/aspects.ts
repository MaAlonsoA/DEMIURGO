// The aspect of the product a proposal or record is about: one fixed tag for every project, so the
// person reads one noun (a proposal, a record) and one tag. It is decided by the text itself, never
// inherited from the thread, its parent or the open stage. The descriptions are the criteria the
// classifier (Jev) and the agents apply.

import { z } from 'zod';

export const ASPECTS = ['product', 'feature', 'quality', 'architecture', 'security', 'operations', 'other'] as const;
export type Aspect = (typeof ASPECTS)[number];
export const aspectSchema = z.enum(ASPECTS);

export const ASPECT_DESCRIPTIONS: Record<Aspect, string> = {
  product: 'What the product is and why: purpose, users, problem, outcomes, principles, scope of the first version.',
  feature: 'What the product does for its users: a capability, a workflow, a behavior or a business rule.',
  quality:
    'How well it must work across the product: performance, availability, recovery, usability, accessibility, data retention.',
  architecture: 'How it is built: components, technologies, integrations, data storage, technical decisions and risks.',
  security: 'What is protected and from whom: assets, access, authentication, permissions, threats and mitigations.',
  operations: 'How it runs in production: deployment, rollout and rollback, monitoring, backups, support.',
  other: 'None of the above.',
};

const BY_TYPE: Record<string, Aspect> = {
  product_definition: 'product',
  design_system: 'product',
  screen_design: 'product',
  definition_change: 'product',
  epic: 'feature',
  fdr: 'feature',
  task: 'feature',
  requirement: 'feature',
  quality_requirement: 'quality',
  adr: 'architecture',
  threat_model: 'security',
  production_readiness: 'operations',
};

/** The aspect a record type fixes; null for the types whose content decides it (decision, bug). */
export function aspectOfType(type: string | null | undefined): Aspect | null {
  return (type && BY_TYPE[type]) || null;
}

export const isAspect = (v: unknown): v is Aspect => typeof v === 'string' && (ASPECTS as readonly string[]).includes(v);
