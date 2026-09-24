// Pure helpers of the package and batch page: what kind of batch it is, the counts of an import
// against design/, its documents by group, the words of a proposal and the record an idea check
// cites. Nothing here decides what is allowed: that comes from the tables.

import type { BatchDetail, ImportCounts, ProductRow, Proposal, RecordType } from '../../api/types.ts';

export type BatchView = 'import' | 'package' | 'items';

/** An import and a system package are resolved whole; anything else, item by item. */
export function batchView(b: Pick<BatchDetail, 'kind' | 'resolution_mode'>): BatchView {
  if (b.kind === 'import') return 'import';
  return b.resolution_mode === 'package' ? 'package' : 'items';
}

export type CountRow = { kind: string; origin: number | null; inPackage: number; same: boolean };

/** Rows of "What's inside": each kind in design/ and in this package. */
const records = (c: ImportCounts) => c.decision + c.adr + c.fdr + c.bug;

export function countRows(counts: { origin: ImportCounts | null; package: ImportCounts }): CountRow[] {
  const rows: [string, (c: ImportCounts) => number][] = [
    ['Records', records],
    ['Versions', (c) => c.versions],
    ['Checks', (c) => c.criteria],
    ['Links', (c) => c.links],
    ['Taxonomies', (c) => c.taxonomies],
    ['Annexes', (c) => c.annexes],
  ];
  return rows.map(([kind, of]) => {
    const origin = counts.origin ? of(counts.origin) : null;
    const inPackage = of(counts.package);
    return { kind, origin, inPackage, same: origin === inPackage };
  });
}

/** A document of design/ as the importer proposes it. */
export type ImportedDocument = {
  code: string;
  type: RecordType;
  title: string;
  version: number;
  state: string;
  domain?: string;
  sections: { title: string; content: string }[];
  criteria: { code: string; title: string; statement: string; verification: string; check: string }[];
  links: { type: string; target: { code: string; version: number } }[];
  annexes: string[];
};

export type ImportedTaxonomy = {
  code: string;
  title: string;
  version: number;
  state: string;
  axes: { code: string; name: string; categories: { code: string; name: string; description?: string }[] }[];
  sections: { title: string; content: string }[];
};

export type DocumentGroup = { key: string; label: string; items: Proposal[] };

const GROUPS: { key: string; label: string; match: (p: Proposal) => boolean }[] = [
  { key: 'decision', label: 'Decisions', match: (p) => docType(p) === 'decision' },
  { key: 'adr', label: 'Tech decisions', match: (p) => docType(p) === 'adr' },
  { key: 'fdr', label: 'Features', match: (p) => docType(p) === 'fdr' },
  { key: 'bug', label: 'Bugs', match: (p) => docType(p) === 'bug' },
  { key: 'taxonomy', label: 'Taxonomy', match: (p) => p.type === 'imported_taxonomy' },
];

function docType(p: Proposal): string | null {
  if (p.type !== 'imported_record') return null;
  const type = (p.payload.document as { type?: unknown } | undefined)?.type;
  return typeof type === 'string' ? type : null;
}

/** Documents of an import, grouped as Decisions, Tech decisions, Features, Bugs and Taxonomy. */
export function documentGroups(proposals: Proposal[]): DocumentGroup[] {
  return GROUPS.map((g) => ({ key: g.key, label: g.label, items: proposals.filter(g.match) })).filter((g) => g.items.length > 0);
}

export function importedDocument(p: Proposal): ImportedDocument | null {
  return p.type === 'imported_record' ? (p.payload.document as ImportedDocument) : null;
}

