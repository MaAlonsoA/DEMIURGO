// Types for the fixed `design/` format. The format is described in `design/README.md`,
// which is generated from `readme.ts`.

export const RECORD_TYPES = ['decision', 'adr', 'fdr', 'bug'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

// design/ keeps the current version of each record: in draft (proposed) or approved.
export const DOCUMENT_STATUSES = ['proposed', 'approved'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const VERIFICATIONS = ['automatic', 'manual'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const LINK_TYPES = ['based_on', 'design_of', 'covers', 'origin', 'conflicts_with', 'derived_from'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export type Reference = { code: string; version: number };

export type Link = { type: LinkType; target: Reference };

export type Section = { title: string; content: string };

export type Criterion = {
  code: string;
  title: string;
  verification: Verification;
  check: string;
  statement: string;
  derivedFrom?: string;
};

export type RecordDocument = {
  kind: 'record';
  type: RecordType;
  code: string;
  title: string;
  version: number;
  state: DocumentStatus;
  domain: string;
  increment?: string;
  changeNote?: string;
  links: Link[];
  annexes: string[];
  sections: Section[];
  criteria: Criterion[];
};

export type Category = { code: string; name: string; description: string };
export type Axis = { code: string; name: string; categories: Category[] };

export type TaxonomyDocument = {
  kind: 'taxonomy';
  code: string;
  title: string;
  version: number;
  state: DocumentStatus;
  axes: Axis[];
  sections: Section[];
};

export type Document = RecordDocument | TaxonomyDocument;

export type Problem = { path: string; message: string };

export type Result<T> = { ok: true; value: T } | { ok: false; problems: Problem[] };

/** Template per type: mandatory sections, in order, before "Acceptance criteria". */
export const TEMPLATES: Record<RecordType, { sections: readonly string[]; requiresCriteria: boolean }> = {
  decision: { sections: ['Context', 'Decision', 'Consequences'], requiresCriteria: false },
  adr: { sections: ['Context', 'Options', 'Decision', 'Consequences'], requiresCriteria: true },
  fdr: { sections: ['Goal', 'Scope', 'Out of scope', 'Behavior'], requiresCriteria: true },
  bug: { sections: ['Reproduction', 'Expected', 'Observed'], requiresCriteria: true },
};

export const CRITERIA_SECTION = 'Acceptance criteria';

export const PREFIXES: Record<RecordType | 'taxonomy', string> = {
  decision: 'DEC',
  adr: 'ADR',
  fdr: 'FDR',
  bug: 'BUG',
  taxonomy: 'TAX',
};

export const FOLDERS: Record<RecordType | 'taxonomy', string> = {
  decision: 'decisions',
  adr: 'adr',
  fdr: 'fdr',
  bug: 'bugs',
  taxonomy: 'taxonomy',
};
