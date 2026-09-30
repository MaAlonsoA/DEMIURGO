// The aspect of a proposal or a record: what part of the product it is about (product, a feature,
// quality, architecture…). The interface names things by one noun ("Proposal", "Record") plus
// this aspect as a tag, never by the internal record type (FDR, ADR, NFR, "Design record"). An epic
// is its own tag: it groups features, it is not one. Pure.

export const ASPECTS = ['product', 'epic', 'feature', 'quality', 'architecture', 'security', 'operations', 'other'] as const;
export type Aspect = (typeof ASPECTS)[number];

export function isAspect(v: unknown): v is Aspect {
  return typeof v === 'string' && (ASPECTS as readonly string[]).includes(v);
}

const TYPE_ASPECT: Record<string, Aspect> = {
  product_definition: 'product',
  design_system: 'product',
  epic: 'epic',
  fdr: 'feature',
  task: 'feature',
  requirement: 'feature',
  quality_requirement: 'quality',
  adr: 'architecture',
  threat_model: 'security',
  production_readiness: 'operations',
};

const CODE_PREFIX_TYPE: Record<string, string> = {
  DEF: 'product_definition',
  DSY: 'design_system',
  EPC: 'epic',
  FDR: 'fdr',
  TSK: 'task',
  REQ: 'requirement',
  NFR: 'quality_requirement',
  ADR: 'adr',
  THR: 'threat_model',
  PRR: 'production_readiness',
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
  // A change to an epic's list of features is about the epic.
  if (p.type === 'feature_plan') return 'epic';
  // A change to a record is about what the record is: its code's prefix says its type.
  if (p.type === 'record_change') {
    const code = (p.payload.record as { code?: unknown } | undefined)?.code;
    return aspectOfType(typeof code === 'string' ? CODE_PREFIX_TYPE[code.slice(0, 3)] : null);
  }
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

/** The aspect of a record row: an epic's is always Epic; else the one it has, else its type's. */
export function aspectOfRecord(r: { type: string; aspect?: string | null }): Aspect | null {
  if (r.type === 'epic') return 'epic';
  return isAspect(r.aspect) ? r.aspect : aspectOfType(r.type);
}

/** Proposal kinds that are one more "Proposal" (they make or change a record); the others have their own noun. */
export const PROPOSAL_NOUN_KINDS = new Set(['decision', 'fdr', 'design_record', 'product_definition', 'definition_change', 'record_change', 'feature_plan']);

export type AspectGroup<T> = { key: Aspect | 'none'; aspect: Aspect | null; rows: T[] };

/** Records grouped by aspect in the fixed order, then those without one; only the groups with rows. */
export function recordsByAspect<T extends { type: string; aspect?: string | null }>(rows: readonly T[]): AspectGroup<T>[] {
  const groups: AspectGroup<T>[] = [
    ...ASPECTS.map((a) => ({ key: a, aspect: a, rows: rows.filter((r) => aspectOfRecord(r) === a) })),
    { key: 'none' as const, aspect: null, rows: rows.filter((r) => aspectOfRecord(r) === null) },
  ];
  return groups.filter((g) => g.rows.length > 0);
}