export function importedTaxonomy(p: Proposal): ImportedTaxonomy | null {
  return p.type === 'imported_taxonomy' ? (p.payload.document as ImportedTaxonomy) : null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** What a proposal is called: its title, the purpose of a thread or the record a review touches. */
export function proposalTitle(p: { type: string; payload: Record<string, unknown> }): string {
  if (p.type === 'review') {
    const r = p.payload.record as { code?: string; version?: number } | undefined;
    return `Review ${r?.code ?? 'a record'}${r?.version ? ` v${r.version}` : ''}`;
  }
  if (p.type === 'exploration') return str(p.payload.purpose);
  const doc = p.payload.document as { title?: unknown } | undefined;
  return str(p.payload.title) || str(doc?.title);
}

/** The type of a proposal in the UI's words. */
export const PROPOSAL_TYPE_WORDS: Record<string, string> = {
  decision: 'Decision',
  fdr: 'Feature',
  exploration: 'Thread',
  review: 'Review',
  imported_record: 'Document',
  imported_taxonomy: 'Taxonomy',
};

/** Which proposals can be approved in the same gesture as accepting them (they create a record). */
export const APPROVABLE_TYPES = new Set(['decision', 'fdr']);

export type EditableField = { key: string; label: string; max: number; multiline: boolean };

/** Text fields a person can change before accepting ("Change"): the payload's own fields, as they are. */
export const EDITABLE_FIELDS: Record<string, EditableField[]> = {
  decision: [
    { key: 'title', label: 'Title', max: 200, multiline: false },
    { key: 'context', label: 'Context', max: 5000, multiline: true },
    { key: 'decision', label: 'Decision', max: 5000, multiline: true },
    { key: 'consequences', label: 'Consequences', max: 5000, multiline: true },
  ],
  fdr: [
    { key: 'title', label: 'Title', max: 200, multiline: false },
    { key: 'goal', label: 'Goal', max: 5000, multiline: true },
    { key: 'scope', label: 'Scope', max: 5000, multiline: true },
    { key: 'out_of_scope', label: 'Out of scope', max: 5000, multiline: true },
    { key: 'behavior', label: 'Behavior', max: 10_000, multiline: true },
  ],
  exploration: [{ key: 'purpose', label: 'Purpose', max: 1000, multiline: true }],
};

/**
 * The edit sent with "Change": the whole payload with the person's changes, because the server
 * validates the edit against the payload's schema.
 */
export function editedPayload(payload: Record<string, unknown>, changes: Record<string, string>): Record<string, unknown> {
  const edit: Record<string, unknown> = { ...payload };
  for (const [k, v] of Object.entries(changes)) edit[k] = v.trim();
  return edit;
}

/** The fields the person actually changed. */
export function changedFields(payload: Record<string, unknown>, draft: Record<string, string>): string[] {
  return Object.entries(draft)
    .filter(([k, v]) => v.trim() !== str(payload[k]).trim())
    .map(([k]) => k);
}

/** Why a proposal went out of date, as the server wrote it. */
export function obsoleteReason(p: { state: string; resolution?: Record<string, unknown> | null }): string | null {
  if (p.state !== 'superseded') return null;
  const r = p.resolution?.obsolete;
  return typeof r === 'string' ? r : null;
}

/** An idea check finding in words (the classifier's verdicts). */
export const FINDING_WORDS: Record<string, string> = {
  duplicates: 'Duplicates',
  conflicts: 'Contradicts',
  inconsistent: "Doesn't fit with",
  relates: 'Relates to',
};

const RECORD_REF = /^((?:DEC|FDR|ADR|BUG)-[A-Z]{3}-\d{3})@(\d+)$/;
const CHECK_REF = /^AC-([A-Z]{3}-\d{3})-\d{2}@(\d+)$/;

/**
 * The record a citation (a knowledge node ref, CODE@n) points to, when it can be derived: a record
 * version directly, or a check whose record is the only one of the project with its code.
 */
export function citedRecord(citation: string, codes: readonly string[]): { code: string; version: number } | null {
  const r = RECORD_REF.exec(citation);
  if (r?.[1] && r[2]) return { code: r[1], version: Number(r[2]) };
  const c = CHECK_REF.exec(citation);
  if (c?.[1] && c[2]) {
    const owners = codes.filter((code) => code.slice(4) === c[1]);
    const only = owners.length === 1 ? owners[0] : undefined;
    return only ? { code: only, version: Number(c[2]) } : null;
  }
  return null;
}

/** The effect of an accepted proposal, as the server returned it: the record it created, if any. */
export function acceptedRecord(p: {
  resolution?: Record<string, unknown> | null;
}): { code: string; version: number; approved: boolean } | null {
  const e = p.resolution?.effect as
    | { type?: string; code?: string; version?: number; approved?: boolean; state?: string }
    | undefined;
  if (e?.type !== 'record' || !e.code) return null;
  return { code: e.code, version: e.version ?? 1, approved: e.approved === true || e.state === 'approved' };
}

/** The record row of the product state for a code, if the record exists. */
export function rowOf(rows: readonly ProductRow[], code: string): ProductRow | undefined {
  return rows.find((r) => r.code === code);
}

/** The record whose latest or current version is this one, among the product's rows. */
export function rowOfVersion(rows: readonly ProductRow[], versionId: string): ProductRow | undefined {
  return rows.find((r) => r.latest_id === versionId || r.current_id === versionId);
}
