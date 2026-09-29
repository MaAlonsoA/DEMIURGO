// An epic's features are the features in its domain: the explorer gives a feature the domain of
// the epic it grows from, so both share the code prefix (EPC-GUI-001 → FDR-GUI-001).

import type { ProductRow } from '../../api/types.ts';

export type EpicGroup = { epic: ProductRow; features: ProductRow[] };

/** Each epic with its features, and the features that belong to no epic. */
export function epicGroups(rows: ProductRow[]): { groups: EpicGroup[]; loose: ProductRow[] } {
  const epics = rows.filter((r) => r.type === 'epic');
  const features = rows.filter((r) => r.type === 'fdr');
  const domains = new Set(epics.map((e) => e.domain));
  return {
    groups: epics.map((epic) => ({ epic, features: features.filter((f) => f.domain === epic.domain) })),
    loose: features.filter((f) => !domains.has(f.domain)),
  };
}
