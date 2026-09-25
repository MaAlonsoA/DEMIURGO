// Pure logic of the map (FDR-INT-002): the lanes by area, what an element is connected to, what
// waits on the person, and the words of each relation.

import type { MapQuestion, MapRelation, ProductMap, Relation } from '../../api/views.ts';

export type Lane = {
  area: string;
  /** Features (FDR): cards. */
  features: ProductMap['records'];
  /** Decisions and tech decisions: the rules the features follow, as nodes. */
  rules: ProductMap['records'];
};

export function lanesOf(map: ProductMap): Lane[] {
  return map.areas.map((area) => {
    const inArea = map.records.filter((r) => r.domain === area).toSorted((a, b) => a.code.localeCompare(b.code));
    return { area, features: inArea.filter((r) => r.type === 'fdr'), rules: inArea.filter((r) => r.type !== 'fdr') };
  });
}

/** The element and everything a relation joins it to, in either direction. */
export function connectedTo(code: string, relations: readonly MapRelation[]): Set<string> {
  const out = new Set([code]);
  for (const r of relations) {
    if (r.from === code) out.add(r.to);
    if (r.to === code) out.add(r.from);
  }
  return out;
}

export function waitingOn(code: string, questions: readonly MapQuestion[]): MapQuestion[] {
  return questions.filter((q) => q.affects.includes(code));
}

const WORDS: Record<Relation, { from: string; to: string }> = {
  needs: { from: 'Needs', to: 'Needed by' },
  follows: { from: 'Rules it follows', to: 'Followed by' },
  conflicts: { from: 'Conflicts with', to: 'Conflicts with' },
  affects: { from: 'Affects', to: 'Affected by' },
};

/** The relation seen from its origin (`from`) or from its target (`to`). */
export function relationWord(kind: Relation, end: 'from' | 'to'): string {
  return WORDS[kind][end];
}

/**
 * How each relation is drawn (DESIGN.md §3.7): every kind has its own pattern *and* its own name in
 * the legend, so no two kinds differ by color alone. The color only reinforces the pattern.
 * `stroke` and `fill` are theme classes (the arrowhead takes the fill).
 */
export type LineStyle = { label: string; stroke: string; fill: string; dash: string | undefined; width: number };

export const LINE_STYLES: Record<Relation, LineStyle> = {
  needs: { label: 'Needs another feature', stroke: 'stroke-fg-2', fill: 'fill-fg-2', dash: undefined, width: 2 },
  follows: { label: 'Follows a rule', stroke: 'stroke-fg-3', fill: 'fill-fg-3', dash: '1 4', width: 1.75 },
  conflicts: { label: 'Conflicts', stroke: 'stroke-danger', fill: 'fill-danger', dash: '10 3 2 3', width: 2 },
  affects: { label: 'Affects (derived from)', stroke: 'stroke-info', fill: 'fill-info', dash: '6 4', width: 1.5 },
};

/** A link that waits for the person's review: a wide amber band under the line, whatever its kind. */
export const UNDER_REVIEW = {
  label: 'Under review: its link waits for your review',
  stroke: 'stroke-warning',
  width: 8,
  opacity: 0.35,
} as const;

export const RELATION_KINDS: readonly Relation[] = ['needs', 'follows', 'conflicts', 'affects'];
