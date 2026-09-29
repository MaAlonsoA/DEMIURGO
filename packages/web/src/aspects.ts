// The aspect of a proposal or a record: what part of the product it is about (product, a feature,
// quality, architecture…). The interface names things by one noun ("Proposal", "Record") plus
// this aspect as a tag, never by the internal record type (FDR, ADR, NFR, "Design record"). Pure.

export const ASPECTS = ['product', 'feature', 'quality', 'architecture', 'security', 'operations', 'other'] as const;
export type Aspect = (typeof ASPECTS)[number];

export function isAspect(v: unknown): v is Aspect {
  return typeof v === 'string' && (ASPECTS as readonly string[]).includes(v);
}

const TYPE_ASPECT: Record<string, Aspect> = {
  product_definition: 'product',
  fdr: 'feature',
  requirement: 'feature',
  quality_requirement: 'quality',
  adr: 'architecture',
  threat_model: 'security',
  production_readiness: 'operations',
};

/** The aspect of a record or proposal type; null when only its content decides (a decision, a bug). */
export function aspectOfType(type: string | null | undefined): Aspect | null {
  return type ? (TYPE_ASPECT[type] ?? null) : null;
}

/** The aspect of a proposal: the one it says, else the record type it makes. */
export function aspectOfProposal(p: { type: string; payload: Record<string, unknown> }): Aspect | null {
  if (isAspect(p.payload.aspect)) return p.payload.aspect;
  if (p.type === 'design_record') return aspectOfType(typeof p.payload.record_type === 'string' ? p.payload.record_type : null);
  if (p.type === 'definition_change') return 'product';
  if (p.type === 'imported_record') {
    const doc = p.payload.document as { type?: unknown } | undefined;
    return aspectOfType(typeof doc?.type === 'string' ? doc.type : null);
  }
  if (p.type === 'review' || p.type === 'record_translation') {
    const r = p.payload.record as { type?: unknown } | undefined;
    return aspectOfType(typeof r?.type === 'string' ? r.type : null);
  }
  return aspectOfType(p.type);
}

/** The aspect of a record row: the one it has, else its type's. */
export function aspectOfRecord(r: { type: string; aspect?: string | null }): Aspect | null {
  return isAspect(r.aspect) ? r.aspect : aspectOfType(r.type);
}

/** Proposal kinds that are one more "Proposal" (they make or change a record); the others have their own noun. */
export const PROPOSAL_NOUN_KINDS = new Set(['decision', 'fdr', 'design_record', 'product_definition', 'definition_change']);
